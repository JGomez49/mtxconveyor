/*
 * ipmImport.js — ADDED 2026-11-14 (John): read a COMPASS survey-tool file (.ipm, "Instrument Performance
 * Model") and convert it to the term format of /data/iscwsaToolcodes.json, so the AC module can run the
 * exact tool definition CNRL's Compass uses instead of the generic OWSG toolcode.
 * Browser + Node (UMD). Used by views/job.ejs (AC panel, "Import Compass .ipm").
 *
 * SOURCE for the file format: COMPASS Training Manual 2003.5, ch.3 "Survey Tool Editor" (pp.75-78):
 *   columns  Name | Vector | Tie-On | Unit | Value | Formula [| Min Inc | Max Inc]
 *   Vector   A azimuth error, B azimuth bias, D depth error (WdW), E depth error (ISCWSA), F depth bias,
 *            I inclination error (highside), J inclination bias, L lateral error ("error at 90/270 toolface
 *            equivalent to azimuth error / sin(inclination)"), M misalignment disc, N inertial sphere.
 *   Tie-On   R random, S systematic, W well, G global, N not accumulated (intermediate value used by name
 *            in other formulas).
 *   Unit     D degrees->radians, M/IM metres<->feet (Compass evaluates in feet; MTX evaluates in SI, so no
 *            conversion is needed for length units), T thousandths (0.001), others not interpreted.
 *   Rows with the SAME name are the same error source (their components are correlated).
 * Formula variables (same manual): INC, AZI (grid), AZM (magnetic), AZT (true), TMD, TVD, MTOT, DIP, LAT,
 *   GTOT, DTR, MTF, THO; DMD/EROT/AZE/INX are gyro-only and are not supported here.
 *
 * CONVERSION (stated implementation choices — the ISCWSA engine itself is unchanged):
 *   - Each term contributes value x unit factor x formula to the weighting function of its column:
 *     E -> depth (dD), I -> inclination (dI), A -> azimuth (dA), L -> azimuth with 1/sin(Inc) (from the
 *     manual's definition of L). Rows sharing a name and tie-on are summed into ONE term (correlated).
 *   - Intermediates (tie-on N) are substituted, in file order, as (value x formula).
 *   - Terms with L (and/or I) also get singular (vertical) vectors from the same definitions:
 *     I acts along (cosA, sinA, 0) and L along (-sinA, cosA, 0) at Inc = 0.
 *   - Vector X / Y rows named XCLX / XCLY with the Rev5 long-course-length formulas
 *     (max(abs(daz)*sin(inc), tort*smd) and max(abs(din), tort*smd)) map to the ISCWSA XCLA / XCLH terms
 *     (definition doc Rev5.13 §5.2.1, Eq 40/41), magnitude = value, tortuosity = the file's TORT intermediate.
 *     (X/Y are not in the 2003 manual; the mapping is by the XCL formula text, which is checked.)
 *   - VECTOR S (2026-11-14, from the COMPASS 5000 "Survey Tools Dialog" help, pasted by John): "S – Depth error
 *     (ISCWSA) used for Subsea well reference errors". CNRL wells are land wells, so these rows (drfr S 2.2 m,
 *     drfs S 1 m in MWD+HRGM / MWD+IGRF) do not apply and are left out with that reason. Consistent with the
 *     Compass Error Ellipse report for 16-34-026-18W4: vertical error at 30 m = 0.70 m (2 sigma) = 2 x the
 *     0.35 m E-vector drfr only. How Compass applies S on subsea wells is not documented here -> not modelled.
 *     The same help also defines C (cone of error), N (constant), R (inertial sphere), T (inclination-only cone);
 *     X / Y / Z are in the Compass list but not in the help (X/Y handled by the XCL formula check above).
 *   - GYRO (2026-11-14): STATIONARY (gyrocompass) tools are supported — per the ISCWSA Rev5.13 definition doc
 *     §7 / §7.2 stationary mode "is quite similar to the MWD model", weighting functions evaluated per station
 *     with TRUE azimuth; the MTX engine was validated for this against SPE 90408 Appendix E Example Models #1
 *     (XY gyro) and #6 (XYZ gyro) on ISCWSA well #1, all checkpoints within the paper's +/-1 % (+/-2 units)
 *     acceptance (worst 0.62 %; reference values as transcribed in welleng tests/test_spe90408_appendix_e.py).
 *     CONTINUOUS-mode gyro (DMD, running speed, inclination-range mode switching, re-initialisation) is NOT
 *     supported: such rows are left out and reported.
 *   - NOT SUPPORTED (listed in `skipped`, never guessed): B/J/F bias, C, D (WdW depth), M, R, T, Z, inertial N,
 *     inclination-range rows, gyro variables.
 *   - Azimuth AZI (grid) is evaluated with the TRUE azimuth (MTX surveys are true north).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.IPMImport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var VARS = { inc: 'Inc', azm: 'AzM', azt: 'AzT', azi: 'AzT', tmd: 'MD', tvd: 'TVD', mtot: 'BField', dip: 'Dip',
        gtot: 'GField', lat: 'Latitude', dtr: 'RAD', mtf: '1', tho: '0.001',
        // 2026-11-14 (stationary gyro): EROT = "Earth's rotation rate = DTR * 15.041 * Cos(Latitude)" (COMPASS
        // manual 2003.5 p.78; rad/hr, matching gyro magnitudes in deg/hr with unit D). 15.041066876 deg/hr = WGS-84
        // value recommended in the ISCWSA Rev5.13 definition doc §7.1. SMD = course length (MD - previous MD).
        erot: '(RAD*15.041066876*Cos(Latitude))', smd: '(MD-MDPrev)' };
    // continuous-mode gyro / tie-on variables: not supported (only STATIONARY gyro tools, see header)
    var GYRO = /\b(dmd|aze|inx|tfo)\b/i;
    var UNIT = { d: Math.PI / 180, dnt: Math.PI / 180, t: 0.001 };

    function parse(text) {
        var meta = {}, rows = [];
        String(text).split(/\r?\n/).forEach(function (l) {
            if (!l.trim()) return;
            if (l[0] === '#') { var m = /^#(\w+):(.*)$/.exec(l.trim()); if (m) meta[m[1]] = m[2].trim(); return; }
            var c = l.split('\t'); if (c.length < 6) c = l.trim().split(/\s+/);
            if (c.length < 6) return;
            rows.push({ name: c[0].trim(), vec: c[1].trim().toLowerCase(), tie: c[2].trim().toLowerCase(), unit: c[3].trim().toLowerCase(),
                value: +c[4], formula: c.slice(5, c.length >= 8 ? c.length - 2 : c.length).join(' ').trim(),
                minInc: c.length >= 8 ? c[c.length - 2] : null, maxInc: c.length >= 8 ? c[c.length - 1] : null });
        });
        return { meta: meta, rows: rows };
    }
    function subst(f, inter) {   // intermediates, then Compass names -> MTX formula names
        var s = ' ' + f + ' ';
        Object.keys(inter).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
            s = s.replace(new RegExp('(^|[^\\w])' + k.replace(/[-]/g, '\\-') + '(?![\\w])', 'gi'), function (m0, p) { return p + '(' + inter[k] + ')'; });
        });
        Object.keys(VARS).forEach(function (k) { s = s.replace(new RegExp('\\b' + k + '\\b', 'gi'), VARS[k]); });
        return s.trim();
    }
    function convert(text, opts) {
        opts = opts || {};
        var p = parse(text), inter = {}, terms = {}, order = [], skipped = [], tort = null;
        p.rows.forEach(function (r) {
            if (r.tie === 'n') {   // intermediate
                inter[r.name.toLowerCase()] = '(' + r.value + ')*(' + subst(r.formula, inter) + ')';
                if (r.name.toLowerCase() === 'tort') tort = r.value * (+r.formula || 1);
                return;
            }
            var why = '';
            if (r.minInc != null && (+r.minInc || +r.maxInc)) why = 'inclination range';
            else if (GYRO.test(r.formula)) why = 'gyro variable';
            else if (r.vec === 's') why = 'vector S = depth error for subsea well reference (Compass help) — not applied to land wells';
            else if (['e', 'i', 'a', 'l', 'x', 'y'].indexOf(r.vec) < 0) why = 'vector ' + r.vec.toUpperCase() + ' not supported';
            else if (['r', 's', 'w', 'g'].indexOf(r.tie) < 0) why = 'tie-on ' + r.tie.toUpperCase();
            if (why) { skipped.push({ name: r.name, vector: r.vec.toUpperCase(), tie: r.tie.toUpperCase(), value: r.value, why: why }); return; }
            if (r.vec === 'x' || r.vec === 'y') {
                var f = r.formula.replace(/\s/g, '').toLowerCase();
                var okX = r.vec === 'x' && (f === 'max(abs(daz)*sin(inc),tort*smd)' || f === 'max(abs(sin(daz))*sin(inc),tort*smd)'), okY = r.vec === 'y' && f === 'max(abs(din),tort*smd)';
                if (!okX && !okY) { skipped.push({ name: r.name, vector: r.vec.toUpperCase(), tie: r.tie.toUpperCase(), value: r.value, why: 'unrecognised XCL formula' }); return; }
                var code = okX ? 'XCLA' : 'XCLH';
                terms[code] = { code: code, desc: 'Compass ' + r.name + ' (XCL)', wtFn: code, type: 'Misc', magnitude: r.value, units: '-', prop: r.tie.toUpperCase(),
                    depthF: 0, inclF: 0, azimF: 0, singN: null, singE: null, singV: null, ipm: true };
                order.push(code); return;
            }
            var key = r.name.toUpperCase() + '|' + r.tie.toUpperCase();
            if (!terms[key]) { terms[key] = { code: r.name.toUpperCase(), desc: 'Compass ' + r.name, wtFn: r.name, type: 'Compass', magnitude: 1, units: '-', prop: r.tie.toUpperCase(),
                _D: [], _I: [], _A: [], _L: [], ipm: true }; order.push(key); }
            var F = '(' + (r.value * (UNIT[r.unit] || 1)) + ')*(' + subst(r.formula, inter) + ')';
            terms[key]['_' + (r.vec === 'e' ? 'D' : r.vec.toUpperCase())].push(F);
        });
        var codes = {};
        var out = order.map(function (k) {
            var t = terms[k]; if (t._D == null) return t;
            var sum = function (a) { return a.length ? a.join(' + ') : null; };
            var D = sum(t._D), I = sum(t._I), A = sum(t._A), L = sum(t._L);
            t.depthF = D || 0; t.inclF = I || 0;
            t.azimF = A && L ? '(' + A + ') + (' + L + ') / Sin(Inc)' : A ? A : L ? '(' + L + ') / Sin(Inc)' : 0;
            t.singN = t.singE = t.singV = null;
            if (L && !D && !A) {   // vertical: I along (cosA, sinA, 0), L along (-sinA, cosA, 0)
                t.singN = (I ? 'Cos(AzT)*(' + I + ')' : '0') + ' - Sin(AzT)*(' + L + ')';
                t.singE = (I ? 'Sin(AzT)*(' + I + ')' : '0') + ' + Cos(AzT)*(' + L + ')';
                t.singV = '0';
            }
            // same name with different tie-on: keep both, make the code unique
            if (codes[t.code]) t.code = t.code + '_' + t.prop; codes[t.code] = true;
            delete t._D; delete t._I; delete t._A; delete t._L;
            return t;
        });
        var name = 'IPM: ' + (p.meta.ShortName || opts.fileName || 'Compass tool');
        return { name: name, description: p.meta.Description || '', terms: out, skipped: skipped, xclTortuosity: tort, meta: p.meta };
    }
    return { parse: parse, convert: convert };
}));

/*
 * motorYield.js — ADDED 2026-11-14 (John): Motor Yield (MY) per slide for the Slide Sheet tables
 * (views/slideSheet.ejs and the Slide Sheet accordion in views/job.ejs). Browser + Node (UMD).
 *
 * DEFINITION (John, 2026-11-14): MY = interval DLS x course length / slid length, in deg/30 m
 *   = total curvature between the surveys that bracket the slide / footage slid between those surveys x 30.
 * SOURCES:
 *   - Pason "Slide Performance" sheet (VF_0041): "Motor Yield: Dogleg Severity / Percent Sliding"
 *     (DLS / (slid / course length) = DLS x CL / slid).
 *   - ISCWSA eBook V9.10 (2017) pp. 57-58: dogleg capability of the assembly from the curvature between
 *     surveys, assuming "the curvature all happens when sliding" (same assumption here: rotating build/walk
 *     is NOT removed). Same rule as public/js/ssaModel.js uses per BHA run.
 *   - Dogleg angle between surveys: minimum curvature (ISCWSA eBook App. D3, step 7):
 *     theta = acos(sinI1 sinI2 cos(A2-A1) + cosI1 cosI2).
 * IMPLEMENTATION CHOICES (stated, not from a source):
 *   - Bracket = last measured survey at or above the slide top .. first measured survey at or below the slide
 *     bottom. When the bracket spans several survey intervals, theta = SUM of their dogleg angles (total
 *     curvature, as in the SSA module) and slid = all slide footage of the same leg inside the bracket, so
 *     slides sharing the same bracket get the same MY.
 *   - Slides beyond the last survey or above the first one -> no MY (null). Survey interpolation stations
 *     (interp, e.g. SSA fill-ins) are not used. Hole depths of the slide sheet and survey MDs are both hole
 *     MD (no bit-to-sensor offset needed).
 *   - Only slides of the main bore (leg empty or 'Main') get MY; other legs have no survey of their own here.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MotorYield = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var D = Math.PI / 180;
    function dogleg(a, b) {   // degrees
        var c = Math.sin(a.inc * D) * Math.sin(b.inc * D) * Math.cos((b.az - a.az) * D) + Math.cos(a.inc * D) * Math.cos(b.inc * D);
        return Math.acos(Math.max(-1, Math.min(1, c))) / D;
    }
    // survey: [{md, inc, az, interp?}] ; slides: [{from, to, len?, leg?, mode?}] -> array of {my, theta, slid, cl, mdA, mdB} | null (same order)
    function compute(survey, slides) {
        var sv = (survey || []).filter(function (s) { return !s.interp && isFinite(s.md) && isFinite(s.inc) && isFinite(s.az); })
            .sort(function (a, b) { return a.md - b.md; });
        var main = function (x) { return !x.leg || x.leg === 'Main'; };
        var ok = (slides || []).filter(function (x) { return main(x) && (!x.mode || x.mode === 'slide'); });
        return (slides || []).map(function (x) {
            if (sv.length < 2 || !main(x) || (x.mode && x.mode !== 'slide') || !(x.to > x.from)) return null;
            var ia = -1, ib = -1;
            for (var i = 0; i < sv.length; i++) { if (sv[i].md <= x.from + 1e-6) ia = i; if (ib < 0 && sv[i].md >= x.to - 1e-6) ib = i; }
            if (ia < 0 || ib < 0 || ib <= ia) return null;
            var a = sv[ia].md, b = sv[ib].md, th = 0;
            for (var k = ia; k < ib; k++) th += dogleg(sv[k], sv[k + 1]);
            var slid = 0; ok.forEach(function (y) { slid += Math.max(0, Math.min(y.to, b) - Math.max(y.from, a)); });
            if (!(slid > 0)) return null;
            return { my: th / slid * 30, theta: th, slid: slid, cl: b - a, mdA: a, mdB: b };
        });
    }
    /*
     * ROTATION CORRECTION — ADDED 2026-11-14 (John). *** MTX CHOICE: NO PUBLISHED FORMULA FOUND. ***
     * (Innova Well Seeker shows a "Rot DLS" column, "dogleg seen while rotating", without a formula; Pason and the
     * ISCWSA eBook assume all curvature comes from sliding.) Method chosen:
     *   1. Rotary tendency per BHA run, from survey intervals of that run with NO sliding inside (main leg):
     *        build rate BR = sum(dInc) / sum(CL);  walk rate WR = sum(dAz) / sum(CL) over the intervals whose both
     *        surveys have Inc >= minIncWalk (azimuth ill-defined near vertical); dAz wrapped to +/-180.
     *      Used only when the run has >= minRotLen m of rotate-only course length (else flagged, no correction).
     *   2. Each slide bracket (same bracket as compute()): rotated length Lr = CL - slid;
     *        dInc_s = dInc - BR*Lr ; dAz_s = dAz - WR*Lr ;
     *        slide curvature = sqrt(dInc_s^2 + (dAz_s*sin(Imean))^2)   (small-angle dogleg, consistent with the eBook
     *        pp. 57-58 fill-in relations dInc = DLS*L*cosTF, dAz = DLS*L*sinTF/sinI); Imean = mean of the two Incs.
     *        MYcorr = slide curvature / slid x 30.
     *   3. Run averages: sum(curvature) / sum(slid) over the DISTINCT brackets of the run (a bracket counted once),
     *      for both MY and MYcorr. A bracket belongs to the run of its first slide.
     * 4. PER-SLIDE QUALITY RULES — ADDED 2026-11-14 (John; MTX choices). MY = DLS / slide% explodes when little was slid
     *    (e.g. 0.56 m slid in a 30 m interval gave 185 deg/30 m):
     *      - blank (status 'short') when the bracket's slid length < minSlid (default 3 m), or
     *      - blank (status 'lowpct') when slid / course length < minPct (default 20 %);
     *        the values are kept as myRaw / myCorrRaw and STILL count in the run averages (sum/sum is stable).
     *      - 'noisy' flag: sigma_MY = sqrt(2) x noiseInc x 30 / slid (two independent survey inclinations, noiseInc
     *        default 0.1 deg = ASSUMED typical MWD inclination noise, not from a cited source) > noiseFrac (default
     *        25 %) of MY -> shown greyed with the sigma in the tooltip.
     * runOf(md) -> run name (string) or '' ; opts {minRotLen (m, default 30), minIncWalk (deg, default 3)}.
     */
    function wrap(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
    function analyse(survey, slides, runOf, opts) {
        opts = opts || {};
        var minSlid = opts.minSlid != null ? opts.minSlid : 3, minPct = opts.minPct != null ? opts.minPct : 20,
            noiseInc = opts.noiseInc != null ? opts.noiseInc : 0.1, noiseFrac = opts.noiseFrac != null ? opts.noiseFrac : 0.25;
        var minRot = opts.minRotLen != null ? opts.minRotLen : 30, minIw = opts.minIncWalk != null ? opts.minIncWalk : 3;
        runOf = runOf || function () { return ''; };
        var sv = (survey || []).filter(function (s) { return !s.interp && isFinite(s.md) && isFinite(s.inc) && isFinite(s.az); })
            .sort(function (a, b) { return a.md - b.md; });
        var main = function (x) { return !x.leg || x.leg === 'Main'; };
        var sl = (slides || []).filter(function (x) { return main(x) && (!x.mode || x.mode === 'slide'); });
        var slidIn = function (a, b) { var t = 0; sl.forEach(function (y) { t += Math.max(0, Math.min(y.to, b) - Math.max(y.from, a)); }); return t; };
        // 1. rotary tendency per run
        var rot = {};
        for (var k = 0; k + 1 < sv.length; k++) {
            var A = sv[k], B = sv[k + 1], cl = B.md - A.md; if (!(cl > 0) || slidIn(A.md, B.md) > 1e-6) continue;
            var rn = runOf((A.md + B.md) / 2) || ''; var g = rot[rn] || (rot[rn] = { run: rn, len: 0, dInc: 0, n: 0, lenW: 0, dAz: 0 });
            g.len += cl; g.dInc += B.inc - A.inc; g.n++;
            if (A.inc >= minIw && B.inc >= minIw) { g.lenW += cl; g.dAz += wrap(B.az - A.az); }
        }
        Object.keys(rot).forEach(function (rn) { var g = rot[rn];
            g.ok = g.len >= minRot; g.br = g.len > 0 ? g.dInc / g.len : null; g.wr = g.lenW >= minRot ? g.dAz / g.lenW : (g.ok ? 0 : null);
            g.walkOk = g.lenW >= minRot; });
        // 2. per slide
        var base = compute(sv, slides), seen = {}, runs = {};
        var per = (slides || []).map(function (x, i) {
            var r = base[i]; if (!r) return null;
            var rn = runOf(x.from) || '', g = rot[rn], out = { my: r.my, myCorr: null, run: rn, flag: '', cl: r.cl, slid: r.slid, theta: r.theta, mdA: r.mdA, mdB: r.mdB };
            var A = null, B = null; sv.forEach(function (s) { if (s.md === r.mdA) A = s; if (s.md === r.mdB) B = s; });
            if (!g || !g.ok) out.flag = 'no rotate-only survey interval (>= ' + minRot + ' m) in this run';
            else {
                var Lr = Math.max(0, r.cl - r.slid), dI = (B.inc - A.inc) - g.br * Lr, dA = wrap(B.az - A.az) - g.wr * Lr, Im = (A.inc + B.inc) / 2 * D;
                out.curvCorr = Math.sqrt(dI * dI + Math.pow(dA * Math.sin(Im), 2)); out.myCorr = out.curvCorr / r.slid * 30;
                if (!g.walkOk) out.flag = 'build corrected only (walk: not enough rotate-only footage with Inc >= ' + minIw + '°)';
            }
            // 4. quality rules (display only; run averages below use every bracket)
            out.myRaw = out.my; out.myCorrRaw = out.myCorr; out.status = 'ok';
            out.sigma = Math.SQRT2 * noiseInc * 30 / r.slid; out.pct = 100 * r.slid / r.cl;
            if (r.slid < minSlid) { out.status = 'short'; out.reason = 'slid ' + r.slid.toFixed(2) + ' m between the bracketing surveys < ' + minSlid + ' m'; }
            else if (out.pct < minPct) { out.status = 'lowpct'; out.reason = 'slid ' + out.pct.toFixed(0) + ' % of the ' + r.cl.toFixed(1) + ' m survey interval < ' + minPct + ' %'; }
            if (out.status !== 'ok') { out.my = null; out.myCorr = null; }
            else if (out.sigma > noiseFrac * Math.abs(out.myRaw)) { out.noisy = true; out.reason = 'survey noise: ±' + out.sigma.toFixed(2) + ' °/30 m (±' + noiseInc + '° Inc per survey assumed) > ' + Math.round(noiseFrac * 100) + ' % of MY'; }
            var key = r.mdA + '|' + r.mdB;
            if (!seen[key]) { seen[key] = 1; var q = runs[rn] || (runs[rn] = { run: rn, theta: 0, slid: 0, thetaC: 0, slidC: 0, brackets: 0 });
                q.theta += r.theta; q.slid += r.slid; q.brackets++; if (out.curvCorr != null) { q.thetaC += out.curvCorr; q.slidC += r.slid; } }   // uses out.myCorrRaw path (curvCorr), not the blanked value
            return out;
        });
        Object.keys(runs).forEach(function (rn) { var q = runs[rn], g = rot[rn];
            q.myAvg = q.slid > 0 ? q.theta / q.slid * 30 : null; q.myCorrAvg = q.slidC > 0 ? q.thetaC / q.slidC * 30 : null;
            q.rotBuild = g && g.ok ? g.br * 30 : null; q.rotWalk = g && g.walkOk ? g.wr * 30 : null; q.rotLen = g ? g.len : 0; });
        Object.keys(rot).forEach(function (rn) { if (!runs[rn]) { var g = rot[rn]; runs[rn] = { run: rn, myAvg: null, myCorrAvg: null, brackets: 0, rotBuild: g.ok ? g.br * 30 : null, rotWalk: g.walkOk ? g.wr * 30 : null, rotLen: g.len }; } });
        return { slides: per, runs: runs, rot: rot };
    }
    return { compute: compute, analyse: analyse, dogleg: dogleg };
}));

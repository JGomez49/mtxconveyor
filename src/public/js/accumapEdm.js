/*
 * accumapEdm.js — ADDED 2026-11-27 (John): AccuMap well export (.xlsx rows) -> Compass EDM import file (.edm.xml).
 * Browser + Node (UMD). Used by views/accumapEdm.ejs (admin menu "AccuMap EDM Generator"). Port of the validated
 * Python test script (MTX AC/Offset 081-19W6 edm Compass export/accumap_to_edm.py).
 *
 * EDM CONVENTIONS (read from a real Compass export, 081-19W6.edm.xml, EDM 5000.18 — not assumed):
 *   - lengths in FEET; MD / TVD referenced to the system datum (Mean Sea Level): MD_edm = MD_from_KB - KB_elevation.
 *     Station 0 = tie-on at the KB (STATION_TYPE 1). DLS / build / turn in deg/100 ft. Map coordinates in feet.
 *   - CD_WELL.WATER_DEPTH = ground elevation (ft) for land wells; CD_DATUM.DATUM_ELEVATION = KB (ft).
 * INPUT: metres (AccuMap). Converted to feet only when the EDM is written (John, 2026-11-27).
 * GEODESY: datum read from the sheet title, only NAD27 accepted. UTM zone read per well ('Surface Hole UTM Zone').
 *   2026-11-28 (John): the zone is set PER PROJECT (every well in its correct zone): a reused project keeps its own GEO_ZONE_ID, a new
 *   project takes the zone of its wells (most common if they differ). Was: one zone for the whole file.
 *   Transverse Mercator on Clarke 1866: Snyder, "Map Projections — A Working Manual", USGS PP 1395 (1987), eq. 8-9..8-25
 *   (forward / inverse series). Grid convergence and point scale factor are evaluated numerically from the same forward
 *   projection (bearing / length of a 1e-6 deg step along the meridian). CHECKED against pyproj on Compass's own export:
 *   easting / northing, convergence 1.7696 deg and scale 0.999817 reproduced.
 * TRAJECTORY: minimum curvature (Bourgoyne et al., Applied Drilling Engineering, SPE 1986, ch. 8). AccuMap's TVD / NS / EW are
 *   only used to check (report). On the test file: median 0.012 m, max 0.88 m over 47 surveyed wellbores.
 * MAGNETICS (DP_MAGNETIC, needed by MWD toolcodes): IGRF-13 (= Compass "IGRF2020"), epoch 2020.0 + linear secular variation,
 *   spherical-harmonic synthesis to degree 13, geodetic (WGS84) -> geocentric conversion as in the IGRF reference code.
 *   Coefficients in public/data/igrf13.json.
 * GROUPING (John, 2026-11-27, test): Site = surface hole location; Well = licence; Wellbore = one per DISTINCT survey (repeated
 *   events merged, listed in the survey name). No survey points -> vertical 0 deg KB to TD with the 'vertical' toolcode
 *   (UNKNOWN by default). Wells missing KB, TD / survey or surface coordinates are skipped and reported.
 * NOT WRITTEN: covariances (Compass recomputes them from the toolcode), change history, binary data.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AccumapEdm = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var FT = 0.3048, D = Math.PI / 180;

    // ---------- Transverse Mercator (Snyder 1987), Clarke 1866 by default ----------
    function tm(a, invF, lon0) {
        var f = 1 / invF, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2), k0 = 0.9996, FE = 500000, FN = 0;
        var e4 = e2 * e2, e6 = e4 * e2;
        function M(phi) { return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi)); }
        function fwd(lonDeg, latDeg) {
            var phi = latDeg * D, lam = (lonDeg - lon0) * D, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
            var N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = lam * c;
            var x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120);
            var y = k0 * (M(phi) + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
            return [x + FE, y + FN];
        }
        function inv(x, y) {
            var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)), m = (y - FN) / k0, mu = m / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
            var p1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
            var s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1), C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), Dd = (x - FE) / (N1 * k0);
            var phi = p1 - (N1 * t / R1) * (Dd * Dd / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(Dd, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(Dd, 6) / 720);
            var lam = (Dd - (1 + 2 * T1 + C1) * Math.pow(Dd, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(Dd, 5) / 120) / c;
            return [lon0 + lam / D, phi / D];
        }
        // grid convergence (deg, true north -> grid north, + east of the central meridian in the north) and point scale factor
        function factors(lonDeg, latDeg) {
            var h = 1e-6, p = fwd(lonDeg, latDeg), q = fwd(lonDeg, latDeg + h);
            var phi = latDeg * D, s = Math.sin(phi), Mr = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
            var dx = q[0] - p[0], dy = q[1] - p[1];
            return { convergence: -Math.atan2(dx, dy) / D, scale: Math.sqrt(dx * dx + dy * dy) / (Mr * h * D) };
        }
        return { fwd: fwd, inv: inv, factors: factors };
    }
    function utmZoneProj(zone, ell) { return tm(ell.a, ell.invF, -183 + 6 * zone); }
    var CLARKE1866 = { a: 6378206.4, invF: 294.9786982 };

    // ---------- IGRF synthesis ----------
    function igrf(coef, lonDeg, latDeg, hKm, date) {
        var yr = date.getUTCFullYear() + (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / (365.25 * 864e5), dt = yr - coef.epoch, nmax = coef.nmax;
        var gv = function (n, m) { var c = coef.g[n + ',' + m]; return c ? c[0] + c[1] * dt : 0; }, hv = function (n, m) { var c = coef.h[n + ',' + m]; return c ? c[0] + c[1] * dt : 0; };
        // geodetic -> geocentric (WGS84, as in the IGRF reference code)
        var a = 6378.137, b = 6356.752314245, a2 = a * a, b2 = b * b, cl = Math.cos(latDeg * D), sl = Math.sin(latDeg * D);
        var rho = Math.sqrt(a2 * cl * cl + b2 * sl * sl), r = Math.sqrt(hKm * hKm + 2 * hKm * rho + (a2 * a2 * cl * cl + b2 * b2 * sl * sl) / (rho * rho));
        var cd = (hKm + rho) / r, sd = (a2 - b2) / rho * cl * sl / r;
        var ct = sl * cd - cl * sd, st = cl * cd + sl * sd;            // geocentric colatitude cos / sin
        var ph = lonDeg * D, Re = 6371.2;
        // Schmidt semi-normalised Legendre P[n][m] and dP/dtheta
        var P = [], dP = [], n, m;
        for (n = 0; n <= nmax; n++) { P.push(new Array(n + 1).fill(0)); dP.push(new Array(n + 1).fill(0)); }
        P[0][0] = 1; dP[0][0] = 0;
        for (n = 1; n <= nmax; n++) {
            for (m = 0; m <= n; m++) {
                if (n === m) {
                    var k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
                    P[n][m] = k * st * P[n - 1][m - 1]; dP[n][m] = k * (st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1]);
                } else {
                    var k1 = (2 * n - 1) / Math.sqrt(n * n - m * m), k2 = Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m));
                    P[n][m] = k1 * ct * P[n - 1][m] - (n > 1 && m <= n - 2 ? k2 * P[n - 2][m] : 0);
                    dP[n][m] = k1 * (ct * dP[n - 1][m] - st * P[n - 1][m]) - (n > 1 && m <= n - 2 ? k2 * dP[n - 2][m] : 0);
                }
            }
        }
        var Br = 0, Bt = 0, Bp = 0;
        for (n = 1; n <= nmax; n++) {
            var f = Math.pow(Re / r, n + 2);
            for (m = 0; m <= n; m++) {
                var cm = Math.cos(m * ph), sm = Math.sin(m * ph), G = gv(n, m), H = hv(n, m);
                Br += (n + 1) * f * (G * cm + H * sm) * P[n][m];
                Bt -= f * (G * cm + H * sm) * dP[n][m];
                Bp += f * m * (G * sm - H * cm) * P[n][m] / (st || 1e-12);
            }
        }
        var X = -Bt, Y = Bp, Z = -Br;                                   // geocentric north, east, down
        var Xg = X * cd + Z * sd, Zg = Z * cd - X * sd;                  // rotate to geodetic
        var Hh = Math.hypot(Xg, Y);
        return { declination: Math.atan2(Y, Xg) / D, dip: Math.atan2(Zg, Hh) / D, total: Math.sqrt(Hh * Hh + Zg * Zg) };
    }

    // ---------- minimum curvature ----------
    function mincurv(st) {
        var out = [[st[0][0], st[0][1], st[0][2], st[0][0], 0, 0, 0, 0, 0, 0]], tvd = st[0][0], n = 0, e = 0;
        for (var i = 1; i < st.length; i++) {
            var m1 = st[i - 1][0], i1 = st[i - 1][1], a1 = st[i - 1][2], m2 = st[i][0], i2 = st[i][1], a2 = st[i][2], dm = m2 - m1;
            if (!(dm > 0)) continue;
            var I1 = i1 * D, I2 = i2 * D, A1 = a1 * D, A2 = a2 * D;
            var c = Math.cos(I2 - I1) - Math.sin(I1) * Math.sin(I2) * (1 - Math.cos(A2 - A1)), b = Math.acos(Math.max(-1, Math.min(1, c)));
            var rf = b < 1e-9 ? 1 : 2 / b * Math.tan(b / 2);
            tvd += dm / 2 * (Math.cos(I1) + Math.cos(I2)) * rf; n += dm / 2 * (Math.sin(I1) * Math.cos(A1) + Math.sin(I2) * Math.cos(A2)) * rf; e += dm / 2 * (Math.sin(I1) * Math.sin(A1) + Math.sin(I2) * Math.sin(A2)) * rf;
            var da = ((a2 - a1 + 540) % 360) - 180;
            var tf = b > 1e-9 ? ((Math.atan2(da * Math.sin((I1 + I2) / 2), i2 - i1) / D) % 360 + 360) % 360 : 0;
            out.push([m2, i2, a2, tvd, n, e, b / D / dm * 30, (i2 - i1) / dm * 30, da / dm * 30, tf]);
        }
        return out;
    }

    // ---------- AccuMap reader (rows = array of arrays, e.g. SheetJS sheet_to_json(ws, {header:1})) ----------
    function num(v) { if (v === null || v === undefined || v === '') return null; var x = Number(v); return isFinite(x) ? x : null; }
    function readAccumap(rows) {
        var title = (rows[0] || []).filter(Boolean).join(' '), mm = /Datum:\s*([A-Za-z0-9]+)/.exec(title), datum = mm ? mm[1].toUpperCase() : null;
        var hi = -1; for (var i = 0; i < Math.min(10, rows.length); i++) if ((rows[i] || []).some(function (c) { return c && /UWI/.test(String(c)); })) { hi = i; break; }
        if (hi < 0) throw new Error('Header row with "UWI" not found — is this an AccuMap well export?');
        var H = rows[hi].map(function (c) { return String(c || '').replace(/\s+/g, ' ').trim().toLowerCase(); });
        function col() { var keys = Array.prototype.slice.call(arguments); for (var j = 0; j < H.length; j++) if (keys.every(function (k) { return H[j].indexOf(k) >= 0; })) return j; throw new Error('Column not found: ' + keys.join(' ')); }
        // 2026-11-28 (John): 'license number' — plain 'license' matched 'Current Licensee' (the company) first, so wells were grouped by
        // surface hole + company instead of by licence, and the licence shown was the company name. Status = the exact 'Status' column.
        var C = { lic: col('license number'), sh: col('surface hole location'), shn: col('surface hole utm northing'), she: col('surface hole utm easting'), zone: col('utm zone'), name: col('well name'),
            kb: col('kb elevation'), gl: col('ground elevation'), uwi: col('uwi'), md: col('md'), inc: col('inclination'), az: col('azimuth'), tvd: col('tvd'), ns: col('ns (m)'), ew: col('ew (m)'),
            td: col('total depth'), holder: col('current licensee'), status: H.indexOf('status') };
        var wells = [], byU = {};
        for (i = hi + 1; i < rows.length; i++) {
            var r = rows[i]; if (!r || !r[C.uwi]) continue;
            var u = String(r[C.uwi]).trim(), w = byU[u];
            if (!w) { w = byU[u] = { uwi: u, lic: String(r[C.lic] || '').trim(), sh: String(r[C.sh] || '').trim(), name: String(r[C.name] || '').trim(), shn: num(r[C.shn]), she: num(r[C.she]), zone: num(r[C.zone]),
                kb: num(r[C.kb]), gl: num(r[C.gl]), td: num(r[C.td]), holder: String(r[C.holder] || ''), status: C.status >= 0 ? String(r[C.status] || '').trim() : '', pts: {} }; wells.push(w); }
            var md = num(r[C.md]);
            if (md !== null) w.pts[md] = [md, num(r[C.inc]) || 0, num(r[C.az]) || 0, num(r[C.tvd]), num(r[C.ns]), num(r[C.ew])];
        }
        wells.forEach(function (w) { w.pts = Object.keys(w.pts).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return w.pts[k]; }); });
        return { datum: datum, wells: wells };
    }

    // ---------- selection (distinct surveys, skips) ----------
    function plan(wells) {
        var keep = [], seen = {}, skipped = [], merged = [];
        wells.forEach(function (w) {
            if (w.kb === null || (!w.pts.length && w.td === null) || w.shn === null || w.she === null || !w.zone) { skipped.push({ uwi: w.uwi, why: 'missing KB, TD / survey or surface coordinates' }); return; }
            var key = w.lic + '|' + (w.pts.length ? w.pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(3) + ',' + p[2].toFixed(3); }).join(';') : 'vertical|' + w.td);
            if (seen[key]) { seen[key].events.push(w.uwi); merged.push({ into: seen[key].uwi, uwi: w.uwi }); return; }
            w.events = []; w.vertical = !w.pts.length; seen[key] = w; keep.push(w);
        });
        // 2026-11-28 (John): a merged wellbore is NAMED after its LATEST event (e.g. .../00 and .../02 with the same survey -> '.../02').
        // Event sequence = the code after the last '/' of the UWI (AER "UWI Description": chronological order of drilling / completion
        // operations, 0 then 2-9). The other UWIs stay listed in w.events. Was: named after the first one in the file.
        var ev = function (u) { var m = /\/(\d+)\s*$/.exec(u); return m ? Number(m[1]) : -1; };
        keep.forEach(function (w) {
            if (!w.events.length) return;
            var all = [w.uwi].concat(w.events).sort(function (a, b) { return ev(a) - ev(b); }), latest = all[all.length - 1];
            w.uwi = latest; w.events = all.slice(0, -1);
        });
        merged = []; keep.forEach(function (w) { w.events.forEach(function (e) { merged.push({ into: w.uwi, uwi: e }); }); });
        return { wellbores: keep, skipped: skipped, merged: merged };
    }

    // ---------- EDM writer ----------
    var ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    function makeId() { var used = {}; return function (n) { for (;;) { var s = ''; for (var i = 0; i < n; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)]; if (!used[s]) { used[s] = 1; return s; } } }; }
    function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;'); }
    function el(tag, o) { return '<' + tag + ' ' + Object.keys(o).map(function (k) { return k + '="' + esc(o[k]) + '"'; }).join(' ') + ' />'; }
    function fx(x) { var s = String(Number(x)); return /[.eE]/.test(s) ? s : s + '.0'; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ts(d) { return "{ts '" + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + "'}"; }
    function lsdName(sh) { var m = /^\d(\w\w)(\d\d)(\d\d)(\d{3})(\d\d)W(\d)/.exec(sh); return m ? m[2] + '-' + m[3] + '-' + m[4] + '-' + m[5] + 'W' + m[6] : sh; }

    /*
     * 2026-11-28 (John): parseCompanyExport(xmlText) -> template from an EXISTING Compass company (an .edm.xml exported from that
     * company, e.g. 'Accumap.edm.xml'). Compass links projects to their company by POLICY_ID (not by name), so to import under an
     * existing company the file must reuse that company's POLICY_ID, survey-tool ids, tool terms and AC rules exactly as exported.
     * Its existing projects are returned too, so a project with the same name (e.g. '016-14W4') is reused instead of duplicated.
     */
    function parseAttrs(tag) { var o = {}, re = /([A-Za-z_][\w]*)="([^"]*)"/g, m; while ((m = re.exec(tag))) o[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&amp;/g, '&'); return o; }
    function records(xml, name) { var re = new RegExp('<' + name + '\\s[^>]*?/>', 'g'), out = [], m; while ((m = re.exec(xml))) out.push(parseAttrs(m[0])); return out; }
    function parseCompanyExport(xml) {
        var pol = records(xml, 'CD_POLICY');
        if (pol.length !== 1) throw new Error('The company export must contain exactly one company (found ' + pol.length + ').');
        var first = function (n) { var r = records(xml, n); return r[0]; };
        var t = { keepIds: true, geoSystem: first('CD_GEO_SYSTEM'), geoDatum: first('CD_GEO_DATUM'), geoEllipsoid: first('CD_GEO_ELLIPSOID'), tightGroup: first('MD_SITE_TIGHT_GROUP'),
            policy: pol[0], tools: records(xml, 'CD_SURVEY_TOOL'), terms: records(xml, 'DP_TOOL_TERM'), acRules: records(xml, 'DP_ACRULE'), projects: records(xml, 'CD_PROJECT') };
        if (!t.tools.length) throw new Error('No survey tools in the company export.');
        if (!t.geoSystem || !t.geoDatum || !t.geoEllipsoid || !t.tightGroup) throw new Error('Geodetic / tight-group records missing in the company export.');
        return t;
    }

    /*
     * build(accumapRows, { project, tpl, igrf, toolFor: function(wellbore) -> tool name, user, date }) -> { xml, report }
     */
    function build(rows, opt) {
        var now = opt.date || new Date(), TS = ts(now), user = opt.user || 'MTX', rid = makeId(), tpl = opt.tpl;
        var R = readAccumap(rows), rep = { datum: R.datum, check: [], vertical_added: [], surface_azimuth_assumed: [] };
        if (R.datum !== 'NAD27') throw new Error('Datum in the AccuMap file is "' + R.datum + '" — only NAD27 is accepted.');
        var P = plan(R.wells); rep.skipped = P.skipped; rep.merged = P.merged;
        if (!P.wellbores.length) throw new Error('No usable wells in the file.');
        var zc = {}; P.wellbores.forEach(function (w) { zc[w.zone] = (zc[w.zone] || 0) + 1; w.prj = lsdName(w.sh).slice(-8); }); rep.zones = zc;
        var projs = {}, proj = function (z) { return projs[z] || (projs[z] = utmZoneProj(Number(z), CLARKE1866)); };
        // zone per project: existing project in the company export -> its own zone; new project -> zone of its wells (most common)
        var existing = {}; (tpl.projects || []).forEach(function (p) { existing[p.PROJECT_NAME] = p; });
        var pz = {}, pzc = {};
        P.wellbores.forEach(function (w) { var c = pzc[w.prj] || (pzc[w.prj] = {}); c[w.zone] = (c[w.zone] || 0) + 1; });
        Object.keys(pzc).forEach(function (n) {
            var m = existing[n] && /^UTM-(\d+)N$/.exec(existing[n].GEO_ZONE_ID || '');
            pz[n] = m ? Number(m[1]) : Number(Object.keys(pzc[n]).sort(function (a, b) { return pzc[n][b] - pzc[n][a]; })[0]);
        });
        function zoneRec(z) { var l0 = -183 + 6 * z; return el('CD_GEO_ZONE', { GEO_SYSTEM_ID: tpl.geoSystem.GEO_SYSTEM_ID, GEO_ZONE_ID: 'UTM-' + z + 'N', ZONE_NAME: 'Zone ' + z + 'N (' + (-(l0 - 3)) + ' W to ' + (-(l0 + 3)) + ' W)', LAT_ORIGIN: '0.0', LON_ORIGIN: fx(l0),
                STANDARD_LAT0: '0.0', SCALE_FACTOR: '0.9996', STANDARD_LAT1: '0.0', STANDARD_LON0: '0.0', STANDARD_LAT2: '0.0', STANDARD_LON1: '0.0', FALSE_EASTING: '500000.0', FALSE_NORTHING: '0.0', RADIUS_SPHERE: '0.0',
                SKEW_AZIMUTH0: '0.0', SKEW_AZIMUTH1: '0.0', PROJ_TYPE: '0.0' }); }
        var zonesUsed = {}; Object.keys(pz).forEach(function (n) { zonesUsed[pz[n]] = 1; });
        var keep = !!tpl.keepIds, POL = keep ? tpl.policy.POLICY_ID : rid(10), toolId = {}, toolByName = {};
        tpl.tools.forEach(function (t) { toolId[t.SURVEY_TOOL_ID] = keep ? t.SURVEY_TOOL_ID : rid(5); toolByName[t.TOOL_NAME] = toolId[t.SURVEY_TOOL_ID]; });
        var stamp = { CREATE_DATE: TS, CREATE_USER_ID: user, CREATE_APP_ID: 'MTX', UPDATE_DATE: TS, UPDATE_USER_ID: user, UPDATE_APP_ID: 'MTX' };
        function S(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = o[k]; }); Object.keys(stamp).forEach(function (k) { r[k] = stamp[k]; }); return r; }
        var TG = tpl.tightGroup.TIGHT_GROUP_ID;
        var out = ['<?xml version="1.0" standalone="no"?>', '<?DataServices DB_Major_Version=18;DB_Minor_Version=00;DB_Build_Version=000;DB_Version=EDM 5000.18.0 (18.00.00.000);expandPoint=CD_POLICY;?>', '', '<export>', '<TOPLEVEL>',
            el('CD_GEO_SYSTEM', tpl.geoSystem)].concat(Object.keys(zonesUsed).sort().map(function (z) { return zoneRec(Number(z)); }), [
            el('CD_GEO_DATUM', tpl.geoDatum), el('CD_GEO_ELLIPSOID', tpl.geoEllipsoid), '</TOPLEVEL>', el('MD_SITE_TIGHT_GROUP', tpl.tightGroup)]);
        // Compass "Company" = CD_POLICY. Existing company (export loaded): its own record and ids, unchanged. New company: the built-in
        // template with new ids, named opt.company (default 'Accumap'; 2026-11-28 — was project name + ' policy').
        var pol = {}; Object.keys(tpl.policy).forEach(function (k) { pol[k] = tpl.policy[k]; });
        if (keep) out.push(el('CD_POLICY', pol)); else { pol.POLICY_ID = POL; pol.CUSTOMER_NAME = opt.company || 'Accumap'; out.push(el('CD_POLICY', S(pol))); }
        tpl.tools.forEach(function (t) { out.push(el('CD_SURVEY_TOOL', Object.assign({}, t, { POLICY_ID: POL, SURVEY_TOOL_ID: toolId[t.SURVEY_TOOL_ID] }))); });
        tpl.terms.forEach(function (t) { out.push(el('DP_TOOL_TERM', Object.assign({}, t, { POLICY_ID: POL, SURVEY_TOOL_ID: toolId[t.SURVEY_TOOL_ID], TOOL_TERM_ID: keep ? t.TOOL_TERM_ID : rid(5) }))); });
        tpl.acRules.forEach(function (t) { out.push(el('DP_ACRULE', Object.assign({}, t, { POLICY_ID: POL, ACRULE_ID: keep ? t.ACRULE_ID : rid(5) }))); });
        // 2026-11-28 (John): PROJECTS = township-range-meridian of each surface hole (last 8 characters of the site name, e.g. 016-14W4).
        // A project with the same name in the loaded company export is reused (its id); otherwise a new project is written.
        var projIds = {}, projRows = [];
        function projectFor(name) {
            if (projIds[name]) return projIds[name];
            var ex = existing[name];
            if (ex) { projIds[name] = ex.PROJECT_ID; projRows.push(el('CD_PROJECT', ex)); return ex.PROJECT_ID; }
            var id = rid(10); projIds[name] = id;
            projRows.push(el('CD_PROJECT', S({ PROJECT_ID: id, POLICY_ID: POL, GEO_SYSTEM_ID: tpl.geoSystem.GEO_SYSTEM_ID, GEO_ZONE_ID: 'UTM-' + pz[name] + 'N', GEO_DATUM_ID: tpl.geoDatum.GEO_DATUM_ID, PROJECT_NAME: name,
                DEF_MAG_MODEL: 'IGRF2020', LOCAL_COORD_ORIGIN: '0.0', USE_LOCAL_SCALE_FACTOR: '0.0', VERTICAL_COORD_ORIGIN: '0.0', SYSTEM_DATUM_DESC: 'Mean Sea Level', SYSTEM_DATUM_OFFSET: '0.0', IS_READONLY: 'N',
                TIGHT_GROUP_ID: TG, ACTIVE_UI_UNITSYS_ID: '2.0' })));
            return id;
        }

        var sites = {}, wellsByLic = {}, B = { site: [], well: [], wb: [], hdr: [], st: [], mag: [], scn: [], dsh: [], vs: [], prog: [], dst: [], dat: [] };
        P.wellbores.forEach(function (w) {
            var PZ = proj(pz[w.prj]), ll = proj(w.zone).inv(w.she, w.shn), lon = ll[0], lat = ll[1], xy = PZ.fwd(lon, lat), x = xy[0], y = xy[1], fac = PZ.factors(lon, lat);
            if (!sites[w.sh]) {
                sites[w.sh] = rid(10);
                var lsd = lsdName(w.sh), prjName = w.prj;   // 2026-11-28: site 'Offset 01-03-016-14W4' in project '016-14W4'
                B.site.push(el('CD_SITE', S({ SITE_ID: sites[w.sh], PROJECT_ID: projectFor(prjName), TIGHT_GROUP_ID: TG, NORTH_TYPE: '0.0', SITE_NAME: 'Offset ' + lsd, CONVERGENCE: fx(fac.convergence), TOP_BOREHOLE_RADIUS: '0.0',
                    IS_FIELD_CENTER: 'N', IS_READONLY: 'N', LATERAL_ERROR: '0.0', COORD_TYPE: '1.0', GEO_LATITUDE: fx(lat), FORESIGHT_ERROR: '0.0', GEO_LONGITUDE: fx(lon), GEO_MAP_EASTING: fx(x / FT),
                    GEO_MAP_NORTHING: fx(y / FT), SCALE_FACTOR: fx(fac.scale), GEO_OFFSET_EAST_LEASE_LINE: '0.0', GEO_OFFSET_NORTH_LEASE_LINE: '0.0' })));
            }
            var wk = w.sh + '|' + w.lic, KB = w.kb, GL = w.gl !== null ? w.gl : KB;
            if (!wellsByLic[wk]) {
                wellsByLic[wk] = { wid: rid(10), did: rid(5) };
                B.well.push(el('CD_WELL', S({ WELL_ID: wellsByLic[wk].wid, SITE_ID: sites[w.sh], TIGHT_GROUP_ID: TG, ACTIVE_UI_UNITSYS_ID: '2.0', COORD_TYPE: '1.0', GEO_LATITUDE: fx(lat), GEO_LONGITUDE: fx(lon),
                    GEO_OFFSET_EAST: fx(x / FT), GEO_OFFSET_NORTH: fx(y / FT), IS_SUBSEA: 'N', WELL_COMMON_NAME: w.name, WELL_DESC: 'Accumap',   /* 2026-11-28: well name only (was name + licence holder); WELL_DESC = Compass well "Description" (field confirmed from a Compass export) */ IS_READONLY: 'N', SLOT_EW: '0.0', SLOT_NS: '0.0',
                    SLOT_RADIAL_ERROR: '0.0', WATER_DEPTH: fx(GL / FT), CONVERGENCE: fx(fac.convergence), SCALE_FACTOR: fx(fac.scale) })));
                B.dat.push(el('CD_DATUM', S({ DATUM_ID: wellsByLic[wk].did, WELL_ID: wellsByLic[wk].wid, DATUM_ELEVATION: fx(KB / FT), DATE_ESTABLISHED: TS, DATUM_NAME: 'KB', IS_DEFAULT: 'Y' })));
            }
            var wid = wellsByLic[wk].wid, did = wellsByLic[wk].did, st;
            if (w.vertical) { st = [[0, 0, 0], [w.td, 0, 0]]; rep.vertical_added.push(w.uwi); }
            else {
                // keep the survey's own MD 0 station (slant-rig wells start at 40-47 deg at surface); add a vertical KB tie-on only when it starts deeper
                st = w.pts.filter(function (p) { return p[0] >= 0; }).map(function (p) { return [p[0], p[1], p[2]]; });
                if (st[0][0] > 0) st.unshift([0, 0, 0]);
                // inclined surface station with a blank (0) azimuth: use the next station's azimuth (what AccuMap's own NS / EW imply)
                if (st.length > 1 && st[0][1] > 0 && st[0][2] === 0 && st[1][2] !== 0) { st[0] = [st[0][0], st[0][1], st[1][2]]; rep.surface_azimuth_assumed.push(w.uwi); }
            }
            var glm = KB - GL;   // ground-level station: Inc / Azi interpolated in MD between the stations around it
            if (glm > 0 && st.every(function (q) { return Math.abs(q[0] - glm) > 1e-6; })) {
                for (var k = 1; k < st.length; k++) if (st[k][0] > glm) { var u = st[k - 1], v = st[k], fr = (glm - u[0]) / (v[0] - u[0]); st.splice(k, 0, [glm, u[1] + (v[1] - u[1]) * fr, ((u[2] + ((((v[2] - u[2]) + 540) % 360) - 180) * fr) % 360 + 360) % 360]); break; }
            }
            var traj = mincurv(st), last = traj[traj.length - 1];
            if (!w.vertical) {
                var dev = 0, at = null, tm2 = {}; traj.forEach(function (r) { tm2[r[0].toFixed(3)] = r; });
                w.pts.forEach(function (p) { var r = tm2[p[0].toFixed(3)]; if (!r || p[3] === null) return; var d = Math.sqrt(Math.pow(r[3] - p[3], 2) + Math.pow(r[4] - (p[4] || 0), 2) + Math.pow(r[5] - (p[5] || 0), 2)); if (d > dev) { dev = d; at = p[0]; } });
                rep.check.push({ uwi: w.uwi, stations: w.pts.length, max_3d_diff_m: Math.round(dev * 1000) / 1000, at_md: at, td_m: last[0], tvd_m: Math.round(last[3] * 100) / 100 });
            }
            var toolName = opt.toolFor ? opt.toolFor(w) : (w.vertical ? 'UNKNOWN' : 'MWD+IGRF');
            if (!toolByName[toolName]) throw new Error('Toolcode "' + toolName + '" is not in the template.');
            var tool = toolByName[toolName], wbid = rid(10), shId = rid(5), dshId = rid(5), mdmax = (last[0] - KB) / FT, tvdmax = (last[3] - KB) / FT;
            var bll = PZ.inv(x + last[5], y + last[4]), desc = w.events.length ? '; events: ' + w.events.join(', ') : '';
            w.toolName = toolName;
            B.wb.push(el('CD_WELLBORE', S({ WELL_ID: wid, WELLBORE_ID: wbid, BH_MD: fx(mdmax), BH_TVD: fx(tvdmax), IS_DEVIATED: w.vertical ? 'N' : 'Y', GEO_OFFSET_EAST_BH: fx((x + last[5]) / FT), GEO_OFFSET_NORTH_BH: fx((y + last[4]) / FT),
                GEO_LATITUDE_BH: fx(bll[1]), GEO_LONGITUDE_BH: fx(bll[0]), GEO_OFFSET_EAST_KO: fx(x / FT), GEO_OFFSET_NORTH_KO: fx(y / FT), GEO_LATITUDE_KO: fx(lat), KO_MD: fx(-KB / FT), KO_TVD: fx(-KB / FT),
                GEO_LONGITUDE_KO: fx(lon), WELLBORE_NAME: w.uwi, IS_READONLY: 'N' })));
            B.hdr.push(el('CD_SURVEY_HEADER', S({ WELL_ID: wid, WELLBORE_ID: wbid, SURVEY_HEADER_ID: shId, SURVEY_TYPE: '100.0', PHASE: 'ACTUAL', SURVEY_TOOL_ID: tool, POLICY_ID: POL, COMPANY: w.holder.slice(0, 30), ENGINEER: 'AccuMap',
                DEFINITIVE_PLAN: '0.0', HEADER_DATE: TS, SURVEY_NAME: 'wl ' + w.lic,   /* 2026-11-28: "wl <licence>" like the CNRL convention (was 'AccuMap' + merged events) */ TIE_ON_TYPE: '1.0', MD_MIN: fx(-GL / FT), MD_MAX: fx(mdmax), TIE_ON_DEPTH: fx(-KB / FT),
                IS_READONLY: 'N', PROCESSING_OPTION: '0.0' })));
            traj.forEach(function (r, i) {
                var md = (r[0] - KB) / FT, tvd = (r[3] - KB) / FT, k = 100 * FT / 30;   // deg/30 m -> deg/100 ft
                B.st.push(el('CD_SURVEY_STATION', { WELL_ID: wid, WELLBORE_ID: wbid, SURVEY_HEADER_ID: shId, SURVEY_ID: rid(5), AZIMUTH: fx(r[2]), SURVEY_DATE: TS, OFFSET_EAST: fx(r[5] / FT), OFFSET_NORTH: fx(r[4] / FT),
                    INCLINATION: fx(r[1]), BUILD_RATE: fx(r[7] * k), MD: fx(md), TVD: fx(tvd), SEQUENCE_NO: fx(i), DOGLEG_SEVERITY: fx(r[6] * k), TOOL_FACE_ANGLE: fx(r[9]), STATION_TYPE: i === 0 ? '1.0' : '0.0', TURN_RATE: fx(r[8] * k) }));
                B.dst.push(el('CD_DEFINITIVE_SURVEY_STATION', { WELL_ID: wid, WELLBORE_ID: wbid, DEF_SURVEY_HEADER_ID: dshId, DEFINITIVE_SURVEY_ID: rid(5), AZIMUTH: fx(r[2]), OFFSET_EAST: fx(r[5] / FT), OFFSET_NORTH: fx(r[4] / FT),
                    SEQUENCE_NO: fx(i), DATA_ENTRY_MODE: '0', DOGLEG_SEVERITY: fx(r[6] * k), INCLINATION: fx(r[1]), MD: fx(md), CASING_RADIUS: '0.0', TVD: fx(tvd) }));
            });
            var mg = igrf(opt.igrf, lon, lat, (GL || 0) / 1000, now), day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            B.mag.push(el('DP_MAGNETIC', { WELL_ID: wid, WELLBORE_ID: wbid, MAGNETIC_MODEL_ID: rid(5), SEQUENCE_NO: '0.0', DECLINATION: fx(mg.declination), DECLINATION_DATE: ts(day), DIP_ANGLE: fx(mg.dip), FIELD_STRENGTH: fx(mg.total), MODEL_NAME: 'IGRF2020' }));
            B.scn.push(el('CD_SCENARIO', S({ WELL_ID: wid, WELLBORE_ID: wbid, SCENARIO_ID: rid(5), PHASE: 'ACTUAL', DATUM_ID: did, NAME: w.status || 'Actual',   /* 2026-11-28: Compass "Design" = AccuMap Status (was 'AccuMap as drilled') */ VERSION: '1.0', DEF_SURVEY_HEADER_ID: dshId, IS_READONLY: 'N' })));
            B.dsh.push(el('CD_DEFINITIVE_SURVEY_HEADER', S({ WELL_ID: wid, WELLBORE_ID: wbid, DEF_SURVEY_HEADER_ID: dshId, PHASE: 'ACTUAL', EFFECTIVE_DATE: ts(day), B_RANGE: 'Y', BH_MD: fx(mdmax), BH_TVD: fx(tvdmax), NAME: 'Wellpath',
                PLANNED_AZIMUTH: '0.0', FINAL_EAST: fx(last[5] / FT), IS_READONLY: 'N', FINAL_NORTH: fx(last[4] / FT), TORTUOSITY_PERIOD: '100.0', TORTUOSITY_TYPE: '3.0', IS_DEFINITIVE: 'Y', KO_MD: fx(-KB / FT), KO_TVD: fx(-KB / FT),
                VS_EAST: '0.0', VS_NORTH: '0.0', USE_PLANNED_PROGRAM: 'N', USE_ACTUAL_DATA: 'N' })));
            B.vs.push(el('CD_VERTICAL_SECTION', { WELL_ID: wid, WELLBORE_ID: wbid, SEQUENCE_NO: '0.0', DEF_SURVEY_HEADER_ID: dshId, VERTICAL_SECTION_ID: rid(5), TVD_START: fx(-KB / FT), VSA_TYPE: '0.0', VS_ANGLE: '0.0', VS_NORTH: '0.0', VS_EAST: '0.0', VSO_TYPE: '0.0' }));
            B.prog.push(el('CD_SURVEY_PROGRAM', { WELL_ID: wid, WELLBORE_ID: wbid, DEF_SURVEY_HEADER_ID: dshId, SURVEY_PROGRAM_ID: rid(5), TIE_WELLBORE_ID: wbid, POLICY_ID: POL, SURVEY_HEADER_ID: shId, SURVEY_TOOL_ID: tool,
                MD_BASE: fx(mdmax), MD_TOP: fx(-GL / FT), SEQUENCE_NO: '0.0', NOT_IN_USE: '0.0', OVERRIDE: '0.0', DEPTH_INTERVAL: '0.0', IS_SAME_TOOL: '0', BASE_DEPTH_TYPE: '0.0', TOP_DEPTH_TYPE: '0.0' }));
        });
        // same record order as the Compass export (CD_WELL_ALL = CD_WELL)
        out = out.concat(projRows, B.site, B.well.map(function (s) { return s.replace('<CD_WELL ', '<CD_WELL_ALL '); }), B.well, B.wb, B.hdr, B.st, B.mag, B.scn, B.dsh, B.vs, B.prog, B.dst, B.dat,
            ['<ALWAYS-UPDATE>', '</ALWAYS-UPDATE>', '<LINKTABLE>', '</LINKTABLE>', '<BINARY_DATA data_encoding="base64">', '</BINARY_DATA>', '</export>', '']);
        rep.project_zone = Object.keys(zonesUsed).map(function (z) { return 'UTM-' + z + 'N'; }).join(', '); rep.projects = Object.keys(projIds).map(function (n) { return { name: n, reused: !!existing[n], zone: 'UTM-' + pz[n] + 'N' }; }); rep.company = keep ? tpl.policy.CUSTOMER_NAME : (opt.company || 'Accumap'); rep.companyExisting = keep; rep.sites = B.site.length; rep.wells = B.well.length; rep.wellbores = P.wellbores.length; rep.stations = B.st.length;
        rep.wellboreList = P.wellbores.map(function (w) { return { uwi: w.uwi, name: w.name, vertical: w.vertical, tool: w.toolName, events: w.events }; });
        return { xml: out.join('\r\n'), report: rep };
    }

    return { parseCompanyExport: parseCompanyExport, lsdName: lsdName, readAccumap: readAccumap, plan: plan, build: build, mincurv: mincurv, igrf: igrf, tm: tm, utmZoneProj: utmZoneProj, CLARKE1866: CLARKE1866 };
}));

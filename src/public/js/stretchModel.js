/*
 * stretchModel.js — PipeStretch engine for MTX Conveyor (browser + Node).
 * Added 2026-10-25 (John: "PipeStretch", mechanical + thermal, shown
 * separately and as total; two models; user-selected load case; gradient +
 * surface temperature).
 *
 * MODEL "SurQC" — port of SurQC's stretch correction (SurveyQc C# source,
 * 2015 tree: DrillString/DrillString.cs, DrillStringElementWithStretch.cs,
 * DrillStringElementsExtensions.cs, DrillStringWithStretch.cs,
 * Surveys/SurveyStationsExtensions.cs + InterpolatedSurveyStation.cs,
 * Analysis/MeasuredDepthCorrection.cs, Helpers/LinearInterpolation.cs).
 *   - Survey positions by minimum curvature; the string is cut into 1 m
 *     elements at interpolated stations (circular-arc interpolation).
 *   - Elements above (last survey MD - BHA length) are drill pipe (one
 *     ID/OD), below are BHA (averaged mass and area over the BHA length).
 *   - Element mass = steel volume x (7700 - mud density) (buoyed, kg).
 *   - Tension built from the bottom (0 at the bit) upward:
 *       along = m g cos(Iavg), side = m g sin(Iavg),
 *       thrust = -2 T_below sin(0.5 * 0.5 (I_above - I)),
 *       drag = 0.25 |thrust - side|,  T = T_below + along + drag
 *     (SurQC adds drag = pulling out of hole; this port also offers
 *     'static' (no drag) and 'runIn' (drag subtracted) — documented options,
 *     the formula is otherwise unchanged).
 *   - Mechanical stretch per element = T / (A E), E = 210 GPa;
 *     thermal per element = 12e-6 /degC x gradient x TVD (element length 1 m).
 *   - MD correction at a survey MD = cumulative stretch from the top,
 *     straight line through the two nearest 1 m points.
 *   SurQC quirks kept on purpose (port "as is"): one tension profile for the
 *   bit at the LAST survey MD applied to every station; thrust uses a quarter
 *   of the inclination change and no azimuth; the BHA bottom is placed at the
 *   last survey MD (sensor offset ignored); a final partial element still
 *   counts as 1 m; material is always steel.
 *
 * MODEL "T&D" — tension from MTX's own soft-string model (public/js/tdModel.js,
 * Johancsik et al. 1984, SPE-11380; the same code as the Torque & Drag
 * modeler: azimuth, casing/open-hole friction factors, per-component string).
 *   - Per survey station the string is solved with the bit at
 *     station MD + sensor offset (the tension at the moment that survey was
 *     taken), for the chosen load case.
 *   - Mechanical stretch above the station = integral of F/(E A) dMD
 *     (trapezoid between the 10 m T&D nodes), A from each component's OD/ID,
 *     F = effective tension (buoyancy-factor method, as the T&D modeler).
 *   - Thermal: ISCWSA eBook ch.15 (Bolt): correction = coeff x length x
 *     (mean temperature - calibration temperature); here integrated along the
 *     string with T(x) = T_surface + gradient x TVD(x):
 *       dL_th = alpha * integral_0^MD (T(x) - T_cal) dMD
 *     (reduces to SurQC's alpha*G*TVD per metre when T_cal = T_surface).
 *   - alpha default 12e-6 /degC (SurQC's value; the eBook quotes 1.3 m per
 *     1000 m per 100 degC = 13e-6 and 8.6e-6 /degF = 15.5e-6 /degC) — user input.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./tdModel.js'));
    else root.StretchModel = factory(root.TDModelCore);
}(typeof self !== 'undefined' ? self : this, function (TD) {
    'use strict';
    const D = Math.PI / 180;
    // SurQC constants (Weights/MaterialProperties.cs, DrillStringElementWithStretch.cs)
    const S_RHO = 7700, S_E = 210e9, S_ALPHA = 12e-6, S_MU = 0.25, S_G = 9.80665, EL = 1.0;

    // ---------------- geometry (SurQC SurveyStation: minimum curvature)
    const vec = (inc, az) => [Math.sin(inc) * Math.sin(az), Math.sin(inc) * Math.cos(az), Math.cos(inc)]; // [E, N, TVD]
    const angleBetween = (a, b) => { const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])); return Math.acos(d); };
    function positions(survey) {          // tie at the first station (TVD 0 there unless tie given)
        const out = [{ e: 0, n: 0, tvd: survey[0].tvd0 || 0 }];
        for (let i = 1; i < survey.length; i++) {
            const a = survey[i - 1], b = survey[i], t1 = vec(a.inc * D, a.az * D), t2 = vec(b.inc * D, b.az * D);
            const dmd = b.md - a.md, beta = angleBetween(t1, t2), p = out[i - 1];
            let s;
            if (beta === 0 || dmd === 0) s = t1.map(x => x * dmd);
            else { const R = dmd / beta, k = R * Math.tan(beta / 2); s = [k * (t1[0] + t2[0]), k * (t1[1] + t2[1]), k * (t1[2] + t2[2])]; }
            out.push({ e: p.e + s[0], n: p.n + s[1], tvd: p.tvd + s[2] });
        }
        return out;
    }
    // point at distance s along the minimum-curvature arc between stations
    // a and b (same circular arc as SurQC's InterpolatedSurveyStation
    // construction): tangent = slerp(t1, t2), position by the arc.
    function arcPoint(a, b, pa, s) {
        const t1 = vec(a.inc * D, a.az * D), t2 = vec(b.inc * D, b.az * D), dmd = b.md - a.md, beta = angleBetween(t1, t2);
        if (beta < 1e-9) return { md: a.md + s, inc: a.inc * D, tvd: pa.tvd + s * t1[2] };
        const R = dmd / beta, ph = s / R, sb = Math.sin(beta);
        const t = [0, 1, 2].map(k => (Math.sin(beta - ph) * t1[k] + Math.sin(ph) * t2[k]) / sb);
        // position: integral of tangent = R[(cos(beta-ph) - cos beta) t1 + (1 - cos ph) t2]/sin beta
        const tvd = pa.tvd + R * ((Math.cos(beta - ph) - Math.cos(beta)) * t1[2] + (1 - Math.cos(ph)) * t2[2]) / sb;
        return { md: a.md + s, inc: Math.acos(Math.max(-1, Math.min(1, t[2]))), tvd };
    }
    // SurveyStationsExtensions.InterpolatedStations (interval EL, remainder carried)
    function interpolated(survey, pos) {
        const out = [{ md: survey[0].md, inc: survey[0].inc * D, tvd: pos[0].tvd }];
        let L = EL;
        for (let i = 1; i < survey.length; i++) {
            const sec = survey[i].md - survey[i - 1].md;
            while (L < sec) { out.push(arcPoint(survey[i - 1], survey[i], pos[i - 1], L)); L += EL; }
            L -= sec;
        }
        const last = survey[survey.length - 1];
        if (Math.abs(out[out.length - 1].md - last.md) > 1e-6) out.push({ md: last.md, inc: last.inc * D, tvd: pos[pos.length - 1].tvd });
        return out;
    }

    // ---------------- Model "SurQC"
    // input: survey [{md,inc,az}] (deg, m); dpOD, dpID (m); bha [{od,id,len}] (m);
    //        mudDensity (kg/m3); gradient (degC per m TVD); loadCase 'pullOut'|'static'|'runIn'
    function surqc(input) {
        const sv = input.survey, pos = positions(sv), st = interpolated(sv, pos);
        const mud = input.mudDensity, G = input.gradient;
        const bhaLen = input.bha.reduce((s, c) => s + c.len, 0);
        const bhaVol = input.bha.reduce((s, c) => s + Math.PI * (c.od / 2 + c.id / 2) * (c.od / 2 - c.id / 2) * c.len, 0);
        const bhaStart = input.bha.length ? sv[sv.length - 1].md - bhaLen : -1;
        const dpVol1 = Math.PI * (input.dpOD / 2 + input.dpID / 2) * (input.dpOD / 2 - input.dpID / 2) * EL;
        const dpMass = dpVol1 * (S_RHO - mud), dpArea = Math.PI * (input.dpOD * input.dpOD - input.dpID * input.dpID) / 4;
        const bhaMass = bhaLen > 0 ? bhaVol * (S_RHO - mud) * (EL / bhaLen) : 0, bhaArea = bhaLen > 0 ? bhaVol / bhaLen : 0;
        const els = st.map(p => (bhaStart === -1 || p.md <= bhaStart) ? { ...p, m: dpMass, A: dpArea } : { ...p, m: bhaMass, A: bhaArea });
        const sgn = input.loadCase === 'static' ? 0 : input.loadCase === 'runIn' ? -1 : 1;
        // bottom-up (DrillStringElementsExtensions.CreateElementsWithStretch)
        const n = els.length, mech = new Float64Array(n), therm = new Float64Array(n), ten = new Float64Array(n);
        let Tnext = 0;
        for (let i = n - 1; i >= 0; i--) {
            const e = els[i], prev = i > 0 ? els[i - 1] : null;
            let avg = e.inc, idiff = 0;
            if (prev) { avg = 0.5 * (e.inc + prev.inc); idiff = 0.5 * (prev.inc - e.inc); }
            const along = e.m * Math.cos(avg) * S_G, sideW = e.m * Math.sin(avg) * S_G;
            const thrust = -2 * Tnext * Math.sin(0.5 * idiff);
            const drag = S_MU * Math.abs(thrust - sideW);
            const T = Tnext + along + sgn * drag;
            ten[i] = T; mech[i] = (T / e.A) / S_E; therm[i] = S_ALPHA * G * e.tvd;
            Tnext = T;
        }
        // DrillStringWithStretch.CalculateStretchAtMds: cumulative from the top,
        // md = first station MD + k * 1 m
        const pts = []; let cm = 0, ct = 0, md = sv[0].md;
        for (let i = 0; i < n; i++) { cm += mech[i]; ct += therm[i]; pts.push({ md, mech: cm, thermal: ct, total: cm + ct, tension: ten[i] }); md += EL; }
        return { points: pts, elements: els.map((e, i) => ({ md: e.md, tvd: e.tvd, inc: e.inc, m: e.m, A: e.A, mech: mech[i], thermal: therm[i], tension: ten[i] })) };
    }
    // MeasuredDepthCorrectionExtensions.Correction: two nearest points, straight line
    function correctionAt(points, md, key) {
        key = key || 'total';
        if (!points.length) return 0;
        let a = null, b = null;
        for (const p of points) { const d = Math.abs(p.md - md); if (!a || d < Math.abs(a.md - md)) a = p; }
        for (const p of points) { if (p === a) continue; const d = Math.abs(p.md - md); if (!b || d < Math.abs(b.md - md)) b = p; }
        if (!b) return a[key];
        return a[key] + (md - a.md) * ((b[key] - a[key]) / (b.md - a.md));
    }

    // ---------------- Model "T&D"
    // input: survey, casings, bha (T&D format: [{name, od_m, id_m, len, wt}] bit first,
    //        full string; beyond it tdModel uses its default DP), params (T&D params),
    //        loadCase 'static'|'tripOut'|'tripIn'|'rotOB'|'slide', E (Pa),
    //        alpha (/degC), Tsurf, Tcal (degC), gradient (degC per m TVD),
    //        sensorOffset (m)
    const CASE_KEY = { static: 'etRotOff', tripOut: 'etTripOut', tripIn: 'etTripIn', rotOB: 'etRotOB', slide: 'etSlide' };
    function tdStretchAtStation(input, stationMd) {
        const bitMd = stationMd + (input.sensorOffset || 0);
        const p = Object.assign({}, input.params, { td: bitMd });
        const rows = TD.computeModel(input.survey, input.casings || [], input.bha, p);
        const key = CASE_KEY[input.loadCase] || 'etRotOff';
        const E = input.E, dpDef = { od_m: 0.1143, id_m: 0.0714 };
        const area = md => { const c = TD.pipeAt(md, bitMd, input.bha) || dpDef; return Math.PI * (c.od_m * c.od_m - c.id_m * c.id_m) / 4; };
        // F (N) at nodes: effective tension without the block weight
        const F = rows.map(r => r[key] * 1000 - (p.blockW || 0));
        let mech = 0, therm = 0;
        const traj = TD.minCurvature(input.survey);
        const T = md => input.Tsurf + input.gradient * TD.interpTraj(traj, md).tvd - input.Tcal;
        for (let i = 1; i < rows.length; i++) {
            const a = rows[i - 1].md, b = Math.min(rows[i].md, stationMd);
            if (b <= a) break;
            const fb = rows[i].md === b ? F[i] : F[i - 1] + (F[i] - F[i - 1]) * (b - a) / (rows[i].md - a);
            const mid = 0.5 * (a + b);
            mech += 0.5 * (F[i - 1] + fb) * (b - a) / (E * area(mid));
            therm += input.alpha * 0.5 * (T(a) + T(b)) * (b - a);
        }
        return { md: stationMd, mech, thermal: therm, total: mech + therm, surfaceTension: F[0] };
    }
    function tdStretch(input) { return input.survey.map(s => tdStretchAtStation(input, s.md)); }

    // ---------------- apply MD correction to a survey + recompute positions
    function correctSurvey(survey, corrs) {
        const cor = survey.map((s, i) => ({ md: s.md + (corrs[i] == null ? 0 : corrs[i]), inc: s.inc, az: s.az }));
        const raw = positions(survey), cp = positions(cor);
        return survey.map((s, i) => ({ mdRaw: s.md, md: cor[i].md, corr: corrs[i], inc: s.inc, az: s.az,
            tvdRaw: raw[i].tvd, tvd: cp[i].tvd, dTvd: cp[i].tvd - raw[i].tvd, dN: cp[i].n - raw[i].n, dE: cp[i].e - raw[i].e }));
    }

    return { surqc, correctionAt, tdStretch, tdStretchAtStation, correctSurvey, positions, interpolated,
             SURQC: { RHO: S_RHO, E: S_E, ALPHA: S_ALPHA, MU: S_MU, G: S_G } };
}));

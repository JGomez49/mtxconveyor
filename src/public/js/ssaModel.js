/*
 * ssaModel.js — Survey correction by Slide Sheet Analysis (SSA). ADDED 2026-11-13 (John).
 * Browser + Node (UMD). Project docs: claude/slidesheet-edr-findings.md, claude/correction-chain-plan.md.
 *
 * SOURCE: ISCWSA eBook V9.10 (2017), ch.8, pp. 57-58 ("re-analyse the MWD survey to obtain a better estimate of TVD
 * ... by including the slide sheet information"):
 *   1. Per BHA run, the total curvature generated over the run, measured from the angle changes between surveys
 *      (minimum curvature, ch.7), gives the dogleg-severity capability of the assembly.
 *   2. Applying that curvature on the slide toolfaces gives fill-in surveys at the beginning and end of each slide:
 *        inclination change = DLS x length x cos(Toolface)
 *        azimuth change     = DLS x length x sin(Toolface) / sin(Inclination)
 *   3. Minimum curvature is then run through the original + fill-in stations.
 *   Assumptions stated by the eBook: (1) DLS unchanged during the run, (2) all the curvature happens when sliding,
 *   (3) toolface constant during the slide. "A rough guide to the likely TVD adjustment".
 *
 * IMPLEMENTATION CHOICES (how the eBook text is turned into numbers — stated, not invented formulas):
 *   - Assumption (2) => DLS of a run = total curvature between the run's surveys / slid length between those same
 *     surveys (deg per m). Total curvature = sum of the minimum-curvature dogleg angles, Bourgoyne et al., Applied
 *     Drilling Engineering, Eq. 8.33: cos(beta) = cos(I2-I1) - sin I1 sin I2 (1 - cos(A2-A1)).
 *   - Between two real surveys the attitude starts from the earlier survey; rotating footage keeps it; each slide
 *     piece inside the interval adds a fill-in at its start (current attitude) and at its end (after the change).
 *     The "Inclination" in the azimuth formula is the inclination at the start of the slide piece.
 *   - Toolface must be HIGH-SIDE (gravity) toolface: the formulas are referenced to the high side. Slides drilled on
 *     MAGNETIC toolface (MWD below its 3-8 deg switch inclination, eBook ch.5) are NOT filled in — no conversion is
 *     given in the source and the azimuth formula divides by sin(Inclination) — and are reported as skipped.
 *   - Slides on legs other than "Main", or without a run DLS, are skipped and reported.
 *   - QC per survey interval: attitude predicted at the next survey vs the measured one (a large mismatch shows where
 *     the assumptions do not hold).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SsaModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var D = Math.PI / 180;
    function dogleg(i1, a1, i2, a2) {   // Bourgoyne Eq. 8.33, degrees
        var c = Math.cos((i2 - i1) * D) - Math.sin(i1 * D) * Math.sin(i2 * D) * (1 - Math.cos((a2 - a1) * D));
        return Math.acos(Math.max(-1, Math.min(1, c))) / D;
    }
    function wrap(a) { a = a % 360; return a < 0 ? a + 360 : a; }
    function azd(a, b) { var d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

    // survey: [{md, inc, az}] ascending; intervals: slide sheet intervals [{mode, leg, run, from, to, tf, tfRef}]
    function compute(survey, intervals, o) {
        o = o || {};
        var minSin = Math.sin((o.minInc != null ? o.minInc : 3) * D);   // below this inclination the azimuth formula is not used
        var main = intervals.filter(function (x) { return (x.leg || 'Main') === 'Main'; });
        var slides = main.filter(function (x) { return x.mode === 'slide'; }).sort(function (a, b) { return a.from - b.from; });
        // run ranges from the slide sheet (bit-MD footage of each run); no runs -> one run "All"
        var runs = {}, order = [];
        main.forEach(function (x) { var k = x.run || 'All'; if (!runs[k]) { runs[k] = { name: k, from: x.from, to: x.to }; order.push(k); } runs[k].from = Math.min(runs[k].from, x.from); runs[k].to = Math.max(runs[k].to, x.to); });
        var runList = order.map(function (k) { return runs[k]; }).sort(function (a, b) { return a.from - b.from; });
        // DLS capability per run
        runList.forEach(function (r) {
            var sv = survey.filter(function (s) { return s.md >= r.from - 1e-6 && s.md <= r.to + 1e-6; });
            r.surveys = sv.length; r.curv = 0; r.slid = 0; r.mdFrom = sv.length ? sv[0].md : null; r.mdTo = sv.length ? sv[sv.length - 1].md : null;
            for (var i = 1; i < sv.length; i++) r.curv += dogleg(sv[i - 1].inc, sv[i - 1].az, sv[i].inc, sv[i].az);
            if (sv.length > 1) slides.forEach(function (x) { if ((x.run || 'All') !== r.name) return; var a = Math.max(x.from, r.mdFrom), b = Math.min(x.to, r.mdTo); if (b > a) r.slid += b - a; });
            r.dls = (r.slid > 0 && sv.length > 1) ? r.curv / r.slid : null;   // deg per m (assumption 2)
        });
        var dlsOf = {}; runList.forEach(function (r) { dlsOf[r.name] = r.dls; });
        // fill-ins between consecutive surveys
        var fill = [], skipped = [], qc = [];
        for (var i = 0; i + 1 < survey.length; i++) {
            var m0 = survey[i].md, m1 = survey[i + 1].md, I = survey[i].inc, A = survey[i].az, any = false;
            slides.forEach(function (x) {
                var a = Math.max(x.from, m0), b = Math.min(x.to, m1); if (!(b > a + 1e-6)) return;
                var why = (x.leg && x.leg !== 'Main') ? 'other leg' : x.tfRef === 'MTF' ? 'magnetic toolface (below the MWD switch inclination)' : !isFinite(x.tf) ? 'no toolface' : dlsOf[x.run || 'All'] == null ? 'no DLS for run ' + (x.run || 'All') : Math.sin(I * D) < minSin ? 'inclination below ' + (o.minInc != null ? o.minInc : 3) + '°' : '';
                if (why) { skipped.push({ from: a, to: b, tf: x.tf, run: x.run || '', why: why }); return; }
                var dls = dlsOf[x.run || 'All'], L = b - a, src = { from: x.from, to: x.to, tf: x.tf, run: x.run || '' };
                if (a > m0 + 0.05) fill.push({ md: a, inc: I, az: A, at: 'start', slide: src });
                var dI = dls * L * Math.cos(x.tf * D), dA = dls * L * Math.sin(x.tf * D) / Math.sin(I * D);   // eBook p.58
                I = I + dI; A = wrap(A + dA); any = true;
                if (b < m1 - 0.05) fill.push({ md: b, inc: I, az: A, at: 'end', slide: src });
            });
            if (any) qc.push({ from: m0, to: m1, predInc: I, predAz: A, measInc: survey[i + 1].inc, measAz: survey[i + 1].az, dInc: survey[i + 1].inc - I, dAz: azd(survey[i + 1].az, A) });
        }
        return { runs: runList, fillIns: fill, skipped: skipped, qc: qc, slides: slides.length };
    }
    // merged station list for minimum curvature: real stations + fill-ins (flag interp)
    function merge(survey, fillIns) {
        return survey.map(function (s, i) { return { md: s.md, inc: s.inc, az: s.az, interp: false, idx: i }; })
            .concat(fillIns.map(function (f) { return { md: f.md, inc: f.inc, az: f.az, interp: true, fill: f }; }))
            .sort(function (a, b) { return a.md - b.md || (a.interp ? 1 : -1); });
    }
    return { compute: compute, merge: merge, dogleg: dogleg };
}));

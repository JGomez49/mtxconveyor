/*
 * slideSheetModel.js — Slide sheet from rig EDR data (Pason LAS, 1 s). ADDED 2026-11-13 (John).
 * Browser + Node (UMD). Validation/findings: project doc claude/slidesheet-edr-findings.md.
 *
 * WHY: the slide sheet written by the directional driller is manual (rounded depths, intended "set" toolface);
 * the EDR records what actually happened every second. On CNRL 104 HZ FOXCK 16-25-61-19 the rules below found
 * all 38 slides of the DD sheet (start/end within ~1 m) plus one slide missing from it (495-507 m), and the
 * measured toolface differed from the set toolface by 20-45 deg on many slides.
 *
 * Sample rate: needs second-level data (the LAS export). The 10-minute Drilling-Mechanics CSV cannot resolve
 * slides (a slide lasts minutes, so one 10-min sample mixes sliding and rotating).
 *
 * DETECTION RULES (engineering classification rules chosen and checked on the data above — NOT a published
 * formula; every threshold is an input the user can change):
 *   1. New hole: hole depth DEPT increases by 0 < step < maxStep (2 m) between samples and the bit is on bottom
 *      (DEPT - BDEP < onBottomTol, 0.5 m). Each step's footage is assigned to the mode of that sample.
 *   2. Mode: SLIDE when, in a time window of +/- window/2 (61 s total), |mean RPM| < slideMeanRpm (5) AND
 *      max |RPM| <= slideMaxRpm (20) — top-drive rocking oscillates about +/-10 RPM while sliding, so "RPM = 0"
 *      alone misses most slides. Otherwise ROTATE.
 *   3. Consecutive footage of the same mode is merged while the gap is < mergeGap (1 m); slides shorter than
 *      minSlide (0.5 m) become rotating footage.
 *   4. Toolface: Pason "TF" curve = gravity toolface, or 1000 + magnetic toolface when the MWD is in magnetic
 *      mode (verified in the data: TF 1144.45 while MTF = 144.45). Slide toolface = circular mean of the TF
 *      samples on new hole; spread = circular standard deviation sqrt(-2 ln R) (Mardia & Jupp, Directional
 *      Statistics — textbook, not in folder).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SlideSheetModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var NULLS = [-999.25, -999, -9999];
    var WANT = ['TIME', 'DEPT', 'BDEP', 'ROP', 'WOB', 'RPM', 'DIFP', 'TPO', 'INCL', 'AZ', 'GTF', 'MTF', 'TF'];

    // ---------------- LAS 2.0 parser (streaming: feed text chunks, then finish()) ----------------
    function LasParser() {
        this.cols = null; this.idx = null; this.buf = ''; this.n = 0; this.cap = 0; this.data = {};
        this.well = {}; this.nullVal = -999.25; this.section = ''; this.curves = [];
    }
    LasParser.prototype._grow = function () {
        var cap = this.cap ? this.cap * 2 : 1 << 16, self = this;
        WANT.forEach(function (k) { var a = new Float64Array(cap); if (self.data[k]) a.set(self.data[k]); self.data[k] = a; });
        this.cap = cap;
    };
    LasParser.prototype._line = function (line) {
        if (!line) return;
        var c0 = line.charAt(0);
        if (this.idx) {                                   // data section
            var p = line.trim().split(/\s+/); if (p.length < this.cols.length) return;
            if (this.n >= this.cap) this._grow();
            for (var k = 0; k < WANT.length; k++) {
                var j = this.idx[k], v;
                if (j < 0) v = NaN; else { v = +p[j]; if (!isFinite(v) || v === this.nullVal || NULLS.indexOf(v) >= 0) v = NaN; }
                this.data[WANT[k]][this.n] = v;
            }
            this.n++; return;
        }
        if (c0 === '#') return;
        if (c0 === '~') {
            this.section = line.charAt(1).toUpperCase();
            if (this.section === 'A') {
                // column order = ~C section order (the ~A line may also list them)
                this.cols = this.curves.length ? this.curves : line.trim().split(/\s+/).slice(1);
                var self = this;
                this.idx = WANT.map(function (k) { return self.cols.indexOf(k); });
                if (this.idx[0] < 0 || this.idx[1] < 0) throw new Error('LAS file has no TIME or DEPT curve.');
            }
            return;
        }
        var m = /^\s*([^.\s]+)\s*\.(\S*)\s+(.*?):\s*(.*)$/.exec(line);
        if (!m) return;
        if (this.section === 'C') this.curves.push(m[1].trim().toUpperCase());
        else if (this.section === 'W') {
            var key = m[1].trim().toUpperCase(), val = m[3].trim();
            this.well[key] = val;
            if (key === 'NULL' && isFinite(+val)) this.nullVal = +val;
        }
    };
    LasParser.prototype.push = function (text) {
        var s = this.buf + text, a = 0, i;
        while ((i = s.indexOf('\n', a)) >= 0) { this._line(s.slice(a, i).replace(/\r$/, '')); a = i + 1; }
        this.buf = s.slice(a);
    };
    LasParser.prototype.finish = function () {
        if (this.buf) { this._line(this.buf.replace(/\r$/, '')); this.buf = ''; }
        if (!this.idx) throw new Error('No ~A (data) section found — is this a LAS 2.0 file?');
        var self = this, out = { n: this.n, well: this.well, curves: this.cols.slice(), missing: WANT.filter(function (k, i) { return self.idx[i] < 0; }) };
        WANT.forEach(function (k) { out[k] = self.data[k] ? self.data[k].subarray(0, self.n) : new Float64Array(0); });
        return out;
    };
    function parseLasText(text) { var p = new LasParser(); p.push(text); return p.finish(); }

    // ---------------- helpers ----------------
    var D = Math.PI / 180;
    function decodeTF(v) { return !isFinite(v) ? { tf: NaN, mag: false } : v >= 900 ? { tf: v - 1000, mag: true } : { tf: v, mag: false }; }
    function circStats(list) {
        var s = 0, c = 0, n = 0;
        for (var i = 0; i < list.length; i++) { var v = list[i]; if (!isFinite(v)) continue; s += Math.sin(v * D); c += Math.cos(v * D); n++; }
        if (!n) return { mean: NaN, sd: NaN, n: 0 };
        var R = Math.sqrt(s * s + c * c) / n, m = Math.atan2(s, c) / D;
        return { mean: (m + 360) % 360, sd: R >= 1 ? 0 : Math.sqrt(-2 * Math.log(Math.max(R, 1e-12))) / D, n: n };
    }

    // ---------------- detection ----------------
    var DEFAULTS = { onBottomTol: 0.5, maxStep: 2, window: 61, slideMeanRpm: 5, slideMaxRpm: 20, mergeGap: 1, minSlide: 0.5 };
    function detect(L, o) {
        o = Object.assign({}, DEFAULTS, o || {});
        var n = L.n, T = L.TIME, DEP = L.DEPT, BIT = L.BDEP, RPM = L.RPM;
        if (!n) throw new Error('No data rows.');
        for (var q = 1; q < n; q++) if (T[q] < T[q - 1]) throw new Error('TIME is not increasing at row ' + (q + 1) + ' — sort the export by time.');
        // rolling |mean RPM| and max |RPM| over +/- window/2 seconds (two pointers + monotonic deque)
        var half = o.window / 2, mean = new Float64Array(n), mx = new Float64Array(n);
        var lo = 0, hi = -1, sum = 0, cnt = 0, dq = new Int32Array(n), dh = 0, dt = 0;
        for (var i = 0; i < n; i++) {
            while (hi + 1 < n && T[hi + 1] <= T[i] + half) {
                hi++; var r = RPM[hi];
                if (isFinite(r)) { sum += r; cnt++; while (dt > dh && Math.abs(RPM[dq[dt - 1]]) <= Math.abs(r)) dt--; dq[dt++] = hi; }
            }
            while (T[lo] < T[i] - half) { var r0 = RPM[lo]; if (isFinite(r0)) { sum -= r0; cnt--; } if (dt > dh && dq[dh] === lo) dh++; lo++; }
            while (dt > dh && dq[dh] < lo) dh++;
            mean[i] = cnt ? Math.abs(sum / cnt) : NaN; mx[i] = dt > dh ? Math.abs(RPM[dq[dh]]) : NaN;
        }
        // hole-depth segments: split where DEPT drops by > 10 m. On the FOXCK test file (pad well) the record jumps
        // 3024 -> 495 m and later 6616 -> 3073 m with frozen INCL/AZ — data from another well / depth reset, so the
        // user can exclude whole segments (opts.exclude = [segment index, ...]).
        var segs = [], s0 = 0;
        for (var z = 1; z <= n; z++) {
            if (z === n || (isFinite(DEP[z]) && isFinite(DEP[z - 1]) && DEP[z] < DEP[z - 1] - 10)) {
                var dmin = Infinity, dmax = -Infinity; for (var y = s0; y < z; y++) if (isFinite(DEP[y])) { if (DEP[y] < dmin) dmin = DEP[y]; if (DEP[y] > dmax) dmax = DEP[y]; }
                segs.push({ i0: s0, i1: z - 1, tStart: T[s0], tEnd: T[z - 1], depthStart: dmin, depthEnd: dmax, drilled: 0, dFrom: Infinity, dTo: -Infinity, include: (o.exclude || []).indexOf(segs.length) < 0,
                    // 2026-11-13 (John): multilateral wells — a segment can be another leg; opts.legs[i] = label ('Main' default)
                    leg: (o.legs && o.legs[segs.length]) || 'Main' });
                s0 = z;
            }
        }
        var segOf = new Int32Array(n); segs.forEach(function (g, gi) { for (var y = g.i0; y <= g.i1; y++) segOf[y] = gi; });
        // new-hole footage per sample
        var steps = [];
        for (var k = 1; k < n; k++) {
            if (segOf[k] !== segOf[k - 1]) continue;
            var d0 = DEP[k - 1], d1 = DEP[k];
            if (!isFinite(d0) || !isFinite(d1)) continue;
            var st = d1 - d0; if (!(st > 0 && st < o.maxStep)) continue;
            if (!(isFinite(BIT[k]) && d1 - BIT[k] < o.onBottomTol)) continue;
            var slide = isFinite(mean[k]) && mean[k] < o.slideMeanRpm && mx[k] <= o.slideMaxRpm;
            var gk = segs[segOf[k]]; gk.drilled += st; if (d0 < gk.dFrom) gk.dFrom = d0; if (d1 > gk.dTo) gk.dTo = d1;
            if (!segs[segOf[k]].include) continue;
            steps.push({ k: k, from: d0, to: d1, slide: slide, leg: gk.leg, dt: Math.min(T[k] - T[k - 1], 60) });
        }
        // merge into intervals
        // 2026-11-13: opts.breaks = depths where an interval must be split (T&D BHA-run boundaries), so footage is
        // never attributed to the wrong run
        var brk = (o.breaks || []).filter(isFinite).sort(function (a, b) { return a - b; });
        function crosses(a, b) { for (var q = 0; q < brk.length; q++) if (brk[q] > a + 1e-6 && brk[q] <= b + 1e-6) return true; return false; }
        function build(list) {
            var out = [], cur = null;
            list.forEach(function (s) {
                if (cur && cur.slide === s.slide && cur.leg === s.leg && Math.abs(s.from - cur.to) < o.mergeGap && !crosses(cur.from, s.from)) { cur.to = Math.max(cur.to, s.to); cur.ks.push(s.k); cur.time += s.dt; }
                else { if (cur) out.push(cur); cur = { slide: s.slide, leg: s.leg, from: s.from, to: s.to, ks: [s.k], time: s.dt }; }
            });
            if (cur) out.push(cur);
            return out;
        }
        var iv = build(steps);
        // short slides -> rotating, then merge again
        var demote = false;
        var byK = {}; steps.forEach(function (s) { byK[s.k] = s; });
        iv.forEach(function (x) { if (x.slide && x.to - x.from < o.minSlide) { demote = true; x.ks.forEach(function (k) { byK[k].slide = false; }); } });
        if (demote) iv = build(steps);
        // statistics per interval
        var res = iv.map(function (x) {
            var tfs = [], nm = 0, wob = 0, nw = 0, dp = 0, nd = 0, rpm = 0, nr = 0;
            x.ks.forEach(function (k) {
                var t = decodeTF(L.TF[k]); if (!isFinite(t.tf) && isFinite(L.GTF[k])) t = { tf: L.GTF[k], mag: false };
                if (isFinite(t.tf)) { tfs.push(t.tf); if (t.mag) nm++; }
                if (isFinite(L.WOB[k])) { wob += L.WOB[k]; nw++; }
                if (isFinite(L.DIFP[k])) { dp += L.DIFP[k]; nd++; }
                if (isFinite(RPM[k])) { rpm += RPM[k]; nr++; }
            });
            var cs = circStats(tfs), k0 = x.ks[0], k1 = x.ks[x.ks.length - 1], len = x.to - x.from;
            return { mode: x.slide ? 'slide' : 'rotate', leg: x.leg, from: x.from, to: x.to, len: len,
                tStart: T[k0 - 1], tEnd: T[k1], drillTime_s: x.time, rop: x.time > 0 ? len / (x.time / 3600) : NaN,
                tf: x.slide ? cs.mean : NaN, tfSd: x.slide ? cs.sd : NaN, tfRef: x.slide ? (nm > cs.n / 2 ? 'MTF' : 'GTF') : '', tfN: cs.n,
                wob: nw ? wob / nw : NaN, difp: nd ? dp / nd : NaN, rpm: nr ? rpm / nr : NaN,
                incStart: L.INCL[k0], incEnd: L.INCL[k1], azStart: L.AZ[k0], azEnd: L.AZ[k1] };
        });
        var drilled = res.reduce(function (a, x) { return a + x.len; }, 0), slid = res.filter(function (x) { return x.mode === 'slide'; }).reduce(function (a, x) { return a + x.len; }, 0);
        var resets = segs.slice(1).map(function (g, i) { return { time: g.tStart, from: segs[i].depthEnd, to: g.depthStart }; });
        return { segments: segs.map(function (g) { return { tStart: g.tStart, tEnd: g.tEnd, depthStart: g.depthStart, depthEnd: g.depthEnd, drilled: g.drilled, drilledFrom: isFinite(g.dFrom) ? g.dFrom : null, drilledTo: isFinite(g.dTo) ? g.dTo : null, include: g.include, leg: g.leg }; }), intervals: res, slides: res.filter(function (x) { return x.mode === 'slide'; }), summary: { drilled: drilled, slid: slid, slidePct: drilled ? 100 * slid / drilled : 0, samples: n }, resets: resets, opts: o };
    }

    // ---------------- DD slide sheet (Excel) comparison ----------------
    // rows: array of arrays (sheet_to_json header:1). Finds the header row with "From" and "To"; uses the first
    // From/To pair at or after a "Slide" heading (CNRL sheet: Slide From | To | Meters | Set @).
    function readDDSheet(rows) {
        var norm = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
        for (var r = 0; r < Math.min(rows.length, 40); r++) {
            var row = rows[r] || [], fIdx = [];
            row.forEach(function (v, i) { if (norm(v) === 'from') fIdx.push(i); });
            if (!fIdx.length || norm(row[fIdx[0] + 1]) !== 'to') continue;
            var prev = rows[r - 1] || [], sc = -1;
            prev.forEach(function (v, i) { if (sc < 0 && /slide/i.test(String(v || '')) && i >= fIdx[0] - 1) sc = i; });
            var f = fIdx.filter(function (i) { return sc < 0 || i >= sc; })[0];
            if (f == null) f = fIdx[0];
            var setCol = -1; for (var c = f + 2; c < f + 5; c++) if (/set/i.test(String(row[c] || '') + String(prev[c] || ''))) { setCol = c; break; }
            var out = [];
            for (var i = r + 1; i < rows.length; i++) {
                var a = +rows[i][f], b = +rows[i][f + 1];
                if (isFinite(a) && isFinite(b) && b > a && rows[i][f] !== '' && rows[i][f + 1] !== '') out.push({ from: a, to: b, set: setCol >= 0 ? rows[i][setCol] : '' });
            }
            return { slides: out, headerRow: r + 1, fromCol: f };
        }
        throw new Error('Could not find the "From" / "To" slide columns in the sheet.');
    }
    function compare(edrSlides, dd, tol) {
        tol = tol == null ? 2 : tol;
        var used = {};
        var rows = dd.map(function (q) {
            var m = edrSlides.filter(function (x, i) { var ok = x.to > q.from - tol && x.from < q.to + tol; if (ok) used[i] = true; return ok; });
            return { dd: q, edr: m };
        });
        var only = edrSlides.filter(function (x, i) { return !used[i]; });
        return { rows: rows, edrOnly: only, ddMissing: rows.filter(function (r) { return !r.edr.length; }).length };
    }

    return { LasParser: LasParser, parseLasText: parseLasText, detect: detect, readDDSheet: readDDSheet, compare: compare, circStats: circStats, decodeTF: decodeTF, DEFAULTS: DEFAULTS, WANT: WANT };
}));

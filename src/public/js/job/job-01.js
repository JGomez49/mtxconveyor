/* MTX Conveyor — job page script 1. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 254) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

// 2026-11-20 (John): shared ROP for drilling TIME (score cards "Time – Build / Lateral" and the Drilling Mechanics
// Calculated Time vs Depth). Was: plain mean of the ROP "Average" curve. Now:
//  - curve = the Drilling Mechanics KPI selector (Min / Avg / Max of the Pason export; default Min; saved per user, key dmKpiCurve);
//  - LENGTH-WEIGHTED (harmonic) mean over the MD range: time = integral of dMD / ROP (trapezoid on 1/ROP between points),
//    ROP = covered length / time. This is the ROP that gives the right time; a plain mean overstates speed when ROP varies.
window.MTX_ROP = {
    curve: window.MTX_JOB.dmKpiCurve,   // 2026-11-22: default Average (was Min); a user's saved choice still wins
    COL: { avg: 1, max: 2, min: 3 },
    lw: function(rows, mdStart, mdEnd, curve){
        if(!rows || !rows.length) return null;
        var col = this.COL[curve || this.curve] || 1, lo = Math.min(mdStart, mdEnd), hi = Math.max(mdStart, mdEnd);
        var pts = rows.map(function(r){ return [Number(r[0]), r[col] === '' || r[col] == null ? NaN : Number(r[col])]; })
            .filter(function(p){ return isFinite(p[0]) && isFinite(p[1]) && p[1] > 0 && p[0] >= lo && p[0] <= hi; }).sort(function(a, b){ return a[0] - b[0]; });
        if(!pts.length) return null;
        if(pts.length === 1) return pts[0][1];
        var L = 0, T = 0;
        for(var i = 1; i < pts.length; i++){ var dm = pts[i][0] - pts[i - 1][0]; if(dm <= 0) continue; L += dm; T += dm * (1 / pts[i][1] + 1 / pts[i - 1][1]) / 2; }
        return T > 0 ? L / T : pts[0][1];
    }
};
// 2026-11-20 (John): SLIDE / ROTATE time model for PLANNED wells (Drilling Mechanics panel "Time model"). Per section
// (Surface 0→SC, Build SC→IC, Lateral IC→TD) and per offset source (saved Slide Sheet or LAS file): slid length Ls and its
// on-bottom time Ts, rotated length Lr and its time Tr (time of each EDR interval = length / its ROP). Pooled over sources:
//   slide fraction f = ΣLs / Σ(Ls+Lr);  ROP_slide = ΣLs/ΣTs (Avg) or the slowest / fastest source (Min / Max, same selector);
//   effective ROP of the section = 1 / ( f / ROP_slide + (1−f) / ROP_rotate )   (time = slid m / ROP_slide + rotated m / ROP_rotate).
// On-bottom time only (no connections / surveys), like the single-ROP method; the milestone pauses are added on top.
window.MTX_SRM = {
    model: window.MTX_JOB.slideRotModel,
    agg: function(curve){
        var m = this.model, out = {}; if(!m || !m.sources) return out; curve = curve || window.MTX_ROP.curve;
        ['Surface', 'Build', 'Lateral'].forEach(function(sec){
            var Ls = 0, Ts = 0, Lr = 0, Tr = 0, rs = [], rr = [], n = 0;
            m.sources.forEach(function(src){ if(src.on === false) return; var q = src.perSection && src.perSection[sec]; if(!q || !(q.Ls + q.Lr > 0)) return; n++;
                Ls += q.Ls; Ts += q.Ts; Lr += q.Lr; Tr += q.Tr; if(q.Ls > 0 && q.Ts > 0) rs.push(q.Ls / q.Ts); if(q.Lr > 0 && q.Tr > 0) rr.push(q.Lr / q.Tr); });
            if(!n) return;
            var pick = function(arr, L, T){ if(!arr.length) return null; return curve === 'min' ? Math.min.apply(null, arr) : curve === 'max' ? Math.max.apply(null, arr) : (T > 0 ? L / T : null); };
            var f = (Ls + Lr) > 0 ? Ls / (Ls + Lr) : 0, ropS = pick(rs, Ls, Ts), ropR = pick(rr, Lr, Tr), eff = null;
            if(ropR && (f === 0 || ropS)) eff = 1 / (f / (ropS || 1) * (f > 0 ? 1 : 0) + (1 - f) / ropR);
            else if(ropS && f === 1) eff = ropS;
            out[sec] = { f: f, ropS: ropS, ropR: ropR, eff: eff, n: n, Ls: Ls, Lr: Lr };
        });
        return out;
    },
    active: function(){ return !!(this.model && this.model.active && this.model.sources && this.model.sources.length); },
    rop: function(sec){ if(!this.active() || !sec) return null; var a = this.agg(); return a[sec] && a[sec].eff ? a[sec].eff : null; }
};
// 2026-11-21 (John): TIME MODEL for the planned Time vs Depth (Drilling Mechanics) and the score-card times — no manual pauses.
// Time of a planned section [a, b] = ON-BOTTOM time + OTHER in-hole time; plus STOPS at the casing points and per new leg.
//  - on-bottom: (b - a) / ROP — slide / rotate offset model when active, else the length-weighted ROP of the Pason ROP plot;
//  - other in-hole (connections, surveys, reaming…) and stops come from the offsets' EDR:
//     * LAS wells (tabs "LAS time per 100 m" / "LAS stops" of the Pason export): other h per metre over the bins overlapping
//       [a, b]; casing stop = longest stop of each well within max(30 m, 10 %) of the planned SC / IC depth; leg stop = stops
//       that end with the hole depth dropping (trip back to a sidetrack point);
//     * else (CSV / Excel data) from the Hole Depth vs Time curve of the export: elapsed time between the depths minus
//       on-bottom time minus its flat stretches (> 2 h progressing < 1 m/h); casing stop = longest flat stretch near the depth;
//       no leg stop (shown as 0 and flagged).
//  - Min / Avg / Max (same selector): slowest well / pooled (sum of hours / sum of metres, or mean of stops) / fastest well.
window.MTX_TM = {
    _doc: undefined,
    doc: function(){ if(this._doc === undefined){ var e = document.getElementById('pasonPlotsData'); try{ this._doc = e ? JSON.parse(e.textContent) : null; }catch(x){ this._doc = null; } } return this._doc; },
    plots: function(){ var d = this.doc(); return (window.MTX_TM._livePlots) || (d && d.plots) || {}; },
    pick: function(vals){ if(!vals.length) return null; var c = window.MTX_ROP.curve; return c === 'min' ? Math.max.apply(null, vals) : c === 'max' ? Math.min.apply(null, vals) : vals.reduce(function(x, y){ return x + y; }, 0) / vals.length; },
    onBottomH: function(a, b, sec){
        var rop = (window.MTX_SRM && window.MTX_SRM.rop(sec)) || (this.plots().rop ? window.MTX_ROP.lw(this.plots().rop.rows, a, b) : null);
        return rop > 0 ? (b - a) / rop : null;
    },
    hasLas: function(){ var p = this.plots(); return !!(p.lasTime && p.lasTime.length); },
    // 2026-11-21: time-depth source for flats / other time when there is no LAS: 'raw' = the Raw X,Y dots imported on the
    // Hole Depth vs Time plot (the drilled well), 'pason' = the export's curve for the selected Min / Avg / Max.
    src: 'raw',   // 2026-11-21: the 'Flat time from the data' tables + source selector were removed (user: not working); raw dots used when imported, else the Pason curve
    allPts: function(){ var p = this.plots().td; if(!p) return [];
        if(this.src === 'raw' && p.raw && p.raw.points && p.raw.points.length) return p.raw.points.map(function(q){ return [Number(q[0]), Number(q[1])]; }).filter(function(q){ return isFinite(q[0]) && isFinite(q[1]); }).sort(function(x, y){ return x[0] - y[0]; });
        if(!p.rows || !p.rows.length) return []; var col = window.MTX_ROP.COL[window.MTX_ROP.curve] || 1;
        return p.rows.map(function(r){ return [Number(r[0]), r[col] === '' || r[col] == null ? NaN : Number(r[col])]; }).filter(function(q){ return isFinite(q[0]) && isFinite(q[1]); }).sort(function(x, y){ return x[0] - y[0]; }); },
    srcLabel: function(){ var p = this.plots().td; return this.src === 'raw' && p && p.raw && p.raw.points && p.raw.points.length ? 'Raw X,Y' : 'Pason time curve'; },
    // legs = parts of the record split where the hole depth drops > 10 m; per leg: start, TD (deepest point) and the time from
    // reaching that TD to drilling again (> 1 m below the next leg's first depth) = leg transition (trip back + sidetrack start)
    analyze: function(){
        var a = this.allPts(); if(a.length < 3) return null;
        var segs = [], s0 = 0, mx = a[0][1];
        for(var i = 1; i <= a.length; i++){ if(i === a.length || a[i][1] < mx - 10){ segs.push(a.slice(s0, i)); if(i < a.length){ s0 = i; mx = a[i][1]; } } else mx = Math.max(mx, a[i][1]); }
        var legs = segs.map(function(g){ var k = 0; g.forEach(function(q, j){ if(q[1] > g[k][1]) k = j; }); return { pts: g, d0: g[0][1], t0: g[0][0], td: g[k][1], tTD: g[k][0] }; });
        legs.forEach(function(l, j){ var n = legs[j + 1]; if(!n) return; var start = null;
            for(var q = 0; q < n.pts.length; q++){ if(n.pts[q][1] > n.d0 + 1){ start = n.pts[q > 0 ? q - 1 : 0][0]; break; } }
            l.nextStartT = start; l.transH = start != null ? (start - l.tTD) * 24 : null; l.nextStart = n.d0; });
        return { legs: legs, flats: this.flats(legs[0].pts) };
    },
    tdPts: function(){ var p = this.plots().td; if(!p) return []; var col = window.MTX_ROP.COL[window.MTX_ROP.curve] || 1;
        if(this.src === 'raw' && p.raw && p.raw.points && p.raw.points.length) return this.analyze().legs[0].pts;
        if(!p.rows || !p.rows.length) return [];
        var a = p.rows.map(function(r){ return [Number(r[0]), r[col] === '' || r[col] == null ? NaN : Number(r[col])]; }).filter(function(q){ return isFinite(q[0]) && isFinite(q[1]); }).sort(function(x, y){ return x[0] - y[0]; });
        // 2026-11-21: keep only the main bore (up to the first hole-depth drop > 10 m). A multilateral curve is a sawtooth and the
        // "time when a depth is first reached" (tAt) jumped between legs, giving each planned leg a different other-time.
        var mx = -Infinity; for(var i = 0; i < a.length; i++){ if(a[i][1] < mx - 10) return a.slice(0, i); mx = Math.max(mx, a[i][1]); } return a; },
    tAt: function(pts, d){ for(var i = 1; i < pts.length; i++){ var u = pts[i - 1], v = pts[i]; if(u[1] <= d && v[1] >= d && v[1] > u[1]) return u[0] + (v[0] - u[0]) * (d - u[1]) / (v[1] - u[1]); } return null; },
    // flat stretch = consecutive steps progressing < 1 m/h, lasting > 2 h in total (MTX choice; an averaged curve is never exactly flat)
    // 2026-11-22 (John): flat = consecutive points whose depth stays within 0.5 m of the run's first point, lasting > 2 h
    // (same rule as the Pason Plots 'Flat times' tab). Was: steps slower than 1 m/h — a 0.3 m wiggle in 10 min (1.8 m/h) split
    // the ~22 h intermediate-casing flat of the raw data into pieces, so only an 11 h piece was used and the planned curve went
    // straight from the end of the surface-casing flat to the end of the intermediate-casing flat.
    flats: function(pts){ var out = [], a = 0;
        for(var i = 1; i <= pts.length; i++){ if(i === pts.length || Math.abs(pts[i][1] - pts[a][1]) > 0.5){ var h = (pts[i - 1][0] - pts[a][0]) * 24; if(h > 2) out.push({ depth: pts[a][1], hours: h }); a = i; } }
        return out; },
    /* 2026-11-22 (John): 'Flat times' tab of the Pason Plots export (per offset well, see views/uploadPason.ejs mtxFlatStats) used
     * FIRST when present: medians across the offset wells of the SC / IC flat, the leg change, and the other in-hole + trip hours per
     * metre drilled of each section. Was: flats read off the AVERAGED Pason time curve, which is never flat (averaging wells smears
     * every stop), so the IC stop came out 0 h and its time was spread over the build as 'other in-hole' (straight line SC → IC). */
    ft: function(){ var r = this.plots().flatTimes; if(!r || !r.length) return null;
        var med = function(v){ v = v.filter(function(x){ return isFinite(x); }).sort(function(x, y){ return x - y; }); if(!v.length) return null; var m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
        var by = {}; r.forEach(function(x){ (by[x[0]] || (by[x[0]] = [])).push(x); }); var W = Object.keys(by);
        var ev = function(ty){ return med(r.filter(function(x){ return x[1] === ty; }).map(function(x){ return +x[4]; })); };
        var rate = function(sec){ return med(W.map(function(w){ var x = by[w].filter(function(q){ return !sec || q[2] === sec; }), m = x.filter(function(q){ return q[1] === 'OnBottom'; }).reduce(function(a, q){ return a + +q[5]; }, 0);
            return m > 0 ? x.filter(function(q){ return q[1] === 'Other' || q[1] === 'Trip'; }).reduce(function(a, q){ return a + +q[4]; }, 0) / m : NaN; })); };
        return { n: W.length, sc: ev('SC'), ic: ev('IC'), leg: ev('LegEnd'), rate: rate }; },
    otherH: function(a, b, sec){
        var F = this.ft(); if(F){ var rr = F.rate(sec || null); if(rr != null) return { h: rr * (b - a), src: 'Flat times tab, median of ' + F.n + ' offset(s)' + (sec ? ' (' + sec + ')' : '') }; }
        if(this.hasLas()){
            var by = {}; this.plots().lasTime.forEach(function(r){ var lo = Math.max(a, +r[1]), hi = Math.min(b, +r[2]); if(hi <= lo || !(+r[3] > 0)) return; var f = (hi - lo) / (+r[2] - +r[1]), w = by[r[0]] || (by[r[0]] = { m: 0, h: 0 }); w.m += f * +r[3]; w.h += f * +r[9]; });
            var ws = Object.keys(by).map(function(k){ return by[k]; }).filter(function(w){ return w.m > 0; }); if(!ws.length) return { h: 0, src: 'no LAS data in this depth range' };
            var c = window.MTX_ROP.curve, rates = ws.map(function(w){ return w.h / w.m; }), rate = c === 'min' ? Math.max.apply(null, rates) : c === 'max' ? Math.min.apply(null, rates) : ws.reduce(function(x, w){ return x + w.h; }, 0) / ws.reduce(function(x, w){ return x + w.m; }, 0);
            return { h: rate * (b - a), src: 'LAS (' + ws.length + ' well' + (ws.length > 1 ? 's' : '') + ')' };
        }
        var pts = this.tdPts(); if(pts.length < 2) return { h: 0, src: 'no time data' };
        var t0 = this.tAt(pts, Math.max(a, pts[0][1])), t1 = this.tAt(pts, b), onb = this.onBottomH(a, b, null);
        if(t0 == null || t1 == null || onb == null) return { h: 0, src: 'time curve does not cover ' + a.toFixed(0) + '–' + b.toFixed(0) + ' m' };
        var fl = this.flats(pts).filter(function(f){ return f.depth > a + 1 && f.depth < b - 1; }).reduce(function(x, f){ return x + f.hours; }, 0);
        return { h: Math.max(0, (t1 - t0) * 24 - onb - fl), src: 'Pason Hole Depth vs Time curve' };
    },
    stopH: function(D, kind){
        if(D == null) return { h: 0, src: '' };
        var F = this.ft(); if(F && kind && F[kind === 'IC' ? 'ic' : 'sc'] != null) return { h: F[kind === 'IC' ? 'ic' : 'sc'], src: 'median ' + kind + ' flat of ' + F.n + ' offset(s)' };
        var tol = Math.max(30, 0.1 * D);
        if(this.hasLas() && this.plots().lasStops){
            var by = {}; this.plots().lasStops.forEach(function(r){ if(r[4] === 'Y' || Math.abs(+r[1] - D) > tol) return; by[r[0]] = Math.max(by[r[0]] || 0, +r[3]); });
            var v = Object.keys(by).map(function(k){ return by[k]; }); if(v.length) return { h: this.pick(v), src: 'LAS stops (' + v.length + ')' };
        }
        // 2026-11-21: fallback reads the flats of the selected time-depth source (Raw X,Y or Pason curve). Was: always the
        // averaged Pason curve, which is never flat at the casing points, so surface / intermediate stops came out as 0 h.
        var an = this.analyze(), f = (an ? an.flats : []).filter(function(x){ return Math.abs(x.depth - D) <= tol; });
        return f.length ? { h: Math.max.apply(null, f.map(function(x){ return x.hours; })), src: this.srcLabel() } : { h: 0, src: 'no flat stretch near ' + D.toFixed(0) + ' m' };
    },
    legH: function(){
        var F0 = this.ft(); if(F0 && F0.leg != null) return { h: F0.leg, src: 'median leg change of ' + F0.n + ' offset(s)' };
        if(this.hasLas() && this.plots().lasStops){ var v = this.plots().lasStops.filter(function(r){ return r[4] === 'Y'; }).map(function(r){ return +r[3]; });
            if(v.length) return { h: this.pick(v), src: 'LAS stops ending with a trip back (' + v.length + ')' }; }
        var an = this.analyze(), tv = an ? an.legs.map(function(l){ return l.transH; }).filter(function(h){ return h != null && h >= 0; }) : [];   // 2026-11-21
        if(tv.length) return { h: this.pick(tv), src: this.srcLabel() + ' leg transitions (' + tv.length + ')' };
        return { h: 0, src: 'no leg stop data (needs LAS wells or a multilateral time-depth record)', missing: true };
    },
    // 2026-11-21 (John): flats INSIDE a section (not at its casing points), from the selected time-depth source. Was: dropped —
    // otherH removes flats from the 'other' time, so e.g. the waits at ~100 m and ~400 m in the surface hole were lost.
    // A flat within max(30 m, 10 %) of a casing point is that point's stop (stopH) and is not counted here.
    innerFlats: function(a, b){ if(this.ft()) return []; var an = this.analyze(); if(!an) return [];   // trips are in the Flat times rate
        var ta = a > 0 ? Math.max(30, 0.1 * a) : 0, tb = Math.max(30, 0.1 * b);
        return an.flats.filter(function(x){ return x.depth > a + ta && x.depth < b - tb; }).sort(function(x, y){ return x.depth - y.depth; }); },
    sectionDays: function(a, b, sec){ var onb = this.onBottomH(a, b, sec); if(onb == null) return null;
        var fl = this.innerFlats(a, b).reduce(function(x, f){ return x + f.hours; }, 0); return (onb + this.otherH(a, b, sec).h + fl) / 24; }
};

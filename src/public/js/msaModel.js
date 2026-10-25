// ---------------------------------------------------------------------------
// msaModel.js — Multi-Station Analysis (MSA) + trend Auto-QC
// Added 2026-10-25 for the "MSA" model of the Short Collar / MSA accordion in
// views/sixAxisData.ejs. Depends on public/js/shortCollarModel.js (shared
// SurQC measurement maths: Inc, Toolface, least-squares Az, Dip, Z-bias).
//
// SOURCE OF TRUTH: SurQC (C#), ported line-for-line from
//   Analysis/MultiStationAnalysis.cs   coarse Z grid (bias -20000..20000 nT
//                                      step 200, SF 0.95..1.05 step 0.01), then
//                                      coordinate hill-climb of the 6 terms
//                                      (bias +5/-10 nT, SF +1e-4/-2e-4, <=1000
//                                      rounds, stop when |dErr| <= 1e-3);
//                                      cost = sum over stations of squared
//                                      (reference field . sensor axis - B).
//   Analysis/MSAWithUncertainty.cs     same hi/lo BT & dip uncertainty loop as
//                                      the short collar (AnalysisWithUncertainty).
//   Analysis/AnalysisExtensionMethods  B' = B*SF + bias, applied to ALL stations.
//   AnglesAndDistances/{AlongHole,HighSide,Lateral,XAxis,YAxis}Vector.cs
//   Analysis/AutoQc.cs + Helpers/LeastSquaresAnalysis.cs, SmallestJumpWeighting.cs,
//   Matrix3x3.cs                       trend QC: weighted quadratic vs MD of
//                                      dBT, dDip, GT, short-collar Z-bias; flag a
//                                      station off-trend by > tolerance (later
//                                      checks override earlier: BT < GT < Dip < Bz).
// SurQC excludes stations with Gx = Gy = 0 from the MSA fit automatically.
//
// UNITS: SurQC's step sizes are in nT, so B, BT and BT uncertainty MUST be in
// nT here; gravity in G; angles in/out in DEGREES (dip tolerance in degrees,
// converted to radians as SurQC uses).
// VALIDATION: vs the REAL SurQC MultiStationAnalysis/AutoQc compiled headless
// (.NET 8 harness /tmp/claude-0/sch) — see claude/shortcollar-status.md.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shortCollarModel.js'));
  else root.MsaModel = factory(root.ShortCollarModel);
}(typeof self !== 'undefined' ? self : this, function (SC) {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // WithBiasesAndScaleFactors: (B * SF) + bias, per axis
  function applyCorr(s, c) {
    return { md: s.md, gx: s.gx, gy: s.gy, gz: s.gz,
      bx: (s.bx * c.x.sf) + c.x.b, by: (s.by * c.y.sf) + c.y.b, bz: (s.bz * c.z.sf) + c.z.b };
  }
  // MultiStationAnalysis.ErrorSumSq(measurement)
  function errSq(m, mv) {
    var inc = SC.inc(m), az = SC.magAz(m, mv), tf = SC.toolface(m);
    var cT = Math.cos(tf), sT = Math.sin(tf);
    var sI = Math.sin(inc), cI = Math.cos(inc), sA = Math.sin(az), cA = Math.cos(az);
    var ah = [sI * sA, sI * cA, cI];
    var hs = [cI * sA, cI * cA, -1 * sI];
    var lat = [cA, -1 * sA, 0];
    var xa = [hs[0] * cT + lat[0] * sT, hs[1] * cT + lat[1] * sT, hs[2] * cT + lat[2] * sT];
    var ya = [lat[0] * cT - hs[0] * sT, lat[1] * cT - hs[1] * sT, lat[2] * cT - hs[2] * sT];
    function dot(v) { return (mv.me * v[0]) + (mv.mn * v[1]) + (mv.mv * v[2]); } // MagneticVector.DotProduct
    var rx = dot(xa) - m.bx, ry = dot(ya) - m.by, rz = dot(ah) - m.bz;
    return (rx * rx) + (ry * ry) + (rz * rz);
  }
  function errSum(list, c, mv) {
    var e = 0;
    for (var i = 0; i < list.length; i++) e += errSq(applyCorr(list[i], c), mv);
    return e;
  }
  function mk(xb, xs, yb, ys, zb, zs) { return { x: { b: xb, sf: xs }, y: { b: yb, sf: ys }, z: { b: zb, sf: zs } }; }

  // MultiStationAnalysis.Corrections()
  function corrections(list, mv) {
    // CoarseZBiasAndSf
    var best = 10e100, bZ = 0, bS = 1;
    for (var bl = -100; bl < 101; ++bl) {
      var zb = bl * 200;
      for (var sl = -5; sl < 6; ++sl) {
        var zs = 1 + (0.01 * sl);
        var e = errSum(list, mk(0, 1, 0, 1, zb, zs), mv);
        if (e < best) { best = e; bZ = zb; bS = zs; }
      }
    }
    // BestBiasesAndSfs
    var c = mk(0, 1, 0, 1, bZ, bS);
    var lastBest = 0, bestError = best;
    var BI = 5, BD = 10, SI = 1e-4, SD = 2e-4;
    function step(ax, key, inc, dec) {
      c[ax][key] = c[ax][key] + inc;
      var e1 = errSum(list, c, mv);
      if (e1 < bestError) { bestError = e1; return; }
      c[ax][key] = c[ax][key] - dec;
      var e2 = errSum(list, c, mv);
      if (e2 < bestError) { bestError = e2; return; }
      c[ax][key] = c[ax][key] + inc;
    }
    var rounds = 0;
    for (var i = 0; i < 1000 && Math.abs(bestError - lastBest) > 1e-3; ++i) {
      lastBest = bestError;
      step('z', 'b', BI, BD); step('x', 'b', BI, BD); step('y', 'b', BI, BD);
      step('z', 'sf', SI, SD); step('x', 'sf', SI, SD); step('y', 'sf', SI, SD);
      rounds = i + 1;
    }
    return { c: c, coarseErr: best, err: bestError, rounds: rounds, capped: rounds >= 1000 && Math.abs(bestError - lastBest) > 1e-3 };
  }

  /**
   * run(opts)
   *  stations [{md,gx,gy,gz,bx,by,bz}] (SurQC frame, B in nT)
   *  ref {bt (nT), dipDeg, decDeg}; unc {bt (nT), dipDeg}; exclude [indices]
   *  wrapSafe: shortest angular difference for the uncertainty (see shortCollarModel.js)
   */
  function run(opts) {
    var st = opts.stations, ref = opts.ref, unc = opts.unc || { bt: 0, dipDeg: 0 };
    var ex = new Set(opts.exclude || []);
    var gxgy0 = st.map(function (s) { return s.gx === 0 && s.gy === 0; });
    function fitSet() { return st.filter(function (s, i) { return !ex.has(i) && !gxgy0[i]; }); }
    var mv0 = SC.magVector(ref.bt, ref.dipDeg * D2R);
    var dec = (ref.decDeg || 0) * D2R;
    var used = fitSet();
    if (!used.length) throw new Error('No stations left for the MSA fit.');
    var base = corrections(used, mv0);
    var errBefore = errSum(used, mk(0, 1, 0, 1, 0, 1), mv0);
    function azList(c) { return st.map(function (s) { return SC.magAz(applyCorr(s, c), mv0); }); }
    var azC = azList(base.c);
    var pairs = [[-1, -1], [-1, 1], [1, -1], [1, 1]], hilo = [];
    var diffs = pairs.map(function (p) {
      var mv = SC.magVector(ref.bt + p[0] * unc.bt, (ref.dipDeg + p[1] * unc.dipDeg) * D2R);
      var r = corrections(used, mv); hilo.push(r.c);
      return azList(r.c).map(function (z, i) {
        return opts.wrapSafe ? Math.abs(SC.wrapPi(azC[i] - z)) : SC.wrapPi(Math.abs(azC[i] - z));
      });
    });
    var rows = st.map(function (s, i) {
      var sc = applyCorr(s, base.c), i0 = SC.inc(s), vert = i0 === 0;
      var azM = SC.magAz(s, mv0);
      return {
        md: s.md, inc: i0 * R2D, tf: SC.toolface(s) * R2D,
        azMag: azM * R2D, azTrue: vert ? 0 : norm360((azM + dec) * R2D),
        azMagCorr: azC[i] * R2D, azTrueCorr: vert ? 0 : norm360((azC[i] + dec) * R2D),
        dAz: SC.wrapPi(azC[i] - azM) * R2D,
        bxCorr: sc.bx, byCorr: sc.by, bzCorr: sc.bz,
        btMeas: Math.sqrt(s.bx * s.bx + s.by * s.by + s.bz * s.bz), btCorr: Math.sqrt(sc.bx * sc.bx + sc.by * sc.by + sc.bz * sc.bz),
        dipMeas: SC.dip(s) * R2D, dipCorr: SC.dip(sc) * R2D,
        azUnc: Math.max.apply(null, diffs.map(function (d) { return d[i]; })) * R2D,
        excluded: ex.has(i), gxgy0: gxgy0[i]
      };
    });
    var tfs = used.map(function (s) { return SC.toolface(s) * R2D; });
    return { rows: rows, corr: base.c, hilo: hilo, errBefore: errBefore, errAfter: base.err, coarseErr: base.coarseErr,
      rounds: base.rounds, capped: base.capped, nUsed: used.length, tfSpread: circSpread(tfs) };
  }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  // Largest gap method: angular range (deg) covered by the toolfaces used in the fit.
  function circSpread(degs) {
    if (degs.length < 2) return 0;
    var a = degs.map(norm360).sort(function (p, q) { return p - q; }), gap = 360 - a[a.length - 1] + a[0];
    for (var i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
    return 360 - gap;
  }

  // ---------------- AutoQc (trend) ------------------------------------
  // LeastSquaresAnalysis (weighted quadratic, x zero-referenced at min|x|)
  function det3(m) {
    return (m[0][0] * ((m[1][1] * m[2][2]) - (m[1][2] * m[2][1])))
      - (m[0][1] * ((m[1][0] * m[2][2]) - (m[1][2] * m[2][0])))
      + (m[0][2] * ((m[1][0] * m[2][1]) - (m[1][1] * m[2][0])));
  }
  function det2(a, b, c, d) { return (a * d) - (b * c); }
  function sub(m, r, c) { var o = []; for (var i = 0; i < 3; i++) { if (i === r) continue; var row = []; for (var j = 0; j < 3; j++) if (j !== c) row.push(m[i][j]); o.push(row); } return det2(o[0][0], o[0][1], o[1][0], o[1][1]); }
  function inv3(m) { // Matrix3x3.Inverse = Transpose().Adjoint() * (1/Determinant())
    var t = [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
    var adj = [[sub(t, 0, 0), -1 * sub(t, 0, 1), sub(t, 0, 2)], [-1 * sub(t, 1, 0), sub(t, 1, 1), -1 * sub(t, 1, 2)], [sub(t, 2, 0), -1 * sub(t, 2, 1), sub(t, 2, 2)]];
    var f = 1.0 / det3(m);
    return adj.map(function (r) { return r.map(function (v) { return v * f; }); });
  }
  function smallestJumpWeights(vals, maxJump) {
    var n = vals.length, maxI = n - 1, num = 100 * maxJump;
    return vals.map(function (cur, i) {
      var prev = i !== 0 ? vals[i - 1] : vals[i + 1], next = i !== maxI ? vals[i + 1] : vals[i - 1];
      var j1 = Math.abs(cur - prev), j2 = Math.abs(next - cur), j = j1 < j2 ? j1 : j2;
      var w = 100; if (j > maxJump) w = num / j; return w;
    });
  }
  function quadFit(xy, maxJump) {
    if (xy.length === 0) return { a: 0, b: 0, c: 0 };
    if (xy.length === 1) return { a: 0, b: 0, c: xy[0][1] };
    var off = Math.min.apply(null, xy.map(function (p) { return Math.abs(p[0]); }));
    var z = xy.map(function (p) { return [p[0] - off, p[1]]; });
    var w = smallestJumpWeights(z.map(function (p) { return p[1]; }), maxJump);
    var L = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
    z.forEach(function (p, i) {
      var x = p[0], x2 = x * x, wt = w[i];
      L[0][0] += wt * x2 * x2; L[0][1] += wt * x2 * x; L[0][2] += wt * x2;
      L[1][0] += wt * x2 * x; L[1][1] += wt * x2; L[1][2] += wt * x;
      L[2][0] += wt * x2; L[2][1] += wt * x; L[2][2] += wt;
    });
    z.forEach(function (p, i) { var x = p[0], y = p[1], wt = w[i]; R[0] += wt * y * x * x; R[1] += wt * y * x; R[2] += wt * y; });
    var I = inv3(L);
    var c0 = I[0][0] * R[0] + I[0][1] * R[1] + I[0][2] * R[2];
    var c1 = I[1][0] * R[0] + I[1][1] * R[1] + I[1][2] * R[2];
    var c2 = I[2][0] * R[0] + I[2][1] * R[1] + I[2][2] * R[2];
    var A = c0, B = c1 - (2 * A * off), C = c2 + (A * off * off) - (c1 * off);
    return { a: A, b: B, c: C };
  }
  /**
   * autoQc(stations, ref{bt nT, dipDeg}, tol{bt nT, dipDeg, gt G, bz nT})
   * returns per-station {fail: null|'BT'|'GT'|'Dip'|'Bz', dBT, dDipDeg, gt, bzBias} + trends
   */
  function autoQc(st, ref, tol) {
    var mv = SC.magVector(ref.bt, ref.dipDeg * D2R);
    var v = st.map(function (s) {
      return { md: s.md, gt: Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz), bz: SC.zBias(s, mv),
        dbt: Math.sqrt(s.bx * s.bx + s.by * s.by + s.bz * s.bz) - mv.bt, ddip: SC.dip(s) - mv.dip };
    });
    if (v.length === 0) return { rows: [], trends: null };
    if (v.length === 1) return { rows: [{ fail: null, dBT: v[0].dbt, dDipDeg: v[0].ddip * R2D, gt: v[0].gt, bzBias: v[0].bz }], trends: null };
    function fit(k, jump) { return quadFit(v.map(function (o) { return [o.md, o[k]]; }), jump); }
    var T = { dbt: fit('dbt', 100), ddip: fit('ddip', 0.00175), gt: fit('gt', 0.0005), bz: fit('bz', 100) };
    function y(q, x) { return (q.a * x * x) + (q.b * x) + q.c; }
    var rows = v.map(function (o) {
      var f = null;
      if (Math.abs(o.dbt - y(T.dbt, o.md)) > tol.bt) f = 'BT';
      if (Math.abs(o.gt - y(T.gt, o.md)) > tol.gt) f = 'GT';
      if (Math.abs(o.ddip - y(T.ddip, o.md)) > tol.dipDeg * D2R) f = 'Dip';
      if (Math.abs(o.bz - y(T.bz, o.md)) > tol.bz) f = 'Bz';
      return { fail: f, dBT: o.dbt, dDipDeg: o.ddip * R2D, gt: o.gt, bzBias: o.bz };
    });
    return { rows: rows, trends: T };
  }

  return { run: run, corrections: corrections, autoQc: autoQc, applyCorr: applyCorr, quadFit: quadFit };
}));

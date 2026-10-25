// ---------------------------------------------------------------------------
// shortCollarModel.js — Short Collar (axial magnetic interference) correction
// Added 2026-10-25 for the Short Collar accordion in views/sixAxisData.ejs.
//
// SOURCE OF TRUTH: SurQC (C#), ported line-for-line from
//   Analysis/ShortCollar.cs                    (ShortCollarZBias, BzFromBTotalBxBy,
//                                               SquareRootWithSignDetermined)
//   Analysis/ShortCollarAnalysis.cs            (per-station corrections + average
//                                               Z-bias excluding flagged stations)
//   Analysis/AnalysisWithUncertainty.cs        (azimuth uncertainty: re-run with
//                                               BT and dip at Low/High, max |dAz|)
//   Analysis/AnalysisExtensionMethods.cs       (WithZBias: Bz + zBias)
//   Surveys/LongSurveyMeasurement.cs           (Inc, Toolface, least-squares Az
//                                               using the reference Mn/Mv)
//   Surveys/SurveyMeasurementExtensions.cs     (Dip = asin(G.B/(|G||B|)))
//   GravityAndMagnetics/MagneticVector.cs      (Mn = BT cos(dip), Me = 0, Mv = BT sin(dip))
//   AnglesAndDistances/Angle.cs                (Atan2ToAngle = pi/2 - atan2, wrap to (-pi,pi])
//   Analysis/BasicQc.cs                        (auto-exclusion: |dip-refDip| > tol, else
//                                               |BT-refBT| > tol)
// Literature: ISCWSA eBook (2017) App. D6 — short-collar formula
//   Bz = ±sqrt(BT^2 - Bx^2 - By^2); known to be unstable when the along-hole
//   component is small (near-horizontal E/W). ISCWSA Rev5.13 §6.2.1 — short-
//   collar-corrected MWD uses its own sensor-term set (the "+AX" toolcodes).
//
// VALIDATION: compared against the REAL SurQC classes compiled headless
// (.NET 8 harness, /tmp/claude-0/sch) — see claude/shortcollar-status.md.
//
// DOCUMENTED DEVIATION (opt-in flag, default ON in the UI): SurQC computes the
// per-station uncertainty as new Angle(|Az_a - Az_b|), and Angle wraps values
// > pi to negative, so a station whose azimuth straddles +/-180 deg magnetic
// can return a negative/near-zero uncertainty. wrapSafe=true takes the
// shortest angular difference instead; results are identical to SurQC
// everywhere else. wrapSafe=false reproduces SurQC exactly (used by the test).
//
// Units: any consistent magnetic unit (nT or uT) for Bx/By/Bz, BT and BT
// uncertainty; gravity in any unit; angles in/out in DEGREES.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShortCollarModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;

  // Angle.EnsureValueIsBetweenMinusPiandPi (C# (int) cast truncates toward 0)
  function wrapPi(v) {
    var n = Math.trunc(v / TWO_PI);
    v -= n * TWO_PI;
    if (v < -Math.PI) v += TWO_PI; else if (v > Math.PI) v -= TWO_PI;
    return v;
  }
  function atan2ToAngle(r) { return wrapPi(Math.PI / 2 - r); } // Angle.Atan2ToAngle

  // MagneticVector(totalFieldStrength, dip)
  function magVector(bt, dipRad) { return { bt: bt, dip: dipRad, mn: bt * Math.cos(dipRad), me: 0, mv: bt * Math.sin(dipRad) }; }

  function gTot(s) { return Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz); }
  function bTot(s) { return Math.sqrt(s.bx * s.bx + s.by * s.by + s.bz * s.bz); }

  // LongSurveyMeasurement.Inc
  function inc(s) { var t = gTot(s); return t === 0 ? 0 : wrapPi(Math.acos(s.gz / t)); }
  // LongSurveyMeasurement.Toolface
  function toolface(s) { var t = gTot(s); return atan2ToAngle(Math.atan2(-1 * (s.gx / t), s.gy / t)); }
  // LongSurveyMeasurement.Az (magnetic, radians) — least-squares in sin/cos(az)
  function magAz(s, mvec) {
    var i = inc(s);
    if (i === 0) return 0;
    var tf = toolface(s);
    var mn = mvec.mn, mv = mvec.mv;
    var sI = Math.sin(i), cI = Math.cos(i), sT = Math.sin(tf), cT = Math.cos(tf);
    var k1 = -1 * sT * mn, k2 = cI * cT * mn, k3 = -1 * cT * mn, k4 = -1 * cI * sT * mn, k5 = 0, k6 = sI * mn;
    var k7 = s.bx + (sI * cT * mv), k8 = s.by - (sI * sT * mv), k9 = s.bz - (cI * mv);
    var a00 = k1 * k1 + k3 * k3 + k5 * k5, a01 = k1 * k2 + k3 * k4 + k5 * k6, a11 = k2 * k2 + k4 * k4 + k6 * k6;
    var r0 = k1 * k7 + k3 * k8 + k5 * k9, r1 = k2 * k7 + k4 * k8 + k6 * k9;
    var det = a00 * a11 - a01 * a01, f = 1.0 / det;            // Matrix2x2.Inverse
    var x0 = f * (a11 * r0 + (-1 * a01) * r1), x1 = f * ((-1 * a01) * r0 + a00 * r1);
    return atan2ToAngle(Math.atan2(x1, x0));
  }
  // SurveyMeasurementExtensions.Dip
  function dip(s) {
    var den = gTot(s) * bTot(s);
    return den === 0 ? 0 : Math.asin((s.gx * s.bx + s.gy * s.by + s.gz * s.bz) / den);
  }
  // ShortCollar.ShortCollarZBias (= BzFromBTotalBxBy - Bz)
  function zBias(s, mvec) {
    var sq = mvec.bt * mvec.bt - s.bx * s.bx - s.by * s.by;
    if (sq < 0) sq = 0;
    var calc = s.bz >= 0 ? Math.sqrt(sq) : -1 * Math.sqrt(sq); // both C# branches identical
    return calc - s.bz;
  }
  function withZBias(s, zb) { return { md: s.md, gx: s.gx, gy: s.gy, gz: s.gz, bx: s.bx, by: s.by, bz: s.bz + zb }; }

  // BasicQc.QcMeasurement — returns null | 'dip' | 'bt'
  function basicQc(s, ref, tol) {
    if (Math.abs(dip(s) - ref.dip) > tol.dipRad) return 'dip';
    if (Math.abs(bTot(s) - ref.bt) > tol.bt) return 'bt';
    return null;
  }

  // ShortCollarAnalysis: per-station corrections + average excluding flagged
  function analysis(stations, mvec, excludeSet) {
    var corr = [], sum = 0;
    stations.forEach(function (s, i) { var c = zBias(s, mvec); corr.push(c); if (!excludeSet.has(i)) sum += c; });
    var n = stations.length - excludeSet.size;
    return { corrections: corr, average: n > 0 ? sum / n : NaN };
  }

  /**
   * run(opts)
   *  stations: [{md,gx,gy,gz,bx,by,bz}]
   *  ref: {bt, dipDeg, decDeg}           reference field (BT in same unit as B)
   *  unc: {bt, dipDeg}                   uncertainty magnitudes (SurQC hi/lo)
   *  exclude: array of station indices excluded from the AVERAGE (SurQC semantics)
   *  apply: 'station' (SurQC CorrectedSurvey) | 'average'
   *  wrapSafe: see header note
   */
  function run(opts) {
    var st = opts.stations, ref = opts.ref, unc = opts.unc || { bt: 0, dipDeg: 0 };
    var ex = new Set(opts.exclude || []);
    var mv0 = magVector(ref.bt, ref.dipDeg * D2R);
    var dec = (ref.decDeg || 0) * D2R;
    var base = analysis(st, mv0, ex);
    var useAvg = opts.apply === 'average';
    var applied = st.map(function (_, i) { return useAvg ? base.average : base.corrections[i]; });
    function azList(corrs) { return st.map(function (s, i) { return magAz(withZBias(s, corrs[i]), mv0); }); }
    var azC = azList(applied);

    // AnalysisWithUncertainty.HiLoCorrections — order LL, LH, HL, HH
    var pairs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    var diffs = pairs.map(function (p) {
      var mv = magVector(ref.bt + p[0] * unc.bt, (ref.dipDeg + p[1] * unc.dipDeg) * D2R);
      var a = analysis(st, mv, ex);
      var c2 = st.map(function (_, i) { return useAvg ? a.average : a.corrections[i]; });
      var az2 = azList(c2);
      return az2.map(function (z, i) {
        return opts.wrapSafe ? Math.abs(wrapPi(azC[i] - z)) : wrapPi(Math.abs(azC[i] - z));
      });
    });

    var rows = st.map(function (s, i) {
      var sc = withZBias(s, applied[i]);
      var i0 = inc(s), vert = i0 === 0; // MagneticAzimuth.ToTrue: vertical -> 0
      var azM = magAz(s, mv0), azCorr = azC[i];
      var u = Math.max.apply(null, diffs.map(function (d) { return d[i]; }));
      var dAz = wrapPi(azCorr - azM);
      return {
        md: s.md, inc: i0 * R2D, tf: toolface(s) * R2D,
        azMag: azM * R2D, azTrue: vert ? 0 : norm360((azM + dec) * R2D),
        bzMeas: s.bz, zBias: base.corrections[i], bzApplied: applied[i], bzCorr: sc.bz,
        azMagCorr: azCorr * R2D, azTrueCorr: vert ? 0 : norm360((azCorr + dec) * R2D),
        dAz: dAz * R2D,
        btMeas: bTot(s), dipMeas: dip(s) * R2D, btCorr: bTot(sc), dipCorr: dip(sc) * R2D,
        azUnc: u * R2D, excluded: ex.has(i),
        sqrtClamped: (ref.bt * ref.bt - s.bx * s.bx - s.by * s.by) < 0
      };
    });
    return { rows: rows, averageZBias: base.average, nUsed: st.length - ex.size };
  }
  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }

  return { run: run, basicQc: basicQc, inc: inc, toolface: toolface, magAz: magAz, dip: dip, zBias: zBias, magVector: magVector, wrapPi: wrapPi };
}));

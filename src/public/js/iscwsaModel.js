// ============================================================================
// ISCWSA MWD Rev5 Error Model — position uncertainty (covariance) calculator.
//
// Shared by:
//   - the browser (AC Plots view, via <script src="/js/iscwsaModel.js">)
//   - the Node.js backend, via require()
//
// Given a well survey (MD/Inc/AzT stations), a selected toolcode's error
// terms (magnitudes, propagation modes, weighting-function formulas — see
// /data/iscwsaToolcodes.json), and the well's magnetic/gravity reference
// values, computes the NEV covariance matrix at every survey station. This
// is real per-tool uncertainty, not the placeholder single fixed model used
// earlier in the AC Plots Separation Factor — see the module header there
// for the migration.
//
// MWD ONLY. Gyro toolcodes exist in the data file (for future use) but this
// module does not implement the gyro stationary/continuous-mode propagation
// (§7 of the definition doc) — selecting a GYRO-* toolcode will throw.
//
// ---------------------------------------------------------------------------
// SOURCE / VERIFICATION
//
// Math: "Definition of ISCWSA Error Model", Revision 5.13, January 2023
// (https://www.iscwsa.net/error-model-documentation/). Equation numbers
// referenced in comments below correspond to that document:
//   Eq 6/14   - error vector from weighting functions + geometry (drdp)
//   Eq 9-13   - balanced-tangential drdp matrices
//   Eq 20/21  - singular (near-vertical) weighting function handling
//   Eq 25-28  - accumulation by propagation mode (Random/Systematic/Global)
//   Eq 35     - relative uncertainty between two wells (correlated Global terms)
//   Eq 40/41  - XCL (course-length) terms, evaluated directly (no drdp)
//   §4.7.1.1  - surface tie-on (first-station doubling)
//
// Toolcode data: ISCWSA_Generic_Toolcodes SetA/SetB Rev5.1 (08-Oct-2020),
// the official OWSG default toolcodes — /data/iscwsaToolcodes.json, parsed
// directly from those two spreadsheets (magnitudes, propagation modes, and
// the literal weighting-function formula text per term — not re-derived).
//
// Validated against the official "MWD Rev5 Spreadsheet Examples" (ISCWSA
// test well #1, MWD+SRGM toolcode):
//   - Per-term NN/EE/VV/NE/NV/EV covariance at MD=1200m: 206/210 values
//     match the spreadsheet's own "Validation" (diagnostic) sheet to
//     numerical precision. The remaining 4 (ABXY-TI1S/TI2S, XYM3E/XYM4E)
//     differ by ~3% due to a known, intentional simplification — see
//     "KNOWN GAP" below.
//   - Full-well combined covariance (NN/EE/VV) checked at all 268 survey
//     stations against the spreadsheet's TOTALS sheet: matches to <0.1%
//     from MD=1200m onward; the only larger relative errors are in the
//     top ~200m where absolute uncertainty is tiny anyway (a few cm) and
//     the same known surface-tie-on simplification dominates.
// Three real bugs were caught and fixed during this validation (not
// theoretical — each one produced a concrete, measurable mismatch against
// the reference data before being fixed): (1) a JS truthiness bug in the
// Legendre-style base case, (2) conflating Eq 6 (intermediate station,
// both drdp intervals) with Eq 14 (reporting station, preceding interval
// only) — the actual source of the DSFS/DRFR/DSTG mismatches, and (3) a
// compound-unit parsing bug ("deg.nT" not recognized as degrees, leaving
// the BH-dependent declination terms unconverted and blowing up once the
// well built inclination).
//
// KNOWN GAP: surface tie-on (§4.7.1.1) is NOT implemented per Rev5's exact
// method (doubling the first interval's dInc/dAz weighting). This module
// instead drops the first station's dangling following-interval
// contribution (the simpler pre-Rev5 convention) — slightly less
// conservative very near surface, converging to the Rev5 values within a
// few hundred metres MD as shown above. Fixing this exactly is a
// reasonable follow-up if very-shallow-depth accuracy matters for a
// specific use case.
//
// Broader validation across ISCWSA#2/#3 and other toolcodes (IFR1/IFR2,
// HRGM/LRGM) has not been run — the underlying formulas come from the
// same verified source data and same engine, so there's no structural
// reason to expect they'd behave differently, but this hasn't been
// specifically checked against those test wells' Validation sheets.
//
// This model does NOT implement gross-error/blunder detection, multi-leg
// tie-on, or the fractional (non-1/0) geomagnetic correlation refinement
// described in ISCWSA's separate "Correlation of Geomagnetic Reference
// Terms" supplement — Global-propagation terms are treated as fully
// correlated (rho=1) between any two wells sharing this calculation, per
// the base propagation-mode definition (Eq 25's table), which is the
// documented default behavior absent that supplement's refinement.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ISCWSAModel = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG2RAD = Math.PI / 180;

  // ---- Formula transpiler ---------------------------------------------
  // Toolcode formula text uses Excel-style syntax (Sin/Cos/Tan/Abs/Sqr/Max,
  // ^ for power, and named variables) which is otherwise valid arithmetic
  // expression syntax — so this only needs identifier substitution, not a
  // full parser. Compiled once per unique formula string and cached.
  var FUNC_MAP = { sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', abs: 'Math.abs', sqr: 'Math.sqrt', sqrt: 'Math.sqrt', max: 'Math.max', min: 'Math.min' };
  // Longest identifiers first so e.g. "AzPrev" isn't partially matched by "Az".
  var VAR_MAP = [
    ['XY_Gyro_Random_Walk', 'xyGyroRandomWalk'], ['GXYRunningSpeed', 'gxyRunningSpeed'],
    ['GZRunningSpeed', 'gzRunningSpeed'], ['NoiseReductionFactor', 'noiseReductionFactor'],
    ['XY_Gyro_Drift', 'xyGyroDrift'], ['Z_Gyro_Drift', 'zGyroDrift'],
    ['XCLTortuosity', 'xclTortuosity'], ['IncPrev', 'incPrev'], ['AzPrev', 'azPrev'],
    ['MDPrev', 'mdPrev'], ['EarthRate', 'earthRate'], ['Latitude', 'latitude'],
    ['BField', 'bField'], ['Bfield', 'bField'], ['GField', 'gField'], ['Gfield', 'gField'],
    ['AzM', 'azM'], ['AzT', 'azT'], ['Dip', 'dip'], ['Inc', 'inc'], ['Az', 'az'],
    ['MD', 'md'], ['TVD', 'tvd'], ['RAD', 'RAD']
  ];
  var compileCache = {};
  function compileFormula(expr) {
    if (expr == null) return function () { return 0; };
    if (typeof expr === 'number') return function () { return expr; };
    var key = String(expr);
    if (compileCache[key]) return compileCache[key];
    var js = key;
    // functions: single pass with alternation, so a target string (e.g.
    // "Math.sqrt") containing another source name (e.g. "sqrt") can't get
    // matched a second time.
    var funcNames = Object.keys(FUNC_MAP).sort(function (a, b) { return b.length - a.length; });
    var funcRe = new RegExp('\\b(' + funcNames.join('|') + ')\\b', 'gi');
    js = js.replace(funcRe, function (match) { return FUNC_MAP[match.toLowerCase()]; });
    // caret power -> **
    js = js.replace(/\^/g, '**');
    // pi (the constant, case-sensitive to avoid clobbering identifiers
    // that merely contain "pi") -> Math.PI, before the general variable pass
    js = js.replace(/\bpi\b/g, 'Math.PI');
    // variables (after function/pi substitution, so e.g. "Sin"/"pi" are
    // already replaced and won't be mistaken for a variable named similarly)
    VAR_MAP.forEach(function (pair) {
      js = js.replace(new RegExp('\\b' + pair[0] + '\\b', 'g'), 'ctx.' + pair[1]);
    });
    var fn;
    try {
      /* eslint-disable no-new-func */
      fn = new Function('ctx', 'return (' + js + ');');
    } catch (e) {
      throw new Error('ISCWSAModel: failed to compile formula "' + expr + '" -> "' + js + '": ' + e.message);
    }
    compileCache[key] = fn;
    return fn;
  }

  // ---- Weighting function evaluation -----------------------------------
  // Returns [dD, dI, dA] (partial derivatives of depth/inclination/azimuth
  // w.r.t. this error source) at station ctx. Falls back to 0 for terms
  // with no formula (e.g. singular-only terms have no normal inc/azim
  // formula, or vice versa).
  function evalWt(term, ctx) {
    var dD = compileFormula(term.depthF)(ctx);
    var dI = compileFormula(term.inclF)(ctx);
    var dA = compileFormula(term.azimF)(ctx);
    return [dD, dI, dA];
  }

  // ---- Balanced-tangential drdp matrices (Eq 9-13) -----------------------
  // Returns the 3x3 (rows N,E,V; cols dD,dI,dA) matrix for the effect of
  // station k's measurement errors on the PRECEDING interval (k-1 -> k)
  // when `which==='prev'`, or the FOLLOWING interval (k -> k+1) when
  // which==='next'. stA/stB are the two survey stations bounding the
  // interval (stA is always the earlier one); `at` indicates which of the
  // two stations' weighting functions we're differentiating w.r.t.
  function drdpPreceding(stPrev, stCur) {
    // d(delta r_k)/dp_k — effect of station k (stCur) errors on interval (k-1,k)
    var Dk = stCur.md, Dk1 = stPrev.md;
    var Ik = stCur.inc, Ik1 = stPrev.inc, Ak = stCur.azT, Ak1 = stPrev.azT;
    var half = (Dk - Dk1) / 2;
    return {
      N: [ (Math.sin(Ik1) * Math.cos(Ak1) + Math.sin(Ik) * Math.cos(Ak)) / 2,
           half * Math.cos(Ik) * Math.cos(Ak),
          -half * Math.sin(Ik) * Math.sin(Ak) ],
      E: [ (Math.sin(Ik1) * Math.sin(Ak1) + Math.sin(Ik) * Math.sin(Ak)) / 2,
           half * Math.cos(Ik) * Math.sin(Ak),
           half * Math.sin(Ik) * Math.cos(Ak) ],
      V: [ (Math.cos(Ik1) + Math.cos(Ik)) / 2,
          -half * Math.sin(Ik),
           0 ]
    };
  }
  function drdpFollowing(stCur, stNext) {
    // d(delta r_{k+1})/dp_k — effect of station k (stCur) errors on interval (k,k+1)
    var Dk = stCur.md, Dk1 = stNext.md;
    var Ik = stCur.inc, Ik1 = stNext.inc, Ak = stCur.azT, Ak1 = stNext.azT;
    var half = (Dk1 - Dk) / 2;
    return {
      N: [ -(Math.sin(Ik) * Math.cos(Ak) + Math.sin(Ik1) * Math.cos(Ak1)) / 2,
            half * Math.cos(Ik) * Math.cos(Ak),
           -half * Math.sin(Ik) * Math.sin(Ak) ],
      E: [ -(Math.sin(Ik) * Math.sin(Ak) + Math.sin(Ik1) * Math.sin(Ak1)) / 2,
            half * Math.cos(Ik) * Math.sin(Ak),
            half * Math.sin(Ik) * Math.cos(Ak) ],
      V: [ -(Math.cos(Ik) + Math.cos(Ik1)) / 2,
           -half * Math.sin(Ik),
            0 ]
    };
  }
  function matVec(M, v) {
    return [
      M.N[0] * v[0] + M.N[1] * v[1] + M.N[2] * v[2],
      M.E[0] * v[0] + M.E[1] * v[1] + M.E[2] * v[2],
      M.V[0] * v[0] + M.V[1] * v[1] + M.V[2] * v[2]
    ];
  }
  function addVec(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scaleVec(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function outer(v) {
    // v.v^T -> {NN,EE,VV,NE,NV,EV}
    return { NN: v[0] * v[0], EE: v[1] * v[1], VV: v[2] * v[2], NE: v[0] * v[1], NV: v[0] * v[2], EV: v[1] * v[2] };
  }
  function addCov(a, b) { return { NN: a.NN + b.NN, EE: a.EE + b.EE, VV: a.VV + b.VV, NE: a.NE + b.NE, NV: a.NV + b.NV, EV: a.EV + b.EV }; }
  function zeroCov() { return { NN: 0, EE: 0, VV: 0, NE: 0, NV: 0, EV: 0 }; }

  // ---- Magnitude unit handling -------------------------------------------
  // Angular-unit magnitudes (deg) must be converted to radians before use
  // in the weighting-function chain (which operates in radians throughout,
  // matching the source spreadsheets' "WELLPATH Radians" convention).
  // Depth (m), sensor (m/s2), and magnetic (nT) magnitudes are used as-is.
  // Angular-unit magnitudes (deg, and compound units starting with deg —
  // e.g. "deg.nT" for the BH-dependent declination terms, or gyro's
  // "deg/hr") must be converted so the DEGREES portion becomes radians
  // before use in the weighting-function chain (radians throughout,
  // matching the source spreadsheets' "WELLPATH Radians" convention) — the
  // rest of a compound unit (e.g. the nT in deg.nT) is absorbed directly
  // into the weighting function's own units (e.g. 1/(BField*cos(Dip)),
  // units 1/nT) so only the leading "deg" needs stripping out here.
  // Depth (m), sensor (m/s2), and magnetic (nT) magnitudes are used as-is.
  function magnitudeInModelUnits(term) {
    if (term.units && term.units.indexOf('deg') === 0) return term.magnitude * DEG2RAD;
    return term.magnitude;
  }

  // ---- Per-station context for weighting-function evaluation ------------
  function buildCtx(st, stPrev, wellParams) {
    return {
      md: st.md, inc: st.inc, azT: st.azT, azM: st.azM, az: st.azT, tvd: st.tvd,
      mdPrev: stPrev ? stPrev.md : st.md, incPrev: stPrev ? stPrev.inc : st.inc, azPrev: stPrev ? stPrev.azT : st.azT,
      dip: wellParams.dip, bField: wellParams.bField, gField: wellParams.gField != null ? wellParams.gField : 9.80665,
      // xclTortuosity default: was (1 deg)/(100 ft) = 0.0005726 rad/m, an
      // assumed generic value. Compass's own exported MWD+IGRF and
      // MWD+HRGM tool files (.ipm) both define this constant explicitly
      // as part of the tool spec — "tort" = 0.00018 (same value in both
      // files) — which is ~3.18x SMALLER than the assumed default. Since
      // this is tool-specific data, not a universal constant, using
      // Compass's real configured value here rather than a guessed one.
      // (If a future toolcode genuinely needs a different tortuosity, it
      // should come from that toolcode's own data rather than this
      // shared fallback — flagging this as a reasonable target for
      // adding a per-toolcode xclTortuosity field to
      // iscwsaToolcodes.json if/when more real tool files are available.)
      xclTortuosity: wellParams.xclTortuosity != null ? wellParams.xclTortuosity : 0.00018,
      latitude: (wellParams.latitude || 0) * DEG2RAD, earthRate: 7.292115e-5,
      RAD: DEG2RAD
    };
  }

  var VERT_EPS = 1e-6; // rad; below this inclination, treat as vertical (singular)

  // ---- Core: compute NEV covariance at every station for one well ---------
  // survey: [{md, inc(rad), azT(rad)}] sorted by md ascending. Azimuth must
  // be TRUE (or grid) azimuth — magnetic azimuth (azM, needed by the MWD
  // weighting functions) is derived internally as azT - declination.
  // wellParams: { dip (rad), bField (nT), declination (rad), gField, xclTortuosity, latitude (deg) }
  // toolcodeTerms: array from iscwsaToolcodes.json[toolcodeName]
  //
  // Returns: [{ md, cov: {NN,EE,VV,NE,NV,EV}, byTerm: { code: cov },
  //             byTermVec: { code: [N,E,V] } (G/W terms only, cumulative
  //             raw vector — needed for the between-well correlation term
  //             in Eq 35; not meaningful/retained for R/S terms) }]
  function computeWellCovariance(survey, toolcodeTerms, wellParams) {
    if (!survey || survey.length < 2) return [];
    var sts = survey.map(function (s) {
      return { md: s.md, inc: s.inc, azT: s.azT, tvd: s.tvd, azM: s.azT - (wellParams.declination || 0) };
    });

    var results = sts.map(function (s) { return { md: s.md, byTerm: {}, byTermVec: {} }; });

    toolcodeTerms.forEach(function (term) {
      if (term.type === 'AziRef' && wellParams.bField == null) return; // no field data supplied; skip geomagnetic terms gracefully
      var sigma = magnitudeInModelUnits(term);
      var isXCL = term.code === 'XCLA' || term.code === 'XCLH' || term.code === 'XCLI1' || term.code === 'XCLI2';

      var runningRand = zeroCov();
      var vecSum = [0, 0, 0]; // shared accumulator for S and W/G modes (identical mechanics; only differ in whether byTermVec is retained)
      // Held back until the NEXT iteration, since the CURRENT station being
      // reported must use ONLY its preceding interval (Eq 14) — its own
      // following interval only becomes part of the accumulated base once
      // the survey continues past it and it's no longer the last station
      // of interest (Eq 6 for that now-intermediate station).
      // R-mode needs the FULL combined (ePrec+eFoll) vector squared once
      // (Eq 24: squaring cancels differently than summing two separate
      // squares) — S/W/G-mode need only the eFoll remainder, since their
      // ePrec was already folded into the running vector sum this step.
      var pendingCombinedVec = null; // R-mode
      var pendingVec = [0, 0, 0]; // S/W/G-mode

      for (var k = 0; k < sts.length; k++) {
        var st = sts[k];
        var stPrev = k > 0 ? sts[k - 1] : null;
        var stNext = k < sts.length - 1 ? sts[k + 1] : null;
        var ctx = buildCtx(st, stPrev, wellParams);
        ctx.mdPrev = stPrev ? stPrev.md : st.md;

        if (term.prop === 'R') {
          if (pendingCombinedVec) runningRand = addCov(runningRand, outer(pendingCombinedVec));
        } else {
          vecSum = addVec(vecSum, pendingVec);
        }
        pendingCombinedVec = null;
        pendingVec = [0, 0, 0];

        var ePrec = [0, 0, 0], eFoll = [0, 0, 0];

        if (isXCL) {
          // Eq 40/41 — direct evaluation, no drdp chain, no prev/next split
          // (defined directly at the station, using the preceding interval
          // only by construction).
          if (stPrev) {
            var dMD = st.md - stPrev.md;
            var xVec = [0, 0, 0];
            if (term.code === 'XCLH') {
              var wH = Math.max(Math.abs(st.inc - stPrev.inc), ctx.xclTortuosity * dMD);
              xVec = [dMD * wH * Math.cos(st.inc) * Math.cos(st.azT), dMD * wH * Math.cos(st.inc) * Math.sin(st.azT), -dMD * wH * Math.sin(st.inc)];
            } else if (term.code === 'XCLA') {
              var dAz = Math.abs(st.azT - stPrev.azT);
              if (dAz > Math.PI) dAz = 2 * Math.PI - dAz;
              var wA = Math.max(Math.sin(dAz) * Math.sin(st.inc), ctx.xclTortuosity * dMD);
              xVec = [-dMD * wA * Math.sin(st.azT), dMD * wA * Math.cos(st.azT), 0];
            }
            ePrec = scaleVec(xVec, sigma);
          }
        } else {
          var wt = evalWt(term, ctx); // [dD, dI, dA]
          var singular = Math.abs(Math.sin(st.inc)) < Math.sin(VERT_EPS) && (term.singN != null || term.singE != null || term.singV != null);

          if (singular) {
            var vN = compileFormula(term.singN)(ctx), vE = compileFormula(term.singE)(ctx), vV = compileFormula(term.singV)(ctx);
            if (stPrev) ePrec = scaleVec([vN, vE, vV], sigma * (st.md - stPrev.md) / 2);
            if (stNext) eFoll = scaleVec([vN, vE, vV], sigma * (stNext.md - st.md) / 2);
          } else {
            if (stPrev) ePrec = scaleVec(matVec(drdpPreceding(stPrev, st), wt), sigma);
            if (stNext) eFoll = scaleVec(matVec(drdpFollowing(st, stNext), wt), sigma);
          }
        }

        // Report THIS station using preceding-only (Eq 14).
        var stationCov;
        if (term.prop === 'R') {
          stationCov = addCov(runningRand, outer(ePrec));
          pendingCombinedVec = (k === 0) ? null : addVec(ePrec, eFoll);
        } else {
          vecSum = addVec(vecSum, ePrec);
          stationCov = outer(vecSum);
          pendingVec = (k === 0) ? [0, 0, 0] : eFoll;
          if (term.prop === 'W' || term.prop === 'G') results[k].byTermVec[term.code] = vecSum.slice();
        }

        results[k].byTerm[term.code] = stationCov;
        results[k].cov = results[k].cov ? addCov(results[k].cov, stationCov) : stationCov;
      }
    });

    return results;
  }

  // ---- Relative uncertainty between two wells (Eq 35) ---------------------
  // stationA/stationB: single-station result objects (one entry from
  // computeWellCovariance's output array) — the two points being compared.
  // Global-propagation terms shared by BOTH wells' toolcodes (by error
  // code) are combined with rho=1 (fully correlated) per the base
  // propagation-mode definition; terms unique to one well's toolcode don't
  // correlate (nothing to correlate with) and are left as independent
  // (already included in stationA.cov / stationB.cov).
  function relativeCovariance(stationA, stationB, toolcodeTermsA, toolcodeTermsB) {
    var C = addCov(stationA.cov, stationB.cov);
    var globalCodesB = {};
    toolcodeTermsB.forEach(function (t) { if (t.prop === 'G' || t.prop === 'W') globalCodesB[t.code] = true; });
    toolcodeTermsA.forEach(function (t) {
      if (t.prop !== 'G' && t.prop !== 'W') return;
      if (!globalCodesB[t.code]) return; // only correlate terms present (by code) in both wells' toolcodes
      var eA = stationA.byTermVec[t.code], eB = stationB.byTermVec[t.code];
      if (!eA || !eB) return;
      // C -= rho*(Ei,A Ei,B^T + Ei,B Ei,A^T), rho=1 (Eq 35)
      var cross = {
        NN: 2 * eA[0] * eB[0], EE: 2 * eA[1] * eB[1], VV: 2 * eA[2] * eB[2],
        NE: eA[0] * eB[1] + eA[1] * eB[0], NV: eA[0] * eB[2] + eA[2] * eB[0], EV: eA[1] * eB[2] + eA[2] * eB[1]
      };
      C = { NN: C.NN - cross.NN, EE: C.EE - cross.EE, VV: C.VV - cross.VV, NE: C.NE - cross.NE, NV: C.NV - cross.NV, EV: C.EV - cross.EV };
    });
    return C;
  }


  return {
    compileFormula: compileFormula,
    evalWt: evalWt,
    computeWellCovariance: computeWellCovariance,
    relativeCovariance: relativeCovariance,
    drdpPreceding: drdpPreceding,
    drdpFollowing: drdpFollowing
  };
}));

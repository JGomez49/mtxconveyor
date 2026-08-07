// ============================================================================
// Casing Design — pipe capacity ratings + triaxial (von Mises) stress core.
//
// Shared by:
//   - the browser (casing design views, via <script src="/js/casingModel.js">)
//   - the Node.js backend (notes.controller.js, via require())
//
// These functions are pure: they take pipe/load data as plain numbers and
// return plain data — no DOM access, no UI state. Do not add any
// document/window references here, or the server-side require() will break.
//
// UNIT CONVENTION: the rest of Conveyor (tdModel.js, casings[] on job.ejs)
// works in SI (m, N, Pa). The API/SPE formulas below are empirical
// regressions published and calibrated in US field units (in, psi, lbf) —
// their numeric constants are NOT dimensionally general, so converting them
// to SI by simple substitution would silently corrupt the fit. To keep the
// formulas exactly as published (and therefore checkable against the
// references below), all internal calculation in this module is done in
// field units; every exported function converts SI in -> field units at
// entry and field units -> SI at return. Look for the "SI wrapper" comment
// on each exported function.
//
// ---------------------------------------------------------------------------
// REFERENCES (physics basis — cite these when reporting results)
//
// [1] API Bulletin 5C3 (1994) / API TR 5C3 (current) — "Technical Report on
//     Equations and Calculations for Casing, Tubing, and Line Pipe Used as
//     Casing or Tubing." Continuous (grade-independent) regression form of
//     the collapse-pressure equations, using minimum yield strength (Yp)
//     directly rather than the older discrete per-grade table.
//        -> collapseFactors(), collapsePressure_psi()
// [2] Bourgoyne, A.T. et al. (1984). "Applied Drilling Engineering."
//     SPE Textbook Series Vol. 2, Chapter 7 (Casing Design).
//       Eq. 7.1  - pipe body yield (tensile) strength
//       Eq. 7.2  - API internal yield (burst) pressure, Barlow eqn w/ 0.875
//                  minimum-wall-thickness factor
//       Eq. 7.4a/7.4b, 7.5a, 7.6a/7.6b, 7.7 - the four collapse regimes
//                  (yield-strength, plastic, transition, elastic) and their
//                  d/t range boundaries
//       Eq. 7.12 - "ellipse of plasticity": effective yield strength under
//                  combined axial + collapse (biaxial) loading, used to
//                  derate collapse rating for axial tension/compression.
//                  Independently confirmed against this well's uploaded
//                  "K&M Tubular Performance Calculator v6.4" spreadsheet,
//                  which implements the identical formula.
//       Eq. 7.22 - dogleg-induced bending stress, beam-on-curved-axis
//                  (E * OD/2 * curvature, curvature from DLS in deg/100ft)
//        -> ellipseOfPlasticity(), bendingStress_psi()
// [3] Lamé, G. (1852). "Leçons sur la théorie mathématique de l'élasticité
//     des corps solides." Thick-wall cylinder radial/hoop stress under
//     internal + external pressure — the basis of sr()/sTheta() below, used
//     throughout API TR 5C3 and every commercial triaxial (VME) casing
//     design tool (Landmark WellCat/StressCheck, K&M calculator, etc.)
//        -> radialStress_psi(), hoopStress_psi()
// [4] von Mises, R. (1913). "Mechanik der festen Körper im plastisch
//     deformablen Zustand." Distortion-energy yield criterion, applied here
//     in its standard triaxial-cylindrical form:
//        svm = sqrt(sz^2+sr^2+st^2 - sr*st - st*sz - sr*sz + 3*tau^2)
//        -> vonMisesStress_psi()
// [5] Grade minimum-yield-strength (Yp) values are the published API 5CT
//     Table values (standard, non-proprietary): H40=40000, J55/K55=55000,
//     N80/L80=80000, C90=90000, T95=95000, C110=110000, P110=110000,
//     Q125=125000 psi.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CasingModel = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- unit conversion helpers ------------------------------------------
  var IN2M = 0.0254;
  var M2IN = 1 / IN2M;
  var PSI2PA = 6894.757293168;
  var PA2PSI = 1 / PSI2PA;
  var LBF2N = 4.4482216152605;
  var N2LBF = 1 / LBF2N;

  // ---- standard API 5CT minimum yield strengths (psi) --------------------
  // Non-proprietary, published grade table. Extend as needed for project-
  // specific/proprietary grades by passing a numeric MYS_psi directly
  // instead of a grade string (see resolveMYS_psi()).
  var GRADE_MYS_PSI = {
    'H40': 40000, 'J55': 55000, 'K55': 55000, 'M65': 65000,
    'N80': 80000, 'L80': 80000, 'C90': 90000, 'C95': 95000, 'T95': 95000,
    'C110': 110000, 'P110': 110000, 'Q125': 125000, 'S135': 135000,
    'G105': 105000, 'V150': 150000
  };

  function resolveMYS_psi(gradeOrPsi) {
    if (typeof gradeOrPsi === 'number') return gradeOrPsi;
    var key = String(gradeOrPsi).toUpperCase().replace(/[\s-]/g, '');
    if (GRADE_MYS_PSI[key] != null) return GRADE_MYS_PSI[key];
    throw new Error('CasingModel: unknown grade "' + gradeOrPsi + '" — pass MYS in psi directly for non-standard/proprietary grades.');
  }

  // ---- pipe geometry (field units: inches, in^2, in^4) --------------------
  // od_in/id_in: pipe body outside/inside diameter (in)
  function crossSectionArea_in2(od_in, id_in) {
    return Math.PI / 4 * (od_in * od_in - id_in * id_in);
  }
  function momentOfInertia_in4(od_in, id_in) {
    return Math.PI / 64 * (Math.pow(od_in, 4) - Math.pow(id_in, 4));
  }
  function wallThickness_in(od_in, id_in) {
    return (od_in - id_in) / 2;
  }

  // ---- Ref [2] Eq. 7.1 — pipe body yield (tensile) strength ---------------
  // Fy = MYS * As  (lbf)
  function bodyYieldTension_lbf(od_in, id_in, MYS_psi) {
    return MYS_psi * crossSectionArea_in2(od_in, id_in);
  }

  // ---- Ref [2] Eq. 7.23a/7.23b — API ROUND-THREAD joint strength ----------
  // Tensional joint strength of an API round-thread coupling under combined
  // tension and bending. Two branches, selected per the source: if the
  // resulting stress (Fcr/Ajp) is >= minimum yield, Eq. 7.23a governs;
  // otherwise Eq. 7.23b applies (pull-out controlled).
  //
  //   Ajp = pi/4 [ (dn - 0.1425)^2 - (dn - 2t)^2 ]      (area under last perfect thread)
  //   7.23a: Fcr = 0.95 Ajp { s_ult - [ 140.5 a dn / (s_ult - s_yield)^0.8 ]^5 }
  //   7.23b: Fcr = 0.95 Ajp ( (s_ult - s_yield)/0.644 + s_yield - 218.15 a dn )
  //
  // where a = dogleg severity in deg/100ft, dn = nominal OD (in),
  // t = wall thickness (in), stresses in psi. Validated against the source's
  // own Example 7.6 (7.625 in, 39 lb/ft, N-80, 4 deg/100ft): reproduces
  // Ajp = 9.501 sq in, Fcr/Ajp = 94,991 psi, Fcr = 902,500 lbf exactly.
  //
  // IMPORTANT SCOPE LIMITS (stated in the source itself):
  //  - API ROUND THREAD ONLY. Does not apply to buttress, premium, or
  //    metal-to-metal-seal connections — use the supplier's published
  //    joint rating for those instead.
  //  - The correlations were developed from tests on 5.5-in, 17-lbf/ft,
  //    K-55 casing with short round-thread couplings; extrapolation beyond
  //    that carries real uncertainty.
  //  - Returns the CALCULATED joint strength only. The source's own
  //    Example 7.6 notes the published table value can be LOWER (pull-out
  //    controlled), in which case the table value governs — so treat this
  //    as an upper estimate unless cross-checked against a datasheet.
  //
  // ultimateStrength_psi: minimum ultimate tensile strength for the grade
  // (NOT the yield strength — e.g. 100,000 psi for N-80 per the source's
  // Table 7.1). dls_deg100ft: dogleg severity at the joint (0 for straight).
  function roundThreadJointStrength_lbf(od_in, id_in, MYS_psi, ultimateStrength_psi, dls_deg100ft) {
    var a = dls_deg100ft || 0;
    var t = wallThickness_in(od_in, id_in);
    var Ajp = Math.PI / 4 * (Math.pow(od_in - 0.1425, 2) - Math.pow(od_in - 2 * t, 2));
    var stressA;
    if (ultimateStrength_psi > MYS_psi) {
      var inner = 140.5 * a * od_in / Math.pow(ultimateStrength_psi - MYS_psi, 0.8);
      stressA = 0.95 * (ultimateStrength_psi - Math.pow(inner, 5));
    } else {
      stressA = 0.95 * ultimateStrength_psi; // degenerate (ult == yield); 7.23a's bending term undefined
    }
    if (stressA >= MYS_psi) {
      return { strength_lbf: Ajp * stressA, Ajp_in2: Ajp, stress_psi: stressA, branch: '7.23a' };
    }
    var stressB = 0.95 * ((ultimateStrength_psi - MYS_psi) / 0.644 + MYS_psi - 218.15 * a * od_in);
    return { strength_lbf: Ajp * stressB, Ajp_in2: Ajp, stress_psi: stressB, branch: '7.23b' };
  }

  // ---- Ref [2] Eq. 7.2 — API internal yield (burst) pressure --------------
  // Barlow equation with API's 0.875 minimum-wall-thickness manufacturing
  // tolerance factor: Pb = 0.875 * 2*MYS*t/OD
  function burstPressure_psi(od_in, id_in, MYS_psi) {
    var t = wallThickness_in(od_in, id_in);
    return 0.875 * 2 * MYS_psi * t / od_in;
  }

  // ---- Ref [1] API TR 5C3 continuous collapse-regime factors --------------
  // F1..F5 as continuous functions of Yp (psi), replacing the older
  // discrete per-grade Table 7.4 in Ref [2] so intermediate/custom yield
  // strengths can be evaluated directly. Cross-checked structurally against
  // this well's uploaded "K&M Tubular Performance Calculator v6.4.xlsx".
  function collapseFactors(Yp_psi) {
    var F1 = 2.8762 + 0.10679e-5 * Yp_psi + 0.21301e-10 * Yp_psi * Yp_psi - 0.53132e-16 * Math.pow(Yp_psi, 3);
    var F2 = 0.026233 + 0.50609e-6 * Yp_psi;
    var F3 = -465.93 + 0.030867 * Yp_psi - 0.10483e-7 * Yp_psi * Yp_psi + 0.36989e-13 * Math.pow(Yp_psi, 3);
    var F4 = 3 * F2 / F1 / (2 + F2 / F1);
    var F5 = 46.95e6 * Math.pow(F4, 3) / Yp_psi / (F4 - F2 / F1) / Math.pow(1 - F4, 2);
    return { F1: F1, F2: F2, F3: F3, F4: F4, F5: F5 };
  }

  // d/t regime boundaries (Ref [1]/[2] Eq. 7.4b-type boundary + standard
  // elastic/plastic/transition thresholds built from F1..F5).
  function collapseRegimeBoundaries(Yp_psi, F) {
    var dtYP = F.F1 / (3 * F.F2 / F.F1 + (F.F3 / Yp_psi) * F.F1); // not used directly; kept for reference
    return {
      dtElastic: 1 / F.F4,                                  // (D/t)_E  — lower bound of elastic regime
      dtPlasticTransition: Yp_psi * (F.F1 - F.F5) / (F.F3 + Yp_psi * (F.F2 - F.F5 * F.F2 / F.F1)), // (D/t)_PT
      dtYieldTransition: (Math.sqrt(Math.pow(F.F1 - 2, 2) + 8 * (F.F2 + F.F3 / Yp_psi)) + F.F1 - 2) / (2 * (F.F2 + F.F3 / Yp_psi)) // (D/t)_YP
    };
  }

  // ---- Ref [2] Eq. 7.12 — ellipse of plasticity ---------------------------
  // Effective yield strength under combined axial stress sa (+tension /
  // -compression) and external pressure, used to derate collapse rating.
  // (sigma_yc)_effective = [ -sa/(2*Yp) + sqrt(1 - 0.75*(sa/Yp)^2) ] * Yp
  function ellipseOfPlasticity(axialStress_psi, Yp_psi) {
    var ratio = axialStress_psi / Yp_psi;
    var inner = 1 - 0.75 * ratio * ratio;
    if (inner < 0) inner = 0; // axial stress exceeds what the ellipse supports; caller should flag failure separately
    return (-ratio / 2 + Math.sqrt(inner)) * Yp_psi;
  }

  // ---- Ref [1]/[2] four-regime collapse pressure --------------------------
  // axialStress_psi: real axial stress in the pipe wall at the section being
  // checked (0 for the "as-rated" nominal collapse pressure).
  function collapsePressure_psi(od_in, id_in, MYS_psi, axialStress_psi) {
    axialStress_psi = axialStress_psi || 0;
    var t = wallThickness_in(od_in, id_in);
    var Dt = od_in / t;
    var Ype = axialStress_psi === 0 ? MYS_psi : ellipseOfPlasticity(axialStress_psi, MYS_psi);
    var F = collapseFactors(Ype);
    var bnd = collapseRegimeBoundaries(Ype, F);

    var elastic = 46.95e6 / (Dt * Math.pow(Dt - 1, 2));
    var plastic = Ype * (F.F1 / Dt - F.F2) - F.F3;
    var transition = Ype * (F.F5 / Dt - F.F5 * F.F2 / F.F1);
    var yieldStr = 2 * Ype * (Dt - 1) / (Dt * Dt);

    var regime;
    if (Dt >= bnd.dtElastic) { regime = 'elastic'; }
    else if (Dt >= bnd.dtPlasticTransition) { regime = 'transition'; }
    else if (Dt >= bnd.dtYieldTransition) { regime = 'plastic'; }
    else { regime = 'yield'; }

    var value = { elastic: elastic, transition: transition, plastic: plastic, yield: yieldStr }[regime];
    return { pressure_psi: value, regime: regime, Dt: Dt, effectiveYp_psi: Ype };
  }

  // ---- Ref [3] Lamé thick-wall cylinder stresses ---------------------------
  // pi_psi/po_psi: internal/external pressure (psi). r_in: radius at the
  // point being evaluated (od_in/2 for OD fiber, id_in/2 for ID fiber).
  function radialStress_psi(pi_psi, po_psi, od_in, id_in, r_in) {
    var ri = id_in / 2, ro = od_in / 2;
    return (pi_psi * ri * ri - po_psi * ro * ro) / (ro * ro - ri * ri)
      - (pi_psi - po_psi) * ri * ri * ro * ro / (r_in * r_in * (ro * ro - ri * ri));
  }
  function hoopStress_psi(pi_psi, po_psi, od_in, id_in, r_in) {
    var ri = id_in / 2, ro = od_in / 2;
    return (pi_psi * ri * ri - po_psi * ro * ro) / (ro * ro - ri * ri)
      + (pi_psi - po_psi) * ri * ri * ro * ro / (r_in * r_in * (ro * ro - ri * ri));
  }

  // ---- Ref [2] Eq. 7.22 — dogleg-induced bending stress --------------------
  // DLS_deg100ft: dogleg severity (deg/100ft). r_in: OD/2 or ID/2 fiber.
  // Pure-bending form (no shear/tanh correction — see module header: this
  // Phase-1 core does not yet fold in buckling-contact bending; see notes).
  function bendingStress_psi(E_psi, r_in, DLS_deg100ft) {
    return E_psi * r_in * DLS_deg100ft * Math.PI / 216000;
  }

  // ---- Ref [4] von Mises triaxial equivalent stress -------------------------
  function vonMisesStress_psi(sz_psi, sr_psi, st_psi, tau_psi) {
    tau_psi = tau_psi || 0;
    return Math.sqrt(
      sz_psi * sz_psi + sr_psi * sr_psi + st_psi * st_psi
      - sr_psi * st_psi - st_psi * sz_psi - sr_psi * sz_psi
      + 3 * tau_psi * tau_psi
    );
  }

  // Full stress state + VME at one fiber (OD or ID) for one load point.
  // All inputs in field units.
  function triaxialPoint_psi(params) {
    var od_in = params.od_in, id_in = params.id_in;
    var pi_psi = params.pi_psi, po_psi = params.po_psi;
    var Fa_lbf = params.Fa_lbf; // effective axial force, +tension
    var DLS_deg100ft = params.DLS_deg100ft || 0;
    var E_psi = params.E_psi || 30.0e6; // steel, API/SPE Textbook Vol.12 — matches tdModel.js convention
    var tau_psi = params.tau_psi || 0;
    var fiber = params.fiber === 'ID' ? 'ID' : 'OD';

    var As = crossSectionArea_in2(od_in, id_in);
    var sa = Fa_lbf / As;
    var r_in = fiber === 'OD' ? od_in / 2 : id_in / 2;
    var sb = bendingStress_psi(E_psi, r_in, DLS_deg100ft);
    // Outside-of-bend fiber adds bending stress, inside-of-bend subtracts;
    // caller supplies params.bendSign = +1 or -1 (default +1, conservative).
    var bendSign = params.bendSign == null ? 1 : params.bendSign;
    var sz = sa + bendSign * sb;

    var sr = radialStress_psi(pi_psi, po_psi, od_in, id_in, r_in);
    var st = hoopStress_psi(pi_psi, po_psi, od_in, id_in, r_in);
    var svm = vonMisesStress_psi(sz, sr, st, tau_psi);

    return { sz_psi: sz, sr_psi: sr, st_psi: st, svm_psi: svm, sa_psi: sa, sb_psi: sb, fiber: fiber };
  }

  // ---- triaxial (VME) design envelope — analytic solve ---------------------
  // For a fixed differential pressure dp = pi-po (using po=0, pi=dp for the
  // "internal pressure only" convention typical of these plots — pass an
  // explicit po_psi if a nonzero external backup pressure applies), solves
  // the von Mises equation for the two sz roots where svm = targetStress_psi
  // (MYS for the rated envelope, or MYS/designFactor for the design-limit
  // curve). Evaluated at the ID fiber (governs for both burst and collapse
  // in the classical envelope presentation) with tau=0 (no torque) unless
  // overridden.
  //
  // svm^2 = sz^2 - sz*(sr+st) + (sr^2+st^2-sr*st+3*tau^2)
  // This is a quadratic in sz: sz^2 - (sr+st)*sz + [(sr^2+st^2-sr*st+3tau^2) - target^2] = 0
  function envelopePoint_psi(od_in, id_in, dp_psi, targetStress_psi, opts) {
    opts = opts || {};
    var po_psi = opts.po_psi != null ? opts.po_psi : 0;
    var pi_psi = po_psi + dp_psi;
    var tau_psi = opts.tau_psi || 0;
    var r_in = opts.fiber === 'OD' ? od_in / 2 : id_in / 2;

    var sr = radialStress_psi(pi_psi, po_psi, od_in, id_in, r_in);
    var st = hoopStress_psi(pi_psi, po_psi, od_in, id_in, r_in);

    var b = -(sr + st);
    var c = (sr * sr + st * st - sr * st + 3 * tau_psi * tau_psi) - targetStress_psi * targetStress_psi;
    var disc = b * b - 4 * c;
    if (disc < 0) return null; // no real sz satisfies target at this dp — dp exceeds what any tension/compression can offset

    var sqrtDisc = Math.sqrt(disc);
    return { szHigh_psi: (-b + sqrtDisc) / 2, szLow_psi: (-b - sqrtDisc) / 2 };
  }

  // Finds where the envelope actually closes (the dp at which the von
  // Mises quadratic's discriminant hits zero) by expanding outward from
  // dp=0 (always valid — at zero differential pressure the ellipse always
  // has real sz roots at +-target) and bisecting once the boundary is
  // bracketed. Root-finding on the same verified equation above — no new
  // physics, just locating its natural domain instead of guessing a
  // padding factor from unrelated load magnitudes.
  function findEnvelopeBoundary_psi(od_in, id_in, target, opts, direction) {
    var scale = Math.max(burstPressure_psi(od_in, id_in, target), 100);
    var lastValid = 0, firstInvalid = null;
    for (var i = 0; i < 60; i++) {
      var candidate = direction * scale * 0.25 * Math.pow(1.35, i);
      if (envelopePoint_psi(od_in, id_in, candidate, target, opts)) {
        lastValid = candidate;
      } else {
        firstInvalid = candidate;
        break;
      }
    }
    if (firstInvalid === null) return lastValid; // domain wider than search range; use furthest confirmed point
    var lo = lastValid, hi = firstInvalid;
    for (var b = 0; b < 40; b++) {
      var mid = (lo + hi) / 2;
      if (envelopePoint_psi(od_in, id_in, mid, target, opts)) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Returns the dp range spanning the FULL closed ellipse (both burst-side
  // and collapse-side vertices), so a caller can render the whole envelope
  // by default rather than a range sized off arbitrary load magnitudes.
  function triaxialEnvelopeAutoRange_psi(od_in, id_in, MYS_psi, opts) {
    opts = opts || {};
    var target = opts.designFactor ? MYS_psi / opts.designFactor : MYS_psi;
    var maxDp = findEnvelopeBoundary_psi(od_in, id_in, target, opts, 1);
    var minDp = findEnvelopeBoundary_psi(od_in, id_in, target, opts, -1);
    return { min: minDp, max: maxDp };
  }

  // Sweeps dp over a range and returns the closed envelope curve as two
  // arrays (upper/lower sz branch) ready to feed a chart. dpRange_psi:
  // {min, max, steps}. Field-unit output — SI wrapper below converts.
  function triaxialEnvelope_psi(od_in, id_in, MYS_psi, dpRange_psi, opts) {
    opts = opts || {};
    var target = opts.designFactor ? MYS_psi / opts.designFactor : MYS_psi;
    var n = dpRange_psi.steps || 60;
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var dp = dpRange_psi.min + (dpRange_psi.max - dpRange_psi.min) * i / n;
      var pt = envelopePoint_psi(od_in, id_in, dp, target, opts);
      if (pt) pts.push({ dp_psi: dp, szHigh_psi: pt.szHigh_psi, szLow_psi: pt.szLow_psi });
    }
    return pts;
  }

  // ==========================================================================
  // SI wrappers — the interface the rest of Conveyor (SI-based casings[]) uses
  // ==========================================================================

  // od_m/id_m in metres, MYS in Pa (or grade string), returns N and Pa.
  function bodyYieldTension_N(od_m, id_m, gradeOrMYS_Pa) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var lbf = bodyYieldTension_lbf(od_m * M2IN, id_m * M2IN, MYS_psi);
    return lbf * LBF2N;
  }

  // Minimum ULTIMATE tensile strength by grade (psi) — needed by Eq. 7.23,
  // which uses ultimate (not yield) strength. Published API 5CT values,
  // consistent with Ref [2]'s Table 7.1 (e.g. N-80 -> 100,000 psi).
  var GRADE_ULTIMATE_PSI = {
    'H40': 60000, 'J55': 75000, 'K55': 95000, 'M65': 85000,
    'N80': 100000, 'L80': 95000, 'C90': 100000, 'C95': 105000, 'T95': 105000,
    'C110': 120000, 'P110': 125000, 'Q125': 135000
  };
  function resolveUltimate_psi(gradeOrPsi) {
    if (typeof gradeOrPsi === 'number') return gradeOrPsi;
    var key = String(gradeOrPsi).toUpperCase().replace(/[\s-]/g, '');
    return GRADE_ULTIMATE_PSI[key] != null ? GRADE_ULTIMATE_PSI[key] : null;
  }

  // SI wrapper for Eq. 7.23 round-thread joint strength. Returns null if
  // the grade has no published ultimate strength in the table above and
  // none was supplied — rather than guessing one (see the field-unit
  // function's header for the correlation's scope limits).
  // dls_deg30m: dogleg severity in deg/30m (Conveyor's usual convention),
  // converted internally to the deg/100ft the correlation expects.
  function roundThreadJointStrength_N(od_m, id_m, gradeOrMYS_Pa, dls_deg30m, ultimate_Pa) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var ult_psi = ultimate_Pa != null ? ultimate_Pa * PA2PSI : resolveUltimate_psi(gradeOrMYS_Pa);
    if (ult_psi == null) return null;
    var dls_deg100ft = (dls_deg30m || 0) * ((100 * 0.3048) / 30);
    var out = roundThreadJointStrength_lbf(od_m * M2IN, id_m * M2IN, MYS_psi, ult_psi, dls_deg100ft);
    return { strength_N: out.strength_lbf * LBF2N, branch: out.branch, stress_Pa: out.stress_psi * PSI2PA };
  }

  function burstPressure_Pa(od_m, id_m, gradeOrMYS_Pa) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var psi = burstPressure_psi(od_m * M2IN, id_m * M2IN, MYS_psi);
    return psi * PSI2PA;
  }

  function collapsePressure_Pa(od_m, id_m, gradeOrMYS_Pa, axialStress_Pa) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var sa_psi = (axialStress_Pa || 0) * PA2PSI;
    var out = collapsePressure_psi(od_m * M2IN, id_m * M2IN, MYS_psi, sa_psi);
    return {
      pressure_Pa: out.pressure_psi * PSI2PA,
      regime: out.regime, Dt: out.Dt,
      effectiveYp_Pa: out.effectiveYp_psi * PSI2PA
    };
  }

  // params in SI: od_m, id_m, pi_Pa, po_Pa, Fa_N, DLS_deg30m (deg/30m —
  // Conveyor's usual DLS convention; converted internally to deg/100ft),
  // E_Pa, tau_Pa, fiber, bendSign. Returns stresses in Pa.
  var M100FT_PER_30M = (100 * 0.3048) / 30; // 1 deg/30m = this many deg/100ft
  function triaxialPoint(params) {
    var p = {
      od_in: params.od_m * M2IN,
      id_in: params.id_m * M2IN,
      pi_psi: params.pi_Pa * PA2PSI,
      po_psi: params.po_Pa * PA2PSI,
      Fa_lbf: params.Fa_N * N2LBF,
      DLS_deg100ft: (params.DLS_deg30m || 0) * M100FT_PER_30M,
      E_psi: (params.E_Pa || 206.8e9) * PA2PSI,
      tau_psi: (params.tau_Pa || 0) * PA2PSI,
      fiber: params.fiber, bendSign: params.bendSign
    };
    var out = triaxialPoint_psi(p);
    return {
      sz_Pa: out.sz_psi * PSI2PA, sr_Pa: out.sr_psi * PSI2PA, st_Pa: out.st_psi * PSI2PA,
      svm_Pa: out.svm_psi * PSI2PA, sa_Pa: out.sa_psi * PSI2PA, sb_Pa: out.sb_psi * PSI2PA,
      fiber: out.fiber
    };
  }

  // dpRange_Pa: {min, max, steps}. Returns envelope points in Pa/N.
  function triaxialEnvelope(od_m, id_m, gradeOrMYS_Pa, dpRange_Pa, opts) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var range_psi = { min: dpRange_Pa.min * PA2PSI, max: dpRange_Pa.max * PA2PSI, steps: dpRange_Pa.steps };
    var pts_psi = triaxialEnvelope_psi(od_m * M2IN, id_m * M2IN, MYS_psi, range_psi, opts);
    var As_m2 = crossSectionArea_in2(od_m * M2IN, id_m * M2IN) * IN2M * IN2M;
    return pts_psi.map(function (pt) {
      return {
        dp_Pa: pt.dp_psi * PSI2PA,
        FaHigh_N: pt.szHigh_psi * PSI2PA * As_m2,
        FaLow_N: pt.szLow_psi * PSI2PA * As_m2
      };
    });
  }

  // Returns { min, max } in Pa spanning the full closed ellipse for this
  // pipe/grade — use this (rather than guessing a padding factor from load
  // magnitudes) to render the complete envelope by default.
  function triaxialEnvelopeAutoRange(od_m, id_m, gradeOrMYS_Pa, opts) {
    var MYS_psi = typeof gradeOrMYS_Pa === 'number' ? gradeOrMYS_Pa * PA2PSI : resolveMYS_psi(gradeOrMYS_Pa);
    var r = triaxialEnvelopeAutoRange_psi(od_m * M2IN, id_m * M2IN, MYS_psi, opts);
    return { min: r.min * PSI2PA, max: r.max * PSI2PA };
  }

  return {
    // unit constants (exposed for callers that need raw conversion)
    IN2M: IN2M, M2IN: M2IN, PSI2PA: PSI2PA, PA2PSI: PA2PSI, LBF2N: LBF2N, N2LBF: N2LBF,
    GRADE_MYS_PSI: GRADE_MYS_PSI, resolveMYS_psi: resolveMYS_psi,

    // field-unit core (for direct use / unit testing against the references)
    crossSectionArea_in2: crossSectionArea_in2,
    momentOfInertia_in4: momentOfInertia_in4,
    bodyYieldTension_lbf: bodyYieldTension_lbf,
    roundThreadJointStrength_lbf: roundThreadJointStrength_lbf,
    roundThreadJointStrength_N: roundThreadJointStrength_N,
    GRADE_ULTIMATE_PSI: GRADE_ULTIMATE_PSI,
    resolveUltimate_psi: resolveUltimate_psi,
    burstPressure_psi: burstPressure_psi,
    collapseFactors: collapseFactors,
    ellipseOfPlasticity: ellipseOfPlasticity,
    collapsePressure_psi: collapsePressure_psi,
    radialStress_psi: radialStress_psi,
    hoopStress_psi: hoopStress_psi,
    bendingStress_psi: bendingStress_psi,
    vonMisesStress_psi: vonMisesStress_psi,
    triaxialPoint_psi: triaxialPoint_psi,
    envelopePoint_psi: envelopePoint_psi,
    triaxialEnvelope_psi: triaxialEnvelope_psi,
    triaxialEnvelopeAutoRange_psi: triaxialEnvelopeAutoRange_psi,

    // SI wrappers (use these from job.ejs / controllers)
    bodyYieldTension_N: bodyYieldTension_N,
    triaxialEnvelopeAutoRange: triaxialEnvelopeAutoRange,
    burstPressure_Pa: burstPressure_Pa,
    collapsePressure_Pa: collapsePressure_Pa,
    triaxialPoint: triaxialPoint,
    triaxialEnvelope: triaxialEnvelope
  };
}));

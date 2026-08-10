// ============================================================================
// Casing Design — "Simple" and "Alternative" Method load-case builders.
//
// Shared by:
//   - the browser (casing design views, via <script src="/js/casingLoadCases.js">)
//   - the Node.js backend (notes.controller.js, via require())
//
// Implements the "Simple Method" and "Alternative Method" load conditions
// from Section 2 of the uploaded "Casing Design Foundation" (CNRL, Rev 0,
// 2/20/2024) — the company-standard document this well's Casing Design
// module is built from. The doc's own text: "Where the simple method does
// not meet the design factor, the alternate load must be evaluated." —
// implemented as governing-status logic in computeCasingDesign() below.
//
// The "Engineered" method (gas-over-mud, kick-tolerance/BOP-rating based)
// is NOT yet implemented — see the TODO marker near the bottom.
//
// Do not extend this file with invented load formulas; pull any addition
// from the same source document or a cited API/AER reference, same as
// casingModel.js.
//
// ---------------------------------------------------------------------------
// AMBIGUITIES IN THE SOURCE DOCUMENT — flagged here rather than silently
// resolved, since the user's stated preference is not to treat any formula
// as certain unless it's verifiably what the source says:
//
// 1. "Fracture gradient pressure at SURFACE casing shoe" appears verbatim in
//    the Intermediate and Production alternative-burst rows, not just
//    Surface's. Taken literally this means the fracture-gradient term for
//    an intermediate/production string should be evaluated at the SURFACE
//    string's shoe depth, not the string's own shoe — which would be an
//    unusual (but not impossible) design convention. This module defaults
//    to evaluating it at the string's OWN shoe TVD, and exposes
//    `fracGradientRefTVD_m` so the caller can override to the true surface-
//    casing-shoe TVD if that's what your document intends. Confirm with
//    whoever owns the Foundation doc before relying on this term.
// 2. "Maximum formation pressure ... x 0.85 for wells with TVD > 1800m ...
//    x 0.90 for wells with TVD >= 1800m" — the two conditions as transcribed
//    both fire at exactly TVD = 1800m (likely a typo in the source; probably
//    meant "< 1800m" for the 0.85 branch). This module treats it as
//    TVD < 1800m -> 0.85, TVD >= 1800m -> 0.90.
// 3. "Maximum formation pressure less gas gradient to any depth" is
//    transcribed exactly but underspecified (a gas gradient applied over
//    what depth interval?). This module interprets it as: (formation
//    pressure at the string's own shoe) − (gas gradient × shoe TVD), i.e.
//    the pressure a gas column reaching surface from the formation would
//    exert — the standard "well-in-a-well" underbalance check. Flag if your
//    document means something else.
//
// ---------------------------------------------------------------------------
// SOURCE — Simple Method (all formulas/defaults/DFs transcribed directly
// from Section 2, Surface/Intermediate/Production Casing Loads tables):
//
//   Surface     Burst (simple):     Pi = 5 x TVD of next casing string (kPa)
//               Collapse (simple):  Full evacuation; Po = max(12 kPa/m, mud
//                                   gradient at casing point) x shoe TVD
//               Tension (simple):   Unbuoyed weight = nominal weight x TVD
//               Design factors:     Burst 1.0 (pp H2S<0.3kPa) / 1.25 (>0.3);
//                                   Collapse 1.0; Tension 1.6
//
//   Intermediate/Production
//               Burst (simple):     Pi = max formation pressure (11 kPa/m
//                                   if unknown) x shoe TVD
//               Collapse (simple):  Full evacuation; Po = max(12 kPa/m, mud
//                                   gradient) x shoe TVD
//               Tension (simple):   Unbuoyed weight = nominal weight x TVD
//               Design factors:     Burst 1.0 (pp H2S<0.3kPa) / 1.15 (>0.3);
//                                   Collapse 1.0; Tension 1.6
//
// SOURCE — Alternative Method:
//
//   Surface     Burst (alt):  Pi = min(fracture gradient x shoe TVD [default
//                              22 kPa/m], 0.85 x max formation pressure in
//                              next hole section); Po = 10 kPa/m x shoe TVD
//               Collapse (alt): Full evacuation; Po = mud gradient at casing
//                              point x shoe TVD (no 12 kPa/m floor)
//               Tension (alt): Buoyed weight, pressure x body area method:
//                              Fb = P x (Ao-Ai), P = mud density (as a
//                              gradient) x shoe TVD
//               Design factors: Burst 1.1 / 1.20 (0.3<H2S<=10) / 1.25
//                              (H2S>10); Collapse 1.0; Tension 1.75 (API
//                              connections) / 1.6 (Premium)
//
//   Intermediate Burst (alt): Pi = min(formation pressure - gas gradient x
//                              shoe TVD, fracture gradient term, 0.85/0.90 x
//                              next-section max formation pressure by TVD);
//                              Po = 10 kPa/m x shoe TVD
//               Collapse (alt): Pi = lightest planned fluid gradient x
//                              (shoe TVD - 1/2 next string shoe TVD),
//                              floored at 0 (partial evacuation); Po = max
//                              planned mud gradient x shoe TVD
//
//   Production  Burst (alt): same as Intermediate but no fracture-gradient
//                              term (not listed in this row of the source
//                              table); Po = min(10 kPa/m x shoe TVD, known
//                              external pore pressure if supplied)
//               Collapse (alt): Total evacuation (Pi=0); Po = max planned
//                              mud gradient x shoe TVD
//               (Tension alt same formula/DFs as Surface/Intermediate)
//
// SOURCE — Liners: "For simplified design, liners must use the same burst,
// collapse and tension loads and design factors as a production casing.
// Further the parent string must also meet the production casing design
// requirements with adjustments for any wall thickness reduction." A liner
// is aliased to 'production' for every load formula (all three methods),
// except tension uses the liner's OWN hung length (shoe TVD − liner top/
// hanger TVD via topTVD_m) rather than weight-to-surface. The parent-string
// check (linerParentCheck()) re-evaluates the parent casing's burst/
// collapse rating, with its wall thickness reduced by a caller-supplied
// wear fraction, against the same loads the liner itself must survive.
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./casingModel.js'));
  } else {
    root.CasingLoadCases = factory(root.CasingModel);
  }
}(typeof self !== 'undefined' ? self : this, function (CasingModel) {
  'use strict';

  var G = 9.80665; // standard gravity, for kg/m -> N/m nominal-weight conversion

  // stringType: 'surface' | 'intermediate' | 'production'
  // str: { od_mm, id_mm, grade, weight_kgpm, shoeTVD_m, shoeMD_m }
  // p (well/load params):
  //   nextStringShoeTVD_m   — required for surface burst (5x rule)
  //   formationPressureGradient_kPa_m — default 11 if not supplied (intermediate/production burst)
  //   mudGradient_kPa_m     — mud gradient at casing point (collapse external + evacuation floor)
  //   h2sPartialPressure_kPa — optional, drives the 1.25/1.15 vs 1.0 burst DF split
  //   topTVD_m              — LINERS ONLY: liner top/hanger TVD, so tension is
  //                           the liner's own hung weight, not weight-to-surface
  //                           (see "Liners" note in the module header)
  function simpleLoads(stringType, str, p) {
    p = p || {};
    // Ref: Foundation doc, "Liners" — "liners must use the same burst,
    // collapse and tension loads and design factors as a production
    // casing." Liner is aliased to production for every formula below
    // except the tension length, which uses the liner's own hung length
    // (shoe TVD minus hanger TVD), not weight-to-surface.
    var effType = stringType === 'liner' ? 'production' : stringType;
    var shoeTVD = str.shoeTVD_m;
    var topTVD = stringType === 'liner' ? (p.topTVD_m || 0) : 0;
    var mudGrad = p.mudGradient_kPa_m != null ? p.mudGradient_kPa_m : 0;
    var evacFloor = Math.max(12, mudGrad); // "Greater of 12 kPa/m and the drilling fluid gradient"
    var h2sHigh = (p.h2sPartialPressure_kPa || 0) > 0.3;

    // ---- Burst ----
    var burstPi_kPa, burstDF;
    if (effType === 'surface') {
      if (p.nextStringShoeTVD_m == null) throw new Error('simpleLoads: surface burst (simple) requires nextStringShoeTVD_m.');
      burstPi_kPa = 5 * p.nextStringShoeTVD_m;
      burstDF = h2sHigh ? 1.25 : 1.0;
    } else {
      var fpGrad = p.formationPressureGradient_kPa_m != null ? p.formationPressureGradient_kPa_m : 11; // "if unknown use 11 kPa/m"
      burstPi_kPa = fpGrad * shoeTVD;
      burstDF = h2sHigh ? 1.15 : 1.0;
    }

    // ---- Collapse ---- (full evacuation: Pi=0; Po = evac floor x shoe TVD)
    var collapsePo_kPa = evacFloor * shoeTVD;
    var collapseDF = 1.0;

    // ---- Tension ---- (unbuoyed: nominal weight x hung length)
    var weight_Npm = (str.weight_kgpm || 0) * G;
    var tensionLoad_N = weight_Npm * (shoeTVD - topTVD);
    var tensionDF = 1.6;

    return {
      burst: { pi_kPa: burstPi_kPa, po_kPa: 0, designFactor: burstDF },
      collapse: { pi_kPa: 0, po_kPa: collapsePo_kPa, designFactor: collapseDF },
      tension: { load_N: tensionLoad_N, designFactor: tensionDF },
      method: 'simple'
    };
  }

  // ---- Alternative Method (see module header for full source + the three
  // ambiguity notes) ----------------------------------------------------
  // Additional params beyond simpleLoads():
  //   nextStringMFP_kPa        — max formation pressure in the NEXT hole
  //                              section (required; a pore-pressure-
  //                              prognosis value, not a fixed gradient)
  //   fractureGradient_kPa_m   — default 22
  //   fracGradientRefTVD_m     — default: this string's own shoe TVD (see
  //                              ambiguity note 1 for the surface-shoe case)
  //   externalFluidGradient_kPa_m — default 10
  //   externalPorePressure_kPa — production only, optional
  //   gasGradient_kPa_m        — default 2 (intermediate/production only)
  //   formationPressure_kPa    — this string's own shoe formation pressure;
  //                              falls back to formationPressureGradient_kPa_m
  //                              (default 11) x shoe TVD if not given
  //   wellTVD_m                — for the 1800m TVD-factor switch; defaults
  //                              to this string's shoe TVD
  //   maxPlannedMudGradient_kPa_m — default: externalFluidGradient_kPa_m
  //   lightestPlannedFluidGradient_kPa_m — intermediate only; default:
  //                              externalFluidGradient_kPa_m
  //   nextStringShoeTVD_m      — required for intermediate collapse (½ TVD
  //                              evacuation point) and surface burst
  //   mudGradientAtCasingPoint_kPa_m — for collapse external + buoyed
  //                              tension; default: externalFluidGradient_kPa_m
  //   connectionType           — 'API' (default, DF 1.75) or 'Premium' (DF 1.6)
  //   topTVD_m                 — LINERS ONLY: liner top/hanger TVD (see
  //                              simpleLoads header and "Liners" note below)
  function alternativeLoads(stringType, str, p) {
    p = p || {};
    var effType = stringType === 'liner' ? 'production' : stringType; // Ref: Foundation doc "Liners"
    var shoeTVD = str.shoeTVD_m;
    var topTVD = stringType === 'liner' ? (p.topTVD_m || 0) : 0;
    var h2s = p.h2sPartialPressure_kPa || 0;
    var burstDF = h2s > 10 ? 1.25 : (h2s > 0.3 ? 1.20 : 1.1);

    var fracGrad = p.fractureGradient_kPa_m != null ? p.fractureGradient_kPa_m : 22;
    var fracRefTVD = p.fracGradientRefTVD_m != null ? p.fracGradientRefTVD_m : shoeTVD;
    var fracTerm_kPa = fracGrad * fracRefTVD;

    var extFluidGrad = p.externalFluidGradient_kPa_m != null ? p.externalFluidGradient_kPa_m : 10;
    var burstPo_kPa = extFluidGrad * shoeTVD;

    var burstPi_kPa, burstTerms;
    if (effType === 'surface') {
      if (p.nextStringMFP_kPa == null) throw new Error('alternativeLoads: surface burst (alternative) requires nextStringMFP_kPa.');
      var mfpTerm = 0.85 * p.nextStringMFP_kPa;
      burstPi_kPa = Math.min(fracTerm_kPa, mfpTerm);
      burstTerms = { fracTerm_kPa: fracTerm_kPa, mfpTerm_kPa: mfpTerm };
    } else {
      if (p.nextStringMFP_kPa == null) throw new Error('alternativeLoads: ' + effType + ' burst (alternative) requires nextStringMFP_kPa.');
      var gasGrad = p.gasGradient_kPa_m != null ? p.gasGradient_kPa_m : 2;
      var mfpHere = p.formationPressure_kPa != null ? p.formationPressure_kPa
        : (p.formationPressureGradient_kPa_m != null ? p.formationPressureGradient_kPa_m : 11) * shoeTVD;
      var gasTerm = mfpHere - gasGrad * shoeTVD;
      var wellTVD = p.wellTVD_m != null ? p.wellTVD_m : shoeTVD;
      var tvdFactor = wellTVD < 1800 ? 0.85 : 0.90; // see ambiguity note 2
      var mfpTvdTerm = tvdFactor * p.nextStringMFP_kPa;
      if (effType === 'intermediate') {
        burstPi_kPa = Math.min(gasTerm, fracTerm_kPa, mfpTvdTerm);
        burstTerms = { gasTerm_kPa: gasTerm, fracTerm_kPa: fracTerm_kPa, mfpTvdTerm_kPa: mfpTvdTerm };
      } else { // production (and liner, aliased) — no fracture-gradient term in this row of the source table
        burstPi_kPa = Math.min(gasTerm, mfpTvdTerm);
        burstTerms = { gasTerm_kPa: gasTerm, mfpTvdTerm_kPa: mfpTvdTerm };
      }
      if (effType === 'production' && p.externalPorePressure_kPa != null) {
        burstPo_kPa = Math.min(burstPo_kPa, p.externalPorePressure_kPa);
      }
    }

    var maxPlannedMudGrad = p.maxPlannedMudGradient_kPa_m != null ? p.maxPlannedMudGradient_kPa_m : extFluidGrad;
    var mudGradAtPoint = p.mudGradientAtCasingPoint_kPa_m != null ? p.mudGradientAtCasingPoint_kPa_m : extFluidGrad;

    var collapsePi_kPa, collapsePo_kPa;
    if (effType === 'surface') {
      collapsePi_kPa = 0; // full evacuation
      collapsePo_kPa = mudGradAtPoint * shoeTVD; // no 12 kPa/m floor for alternative
    } else if (effType === 'intermediate') {
      if (p.nextStringShoeTVD_m == null) throw new Error('alternativeLoads: intermediate collapse (alternative) requires nextStringShoeTVD_m.');
      var evacLevel = 0.5 * p.nextStringShoeTVD_m;
      var lightestGrad = p.lightestPlannedFluidGradient_kPa_m != null ? p.lightestPlannedFluidGradient_kPa_m : extFluidGrad;
      collapsePi_kPa = lightestGrad * Math.max(shoeTVD - evacLevel, 0);
      collapsePo_kPa = maxPlannedMudGrad * shoeTVD;
    } else { // production (and liner) — total evacuation
      collapsePi_kPa = 0;
      collapsePo_kPa = maxPlannedMudGrad * shoeTVD;
    }
    var collapseDF = 1.0;

    // Tension — buoyed weight via the "pressure x body area" method
    // (Fb = P x (Ao-Ai), same buoyancy formula documented in the source
    // doc's Section 1 "Tension" for the equal-density case). Uses the
    // liner's own hung length (shoeTVD - topTVD) when stringType is 'liner'.
    var od_m = str.od_mm / 1000, id_m = str.id_mm / 1000;
    var As_m2 = Math.PI / 4 * (od_m * od_m - id_m * id_m);
    var P_kPa = mudGradAtPoint * shoeTVD;
    var Fb_N = P_kPa * 1000 * As_m2;
    var weight_Npm = (str.weight_kgpm || 0) * G;
    var unbuoyed_N = weight_Npm * (shoeTVD - topTVD);
    var tensionLoad_N = unbuoyed_N - Fb_N;
    var tensionDF = p.connectionType === 'Premium' ? 1.6 : 1.75;

    return {
      burst: { pi_kPa: burstPi_kPa, po_kPa: burstPo_kPa, designFactor: burstDF, terms: burstTerms },
      collapse: { pi_kPa: collapsePi_kPa, po_kPa: collapsePo_kPa, designFactor: collapseDF },
      tension: { load_N: tensionLoad_N, designFactor: tensionDF, unbuoyed_N: unbuoyed_N, buoyancyForce_N: Fb_N },
      method: 'alternative'
    };
  }

  // ---- Engineered Method (intermediate/production only — the source doc
  // has no "engineered" row for Surface). Ported directly from the
  // "Int Csg Eng Design" sheet in the uploaded "Casing Design r2025 v1.xlsx"
  // workbook (not reconstructed from the Foundation doc's prose alone,
  // which under-specifies the kick-tolerance math) — formulas transcribed
  // cell-for-cell below, generalized from that sheet's tapered-2-string
  // layout to this module's one-string-at-a-time architecture.
  //
  // Unlike Simple/Alternative (single load point at the shoe), the
  // Engineered Method evaluates burst/collapse/tension at a swept series of
  // TVD points from the string's top to its shoe and reports the governing
  // (worst design-factor) point — matching the source sheet's ~20-points-
  // per-segment sweep ("calculations are completed at regular depths").
  //
  // Additional params beyond alternativeLoads():
  //   formationPressure_kPa    — FP at this string's shoe (required)
  //   minMudWeightGradient_kPa_m — min planned mud gradient for the
  //                              interval, used in the internal gas-over-mud
  //                              profile (default: mudGradientAtCasingPoint_kPa_m)
  //   gasGradient_kPa_m        — min anticipated gas gradient (default 2,
  //                              same default as Alternative)
  //   geoPrognosis             — [{ tvd_m, gradient_kPa_m }, ...] sorted by
  //                              tvd_m ascending; approximate-match lookup
  //                              (last entry with tvd_m <= z), mirroring the
  //                              sheet's VLOOKUP(...,,1). Falls back to a
  //                              constant formationPressureGradient_kPa_m
  //                              (default 11) if not supplied.
  //   nextStringShoeTVD_m      — required for the collapse profile's ½-TVD
  //                              evacuation point (same as Alternative)
  //   maxPlannedMudGradient_kPa_m — collapse external profile (default:
  //                              externalFluidGradient_kPa_m)
  //   topTVD_m                 — top of this string, TVD (default 0)
  //   steps                    — depth points to sweep (default 30)
  //   bopPressureLimit_kPa     — for the GMR/kick-volume-limit report
  //                              (optional; skipped if not supplied)
  //   drillPipeDisplacement_Lpm — for the kick-volume-limit report
  //                              (optional; skipped if not supplied)
  function gasOverMudRatio(tvd_m) {
    // Ref: "Int Csg Eng Design"!B13 — ROUNDUP(IF(TVD<2000,1,IF(TVD>4000,0.6,
    // 1-(TVD-2000)/2000*0.4)),2). Also matches the Foundation doc's stated
    // 100%/60%/linear-interpolation rule.
    var gmr;
    if (tvd_m < 2000) gmr = 1;
    else if (tvd_m > 4000) gmr = 0.6;
    else gmr = 1 - (tvd_m - 2000) / 2000 * 0.4;
    return Math.round(gmr * 100) / 100; // ROUNDUP to 2dp approximated as round; sheet uses ROUNDUP specifically
  }

  function geoPrognosisGradientAt(z_m, geoPrognosis, fallbackGrad_kPa_m) {
    if (!geoPrognosis || !geoPrognosis.length) return fallbackGrad_kPa_m;
    var sorted = geoPrognosis.slice().sort(function (a, b) { return a.tvd_m - b.tvd_m; });
    var g = sorted[0].gradient_kPa_m;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].tvd_m <= z_m) g = sorted[i].gradient_kPa_m; else break;
    }
    return g;
  }

  function engineeredLoads(stringType, str, p) {
    if (stringType === 'surface') throw new Error('engineeredLoads: not defined for surface casing in the source document (no "engineered" row in the Surface Casing Loads table).');
    p = p || {};
    var shoeTVD = str.shoeTVD_m;
    var topTVD = p.topTVD_m != null ? p.topTVD_m : 0;
    var steps = p.steps || 30;
    var h2s = p.h2sPartialPressure_kPa || 0;
    var burstDF = h2s > 10 ? 1.25 : (h2s > 0.3 ? 1.20 : 1.1); // same 3-tier as Alternative (source doc reuses it)
    var collapseDF = 1.0;
    var tensionDF = p.connectionType === 'Premium' ? 1.6 : 1.75; // same as Alternative

    if (p.formationPressure_kPa == null) throw new Error('engineeredLoads: requires formationPressure_kPa (FP at this string\'s shoe).');
    if (p.nextStringShoeTVD_m == null) throw new Error('engineeredLoads: requires nextStringShoeTVD_m (for the collapse ½-TVD evacuation point).');
    var FP = p.formationPressure_kPa;
    var gmr = gasOverMudRatio(shoeTVD);
    var minMudGrad = p.minMudWeightGradient_kPa_m != null ? p.minMudWeightGradient_kPa_m
      : (p.mudGradientAtCasingPoint_kPa_m != null ? p.mudGradientAtCasingPoint_kPa_m : 10.5);
    var gasGrad = p.gasGradient_kPa_m != null ? p.gasGradient_kPa_m : 2;
    var fallbackFormGrad = p.formationPressureGradient_kPa_m != null ? p.formationPressureGradient_kPa_m : 11;
    var maxPlannedMudGrad = p.maxPlannedMudGradient_kPa_m != null ? p.maxPlannedMudGradient_kPa_m
      : (p.externalFluidGradient_kPa_m != null ? p.externalFluidGradient_kPa_m : 10);
    var evacLevel = 0.5 * p.nextStringShoeTVD_m;

    var od_m = str.od_mm / 1000, id_m = str.id_mm / 1000;
    var As_m2 = Math.PI / 4 * (od_m * od_m - id_m * id_m);
    var weight_Npm = (str.weight_kgpm || 0) * G;

    var profile = [];
    for (var i = 0; i <= steps; i++) {
      var z = topTVD + (shoeTVD - topTVD) * i / steps;

      // Burst: internal gas-over-mud kick profile — Ref "Int Csg Eng Design"!E17
      var burstPi_kPa;
      if (z > shoeTVD) burstPi_kPa = 0;
      else if (z > gmr * shoeTVD) burstPi_kPa = FP - (shoeTVD - z) * minMudGrad;
      else burstPi_kPa = FP - (1 - gmr) * shoeTVD * minMudGrad - (gmr * shoeTVD - z) * gasGrad;
      // Burst: external formation-pressure profile — Ref !F17 (geo prognosis VLOOKUP)
      var burstPo_kPa = geoPrognosisGradientAt(z, p.geoPrognosis, fallbackFormGrad) * z;

      // Collapse — Ref !C85 (internal, evac to 1/2 next-string TVD) / !D85 (external)
      var collapsePi_kPa = z < evacLevel ? 0 : (z - evacLevel) * minMudGrad;
      var collapsePo_kPa = z * maxPlannedMudGrad;

      // Tension — Ref !C129 (buoyed weight profile, same buoyancy method as Alternative)
      var unbuoyed_N = weight_Npm * (shoeTVD - z);
      var Fb_N = (minMudGrad * z) * 1000 * As_m2;
      var tension_N = unbuoyed_N - Fb_N;

      profile.push({
        tvd_m: z,
        burst: { pi_kPa: burstPi_kPa, po_kPa: burstPo_kPa },
        collapse: { pi_kPa: collapsePi_kPa, po_kPa: collapsePo_kPa },
        tension_N: tension_N
      });
    }

    // Governing (worst) point per load type = max differential pressure /
    // max tension along the swept profile.
    var burstGov = profile.reduce(function (a, b) { return (b.burst.pi_kPa - b.burst.po_kPa) > (a.burst.pi_kPa - a.burst.po_kPa) ? b : a; });
    var collapseGov = profile.reduce(function (a, b) { return (b.collapse.po_kPa - b.collapse.pi_kPa) > (a.collapse.po_kPa - a.collapse.pi_kPa) ? b : a; });
    var tensionGov = profile.reduce(function (a, b) { return b.tension_N > a.tension_N ? b : a; });

    var result = {
      burst: { pi_kPa: burstGov.burst.pi_kPa, po_kPa: burstGov.burst.po_kPa, designFactor: burstDF, governingTVD_m: burstGov.tvd_m, gasOverMudRatio: gmr },
      collapse: { pi_kPa: collapseGov.collapse.pi_kPa, po_kPa: collapseGov.collapse.po_kPa, designFactor: collapseDF, governingTVD_m: collapseGov.tvd_m },
      tension: { load_N: tensionGov.tension_N, designFactor: tensionDF, governingTVD_m: tensionGov.tvd_m },
      method: 'engineered', profile: profile
    };

    // Optional supplementary report: GMR/kick-volume limits (Boyle's Law),
    // Ref "Int Csg Eng Design"!H7:H13. Only computed if the extra inputs
    // are supplied — this is informational (kick-tolerance/BOP risk
    // assessment per the source doc), not a pass/fail design check.
    if (p.bopPressureLimit_kPa != null && p.drillPipeDisplacement_Lpm != null) {
      var burstRating_Pa = CasingModel.burstPressure_Pa(od_m, id_m, str.grade);
      var burstRatingWithDF_kPa = (burstRating_Pa / 1000) / burstDF;
      var casingCapacity_Lpm = (Math.PI / 4 * id_m * id_m) * 1000; // m^3/m -> L/m
      var netCapacity_Lpm = casingCapacity_Lpm - p.drillPipeDisplacement_Lpm;

      function gmrLimit(pressureLimit_kPa) {
        return ((pressureLimit_kPa - FP) / shoeTVD + minMudGrad) / (minMudGrad - gasGrad);
      }
      function kvLimit_m3(pressureLimit_kPa, gmrForCalc) {
        return pressureLimit_kPa * netCapacity_Lpm / 1000 * gmrForCalc * shoeTVD / FP;
      }

      var gmrLimitBOP = gmrLimit(p.bopPressureLimit_kPa);
      var gmrLimitCasing = gmrLimit(burstRatingWithDF_kPa);
      result.kickTolerance = {
        casingCapacity_Lpm: casingCapacity_Lpm, netCapacity_Lpm: netCapacity_Lpm,
        gmrLimitBOP: gmrLimitBOP, kvLimitBOP_m3: kvLimit_m3(p.bopPressureLimit_kPa, gmrLimitBOP),
        gmrLimitCasing: gmrLimitCasing, kvLimitCasing_m3: kvLimit_m3(burstRatingWithDF_kPa, gmrLimitCasing),
        kvAtDesignGMR_m3: kvLimit_m3(p.bopPressureLimit_kPa, gmr)
      };
    }

    return result;
  }

  // Combines a Simple-Method load case with casingModel.js ratings into a
  // pass/fail design check for one string. Collapse rating is derated for
  // the tension load's axial stress via the ellipse of plasticity (Ref [2]
  // Eq. 7.12 in casingModel.js), matching the AER Dir.10 App.5 requirement
  // described in the source document ("collapse loads should account for
  // the reduction in collapse pressure rating from axial loading").
  function designCheck(str, loads) {
    var od_m = str.od_mm / 1000, id_m = str.id_mm / 1000;
    var As_m2 = Math.PI / 4 * (od_m * od_m - id_m * id_m);



    var burstRating_Pa = CasingModel.burstPressure_Pa(od_m, id_m, str.grade);
    var bodyYield_N = CasingModel.bodyYieldTension_N(od_m, id_m, str.grade);

    var axialStress_Pa = loads.tension.load_N / As_m2;
    var collapse = CasingModel.collapsePressure_Pa(od_m, id_m, str.grade, axialStress_Pa);

    // Net differential loads — burst rating is defined against internal
    // pressure with the external backup subtracted (pi-po); collapse
    // rating is defined against external pressure with the internal
    // backup subtracted (po-pi). Using pi/po alone (ignoring the backup
    // side) overstates the load whenever a method supplies a nonzero
    // value on both sides (e.g. Alternative/Engineered burst's external
    // fluid gradient, or Engineered collapse's partial-evacuation
    // internal column).
    var burstLoad_Pa = (loads.burst.pi_kPa - loads.burst.po_kPa) * 1000;
    var collapseLoad_Pa = (loads.collapse.po_kPa - loads.collapse.pi_kPa) * 1000;

    function factorResult(rating, load, requiredDF) {
      var achieved = load > 0 ? rating / load : Infinity;
      return { rating: rating, load: load, requiredDF: requiredDF, achievedDF: achieved, pass: achieved >= requiredDF };
    }

    // ---- Tension rating: min(pipe body yield, connection rating) --------
    // A connection is frequently weaker than the pipe body, and the source
    // doc's own worked design (Ref [2] Sec. 7.4.3 / Example) compares BOTH
    // joint strength and pipe-body strength against the tension load,
    // taking whichever governs. Resolution order:
    //   1. str.connectionRating_kN — explicit supplier datasheet value
    //      (the only trustworthy source for premium/MTM connections)
    //   2. Ref [2] Eq. 7.23 calculated round-thread joint strength, but
    //      ONLY when str.connectionThreadType === 'roundThread' (the
    //      correlation's stated scope) — see casingModel.js for its limits
    //   3. Otherwise pipe body yield alone (previous behavior — no silent
    //      change for strings that don't specify a connection)
    var connectionRating_N = null, connectionBasis = 'pipe body yield (no connection rating supplied)';
    if (str.connectionRating_kN != null && !isNaN(str.connectionRating_kN)) {
      connectionRating_N = str.connectionRating_kN * 1000;
      connectionBasis = 'supplier datasheet';
    } else if (str.connectionThreadType === 'roundThread') {
      var jt = CasingModel.roundThreadJointStrength_N(od_m, id_m, str.grade, str.jointDLS_deg30m || 0, str.ultimateStrength_Pa);
      if (jt) { connectionRating_N = jt.strength_N; connectionBasis = 'Bourgoyne Eq. ' + jt.branch + ' (API round thread, calculated)'; }
      else { connectionBasis = 'pipe body yield (no published ultimate strength for grade "' + str.grade + '")'; }
    }
    var tensionRating_N = (connectionRating_N != null) ? Math.min(bodyYield_N, connectionRating_N) : bodyYield_N;

    return {
      burst: factorResult(burstRating_Pa, burstLoad_Pa, loads.burst.designFactor),
      collapse: Object.assign(factorResult(collapse.pressure_Pa, collapseLoad_Pa, loads.collapse.designFactor),
        { regime: collapse.regime, effectiveYp_Pa: collapse.effectiveYp_Pa }),
      tension: Object.assign(factorResult(tensionRating_N, loads.tension.load_N, loads.tension.designFactor),
        { bodyYield_N: bodyYield_N, connectionRating_N: connectionRating_N, connectionBasis: connectionBasis,
          governedBy: (connectionRating_N != null && connectionRating_N < bodyYield_N) ? 'connection' : 'pipe body' })
    };
  }

  // ---- Liners: parent-string check ----------------------------------
  // Ref: Foundation doc, "Liners" — "the parent string must also meet the
  // production casing design requirements with adjustments for any wall
  // thickness reduction." Re-checks the PARENT casing (the string the
  // liner hangs inside, over their overlap interval) against the SAME
  // loads the liner itself must survive there, using production-tier
  // design factors, with the parent's wall thickness reduced by
  // wallWearFraction (e.g. 0.05 for a 5% wear allowance from drilling
  // through it) to model in-service wear rather than nominal new-pipe wall.
  //
  // parentStr: the parent casing string record (od_mm/id_mm/grade)
  // linerLoads: the liner's own computed loads (simple/alternative/
  //             engineered — whichever governed) that the parent must
  //             also survive over the overlap
  // wallWearFraction: 0-1, default 0 (no wear derating)
  function linerParentCheck(parentStr, linerLoads, wallWearFraction) {
    wallWearFraction = wallWearFraction || 0;
    var od_m = parentStr.od_mm / 1000;
    var id_m = parentStr.id_mm / 1000;
    var nominalWall_m = (od_m - id_m) / 2;
    var wornWall_m = nominalWall_m * (1 - wallWearFraction);
    // Worn ID = OD - 2*wornWall (wear removes material from the ID face)
    var wornId_m = od_m - 2 * wornWall_m;
    var wornStr = { od_mm: od_m * 1000, id_mm: wornId_m * 1000, grade: parentStr.grade };
    var check = designCheck(wornStr, linerLoads);
    return { wornId_mm: wornId_m * 1000, wallWearFraction: wallWearFraction, check: check };
  }

  // ---- Overpull check (Section 2, "Other Loads for Consideration") -------
  // Source doc, verbatim intent: "Casing design should include an overpull
  // load using the design factor and expected buoyed tension of the tensile
  // loads listed in the table, plus an overpull of 50 kdaN."
  //
  // So the required capacity is:  DF * buoyedTension + overpull
  // (the DF applies to the tension load only, NOT to the overpull term —
  // the overpull is an additive allowance on top of the factored load).
  // Compared against the same governing tension rating designCheck uses
  // (min of pipe body yield and connection rating).
  //
  // The doc also notes: "Designs with less than 50 kdaN or where drag may
  // prevent pulling casing out of hole, should have this indicated in the
  // drilling program" — so a FAIL here is a flag to document, not
  // necessarily a redesign trigger. overpull_kdaN is caller-overridable
  // for that reason; 1 kdaN = 10 kN.
  function overpullCheck(str, loads, tensionCheck, overpull_kdaN) {
    var overpull_N = (overpull_kdaN != null ? overpull_kdaN : 50) * 10000; // kdaN -> N
    var buoyedTension_N = loads.tension.load_N;
    var required_N = loads.tension.designFactor * buoyedTension_N + overpull_N;
    var rating_N = tensionCheck.rating;
    return {
      rating: rating_N,
      required_N: required_N,
      buoyedTension_N: buoyedTension_N,
      overpull_N: overpull_N,
      designFactor: loads.tension.designFactor,
      margin_N: rating_N - required_N,
      // Available overpull at the rated capacity, i.e. how much pull is
      // actually left after the factored tension load — the number to put
      // in the drilling program when it falls short of 50 kdaN.
      availableOverpull_kdaN: (rating_N - loads.tension.designFactor * buoyedTension_N) / 10000,
      pass: rating_N >= required_N,
      governedBy: tensionCheck.governedBy,
      connectionBasis: tensionCheck.connectionBasis
    };
  }

  function governingStatus(checks) {
    // checks: [{ name, check, error }] in priority order (simple, alternative, engineered)
    function one(key) {
      var lastFailNote = null;
      for (var i = 0; i < checks.length; i++) {
        var c = checks[i];
        if (c.error) { lastFailNote = c.name + ' not evaluated: ' + c.error; continue; }
        if (c.check[key].pass) return { status: 'pass', governedBy: c.name };
        lastFailNote = c.name + ' fails (DF ' + c.check[key].achievedDF.toFixed(2) + ' < ' + c.check[key].requiredDF + ')';
      }
      var evaluatedAny = checks.some(function (c) { return !c.error; });
      return {
        status: 'fail',
        governedBy: checks[checks.length - 1].name,
        note: evaluatedAny
          ? ('Fails every evaluated method (' + lastFailNote + ') — per the source document this needs escalation beyond Simple/Alternative/Engineered.')
          : lastFailNote
      };
    }
    return { burst: one('burst'), collapse: one('collapse'), tension: one('tension') };
  }

  // ---- Orchestration: casing strings + per-string load params -> full
  // results object, one entry per string, ready to save/display. This is
  // the single function the controller and the standalone editor both call
  // (mirrors HydraulicsModelCore.computeHydraulics as the one compute entry
  // point for that module).
  //
  // casingStrings: [{ name, stringType, od_mm, id_mm, grade, weight_kgpm,
  //                    shoeMD_m, shoeTVD_m }]
  // loadParamsByName: { <string name>: { ...simpleLoads params, ...
  //                    alternativeLoads params, ...engineeredLoads params
  //                    (see each function's header) } }
  // opts.dfOverride: optional { burst, collapse, tension } — a WHAT-IF
  // override for the VME "Design Factor" curve only (see the design-limit
  // envelope block below). Does NOT change burstDF/collapseDF/tensionDF
  // used by designCheck()/governingStatus() above — the actual pass/fail
  // compliance check always stays governed by the Foundation doc's
  // mandated DFs, never by this override, so a person exploring "what if
  // DF were higher/lower" on the chart can't accidentally make a failing
  // string look like it passes.
  function computeCasingDesign(casingStrings, loadParamsByName, opts) {
    opts = opts || {};
    var dfOverride = opts.dfOverride || {};
    var byString = {};
    (casingStrings || []).forEach(function (str) {
      var p = (loadParamsByName && loadParamsByName[str.name]) || {};

      // The connection-rating inputs are collected in the same per-string
      // load-params panel as everything else, but designCheck() reads them
      // off the string record (they're pipe properties, not load
      // conditions). Copy them across here rather than splitting the UI.
      if(p.connectionRating_kN != null && p.connectionThreadType === 'datasheet') str.connectionRating_kN = p.connectionRating_kN;
      if(p.connectionThreadType === 'roundThread') str.connectionThreadType = 'roundThread';
      if(p.jointDLS_deg30m != null) str.jointDLS_deg30m = p.jointDLS_deg30m;

      var simple = simpleLoads(str.stringType, str, p);
      var simpleCheck = designCheck(str, simple);

      var alt = null, altCheck = null, altError = null;
      try {
        alt = alternativeLoads(str.stringType, str, p);
        altCheck = designCheck(str, alt);
      } catch (e) {
        altError = e.message;
      }

      var eng = null, engCheck = null, engError = null;
      if (str.stringType !== 'surface') {
        try {
          eng = engineeredLoads(str.stringType, str, p);
          engCheck = designCheck(str, eng);
        } catch (e) {
          engError = e.message;
        }
      }

      var governing = governingStatus([
        { name: 'simple', check: simpleCheck },
        { name: 'alternative', check: altCheck, error: altError },
        { name: 'engineered', check: engCheck, error: engError }
      ]);

      var od_m = str.od_mm / 1000, id_m = str.id_mm / 1000;
      // Triaxial envelope for the plot: always the FULL closed ellipse for
      // this pipe/grade (not sized off the load points — a well-designed
      // string has small loads well inside a much bigger ellipse, and the
      // whole shape should render regardless of how small those loads are).
      var envRange = CasingModel.triaxialEnvelopeAutoRange(od_m, id_m, str.grade);
      var envelope = CasingModel.triaxialEnvelope(od_m, id_m, str.grade,
        { min: envRange.min, max: envRange.max, steps: 100 });

      // Design-limit envelope (the "how close is the DESIGN to failing"
      // curve most triaxial casing design tools show alongside the raw MYS
      // envelope) — burst-side and collapse-side derated by whichever
      // method's required DF actually governs each (Simple/Alternative/
      // Engineered can differ per string, same resolution the results
      // cards use), UNLESS the caller supplied a what-if opts.dfOverride
      // (see the function header) — that only touches this display curve,
      // never the governing pass/fail DFs above. Swept over the same dp
      // range as the MYS envelope above; points beyond where the derated
      // curve closes are dropped automatically (envelopePoint_psi returns
      // null there), so this always nests correctly inside the rated
      // envelope without a second boundary search.
      function govCheck(key) {
        var by = governing[key].governedBy;
        var src = by === 'engineered' ? engCheck : (by === 'alternative' ? altCheck : simpleCheck);
        return (src && src[key]) ? src[key] : simpleCheck[key];
      }
      var burstReqDF = dfOverride.burst != null ? dfOverride.burst : govCheck('burst').requiredDF;
      var collapseReqDF = dfOverride.collapse != null ? dfOverride.collapse : govCheck('collapse').requiredDF;
      var designEnvelope = CasingModel.triaxialDesignEnvelope(od_m, id_m, str.grade, burstReqDF, collapseReqDF,
        { min: envRange.min, max: envRange.max, steps: 100 });

      // The dp-side derating above leaves the curve's tension (Fa>0) tip
      // wherever burst/collapse DF happens to put it at dp=0 — but at
      // dp=0 the load is PURE axial, which is exactly what the Tension
      // check's own DF governs (often the tightest of the three, e.g.
      // 1.6/1.75 vs. 1.0 for burst/collapse). So the design curve's
      // tension side is additionally capped at the tension DF's derated
      // capacity (rating/DF, DF from dfOverride.tension if supplied) —
      // the smaller of the two independently-valid boundaries wins, same
      // idea as how the API rectangle in a StressCheck-style plot clips
      // the VME ellipse's tips. Compression side is left alone here —
      // that's the buckling threshold below, a different kind of limit.
      var tensionGov = govCheck('tension');
      var tensionCapDF = dfOverride.tension != null ? dfOverride.tension : tensionGov.requiredDF;
      var tensionCapN = (tensionGov && tensionGov.rating != null && tensionCapDF)
        ? tensionGov.rating / tensionCapDF : null;
      if (tensionCapN != null) {
        designEnvelope = designEnvelope.map(function (pt) {
          return { dp_Pa: pt.dp_Pa, FaHigh_N: Math.min(pt.FaHigh_N, tensionCapN), FaLow_N: pt.FaLow_N };
        });
      }

      // Buckling threshold (Ref [2] Eq. 7.34/7.35, Goins via Lubinski) —
      // Fs = Ai*pi - Ao*po; buckling occurs where the actual axial force
      // Fa drops below Fs. This is a STABILITY criterion, not a strength
      // rating like burst/collapse/tension, so it has no single "capacity"
      // — it plots as a boundary LINE, not a fixed edge. Uses the same
      // po=0 ("internal pressure only") convention as the envelope curves
      // above, so pi=dp and this reduces to a straight line through the
      // origin (Fs = Ai*dp). Swept over the same dp domain so it lines up
      // with the other curves on the same chart.
      var bucklingLine = envelope.map(function (pt) {
        return { dp_Pa: pt.dp_Pa, Fa_N: CasingModel.stabilityForce_N(od_m, id_m, pt.dp_Pa, 0) };
      });

      // "As landed" reference point (Ref [2] Sec. 7.5.6) — casing just run,
      // filled with the same mud it was run in on both sides (before
      // cementing displacement), so dp=0 and Fa is the string's own static
      // BUOYED hanging weight (pressure x body area method, same buoyancy
      // principle already used for Alternative-method tension elsewhere in
      // this file — Simple Method's own tension.load_N is UNBUOYED and
      // isn't right for this). NOTE: Fbu/length-change are properly
      // evaluated AT TOP OF CEMENT (Sec. 7.5.6) — this module doesn't
      // currently track a top-of-cement depth per string, so the string's
      // own shoe TVD/mud state is used as a stand-in reference point
      // (same depth already used for the Tension check) rather than
      // inventing an unstated TOC. Flagged here rather than silently
      // assumed — revisit if a TOC input is ever added.
      var mudGradForBuckling = p.mudGradient_kPa_m != null ? p.mudGradient_kPa_m : 0;
      var asLandedP_Pa = mudGradForBuckling * 1000 * str.shoeTVD_m;
      var asLandedFs_N = CasingModel.stabilityForce_N(od_m, id_m, asLandedP_Pa, asLandedP_Pa);
      var Ac_m2 = Math.PI / 4 * (od_m * od_m - id_m * id_m); // steel cross-section, As
      var weightAir_Npm = (str.weight_kgpm || 0) * G;
      var asLandedFb_N = mudGradForBuckling * 1000 * Ac_m2 * str.shoeTVD_m; // pressure x body area (Ao-Ai=As)
      var asLandedFa_N = weightAir_Npm * str.shoeTVD_m - asLandedFb_N; // buoyed hanging weight
      var asLandedFbu_N = asLandedFs_N - asLandedFa_N;

      // Radial clearance (Δr, Eq. 7.33) — derived from the PREVIOUS
      // (parent) casing string's ID: the free length above cement top runs
      // through whichever string this one is landed inside, before
      // entering open hole. The shallowest string in the program (e.g.
      // Surface) has no previous casing to derive clearance from — open-
      // hole size isn't tracked in Casing Design, so length change isn't
      // computed for it (left null) rather than guessed.
      var sortedForParent = (casingStrings || []).slice().sort(function (a, b) { return a.shoeMD_m - b.shoeMD_m; });
      var myIdx = sortedForParent.findIndex(function (s) { return s.name === str.name; });
      var parentStr = myIdx > 0 ? sortedForParent[myIdx - 1] : null;
      var radialClearance_mm = null, bucklingLengthChange_m = null;
      if (parentStr) {
        radialClearance_mm = (parentStr.id_mm - str.od_mm) / 2;
        if (radialClearance_mm > 0 && asLandedFbu_N > 0) {
          var wBuoy_Npm = weightAir_Npm - mudGradForBuckling * 1000 * Ac_m2;
          bucklingLengthChange_m = CasingModel.bucklingLengthChange_m(
            od_m, id_m, radialClearance_mm / 1000, asLandedFbu_N, wBuoy_Npm);
        }
      }
      var buckling = {
        asLanded: { dp_Pa: 0, Fa_N: asLandedFa_N, Fs_N: asLandedFs_N, Fbu_N: asLandedFbu_N, willBuckle: asLandedFbu_N > 0 },
        parentStringName: parentStr ? parentStr.name : null,
        radialClearance_mm: radialClearance_mm,
        lengthChange_m: bucklingLengthChange_m
      };

      function loadPoint(label, pi_kPa, po_kPa, Fa_N, fiber) {
        var pt = CasingModel.triaxialPoint({ od_m: od_m, id_m: id_m, pi_Pa: pi_kPa * 1000, po_Pa: po_kPa * 1000, Fa_N: Fa_N, fiber: fiber || 'ID' });
        return { label: label, dp_Pa: (pi_kPa - po_kPa) * 1000, Fa_N: Fa_N, svm_Pa: pt.svm_Pa };
      }
      var points = [
        loadPoint('Burst (simple)', simple.burst.pi_kPa, 0, simple.tension.load_N),
        loadPoint('Collapse (simple)', 0, simple.collapse.po_kPa, simple.tension.load_N)
      ];
      if (alt) {
        points.push(
          loadPoint('Burst (alternative)', alt.burst.pi_kPa, alt.burst.po_kPa, alt.tension.load_N),
          loadPoint('Collapse (alternative)', alt.collapse.pi_kPa, alt.collapse.po_kPa, alt.tension.load_N)
        );
      }
      if (eng) {
        points.push(
          loadPoint('Burst (engineered)', eng.burst.pi_kPa, eng.burst.po_kPa, eng.tension.load_N),
          loadPoint('Collapse (engineered)', eng.collapse.pi_kPa, eng.collapse.po_kPa, eng.tension.load_N)
        );
      }

      var parentCheck = null;
      if (str.stringType === 'liner' && p.parentStringName) {
        var parentStr = (casingStrings || []).filter(function (s) { return s.name === p.parentStringName; })[0];
        if (parentStr) {
          function winningLoads(key) {
            var by = governing[key].governedBy;
            var src = by === 'engineered' ? eng : (by === 'alternative' ? alt : simple);
            return src[key];
          }
          var governingLoadsForParent = { burst: winningLoads('burst'), collapse: winningLoads('collapse'), tension: winningLoads('tension') };
          parentCheck = Object.assign(
            linerParentCheck(parentStr, governingLoadsForParent, p.parentWallWearFraction),
            { parentStringName: p.parentStringName }
          );
        } else {
          parentCheck = { error: 'Parent string "' + p.parentStringName + '" not found among casing strings.' };
        }
      }

      // Overpull check, evaluated against whichever tension method
      // actually governs (so it uses the buoyed tension where Alternative/
      // Engineered won, not the unbuoyed Simple value).
      var govTensionBy = governing.tension.governedBy;
      var govTensionSrc = govTensionBy === 'engineered' ? eng : (govTensionBy === 'alternative' ? alt : simple);
      var govTensionCheck = govTensionBy === 'engineered' ? engCheck : (govTensionBy === 'alternative' ? altCheck : simpleCheck);
      var overpull = (govTensionSrc && govTensionCheck)
        ? overpullCheck(str, govTensionSrc, govTensionCheck.tension, p.overpull_kdaN)
        : null;

      byString[str.name] = {
        string: str,
        simple: { loads: simple, check: simpleCheck },
        alternative: alt ? { loads: alt, check: altCheck } : null,
        alternativeError: altError,
        engineered: eng ? { loads: eng, check: engCheck } : null,
        engineeredError: engError,
        governing: governing,
        parentCheck: parentCheck,
        overpull: overpull,
        triaxial: { envelope: envelope, designEnvelope: designEnvelope, bucklingLine: bucklingLine, points: points },
        buckling: buckling
      };
    });
    return { byString: byString };
  }

  return {
    simpleLoads: simpleLoads,
    alternativeLoads: alternativeLoads,
    engineeredLoads: engineeredLoads,
    designCheck: designCheck,
    linerParentCheck: linerParentCheck,
    overpullCheck: overpullCheck,
    computeCasingDesign: computeCasingDesign
  };
}));

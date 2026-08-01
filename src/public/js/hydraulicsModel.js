// ============================================================================
// Bit Hydraulics Program — pipe/annular frictional pressure loss + bit
// hydraulics core.
//
// Ported function-for-function from the legacy Hydraulics.xls VBA macro
// (Module1.bas: PPlossb, PPlosspl, APlossb, APlosspl, and the Button20_Click
// bit-hydraulics/nozzle-optimization routine), so this module reproduces the
// same numbers as that spreadsheet for the same inputs. Every constant below
// exists in the original VBA; none have been added or "improved".
//
// Loaded by both:
//   - the browser (uploadHydraulics.ejs, via <script src="/js/hydraulicsModel.js">)
//   - the Node.js backend (notes.controller.js, via require())
// These functions are pure: plain data in, plain data out — no DOM/window
// references, matching the tdModel.js convention in this project.
//
// ---------------------------------------------------------------------------
// REFERENCE (physics basis — cite this when reporting results)
//
// [1] Bourgoyne, A.T. Jr., Millheim, K.K., Chenevert, M.E., Young, F.S. Jr.
//     "Applied Drilling Engineering." SPE Textbook Series Vol. 2, Society of
//     Petroleum Engineers, Richardson, TX, 1986. Chapter 4 (Drilling Fluids):
//       - Bingham plastic laminar pipe/annular pressure loss (exact solution)
//       - Power law rheological parameters (n, K) from Fann 300/600 readings
//       - Power law laminar pipe/annular pressure loss (slot-flow
//         approximation for the annulus)
//       - Generalized Reynolds number and laminar/turbulent transition
//         (critical Reynolds number Re_c = 3470 - 1370n, turbulent onset at
//         Re_c + 800)
//       - Turbulent friction factor correlation f = a / Re^b with
//         a = (log10(n) + 3.93) / 50, b = (1.75 - log10(n)) / 7
//     These are the same field-unit (gpm, in, lbm/gal, cp, ft) formulas
//     reproduced in the VBA source; the spreadsheet does not cite a source
//     in-code, but every constant below (24.51, 1.6, 300, 92903, 15.47,
//     3470/1370, 800, etc.) matches this textbook's field-unit formulation.
// [2] API Recommended Practice 13D, "Rheology and Hydraulics of Oil-well
//     Drilling Fluids" — defines PV = R600-R300, YP = R300-PV, and the
//     Bingham/Power-Law model conventions used throughout.
//
// Nozzle total flow area (TFA) optimization, bit hydraulic horsepower (BHHP),
// hydraulic horsepower per square inch (HSI), jet impact force, and ECD are
// the standard field-unit bit hydraulics relationships also used throughout
// the industry (e.g. Bourgoyne Ch. 4, Rabia "Well Engineering & Construction"
// Ch. 6) — reproduced here exactly as coded in the VBA, unchanged.
//
// UNITS NOTE: like tdModel.js, this core computes internally in the VBA's
// native FIELD units (in, ft, gpm, lbm/gal, cp, lbf/100ft2, psi) because
// that is what the constants below are calibrated for. Callers pass metric
// inputs; convertToField()/convertResultsToMetric() at the bottom handle the
// boundary, exactly mirroring the unit conversions in the original macro
// (e.g. .Cells(x) = value * 0.06894757293 * 100 for kPa, etc.).
// ---------------------------------------------------------------------------

(function (root, factory) {
  if (typeof module !== 'object' || typeof module.exports !== 'object') {
    root.HydraulicsModel = factory();
  } else {
    module.exports = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

var PI = 3.141592654;

function log10(x) { return Math.log(x) / Math.log(10); }
function arcsin(x) { return Math.atan(x / Math.sqrt(-x * x + 1)); }

// ---------------------------------------------------------------------------
// Pipe flow, Bingham Plastic (exact solution) — VBA: PPlossb
// pvis=PV(cp), yp=YP(lbf/100ft2), q=flow(gpm), d=ID(in), l=length(ft),
// mw=mud weight(lbm/gal). Returns { dp (psi), vbar (ft/min) }.
// ---------------------------------------------------------------------------
function ppLossBingham(pvis, yp, q, d, l, mw) {
  var Rec = 2000;
  var vbar = 24.51 * q / (d * d);
  var beta = 1 + pvis * vbar / 399 / yp / d;
  // VBA: z = (beta^2 + (beta^4 - 1)^0.5) ^ (1/3) — reproduced exactly.
  var z = Math.pow(beta * beta + Math.sqrt(Math.pow(beta, 4) - 1), 1 / 3);
  var y = 2 * (z + 1 / z);
  var x = 0.5 * (Math.sqrt(y) - Math.sqrt(8 * beta / Math.sqrt(y) - y));
  var dpl = l * yp / 300 / x / d;
  var mubar = 90000 * dpl * d * d / l / vbar;
  var Re = 15.47 * mw * vbar * d / mubar;

  var dp, f;
  if (Re < Rec) {
    dp = dpl;
  } else {
    f = 0.079 / Math.pow(Re, 0.25);
    dp = f * l * mw * vbar * vbar / 92903 / d;
  }
  return { dp: dp, vbar: vbar };
}

// ---------------------------------------------------------------------------
// Pipe flow, Power Law — VBA: PPlosspl
// ---------------------------------------------------------------------------
function ppLossPowerLaw(pvis, yp, q, d, l, mw) {
  var n = 1 / log10(2) * log10((2 * pvis + yp) / (pvis + yp));
  var k = 1.067 * (pvis + yp) * Math.pow(n / 20 / PI * (1 - Math.pow(1.0678, -2 / n)), n);

  var vbar = 24.51 * q / (d * d);
  var dpl = l * k / 300 / d * Math.pow(1.6 * vbar / d * (3 * n + 1) / 4 / n, n);
  var Rec = 3470 - 1370 * n;
  var mubar = 90000 * dpl * d * d / l / vbar;
  var Re = 15.47 * mw * vbar * d / mubar;

  var dp, y, z, f;
  if (Re < Rec) {
    dp = dpl;
  } else {
    y = (log10(n) + 3.93) / 50;
    z = (1.75 - log10(n)) / 7;
    if (Re >= Rec + 800) {
      f = y / Math.pow(Re, z);
    } else {
      f = 16 / Re + (Re - Rec) / 800 * (y / Math.pow(Re, z) - 16 / Re);
    }
    dp = f * l * mw * vbar * vbar / 92903 / d;
  }
  return { dp: dp, vbar: vbar, n: n, k: k };
}

// ---------------------------------------------------------------------------
// Annular flow, Bingham Plastic (narrow-slot approximation) — VBA: APlossb
// id/od = annulus ID/OD (in). Returns { dp (psi), vbar, vc (critical vel, ft/min) }.
// ---------------------------------------------------------------------------
function apLossBingham(pvis, yp, id, od, q, l, mw) {
  var Rec = 30000;
  var alpha = id / od;
  var vbar = 24.51 * q / (od * od - id * id);
  var b = 2394 * yp * (od - id) / pvis / vbar;
  var beta = Math.sqrt(b / (b + 8));
  var x = 2 / beta * Math.sin(1 / 3 * arcsin(Math.pow(beta, 3)));
  var dpl = l * yp / 300 / x / (od - id);
  var mubar = 60000 * dpl * od * od * Math.pow(1 - alpha, 2) / l / vbar;
  var Re = 15.47 * mw * vbar * (od - id) / mubar;

  var dp, f;
  if (Re <= Rec) {
    dp = dpl;
  } else {
    f = 0.079 / Math.pow(Re, 0.25);
    dp = f * l * mw * vbar * vbar / 92903 / (od - id);
  }
  var vc = (64.8 * pvis + 64.8 * Math.sqrt(pvis * pvis + 9.26 * Math.pow(od - id, 2) * yp * mw)) / mw / (od - id);
  return { dp: dp, vbar: vbar, vc: vc };
}

// ---------------------------------------------------------------------------
// Annular flow, Power Law (narrow-slot approximation) — VBA: APlosspl
// ---------------------------------------------------------------------------
function apLossPowerLaw(pvis, yp, id, od, q, l, mw) {
  var n = 1 / log10(2) * log10((2 * pvis + yp) / (pvis + yp));
  var k = 1.067 * (pvis + yp) * Math.pow(n / 20 / PI * (1 - Math.pow(1.0678, -2 / n)), n);

  var alpha = id / od;
  var vbar = 24.51 * q / (od * od - id * id);
  var y0 = 0.37 / Math.pow(n, 0.14);
  var z0 = 1 - Math.pow(1 - Math.pow(alpha, y0), 1 / y0);
  var g = (1 + z0 / 2) * (n * (3 - z0) + 1) / (4 - z0) / n;
  var dpl = k * l / 300 / (od - id) * Math.pow(1.6 * vbar * g / (od - id), n);
  var gn = (1 + alpha * alpha + (1 - alpha * alpha) / Math.log(alpha)) / Math.pow(1 - alpha, 2);
  var mubar = 90000 * dpl * od * od * Math.pow(1 - alpha, 2) * gn / l / vbar;
  var Re = 15.47 * mw * vbar * (od - id) / mubar;
  var Rec = (3470 - 1370 * n) / gn;

  var dp, y, z, f;
  if (Re < Rec) {
    dp = dpl;
  } else {
    y = (log10(n) + 3.93) / 50;
    z = (1.75 - log10(n)) / 7;
    if (Re >= Rec + 800 / gn) {
      f = y / Math.pow(Re, z);
    } else {
      f = 16 / Re / gn + (Re - Rec) * gn / 800 * (y / Math.pow(Re, z) - 16 / Re / gn);
    }
    dp = f * l * mw * vbar * vbar / 92903 / (od - id);
  }
  var vc = Math.pow(38780 * k / mw, 1 / (2 - n)) * Math.pow(2.4 / (od - id) * (2 * n + 1) / 4 / n, n / (2 - n));
  return { dp: dp, vbar: vbar, vc: vc, n: n, k: k };
}

// Fluid-model blend, exactly as coded in Button20_Click: when fm is neither
// 1 (Power Law) nor 2 (Bingham) — i.e. fm=3, "Modified PL&B" — the VBA runs
// BOTH models and blends 70% toward Bingham: dp = dppl + (dpb-dppl)*0.7.
function pipeLoss(fm, pvis, yp, q, d, l, mw) {
  if (fm === 1) return ppLossPowerLaw(pvis, yp, q, d, l, mw);
  if (fm === 2) return ppLossBingham(pvis, yp, q, d, l, mw);
  var pl = ppLossPowerLaw(pvis, yp, q, d, l, mw);
  var bp = ppLossBingham(pvis, yp, q, d, l, mw);
  return { dp: pl.dp + (bp.dp - pl.dp) * 0.7, vbar: pl.vbar };
}
function annulusLoss(fm, pvis, yp, id, od, q, l, mw) {
  if (fm === 1) return apLossPowerLaw(pvis, yp, id, od, q, l, mw);
  if (fm === 2) return apLossBingham(pvis, yp, id, od, q, l, mw);
  var pl = apLossPowerLaw(pvis, yp, id, od, q, l, mw);
  var bp = apLossBingham(pvis, yp, id, od, q, l, mw);
  return { dp: pl.dp + (bp.dp - pl.dp) * 0.7, vbar: pl.vbar, vc: pl.vc };
}

// ---------------------------------------------------------------------------
// Standard 1/32-inch nozzle sizes used by the Auto TFA optimizer — VBA
// searches around a starting size `d` (in 1/32") in both directions to find
// the combination of `nn` nozzles whose total flow area best matches the
// required minimum TFA, exactly mirroring the po()/mo() search loops in
// Button20_Click.
// ---------------------------------------------------------------------------
function optimizeNozzles(mintfa, nn) {
  var d = Math.round(Math.sqrt(4 * mintfa / nn / PI) * 32);
  var i, j, k, ap, ac;

  // Search upward (po): start all nozzles at size d, then progressively
  // bump earlier positions up by 1/32" until total area >= mintfa.
  var po = [];
  for (i = 1; i <= nn; i++) {
    po[i] = [];
    for (j = 0; j <= nn; j++) {
      po[i][j] = d + (i <= j ? 1 : 0);
    }
  }
  k = 0;
  for (i = 1; i <= nn; i++) k += po[i][0] * po[i][0];
  ap = 0.000767 * k;
  for (i = 1; i <= nn; i++) {
    if (ap < mintfa) po[i][0] += 1;
    k = 0;
    for (j = 1; j <= nn; j++) k += po[j][0] * po[j][0];
    ap = 0.000767 * k;
  }
  var upSizes = null;
  for (j = 0; j <= nn; j++) {
    k = 0;
    for (i = 1; i <= nn; i++) k += po[i][j] * po[i][j];
    ac = 0.000767 * k;
    if (ac > mintfa) {
      if (Math.abs(ap - mintfa) >= Math.abs(ac - mintfa)) {
        ap = ac;
        upSizes = [];
        for (i = 1; i <= nn; i++) upSizes[i - 1] = po[i][j] * 25.4 / 32; // mm
      }
    }
  }

  // Search downward (mo): mirrors the second loop in the VBA, which then
  // picks whichever of the up/down candidates is closer to mintfa.
  var mo = [];
  for (i = 1; i <= nn; i++) {
    mo[i] = [];
    for (j = 1; j <= nn; j++) {
      mo[i][j] = d - (i <= j ? 1 : 0);
    }
  }
  var downSizes = upSizes;
  for (j = 1; j <= nn; j++) {
    k = 0;
    for (i = 1; i <= nn; i++) k += mo[i][j] * mo[i][j];
    ac = 0.000767 * k;
    if (ac > mintfa) {
      if (Math.abs(ap - mintfa) >= Math.abs(ac - mintfa)) {
        ap = ac;
        downSizes = [];
        for (i = 1; i <= nn; i++) downSizes[i - 1] = mo[i][j] * 25.4 / 32; // mm
      }
    }
  }

  return { totalTfa_in2: ap, nozzleSizes_mm: downSizes || upSizes || [] };
}

// ---------------------------------------------------------------------------
// computeHydraulics — top-level entry point. Mirrors Button20_Click end to
// end: pipe-flow loop over the drill string, surface equipment loss,
// annulus-flow loop, and bit hydraulics (nozzle sizing or manual TFA).
//
// Inputs (all metric, converted internally to the VBA's field units):
//   drillString: [{ name, od_mm, id_mm, tjOd_mm, tjId_mm, length_m }, ...]
//                ordered top (surface) to bottom (bit) — matches Hyd_Program
//                rows 35-49 (component) with rows 12-20 (casing/hole) giving
//                the annulus geometry the same way the VBA joins them.
//   annulusGeom: [{ name, id_mm, to_m }, ...] casing/liner/open-hole sections,
//                "ID (mm)" and cumulative "To (m)" depth, ordered top to
//                bottom — mirrors Hyd_Program!H12:I20.
//   params: {
//     bitDiameter_mm, mdOut_m, mudWeight_kgm3, pv_cP, yp_Pa, flowRate_Lmin,
//     maxPumpPressure_kPa, motorBypassPct, tvd_m,
//     fluidModel: 1|2|3,              // Power Law | Bingham | Modified PL&B
//     surfaceEquipClass: 1|2|3|4,     // matches Other!c2/c=1,0.45,0.3,0.2
//     nozzleMode: 'auto'|'manual',
//     nozzleCount: int (<=10),        // Hyd_Program!C19
//     manualNozzles_mm: [n1..n10] (only used when nozzleMode='manual')
//   }
// Returns a results object with both field- and metric-unit summaries, plus
// per-row pipe/annulus breakdowns (mirrors what the VBA writes back to the
// worksheet).
// ---------------------------------------------------------------------------
function computeHydraulics(drillString, annulusGeom, params) {
  var warnings = [];
  var pi = PI;

  var fm = params.fluidModel || 3;
  var se = params.surfaceEquipClass || 1;

  // ---- Convert inputs to VBA field units ----
  var tvd = params.tvd_m / 0.3048;
  var dbit = params.bitDiameter_mm / 25.4;
  var mw = params.mudWeight_kgm3 * 8.345404 / 1000;
  var pvis = params.pv_cP;
  var yp = params.yp_Pa / 0.478803;
  var q = params.flowRate_Lmin / 3.785412;
  var ppmax = params.maxPumpPressure_kPa / 0.06894757293 / 100;
  var mb = (params.motorBypassPct || 0) / 100;
  var nn = params.nozzleCount || 0;
  var mdout = params.mdOut_m / 0.3048;

  // ---- Pipe flow: walk the drill string top to bottom ----
  var dptp = 0;
  var pipeRows = [];
  drillString.forEach(function (row) {
    var idIn = row.id_mm / 25.4;
    var lenFt = 0.97 * (row.length_m / 0.3048); // 97% pipe body, VBA convention
    var r1 = pipeLoss(fm, pvis, yp, q, idIn, lenFt, mw);
    var dp1 = r1.dp;

    var tjIdIn = row.tjId_mm / 25.4;
    var tjLenFt = 0.03 * (row.length_m / 0.3048); // 3% tool joint, VBA convention
    var r2 = pipeLoss(fm, pvis, yp, q, tjIdIn, tjLenFt, mw);
    var dp2 = dp1 + r2.dp;

    dptp += dp2;
    pipeRows.push({
      name: row.name,
      pressureLoss_kPa: dp2 * 0.06894757293 * 100,
      capacity_bbl: ((idIn * idIn / 1029.4 * lenFt) + (tjIdIn * tjIdIn / 1029.4 * tjLenFt)) * 0.158987,
    });
  });

  // ---- Surface equipment loss ----
  var m = fm === 1 ? 1.8 : (fm === 2 ? 1.95 : 1.85);
  var cMap = { 1: 1, 2: 0.45, 3: 0.3, 4: 0.2 };
  var c = cMap[se] != null ? cMap[se] : 0.2;
  var dpsur = c * mw * Math.pow(q / 100, m);

  // ---- Annulus flow: for each drill-string OD segment, find which
  // annulus (casing/OH) section(s) it passes through and sum losses ----
  var dpta = 0;
  var annulusRows = [];
  var cl = 0, s = 0, e = 0, h = 0;
  drillString.forEach(function (dsRow) {
    if (!(dsRow.od_mm > 0) || !(dsRow.length_m > 0)) return;
    var l = dsRow.length_m / 0.3048;
    cl += l;
    var flag = 1;
    for (var j = s; j < annulusGeom.length && flag; j++) {
      var seg = annulusGeom[j];
      var clsFt = seg.to_m / 0.3048;
      var segLen;
      if (cl > clsFt) {
        segLen = clsFt - e - h;
        s = j + 1; h = 0; e = clsFt;
      } else if (cl === clsFt) {
        segLen = cl - e - h;
        s = j + 1; h = 0; e = clsFt; flag = 0;
      } else {
        segLen = cl - e - h;
        h += segLen; flag = 0;
      }
      var odIn = seg.id_mm / 25.4;
      var idIn = dsRow.od_mm / 25.4;
      var lenFt = segLen;
      if (odIn <= idIn) {
        warnings.push('Annulus ID of "' + seg.name + '" is smaller than OD of "' + dsRow.name + '" — geometry invalid at this section.');
        continue;
      }
      var r = annulusLoss(fm, pvis, yp, idIn, odIn, q, lenFt, mw);
      dpta += r.dp;
      annulusRows.push({
        section: seg.name, component: dsRow.name,
        od_mm: seg.id_mm, id_mm: dsRow.od_mm, length_m: lenFt * 0.3048,
        avgVelocity_mmin: r.vbar * 0.3048, criticalVelocity_mmin: r.vc * 0.3048,
        flowRegime: r.vbar >= r.vc ? 'Turbulent' : 'Laminar',
        pressureLoss_kPa: r.dp * 0.06894757293 * 100,
      });
    }
  });

  // ---- Bit hydraulics: nozzle sizing + pressure/HP/HSI/impact/ECD ----
  var bit = { warnings: warnings };
  var dpbit, nozzleSizes_mm = [], totalTfa_in2 = 0, mintfa_in2 = null;

  if (params.nozzleMode === 'auto') {
    var dpAvail = ppmax - dptp - dpta - dpsur;
    if (dpAvail <= 0) {
      warnings.push('No pressure available at the bit — reduce string/annulus/surface losses or increase max pump pressure.');
      dpbit = null;
    } else {
      mintfa_in2 = Math.sqrt(Math.pow(1 - mb, 2) * q * q * mw / 10858 / dpAvail);
      var opt = optimizeNozzles(mintfa_in2, nn);
      totalTfa_in2 = opt.totalTfa_in2;
      nozzleSizes_mm = opt.nozzleSizes_mm;
      dpbit = Math.pow(1 - mb, 2) * q * q * mw / 10858 / (totalTfa_in2 * totalTfa_in2);
    }
  } else {
    // Manual: sum operator-entered nozzle sizes (mm -> 1/32in -> area)
    var kSum = 0;
    (params.manualNozzles_mm || []).forEach(function (mm) {
      var thirtySeconds = mm / 25.4 * 32;
      kSum += thirtySeconds * thirtySeconds;
    });
    totalTfa_in2 = 0.000767 * kSum;
    nozzleSizes_mm = params.manualNozzles_mm || [];
    if (totalTfa_in2 <= 0) {
      warnings.push('Enter nozzle sizes for Manual nozzle calculation.');
      dpbit = null;
    } else {
      dpbit = Math.pow(1 - mb, 2) * q * q * mw / 10858 / (totalTfa_in2 * totalTfa_in2);
      var dpbitCheck = ppmax - dptp - dpta - dpsur;
      if (dpbitCheck <= 0) {
        warnings.push('No pressure available at the bit! Check max pump pressure.');
      } else {
        mintfa_in2 = Math.sqrt(Math.pow(1 - mb, 2) * q * q * mw / 10858 / dpbitCheck);
        if (dptp + dpta + dpsur + dpbit > ppmax) {
          warnings.push('System pressure loss is higher than maximum pump pressure!');
        }
      }
    }
  }

  var results = {
    fluidModel: fm, surfaceEquipClass: se,
    pipeRows: pipeRows, annulusRows: annulusRows,
    pressureLoss_kPa: {
      drillString: dptp * 0.06894757293 * 100,
      annulus: dpta * 0.06894757293 * 100,
      surface: dpsur * 0.06894757293 * 100,
      bit: dpbit != null ? dpbit * 0.06894757293 * 100 : null,
    },
    warnings: warnings,
  };

  if (dpbit != null) {
    var ap = totalTfa_in2;
    var vjet = 0.321 * q / ap;
    var bhhp = dpbit * q / 1714;
    var od_bit = dbit;
    var hsi = bhhp / pi / Math.pow(od_bit / 2, 2);
    var iforce = mw * q * vjet / 1932;
    var ecd = mw + dpta / tvd / 0.052;
    var spp = dptp + dpta + dpsur + dpbit;

    results.bitHydraulics = {
      minTfa_mm2: mintfa_in2 != null ? mintfa_in2 * 645.16 : null,
      totalTfa_mm2: ap * 645.16,
      nozzleSizes_mm: nozzleSizes_mm,
      jetVelocity_ms: vjet * 0.3048,
      bitPressureDrop_kPa: dpbit * 0.06894757293 * 100,
      bitHydraulicPower_W: bhhp * 745.699872,
      hsi_Wmm2: hsi * 1.155837,
      impactForce_N: iforce * 4.448222,
      ecd_kgm3: ecd / 8.345404 * 1000,
      standpipePressure_kPa: spp * 0.06894757293 * 100,
    };
    results.pressureLossPct = {
      drillString: dptp / spp * 100, annulus: dpta / spp * 100,
      surface: dpsur / spp * 100, bit: dpbit / spp * 100,
    };
  }

  return results;
}

return {
  ppLossBingham: ppLossBingham,
  ppLossPowerLaw: ppLossPowerLaw,
  apLossBingham: apLossBingham,
  apLossPowerLaw: apLossPowerLaw,
  optimizeNozzles: optimizeNozzles,
  computeHydraulics: computeHydraulics,
};

}));

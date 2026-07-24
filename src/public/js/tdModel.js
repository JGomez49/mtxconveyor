// ============================================================================
// Torque & Drag — soft-string (Johancsik 1984) calculation core.
//
// Extracted verbatim from uploadTorqueAndDrag.ejs so there is exactly ONE
// implementation of this physics, shared by:
//   - the browser (uploadTorqueAndDrag.ejs, via <script src="/js/tdModel.js">)
//   - the Node.js backend (notes.controller.js, via require())
//
// These functions are pure: they take survey/casing/BHA/params as plain
// data and return plain data — no DOM access, no UI state. Do not add any
// document/window references here, or the server-side require() will break.
//
// ---------------------------------------------------------------------------
// REFERENCES (physics basis — cite these when reporting results)
//
// [1] Johancsik, C.A., Friesen, D.B., Dawson, R. (1984). "Torque and Drag in
//     Directional Wells — Prediction and Measurement." JPT 36(6), 987-992.
//     SPE-11380-PA.            -> soft-string tension/torque/contact model.
// [2] Sheppard, M.C., Wick, C., Burgess, T. (1987). "Designing Well Paths to
//     Reduce Drag and Torque." SPE Drilling Engineering 2(4). SPE-15463-PA.
//                              -> differential form; effective tension basis.
// [3] Dawson, R., Paslay, P.R. (1984). "Drill Pipe Buckling in Inclined Holes."
//     JPT 36(10), 1734-1738. SPE-11167-PA.
//                              -> sinusoidal (critical) buckling load:
//                                 Fsin = 2*sqrt(E*I*w*sin(inc)/rc)
// [4] Lubinski, A. (1950). "A Study of the Buckling of Rotary Drilling
//     Strings." API Drilling & Production Practice.
//                              -> vertical-hole buckling criterion used here
//                                 for inc < 3 deg: Fcrit ~ 1.94*(E*I*w^2)^(1/3)
// [5] Chen, Y-C., Lin, Y-H., Cheatham, J.B. (1990). "Tubing and Casing
//     Buckling in Horizontal Wells." JPT 42(2), 140-141. SPE-19176-PA.
//                              -> helical onset: Fhel = sqrt(2)*Fsin (default)
// [6] Wu, J., Juvkam-Wold, H.C. (1993). "Helical Buckling of Pipes in
//     Extended Reach and Horizontal Wells" (and 1995 companion papers).
//     ASME J. Energy Res. Tech. 115.
//                              -> alternative helical onset:
//                                 Fhel = 2*(2*sqrt(2)-1)/2 * Fsin = 1.83*Fsin
//                                 (select with params.helicalMode = 'wu')
// [7] Mitchell, R.F. (1986). "Simple Frictional Analysis of Helical Buckling
//     of Tubing." SPE Drilling Engineering 1(6). SPE-13064-PA.
//                              -> helically-buckled wall contact force per
//                                 unit length: Nh = rc*Fc^2/(4*E*I)
// [8] Mitchell, R.F., Samuel, R. (2009). "How Good Is the Torque/Drag
//     Model?" SPE Drilling & Completion 24(1). SPE-105068-PA.
//                              -> limits of soft-string; stiff-string context.
// [10] Samuel, R. (2010). "Friction Factors: What Are They for Torque,
//     Drag, Vibration, Bottomhole Assembly and Transient Surge/Swab
//     Analyses?" SPE-128059-MS. IADC/SPE Drilling Conference.
//                              -> velocity-resolved friction for combined
//                                 axial + rotary motion (tripping w/ RPM).
// [9] Mitchell, R.F., Miska, S.Z. (2011). "Fundamentals of Drilling
//     Engineering." SPE Textbook Series Vol. 12, Ch. 8-9.
//                              -> E = 30e6 psi (206.8 GPa) for steel; buckling
//                                 and T&D summary equations in textbook form.
//
// Landmark WellPlan's "Contact Force Normalization Length" (default one joint,
// 9.45 m for Range 2 DP) is a *display* convention: side force is reported as
// kgf per that length. The core below stays per-metre; the view layer scales.
// ---------------------------------------------------------------------------

var TD_G = 9.81; // m/s^2

function tdMinCurvature(survey) {
  var out = [];
  var tvd = 0, ns = 0, ew = 0;
  out.push({ md: survey[0].md, inc: survey[0].inc, az: survey[0].az, tvd: 0, ns: 0, ew: 0, dls: 0 });
  for (var i = 1; i < survey.length; i++) {
    var a = survey[i - 1], b = survey[i];
    var dMD = b.md - a.md;
    if (dMD <= 0) { out.push({ md: b.md, inc: b.inc, az: b.az, tvd: tvd, ns: ns, ew: ew, dls: 0 }); continue; }
    var I1 = a.inc * Math.PI / 180, I2 = b.inc * Math.PI / 180;
    var A1 = a.az * Math.PI / 180, A2 = b.az * Math.PI / 180;
    var cosB = Math.cos(I2 - I1) - Math.sin(I1) * Math.sin(I2) * (1 - Math.cos(A2 - A1));
    var beta = Math.acos(Math.max(-1, Math.min(1, cosB)));
    var RF = beta < 1e-6 ? 1 : (2 / beta) * Math.tan(beta / 2);
    tvd += (dMD / 2) * (Math.cos(I1) + Math.cos(I2)) * RF;
    ns += (dMD / 2) * (Math.sin(I1) * Math.cos(A1) + Math.sin(I2) * Math.cos(A2)) * RF;
    ew += (dMD / 2) * (Math.sin(I1) * Math.sin(A1) + Math.sin(I2) * Math.sin(A2)) * RF;
    var dls = (beta * 180 / Math.PI) / dMD * 30;
    out.push({ md: b.md, inc: b.inc, az: b.az, tvd: tvd, ns: ns, ew: ew, dls: dls });
  }
  return out;
}

function tdInterpTraj(traj, md) {
  if (md <= traj[0].md) return traj[0];
  var last = traj[traj.length - 1];
  if (md >= last.md) return last;
  for (var i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      var a = traj[i - 1], b = traj[i];
      var t = (md - a.md) / (b.md - a.md);
      return {
        tvd: a.tvd + t * (b.tvd - a.tvd),
        ns: a.ns + t * (b.ns - a.ns),
        ew: a.ew + t * (b.ew - a.ew),
        dls: a.dls + t * (b.dls - a.dls),
        inc: a.inc + t * (b.inc - a.inc),
        az: a.az + t * (b.az - a.az)
      };
    }
  }
  return last;
}

function tdHoleAt(md, casings, ohTop, ohDiam_m, params) {
  var sorted = casings.slice().sort(function (a, b) { return b.shoe - a.shoe; });
  for (var i = 0; i < sorted.length; i++) {
    var c = sorted[i];
    if (md >= c.top && md <= c.shoe) {
      var ff = (c.ffidx === 1) ? params.ff1 : (c.ffidx === 2) ? params.ff2 : params.ffOH;
      return { id_m: c.id_m, ff: ff, inCasing: true, ffidx: c.ffidx };
    }
  }
  if (md >= ohTop) return { id_m: ohDiam_m, ff: params.ffOH, inCasing: false, ffidx: 0 };
  if (sorted.length > 0) return { id_m: sorted[sorted.length - 1].id_m, ff: params.ff1, inCasing: true, ffidx: 1 };
  return { id_m: ohDiam_m, ff: params.ffOH, inCasing: false, ffidx: 0 };
}

function tdPipeAt(md, td, bha) {
  var depth = td;
  for (var i = 0; i < bha.length; i++) {
    var top = depth - bha[i].len;
    if (md >= top && md <= depth) return bha[i];
    depth = top;
  }
  return null;
}

function tdInterpSurv(surv, md) {
  if (md <= surv[0].md) return { inc: surv[0].inc, az: surv[0].az };
  var last = surv[surv.length - 1];
  if (md >= last.md) return { inc: last.inc, az: last.az };
  for (var i = 1; i < surv.length; i++) {
    if (md <= surv[i].md) {
      var a = surv[i - 1], b = surv[i], t = (md - a.md) / (b.md - a.md);
      return { inc: a.inc + t * (b.inc - a.inc), az: a.az + t * (b.az - a.az) };
    }
  }
  return { inc: last.inc, az: last.az };
}

// Buckling state for compression C (N) against node limits:
// 0 = straight, 1 = sinusoidal (Dawson-Paslay/Lubinski), 2 = helical.
function tdBuckState(C, nd) {
  if (!(C > 0)) return 0;
  if (C >= nd.fhel) return 2;
  if (C >= nd.fsin) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Buckling thresholds for one element.
//   od_m/id_m : pipe body OD/ID (m);  hole_m : hole/casing ID (m)
//   wBuoy_Npm : buoyed weight per length (N/m);  incDeg : inclination (deg)
//   E : Young's modulus (Pa);  helicalMode : 'chen' (default) | 'wu'
// Returns { ei, rc, fsin, fhel } in SI (N, m, N*m^2).
// fsin: Dawson & Paslay (1984) [3]; near-vertical (<3 deg) falls back to
// Lubinski (1950) [4]. fhel: Chen-Lin-Cheatham sqrt(2)*fsin [5] by default,
// or Wu & Juvkam-Wold 1.83*fsin [6] when helicalMode === 'wu'.
function tdBuckLimits(od_m, id_m, hole_m, wBuoy_Npm, incDeg, E, helicalMode) {
  var I = Math.PI / 64 * (Math.pow(od_m, 4) - Math.pow(id_m, 4));
  var ei = E * I;
  var rc = Math.max((hole_m - od_m) / 2, 0.001);
  var fsin;
  if (incDeg < 3) {
    fsin = 1.94 * Math.pow(ei * wBuoy_Npm * wBuoy_Npm, 1 / 3); // [4] Lubinski
  } else {
    var s = Math.sin(incDeg * Math.PI / 180);
    fsin = 2 * Math.sqrt(ei * wBuoy_Npm * s / rc);             // [3] Dawson-Paslay
  }
  var k = (helicalMode === 'wu') ? (2 * Math.sqrt(2) - 1) : Math.SQRT2; // [6] / [5]
  return { ei: ei, rc: rc, fsin: fsin, fhel: k * fsin };
}

// COMPUTE EFFECTIVE TENSION MODEL (5 WellPlan cases, fixed TD)
function tdComputeModel(surv, casings, bha, params, overrideFF) {
  var p = overrideFF ? Object.assign({}, params, overrideFF) : params;
  var mudDens = p.mudDens, blockW = p.blockW, wobRot = p.wobRot, wobSlid = p.wobSlid;
  var steelDens = p.steelDens, ohDiam_m = p.ohDiam_m, ohTop = p.ohTop, td = p.td;
  var BF = 1 - mudDens / steelDens;
  var dpDef = { od_m: 0.1143, id_m: 0.0714, wt: 41.2 };
  var STEP = 10;
  var E = p.youngE || 206.8e9; // steel, 30e6 psi (API/SPE Textbook Vol.12 [9])
  var traj = tdMinCurvature(surv);

  var nodes = [];
  for (var md = 0; md <= td; md += STEP) nodes.push(md);
  if (nodes[nodes.length - 1] < td) nodes.push(td);

  var nData = nodes.map(function (md) {
    var geo = tdHoleAt(md, casings, ohTop, ohDiam_m, p);
    var comp = tdPipeAt(md, td, bha) || dpDef;
    var ia = tdInterpSurv(surv, md);
    var tr = tdInterpTraj(traj, md);
    var wBuoy = comp.wt * TD_G * BF;
    var bk = tdBuckLimits(comp.od_m, comp.id_m, geo.id_m, wBuoy, ia.inc, E, p.helicalMode);
    return {
      md: md, inc: ia.inc, az: ia.az,
      tvd: tr.tvd, ns: tr.ns, ew: tr.ew, dls: tr.dls,
      wt: wBuoy,
      od_m: comp.od_m, id_m: comp.id_m, hole_m: geo.id_m,
      ei: bk.ei, rc: bk.rc, fsin: bk.fsin, fhel: bk.fhel,
      ff: geo.ff, inCasing: geo.inCasing, ffidx: geo.ffidx
    };
  });

  // Generalized case integrator.
  //   wob_N  : weight on bit (N, positive), applied as F(bit) = -wob_N
  //            (bit in compression — same convention as tdComputeHookload
  //            and WellPlan's neutral-point/measured-weight reporting)
  //   axSign : axial motion of the string: -1 lowering, +1 raising,
  //            0 no net axial motion (on/off-bottom rotating)
  //   rpm    : surface rotary speed; > 0 enables tangential friction
  //   va_mpm : axial (trip) speed in m/min, used only when rpm > 0
  //   tq0_Nm : torque boundary at the bit (Torque at Bit for on-bottom
  //            cases; 0 off bottom). With no rotation the wall friction is
  //            purely axial, so surface torque = bit torque (WellPlan
  //            reports exactly this for Slide Drilling).
  // Friction is resolved along the resultant sliding velocity at the wall
  // (combined axial + rotary motion): axial drag scales with va/|v| and
  // tangential (torque) with vt/|v|, vt = pi*OD*rpm. Refs [8],[10]; the
  // same treatment WellPlan applies to tripping with rotation. It reduces
  // to the classic Johancsik cases at rpm = 0 (pure drag) and va = 0
  // (pure torque).
  function integrate(wob_N, axSign, rpm, va_mpm, tq0_Nm) {
    var F = -wob_N, Tq = tq0_Nm || 0;
    var res = new Array(nodes.length);
    var ndLast = nData[nodes.length - 1];
    res[nodes.length - 1] = { F: F, Tq: Tq, N: 0, bk: tdBuckState(-F, ndLast) };
    for (var i = nData.length - 2; i >= 0; i--) {
      var bot = nData[i + 1], top = nData[i];
      var dMD = bot.md - top.md;
      if (dMD <= 0) { res[i] = res[i + 1]; continue; }
      var iAvg = (top.inc + bot.inc) / 2 * Math.PI / 180;
      var dInc = (bot.inc - top.inc) * Math.PI / 180;
      var dAz = (bot.az - top.az) * Math.PI / 180;
      var wEl = top.wt * dMD;
      var ff = top.ff;
      var r = top.od_m / 2;
      var t1 = F * dInc + wEl * Math.sin(iAvg);
      var t2 = F * Math.sin(iAvg) * dAz;
      var N = Math.sqrt(t1 * t1 + t2 * t2);
      // ---- Buckling (references [3]-[7] in header) --------------------
      // Axial compression C = -F. Above the sinusoidal limit the string
      // snakes (flagged only); above the helical limit it coils and loads
      // the wall: Mitchell (1986) [7] Nh = rc*C^2/(4*E*I) per unit length.
      // Adding Nh BEFORE the friction update reproduces the drag feedback
      // that drives slack-off lock-up.
      //
      // LOCK-UP STABILIZATION: that feedback is quadratic in C and, past a
      // point, physically divergent — Mitchell's [7] closed-form shows drag
      // growing without bound (WellPlan reports the same condition as
      // "Slack-Off Drag: NaN"). To keep the integration numerically stable
      // we cap C in the contact term at Clock, the compression where the
      // per-length buckling drag ff*rc*C^2/(4EI) equals the element's
      // buoyed weight per length (weight-transfer efficiency -> 0, the
      // classic lock-up criterion; cf. Wu & Juvkam-Wold [6] lock-up
      // analyses). Nodes at or beyond Clock are flagged state 3 (LOCKED);
      // loads reported above a locked interval are lower-bound estimates.
      var C = -F;
      var bk = tdBuckState(C, top);
      if (bk === 2) {
        var Clock = Math.sqrt(4 * top.ei * top.wt / (Math.max(ff, 0.01) * top.rc));
        if (C >= Clock) { bk = 3; C = Clock; }
        N += (top.rc * C * C / (4 * top.ei)) * dMD;
      }
      // -----------------------------------------------------------------
      // Velocity resolution of friction (refs [8],[10]).
      var fracAx = 1, fracTan = 0;
      if (rpm > 0) {
        var vt = Math.PI * top.od_m * rpm;      // m/min at pipe surface
        var va = Math.abs(va_mpm) || 0;         // m/min along hole
        if (axSign === 0 || va === 0) { fracAx = 0; fracTan = 1; }
        else {
          var vres = Math.sqrt(va * va + vt * vt);
          fracAx = va / vres; fracTan = vt / vres;
        }
      } else if (axSign === 0) { fracAx = 0; }
      F += wEl * Math.cos(iAvg) + axSign * fracAx * ff * N;
      if (!isFinite(F)) { F = -1e8; bk = 3; } // absolute numeric guard
      if (fracTan > 0) Tq += fracTan * ff * N * r;
      res[i] = { F: F, Tq: Tq, N: N, bk: bk };
    }
    return res;
  }

  // Case operational parameters (WellPlan-equivalent):
  var torqBit = (p.torqBit != null) ? p.torqBit : 15;          // N.m
  var tripSpeed = (p.tripSpeed != null) ? p.tripSpeed : 18.29;  // m/min
  var tripInRPM = (p.tripInRPM != null) ? p.tripInRPM : 0;
  var tripOutRPM = (p.tripOutRPM != null) ? p.tripOutRPM : 0;
  // NOTE: WOB is passed positive; integrate() applies F(bit) = -WOB
  // (compression). The previous version inverted the sign for the fixed-TD
  // model only, putting the bit in tension and disagreeing with the
  // hookload integrator — corrected here.
  var rotOB = integrate(wobRot, 0, 60, 0, torqBit);
  var slideOB = integrate(wobSlid, -1, 0, 0, torqBit);
  var rotOff = integrate(0, 0, 60, 0, 0);
  var tripOut = integrate(0, +1, tripOutRPM, tripSpeed, 0);
  var tripIn = integrate(0, -1, tripInRPM, tripSpeed, 0);

  return nodes.map(function (md, i) {
    var nd = nData[i];
    var dMD = i > 0 ? nodes[i] - nodes[i - 1] : (nodes[1] ? nodes[1] - nodes[0] : STEP);
    dMD = Math.max(1, dMD);
    return {
      md: md, inc: nd.inc, az: nd.az,
      tvd: nd.tvd, ns: nd.ns, ew: nd.ew, dls: nd.dls,
      inCasing: nd.inCasing, ffidx: nd.ffidx,
      etRotOB: (rotOB[i].F + blockW) / 1000,
      etSlide: (slideOB[i].F + blockW) / 1000,
      etRotOff: (rotOff[i].F + blockW) / 1000,
      etTripOut: (tripOut[i].F + blockW) / 1000,
      etTripIn: (tripIn[i].F + blockW) / 1000,
      torqRotOB: rotOB[i].Tq,
      torqRotOff: rotOff[i].Tq,
      torqSlide: slideOB[i].Tq,
      torqTripIn: tripIn[i].Tq,
      torqTripOut: tripOut[i].Tq,
      sfRotOB: rotOB[i].N / TD_G / dMD,
      sfSlide: slideOB[i].N / TD_G / dMD,
      sfRotOff: rotOff[i].N / TD_G / dMD,
      sfTripOut: tripOut[i].N / TD_G / dMD,
      sfTripIn: tripIn[i].N / TD_G / dMD,
      // Buckling: per-node critical loads (case-independent, kN) and the
      // per-case state 0/1/2 = none/sinusoidal/helical (refs [3]-[7]).
      fsin_kN: nd.fsin / 1000,
      fhel_kN: nd.fhel / 1000,
      bkRotOB: rotOB[i].bk,
      bkSlide: slideOB[i].bk,
      bkRotOff: rotOff[i].bk,
      bkTripOut: tripOut[i].bk,
      bkTripIn: tripIn[i].bk
    };
  });
}

// COMPUTE HOOKLOAD vs BIT DEPTH (correct WellPlan p.33 method)
function tdComputeHookload(surv, casings, bha, params, overrideFF) {
  var p = overrideFF ? Object.assign({}, params, overrideFF) : params;
  var mudDens = p.mudDens, blockW = p.blockW, wobRot = p.wobRot, wobSlid = p.wobSlid;
  var steelDens = p.steelDens, ohDiam_m = p.ohDiam_m, ohTop = p.ohTop, td = p.td;
  var BF = 1 - mudDens / steelDens;
  var dpDef = { od_m: 0.1143, id_m: 0.0714, wt: 41.2 };
  var bhaLen = bha.reduce(function (s, c) { return s + c.len; }, 0);
  var HL_STEP = 30.48;
  var bitDepths = [];
  for (var d = HL_STEP; d <= td; d += HL_STEP) bitDepths.push(d);
  if (bitDepths[bitDepths.length - 1] < td) bitDepths.push(td);

  function pipeAtBit(md, bitDepth) {
    var bhaTop = bitDepth - bhaLen;
    if (md < bhaTop) return dpDef;
    var cursor = bitDepth;
    for (var j = 0; j < bha.length; j++) {
      var compTop = cursor - bha[j].len;
      if (md >= compTop && md <= cursor) return bha[j];
      cursor = compTop;
    }
    return dpDef;
  }

  function integHL(bitDepth, wob_N, axSign, rpm, va_mpm, tq0_Nm) {
    var STEP = 10;
    var E = p.youngE || 206.8e9; // [9]
    var nodes = [];
    for (var md = 0; md <= bitDepth; md += STEP) nodes.push(md);
    if (nodes[nodes.length - 1] < bitDepth) nodes.push(bitDepth);
    var F = -wob_N, Tq = tq0_Nm || 0;
    for (var i = nodes.length - 2; i >= 0; i--) {
      var mdBot = nodes[i + 1], mdTop = nodes[i];
      var dMD = mdBot - mdTop;
      if (dMD <= 0) continue;
      var ia1 = tdInterpSurv(surv, mdTop);
      var ia2 = tdInterpSurv(surv, mdBot);
      var iAvg = (ia1.inc + ia2.inc) / 2 * Math.PI / 180;
      var dInc = (ia2.inc - ia1.inc) * Math.PI / 180;
      var dAz = (ia2.az - ia1.az) * Math.PI / 180;
      var comp = pipeAtBit(mdTop, bitDepth);
      var wpl = comp.wt * TD_G * BF;
      var wEl = wpl * dMD;
      var geo = tdHoleAt(mdTop, casings, ohTop, ohDiam_m, p);
      var ff = geo.ff;
      var t1 = F * dInc + wEl * Math.sin(iAvg);
      var t2 = F * Math.sin(iAvg) * dAz;
      var N = Math.sqrt(t1 * t1 + t2 * t2);
      // Helical-buckling wall contact (Mitchell 1986 [7]) with the same
      // lock-up cap as tdComputeModel, so hookload/torque stay finite and
      // consistent with the fixed-TD model.
      var C = -F;
      if (C > 0) {
        var bl = tdBuckLimits(comp.od_m, comp.id_m, geo.id_m, wpl, ia1.inc, E, p.helicalMode);
        if (C >= bl.fhel) {
          var Clock = Math.sqrt(4 * bl.ei * wpl / (Math.max(ff, 0.01) * bl.rc));
          if (C > Clock) C = Clock;
          N += (bl.rc * C * C / (4 * bl.ei)) * dMD;
        }
      }
      // Velocity resolution of friction (refs [8],[10]).
      var fracAx = 1, fracTan = 0;
      if (rpm > 0) {
        var vt = Math.PI * comp.od_m * rpm;
        var va = Math.abs(va_mpm) || 0;
        if (axSign === 0 || va === 0) { fracAx = 0; fracTan = 1; }
        else {
          var vres = Math.sqrt(va * va + vt * vt);
          fracAx = va / vres; fracTan = vt / vres;
        }
      } else if (axSign === 0) { fracAx = 0; }
      F += wEl * Math.cos(iAvg) + axSign * fracAx * ff * N;
      if (!isFinite(F)) F = -1e8; // absolute numeric guard
      if (fracTan > 0) Tq += fracTan * ff * N * (comp.od_m / 2);
    }
    return { hl: (F + blockW) / 1000, tq: Tq };
  }

  var torqBit = (p.torqBit != null) ? p.torqBit : 15;          // N.m
  var tripSpeed = (p.tripSpeed != null) ? p.tripSpeed : 18.29;  // m/min
  var tripInRPM = (p.tripInRPM != null) ? p.tripInRPM : 0;
  var tripOutRPM = (p.tripOutRPM != null) ? p.tripOutRPM : 0;
  return bitDepths.map(function (D) {
    var to = integHL(D, 0, +1, tripOutRPM, tripSpeed, 0);
    var ti = integHL(D, 0, -1, tripInRPM, tripSpeed, 0);
    var rob = integHL(D, wobRot, 0, 60, 0, torqBit);
    var sl = integHL(D, wobSlid, -1, 0, 0, torqBit);
    var roff = integHL(D, 0, 0, 60, 0, 0);
    return {
      md: D,
      hl_tripOut: to.hl, hl_tripIn: ti.hl, hl_rotOB: rob.hl,
      hl_slide: sl.hl, hl_rotOff: roff.hl,
      tq_rotOB: rob.tq, tq_rotOff: roff.tq, tq_slide: sl.tq,
      tq_tripIn: ti.tq, tq_tripOut: to.tq
    };
  });
}

var TDModelCore = {
  G: TD_G,
  minCurvature: tdMinCurvature,
  interpTraj: tdInterpTraj,
  holeAt: tdHoleAt,
  pipeAt: tdPipeAt,
  interpSurv: tdInterpSurv,
  buckLimits: tdBuckLimits,
  buckState: tdBuckState,
  computeModel: tdComputeModel,
  computeHookload: tdComputeHookload
};

// UMD-lite: works as a plain <script> (attaches to window) and as a
// Node.js require() (module.exports) without any build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TDModelCore;
} else if (typeof window !== 'undefined') {
  window.TDModelCore = TDModelCore;
}

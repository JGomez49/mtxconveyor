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
// ============================================================================

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

// COMPUTE EFFECTIVE TENSION MODEL (5 WellPlan cases, fixed TD)
function tdComputeModel(surv, casings, bha, params, overrideFF) {
  var p = overrideFF ? Object.assign({}, params, overrideFF) : params;
  var mudDens = p.mudDens, blockW = p.blockW, wobRot = p.wobRot, wobSlid = p.wobSlid;
  var steelDens = p.steelDens, ohDiam_m = p.ohDiam_m, ohTop = p.ohTop, td = p.td;
  var BF = 1 - mudDens / steelDens;
  var dpDef = { od_m: 0.1143, id_m: 0.0714, wt: 41.2 };
  var STEP = 10;
  var traj = tdMinCurvature(surv);

  var nodes = [];
  for (var md = 0; md <= td; md += STEP) nodes.push(md);
  if (nodes[nodes.length - 1] < td) nodes.push(td);

  var nData = nodes.map(function (md) {
    var geo = tdHoleAt(md, casings, ohTop, ohDiam_m, p);
    var comp = tdPipeAt(md, td, bha) || dpDef;
    var ia = tdInterpSurv(surv, md);
    var tr = tdInterpTraj(traj, md);
    return {
      md: md, inc: ia.inc, az: ia.az,
      tvd: tr.tvd, ns: tr.ns, ew: tr.ew, dls: tr.dls,
      wt: comp.wt * TD_G * BF,
      od_m: comp.od_m, id_m: comp.id_m,
      ff: geo.ff, inCasing: geo.inCasing, ffidx: geo.ffidx
    };
  });

  function integrate(wob_N, dragSign) {
    var F = -wob_N, Tq = 0;
    var res = new Array(nodes.length);
    res[nodes.length - 1] = { F: F, Tq: Tq, N: 0 };
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
      F += wEl * Math.cos(iAvg) + dragSign * ff * N;
      if (dragSign === 0) Tq += ff * N * r;
      res[i] = { F: F, Tq: Tq, N: N };
    }
    return res;
  }

  var rotOB = integrate(-wobRot, 0);
  var slideOB = integrate(-wobSlid, -1);
  var rotOff = integrate(0, 0);
  var tripOut = integrate(0, +1);
  var tripIn = integrate(0, -1);

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
      sfRotOB: rotOB[i].N / TD_G / dMD,
      sfSlide: slideOB[i].N / TD_G / dMD,
      sfRotOff: rotOff[i].N / TD_G / dMD,
      sfTripOut: tripOut[i].N / TD_G / dMD,
      sfTripIn: tripIn[i].N / TD_G / dMD
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

  function integHL(bitDepth, wob_N, dragSign) {
    var STEP = 10;
    var nodes = [];
    for (var md = 0; md <= bitDepth; md += STEP) nodes.push(md);
    if (nodes[nodes.length - 1] < bitDepth) nodes.push(bitDepth);
    var F = -wob_N, Tq = 0;
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
      var wEl = comp.wt * TD_G * BF * dMD;
      var geo = tdHoleAt(mdTop, casings, ohTop, ohDiam_m, p);
      var ff = geo.ff;
      var t1 = F * dInc + wEl * Math.sin(iAvg);
      var t2 = F * Math.sin(iAvg) * dAz;
      var N = Math.sqrt(t1 * t1 + t2 * t2);
      F += wEl * Math.cos(iAvg) + dragSign * ff * N;
      if (dragSign === 0) Tq += ff * N * (comp.od_m / 2);
    }
    return { hl: (F + blockW) / 1000, tq: Tq };
  }

  return bitDepths.map(function (D) {
    var to = integHL(D, 0, +1);
    var rob = integHL(D, wobRot, 0);
    var sl = integHL(D, wobSlid, -1);
    return { md: D, hl_tripOut: to.hl, hl_rotOB: rob.hl, hl_slide: sl.hl, tq_rotOB: rob.tq };
  });
}

var TDModelCore = {
  G: TD_G,
  minCurvature: tdMinCurvature,
  interpTraj: tdInterpTraj,
  holeAt: tdHoleAt,
  pipeAt: tdPipeAt,
  interpSurv: tdInterpSurv,
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

/* ============================================================
   iplanCore.js — shared directional-planning math for QuickPlan and iPlan.
   ADDED 2026-10-10. The MATH section below was MOVED VERBATIM from
   views/quickPlan.ejs (it was inline there) so both modules run the exact
   same, already-validated code. Nothing in it was changed.
   Source: Bourgoyne, Millheim, Chenevert, Young — "Applied Drilling
   Engineering" (SPE Textbook Series), Ch. 8:
     - Minimum curvature: Eqs. 8.33-8.37
     - Toolface / new inclination & azimuth from DLS+TF: Eqs. 8.41-8.49
   DLS convention: degrees per 30 m course length.
   Everything lives under window.IPlanCore (no globals) because job.ejs
   already declares its own D2R etc. in other script blocks.
   ============================================================ */
(function(root){
'use strict';

const D2R = Math.PI/180, R2D = 180/Math.PI;

// Minimum curvature between two survey stations (inc/az in degrees, CL in meters)
// Returns dN, dE, dTVD, and dogleg severity in deg/30m over this course length.
function minimumCurvature(inc1, az1, inc2, az2, CL){
  const a1=inc1*D2R, a2=inc2*D2R, e1=az1*D2R, e2=az2*D2R;
  let cosBeta = Math.cos(a2-a1) - Math.sin(a1)*Math.sin(a2)*(1-Math.cos(e2-e1));
  cosBeta = Math.max(-1, Math.min(1, cosBeta));
  const beta = Math.acos(cosBeta); // radians
  let F;
  if (beta < 1e-8) { F = 1; } else { F = (2/beta)*Math.tan(beta/2); }
  const dN = (CL/2)*(Math.sin(a1)*Math.cos(e1)+Math.sin(a2)*Math.cos(e2))*F;
  const dE = (CL/2)*(Math.sin(a1)*Math.sin(e1)+Math.sin(a2)*Math.sin(e2))*F;
  const dTVD = (CL/2)*(Math.cos(a1)+Math.cos(a2))*F;
  const betaDeg = beta*R2D;
  const dls30 = CL>0 ? (betaDeg/CL)*30 : 0;
  return {dN, dE, dTVD, dls30};
}

// Core toolface relation (Eqs. 8.45-8.49): given current inc/az (deg), the
// overall angle change beta (deg, i.e. the "dogleg" traversed by this
// section) and toolface angle TF (deg, high-side reference), returns the
// resulting inclination and azimuth (deg).
function applyToolfaceBeta(inc1, az1, betaDeg, tf){
  const beta = betaDeg*D2R;
  const a1 = inc1*D2R, g = tf*D2R;
  let cosAlphaN = Math.cos(a1)*Math.cos(beta) - Math.sin(a1)*Math.sin(beta)*Math.cos(g);
  cosAlphaN = Math.max(-1, Math.min(1, cosAlphaN));
  const alphaN = Math.acos(cosAlphaN);
  // Direction change via spherical relation (Eq. 8.42, rearranged into atan2 form for quadrant safety)
  const num = Math.sin(beta)*Math.sin(g);
  const den = Math.sin(a1)*Math.cos(beta) + Math.cos(a1)*Math.sin(beta)*Math.cos(g);
  const dEps = Math.atan2(num, den);
  let azN = (az1 + dEps*R2D) % 360;
  if (azN < 0) azN += 360;
  return { incN: alphaN*R2D, azN };
}

// Given current inc/az (deg), a DLS (deg/30m), toolface angle TF (deg, high-side ref),
// and course length CL (m): returns new inclination and azimuth (deg).
function applyToolfaceSection(inc1, az1, dls30, tf, CL){
  const betaDeg = dls30 * (CL/30);
  const r = applyToolfaceBeta(inc1, az1, betaDeg, tf);
  return { incN: r.incN, azN: r.azN, betaDeg };
}

// Solve for the overall angle change beta (deg) needed to reach a target
// INCLINATION at a given toolface, by rearranging Eq. 8.46:
//   cos(a1)cos(beta) - sin(a1)sin(beta)cos(g) = cos(aN)
// which is of the form A*cos(beta) - B*sin(beta) = R*cos(beta+phi) = cos(aN).
// Note beta here is purely geometric — independent of DLS. DLS only converts
// this beta into a course length afterward (CL = beta/DLS * 30).
function betaForTargetInc(inc1Deg, tfDeg, targetIncDeg){
  const a1 = inc1Deg*D2R, g = tfDeg*D2R, aN = targetIncDeg*D2R;
  const A = Math.cos(a1), B = Math.sin(a1)*Math.cos(g);
  const R = Math.sqrt(A*A + B*B);
  if (R < 1e-9) return null;
  const phi = Math.atan2(B, A);
  const rhs = Math.cos(aN)/R;
  if (rhs < -1 || rhs > 1) return null; // target inclination unreachable at this toolface
  const acosVal = Math.acos(Math.max(-1, Math.min(1, rhs)));
  const candidates = [acosVal - phi, -acosVal - phi]
    .map(c => { let x = c % (2*Math.PI); if (x <= 1e-7) x += 2*Math.PI; return x; })
    .filter(x => x > 1e-6 && x <= Math.PI + 1e-6);
  if (candidates.length === 0) return null;
  return Math.min(...candidates) * R2D;
}

// Solve for the overall angle change beta (deg) needed to reach a target
// AZIMUTH at a given toolface. The forward relation (Eq. 8.42) is not cleanly
// invertible in closed form once wrap-around is considered, so this scans
// beta from 0 to 180 deg tracking the (unwrapped) azimuth reached via the
// exact same applyToolfaceBeta() used for forward calculation, and linearly
// interpolates the first crossing of the target. Returns null if the target
// azimuth is never reached within a single arc (0-180 deg of curvature).
function betaForTargetAz(inc1Deg, az1Deg, tfDeg, targetAzDeg){
  const targetDelta = (((targetAzDeg - az1Deg) % 360) + 540) % 360 - 180; // shortest signed delta, (-180,180]
  const STEP = 0.1;
  let prevBeta = 0, prevUnwrapped = 0, prevRaw = az1Deg;
  for (let betaDeg = STEP; betaDeg <= 180; betaDeg += STEP){
    const r = applyToolfaceBeta(inc1Deg, az1Deg, betaDeg, tfDeg);
    let d = r.azN - prevRaw;
    d = ((d % 360) + 540) % 360 - 180; // shortest signed step since last sample
    const unwrapped = prevUnwrapped + d;
    if ((prevUnwrapped <= targetDelta && unwrapped >= targetDelta) ||
        (prevUnwrapped >= targetDelta && unwrapped <= targetDelta)){
      const frac = (targetDelta - prevUnwrapped) / (unwrapped - prevUnwrapped || 1);
      return prevBeta + frac*(betaDeg - prevBeta);
    }
    prevBeta = betaDeg; prevUnwrapped = unwrapped; prevRaw = r.azN;
  }
  return null; // not reached within a single 0-180 deg arc
}

// Solve for the overall angle change beta (deg) needed to reach a target
// TVD at a given DLS/toolface. Unlike the Inc/Az solvers, this genuinely
// depends on DLS (course length, not just geometry), since TVD accrues with
// physical distance. TVD(beta) is evaluated exactly the same way as the
// station interpolation does: minimum curvature (Eqs. 8.33-8.37) from the
// section start to the point reached after curvature angle beta, over the
// course length CL(beta)=beta/DLS*30. This is scanned/interpolated for the
// first crossing of the target TVD, same approach as betaForTargetAz.
function betaForTargetTVD(inc1Deg, az1Deg, tfDeg, dls30, deltaTvdTarget){
  if (!(dls30 > 0)) return null;
  const STEP = 0.1;
  let prevBeta = 0, prevVal = 0;
  for (let betaDeg = STEP; betaDeg <= 180; betaDeg += STEP){
    const cl = betaDeg/dls30*30;
    const r = applyToolfaceBeta(inc1Deg, az1Deg, betaDeg, tfDeg);
    const mc = minimumCurvature(inc1Deg, az1Deg, r.incN, r.azN, cl);
    const val = mc.dTVD;
    if ((prevVal <= deltaTvdTarget && val >= deltaTvdTarget) ||
        (prevVal >= deltaTvdTarget && val <= deltaTvdTarget)){
      const frac = (deltaTvdTarget - prevVal) / (val - prevVal || 1);
      return prevBeta + frac*(betaDeg - prevBeta);
    }
    prevBeta = betaDeg; prevVal = val;
  }
  return null; // target TVD not reached within a single 0-180 deg arc at this DLS
}

// The overall angle change beta (deg) between two given orientations —
// same relation used inside minimumCurvature (Eq. 8.33), factored out
// because several "target orientation" methods need it independent of CL.
function impliedBetaDeg(inc1, az1, inc2, az2){
  const a1=inc1*D2R, a2=inc2*D2R, e1=az1*D2R, e2=az2*D2R;
  let cosBeta = Math.cos(a2-a1) - Math.sin(a1)*Math.sin(a2)*(1-Math.cos(e2-e1));
  cosBeta = Math.max(-1, Math.min(1, cosBeta));
  return Math.acos(cosBeta) * R2D;
}

// Nested solver for "TVD, DLS, AZ": target TVD and target AZIMUTH are both
// given, but inclination and toolface are NOT — so unlike the other target
// methods, the toolface itself is a free unknown here (inclination is
// whatever falls out of it). Two constraints (TVD, Az), two unknowns
// (toolface gamma, curvature angle beta / equivalently CL via DLS).
// Outer loop scans toolface gamma 0-360 deg (then bisects the bracket found)
// for the one where the resulting TVD matches target; for each candidate
// gamma, the inner solve is exactly betaForTargetAz() — already-verified —
// to find beta reaching the target azimuth at that toolface. No new physics,
// just a 2D root-find built from the same two forward equations used
// everywhere else in this file.
function tvdAtGammaForTargetAz(curInc, curAz, gammaDeg, targetAzDeg, dls30){
  const betaDeg = betaForTargetAz(curInc, curAz, gammaDeg, targetAzDeg);
  if (betaDeg === null || !(dls30 > 0)) return null;
  const cl = betaDeg/dls30*30;
  const r = applyToolfaceBeta(curInc, curAz, betaDeg, gammaDeg);
  const dTvd = minimumCurvature(curInc, curAz, r.incN, r.azN, cl).dTVD;
  return { dTvd, cl, incN:r.incN, azN:r.azN, betaDeg };
}

function solveTvdDlsAz(curInc, curAz, curTvd, dls30, targetAzDeg, targetTvd){
  const deltaTarget = targetTvd - curTvd;
  function evalAt(g){
    const res = tvdAtGammaForTargetAz(curInc, curAz, g, targetAzDeg, dls30);
    return res ? (res.dTvd - deltaTarget) : null;
  }
  const STEP = 2;
  let gPrev = 0, vPrev = evalAt(0);
  let bracket = null;
  for (let g = STEP; g <= 360; g += STEP){
    const v = evalAt(g);
    if (vPrev !== null && v !== null && ((vPrev<=0 && v>=0) || (vPrev>=0 && v<=0))){
      bracket = [gPrev, g, vPrev, v];
      break;
    }
    if (v !== null){ gPrev = g; vPrev = v; }
  }
  if (!bracket) return null;
  let [gLo, gHi, vLo] = bracket;
  for (let i=0; i<40; i++){
    const gMid = (gLo+gHi)/2, vMid = evalAt(gMid);
    if (vMid === null) break;
    if ((vLo<=0 && vMid>=0) || (vLo>=0 && vMid<=0)){ gHi = gMid; } else { gLo = gMid; vLo = vMid; }
  }
  const gFinal = (gLo+gHi)/2;
  const res = tvdAtGammaForTargetAz(curInc, curAz, gFinal, targetAzDeg, dls30);
  if (!res) return null;
  return { tf: gFinal, cl: res.cl, endInc: res.incN, endAz: res.azN };
}

// Resolves ANY section kind into a concrete {endInc, endAz, cl, dTvd, warning}
// given the current inc/az/TVD/MD the well is at when the section starts.
function resolveSectionEndpoint(curInc, curAz, curTvd, curMd, s){
  let endInc, endAz, cl, warning = null, tf = undefined;

  if (s.kind === 'direct'){
    endInc = s.inc; endAz = s.az; cl = s.cl;
  } else if (s.kind === 'hold'){
    endInc = curInc; endAz = curAz; cl = s.cl;
  } else if (s.kind === 'dlstf'){
    const r = applyToolfaceSection(curInc, curAz, s.dls, s.tf, s.cl);
    endInc = r.incN; endAz = r.azN; cl = s.cl;
  } else if (s.kind === 'dlstf_inc'){
    const betaDeg = betaForTargetInc(curInc, s.tf, s.targetInc);
    if (betaDeg === null || !(s.dls > 0)){
      endInc = curInc; endAz = curAz; cl = 0;
      warning = 'Target inclination not reachable at this toolface / DLS';
    } else {
      cl = betaDeg / s.dls * 30;
      const r = applyToolfaceBeta(curInc, curAz, betaDeg, s.tf);
      endInc = r.incN; endAz = r.azN;
    }
  } else if (s.kind === 'dlstf_az'){
    const betaDeg = betaForTargetAz(curInc, curAz, s.tf, s.targetAz);
    if (betaDeg === null || !(s.dls > 0)){
      endInc = curInc; endAz = curAz; cl = 0;
      warning = 'Target azimuth not reachable within a single arc at this toolface';
    } else {
      cl = betaDeg / s.dls * 30;
      const r = applyToolfaceBeta(curInc, curAz, betaDeg, s.tf);
      endInc = r.incN; endAz = r.azN;
    }
  } else if (s.kind === 'dlstf_tvd'){
    const deltaTarget = s.targetTvd - curTvd;
    const betaDeg = betaForTargetTVD(curInc, curAz, s.tf, s.dls, deltaTarget);
    if (betaDeg === null){
      endInc = curInc; endAz = curAz; cl = 0;
      warning = deltaTarget < 0
        ? 'Target TVD is above the current TVD — not reachable while building/turning downward'
        : 'Target TVD not reachable within a single arc at this toolface / DLS';
    } else {
      cl = betaDeg / s.dls * 30;
      const r = applyToolfaceBeta(curInc, curAz, betaDeg, s.tf);
      endInc = r.incN; endAz = r.azN;
    }
  } else if (s.kind === 'md_inc_az'){
    endInc = s.inc; endAz = s.az; cl = s.targetMd - curMd;
    if (!(cl > 0)){
      cl = 0; warning = `Target MD (${s.targetMd} m) must be greater than the current MD (${curMd.toFixed(1)} m)`;
    }
  } else if (s.kind === 'tvd_inc_az'){
    // Target Inc AND Az together fully determine the end orientation (same
    // as 'direct'), so beta is fixed by those four angles alone — no
    // toolface choice involved. dTVD is then exactly PROPORTIONAL to CL for
    // that fixed pair of orientations (Eq. 8.35-8.37: beta and F depend only
    // on the two orientations, not on CL), so CL solves in closed form.
    const betaDeg = impliedBetaDeg(curInc, curAz, s.inc, s.az);
    const beta = betaDeg*D2R;
    const F = beta < 1e-8 ? 1 : (2/beta)*Math.tan(beta/2);
    const k = 0.5*(Math.cos(curInc*D2R)+Math.cos(s.inc*D2R))*F; // dTVD per meter of CL
    const deltaTarget = s.targetTvd - curTvd;
    endInc = s.inc; endAz = s.az;
    if (Math.abs(k) < 1e-9){
      cl = 0; warning = 'TVD does not change along this Inc/Az path (near-horizontal) — target TVD unreachable this way';
    } else {
      cl = deltaTarget / k;
      if (!(cl > 0)){ cl = 0; warning = 'Target TVD is not reachable in the forward direction along this Inc/Az path'; }
    }
  } else if (s.kind === 'dls_inc_az'){
    // Same fixed-orientation logic as tvd_inc_az, but CL comes from DLS
    // instead of TVD: CL = beta/DLS*30, beta fixed by the two orientations.
    const betaDeg = impliedBetaDeg(curInc, curAz, s.inc, s.az);
    endInc = s.inc; endAz = s.az;
    if (!(s.dls > 0)){
      cl = 0; warning = 'DLS must be greater than 0';
    } else {
      cl = betaDeg / s.dls * 30;
    }
  } else if (s.kind === 'hold_tvd'){
    endInc = curInc; endAz = curAz;
    const cosInc = Math.cos(curInc*D2R);
    if (Math.abs(cosInc) < 1e-6){
      cl = 0; warning = 'Cannot reach a target TVD by holding — current inclination is ~90° (horizontal)';
    } else {
      cl = (s.targetTvd - curTvd) / cosInc;
      if (!(cl > 0)){ cl = 0; warning = 'Target TVD already reached, or behind the current position along this hold'; }
    }
  } else if (s.kind === 'build_turn_cl'){
    cl = s.cl;
    endInc = Math.max(0, Math.min(180, curInc + s.buildRate*s.cl/30));
    endAz = ((curAz + s.turnRate*s.cl/30) % 360 + 360) % 360;
    if (curInc + s.buildRate*s.cl/30 < 0 || curInc + s.buildRate*s.cl/30 > 180){
      warning = 'Build rate over this course length would take inclination out of [0°,180°] — clamped';
    }
  } else if (s.kind === 'tvd_dls_az'){
    const solved = solveTvdDlsAz(curInc, curAz, curTvd, s.dls, s.targetAz, s.targetTvd);
    if (!solved){
      endInc = curInc; endAz = curAz; cl = 0;
      warning = 'No toolface found that reaches both the target azimuth and target TVD at this DLS';
    } else {
      endInc = solved.endInc; endAz = solved.endAz; cl = solved.cl; tf = solved.tf;
    }
  } else {
    endInc = curInc; endAz = curAz; cl = 0; warning = 'Unknown section type';
  }

  const mc = (cl > 0) ? minimumCurvature(curInc, curAz, endInc, endAz, cl) : {dN:0, dE:0, dTVD:0};
  return { endInc, endAz, cl, dTvd: mc.dTVD, dN: mc.dN, dE: mc.dE, warning, tf };
}


// ---- Moved verbatim from quickPlan.ejs (was next to computeTrajectory) ----
function attitudeVector(inc, az){
  const i=inc*D2R, a=az*D2R;
  return [Math.sin(i)*Math.cos(a), Math.sin(i)*Math.sin(a), Math.cos(i)];
}

/* ============================================================
   TARGET-DESIGN WIZARD SOLVERS — moved VERBATIM from views/quickPlan.ejs
   on 2026-10-10 (Build & Hold, Build-Hold-Build-Hold, Curve-Hold-Curve).
   See the long derivation/validation comments that remain in quickPlan.ejs
   above each wizard's UI. Nothing in the math was changed.
   ============================================================ */
// "Build & Hold to Target" — 2-of-4 solve, mirroring the classic
// directional-planning "select 2 unknowns" tool: given a target's TVD and
// horizontal departure/direction, and any 2 of {1st Hold Len (D1),
// 1st Build radius (r1), Max Angle (theta), 2nd Hold Len (L2)}, solve for
// the other 2. Requires the well to be vertical (Inc=0) entering this
// design — that's the assumption baked into the governing equations below,
// which generalize Bourgoyne Eqs. 8.9/8.12 (X2=r1(1-cos theta), D2=D1+r1
// sin theta) verified earlier against the textbook. Governing system:
//   X  = r1(1-cos theta) + L2 sin theta      ... horizontal departure
//   D3 = D1 + r1 sin theta + L2 cos theta    ... TVD
// theta is the only nonlinear unknown; whenever it's unknown this does a
// scan+bisect (same technique as betaForTargetAz elsewhere in this file),
// otherwise every case reduces to direct algebra / a 2x2 linear solve.
function solveBuildHoldToTarget(unknowns, known, X, D3){
  const has = k => !unknowns.includes(k);
  const D2R_ = D2R;
  function residualGivenTheta(thetaDeg, which){
    const th = thetaDeg*D2R_, s = Math.sin(th), c = Math.cos(th);
    if (which === 'D1_theta'){ // r1, L2 known; solve theta from (A)
      return known.r1*(1-c) + known.L2*s - X;
    }
    if (which === 'r1_theta'){ // D1, L2 known; r1(theta) from (B), plug into (A)
      if (Math.abs(s) < 1e-9) return null;
      const r1 = (D3 - known.D1 - known.L2*c)/s;
      return r1*(1-c) + known.L2*s - X;
    }
    if (which === 'theta_L2'){ // D1, r1 known; L2(theta) from (B), plug into (A)
      if (Math.abs(c) < 1e-9) return null;
      const L2 = (D3 - known.D1 - known.r1*s)/c;
      return known.r1*(1-c) + L2*s - X;
    }
  }
  function solveTheta(which){
    const STEP = 0.25;
    let prevT = 0.5, prevV = residualGivenTheta(0.5, which);
    for (let t = 0.5+STEP; t <= 179.5; t += STEP){
      const v = residualGivenTheta(t, which);
      if (prevV !== null && v !== null && ((prevV<=0 && v>=0) || (prevV>=0 && v<=0))){
        let lo=prevT, hi=t, vLo=prevV;
        for (let i=0;i<40;i++){
          const mid=(lo+hi)/2, vMid=residualGivenTheta(mid, which);
          if (vMid===null) break;
          if ((vLo<=0 && vMid>=0) || (vLo>=0 && vMid<=0)){ hi=mid; } else { lo=mid; vLo=vMid; }
        }
        return (lo+hi)/2;
      }
      if (v !== null){ prevT = t; prevV = v; }
    }
    return null;
  }

  const set = unknowns.slice().sort().join(',');

  if (set === 'D1,r1'){ // theta, L2 known
    const th = known.theta*D2R_, s=Math.sin(th), c=Math.cos(th);
    if (Math.abs(1-c) < 1e-9) return null;
    const r1 = (X - known.L2*s)/(1-c);
    const D1 = D3 - r1*s - known.L2*c;
    return { D1, r1, theta: known.theta, L2: known.L2 };
  }
  if (set === 'D1,theta'){ // r1, L2 known
    const theta = solveTheta('D1_theta');
    if (theta === null) return null;
    const th=theta*D2R_;
    const D1 = D3 - known.r1*Math.sin(th) - known.L2*Math.cos(th);
    return { D1, r1: known.r1, theta, L2: known.L2 };
  }
  if (set === 'D1,L2'){ // r1, theta known
    const th = known.theta*D2R_, s=Math.sin(th), c=Math.cos(th);
    if (Math.abs(s) < 1e-9) return null;
    const L2 = (X - known.r1*(1-c))/s;
    const D1 = D3 - known.r1*s - L2*c;
    return { D1, r1: known.r1, theta: known.theta, L2 };
  }
  if (set === 'r1,theta'){ // D1, L2 known
    const theta = solveTheta('r1_theta');
    if (theta === null) return null;
    const th=theta*D2R_, s=Math.sin(th), c=Math.cos(th);
    const r1 = (D3 - known.D1 - known.L2*c)/s;
    return { D1: known.D1, r1, theta, L2: known.L2 };
  }
  if (set === 'L2,r1'){ // D1, theta known
    const th = known.theta*D2R_, s=Math.sin(th), c=Math.cos(th);
    const det = c - 1;
    if (Math.abs(det) < 1e-9) return null;
    const rhsB = D3 - known.D1;
    const r1 = (X*c - s*rhsB)/det;
    const L2 = ((1-c)*rhsB - s*X)/det;
    return { D1: known.D1, r1, theta: known.theta, L2 };
  }
  if (set === 'L2,theta'){ // D1, r1 known
    const theta = solveTheta('theta_L2');
    if (theta === null) return null;
    const th=theta*D2R_, s=Math.sin(th), c=Math.cos(th);
    if (Math.abs(c) < 1e-9) return null;
    const L2 = (D3 - known.D1 - known.r1*s)/c;
    return { D1: known.D1, r1: known.r1, theta, L2 };
  }
  return null;
}


function r1FromDls(dls){ return (180*30)/(Math.PI*dls); } // meters
function dlsFromR1(r1){ return (180*30)/(Math.PI*r1); }   // deg/30m

const HBHBH_KEYS = ['D1','r1','thetaMax','D2','r2','thetaFinal','L3'];
const HBHBH_ANGLE_KEYS = new Set(['thetaMax','thetaFinal']);

function hbhbhTotals(p){
  const th1 = p.thetaMax*D2R, th2 = p.thetaFinal*D2R;
  const s1=Math.sin(th1), c1=Math.cos(th1), s2=Math.sin(th2), c2=Math.cos(th2);
  const X = p.r1*(1-c1) + p.D2*s1 + p.r2*(c1-c2) + p.L3*s2;
  const TVD = p.D1 + p.r1*s1 + p.D2*c1 + p.r2*(s2-s1) + p.L3*c2;
  return { X, TVD };
}

function hbhbhResidual(u1key, u1val, u2key, u2val, known, Xt, Dt){
  const p = Object.assign({}, known, { [u1key]: u1val, [u2key]: u2val });
  const t = hbhbhTotals(p);
  return [t.X - Xt, t.TVD - Dt];
}

function hbhbhClamp(key, v){
  if (HBHBH_ANGLE_KEYS.has(key)) return Math.min(179.9, Math.max(0.1, v));
  return Math.max(0, v);
}

function hbhbhNewton(u1key, u2key, known, Xt, Dt, g1, g2){
  let u1 = g1, u2 = g2;
  for (let it = 0; it < 150; it++){
    const h1 = HBHBH_ANGLE_KEYS.has(u1key) ? 1e-4 : Math.max(1e-4, Math.abs(u1)*1e-6 + 1e-4);
    const h2 = HBHBH_ANGLE_KEYS.has(u2key) ? 1e-4 : Math.max(1e-4, Math.abs(u2)*1e-6 + 1e-4);
    const f0 = hbhbhResidual(u1key, u1, u2key, u2, known, Xt, Dt);
    const fp1 = hbhbhResidual(u1key, u1+h1, u2key, u2, known, Xt, Dt);
    const fp2 = hbhbhResidual(u1key, u1, u2key, u2+h2, known, Xt, Dt);
    const J = [[(fp1[0]-f0[0])/h1, (fp2[0]-f0[0])/h2],
               [(fp1[1]-f0[1])/h1, (fp2[1]-f0[1])/h2]];
    const det = J[0][0]*J[1][1] - J[0][1]*J[1][0];
    if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
    let d1 = (-f0[0]*J[1][1] + f0[1]*J[0][1]) / det;
    let d2 = (-J[0][0]*f0[1] + J[1][0]*f0[0]) / det;
    const maxAngleStep = 15, maxLenStep = Math.max(200, Math.abs(u1) + Math.abs(u2));
    d1 = HBHBH_ANGLE_KEYS.has(u1key) ? Math.max(-maxAngleStep, Math.min(maxAngleStep, d1))
                                      : Math.max(-maxLenStep, Math.min(maxLenStep, d1));
    d2 = HBHBH_ANGLE_KEYS.has(u2key) ? Math.max(-maxAngleStep, Math.min(maxAngleStep, d2))
                                      : Math.max(-maxLenStep, Math.min(maxLenStep, d2));
    const nu1 = hbhbhClamp(u1key, u1+d1), nu2 = hbhbhClamp(u2key, u2+d2);
    if (!isFinite(nu1) || !isFinite(nu2)) return null;
    const converged = Math.abs(nu1-u1) < 1e-9 && Math.abs(nu2-u2) < 1e-9;
    u1 = nu1; u2 = nu2;
    if (converged){
      const chk = hbhbhResidual(u1key, u1, u2key, u2, known, Xt, Dt);
      return (Math.hypot(chk[0], chk[1]) < 1e-6) ? { [u1key]: u1, [u2key]: u2 } : null;
    }
  }
  const chk = hbhbhResidual(u1key, u1, u2key, u2, known, Xt, Dt);
  return (Math.hypot(chk[0], chk[1]) < 1e-4) ? { [u1key]: u1, [u2key]: u2 } : null;
}

function hbhbhInitGuesses(key){
  if (HBHBH_ANGLE_KEYS.has(key)) return [10, 30, 60, 90, 120, 150];
  if (key === 'r1' || key === 'r2') return [300, 573, 1000, 150];
  return [100, 300, 600, 50];
}

function solveHBHBHToTarget(unknowns, known, X, Dt){
  const [u1key, u2key] = unknowns;
  for (const g1 of hbhbhInitGuesses(u1key)){
    for (const g2 of hbhbhInitGuesses(u2key)){
      const res = hbhbhNewton(u1key, u2key, known, X, Dt, g1, g2);
      if (!res) continue;
      const full = Object.assign({}, known, res);
      if (full.thetaMax < 0 || full.thetaMax > 179.9) continue;
      if (full.thetaFinal < 0 || full.thetaFinal > 179.9) continue;
      if (full.D1 < 0 || full.D2 < 0 || full.L3 < 0 || full.r1 <= 0 || full.r2 <= 0) continue;
      return full;
    }
  }
  return null;
}


function chcCurveCL(inc0, az0, inc1, az1, dls){
  const betaDeg = impliedBetaDeg(inc0, az0, inc1, az1);
  return (dls > 1e-9) ? betaDeg*30/dls : (betaDeg < 1e-6 ? 0 : Infinity);
}

function chcForward(inc0, az0, incT, azT, dls1, dls2, inc1, az1, L){
  const cl1 = chcCurveCL(inc0, az0, inc1, az1, dls1);
  const p1 = (cl1 > 0 && isFinite(cl1)) ? minimumCurvature(inc0, az0, inc1, az1, cl1) : {dN:0,dE:0,dTVD:0};
  const a1 = inc1*D2R, e1 = az1*D2R;
  const dNh = L*Math.sin(a1)*Math.cos(e1), dEh = L*Math.sin(a1)*Math.sin(e1), dTh = L*Math.cos(a1);
  const cl2 = chcCurveCL(inc1, az1, incT, azT, dls2);
  const p2 = (cl2 > 0 && isFinite(cl2)) ? minimumCurvature(inc1, az1, incT, azT, cl2) : {dN:0,dE:0,dTVD:0};
  return {
    N: p1.dN + dNh + p2.dN, E: p1.dE + dEh + p2.dE, TVD: p1.dTVD + dTh + p2.dTVD,
    cl1: (isFinite(cl1) ? cl1 : 0), cl2: (isFinite(cl2) ? cl2 : 0)
  };
}

function chcResidual(inc0, az0, incT, azT, dls1, dls2, x, target){
  const f = chcForward(inc0, az0, incT, azT, dls1, dls2, x[0], x[1], x[2]);
  return [f.N-target.N, f.E-target.E, f.TVD-target.TVD];
}

function chcSolve3x3(A, b){
  const M = A.map((r,i)=>r.concat([b[i]]));
  for (let i=0;i<3;i++){
    let piv=i;
    for (let k=i+1;k<3;k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv=k;
    if (Math.abs(M[piv][i]) < 1e-14) return null;
    const tmp=M[i]; M[i]=M[piv]; M[piv]=tmp;
    for (let k=i+1;k<3;k++){
      const f = M[k][i]/M[i][i];
      for (let c=i;c<4;c++) M[k][c] -= f*M[i][c];
    }
  }
  const x=[0,0,0];
  for (let i=2;i>=0;i--){
    let s = M[i][3];
    for (let c=i+1;c<3;c++) s -= M[i][c]*x[c];
    x[i] = s/M[i][i];
  }
  return x;
}

function chcNewton(inc0, az0, incT, azT, dls1, dls2, target, guess){
  let x = guess.slice();
  for (let it=0; it<100; it++){
    const h = [1e-4, 1e-4, 1e-3];
    const f0 = chcResidual(inc0, az0, incT, azT, dls1, dls2, x, target);
    const J = [[0,0,0],[0,0,0],[0,0,0]];
    for (let j=0;j<3;j++){
      const xp = x.slice(); xp[j] += h[j];
      const fp = chcResidual(inc0, az0, incT, azT, dls1, dls2, xp, target);
      for (let i=0;i<3;i++) J[i][j] = (fp[i]-f0[i])/h[j];
    }
    const d = chcSolve3x3(J, f0.map(v=>-v));
    if (!d) return null;
    const maxAngleStep = 20, maxLenStep = Math.max(200, Math.abs(x[2]));
    d[0] = Math.max(-maxAngleStep, Math.min(maxAngleStep, d[0]));
    d[1] = Math.max(-maxAngleStep, Math.min(maxAngleStep, d[1]));
    d[2] = Math.max(-maxLenStep, Math.min(maxLenStep, d[2]));
    let nx = [x[0]+d[0], x[1]+d[1], x[2]+d[2]];
    nx[0] = Math.min(179.9, Math.max(0.1, nx[0]));
    nx[1] = ((nx[1]%360)+360)%360;
    nx[2] = Math.max(0, nx[2]);
    if (!nx.every(isFinite)) return null;
    const converged = Math.hypot(nx[0]-x[0], nx[1]-x[1], nx[2]-x[2]) < 1e-8;
    x = nx;
    if (converged){
      const chk = chcResidual(inc0, az0, incT, azT, dls1, dls2, x, target);
      return (Math.hypot(...chk) < 1e-6) ? x : null;
    }
  }
  const chk = chcResidual(inc0, az0, incT, azT, dls1, dls2, x, target);
  return (Math.hypot(...chk) < 1e-4) ? x : null;
}

function solveCurveHoldCurve(inc0, az0, incT, azT, dls1, dls2, target){
  const incGuesses = [10,30,60,90,120,150];
  const azGuesses = [0,45,90,135,180,225,270,315];
  const lGuesses = [100,400,800];
  for (const ig of incGuesses){
    for (const ag of azGuesses){
      for (const lg of lGuesses){
        const r = chcNewton(inc0, az0, incT, azT, dls1, dls2, target, [ig, ag, lg]);
        if (r) return { inc1:r[0], az1:r[1], L:r[2] };
      }
    }
  }
  return null;
}



/* ============================================================
   Wizard -> sections (iPlan, 2026-10-10). These mirror EXACTLY what
   quickPlan.ejs solveAndInsertBuildHold / solveAndInsertHbhbh /
   solveAndInsertCurveHoldCurve do after solving: same X/D/azimuth
   definitions, same validity checks, same sections appended. They take
   the current trajectory END state and a target in the same TVD datum.
   Return { sections:[...] } or { error:'...' }.
   ============================================================ */
function planBuildHold(end, t, knowns){   // knowns: any 2 of {dls, D1, theta, L2}
  const keys = Object.keys(knowns);
  if (keys.length !== 2) return { error:'Check exactly 2 knowns (you have ' + keys.length + ').' };
  if (Math.abs(end.inc) > 0.05) return { error:`This design requires the well to be vertical (Inc=0°) where it starts — current trajectory ends at Inc ${end.inc.toFixed(2)}°.` };
  const X = Math.hypot(t.n - end.n, t.e - end.e);
  const D3 = t.tvd - end.tvd;
  let targetAz = Math.atan2(t.e - end.e, t.n - end.n) * R2D; if (targetAz < 0) targetAz += 360;
  const known = {}, unknownsSolver = [];
  ['dls','D1','theta','L2'].forEach(k => {
    const sk = k === 'dls' ? 'r1' : k;
    if (knowns[k] !== undefined) known[sk] = (k === 'dls') ? r1FromDls(knowns[k]) : knowns[k];
    else unknownsSolver.push(sk);
  });
  const result = solveBuildHoldToTarget(unknownsSolver, known, X, D3);
  if (!result || !isFinite(result.D1) || !isFinite(result.r1) || !isFinite(result.theta) || !isFinite(result.L2) ||
      result.theta <= 0 || result.theta >= 180 || result.r1 <= 0 ||
      result.D1 < -1e-6 || result.L2 < -1e-6) // 2026-10-10: negative hold = target unreachable (see quickPlan.ejs note)
    return { error:'No physically valid solution found for this combination of knowns and this target.' };
  const { D1, r1, theta, L2 } = result;
  const dls = dlsFromR1(r1), buildCL = theta * 30 / dls, out = [];
  if (D1 > 1e-6) out.push({ kind:'hold', cl: D1 });
  if (buildCL > 1e-6) out.push({ kind:'direct', inc: theta, az: targetAz, cl: buildCL });
  if (L2 > 1e-6) out.push({ kind:'hold', cl: L2 });
  return { sections: out, solved: { D1, dls, theta, L2 } };
}

function planHbhbh(end, t, values, unknownUiKeys){ // values: all 7 UI keys; unknownUiKeys: exactly 2
  if (unknownUiKeys.length !== 2) return { error:'Check exactly 2 unknowns (you have ' + unknownUiKeys.length + ').' };
  if (Math.abs(end.inc) > 0.05) return { error:`This design requires the well to be vertical (Inc=0°) where it starts — current trajectory ends at Inc ${end.inc.toFixed(2)}°.` };
  const X = Math.hypot(t.n - end.n, t.e - end.e);
  const Dt = t.tvd - end.tvd;
  let targetAz = Math.atan2(t.e - end.e, t.n - end.n) * R2D; if (targetAz < 0) targetAz += 360;
  const uiToSolverKey = { dls1:'r1', dls2:'r2' };
  const known = {}, unknownsSolver = [];
  ['D1','dls1','thetaMax','D2','dls2','thetaFinal','L3'].forEach(k => {
    const sk = uiToSolverKey[k] || k;
    if (unknownUiKeys.includes(k)) unknownsSolver.push(sk);
    else known[sk] = (k === 'dls1' || k === 'dls2') ? r1FromDls(values[k]) : values[k];
  });
  const result = solveHBHBHToTarget(unknownsSolver, known, X, Dt);
  if (!result || HBHBH_KEYS.some(k => !isFinite(result[k])) ||
      result.thetaMax <= 0 || result.thetaMax >= 180 || result.thetaFinal <= 0 || result.thetaFinal >= 180 ||
      result.r1 <= 0 || result.r2 <= 0)
    return { error:'No physically valid solution found for this combination of knowns and this target.' };
  const { D1, r1, thetaMax, D2, r2, thetaFinal, L3 } = result;
  const dls1 = dlsFromR1(r1), dls2 = dlsFromR1(r2);
  const build1CL = thetaMax * 30 / dls1, build2CL = Math.abs(thetaFinal - thetaMax) * 30 / dls2, out = [];
  if (D1 > 1e-6) out.push({ kind:'hold', cl: D1 });
  if (build1CL > 1e-6) out.push({ kind:'direct', inc: thetaMax, az: targetAz, cl: build1CL });
  if (D2 > 1e-6) out.push({ kind:'hold', cl: D2 });
  if (build2CL > 1e-6) out.push({ kind:'direct', inc: thetaFinal, az: targetAz, cl: build2CL });
  if (L3 > 1e-6) out.push({ kind:'hold', cl: L3 });
  return { sections: out, solved: { D1, dls1, thetaMax, D2, dls2, thetaFinal, L3 } };
}

function planCurveHoldCurve(end, t, incT, azT, dls1, dls2){
  if (!(dls1 > 0) || !(dls2 > 0)) return { error:'Both DLS values must be greater than 0.' };
  const target = { N: t.n - end.n, E: t.e - end.e, TVD: t.tvd - end.tvd };
  const result = solveCurveHoldCurve(end.inc, end.az, incT, azT, dls1, dls2, target);
  if (!result) return { error:'No solution found for this target/Inc/Az/DLS combination — try different DLS values or a different target.' };
  const { inc1, az1, L } = result;
  const cl1 = chcCurveCL(end.inc, end.az, inc1, az1, dls1);
  const cl2 = chcCurveCL(inc1, az1, incT, azT, dls2);
  const out = [];
  if (cl1 > 1e-6) out.push({ kind:'direct', inc: inc1, az: az1, cl: cl1 });
  if (L > 1e-6) out.push({ kind:'hold', cl: L });
  if (cl2 > 1e-6) out.push({ kind:'direct', inc: incT, az: azT, cl: cl2 });
  return { sections: out, solved: { inc1, az1, L } };
}

/* ============================================================
   NEW for iPlan (2026-10-10) — no new physics: these only chain the
   functions above the same way quickPlan.ejs computeTrajectory() does.
   ============================================================ */

// Same labels as QuickPlan's section-type list.
const KIND_LABEL = {
  direct:'Direct Inc/Az + CL',
  hold:'HOLD (DLS = 0)',
  dlstf:'DLS + Toolface + CL',
  dlstf_inc:'DLS + Toolface + until Inc',
  dlstf_az:'DLS + Toolface + until Az',
  dlstf_tvd:'DLS + Toolface + until TVD',
  md_inc_az:'MD, Inc, Az',
  tvd_inc_az:'TVD, Inc, Az',
  dls_inc_az:'DLS, Inc, Az',
  hold_tvd:'HOLD to TVD',
  build_turn_cl:'Build + Turn + CL',
  tvd_dls_az:'TVD, DLS, Az'
};

// Input fields per section kind: [key, label, default]. Defaults are the
// same ones QuickPlan's section modal uses (renderModalFields).
const KIND_FIELDS = {
  direct:       [['inc','Inc (°)',20],['az','Az (°)',0],['cl','CL (m)',300]],
  hold:         [['cl','CL (m)',300]],
  dlstf:        [['dls','DLS (°/30m)',3],['tf','TF (°)',0],['cl','CL (m)',300]],
  dlstf_inc:    [['dls','DLS (°/30m)',3],['tf','TF (°)',0],['targetInc','Target Inc (°)',30]],
  dlstf_az:     [['dls','DLS (°/30m)',3],['tf','TF (°)',0],['targetAz','Target Az (°)',90]],
  dlstf_tvd:    [['dls','DLS (°/30m)',3],['tf','TF (°)',0],['targetTvd','Target TVD (m)',1500]],
  md_inc_az:    [['targetMd','Target MD (m)',800],['inc','Inc (°)',30],['az','Az (°)',0]],
  tvd_inc_az:   [['targetTvd','Target TVD (m)',1500],['inc','Inc (°)',30],['az','Az (°)',0]],
  dls_inc_az:   [['dls','DLS (°/30m)',3],['inc','Inc (°)',30],['az','Az (°)',0]],
  hold_tvd:     [['targetTvd','Target TVD (m)',1500]],
  build_turn_cl:[['buildRate','Build (°/30m)',2],['turnRate','Turn (°/30m)',1],['cl','CL (m)',300]],
  tvd_dls_az:   [['dls','DLS (°/30m)',3],['targetAz','Target Az (°)',90],['targetTvd','Target TVD (m)',1500]]
};

// Exactly quickPlan.ejs computeTrajectory(), except it starts from an
// arbitrary state {md, tvd, n, e, inc, az} instead of surface (0,0,0) and
// returns the stations instead of writing a global. Intermediate stations
// lie on the minimum-curvature arc of each section (slerp of the attitude
// vectors, then Eqs. 8.33-8.37 from the section start).
// Returns { stations:[{md,inc,az,tvd,n,e,dls30,section}], sections:[{...resolved, startMd, startTvd}] }
function computeStations(start, sections, step){
  step = step > 0 ? step : 10;
  const stations = [{md:start.md, inc:start.inc, az:start.az, tvd:start.tvd, n:start.n, e:start.e, dls30:0, section:0}];
  const resolvedList = [];
  let curInc=start.inc, curAz=start.az, md=start.md, tvd=start.tvd, n=start.n, e=start.e;

  (sections || []).forEach((s, si)=>{
    const resolved = resolveSectionEndpoint(curInc, curAz, tvd, md, s);
    resolvedList.push(Object.assign({ startMd: md, startTvd: tvd }, resolved));
    const endInc = resolved.endInc, endAz = resolved.endAz, CL = resolved.cl;
    if (!(CL > 0)){ curInc=endInc; curAz=endAz; return; }

    const startInc=curInc, startAz=curAz;
    const a1=startInc*D2R, a2=endInc*D2R, e1=startAz*D2R, e2=endAz*D2R;
    let cosBetaTotal = Math.cos(a2-a1) - Math.sin(a1)*Math.sin(a2)*(1-Math.cos(e2-e1));
    cosBetaTotal = Math.max(-1, Math.min(1, cosBetaTotal));
    const betaTotal = Math.acos(cosBetaTotal);
    const sectionDls30 = (betaTotal*R2D/CL)*30;

    const A = attitudeVector(startInc, startAz), B = attitudeVector(endInc, endAz);
    const baseMD=md, baseTVD=tvd, baseN=n, baseE=e;
    const numSteps = Math.max(1, Math.round(CL/step));

    for (let k=1; k<=numSteps; k++){
      const sLen = (k/numSteps)*CL;
      const t = sLen/CL;
      let incT, azT;
      if (k===numSteps){ incT=endInc; azT=endAz; }
      else if (betaTotal < 1e-8){ incT=startInc; azT=startAz; }
      else {
        const sinBeta = Math.sin(betaTotal);
        const f1 = Math.sin((1-t)*betaTotal)/sinBeta;
        const f2 = Math.sin(t*betaTotal)/sinBeta;
        const v = [A[0]*f1+B[0]*f2, A[1]*f1+B[1]*f2, A[2]*f1+B[2]*f2];
        const norm = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) || 1;
        const vn = [v[0]/norm, v[1]/norm, v[2]/norm];
        incT = Math.acos(Math.max(-1,Math.min(1,vn[2])))*R2D;
        azT = Math.atan2(vn[1], vn[0])*R2D; if (azT<0) azT+=360;
      }
      const mc = minimumCurvature(startInc, startAz, incT, azT, sLen);
      md = baseMD + sLen; tvd = baseTVD + mc.dTVD; n = baseN + mc.dN; e = baseE + mc.dE;
      stations.push({md, inc:incT, az:azT, tvd, n, e, dls30:sectionDls30, section:si+1});
    }
    curInc = endInc; curAz = endAz;
  });
  return { stations, sections: resolvedList };
}

// Position + orientation at an arbitrary MD on an existing survey (rows with
// md, incl, azim, tvd, northing, easting), interpolated along the
// minimum-curvature arc between the two bracketing stations — the same
// attitude-slerp + Eqs. 8.33-8.37 used in computeStations above.
// Returns {md, inc, az, tvd, n, e} or null if md is outside the survey.
function interpolateSurveyAtMD(survey, md){
  const num = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const rows = (survey || []).slice().sort((a,b) => num(a.md) - num(b.md));
  if (rows.length === 0) return null;
  const pick = r => ({ md:num(r.md), inc:num(r.incl), az:num(r.azim), tvd:num(r.tvd), n:num(r.northing), e:num(r.easting) });
  if (md < num(rows[0].md) - 1e-6 || md > num(rows[rows.length-1].md) + 1e-6) return null;
  for (let i = 0; i < rows.length; i++){
    if (Math.abs(num(rows[i].md) - md) < 1e-6) return pick(rows[i]);
  }
  for (let i = 1; i < rows.length; i++){
    const p = pick(rows[i-1]), q = pick(rows[i]);
    if (md > p.md && md < q.md){
      const CL = q.md - p.md, sLen = md - p.md, t = sLen / CL;
      const a1=p.inc*D2R, a2=q.inc*D2R, e1=p.az*D2R, e2=q.az*D2R;
      let cosB = Math.cos(a2-a1) - Math.sin(a1)*Math.sin(a2)*(1-Math.cos(e2-e1));
      const beta = Math.acos(Math.max(-1, Math.min(1, cosB)));
      let incT, azT;
      if (beta < 1e-8){ incT = p.inc; azT = p.az; }
      else {
        const A = attitudeVector(p.inc, p.az), B = attitudeVector(q.inc, q.az);
        const f1 = Math.sin((1-t)*beta)/Math.sin(beta), f2 = Math.sin(t*beta)/Math.sin(beta);
        const v = [A[0]*f1+B[0]*f2, A[1]*f1+B[1]*f2, A[2]*f1+B[2]*f2];
        const nn = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) || 1;
        incT = Math.acos(Math.max(-1, Math.min(1, v[2]/nn)))*R2D;
        azT = Math.atan2(v[1]/nn, v[0]/nn)*R2D; if (azT < 0) azT += 360;
      }
      const mc = minimumCurvature(p.inc, p.az, incT, azT, sLen);
      return { md, inc:incT, az:azT, tvd:p.tvd + mc.dTVD, n:p.n + mc.dN, e:p.e + mc.dE };
    }
  }
  return null;
}

root.IPlanCore = {
  D2R, R2D,
  minimumCurvature, applyToolfaceBeta, applyToolfaceSection,
  betaForTargetInc, betaForTargetAz, betaForTargetTVD, impliedBetaDeg,
  tvdAtGammaForTargetAz, solveTvdDlsAz, resolveSectionEndpoint,
  attitudeVector,
  KIND_LABEL, KIND_FIELDS, computeStations, interpolateSurveyAtMD,
  solveBuildHoldToTarget, r1FromDls, dlsFromR1,
  HBHBH_KEYS, HBHBH_ANGLE_KEYS, hbhbhTotals, hbhbhResidual, hbhbhClamp, hbhbhNewton, hbhbhInitGuesses, solveHBHBHToTarget,
  chcCurveCL, chcForward, chcResidual, chcSolve3x3, chcNewton, solveCurveHoldCurve,
  planBuildHold, planHbhbh, planCurveHoldCurve
};
})(typeof window !== 'undefined' ? window : globalThis);

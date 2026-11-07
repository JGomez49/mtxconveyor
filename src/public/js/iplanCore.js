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


/* ADDED 2026-11-06 (John: Compass "Optimum Align" panel), EXTENDED same day (John: TVD mode, Curve-Curve form,
   Project Back). Curve 1 (DLS d1) -> hold L -> curve 2 (DLS d2) from the current end to a point t, arriving with
   the final attitude (incT, azT). Unknowns / givens by mode (always 3 position equations N, E, TVD at the end):
     CHC 'dls': d1, d2 given            -> solve inc1, az1, L      (= the existing planCurveHoldCurve, used first)
     CHC 'tvd': TVD1 (end of curve 1), TVD2 (end of hold = start of curve 2) given
                                        -> solve inc1, az1, L, d1, d2   (5 eq.: N, E, TVD + TVD1 + TVD2)
     CHC 'tan': L given                 -> solve inc1, az1, d (d1 = d2 = d)
     CC  (L = 0) 'eq' / 'd1' / 'd2'     -> solve inc1, az1 + the common DLS / DLS2 (DLS1 given) / DLS1 (DLS2 given)
   Forward model = the same sections and minimum-curvature chain (computeStations, chcCurveCL). Solver: damped
   Newton, finite-difference Jacobian, Gaussian elimination, several starting points. No new formulas.
   Returns { sections, solved:{inc1, az1, L, d1, d2, tvd1, tvd2} } (all values, for the panel's grey fields) or { error }. */
function oaChain(end, inc1, az1, L, d1, d2, incT, azT){
  const cl1 = chcCurveCL(end.inc, end.az, inc1, az1, d1), cl2 = chcCurveCL(inc1, az1, incT, azT, d2), secs = [];
  if (cl1 > 1e-6) secs.push({ kind:'direct', inc: inc1, az: az1, cl: cl1 });
  if (L > 1e-6) secs.push({ kind:'hold', cl: L });
  if (cl2 > 1e-6) secs.push({ kind:'direct', inc: incT, az: azT, cl: cl2 });
  if (!secs.length) return null;
  const st = computeStations({ md: end.md || 0, tvd: end.tvd, n: end.n, e: end.e, inc: end.inc, az: end.az }, secs, 1e6).stations;
  // station after each section (step 1e6 -> one station per section)
  let k = 1; const at = {};
  if (cl1 > 1e-6) at.c1 = st[k++]; else at.c1 = st[0];
  if (L > 1e-6) at.h = st[k++]; else at.h = at.c1;
  return { secs, end: st[st.length - 1], tvd1: at.c1.tvd, tvd2: at.h.tvd };
}
function solveNewton(F, x0, nEq){
  const nrm = r => Math.sqrt(r.reduce((a, v) => a + v * v, 0));
  let x = x0.slice(), r = F(x); if (!r) return null;
  for (let it = 0; it < 80 && nrm(r) > 1e-3; it++){
    const J = x.map((_, k) => { const x2 = x.slice(), h = 1e-4 * Math.max(1, Math.abs(x[k])); x2[k] += h; const r2 = F(x2); return r2 ? r2.map((v, q) => (v - r[q]) / h) : null; });
    if (J.some(c => !c)) return { x, r: nrm(r) };
    // A (nEq x n) dx = -r ; square here -> Gaussian elimination with partial pivoting
    const n = x.length, A = []; for (let q = 0; q < nEq; q++){ A.push(J.map(c => c[q]).concat([-r[q]])); }
    for (let c = 0; c < n; c++){ let p = c; for (let q = c + 1; q < n; q++) if (Math.abs(A[q][c]) > Math.abs(A[p][c])) p = q;
      if (Math.abs(A[p][c]) < 1e-14) return { x, r: nrm(r) }; [A[c], A[p]] = [A[p], A[c]];
      for (let q = c + 1; q < n; q++){ const f = A[q][c] / A[c][c]; for (let k = c; k <= n; k++) A[q][k] -= f * A[c][k]; } }
    const dx = new Array(n).fill(0); for (let c = n - 1; c >= 0; c--){ let v = A[c][n]; for (let k = c + 1; k < n; k++) v -= A[c][k] * dx[k]; dx[c] = v / A[c][c]; }
    let lam = 1, ok = false;
    for (let ls = 0; ls < 14; ls++){ const xn = x.map((v, k) => v + lam * dx[k]), rn = F(xn); if (rn && nrm(rn) < nrm(r)){ x = xn; r = rn; ok = true; break; } lam /= 2; }
    if (!ok) break;
  }
  return { x, r: nrm(r) };
}
function planOptimumAlign(end, t, incT, azT, o){
  o = o || {};
  const type = o.type || 'chc', mode = o.mode || (type === 'cc' ? 'eq' : 'dls');
  const brg = (Math.atan2(t.e - end.e, t.n - end.n) * R2D + 360) % 360;
  // unknown layout per mode -> [inc1, az1, L, d1, d2]
  const spec = {
    'chc:dls': { free:['inc1','az1','L'], fix:{ d1:+o.dls1, d2:+o.dls2 } },
    'chc:tvd': { free:['inc1','az1','L','d1','d2'], fix:{}, tvd:true },
    'chc:tan': { free:['inc1','az1','d'], fix:{ L:+o.L } },
    'cc:eq':   { free:['inc1','az1','d'], fix:{ L:0 } },
    'cc:d1':   { free:['inc1','az1','d2'], fix:{ L:0, d1:+o.dls1 } },
    'cc:d2':   { free:['inc1','az1','d1'], fix:{ L:0, d2:+o.dls2 } }
  }[type + ':' + mode];
  if (!spec) return { error:'Unknown Optimum Align mode.' };
  const full = x => { const v = Object.assign({ L:0, d1:0, d2:0 }, spec.fix); spec.free.forEach((k, i) => { v[k] = x[i]; }); if (v.d != null){ v.d1 = v.d; v.d2 = v.d; } return v; };
  const F = x => { const v = full(x); if (!(v.d1 > 0.05) || !(v.d2 > 0.05) || v.d1 > 60 || v.d2 > 60 || v.L < -1e-6 || v.inc1 < 0 || v.inc1 > 180) return null;
    const c = oaChain(end, v.inc1, ((v.az1 % 360) + 360) % 360, Math.max(0, v.L), v.d1, v.d2, incT, azT); if (!c) return null;
    const r = [c.end.n - t.n, c.end.e - t.e, c.end.tvd - t.tvd];
    if (spec.tvd){ r.push(c.tvd1 - (+o.tvd1), c.tvd2 - (+o.tvd2)); }
    return r; };
  // starts: the existing CHC solution (dls mode, a few DLS) gives inc1 / az1 / L
  const starts = [];
  for (const dd of [+o.dls1 || 6, 3, 6, 9]){ const r0 = planCurveHoldCurve(end, t, incT, azT, dd, (+o.dls2 || dd)); if (r0 && r0.solved) starts.push({ inc1: r0.solved.inc1, az1: r0.solved.az1, L: r0.solved.L, d: dd }); }
  for (const i0 of [Math.max(1, (end.inc + incT) / 2), incT, 30, 60]) for (const d0 of [2, 5, 9]) starts.push({ inc1: i0, az1: brg, L: 100, d: d0 });
  let best = null;
  for (const s0 of starts){
    const x0 = spec.free.map(k => k === 'd' || k === 'd1' || k === 'd2' ? s0.d : s0[k]);
    const sol = solveNewton(F, x0, spec.free.length + (spec.tvd ? 2 : 0) - (spec.tvd ? 0 : 0));
    if (sol && (!best || sol.r < best.r)) best = sol;
    if (best && best.r < 1e-3) break;
  }
  if (!best || best.r > 0.05) return { error:'No solution found for this mode / target / attitude — try other values.' };
  const v = full(best.x), az1 = ((v.az1 % 360) + 360) % 360, c = oaChain(end, v.inc1, az1, Math.max(0, v.L), v.d1, v.d2, incT, azT);
  return { sections: c.secs, solved:{ inc1: v.inc1, az1, L: Math.max(0, v.L), d1: v.d1, d2: v.d2, tvd1: c.tvd1, tvd2: c.tvd2, miss: best.r } };
}
/* ADDED 2026-11-06 (John: Compass "Project Back To"). From the final target T (position + arrival attitude incT /
   azT) go BACKWARDS along one curve of DLS d to a point P; the plan then aligns to P (with P's attitude) and the
   curve P -> T is appended. P = T - (displacement of the min-curvature arc from attitude(P) to attitude(T)), i.e.
   the same arc the forward plan will drill. Modes (as in Compass):
     'incazi': P attitude (inc, az) given;  'inc': P inc given, az = azT (curve in the vertical plane);
     'cl': curve length given (vertical plane, incP = incT - d*CL/30);  'tvd': P TVD given (vertical plane, CL solved).
   Compass's "Target" and "Surface" options are not implemented. Returns { P:{n,e,tvd,inc,az}, sec, cl } or { error }. */
function projectBack(T, incT, azT, o){
  const d = +o.dls;
  // 2026-11-06 (John's Compass clip: "CL 10, DLS 0" = a straight 10 m hold ending at the target): CL mode with DLS 0
  // projects back along the target attitude (hold). Other modes need a DLS > 0.
  if (!(d > 0)){
    if (o.mode !== 'cl') return { error:'Project Back: DLS must be > 0 for ' + o.mode + ' (DLS 0 is only for CL = a hold).' };
    const cl = Math.max(0, +o.cl || 0); if (cl < 1e-6) return { P:{ n:T.n, e:T.e, tvd:T.tvd, inc:incT, az:azT }, cl:0, sec:null };
    const st = computeStations({ md:0, tvd:0, n:0, e:0, inc:incT, az:azT }, [{ kind:'hold', cl }], 1e6).stations, D = st[st.length - 1];
    return { P:{ n:T.n - D.n, e:T.e - D.e, tvd:T.tvd - D.tvd, inc:incT, az:azT }, cl, sec:{ kind:'hold', cl } };
  }
  const arc = (incP, azP) => { const beta = impliedBetaDeg(incP, azP, incT, azT), cl = beta / d * 30;
    if (cl < 1e-6) return { P:{ n:T.n, e:T.e, tvd:T.tvd, inc:incT, az:azT }, cl:0, sec:null };
    const st = computeStations({ md:0, tvd:0, n:0, e:0, inc:incP, az:azP }, [{ kind:'direct', inc:incT, az:azT, cl }], 1e6).stations, D = st[st.length - 1];
    return { P:{ n:T.n - D.n, e:T.e - D.e, tvd:T.tvd - D.tvd, inc:incP, az:azP }, cl, sec:{ kind:'direct', inc:incT, az:azT, cl } }; };
  if (o.mode === 'incazi') return arc(+o.inc, +o.az);
  if (o.mode === 'inc') return arc(+o.inc, azT);
  if (o.mode === 'cl'){ const incP = incT - d * (+o.cl) / 30; if (incP < 0) return { error:'Project Back: CL too long for this DLS (inclination would go below 0).' }; return arc(incP, azT); }
  if (o.mode === 'tvd'){ let lo = 0, hi = Math.min(incT, 180) * 30 / d, f = cl => arc(incT - d * cl / 30, azT).P.tvd - (+o.tvd);
    if (f(lo) * f(hi) > 0) return { error:'Project Back: that TVD cannot be reached by a vertical-plane curve of this DLS.' };
    for (let k = 0; k < 60; k++){ const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
    return arc(incT - d * ((lo + hi) / 2) / 30, azT); }
  return { error:'Project Back: unknown mode.' };
}

/* ADDED 2026-11-06 (John: Compass "Thread Targets" dialog — Thread Method Curve Only / Curve-Hold / Optimum Align /
   Straight Line + "Dogleg to"). Hits a target POINT T = {n, e, tvd} from the plan's last station `end` (attitude kept,
   no step). Geometry only — circular arcs (= one minimum-curvature section 'direct') and straight holds:
     'curve'  (Curve Only): the one circular arc tangent to the current direction t that passes through T. With chord
              d = T - start, the arc's total dogleg is beta = 2 * angle(t, d) and the exit direction is t reflected
              about d: t2 = 2 (d^.t) d^ - t; arc length = |d| * beta / (2 sin(beta/2)). DLS is whatever it needs to be
              (John 2026-11-06: "DLS solved"; "Dogleg to" not used).
     'curvehold' (Curve-Hold): arc at the given DLS (radius R = 30*180/(pi*DLS), r1FromDls) in the plane of t and d,
              then a hold to T. In that plane (x along t, y across), the exit angle b solves
              x sin b - (y - R) cos b = R (the hold line from the arc end passes through T); hold = projection of the
              remaining vector on the exit direction. Unreachable if T is inside the turning circle.
     'line'   (Straight Line): the attitude changes AT the station (CL 0 section = a station dogleg, like Compass's
              straight line) and a hold along the chord to T.
   'Optimum Align' is planOptimumAlign (CHC, both doglegs = "Dogleg to") with the target's Inc / Azi — done by the caller.
   'Least Turn' not implemented (Compass behaviour not confirmed). Returns { sections, info } or { error }. */
function threadToPoint(end, T, method, dls){
  const vec = (i, a) => attitudeVector(i, a);
  const toIA = v => { const L = Math.hypot(v[0], v[1], v[2]) || 1, u = [v[0] / L, v[1] / L, v[2] / L];
    return { inc: Math.acos(Math.max(-1, Math.min(1, u[2]))) * R2D, az: ((Math.atan2(u[1], u[0]) * R2D) % 360 + 360) % 360 }; };
  const d = [T.n - end.n, T.e - end.e, T.tvd - end.tvd], D = Math.hypot(d[0], d[1], d[2]);
  if (D < 1e-6) return { sections: [], info: { cl: 0 } };
  const t = vec(end.inc, end.az), dh = [d[0] / D, d[1] / D, d[2] / D], c = Math.max(-1, Math.min(1, t[0] * dh[0] + t[1] * dh[1] + t[2] * dh[2]));
  if (method === 'line'){
    const a = toIA(d); return { sections: [{ kind:'direct', inc:a.inc, az:a.az, cl:0 }, { kind:'hold', cl:D }], info: { cl: D, stationDogleg: impliedBetaDeg(end.inc, end.az, a.inc, a.az) } };
  }
  if (c > 1 - 1e-12) return { sections: [{ kind:'hold', cl:D }], info: { cl: D, dls: 0 } };   // already on line
  if (method === 'curve'){
    const half = Math.acos(c), beta = 2 * half;
    if (beta > Math.PI * 2 - 1e-9) return { error: 'Target is directly behind the bit.' };
    const t2 = [2 * c * dh[0] - t[0], 2 * c * dh[1] - t[1], 2 * c * dh[2] - t[2]], a = toIA(t2), cl = D * beta / (2 * Math.sin(half));
    return { sections: [{ kind:'direct', inc:a.inc, az:a.az, cl }], info: { cl, dls: beta * R2D / cl * 30 } };
  }
  if (method === 'curvehold'){
    if (!(+dls > 0)) return { error: 'Curve-Hold: "Dogleg to" must be > 0.' };
    const R = r1FromDls(+dls), x = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
    const vp = [d[0] - x * t[0], d[1] - x * t[1], d[2] - x * t[2]], y = Math.hypot(vp[0], vp[1], vp[2]), v = [vp[0] / y, vp[1] / y, vp[2] / y];
    const Dc = Math.hypot(x, y - R);
    if (Dc < R - 1e-9) return { error: 'Curve-Hold: target is inside the turning circle at ' + (+dls) + '°/30m — raise "Dogleg to" or use Curve Only.' };
    const phi = Math.atan2(y - R, x), as = Math.asin(Math.min(1, R / Dc));
    let best = null;
    for (const b0 of [phi + as, phi + Math.PI - as]){
      const b = ((b0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const qx = R * Math.sin(b), qy = R * (1 - Math.cos(b)), L = (x - qx) * Math.cos(b) + (y - qy) * Math.sin(b);
      if (L >= -1e-6 && (!best || b < best.b)) best = { b, L: Math.max(0, L) };
    }
    if (!best) return { error: 'Curve-Hold: no solution.' };
    const ex = [Math.cos(best.b) * t[0] + Math.sin(best.b) * v[0], Math.cos(best.b) * t[1] + Math.sin(best.b) * v[1], Math.cos(best.b) * t[2] + Math.sin(best.b) * v[2]], a = toIA(ex);
    const cl1 = best.b * R, secs = [];
    if (cl1 > 1e-6) secs.push({ kind:'direct', inc:a.inc, az:a.az, cl:cl1 });
    if (best.L > 1e-6) secs.push({ kind:'hold', cl:best.L });
    return { sections: secs, info: { cl: cl1 + best.L, curve: cl1, hold: best.L, dls: +dls } };
  }
  return { error: 'Unknown thread method.' };
}

/* ADDED 2026-11-06 (COMPASS Training Manual 2003.5, ch. 5 "Thread Targets", p.191: "Straight Line — Finds the best
   straight line to thread through the targets. It uses optimum align to get to the first target. Normally the line
   starts and ends with the vertical depth of the first and last target, but if the targets are near horizontal or
   'sort by displacement' is chosen, then the line is limited by displacement. The best-fit line is weighted to hit
   targets with smaller dimensions ... a message is reported if a target has been missed.")
   The manual gives no formula for the fit. Used here (standard weighted orthogonal least squares, i.e. the principal
   axis of the weighted point cloud): weight w = 1 / max(r, 1 m)^2 (r = target radius; points without a size -> 1 m);
   line through the weighted centroid along the eigenvector of the largest eigenvalue of the weighted scatter
   matrix (power iteration), oriented from the first to the last target. Ends: at the TVDs of the first and last
   target, or (line within 5° of horizontal, or byDisp) the orthogonal projections of the first and last target.
   Each target's distance to the line is reported (miss when > r). THIS IS MY INTERPRETATION — to be checked against
   a Compass run. Returns { a:{n,e,tvd}, b:{n,e,tvd}, inc, az, miss:[{i, dist, r, missed}] } or { error }. */
function fitTargetLine(pts, byDisp){
  if (!pts || pts.length < 2) return { error: 'Straight Line needs at least 2 targets.' };
  const P = pts.map(p => [p.n, p.e, p.tvd]), w = pts.map(p => 1 / Math.pow(Math.max(+p.r || 0, 1), 2)), W = w.reduce((a, b) => a + b, 0);
  const c = [0, 1, 2].map(k => P.reduce((a, q, i) => a + w[i] * q[k], 0) / W);
  const S = [[0,0,0],[0,0,0],[0,0,0]];
  P.forEach((q, i) => { const d = [q[0] - c[0], q[1] - c[1], q[2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += w[i] * d[a] * d[b]; });
  let u = [P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1], P[P.length - 1][2] - P[0][2]];
  for (let it = 0; it < 200; it++){ const v = [0, 1, 2].map(a => S[a][0] * u[0] + S[a][1] * u[1] + S[a][2] * u[2]); const L = Math.hypot(v[0], v[1], v[2]); if (L < 1e-12) break; u = v.map(x => x / L); }
  const L0 = Math.hypot(u[0], u[1], u[2]); if (L0 < 1e-12) return { error: 'Straight Line: targets coincide.' }; u = u.map(x => x / L0);
  const f0 = P[0], f1 = P[P.length - 1];
  if ((f1[0] - f0[0]) * u[0] + (f1[1] - f0[1]) * u[1] + (f1[2] - f0[2]) * u[2] < 0) u = u.map(x => -x);
  const at = s => ({ n: c[0] + s * u[0], e: c[1] + s * u[1], tvd: c[2] + s * u[2] }), proj = q => (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1] + (q[2] - c[2]) * u[2];
  const flat = Math.abs(u[2]) < Math.sin(5 * D2R);
  const sA = (flat || byDisp) ? proj(f0) : (f0[2] - c[2]) / u[2], sB = (flat || byDisp) ? proj(f1) : (f1[2] - c[2]) / u[2];
  const miss = P.map((q, i) => { const s = proj(q), x = at(s), dist = Math.hypot(q[0] - x.n, q[1] - x.e, q[2] - x.tvd); return { i, dist, r: +pts[i].r || 0, missed: dist > (+pts[i].r || 0) + 1e-6 }; });
  return { a: at(sA), b: at(sB), inc: Math.acos(Math.max(-1, Math.min(1, u[2]))) * R2D, az: ((Math.atan2(u[1], u[0]) * R2D) % 360 + 360) % 360, miss };
}
/* ADDED 2026-11-06 (COMPASS Training Manual 2003.5 p.191: "If the dogleg severity is insufficient, then a better
   dogleg is suggested and the path computed"; Exercise Book p.169: "Enter 1 for the dogleg. This will be increased
   to hit the target. A 1.46 dogleg is used."). Calls solve(dls) with the given DLS, then increases it in 1 %
   steps (minimum 0.01°/30m) up to 60°/30m until a solution exists; then refines down by bisection to 0.01°/30m.
   The manual does not give Compass's increment — the result is the smallest workable DLS to 0.01. */
function withDoglegIncrease(dls0, solve){
  let d = Math.max(+dls0 || 0, 0.01), r = solve(d);
  if (!r.error) return Object.assign(r, { dlsUsed: d, raised: false });
  let lo = d, hi = d;
  while (hi < 60){ lo = hi; hi = Math.min(60, Math.max(hi * 1.01, hi + 0.01)); r = solve(hi); if (!r.error) break; }
  if (r.error) return r;
  let best = r, bd = hi;
  for (let k = 0; k < 30 && bd - lo > 0.005; k++){ const m = (lo + bd) / 2, rm = solve(m); if (rm.error) lo = m; else { best = rm; bd = m; } }
  return Object.assign(best, { dlsUsed: bd, raised: true });
}

/* ADDED 2026-11-06 (John: "the big challenge in iPad is the anti-collision phase … probably the RRT approach").
   iPad DEEP SEARCH — kinodynamic RRT (LaValle, "Rapidly-exploring random trees", lavalle.pl/rrt) for the shallow
   hole + iPad's own back-projected solver as the connector. No new drilling formulas: every edge is an existing
   'dlstf' section (minimum curvature), the connector is padSolveBack (tpl.preSecs), clearances are padAvoid's zones.
   - Tree states (MD, N, E, TVD, Inc, Az) from the slot; edges = 30 m DLS-TF sections, best of 8 random controls toward
     a random sample (TVD < handTvd). Above the template KOP: DLS <= nudge DLS and Inc <= nudge Inc max (AC nudge
     limits); below: DLS <= dMax; Inc <= 60 in the tree; no drop > 0.5 deg once Inc > 10 deg (John's no-nudge rule).
   - Every new branch is clearance-checked (30 m spatial grid of obstacle segments). ~8 % of branches below 150 m MD
     are connected: padSolveBack(collect 20, design rules) from the branch end to the ICP shifted along the lateral
     by one of o.shifts (smallest first preferred); each design is scored on its whole path (surface -> ICP):
     obstacle hits (offsets / planned: padAvoid zones; other pad wells: the pad clearance from fromMd), shortfall, MD.
   - Restarts with a new seed until timeMs; keeps the best (fewest hits, then shortfall, then MD).
   - SMOOTHING (shortcut, standard RRT post-processing): the tree part is a string of 30 m DLS-TF steps; greedily
     replace node i..j by ONE curve-hold-curve (padAlign: same end position AND attitude, DLS as low as possible within
     the zone limits) when that stays clear and rule-clean — the connector part is unchanged.
   Results are stochastic (seeded). Validated offline on SD9 2026-11-06 (see claude/ipad-rrt-prototype.md). */
function padDeepSearch(W, ctx){
  const C0 = Object.assign({ timeMs:60000, seed:1, handTvd:350, dMax:9, nudgeDls:5, nudgeInc:15, shifts:[0], obstacles:[], clr:10, nearMd:200, icpZone:100, icpClr:5, padClr:10, fromMd:0, latAz:null }, ctx || {});
  const surf = W.surf, ss = W.ss || 0, tpl = W.tpl, kopLim = +tpl.kop || 120, T0 = Date.now();
  const OB = C0.obstacles.map(x => ({ name:x.name, pad:!!x.pad, P:x.pts.filter(p => isFinite(p.n) && isFinite(p.e) && isFinite(p.z)) })).filter(x => x.P.length > 1);
  const CELL = 30, G = new Map(), K3 = (a, b, c) => a + ',' + b + ',' + c, fl = Math.floor;
  OB.forEach((o, oi) => { for (let j = 1; j < o.P.length; j++){ const a = o.P[j - 1], c = o.P[j];
    for (let x = fl(Math.min(a.n, c.n) / CELL); x <= fl(Math.max(a.n, c.n) / CELL); x++) for (let y = fl(Math.min(a.e, c.e) / CELL); y <= fl(Math.max(a.e, c.e) / CELL); y++) for (let z = fl(Math.min(a.z, c.z) / CELL); z <= fl(Math.max(a.z, c.z) / CELL); z++){
      const k = K3(x, y, z); if (!G.has(k)) G.set(k, []); G.get(k).push([oi, a, c]); } } });
  const near = (n, e, z) => { const cx = fl(n / CELL), cy = fl(e / CELL), cz = fl(z / CELL), best = new Map();
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let w = cz - 1; w <= cz + 1; w++){ const L = G.get(K3(x, y, w)); if (!L) continue;
      for (const [oi, a, c] of L){ const vx = c.n - a.n, vy = c.e - a.e, vz = c.z - a.z, wx = n - a.n, wy = e - a.e, wz = z - a.z, LL = vx*vx + vy*vy + vz*vz;
        let t = LL ? (wx*vx + wy*vy + wz*vz) / LL : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(wx - t*vx, wy - t*vy, wz - t*vz); if (!best.has(oi) || d < best.get(oi)) best.set(oi, d); } }
    return best; };
  const segMin = (p, P) => { let b = Infinity; for (let j = 1; j < P.length; j++){ const a = P[j - 1], c = P[j], vx = c.n - a.n, vy = c.e - a.e, vz = c.z - a.z, wx = p.n - a.n, wy = p.e - a.e, wz = p.z - a.z, L2 = vx*vx + vy*vy + vz*vz;
    let u = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u; const d = Math.hypot(wx - u*vx, wy - u*vy, wz - u*vz); if (d < b) b = d; } return b; };
  const sc = new Map(), vc = new Map();
  const slotD = oi => { if (!sc.has(oi)) sc.set(oi, segMin({ n:surf.n, e:surf.e, z:ss }, OB[oi].P)); return sc.get(oi); };
  const vertD = (oi, z) => { const k = oi + '|' + Math.round(z); if (!vc.has(k)) vc.set(k, segMin({ n:surf.n, e:surf.e, z }, OB[oi].P)); return vc.get(k); };
  // shortfall at a station (same zones as padAvoid obsEval; pad wells: pad clearance below fromMd)
  const reqOf = (oi, p, z, landMd) => { if (OB[oi].pad) return p.md >= C0.fromMd ? C0.padClr : 0;
    return p.md < C0.nearMd ? Math.min(C0.clr, slotD(oi) - 0.3, vertD(oi, z) - 0.3) : (p.md >= landMd - C0.icpZone ? Math.min(C0.clr, C0.icpClr) : C0.clr); };
  const shortAt = (p, landMd) => { const z = ss - p.tvd; let w = 0, who = -1; for (const [oi, d] of near(p.n, p.e, z)){ const r = reqOf(oi, p, z, landMd) - d; if (r > w){ w = r; who = oi; } } return [w, who]; };
  const evalPath = (st, landMd) => { const hits = new Map(); let sev = 0;
    for (const p of st){ if (p.md > landMd + 1e-6) break; const z = ss - p.tvd;
      for (const [oi, d] of near(p.n, p.e, z)){ const req = reqOf(oi, p, z, landMd); if (d < req - 1e-6){ sev += req - d; const h = hits.get(oi); if (!h || req - d > h.req - h.d) hits.set(oi, { name:OB[oi].name, pad:OB[oi].pad, d, req, md:p.md }); } } }
    const L = [...hits.values()], ph = L.filter(x => x.pad).length;
    return { hits: hits.size, padHits: ph, score: hits.size + ph, sev, list: L }; };   // score: a touching pad well counts double (it blocks the joint pass)
  const better = (a, b) => !b || a.score < b.score || (a.score === b.score && (a.sev < b.sev - 1e-6 || (Math.abs(a.sev - b.sev) <= 1e-6 && a.landMd < b.landMd)));
  const ruleOk = (st, peak0) => { let peak = peak0 || 0; for (const p of st){ peak = Math.max(peak, p.inc); if (peak > 10 && p.inc < peak - 0.5) return false; } return true; };
  const latAz = C0.latAz != null ? C0.latAz : W.land.az, la = latAz * D2R;
  let best = null, seed = C0.seed, conn = 0, iters = 0, trees = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  while (Date.now() - T0 < C0.timeMs){
    trees++; seed = (C0.seed * 7919 + trees * 104729) % 2147483647 || 1;
    const nodes = [{ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0, parent:null, sec:null, peak:0 }];
    const tEnd = Math.min(C0.timeMs, (Date.now() - T0) + Math.max(15000, C0.timeMs / 3));
    const lo = { n:Math.min(surf.n, W.land.n) - 100, e:Math.min(surf.e, W.land.e) - 150 }, span = { n:Math.abs(surf.n - W.land.n) + 200, e:Math.abs(surf.e - W.land.e) + 300 };
    while (Date.now() - T0 < tEnd){
      iters++;
      const q = { n:lo.n + rnd() * span.n, e:lo.e + rnd() * span.e, tvd:40 + rnd() * (C0.handTvd - 60) };
      let nb = null, bd = Infinity; for (const nd of nodes){ if (nd.tvd > C0.handTvd - 20) continue; const d = Math.hypot(nd.n - q.n, nd.e - q.e, nd.tvd - q.tvd); if (d < bd){ bd = d; nb = nd; } }
      if (!nb) continue;
      let be = null;
      for (let k = 0; k < 8; k++){ const sh = nb.md < kopLim, sec = { kind:'dlstf', dls: rnd() < 0.3 ? 0 : rnd() * (sh ? C0.nudgeDls : C0.dMax), tf: rnd() * 360, cl:30 };
        const st = computeStations(nb, [sec], 10).stations, e = st[st.length - 1];
        if ((sh && e.inc > C0.nudgeInc) || e.inc > 60 || (nb.inc > 10 && e.inc < nb.inc - 0.5)) continue;
        const d = Math.hypot(e.n - q.n, e.e - q.e, e.tvd - q.tvd); if (!be || d < be.d) be = { d, sec, st, e }; }
      if (!be || be.st.slice(1).some(p => shortAt(p, 1e9)[0] > 1e-6)) continue;
      const e = be.e, nd = { md:e.md, tvd:e.tvd, n:e.n, e:e.e, inc:e.inc, az:e.az, parent:nb, sec:be.sec, peak:Math.max(nb.peak, e.inc) }; nodes.push(nd);
      if (nd.md < 150 || rnd() > 0.08) continue;
      conn++;
      const preSecs = []; for (let x = nd; x && x.sec; x = x.parent) preSecs.unshift(x.sec);
      const shf = C0.shifts[fl(rnd() * C0.shifts.length)] || 0;
      const L2 = Object.assign({}, W.land, { n: W.land.n + shf * Math.cos(la), e: W.land.e + shf * Math.sin(la) });
      const tp = Object.assign({}, tpl, { kop: nd.md, preSecs, nudge:null, _noKopRetry:true });
      const r = padSolveBack(surf, L2, tp, { collect:20 });
      for (const d of (Array.isArray(r) ? r : [r])){
        if (!d || !d.ok || (d.violations || []).length) continue;
        const st = computeStations({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, d.sections, 10).stations;
        const landMd = d.sections.reduce((a, x, i) => a + ((d.tags || [])[i] === 'lateral' ? 0 : x.cl), 0);
        if (best && best.score === 0 && landMd >= best.landMd) continue;
        const ev = evalPath(st, landMd), cand = Object.assign(ev, { landMd, r:d, land:L2, shift:shf, nPre:preSecs.length });
        if (better(cand, best)) best = cand;
      }
    }
  }
  if (best && best.r){ best.r = padOaFinalize(Object.assign({}, best.r)); best = padDeepSmooth(W, best, C0, { shortAt, evalPath, ruleOk, kopLim }); }   // iPlan Optimum Align group, then smoothing
  return best ? Object.assign(best, { ms: Date.now() - T0, iters, trees, conn }) : { hits: Infinity, ms: Date.now() - T0, iters, trees, conn };
}
// Shortcut smoothing of the tree rows (see padDeepSearch). Keeps the connector rows and the end state of the tree.
function padDeepSmooth(W, best, C0, F){
  const r = best.r, tags = r.tags || [], surf = W.surf;
  const preIdx = tags.map((t, i) => t === 'pre' ? i : -1).filter(i => i >= 0); if (preIdx.length < 2) return best;
  const preSecs = preIdx.map(i => r.sections[i]);
  const states = computeStations({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, preSecs, 1e6).stations;   // node k = states[k]
  const out = []; let i = 0;
  while (i < preSecs.length){
    let done = false;
    for (let j = preSecs.length; j > i + 1 && !done; j--){
      const A = states[i], B = states[j];
      for (const d of [2, 3, 4, 5, 6, 7.5, 9]){
        if (d > C0.dMax + 1e-9) break;
        const al = padAlign({ n:A.n, e:A.e, tvd:A.tvd, inc:A.inc, az:A.az }, { n:B.n, e:B.e, tvd:B.tvd }, { inc:B.inc, az:B.az }, d);
        if (!al) continue;
        const x = al.x, azH = ((x[1] % 360) + 360) % 360, segs = [];
        const c1 = impliedBetaDeg(A.inc, A.az, x[0], azH) * 30 / d; if (c1 > 1e-6) segs.push({ kind:'direct', inc:x[0], az:azH, cl:c1 });
        if (x[2] > 1e-6) segs.push({ kind:'direct', inc:x[0], az:azH, cl:x[2] });
        const c2 = impliedBetaDeg(x[0], azH, B.inc, B.az) * 30 / d; if (c2 > 1e-6) segs.push({ kind:'direct', inc:B.inc, az:B.az, cl:c2 });
        const st = computeStations({ md:A.md, tvd:A.tvd, n:A.n, e:A.e, inc:A.inc, az:A.az }, segs, 10).stations;
        if (st.some(p => p.md < F.kopLim && (p.inc > C0.nudgeInc + 1e-6 || p.dls30 > C0.nudgeDls + 1e-6)) || st.some(p => p.inc > 60)) continue;
        const peak0 = states.slice(0, i + 1).reduce((m, p) => Math.max(m, p.inc), 0);
        if (!F.ruleOk(st, peak0) || st.slice(1).some(p => F.shortAt(p, best.landMd)[0] > 1e-6)) continue;
        // the shortcut has another length: shift MDs (zones depend on MD) — re-checked on the whole path below
        out.push(...segs); i = j; done = true; break;
      }
    }
    if (!done){ out.push(preSecs[i]); i++; }
  }
  const nonPre = r.sections.filter((_, k) => tags[k] !== 'pre'), nonTags = tags.filter(t => t !== 'pre');
  const sections = out.concat(nonPre), tg = out.map(() => 'pre').concat(nonTags);
  const st = computeStations({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, sections, 10).stations;
  const landMd = sections.reduce((a, x, k) => a + (tg[k] === 'lateral' ? 0 : x.cl), 0), ev = F.evalPath(st, landMd);
  if (ev.score > best.score || (ev.score === best.score && ev.sev > best.sev + 0.05)) return best;   // smoothing must not make it worse
  const r2 = Object.assign({}, r, { sections, tags: tg, oaPlan:null, oaFallback:null, smoothed: { before: preSecs.length, after: out.length } });
  if (r.oaPlan) r2.oaPlan = { pre: out.slice(), def: r.oaPlan.def, post: r.oaPlan.post };
  r2.maxDls = Math.max(+r.maxDls || 0, ...st.map(p => p.dls30 || 0));
  return Object.assign({}, best, ev, { landMd, r: r2, nPre: out.length });
}
/* Deep search over a whole pad after padAvoid (o = padAvoid options + deepMs per well, rounds). Wells still in conflict
   (offset / planned hits or touching pad pairs) are re-planned one at a time against the offsets + every other pad well's
   CURRENT path (JOINT pass: when a well's remaining conflict is another pad well, that well is queued next, so the pair is
   solved together over the rounds). A new design is kept only if it lowers that well's conflicts (pad pairs included).
   Mutates and returns res (same shape as padAvoid's result; changed wells carry deep:{ms, nPre, smoothed}). */
async function padDeepAvoid(wells, res, o, progress){
  o = Object.assign({ deepMs:60000, rounds:3, nearMd:200, icpZone:100, icpClr:5, R:10, fromMd:0 }, o || {});
  const lim = 2 * o.R, nW = wells.length, T0 = Date.now();
  const path = i => { const c = res.wells[i]; if (!c) return null; const W = wells[i];
    const st = computeStations({ md:0, tvd:0, n:W.surf.n, e:W.surf.e, inc:0, az:0 }, c.r.sections, 10).stations;
    const landMd = c.r.sections.reduce((a, x, k) => a + ((c.r.tags || [])[k] === 'lateral' ? 0 : x.cl), 0);
    return st.filter(p => p.md <= landMd + 1e-6).map(p => ({ n:p.n, e:p.e, z:(W.ss || 0) - p.tvd, md:p.md })); };
  const pairD = (A, B) => { let m = Infinity; for (const p of A){ if (p.md < o.fromMd) continue; for (let j = 1; j < B.length; j++){ if (B[j].md < o.fromMd) continue; const a = B[j - 1], c = B[j], vx = c.n - a.n, vy = c.e - a.e, vz = c.z - a.z, wx = p.n - a.n, wy = p.e - a.e, wz = p.z - a.z, L2 = vx*vx + vy*vy + vz*vz;
    let u = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u; const d = Math.hypot(wx - u*vx, wy - u*vy, wz - u*vz); if (d < m) m = d; } } return m; };
  const recount = () => { const P = wells.map((_, i) => path(i)); const pairs = [];
    for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++){ if (!P[i] || !P[j]) continue; const d = pairD(P[i], P[j]); if (d < lim - 1e-6) pairs.push({ i, j, d }); }
    res.pairs = pairs; res.end = Object.assign({}, res.end, { pairs: pairs.length, oh: res.wells.reduce((a, c) => a + (c && c.obs ? c.obs.length : 0), 0) }); return P; };
  let P = recount(); const queue = [];
  const conflicts = i => (res.wells[i] && res.wells[i].obs ? res.wells[i].obs.length : 0) + res.pairs.filter(x => x.i === i || x.j === i).length;
  for (let i = 0; i < nW; i++) if (conflicts(i)) queue.push(i);
  let rounds = 0; const tried = new Map(); res.deep = { wells: [], ms: 0 };
  while (queue.length && rounds < o.rounds * nW){
    rounds++;
    const i = queue.shift(), W = wells[i], cur = res.wells[i]; if (!cur) continue;
    const k = (tried.get(i) || 0) + 1; tried.set(i, k); if (k > o.rounds) continue;
    if (progress) await progress('Deep search: well ' + (i + 1) + ' (try ' + k + ')');
    const obstacles = (o.obstacles || []).map(x => ({ name:x.name, pts:x.pts })).concat(P.map((pp, j) => j === i || !pp ? null : { name:'pad#' + j, pad:true, pts:pp }).filter(Boolean));
    const shifts = [0]; [0.25, 0.5, 0.75, 1].forEach(f => { if (o.tolAlong > 0) shifts.push(f * o.tolAlong, -f * o.tolAlong); });
    // yield to the UI between trees: run in slices
    let bestD = null; const slices = Math.max(1, Math.round(o.deepMs / 15000));
    for (let s0 = 0; s0 < slices; s0++){
      const d = padDeepSearch(W, { timeMs: o.deepMs / slices, seed: 1 + i * 31 + k * 7 + s0 * 101, obstacles, clr: o.obsClr != null ? o.obsClr : lim, nearMd:o.nearMd, icpZone:o.icpZone, icpClr:o.icpClr, padClr: lim, fromMd:o.fromMd,
        nudgeDls: o.nudge ? o.nudge.dls : 5, nudgeInc: o.nudge ? o.nudge.incMax : 15, dMax: Math.max(9, +(W.tpl.back || {}).dMax || 9), shifts, latAz: W.land.az });
      if (d && isFinite(d.hits) && (!bestD || d.score < bestD.score || (d.score === bestD.score && d.sev < bestD.sev))) bestD = d;
      if (progress) await progress('Deep search: well ' + (i + 1) + ' — best so far ' + (bestD ? bestD.hits + ' conflict(s)' : 'none'));
      if (bestD && bestD.score === 0) break;
    }
    if (!bestD) continue;
    // accept only if it lowers this well's conflicts AND does not touch more pad wells than now
    const padNow = new Set(res.pairs.filter(x => x.i === i || x.j === i).map(x => x.i === i ? x.j : x.i));
    const padNew = bestD.list.filter(x => x.pad).map(x => +x.name.slice(4));
    if (bestD.hits < conflicts(i) && padNew.every(j => padNow.has(j))){   // may only touch pad wells it already touched
      const obsList = bestD.list.filter(x => !x.pad).map(x => ({ name:x.name, d:x.d, req:x.req, md:x.md }));
      res.wells[i] = Object.assign({}, cur, { r: bestD.r, land: bestD.land, shift:[bestD.shift, 0], kopAdd:0, nudge:null, obs: obsList, deep:{ ms:bestD.ms, nPre:bestD.nPre, smoothed:bestD.r.smoothed || null } });
      res.deep.wells.push(i);
      P = recount();
      // joint pass: a pad well still blocking this one is re-planned next
      bestD.list.filter(x => x.pad).forEach(x => { const j = +x.name.slice(4); if (!queue.includes(j)) queue.push(j); });
    }
    if (conflicts(i) && !queue.includes(i)) queue.push(i);
  }
  P = recount();
  res.wells.forEach((c, i) => { if (c){ let m = Infinity; P.forEach((q, j) => { if (j !== i && q && P[i]) m = Math.min(m, pairD(P[i], q)); }); c.minC2C = m; } });
  res.deep.ms = Date.now() - T0;
  return res;
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


/* ============================================================
   INSERT TANGENT (iPlan wizard, ADDED 2026-10-11)
   No new physics: every curve is a constant-DLS minimum-curvature arc
   (Eqs. 8.33-8.37), orientations along an arc come from the toolface
   relation (Eqs. 8.41-8.49, applyToolfaceBeta), and the "re-solve after"
   option is the existing Curve-Hold-Curve solver. What is new is only
   the bookkeeping + a small least-squares solve:
     1. The scenario is converted to explicit arcs {inc1, az1, cl} (exact).
     2. A hold of length L is inserted at the anchor (MD / TVD / INC,
        starting or ending there). If the anchor is inside a curve, that
        curve is split into arc A (same toolface plane, ends at the anchor)
        + tangent + arc B (from the anchor orientation back to the curve's
        original end orientation).
     3. Optionally a "fixed point" (end of a chosen arc, e.g. the landing)
        is kept at its original N/E/TVD by solving for the user-selected
        free variables (DLS before, DLS after — one shared DLS if both —,
        length of the hold before the curve, length of the hold after the
        tangent, small azimuth change at the end of the curve after the
        tangent) with damped Gauss-Newton (numeric Jacobian). The anchor
        condition is re-applied exactly on every iteration.
     4. Or mode 'chc': everything between the tangent end and the fixed
        point is replaced by a Curve-Hold-Curve that lands on the fixed
        point's original position AND orientation (exact, fully 3D).
   ============================================================ */
const EPS_BETA = 1e-6;

// Toolface (deg, high-side ref) that turns (inc0,az0) into (inc1,az1):
// exact inverse of applyToolfaceBeta (verified to 0 deg error, 2000 random cases).
function toolfaceBetween(inc0, az0, inc1, az1){
  const beta = impliedBetaDeg(inc0, az0, inc1, az1);
  if (beta < EPS_BETA) return { beta: 0, tf: 0 };
  if (inc0 < 1e-7) return { beta, tf: (((az1 - az0) % 360) + 360) % 360 };
  const i = inc0*D2R, a = az0*D2R, t0 = attitudeVector(inc0, az0), t1 = attitudeVector(inc1, az1), cb = Math.cos(beta*D2R);
  const d = [t1[0]-cb*t0[0], t1[1]-cb*t0[1], t1[2]-cb*t0[2]];
  const h = [Math.cos(i)*Math.cos(a), Math.cos(i)*Math.sin(a), -Math.sin(i)], r = [-Math.sin(a), Math.cos(a), 0];
  return { beta, tf: Math.atan2(d[0]*r[0]+d[1]*r[1]+d[2]*r[2], d[0]*h[0]+d[1]*h[1]+d[2]*h[2]) * R2D };
}

// Scenario -> explicit arcs (exact reproduction of computeStations' path).
function toArcs(start, sections){
  const arcs = [];
  let inc = start.inc, az = start.az, md = start.md, tvd = start.tvd;
  (sections || []).forEach(s => {
    const r = resolveSectionEndpoint(inc, az, tvd, md, s);
    if (r.cl > 0){ arcs.push({ inc1: r.endInc, az1: r.endAz, cl: r.cl }); md += r.cl; tvd += r.dTvd; }
    inc = r.endInc; az = r.endAz;
  });
  return arcs;
}
function arcsToSections(arcs){
  return arcs.filter(a => a.cl > 1e-6).map(a => ({ kind:'direct', inc: a.inc1, az: a.az1, cl: a.cl }));
}
// States at the start of every arc and the end of the last one.
function chainArcs(start, arcs){
  const st = [{ md:start.md, tvd:start.tvd, n:start.n, e:start.e, inc:start.inc, az:start.az }];
  arcs.forEach(a => {
    const p = st[st.length-1];
    const mc = a.cl > 0 ? minimumCurvature(p.inc, p.az, a.inc1, a.az1, a.cl) : { dN:0, dE:0, dTVD:0, dls30:0 };
    st.push({ md:p.md + a.cl, tvd:p.tvd + mc.dTVD, n:p.n + mc.dN, e:p.e + mc.dE, inc:a.inc1, az:a.az1, dls30: mc.dls30 || 0 });
  });
  return st;
}
// State at distance s along arc k (attitude slerp + Eqs. 8.33-8.37).
function pointOnArc(st0, arc, s){
  if (s <= 0) return Object.assign({}, st0);
  const beta = impliedBetaDeg(st0.inc, st0.az, arc.inc1, arc.az1);
  let inc, az;
  if (beta < EPS_BETA){ inc = st0.inc; az = st0.az; }
  else {
    const t = s / arc.cl, b = beta*D2R, A = attitudeVector(st0.inc, st0.az), B = attitudeVector(arc.inc1, arc.az1);
    const f1 = Math.sin((1-t)*b)/Math.sin(b), f2 = Math.sin(t*b)/Math.sin(b);
    const v = [A[0]*f1+B[0]*f2, A[1]*f1+B[1]*f2, A[2]*f1+B[2]*f2], nn = Math.hypot(v[0], v[1], v[2]) || 1;
    inc = Math.acos(Math.max(-1, Math.min(1, v[2]/nn)))*R2D; az = Math.atan2(v[1]/nn, v[0]/nn)*R2D; if (az < 0) az += 360;
  }
  const mc = minimumCurvature(st0.inc, st0.az, inc, az, s);
  return { md: st0.md + s, tvd: st0.tvd + mc.dTVD, n: st0.n + mc.dN, e: st0.e + mc.dE, inc, az };
}

// Locate the anchor on the ORIGINAL path: arc index k + distance s into it.
//  anchor: {type:'md'|'tvd'|'inc', value, at:'start'|'end'}, L = tangent length.
//  The tangent orientation is the path orientation at that point, so for
//  "ends at TVD" we solve tvd(s) + L*cos(inc(s)) = value; "ends at MD" uses MD = value - L.
function findAnchor(start, arcs, anchor, L){
  const st = chainArcs(start, arcs);
  const f = (k, s) => {
    const p = pointOnArc(st[k], arcs[k], s);
    if (anchor.type === 'md')  return p.md - (anchor.at === 'end' ? anchor.value - L : anchor.value);
    if (anchor.type === 'tvd') return (anchor.at === 'end' ? p.tvd + L*Math.cos(p.inc*D2R) : p.tvd) - anchor.value;
    return p.inc - anchor.value;
  };
  for (let k = 0; k < arcs.length; k++){
    const N = Math.max(4, Math.ceil(arcs[k].cl / 2));
    let s0 = 0, f0 = f(k, 0);
    if (Math.abs(f0) < 1e-9) return { k, s: 0 };
    for (let j = 1; j <= N; j++){
      const s1 = arcs[k].cl * j / N, f1 = f(k, s1);
      if ((f0 <= 0 && f1 >= 0) || (f0 >= 0 && f1 <= 0)){
        let lo = s0, hi = s1, flo = f0;
        for (let it = 0; it < 60; it++){ const m = (lo+hi)/2, fm = f(k, m); if ((flo <= 0 && fm >= 0) || (flo >= 0 && fm <= 0)) hi = m; else { lo = m; flo = fm; } }
        return { k, s: (lo+hi)/2 };
      }
      s0 = s1; f0 = f1;
    }
  }
  return null;
}

// Build the candidate arc list for given parameter values.
// base: {start, arcs, k, s, anchor, L, cb, ca, hb, ha, fixIdx}; p: {dA, dB, dHb, dHa, dAz}
function buildTangentCandidate(base, p){
  const arcs = base.arcs.map(a => Object.assign({}, a));
  const st0 = chainArcs(base.start, base.arcs);
  if (base.hb != null && p.dHb) arcs[base.hb].cl = Math.max(0, arcs[base.hb].cl + p.dHb);
  if (base.ha != null && p.dHa) arcs[base.ha].cl = Math.max(0, arcs[base.ha].cl + p.dHa);
  const k = base.k, A = base.arcs[k], o0 = st0[k];
  const beta_k = impliedBetaDeg(o0.inc, o0.az, A.inc1, A.az1);
  let out = [], warn = null;
  if (beta_k >= EPS_BETA){
    // Anchor inside a curve: split into A (toolface plane of the original curve) + tangent + B.
    const tf = toolfaceBetween(o0.inc, o0.az, A.inc1, A.az1).tf;
    const dA = (p.dA != null) ? p.dA : beta_k / A.cl * 30;
    const dB = (p.dB != null) ? p.dB : beta_k / A.cl * 30;
    const pre = chainArcs(base.start, arcs.slice(0, k));
    const s0 = pre[pre.length-1];                       // start of the curve (after any hold change)
    const at = (cl) => { const b = dA*cl/30, o = applyToolfaceBeta(s0.inc, s0.az, b, tf);
      const mc = minimumCurvature(s0.inc, s0.az, o.incN, o.azN, cl); return { inc:o.incN, az:o.azN, tvd:s0.tvd + mc.dTVD, md:s0.md + cl }; };
    let clA;
    const an = base.anchor, L = base.L;
    if (an.type === 'inc'){
      const b = betaForTargetInc(s0.inc, tf, an.value);
      if (b === null || !(dA > 0)) return { error: 'Anchor inclination not reachable on this curve' };
      clA = b / dA * 30;
    } else if (an.type === 'md'){
      clA = (an.at === 'end' ? an.value - L : an.value) - s0.md;
    } else {
      const g = cl => { const q = at(cl); return (an.at === 'end' ? q.tvd + L*Math.cos(q.inc*D2R) : q.tvd) - an.value; };
      const maxCl = 180 / Math.max(dA, 1e-6) * 30; let lo = 0, glo = g(0), hi = null;
      for (let j = 1; j <= 400; j++){ const c = maxCl*j/400, gc = g(c); if ((glo <= 0 && gc >= 0) || (glo >= 0 && gc <= 0)){ hi = c; break; } lo = c; glo = gc; }
      if (hi === null) return { error: 'Anchor TVD not reachable on this curve' };
      for (let it = 0; it < 60; it++){ const m = (lo+hi)/2, gm = g(m); if ((glo <= 0 && gm >= 0) || (glo >= 0 && gm <= 0)) hi = m; else { lo = m; glo = gm; } }
      clA = (lo+hi)/2;
    }
    if (!(clA >= -1e-6)) return { error: 'Anchor falls above the start of the curve (would need a negative curve length)' };
    clA = Math.max(0, clA);
    const oa = at(clA);
    if (dA * clA / 30 > beta_k + 1e-6) warn = 'Tangent sits beyond the original end of the curve';
    const endAz = A.az1 + (p.dAz || 0);
    const betaB = impliedBetaDeg(oa.inc, oa.az, A.inc1, endAz);
    if (!(dB > 0)) return { error: 'DLS after must be > 0' };
    const clB = betaB / dB * 30;
    out = arcs.slice(0, k).concat([
      { inc1: oa.inc, az1: oa.az, cl: clA, _role:'A' },
      { inc1: oa.inc, az1: oa.az, cl: L, _role:'T' },
      { inc1: A.inc1, az1: ((endAz % 360) + 360) % 360, cl: clB, _role:'B' }
    ]).concat(arcs.slice(k+1));
    // map fixed-arc index from original to candidate (+2 for the split)
    return { arcs: out, fixIdx: base.fixIdx == null ? null : (base.fixIdx >= k ? base.fixIdx + 2 : base.fixIdx), tangentIdx: k+1, warn };
  }
  // Anchor inside a hold: the hold simply gets L longer; DLS changes act on the
  // nearest curve before (cb) / after (ca), keeping their end orientations.
  [['dA', base.cb], ['dB', base.ca]].forEach(([key, idx]) => {
    if (idx == null || p[key] == null) return;
    const s = chainArcs(base.start, arcs.slice(0, idx)); const q = s[s.length-1];
    const b = impliedBetaDeg(q.inc, q.az, arcs[idx].inc1, arcs[idx].az1);
    arcs[idx].cl = b / p[key] * 30;
  });
  if (p.dAz && base.ca != null) arcs[base.ca].az1 = (((arcs[base.ca].az1 + p.dAz) % 360) + 360) % 360;
  arcs[k].cl += base.L;
  return { arcs, fixIdx: base.fixIdx, tangentIdx: k, warn };
}

// Main entry. opts = {
//   anchor:{type,value,at}, L,
//   fixIdx: index of the ORIGINAL arc whose END must stay put (null = nothing fixed),
//   mode: 'none' | 'solve' | 'chc',
//   free: {dlsBefore, dlsAfter, holdBefore, holdAfter, azAfter}   (mode 'solve'; both DLS ticked = one shared DLS)
//   chc: {dls1, dls2}                                              (mode 'chc')
// } -> { sections, info } or { error }
function insertTangent(start, sections, opts){
  const arcs = toArcs(start, sections);
  if (!arcs.length) return { error: 'Scenario has no sections' };
  const L = +opts.L;
  if (!(L > 0)) return { error: 'Tangent length must be > 0' };
  const loc = findAnchor(start, arcs, opts.anchor, L);
  if (!loc) return { error: 'The anchor ' + opts.anchor.type.toUpperCase() + ' ' + opts.anchor.value + ' is not found on this scenario' };
  const st = chainArcs(start, arcs);
  const isCurve = i => impliedBetaDeg(st[i].inc, st[i].az, arcs[i].inc1, arcs[i].az1) >= EPS_BETA;
  // split exactly at the anchor so the curve/hold containing it starts there
  const k0 = loc.k;
  let cb = null, ca = null, hb = null, ha = null;
  for (let i = k0 - (isCurve(k0) ? 0 : 1); i >= 0; i--) if (isCurve(i)){ cb = i; break; }
  for (let i = k0 + (isCurve(k0) ? 0 : 1); i < arcs.length; i++) if (isCurve(i)){ ca = i; break; }
  if (cb != null) for (let i = cb - 1; i >= 0; i--) if (!isCurve(i)){ hb = i; break; }
  const fixIdx = (opts.mode === 'none' || opts.fixIdx == null) ? null : opts.fixIdx;
  if (fixIdx != null && fixIdx < k0) return { error: 'The fixed point must be below the tangent' };
  for (let i = (isCurve(k0) ? k0 + 1 : k0 + 1); fixIdx != null && i <= fixIdx; i++) if (!isCurve(i)){ ha = i; break; }
  const base = { start, arcs, k: k0, s: loc.s, anchor: opts.anchor, L, cb, ca, hb, ha, fixIdx };
  const fixOrig = fixIdx != null ? st[fixIdx + 1] : null;

  const finish = (cand, extra) => {
    const sec = arcsToSections(cand.arcs);
    const st2 = chainArcs(start, cand.arcs.filter(a => a.cl > 1e-6));
    const end = (cand.fixIdx != null) ? chainArcs(start, cand.arcs)[cand.fixIdx + 1] : null;
    let maxDls = 0; st2.forEach(x => { if (x.dls30 > maxDls) maxDls = x.dls30; });
    return { sections: sec, info: Object.assign({ fixOrig, fixNew: end, miss: (end && fixOrig) ? Math.hypot(end.n-fixOrig.n, end.e-fixOrig.e, end.tvd-fixOrig.tvd) : null,
      maxDls, warn: cand.warn || null }, extra || {}) };
  };

  if (opts.mode === 'chc'){
    if (fixIdx == null) return { error: 'Choose the fixed point to land on' };
    // keep everything down to the tangent end (no compensation), then CHC to the fixed point
    const c0 = buildTangentCandidate(base, {});
    if (c0.error) return c0;
    const upto = c0.arcs.slice(0, c0.tangentIdx + 1);
    const e = chainArcs(start, upto); const endT = e[e.length-1];
    const r = planCurveHoldCurve(endT, { n: fixOrig.n, e: fixOrig.e, tvd: fixOrig.tvd }, fixOrig.inc, fixOrig.az, +opts.chc.dls1, +opts.chc.dls2);
    if (r.error){
      // Not reachable at these DLS values: report the smallest equal DLS that works
      // (scan upward in 0.25 deg/30m steps with the same solver) instead of a bare "no solution".
      let need = null;
      for (let d = Math.max(+opts.chc.dls1, +opts.chc.dls2) + 0.25; d <= 30; d += 0.25){
        const t = planCurveHoldCurve(endT, { n: fixOrig.n, e: fixOrig.e, tvd: fixOrig.tvd }, fixOrig.inc, fixOrig.az, d, d);
        if (!t.error){ need = d; break; }
      }
      return { error: 'Curve-Hold-Curve cannot land on the fixed point at DLS ' + opts.chc.dls1 + ' / ' + opts.chc.dls2 + ' °/30m' +
        (need ? ' — the smallest equal DLS that works is about ' + need.toFixed(2) + ' °/30m.' : ' (no solution up to 30 °/30m).') };
    }
    const tail = base.arcs.slice(fixIdx + 1);
    const mid = []; let cur = { inc: endT.inc, az: endT.az };
    r.sections.forEach(x => { if (x.kind === 'hold') mid.push({ inc1: cur.inc, az1: cur.az, cl: x.cl }); else { mid.push({ inc1: x.inc, az1: x.az, cl: x.cl }); cur = { inc: x.inc, az: x.az }; } });
    const cand = { arcs: upto.concat(mid, tail), fixIdx: upto.length + mid.length - 1, warn: c0.warn };
    return finish(cand, { solved: r.solved });
  }

  const f = opts.free || {};
  const curveK = isCurve(k0);
  const d0A = cb != null ? (st[cb] && impliedBetaDeg(st[cb].inc, st[cb].az, arcs[cb].inc1, arcs[cb].az1) / arcs[cb].cl * 30) : null;
  const d0B = curveK ? d0A : (ca != null ? impliedBetaDeg(st[ca].inc, st[ca].az, arcs[ca].inc1, arcs[ca].az1) / arcs[ca].cl * 30 : null);
  const keys = [];
  const shared = f.dlsBefore && f.dlsAfter;
  if (fixIdx != null && opts.mode === 'solve'){
    if (shared) keys.push('dS'); else { if (f.dlsBefore) keys.push('dA'); if (f.dlsAfter) keys.push('dB'); }
    if (f.holdBefore){ if (hb == null) return { error: 'No hold section above the curve to lengthen/shorten ("trajectory before")' }; keys.push('dHb'); }
    if (f.holdAfter){ if (ha == null) return { error: 'No hold section between the tangent and the fixed point ("trajectory after")' }; keys.push('dHa'); }
    if (f.azAfter) keys.push('dAz');
    if ((f.dlsBefore && d0A == null) || (f.dlsAfter && d0B == null)) return { error: 'No curve found on that side of the tangent' };
  }
  const toP = x => {
    const p = {}; keys.forEach((kk, i) => { p[kk] = x[i]; });
    if (p.dS != null){ p.dA = p.dS; p.dB = p.dS; }
    return p;
  };
  const x0 = keys.map(kk => kk === 'dS' ? (d0A || d0B) : kk === 'dA' ? d0A : kk === 'dB' ? d0B : 0);
  const evalX = x => {
    const c = buildTangentCandidate(base, toP(x));
    if (c.error) return { c, r: null };
    if (c.fixIdx == null) return { c, r: [0,0,0] };
    const e = chainArcs(start, c.arcs)[c.fixIdx + 1];
    return { c, r: [e.n - fixOrig.n, e.e - fixOrig.e, e.tvd - fixOrig.tvd] };
  };
  let x = x0.slice(), cur = evalX(x);
  if (cur.c.error) return { error: cur.c.error };
  if (keys.length){
    let lambda = 1e-3;
    const norm = r => Math.hypot(r[0], r[1], r[2]);
    for (let it = 0; it < 200 && norm(cur.r) > 1e-7; it++){
      const J = [[],[],[]];
      keys.forEach((kk, j) => {
        const h = (kk === 'dAz') ? 1e-4 : (kk[0] === 'd' && kk !== 'dHb' && kk !== 'dHa') ? 1e-5 : 1e-4;
        const xp = x.slice(); xp[j] += h; const ep = evalX(xp);
        for (let i = 0; i < 3; i++) J[i][j] = ep.r ? (ep.r[i] - cur.r[i]) / h : 0;
      });
      // (J^T J + lambda diag) dx = -J^T r
      const m = keys.length, JTJ = [], JTr = [];
      for (let a = 0; a < m; a++){ JTr[a] = 0; JTJ[a] = []; for (let b = 0; b < m; b++){ let sum = 0; for (let i = 0; i < 3; i++) sum += J[i][a]*J[i][b]; JTJ[a][b] = sum; } for (let i = 0; i < 3; i++) JTr[a] += J[i][a]*cur.r[i]; }
      let accepted = false;
      for (let tries = 0; tries < 12 && !accepted; tries++){
        const M = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? lambda*(v || 1) : 0)));
        const dx = solveLinear(M, JTr.map(v => -v));
        if (!dx){ lambda *= 10; continue; }
        const xn = x.map((v, i) => v + dx[i]);
        keys.forEach((kk, i) => { if (kk === 'dA' || kk === 'dB' || kk === 'dS') xn[i] = Math.max(0.05, xn[i]); });
        const en = evalX(xn);
        if (en.r && norm(en.r) < norm(cur.r)){ x = xn; cur = en; lambda = Math.max(1e-9, lambda/10); accepted = true; }
        else lambda *= 10;
      }
      if (!accepted) break;
    }
  }
  const p = toP(x);
  return finish(cur.c, { params: p, keys, d0A, d0B, residual: cur.r ? Math.hypot(cur.r[0], cur.r[1], cur.r[2]) : null });
}
function solveLinear(A, b){
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let i = 0; i < n; i++){
    let piv = i; for (let k = i+1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    if (Math.abs(M[piv][i]) < 1e-14) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let k = i+1; k < n; k++){ const fct = M[k][i]/M[i][i]; for (let c = i; c <= n; c++) M[k][c] -= fct*M[i][c]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--){ let s = M[i][n]; for (let c = i+1; c < n; c++) s -= M[i][c]*x[c]; x[i] = s/M[i][i]; }
  return x;
}


/* ============================================================
   iPad — pad template solver (ADDED 2026-10-12)
   Template (vertical -> KOP -> curve 1 -> tangent -> curve 2 -> land -> lateral):
     hold KOP | arc from vertical to (incT, azT) at DLS1 | hold Lt at (incT, azT)
     | arc (incT, azT) -> (landing Inc, landing Az) at DLS2 | hold lateral.
   Every arc is a constant-DLS minimum-curvature arc (Eqs. 8.33-8.37);
   from vertical any azimuth is reachable, so curve 1 builds AND turns
   toward the landing (azT is free). Landing must be hit in N, E and TVD:
   3 equations -> exactly 3 unknowns per mode (azT always + 2 more):
     'kop_dls_len' : KOP fixed           -> solve shared DLS, tangent length
     'kop_dls12'   : KOP & tangent fixed -> solve DLS1, DLS2
     'dls_kop_len' : DLS fixed (shared)  -> solve KOP, tangent length
   Solved with damped Gauss-Newton (numeric Jacobian) from several starts;
   a well is "ok" only if the landing miss < 1 mm and all lengths/DLS are
   physical (KOP >= 0, tangent >= 0, DLS > 0).
   ============================================================ */
function padSections(p, land, lateral){
  const b2 = impliedBetaDeg(p.incT, p.azT, land.inc, land.az);
  const s = [];
  if (p.kop > 1e-6) s.push({ kind:'hold', cl: p.kop });
  s.push({ kind:'direct', inc: p.incT, az: p.azT, cl: p.incT * 30 / p.dls1 });
  if (p.lt > 1e-6) s.push({ kind:'direct', inc: p.incT, az: p.azT, cl: p.lt });
  if (b2 > 1e-9) s.push({ kind:'direct', inc: land.inc, az: land.az, cl: b2 * 30 / p.dls2 });
  if (lateral > 1e-6) s.push({ kind:'direct', inc: land.inc, az: land.az, cl: lateral });
  return s;
}
// landing state for parameter set p (surface at md 0, tvd 0, vertical)
function padLanding(surf, p, land){
  const arcs = padSections(p, land, 0).map(x => ({ inc1: x.inc === undefined ? 0 : x.inc, az1: x.az === undefined ? 0 : x.az, cl: x.cl }));
  const st = chainArcs({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, arcs);
  return st[st.length - 1];
}

/* ============================================================
   iPad template "turn early" (ADDED 2026-10-12, after John's first pad test)
   WHY: the first template's curve 1 is a single planar arc from vertical, so
   the tangent points wherever that plane points and curve 2 must build to 90°
   AND swing back to the lateral azimuth near horizontal — where turning is
   most expensive. On John's pad (S01..S03 -> T01..T03, Az 181.56) that needed
   DLS 13 / 18.8 / 37.3 °/30m, while his hand-designed wells do it under 10.
   FIX (matches how he designs): KOP -> curve A (build in its own direction
   azA to incA) -> curve B (build AND turn onto the lateral azimuth, ending at
   the first tangent inclination) -> tangents [inc_k, L_k] all ON the lateral
   azimuth, joined by pure-build curves -> (curve to landing Inc if needed) ->
   landing / ICP -> lateral. Same DLS on every curve. Solved: incA, azA, DLS
   (3 unknowns for the 3 landing equations N/E/TVD); when several exact
   solutions exist the one with the smallest DLS is kept.
   Same verified pieces as everything else (min curvature Eqs. 8.33-8.37).
   Result on John's W01..W03: DLS 8.18 / 8.30 / 8.26, landing miss < 1e-9 m.
   ============================================================ */
function padTurnSections(kop, incA, azA, dls, tangents, land, lateral){
  const s = [];
  if (kop > 1e-6) s.push({ kind:'direct', inc:0, az:0, cl:kop });
  s.push({ kind:'direct', inc:incA, az:azA, cl: incA * 30 / dls });
  let cur = { inc:incA, az:azA };
  (tangents || []).forEach(t => {
    const b = impliedBetaDeg(cur.inc, cur.az, t.inc, land.az);
    if (b > 1e-9) s.push({ kind:'direct', inc:t.inc, az:land.az, cl: b * 30 / dls });
    if (t.L > 1e-6) s.push({ kind:'direct', inc:t.inc, az:land.az, cl: t.L });
    cur = { inc:t.inc, az:land.az };
  });
  const bl = impliedBetaDeg(cur.inc, cur.az, land.inc, land.az);
  if (bl > 1e-9) s.push({ kind:'direct', inc:land.inc, az:land.az, cl: bl * 30 / dls });
  if (lateral > 1e-6) s.push({ kind:'direct', inc:land.inc, az:land.az, cl: lateral });
  return s;
}
function padTurnEnd(surf, kop, incA, azA, dls, tangents, land){
  const a = padTurnSections(kop, incA, azA, dls, tangents, land, 0).map(x => ({ inc1:x.inc, az1:x.az, cl:x.cl }));
  const st = chainArcs({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, a);
  return st[st.length - 1];
}
function padSolveTurn(surf, land, tpl){
  const tangents = (tpl.tangents && tpl.tangents.length) ? tpl.tangents : [{ inc: tpl.incT || 83, L: tpl.lt || 30 }];
  const incMax = tangents[0].inc;
  const kop = tpl.kop;
  const r = x => {
    if (!(x[2] > 0.3) || !(x[0] > 0.5) || x[0] > incMax) return null;
    const e = padTurnEnd(surf, kop, x[0], x[1], x[2], tangents, land);
    return [e.n - land.n, e.e - land.e, e.tvd - land.tvd];
  };
  const norm = v => Math.hypot(v[0], v[1], v[2]);
  const brg = (((Math.atan2(land.e - surf.e, land.n - surf.n) * R2D) % 360) + 360) % 360;
  let best = null, closest = null;
  for (const i0 of [10, 20, 35, 50, 65]) for (const da of [-90, -60, -30, 0, 30, 60, 90]) for (const d0 of [3, 5, 7, 9]){
    let x = [Math.min(i0, incMax - 1), brg + da, d0], f = r(x); if (!f) continue;
    let lam = 1e-3;
    for (let it = 0; it < 200 && norm(f) > 1e-9; it++){
      const J = [[],[],[]]; let bad = false;
      for (let j = 0; j < 3; j++){ const xp = x.slice(); xp[j] += 1e-6; const fp = r(xp); if (!fp){ bad = true; break; } for (let i = 0; i < 3; i++) J[i][j] = (fp[i] - f[i]) / 1e-6; }
      if (bad) break;
      const JTJ = [0,1,2].map(a => [0,1,2].map(b => J[0][a]*J[0][b] + J[1][a]*J[1][b] + J[2][a]*J[2][b]));
      const JTr = [0,1,2].map(a => J[0][a]*f[0] + J[1][a]*f[1] + J[2][a]*f[2]);
      let ok = false;
      for (let t = 0; t < 10 && !ok; t++){
        const M = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v || 1) : 0)));
        const dx = solveLinear(M, JTr.map(v => -v)); if (!dx){ lam *= 10; continue; }
        const xn = x.map((v, i) => v + dx[i]), fn = r(xn);
        if (fn && norm(fn) < norm(f)){ x = xn; f = fn; lam = Math.max(1e-12, lam / 10); ok = true; } else lam *= 10;
      }
      if (!ok) break;
    }
    const m = norm(f);
    if (!closest || m < closest.m) closest = { m, x };
    if (m < 1e-6 && (!best || x[2] < best.x[2])) best = { m, x };
  }
  const pick = best || closest;
  if (!pick) return { ok:false, error:'No solution' };
  const [incA, azA0, dls] = pick.x, azA = ((azA0 % 360) + 360) % 360;
  const sections = padTurnSections(kop, incA, azA, dls, tangents, land, tpl.lateral || 0);
  return { ok: !!best, miss: pick.m, sections, maxDls: dls,
           params: { kop, incA, azA, dls1: dls, dls2: dls, incT: tangents[0].inc, lt: tangents[0].L, azT: land.az, tangents },
           error: best ? null : 'Landing not reachable with this KOP / tangents (closest miss ' + pick.m.toFixed(2) + ' m) — try a shallower KOP or shorter tangents' };
}

/* ============================================================
   iPad template "Back-projected from ICP" (ADDED 2026-10-31, John)
   WHY: validation against John's hand-designed pad 163 (P3-2316, 25 wells)
   showed the "turn early" template has no free length, so far step-outs
   (W20-W25) could not land (miss 6-147 m). John designs in Compass BACKWARDS
   from the ICP; this template reproduces his procedure:
     vertical to KOP (surface casing + 20 m)
     -> "optimum align": curve (from vertical) - HOLD (free length) - curve, one DLS
     -> tangent 1 (Inc range, length >= min, azimuth FREE)
     -> curve (build + turn) -> tangent 2 (Inc range, length >= min, ON lateral az)
     -> final curve (own DLS range) to the ICP attitude (landing Inc / lateral Az).
   Tangents 1/2 and the curves between them are back-projected from the ICP
   (minimum-curvature arcs, Eqs. 8.33-8.37, run in reverse: start = end - displacement).
   The optimum align is solved forward (3 unknowns: curve Inc, curve Az, hold
   length; 3 equations: N, E, TVD of the top of tangent 1) by damped Gauss-Newton.
   Ranges (min-max) are the "design freedoms"; the free values are searched on a
   grid (Inc ranges at min/mid/max, DLS every 0.5 deg/30 m, tangent-1 azimuth
   every 5 deg then refined to 0.5 deg) and the result is picked by tpl.objective:
     'short'   = shortest MD to the ICP (then lowest DLS)
     'smooth'  = lowest max DLS (then shortest MD)
     'typical' = closest to the middle of every range (then shortest MD)
   Tangent lengths use their minimum (longer tangents only lengthen the well).
   Delta TVD (ICP TVD - TVD at the bottom of tangent 2) must fall in its range.
   Prototype result on pad 163 (John's KOPs, DLS 7-9, final 5, T1 70-75, T2 80-85,
   'short'): all 25 wells land exactly (W20-W25 included); average distance to his
   hand path 5-26 m (far wells 10-20 m, was 46-131 m with "turn early").
   ============================================================ */
function padBackChain(icp, lat, landInc, p){
  const back = (P, a0, a1, cl) => { if (!(cl > 0)) return Object.assign({}, P);
    const m = minimumCurvature(a0.inc, a0.az, a1.inc, a1.az, cl); return { n:P.n - m.dN, e:P.e - m.dE, tvd:P.tvd - m.dTVD }; };
  const aI = { inc:landInc, az:lat }, aT2 = { inc:p.t2inc, az:lat }, aT1 = { inc:p.t1inc, az:p.t1az };
  const clF = impliedBetaDeg(aT2.inc, aT2.az, aI.inc, aI.az) * 30 / p.dF;
  const B2 = back(icp, aT2, aI, clF);           // bottom of tangent 2 (start of final curve)
  const T2 = back(B2, aT2, aT2, p.L2);           // top of tangent 2
  const clM = impliedBetaDeg(aT1.inc, aT1.az, aT2.inc, aT2.az) * 30 / p.dM;
  const B1 = back(T2, aT1, aT2, clM);            // bottom of tangent 1
  const A  = back(B1, aT1, aT1, p.L1);           // top of tangent 1
  return { A, B1, B2, clF, clM, len: clF + p.L2 + clM + p.L1 };
}
// optimum align: from (kop point, vertical) to A with attitude aT1; x = [incH, azH, hold]
// 2026-10-31: kopPt may carry inc/az (AC nudge: the well is already inclined at KOP); default vertical.
function padAlign(kopPt, A, aT1, d, x0){
  const i0 = kopPt.inc || 0, a0 = kopPt.az || 0;
  const run = x => {
    if (!(x[0] > 0.2) || x[0] > 100 || x[2] < 0) return null;
    const arcs = [{ inc1:x[0], az1:x[1], cl: impliedBetaDeg(i0, a0, x[0], x[1]) * 30 / d }, { inc1:x[0], az1:x[1], cl:x[2] },
                  { inc1:aT1.inc, az1:aT1.az, cl: impliedBetaDeg(x[0], x[1], aT1.inc, aT1.az) * 30 / d }];
    const st = chainArcs({ md:0, tvd:kopPt.tvd, n:kopPt.n, e:kopPt.e, inc:i0, az:a0 }, arcs), e = st[st.length - 1];
    return { f:[e.n - A.n, e.e - A.e, e.tvd - A.tvd], len:e.md };
  };
  const nrm = v => Math.hypot(v[0], v[1], v[2]);
  const lm = x => { let R = run(x); if (!R) return null; let f = R.f, lam = 1e-3;
    for (let it = 0; it < 60 && nrm(f) > 1e-7; it++){
      const J = [[],[],[]];
      for (let j = 0; j < 3; j++){ const xp = x.slice(); xp[j] += 1e-6; const Rp = run(xp); if (!Rp) return null; for (let i = 0; i < 3; i++) J[i][j] = (Rp.f[i] - f[i]) / 1e-6; }
      const JTJ = [0,1,2].map(a => [0,1,2].map(b => J[0][a]*J[0][b] + J[1][a]*J[1][b] + J[2][a]*J[2][b]));
      const JTr = [0,1,2].map(a => J[0][a]*f[0] + J[1][a]*f[1] + J[2][a]*f[2]);
      let ok = false;
      for (let t = 0; t < 10 && !ok; t++){
        const M = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v || 1) : 0)));
        const dx = solveLinear(M, JTr.map(v => -v)); if (!dx){ lam *= 10; continue; }
        const xn = x.map((v, i) => v + dx[i]), Rn = run(xn);
        if (Rn && nrm(Rn.f) < nrm(f)){ x = xn; f = Rn.f; lam = Math.max(1e-12, lam / 10); ok = true; } else lam *= 10;
      }
      if (!ok) break;
    }
    return nrm(f) < 1e-5 ? { x, len: run(x).len } : null; };
  if (x0){ const r = lm(x0.slice()); if (r) return r; }
  const brg = (((Math.atan2(A.e - kopPt.e, A.n - kopPt.n) * R2D) % 360) + 360) % 360;
  let best = null;
  for (const g0 of [35, 60]) for (const da of [0]) for (const H0 of [0, 150, 400]){
    const r = lm([g0, brg + da, H0]); if (r && (!best || r.len < best.len)) best = r;
  }
  return best;
}
// opts.collect = K (ADDED 2026-10-31, iPad Avoidance): instead of the single best design, return up to K
// valid alternative designs (all inside the same ranges, all landing exactly on the ICP), best first by the
// objective, made diverse (distinct T1 Inc / T2 Inc / DLS / final DLS / T1 azimuth to 5 deg).

/* ADDED 2026-11-01 (John): DESIGN RULES — restrictions on the trajectory itself (not ranges of a template).
   John's rules (2026-11-01):
   - NO NUDGE above incMin (default ON, 10 deg): a nudge = build, optional tangent, then drop. Above near-vertical
     the inclination may only build or hold down to the ICP; a drop of more than tol (0.5 deg) after a peak
     above incMin is a violation, unless the peak lies inside a user window [a, b] where nudges are allowed.
     Near-vertical nudges (peak <= incMin, e.g. the AC nudge) are allowed. The LATERAL is excluded (lateral
     avoidance turns in azimuth at 90 deg and is allowed — John).
   - MAX TURN (default ON, 90 deg): azimuth range (unwrapped max - min) from where Inc >= 3 deg to the ICP.
     Turning at high inclination is allowed within it.
   - FORMATION ZONES (Sub-Sea top / base, any number): max DLS, min / max Inc, optional no-drop, whole well.
   When no design satisfies them the solver keeps the design with the FEWEST violations and flags it (John).
   rules = { noNudge:{on, incMin, tol, windows:[{a,b}]}, maxTurn:{on, deg}, zones:[{name, top, base, dlsMax, incMin, incMax, noDrop}] }
   st = stations [{md, inc, az, tvd, dls30}], ss = surface Sub-Sea (RKB elev.; Sub-Sea = ss - TVD), landMd = ICP MD. */
// ADDED 2026-11-06: applies padOaGroup to a back-projected result carrying r._oaIn (in place; returns r).
function padOaFinalize(r){
  if (!r || !r._oaIn || r.oaPlan || r.oaFallback) return r;
  const I = r._oaIn, oaRes = padOaGroup(I.kopPt, I.p, I.x, I.azH, I.icp, I.landInc, I.lat, I.surf), tags = r.tags, sections = r.sections;
  if (oaRes.ok){
    const isPre = t => t === 'kop' || t === 'nudge' || t === 'nudgeHold' || t === 'pre';   // 'pre' = Deep search tree rows
    const preS = sections.filter((_, i) => isPre(tags[i])), latS = sections.filter((_, i) => tags[i] === 'lateral');
    r.sections = preS.concat(oaRes.sections, latS);
    r.tags = tags.filter(isPre).concat(oaRes.tags, tags.filter(t => t === 'lateral'));
    r.oaPlan = { pre: preS, def: oaRes.def, post: latS };
  } else r.oaFallback = oaRes.why;
  delete r._oaIn; return r;
}
// ADDED 2026-11-06: iPad back-projected design -> iPlan Optimum Align group (see buildRes in padSolveBackOne).
function padOaGroup(kopPt, p, x, azH, icp, landInc, lat, surf){
  const def = { type:'chc', mode:'dls', ccMode:'eq', dls1:p.dC, dls2:p.dC, L:0, tvd1:0, tvd2:0,
    target:{ name:'ICP', n:icp.n, e:icp.e, ss:(+surf.rkb || 0) - icp.tvd, inc:landInc, az:lat },
    back:[ { mode:'incazi', inc:p.t2inc, az:lat, dls:p.dF }, { mode:'cl', cl:p.L2, dls:0 }, { mode:'incazi', inc:p.t1inc, az:p.t1az, dls:p.dM }, { mode:'cl', cl:p.L1, dls:0 } ] };
  let T = { n:icp.n, e:icp.e, tvd:icp.tvd }, inc = landInc, az = lat; const back = [];
  for (const b of def.back){ const pr = projectBack(T, inc, az, b); if (pr.error) return { ok:false, why:'project back: ' + pr.error }; back.push(pr); T = { n:pr.P.n, e:pr.P.e, tvd:pr.P.tvd }; inc = pr.P.inc; az = pr.P.az; }
  const r = planOptimumAlign({ md:0, tvd:kopPt.tvd, n:kopPt.n, e:kopPt.e, inc:kopPt.inc || 0, az:kopPt.az || 0 }, T, inc, az, { type:'chc', mode:'dls', dls1:p.dC, dls2:p.dC });
  if (r.error) return { ok:false, why:'optimum align: ' + r.error };
  const S = r.solved, dAz = Math.abs(((S.az1 - azH) % 360 + 540) % 360 - 180);
  if (Math.abs(S.inc1 - x[0]) > 0.5 || dAz > 0.5 || Math.abs(S.L - x[2]) > 1) return { ok:false, why:'optimum align found another solution (Inc ' + S.inc1.toFixed(1) + ' / Az ' + S.az1.toFixed(1) + ' / hold ' + S.L.toFixed(1) + ')' };
  const secs = r.sections.slice(), tags = [];
  // tags for the export comments: same names as before
  const nA = secs.length; secs.forEach((s0, i) => tags.push(nA === 3 ? ['align1','alignHold','align2'][i] : s0.kind === 'hold' ? 'alignHold' : i === 0 ? 'align1' : 'align2'));
  const tagB = ['final','t2','mid','t1'];
  for (let k = back.length - 1; k >= 0; k--) if (back[k].sec && back[k].cl > 1e-6){ secs.push(back[k].sec); tags.push(tagB[k]); }
  const st = computeStations({ md:0, tvd:kopPt.tvd, n:kopPt.n, e:kopPt.e, inc:kopPt.inc || 0, az:kopPt.az || 0 }, secs, 1e6).stations, E = st[st.length - 1];
  const miss = Math.hypot(E.n - icp.n, E.e - icp.e, E.tvd - icp.tvd);
  if (miss > 0.05) return { ok:false, why:'misses the ICP by ' + miss.toFixed(3) + ' m' };
  def.last = S;
  return { ok:true, def, sections: secs, tags };
}
function padRulesActive(R){ return !!R && ((R.noNudge && R.noNudge.on) || (R.maxTurn && R.maxTurn.on) || (R.zones || []).some(z => z && z.on !== false)); }
function padRuleCheck(st, R, ss, landMd){
  const out = []; if (!R || !st || !st.length) return out;
  const end = landMd != null ? landMd + 1e-6 : Infinity, build = st.filter(p => p.md <= end);
  const nn = R.noNudge;
  if (nn && nn.on){
    const incMin = nn.incMin != null ? +nn.incMin : 10, tol = nn.tol != null ? +nn.tol : 0.5, W = nn.windows || [];
    // CHANGED 2026-11-01 (John: W24 88 -> 80 -> 90 passed with "drop tolerance" 10): the drop is now measured
    // at SECTION ENDS (stations carry .section), not station by station. A pure turn at constant DLS dips Inc
    // inside the arc (~2 deg on pad 163 W2) but ends where it should, so it is not seen as a drop; a real
    // drop (build / hold, then a section that ENDS lower) is. So the tolerance can stay small (default 0.5 deg).
    // Fallback when stations have no .section: station by station as before.
    const pts = [];
    if (build.some(p => p.section != null)){
      for (let i = 0; i < build.length; i++){ const nx = build[i + 1]; if (!nx || nx.section !== build[i].section) pts.push(build[i]); }
    } else build.forEach(p => pts.push(p));
    let peak = -1, peakMd = 0, low = null;
    const flush = () => { if (low && !W.some(w => peak >= +w.a - 1e-6 && peak <= +w.b + 1e-6))
      out.push({ rule:'noNudge', md: low.startMd, msg: 'Nudge at high Inc: ' + peak.toFixed(1) + '° → ' + low.inc.toFixed(1) + '° (MD ' + peakMd.toFixed(0) + '–' + low.md.toFixed(0) + ')' }); low = null; };
    pts.forEach(p => {
      if (p.inc > peak + 1e-9){ if (low){ flush(); } peak = p.inc; peakMd = p.md; return; }
      if (peak > incMin && p.inc < peak - tol){ if (!low) low = { startMd: p.md, inc: p.inc, md: p.md }; else if (p.inc < low.inc){ low.inc = p.inc; low.md = p.md; } }
    });
    flush();
  }
  const mt = R.maxTurn;
  if (mt && mt.on){
    let prev = null, acc = 0, mn = 0, mx = 0, at = null;
    build.forEach(p => { if (p.inc < 3) return; if (prev == null){ prev = p.az; at = p.md; return; }
      let d = p.az - prev; d = ((d + 540) % 360) - 180; acc += d; prev = p.az; mn = Math.min(mn, acc); mx = Math.max(mx, acc); });
    if (mx - mn > (+mt.deg || 90) + 1e-6) out.push({ rule:'maxTurn', md: at || 0, msg: 'Turn ' + (mx - mn).toFixed(1) + '° > max ' + (+mt.deg || 90) + '°' });
  }
  (R.zones || []).forEach(z => {
    if (!z || z.on === false) return;
    const hi = Math.max(+z.top, +z.base), lo = Math.min(+z.top, +z.base), nm = z.name || 'Zone';
    const inZ = st.filter(p => { const el = ss - p.tvd; return el <= hi + 1e-6 && el >= lo - 1e-6; });
    if (!inZ.length) return;
    const tol = 0.5;
    if (z.dlsMax != null && z.dlsMax !== '' && isFinite(+z.dlsMax)){ const b = inZ.find(p => (p.dls30 || 0) > +z.dlsMax + 0.01); if (b) out.push({ rule:'zoneDls', md:b.md, msg: nm + ': DLS ' + b.dls30.toFixed(2) + ' > ' + (+z.dlsMax) + ' at MD ' + b.md.toFixed(0) }); }
    if (z.incMin != null && z.incMin !== '' && isFinite(+z.incMin)){ const b = inZ.find(p => p.inc < +z.incMin - 0.05); if (b) out.push({ rule:'zoneInc', md:b.md, msg: nm + ': Inc ' + b.inc.toFixed(1) + ' < ' + (+z.incMin) + ' at MD ' + b.md.toFixed(0) }); }
    if (z.incMax != null && z.incMax !== '' && isFinite(+z.incMax)){ const b = inZ.find(p => p.inc > +z.incMax + 0.05); if (b) out.push({ rule:'zoneInc', md:b.md, msg: nm + ': Inc ' + b.inc.toFixed(1) + ' > ' + (+z.incMax) + ' at MD ' + b.md.toFixed(0) }); }
    if (z.noDrop){ let pk = -1; const b = inZ.find(p => { if (p.inc > pk) pk = p.inc; return p.inc < pk - tol; }); if (b) out.push({ rule:'zoneDrop', md:b.md, msg: nm + ': Inc drop at MD ' + b.md.toFixed(0) }); }
  });
  return out;
}
// ADDED 2026-11-01 (John: no nudge above 10 deg). Pad 163 test (SC 130, KOP 150 + stagger 40): with the
// rules on, the far-west wells (W19-W25) had no rule-clean design — from a 150-190 m KOP the align curve must
// overshoot T1 (e.g. 85 -> 75 deg) to reach their ICP displacement. Tried first: lengthening T1 (it is
// "length >=") — made it WORSE (T1 start moves up, align gets steeper; W24: 85 -> 100 deg), removed.
// What works is a SHALLOWER KOP (W19: KOP 190 -> 150 gives a clean design; W24 needs ~100 m).
// So when the rules are on and the design breaks them, the KOP is raised in 10 m steps down to tpl.kopMin
// (iPad passes surface casing + 20 m); the first clean design wins, else the fewest violations (flagged).
function padSolveBack(surf, land, tpl, opts){
  const one = padSolveBackOne(surf, land, tpl, opts);
  if (!padRulesActive(tpl.rules) || tpl._noKopRetry) return one;   // 2026-11-01: T1 lever works without a kopMin too
  const K = opts && opts.collect ? +opts.collect : 0, clean = r => r && r.ok && !(r.violations || []).length;
  let res = K ? one.slice() : one;
  const enough = () => K ? res.filter(clean).length >= Math.min(K, 5) : clean(res);
  if (enough()) return res;
  // ADDED 2026-11-01 (John: "yes please add that lever"): T1 Inc raised for THIS well only, in 2.5 deg steps
  // above the T1 max, never above T2 min (T1 > T2 would itself be a drop = nudge), each tried at the template KOP
  // and then with the KOP raise. Tested pad 163 W22-W25: T1 75 -> 80 makes all four rule-clean.
  const bk = Object.assign({ t1Min:70, t1Max:75, t2Min:80 }, tpl.back || {}), t1s = [null];
  for (let v = +bk.t1Max + 2.5; v <= +bk.t2Min + 1e-6; v += 2.5) t1s.push(+v.toFixed(2));
  if (t1s[t1s.length - 1] !== null && t1s[t1s.length - 1] < +bk.t2Min - 1e-6) t1s.push(+bk.t2Min);
  const tries = []; t1s.forEach(v => { if (v != null) tries.push({ kop: tpl.kop, t1: v }); for (let kop = tpl.kop - 10; kop >= tpl.kopMin - 1e-6; kop -= 10) tries.push({ kop, t1: v }); });
  for (const tr of tries){
    const kop = tr.kop, tb = tr.t1 != null ? Object.assign({}, tpl.back || {}, { t1Min: tr.t1, t1Max: tr.t1 }) : tpl.back;
    const r = padSolveBackOne(surf, land, Object.assign({}, tpl, { kop, back: tb, _noKopRetry: true }), opts);
    const tagE = x => { if (x && x.ok) x.edges = (x.edges || []).concat([(tr.t1 != null ? 'T1 raised to ' + tr.t1 + '° ' : '') + (kop !== tpl.kop ? 'KOP raised to ' + kop.toFixed(0) + ' m ' : '') + '(design rules)']); return x; };
    if (K){ const add = r.filter(clean).map(tagE); res = res.filter(clean).concat(add, res.filter(x => !clean(x))).slice(0, K); }
    else if (clean(r)) res = tagE(r);
    else if (r && r.ok && (!res.ok || (r.violations || []).length < (res.violations || []).length)) res = tagE(r);
    if (enough()) break;
  }
  return res;
}
function padSolveBackOne(surf, land, tpl, opts){
  // 2026-11-01: design rules (tpl.rules) — candidates are checked on their stations; the pool is always kept then
  const useRules = padRulesActive(tpl.rules), rulesSS = surf.rkb != null ? +surf.rkb : (+tpl.rkb || 0);
  const collectK = opts && opts.collect ? +opts.collect : 0, pool = [], keepPool = collectK || useRules;
  // CHANGED 2026-10-31 (John): each pump tangent has its own Delta TVD range (ICP TVD - TVD at the BOTTOM
  // of that tangent): lower tangent T2 (near ICP, e.g. 80-85 deg) 5-8 m, upper tangent T1 (70-75 deg) 28-38 m.
  // Confirmed on his pad 163 wells: bottom of the 80 deg tangent 5.0-6.5 m, of the 75 deg tangent 25-36 m.
  // Replaces the single dTvdMin/Max (applied to T2 only), still accepted for older settings.
  const b = Object.assign({ t1Min:70, t1Max:75, t2Min:80, t2Max:85, L1:30, L2:30, dMin:6, dMax:9, dFMin:4, dFMax:6,
                            dTvd1Min:28, dTvd1Max:38, dTvd2Min:5, dTvd2Max:8, objective:'short' }, tpl.back || {});
  if (tpl.back && tpl.back.dTvdMin != null && tpl.back.dTvd2Min == null){ b.dTvd2Min = tpl.back.dTvdMin; b.dTvd2Max = tpl.back.dTvdMax; }
  const lat = land.az, landInc = land.inc || 90, kop = tpl.kop;
  const icp = { n:land.n, e:land.e, tvd:land.tvd };
  // ADDED 2026-10-31 (John): AC nudge (Design Codes "AC Nudges": KOP ~50 m TVD, build & hold, 4 deg/30 m):
  // tpl.nudge = {kop, dls, inc, az}: vertical to nudge KOP -> build to (inc, az) at dls -> hold to the main
  // KOP; the optimum align then starts from that inclined state instead of vertical.
  let pre = null, kopPt = { n:surf.n, e:surf.e, tvd:kop, inc:0, az:0 };
  const nd = tpl.nudge;
  if (nd && nd.inc > 0){
    const bl = nd.inc * 30 / nd.dls, hold = kop - nd.kop - bl;
    if (!(nd.kop >= 0) || hold < -1e-6) return opts && opts.collect ? [] : { ok:false, sections:null, error:'Nudge does not fit above the KOP' };
    pre = [{ tag:'kop', sec:{ kind:'direct', inc:0, az:0, cl:nd.kop } }, { tag:'nudge', sec:{ kind:'direct', inc:nd.inc, az:nd.az, cl:bl } }];
    if (hold > 1e-6) pre.push({ tag:'nudgeHold', sec:{ kind:'direct', inc:nd.inc, az:nd.az, cl:hold } });
    const st = chainArcs({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, pre.map(x => ({ inc1:x.sec.inc, az1:x.sec.az, cl:x.sec.cl })));
    const e = st[st.length - 1]; kopPt = { n:e.n, e:e.e, tvd:e.tvd, inc:nd.inc, az:nd.az };
  }
  // ADDED 2026-11-06 (iPad Deep search, RRT): tpl.preSecs = an arbitrary drilled path from surface (the tree's
  // branch); the back-projected design starts at its end state (kopPt) instead of the vertical KOP / nudge.
  if (tpl.preSecs && tpl.preSecs.length){
    pre = tpl.preSecs.map(x => ({ tag:'pre', sec:x }));
    const st = computeStations({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, tpl.preSecs, 1e6).stations, e = st[st.length - 1];
    kopPt = { n:e.n, e:e.e, tvd:e.tvd, inc:e.inc, az:e.az };
  }
  const span = (a, z, k) => { a = +a; z = +z; if (!(z > a)) return [a]; const out = []; for (let i = 0; i < k; i++) out.push(a + (z - a) * i / (k - 1)); return out; };
  const steps = (a, z, s) => { a = +a; z = +z; if (!(z > a)) return [a]; const out = []; for (let v = a; v < z - 1e-9; v += s) out.push(v); out.push(z); return out; };
  const T1 = span(b.t1Min, b.t1Max, 3), T2 = span(b.t2Min, b.t2Max, 3), DC = steps(b.dMin, b.dMax, 1), DF = span(b.dFMin, b.dFMax, 3);
  const mid = (a, z) => (+a + +z) / 2, rng = (a, z) => Math.max(1e-9, +z - +a);
  const score = c => b.objective === 'smooth' ? [Math.max(c.p.dC, c.p.dF), c.md]
                   : b.objective === 'typical' ? [Math.abs(c.p.t1inc - mid(b.t1Min, b.t1Max)) / rng(b.t1Min, b.t1Max) + Math.abs(c.p.t2inc - mid(b.t2Min, b.t2Max)) / rng(b.t2Min, b.t2Max)
                                                  + Math.abs(c.p.dC - mid(b.dMin, b.dMax)) / rng(b.dMin, b.dMax) + Math.abs(c.p.dF - mid(b.dFMin, b.dFMax)) / rng(b.dFMin, b.dFMax), c.md]
                   : [c.md, Math.max(c.p.dC, c.p.dF)];
  const better = (c, o) => { if (!o) return true; const s1 = score(c), s2 = score(o); return s1[0] < s2[0] - 1e-6 || (Math.abs(s1[0] - s2[0]) <= 1e-6 && s1[1] < s2[1] - 1e-6); };
  let best = null, reasons = { dtvd:0, align:0 };
  const tryOne = (p0, x0) => {
    const p = Object.assign({}, p0);
    let bc = padBackChain(icp, lat, landInc, p);
    const dTvd = icp.tvd - bc.B2.tvd;                                   // lower tangent T2: set by the final curve only
    if (dTvd < b.dTvd2Min - 1e-6 || dTvd > b.dTvd2Max + 1e-6){ reasons.dtvd++; return null; }
    let dTvd1 = icp.tvd - bc.B1.tvd;                                    // upper tangent T1
    if (dTvd1 < b.dTvd1Min - 1e-6){                                     // too shallow: lengthen T2 (lengths are "min only");
      const c2 = Math.cos(p.t2inc * D2R); if (!(c2 > 1e-6)){ reasons.dtvd++; return null; }   // each m of T2 adds cos(Inc2) m of TVD
      p.L2 = p.L2 + (b.dTvd1Min - dTvd1) / c2; bc = padBackChain(icp, lat, landInc, p); dTvd1 = icp.tvd - bc.B1.tvd;
    }
    if (dTvd1 > b.dTvd1Max + 1e-6){ reasons.dtvd++; return null; }
    const al = padAlign(kopPt, bc.A, { inc:p.t1inc, az:p.t1az }, p.dC, x0); if (!al){ reasons.align++; return null; }
    return { p, bc, al, dTvd, dTvd1, md: kop + al.len + bc.len };
  };
  for (const t1inc of T1) for (const t2inc of T2) for (const dC of DC) for (const dF of DF){
    // 2026-10-31 speed: tangent-1 azimuth every 15 deg (warm-started), then golden-section refine to ~0.2 deg
    let local = null, prevX = null;
    for (let az = 0; az < 360; az += 15){
      const c = tryOne({ t1inc, t1az:az, t2inc, L1:+b.L1, L2:+b.L2, dC, dM:dC, dF }, prevX);
      if (c){ prevX = c.al.x; if (!local || c.md < local.md) local = c; if (keepPool) pool.push(c); }
    }
    if (!local) continue;
    const at = az => tryOne(Object.assign({}, local.p, { t1az:((az % 360) + 360) % 360 }), local.al.x);
    let lo = local.p.t1az - 15, hi = local.p.t1az + 15, gr = 0.618;
    for (let k = 0; k < 12; k++){
      const a1 = hi - gr * (hi - lo), a2 = lo + gr * (hi - lo), c1 = at(a1), c2 = at(a2);
      if (c1 && c1.md < local.md) local = c1; if (c2 && c2.md < local.md) local = c2;
      if (!c1 && !c2) break;
      if (!c2 || (c1 && c1.md < c2.md)) hi = a2; else lo = a1;
    }
    if (keepPool) pool.push(local);
    if (better(local, best)) best = local;
  }
  // 2026-11-01: rules — walk the candidates best-first, keep rule-clean ones; if none (within 400 checks), the
  // fewest-violation ones are used and carry r.violations (flagged red in iPad).
  const ruleEval = r => { if (!useRules || !r.ok) return r;
    const st = computeStations({ md:0, tvd:0, n:surf.n, e:surf.e, inc:0, az:0 }, r.sections, 10).stations;
    const landMd = r.sections.reduce((a, x, i) => a + (r.tags[i] === 'lateral' ? 0 : x.cl), 0);
    r.violations = padRuleCheck(st, tpl.rules, rulesSS, landMd); return r; };
  if (collectK || useRules){
    const sorted = pool.slice().sort((c1, c2) => better(c1, c2) ? -1 : better(c2, c1) ? 1 : 0), seen = {}, out = [], worse = [];
    const K = collectK || 1; let checks = 0;
    for (const c of sorted){
      const k = [c.p.t1inc, c.p.t2inc, c.p.dC, c.p.dF, Math.round((((c.p.t1az % 360) + 360) % 360) / 5)].join('|');
      if (seen[k]) continue; seen[k] = 1;
      const r = ruleEval(buildRes(c));
      if (!useRules || !(r.violations || []).length){ out.push(r); if (out.length >= K) break; }
      else { worse.push(r); if (++checks >= 400 && out.length) break; if (checks >= 400) break; }
    }
    if (out.length < K && worse.length){ worse.sort((a, z) => a.violations.length - z.violations.length); out.push(...worse.slice(0, K - out.length)); }
    if (collectK) return out;
    if (out.length) return padOaFinalize(out[0]);   // 2026-11-06
  }
  if (!best) return { ok:false, miss:null, sections:null, error: 'No design inside the ranges' + (reasons.dtvd && !reasons.align ? ' (Delta TVD out of range — widen the T1/T2 Delta TVD, tangent Inc or final DLS ranges)' : reasons.align ? ' (KOP-to-tangent connection not possible — try a shallower KOP, a higher max DLS or a lower tangent-1 Inc)' : '') };
  return padOaFinalize(buildRes(best));   // 2026-11-06
  function buildRes(best){
  const p = best.p, x = best.al.x, azH = ((x[1] % 360) + 360) % 360;
  // tags[i] names sections[i] (2026-10-31: used for the Compass-style comments in the iPad export)
  const sections = [], tags = [];
  const add = (tag, sec) => { sections.push(sec); tags.push(tag); };
  if (pre) pre.forEach(x => add(x.tag, x.sec));
  else if (kop > 1e-6) add('kop', { kind:'direct', inc:0, az:0, cl:kop });
  add('align1', { kind:'direct', inc:x[0], az:azH, cl: impliedBetaDeg(kopPt.inc, kopPt.az, x[0], azH) * 30 / p.dC });
  if (x[2] > 1e-6) add('alignHold', { kind:'direct', inc:x[0], az:azH, cl:x[2] });
  const c2 = impliedBetaDeg(x[0], azH, p.t1inc, p.t1az) * 30 / p.dC; if (c2 > 1e-6) add('align2', { kind:'direct', inc:p.t1inc, az:p.t1az, cl:c2 });
  if (p.L1 > 1e-6) add('t1', { kind:'direct', inc:p.t1inc, az:p.t1az, cl:p.L1 });
  if (best.bc.clM > 1e-6) add('mid', { kind:'direct', inc:p.t2inc, az:lat, cl:best.bc.clM });
  if (p.L2 > 1e-6) add('t2', { kind:'direct', inc:p.t2inc, az:lat, cl:p.L2 });
  if (best.bc.clF > 1e-6) add('final', { kind:'direct', inc:landInc, az:lat, cl:best.bc.clF });
  if ((tpl.lateral || 0) > 1e-6) add('lateral', { kind:'direct', inc:landInc, az:lat, cl:tpl.lateral });
  const edges = [];
  const edge = (lbl, v, a, z, d) => { if (+z > +a){ if (Math.abs(v - a) < 1e-6) edges.push(lbl + ' at min ' + (+a).toFixed(d)); else if (Math.abs(v - z) < 1e-6) edges.push(lbl + ' at max ' + (+z).toFixed(d)); } };
  if (p.L2 > +b.L2 + 1e-3) edges.push('T2 lengthened to ' + p.L2.toFixed(1) + ' m for T1 Delta TVD');
  edge('T1 Inc', p.t1inc, b.t1Min, b.t1Max, 1);
  const edgeD = (lbl, v, a, z) => { if (+z > +a){ if (Math.abs(v - a) < 0.05) edges.push(lbl + ' at min ' + (+a).toFixed(1)); else if (Math.abs(v - z) < 0.05) edges.push(lbl + ' at max ' + (+z).toFixed(1)); } };
  edgeD('T1 Delta TVD', best.dTvd1, b.dTvd1Min, b.dTvd1Max); edgeD('T2 Delta TVD', best.dTvd, b.dTvd2Min, b.dTvd2Max); edge('T2 Inc', p.t2inc, b.t2Min, b.t2Max, 1); edge('DLS', p.dC, b.dMin, b.dMax, 1); edge('Final DLS', p.dF, b.dFMin, b.dFMax, 1);
  // ADDED 2026-11-06 (John: "iPad uses the iPlan algorithms, keep the current iPad solver as a fallback"):
  // the same design re-expressed as an iPlan Optimum Align live group — target = ICP (landInc / lat), Project Back
  // chain = final curve to T2 (IncAzi, DLS dF), T2 hold (CL L2, DLS 0), mid curve to T1 (IncAzi, DLS dM), T1 hold
  // (CL L1, DLS 0) — and re-solved with the Compass-validated planOptimumAlign + projectBack. Accepted only when
  // it is the SAME solution as padAlign (first-curve Inc / Azi within 0.5 deg, hold within 1 m, ICP hit < 0.05 m):
  // then r.sections come from the validated solver and r.oaPlan lets iPlan store the well as a live group.
  // Otherwise (no solution / other branch) the padAlign sections stay (fallback) and r.oaFallback says why.
  // 2026-11-06 speed: in collect mode (Avoidance alternatives, hundreds per well) the conversion is deferred —
  // r._oaIn is kept and padOaFinalize(r) runs it on the designs actually returned (padAvoid's result wells).
  if (keepPool){ return { ok:true, miss:0, sections, tags, maxDls: Math.max(p.dC, p.dF), edges, _oaIn:{ kopPt, p, x, azH, icp, landInc, lat, surf },
           params: { kop, incA:x[0], azA:azH, hold:x[2], dls1:p.dC, dls2:p.dF, incT:p.t1inc, lt:p.L1, azT:p.t1az, dTvd:best.dTvd, dTvd1:best.dTvd1, nudge: (pre && nd) ? { kop:nd.kop, dls:nd.dls, inc:nd.inc, az:nd.az } : null,
                     tangents:[{ inc:p.t1inc, L:p.L1, az:p.t1az }, { inc:p.t2inc, L:p.L2, az:lat }] }, error:null, md: best.md }; }
  const fin = padOaFinalize({ sections, tags, _oaIn:{ kopPt, p, x, azH, icp, landInc, lat, surf } });
  const outSecs = fin.sections, oaPlan = fin.oaPlan || null, oaFallback = fin.oaFallback || null;
  return { ok:true, miss:0, sections: outSecs, tags: fin.tags, maxDls: Math.max(p.dC, p.dF), edges, oaPlan, oaFallback,
           params: { kop, incA:x[0], azA:azH, hold:x[2], dls1:p.dC, dls2:p.dF, incT:p.t1inc, lt:p.L1, azT:p.t1az, dTvd:best.dTvd, dTvd1:best.dTvd1, nudge: (pre && nd) ? { kop:nd.kop, dls:nd.dls, inc:nd.inc, az:nd.az } : null,
                     tangents:[{ inc:p.t1inc, L:p.L1, az:p.t1az }, { inc:p.t2inc, L:p.L2, az:lat }] }, error:null, md: best.md };
  }
}

/* ============================================================
   iPad "Avoidance" (ADDED 2026-10-31, John): change the pad's designs so that
   the TUNNELS (radius R around each trajectory, below "From MD") of the new
   pad wells never touch: centre-to-centre distance > 2R between every pair.
   Every alternative still satisfies the "Back-projected from ICP" ranges
   (padSolveBack, opts.collect) and lands on the ICP; the levers, cheapest first:
     1. another design inside the ranges (T1 azimuth / Inc, T2 Inc, DLS, final DLS)
     2. KOP stagger (KOP deeper by kopStep, up to kopMax — John: "free")
     3. ICP moved inside its tolerance box (along / across the lateral, Sub-Sea fixed)
   Search = min-conflicts local search: start from each well's best design; while
   pairs touch, take the well in the most conflicts and give it the alternative
   with the fewest conflicts against the others' current designs (then least
   overlap, then shortest MD); when its alternatives are exhausted, generate the
   next lever level for it (lazy). Keeps the best combination seen (fewest
   touching pairs, then least total overlap, then shortest total MD) — if not
   everything can be cleared, that best combination is returned (John's choice).
   Distance = each 10 m station of one path to the straight segments of the other
   (Sub-Sea datum), pairs pruned by bounding boxes. Geometric only (no uncertainty).
   ============================================================ */
// ADDED 2026-10-31 (John): automatic KOP stagger, like his hand designs (pad 163 KOPs 120-250 m):
// neighbouring slots (closer than nbrDist; default 1.5 x the smallest slot spacing) get different KOP
// levels — greedy graph colouring in slot order — and KOP offset = level x step. Returns offsets (m).
function padKopStagger(slots, step, nbrDist){
  const nS = slots.length; if (!nS) return [];
  let minSp = Infinity;
  for (let i = 0; i < nS; i++) for (let j = i + 1; j < nS; j++){ const d = Math.hypot(slots[i].n - slots[j].n, slots[i].e - slots[j].e); if (d > 0.5 && d < minSp) minSp = d; }
  const lim = nbrDist > 0 ? nbrDist : (isFinite(minSp) ? 1.5 * minSp : 0);
  const lvl = new Array(nS).fill(-1);
  for (let i = 0; i < nS; i++){
    const used = new Set();
    for (let j = 0; j < nS; j++) if (lvl[j] >= 0 && Math.hypot(slots[i].n - slots[j].n, slots[i].e - slots[j].e) <= lim) used.add(lvl[j]);
    let k = 0; while (used.has(k)) k++; lvl[i] = k;
  }
  return lvl.map(k => k * step);
}
async function padAvoid(wells, o, progress){
  o = Object.assign({ R:10, fromMd:0, full:false, kopStep:20, kopMax:300, tolAlong:0, tolAcross:0, K:40, maxIter:600, timeMs:120000, step:10, nudge:null,
                      obstacles:null, obsClr:null, nearMd:200, icpZone:100, icpClr:5, nudgeAzStep:15 }, o || {});
  const T0 = Date.now(), lim = 2 * o.R, lim0 = lim, nW = wells.length;
  // CHANGED 2026-11-04 (John, SD9: "minimise the displacement of the ICP"): ICP shifts in growing steps
  // (25 / 50 / 75 / 100 % of the tolerance), ALONG the lateral first, across only after (smallest move first).
  // Was: only the full ±tolerance (and the corner combinations).
  const shifts = [[0, 0]];
  [0.25, 0.5, 0.75, 1].forEach(f => { if (o.tolAlong > 0) shifts.push([f * o.tolAlong, 0], [-f * o.tolAlong, 0]); });
  [0.25, 0.5, 0.75, 1].forEach(f => { if (o.tolAcross > 0) shifts.push([0, f * o.tolAcross], [0, -f * o.tolAcross]); });
  // CHANGED 2026-10-31 (John): lever order = designs -> KOP stagger -> AC nudge (o.nudge = {kop, dls, incMax}:
  // inc incMax/2 and incMax, 8 azimuths) -> ICP tolerance.
  const levels = [];
  for (let k = 0; k <= o.kopMax + 1e-9; k += o.kopStep) levels.push({ kopAdd:k, shift:[0, 0], nudge:null });
  // CHANGED 2026-11-04 (John's SD9 hand designs nudge 2.5-12 deg toward 90 / 60 / 30 deg, from 30 m): nudge
  // inclination in thirds of the max and azimuth every o.nudgeAzStep (15) deg — was max/2 and max, every 45 deg.
  if (o.nudge && o.nudge.incMax > 0) [o.nudge.incMax / 3, 2 * o.nudge.incMax / 3, o.nudge.incMax].forEach(inc => { for (let az = 0; az < 360; az += o.nudgeAzStep) levels.push({ kopAdd:0, shift:[0, 0], nudge:{ kop:o.nudge.kop, dls:o.nudge.dls, inc: +inc.toFixed(2), az } }); });
  shifts.slice(1).forEach(sh => levels.push({ kopAdd:0, shift:sh, nudge:null }));
  const pathOf = (W, r) => {
    const st = computeStations({ md:0, tvd:0, n:W.surf.n, e:W.surf.e, inc:0, az:0 }, r.sections, o.step).stations;
    const landMd = r.sections.reduce((a, x, i) => a + ((r.tags || [])[i] === 'lateral' ? 0 : x.cl), 0);
    const pts = st.filter(p => p.md >= o.fromMd - 1e-6 && (o.full || p.md <= landMd + 1e-6)).map(p => ({ n:p.n, e:p.e, z:-p.tvd + (W.ss || 0) }));
    const bb = pts.reduce((b, p) => [Math.min(b[0], p.n), Math.max(b[1], p.n), Math.min(b[2], p.e), Math.max(b[3], p.e), Math.min(b[4], p.z), Math.max(b[5], p.z)], [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
    const ob = obsEval(W, st, landMd);   // 2026-11-04: offsets / planned wells
    return { pts, bb, landMd, oh: ob.hits, osev: ob.sev, obs: ob.list };
  };
  /* ADDED 2026-11-04 (John, SD9: iPad said "no touching" while the offsets were inside 10 m — Tunnel / Avoidance only
     looked at the pad's own wells). o.obstacles = fixed wells (offsets + planned wells not being redesigned):
     [{ name, pts:[{n, e, z}] }] (z = Sub-Sea), polylines. Each candidate is checked from surface to its ICP
     (stations every o.step m, point-to-segment, 3D) with John's required clearance by zone:
       - MD < o.nearMd (200): "as close to the clearance as the slot allows" -> min(clr, distance at the slot - 0.3)
       - MD >= ICP - o.icpZone (100): o.icpClr (5 m, SAGD — John: "for the ICP they were aiming close to 5 m")
       - otherwise: o.obsClr (default = the build clearance, 10 m)
     hits = number of obstacles violated, sev = sum of the shortfalls (m). Avoidance ranks: design rules ->
     obstacle hits -> pad touching pairs -> shortfall -> MD. */
  const OB = (o.obstacles || []).map(x => { const P = x.pts.filter(p => isFinite(p.n) && isFinite(p.e) && isFinite(p.z));
    return { name: x.name, P, bb: P.reduce((b, p) => [Math.min(b[0], p.n), Math.max(b[1], p.n), Math.min(b[2], p.e), Math.max(b[3], p.e)], [Infinity, -Infinity, Infinity, -Infinity]) }; }).filter(x => x.P.length > 1);
  const oClr = o.obsClr != null ? +o.obsClr : lim;
  const segMin = (p, P) => { let b = Infinity; for (let j = 1; j < P.length; j++){ const s = P[j - 1], t = P[j], vx = t.n - s.n, vy = t.e - s.e, vz = t.z - s.z, wx = p.n - s.n, wy = p.e - s.e, wz = p.z - s.z, L2 = vx*vx + vy*vy + vz*vz;
    let u = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u; const d = Math.hypot(wx - u*vx, wy - u*vy, wz - u*vz); if (d < b) b = d; } return b; };
  const slotD = new Map();   // per well x obstacle: distance at the slot (surface point)
  function obsEval(W, st, landMd){
    if (!OB.length) return { hits: 0, sev: 0, list: [] };
    const pts = st.filter(p => p.md <= landMd + 1e-6).map(p => ({ md: p.md, n: p.n, e: p.e, z: (W.ss || 0) - p.tvd }));
    const bb = pts.reduce((b, p) => [Math.min(b[0], p.n), Math.max(b[1], p.n), Math.min(b[2], p.e), Math.max(b[3], p.e)], [Infinity, -Infinity, Infinity, -Infinity]), pad = oClr + 5;
    let hits = 0, sev = 0; const list = [];
    OB.forEach((ob, k) => {
      if (ob.bb[0] > bb[1] + pad || ob.bb[1] < bb[0] - pad || ob.bb[2] > bb[3] + pad || ob.bb[3] < bb[2] - pad) return;
      const key = W.surf.n + ',' + W.surf.e + '|' + k;
      if (!slotD.has(key)) slotD.set(key, segMin({ n: W.surf.n, e: W.surf.e, z: W.ss || 0 }, ob.P));
      const sd = slotD.get(key);
      let worst = null, s0 = 0;
      for (const p of pts){
        // CHANGED 2026-11-06 (Deep search): above nearMd "as the slot allows" is also capped by what a VERTICAL well from
        // the slot gets at that depth (SD9: BP PCI 13D9 converges to 9.7 m below a 10.1 m slot — no path could pass).
        const req = p.md < o.nearMd ? Math.min(oClr, sd - 0.3, segMin({ n:W.surf.n, e:W.surf.e, z:p.z }, ob.P) - 0.3) : (p.md >= landMd - o.icpZone ? Math.min(oClr, o.icpClr) : oClr);
        if (p.n < ob.bb[0] - req || p.n > ob.bb[1] + req || p.e < ob.bb[2] - req || p.e > ob.bb[3] + req) continue;
        const d = segMin(p, ob.P);
        if (d < req - 1e-6){ s0 += req - d; if (!worst || req - d > worst.req - worst.d) worst = { d, req, md: p.md }; }
      }
      if (worst){ hits++; sev += s0; list.push({ name: ob.name, d: worst.d, req: worst.req, md: worst.md }); }
    });
    return { hits, sev, list };
  }
  const genLevel = (i, li) => {
    const W = wells[i], L = levels[li], az = W.land.az * D2R, [da, dc] = L.shift;
    const land = Object.assign({}, W.land, { n: W.land.n + da * Math.cos(az) - dc * Math.sin(az), e: W.land.e + da * Math.sin(az) + dc * Math.cos(az) });
    const rs = padSolveBack(W.surf, land, Object.assign({}, W.tpl, { kop: W.tpl.kop + L.kopAdd, nudge: L.nudge || W.tpl.nudge || null }), { collect: o.K }) || [];
    // 2026-11-01: nv = design-rule violations of the candidate (padSolveBack with tpl.rules); rules come FIRST
    return rs.map(r => Object.assign({ r, kopAdd: L.kopAdd, shift: L.shift, nudge: L.nudge, land, md: r.md, nv: (r.violations || []).length }, pathOf(W, r)));
  };
  // CHANGED 2026-10-31 (John, "Safest" goal): optional cap (default = clearance lim) so the Safest phase can
  // measure separations above the clearance; > cap still returns Infinity (bounding-box prune).
  const minDist = (A, B, cap) => {
    const lim = cap || lim0;
    const a = A.bb, b = B.bb, gap = Math.max(0, a[0] - b[1], b[0] - a[1]) ** 2 + Math.max(0, a[2] - b[3], b[2] - a[3]) ** 2 + Math.max(0, a[4] - b[5], b[4] - a[5]) ** 2;
    if (Math.sqrt(gap) > lim) return Infinity;
    let best = Infinity; const P = A.pts, Q = B.pts;
    for (const p of P){
      if (p.n < b[0] - lim || p.n > b[1] + lim || p.e < b[2] - lim || p.e > b[3] + lim) continue;
      for (let j = 1; j < Q.length; j++){
        const s = Q[j - 1], t = Q[j], vx = t.n - s.n, vy = t.e - s.e, vz = t.z - s.z, wx = p.n - s.n, wy = p.e - s.e, wz = p.z - s.z, L2 = vx*vx + vy*vy + vz*vz;
        let u = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(wx - u*vx, wy - u*vy, wz - u*vz); if (d < best) best = d;
      }
    }
    return best;
  };
  const cands = [], lvl = [], cache = new Map();
  for (let i = 0; i < nW; i++){
    cands[i] = []; lvl[i] = -1;
    while (!cands[i].length && lvl[i] < levels.length - 1){ lvl[i]++; cands[i] = genLevel(i, lvl[i]); }
    if (progress) await progress('Designing alternatives ' + (i + 1) + '/' + nW);
  }
  const dist = (i, ci, j, cj) => { const k = i < j ? i + ':' + ci + '|' + j + ':' + cj : j + ':' + cj + '|' + i + ':' + ci;
    let d = cache.get(k); if (d === undefined){ d = minDist(cands[i][ci], cands[j][cj]); cache.set(k, d); } return d; };
  const assign = cands.map(c => c.length ? 0 : -1);
  const evalAll = a => { let pairs = 0, sev = 0, md = 0, nv = 0, oh = 0; const per = new Array(nW).fill(0);
    for (let i = 0; i < nW; i++){ if (a[i] < 0) continue; const C0 = cands[i][a[i]]; md += C0.md; nv += C0.nv || 0; oh += C0.oh || 0; sev += C0.osev || 0; per[i] += C0.oh || 0;   // 2026-11-04: obstacles
      for (let j = i + 1; j < nW; j++){ if (a[j] < 0) continue; const d = dist(i, a[i], j, a[j]); if (d < lim - 1e-6){ pairs++; sev += lim - d; per[i]++; per[j]++; } } }
    return { pairs, sev, md, per, nv, oh }; };
  // 2026-11-04: lexicographic — rules, obstacle hits, pad touching pairs, total shortfall, MD
  const lex = (x, y) => { const A = [x.nv || 0, x.oh || 0, x.pairs], B = [y.nv || 0, y.oh || 0, y.pairs];
    for (let k = 0; k < 3; k++) if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
    if (Math.abs(x.sev - y.sev) > 1e-6) return x.sev < y.sev ? -1 : 1;
    return Math.abs(x.md - y.md) > 1e-6 ? (x.md < y.md ? -1 : 1) : 0; };
  const betterE = (x, y) => lex(x, y) < 0;
  let cur = evalAll(assign), best = { a: assign.slice(), e: cur }; const start = cur;
  const tabu = new Map();
  for (let it = 0; it < o.maxIter && (cur.pairs > 0 || cur.oh > 0) && Date.now() - T0 < o.timeMs; it++){
    const order = cur.per.map((c, i) => [c, i]).filter(x => x[0] > 0 && !((tabu.get(x[1]) || -1) > it)).sort((x, y) => y[0] - x[0]);
    if (!order.length){ tabu.clear(); continue; }
    const i = order[0][1];
    let moved = false;
    for (let pass = 0; pass < 2 && !moved; pass++){
      let bestC = -1, bestS = null;
      for (let ci = 0; ci < cands[i].length; ci++){
        let pairs = 0, sev = cands[i][ci].osev || 0;
        for (let j = 0; j < nW; j++){ if (j === i || assign[j] < 0) continue; const d = dist(i, ci, j, assign[j]); if (d < lim - 1e-6){ pairs++; sev += lim - d; } }
        const sc = { pairs, sev, md: cands[i][ci].md, nv: cands[i][ci].nv || 0, oh: cands[i][ci].oh || 0 };
        if (sc.nv > (cands[i][assign[i]] ? cands[i][assign[i]].nv || 0 : 0)) continue;   // 2026-11-01: never trade a rule-clean design for a violating one
        if (!bestS || lex(sc, bestS) < 0){ bestS = sc; bestC = ci; }
      }
      // 2026-11-04: the well's own current score (obstacles + its pairs) — move only on a strict improvement
      const C0 = cands[i][assign[i]]; let p0 = 0, s0 = C0 ? C0.osev || 0 : 0;
      for (let j = 0; j < nW; j++){ if (j === i || assign[j] < 0 || !C0) continue; const d = dist(i, assign[i], j, assign[j]); if (d < lim - 1e-6){ p0++; s0 += lim - d; } }
      const curS = { pairs: p0, sev: s0, md: C0 ? C0.md : Infinity, nv: C0 ? C0.nv || 0 : 0, oh: C0 ? C0.oh || 0 : 0 };
      if (bestS && ((bestS.oh || 0) < curS.oh || ((bestS.oh || 0) === curS.oh && bestS.pairs < curS.pairs))){ assign[i] = bestC; moved = true; }
      else if (lvl[i] < levels.length - 1){ lvl[i]++; const more = genLevel(i, lvl[i]); cands[i] = cands[i].concat(more); }   // next lever for this well
      else break;
    }
    if (!moved){ tabu.set(i, it + 5); }
    cur = evalAll(assign);
    if (betterE(cur, best.e)) best = { a: assign.slice(), e: cur };
    if (progress && it % 5 === 0) await progress('Avoidance: ' + cur.pairs + ' touching pair(s), ' + cur.oh + ' offset conflict(s) — iteration ' + (it + 1));
  }
  // ADDED 2026-10-31 (John: 'continue with the "Safest" objective - optimize for separation directly').
  // Optional phase after the no-touching search (o.safest). Priority: safest first, then shortest MD.
  // Repeatedly takes the pad-wide closest pair (centre-to-centre, same geometry as the clearance check) and,
  // for each of its two wells, looks for an alternative design whose closest approach to every other well is
  // > that minimum + 0.05 m without adding touching pairs for that well; the shortest-MD such candidate is
  // applied. Every accepted move keeps all other pairs unchanged, so the pad minimum never decreases.
  // Separations above o.safeCap (default 3x clearance) count as "far enough" (also keeps it fast).
  let minBefore = null, minAfter = null, safeMoves = 0;
  if (o.safest){
    const cap = o.safeCap || 3 * lim, c2 = new Map(), a = best.a.slice();
    const dS = (i, ci, j, cj) => { const k = i < j ? i + ':' + ci + '|' + j + ':' + cj : j + ':' + cj + '|' + i + ':' + ci;
      let d = c2.get(k); if (d === undefined){ d = minDist(cands[i][ci], cands[j][cj], cap); c2.set(k, d); } return d; };
    const gMin = () => { let m = { d: Infinity, i: -1, j: -1 };
      for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++){ if (a[i] < 0 || a[j] < 0) continue; const d = dS(i, a[i], j, a[j]); if (d < m.d) m = { d, i, j }; }
      return m; };
    const wellStat = (i, ci) => { let m = Infinity, p = 0; for (let j = 0; j < nW; j++){ if (j === i || a[j] < 0) continue; const d = dS(i, ci, j, a[j]); if (d < m) m = d; if (d < lim - 1e-6) p++; } return { m, p }; };
    let g = gMin(); minBefore = g.d;
    for (let it = 0; it < 2000 && isFinite(g.d) && Date.now() - T0 < o.timeMs; it++){
      let pick = null;
      for (const w of [g.i, g.j]){
        const p0 = wellStat(w, a[w]).p;
        for (;;){
          for (let ci = 0; ci < cands[w].length; ci++){
            if (ci === a[w]) continue; const s = wellStat(w, ci);
            if (s.m > g.d + 0.05 && s.p <= p0 && (cands[w][ci].nv || 0) <= (cands[w][a[w]].nv || 0) && (cands[w][ci].oh || 0) <= (cands[w][a[w]].oh || 0) && (!pick || cands[w][ci].md < pick.md)) pick = { w, ci, md: cands[w][ci].md };   // 2026-11-04: never add offset conflicts
          }
          if (pick && pick.w === w) break;
          if (lvl[w] >= levels.length - 1 || Date.now() - T0 > o.timeMs) break;
          lvl[w]++; cands[w] = cands[w].concat(genLevel(w, lvl[w]));   // next lever for this well
        }
      }
      if (!pick) break;
      a[pick.w] = pick.ci; safeMoves++; g = gMin();
      if (progress && it % 3 === 0) await progress('Safest: pad min C2C ' + (isFinite(g.d) ? g.d.toFixed(1) + ' m' : '> ' + cap.toFixed(0) + ' m') + ' — move ' + safeMoves);
    }
    minAfter = g.d; best = { a, e: evalAll(a) };
  }
  const pairsOut = [];
  for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++){ if (best.a[i] < 0 || best.a[j] < 0) continue; const d = dist(i, best.a[i], j, best.a[j]); if (d < lim - 1e-6) pairsOut.push({ i, j, d }); }
  const minC2C = i => { let m = Infinity; for (let j = 0; j < nW; j++) if (j !== i && best.a[i] >= 0 && best.a[j] >= 0) m = Math.min(m, minDist(cands[i][best.a[i]], cands[j][best.a[j]], o.safest ? (o.safeCap || 3 * lim) : 0)); return m; };
  return { start, end: best.e, pairs: pairsOut, ms: Date.now() - T0, minBefore, minAfter, safeMoves,
           wells: best.a.map((ci, i) => { if (ci < 0) return null; const w = Object.assign({}, cands[i][ci], { alt: ci, minC2C: minC2C(i) });
             if (w.r && w.r._oaIn) w.r = padOaFinalize(Object.assign({}, w.r)); return w; }) };   // 2026-11-06: iPlan Optimum Align group for the chosen designs
}


/* ADDED 2026-11-01 (John): lateral avoidance with his Compass TF-DLS-CL manoeuvre.
   John's pattern at Inc 90: TF -90 / DLS 5 / CL 50 -> TF +90 / DLS 5 / CL 100 -> TF -90 / DLS 5 / CL 50.
   Verified with computeStations (minimum curvature): it goes out to the left, peaks at 2R(1-cos t)
   = 7.26 m half way (R = 30/(DLS in rad) = 343.8 m, t = DLS*CL/30 = 8.33 deg) and ends back ON the original
   line and azimuth. Generalised here as: hold S -> [TF s, a] [TF -s, a] -> hold P (plateau, optional)
   -> [TF -s, a] [TF s, a] -> hold to the original lateral end (abreast of the TD), s = +90 right / -90 left.
   Peak shift D = 2R(1-cos t), t = DLS*a/30 (pure geometry of two equal opposite circular arcs).
   Search (planar, in the lateral's own frame u = along, v = across, z = Sub-Sea): offset well points are
   turned into a lower / upper bound on v(u) for each side (point within clearance horizontally+vertically
   -> v must pass it by sqrt(clr^2 - du^2 - dz^2)); for every DLS (step 0.5 up to dlsMax) and leg a (10 m
   steps) the latest start S whose ramp + plateau + return stay inside the bounds is found, then the shortest
   plateau. prefer 'dls' = lowest DLS first, then least back-off; 'backoff' = least back-off first.
   Several conflicts along a lateral are handled one after another. Only OFFSET wells (John, 2026-11-01).
   Offsets flagged twin (SAGD pair) are not avoided: checked against sagdClr only and reported.
   in:  o = { icp:{n,e,el,inc,az}, L (lateral MD of the straight hold), offsets:[{name, pts:[{n,e,el}], twin}],
              clr, dlsMax, prefer, sagdClr }
   out: { sections:[...], maneuvers:[{side, dls, a, P, sMd, eMd, backoff, peak, conflictU, with}], unresolved:[...] } */
// 2026-11-01: wrapper — the search is planar on a 1 m grid, so the real minimum-curvature path can come out
// slightly inside the clearance on oblique crossings (test: 13.9 m vs 15). Re-check with real stations and
// re-run with a search margin (+0.5 m steps, up to +3 m) until the real clearance holds.
function padLateralAvoid(o){
  const real = r => { const st = computeStations({ md:0, tvd:0, n:o.icp.n, e:o.icp.e, inc:o.icp.inc, az:o.icp.az }, r.sections, 2).stations; let m = Infinity;
    (o.offsets || []).forEach(off => { if (off.twin) return; const P = off.pts || [];
      st.forEach(p => { const el = o.icp.el - p.tvd;
        for (let i = 1; i < P.length; i++){ const a = P[i-1], b = P[i], vx = b.n-a.n, vy = b.e-a.e, vz = b.el-a.el, wx = p.n-a.n, wy = p.e-a.e, wz = el-a.el, L2 = vx*vx+vy*vy+vz*vz;
          let t = L2 > 0 ? (wx*vx+wy*vy+wz*vz)/L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = Math.hypot(wx-t*vx, wy-t*vy, wz-t*vz); if (d < m) m = d; } }); });
    return m; };
  let best = null;
  for (let mg = 0; mg <= 3 + 1e-9; mg += 0.5){
    const r = padLateralAvoidCore(Object.assign({}, o, { clr: o.clr + mg })); r.minC2C = real(r); r.margin = mg;
    if (!best || (r.unresolved.length < best.unresolved.length) || (r.unresolved.length === best.unresolved.length && r.minC2C > best.minC2C)) best = r;
    if (!r.maneuvers.length || r.minC2C >= o.clr - 1e-6) return r;
  }
  return best;
}
function padLateralAvoidCore(o){
  const D2 = Math.PI / 180, inc = o.icp.inc * D2, az = o.icp.az * D2, sinI = Math.max(1e-3, Math.sin(inc)), cotI = Math.cos(inc) / sinI;
  const Lu = o.L * sinI, clr = o.clr, step = 1, NU = Math.ceil(Lu) + 1;
  const toUV = p => { const dn = p.n - o.icp.n, de = p.e - o.icp.e; return { u: dn * Math.cos(az) + de * Math.sin(az), v: -dn * Math.sin(az) + de * Math.cos(az), z: p.el }; };
  const zPath = u => o.icp.el - u * cotI;   // hold at the ICP Inc (Sub-Sea up = +)
  // CHANGED 2026-11-01 (John: offsets entering the lateral tunnel from above / the side were left red): each
  // offset point now forbids an INTERVAL of across-offsets [sv - r, sv + r] at that u (was: a one-sided lower /
  // upper bound, which could not pass a point on the far side by going around it). forb[side][u] = [[lo, hi], ...]
  const forb = { 1: Array.from({ length: NU }, () => []), [-1]: Array.from({ length: NU }, () => []) };
  const bad = (sd, i, v) => { const F = forb[sd][i]; for (let k = 0; k < F.length; k++) if (v > F[k][0] + 1e-6 && v < F[k][1] - 1e-6) return true; return false; };
  const hitAt = new Array(NU).fill(null), twins = [];
  (o.offsets || []).forEach(off => {
    const P = []; const pts = off.pts || [];
    for (let i = 0; i < pts.length; i++){   // densify to <= 2 m
      const a = toUV(pts[i]); if (i === 0){ P.push(a); continue; }
      const b = P[P.length - 1], L = Math.hypot(a.u - b.u, a.v - b.v, a.z - b.z), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 1; j <= k; j++) P.push({ u: b.u + (a.u - b.u) * j / k, v: b.v + (a.v - b.v) * j / k, z: b.z + (a.z - b.z) * j / k });
    }
    if (off.twin){ twins.push({ name: off.name, P }); return; }
    P.forEach(q => {
      if (q.u < -clr || q.u > Lu + clr || Math.abs(q.v) > clr + 80) return;
      const i0 = Math.max(0, Math.ceil(q.u - clr)), i1 = Math.min(NU - 1, Math.floor(q.u + clr));
      for (let i = i0; i <= i1; i++){
        const du = i - q.u, dz = zPath(i) - q.z, r2 = clr * clr - du * du - dz * dz; if (r2 <= 0) continue;
        const r = Math.sqrt(r2);
        if (Math.abs(q.v) < r && (!hitAt[i] || Math.abs(q.v) < hitAt[i].d)) hitAt[i] = { d: Math.abs(q.v), name: off.name };
        // side +1 (right, v >= 0 grows): pass a point on the left (v<=0) on its right, a point on the right... below it
        [1, -1].forEach(sd => { const sv = sd * q.v; if (sv + r > 0) forb[sd][i].push([sv - r, sv + r]); });
      }
    });
  });
  // ramp profile (up) for DLS d, leg a: arc out + arc back, sampled per 1 m along u
  const ramp = (d, a) => { const k = d * D2 / 30, ys = [0]; let x = 0, y = 0, ph = 0, ds = 0.25;
    for (let s0 = 0; s0 < 2 * a - 1e-9; s0 += ds){ const sgn = s0 < a ? 1 : -1, ph2 = ph + sgn * k * ds;
      x += Math.cos((ph + ph2) / 2) * ds * sinI; y += Math.sin((ph + ph2) / 2) * ds * sinI; ph = ph2;
      while (ys.length <= Math.floor(x)) ys.push(y); }
    return { ys, w: ys.length - 1, wx: x, D: y }; };   // wx = exact along advance of one ramp
  const maneuvers = [], unresolved = [];
  let uFrom = 0, mdSecs = [];
  const zones = []; { let inZ = false;
    for (let i = 0; i < NU; i++){ const h = !!hitAt[i]; if (h && !inZ){ zones.push({ a: i, b: i, with: hitAt[i].name, d: hitAt[i].d }); inZ = true; } else if (h){ const z = zones[zones.length - 1]; z.b = i; if (hitAt[i].d < z.d){ z.d = hitAt[i].d; z.with = hitAt[i].name; } } else inZ = false; } }
  const vAt = new Float64Array(NU);   // final across offset (signed), for the report
  for (const Z of zones){
    if (Z.b < uFrom) continue;   // already covered by the previous manoeuvre's plateau / return
    let best = null;
    for (const sd of [1, -1]) for (let d = 0.5; d <= o.dlsMax + 1e-9; d += 0.5) for (let a = 10; a <= 300; a += 10){
      const R = ramp(d, a); if (R.D < 0.5) continue;
      let dOk = true; for (let i = Z.a; i <= Z.b && dOk; i++) if (bad(sd, i, R.D)) dOk = false; if (!dOk) continue;   // plateau shift must be clear over the zone
      // latest start S: ramp up must stay inside the bounds and be at full shift by the time lower bound needs it
      let S = -1;
      for (let s0 = Math.min(Z.a, NU - 1 - 2 * R.w); s0 >= uFrom; s0 -= 2){
        let ok = true;
        for (let i = s0; i <= Math.min(NU - 1, s0 + R.w) && ok; i++){ if (bad(sd, i, R.ys[i - s0])) ok = false; }
        if (ok){ S = s0; break; }
      }
      if (S < 0) continue;
      // shortest plateau P, then the return ramp
      let Pz = -1;
      for (let P = 0; S + 2 * R.w + P <= NU - 1; P += 2){
        let ok = true; const p0 = S + R.w, r0 = p0 + P;
        for (let i = p0; i < r0 && ok; i++) if (bad(sd, i, R.D)) ok = false;
        if (!ok) continue;
        for (let i = r0; i <= r0 + R.w && ok; i++){ if (bad(sd, i, R.ys[R.w - (i - r0)])) ok = false; }
        // after the return the straight line must be clear up to the next zone start handled later: only check that this zone is passed
        if (ok && r0 + R.w < Z.b){ ok = false; }
        if (ok){ Pz = P; break; }
      }
      if (Pz < 0) continue;
      const c = { sd, d, a, S, P: Pz, R, back: Z.a - S };
      const better = !best || (o.prefer === 'backoff' ? (c.back < best.back - 1e-9 || (Math.abs(c.back - best.back) < 1e-9 && c.d < best.d)) : (c.d < best.d - 1e-9 || (Math.abs(c.d - best.d) < 1e-9 && c.back < best.back)));
      if (better) best = c;
      break;   // larger legs for this DLS only push the start earlier
    }
    if (!best){ unresolved.push({ u: Z.a, with: Z.with, d: Z.d, why: Z.a < 60 ? 'too close to the ICP to back off (use the build-section levers / ICP tolerance)' : 'no manoeuvre within max DLS' }); continue; }
    const end = best.S + 2 * best.R.w + best.P;
    for (let i = best.S; i <= end && i < NU; i++){ const x = i - best.S; vAt[i] = best.sd * (x <= best.R.w ? best.R.ys[x] : x <= best.R.w + best.P ? best.R.D : best.R.ys[Math.max(0, best.R.w - (x - best.R.w - best.P))]); }
    maneuvers.push({ side: best.sd > 0 ? 'right' : 'left', dls: best.d, a: best.a, P: best.P / sinI, S: best.S, uEnd: end, uEndX: best.S + 2 * best.R.wx + best.P, backoff: best.back, peak: best.R.D, conflictU: Z.a, with: Z.with });
    uFrom = end;
  }
  // sections: hold / legs / hold ... (MD; hold along u -> MD = du / sin Inc)
  const secs = []; let u = 0;
  maneuvers.forEach(m => {
    if (m.S - u > 1e-6) secs.push({ kind:'hold', cl:(m.S - u) / sinI, _lat:'hold' });
    const tf = m.side === 'right' ? 90 : -90;
    secs.push({ kind:'dlstf', dls:m.dls, tf, cl:m.a, _lat:'start' });
    if (m.P > 1e-6){ secs.push({ kind:'dlstf', dls:m.dls, tf:-tf, cl:m.a }); secs.push({ kind:'hold', cl:m.P }); secs.push({ kind:'dlstf', dls:m.dls, tf:-tf, cl:m.a }); }
    else secs.push({ kind:'dlstf', dls:m.dls, tf:-tf, cl:2 * m.a });   // John's a / 2a / a form
    secs.push({ kind:'dlstf', dls:m.dls, tf, cl:m.a, _lat:'end' });
    u = m.uEndX;   // exact along position (the 1 m grid end is only used for the search)
  });
  if (Lu - u > 1e-6) secs.push({ kind:'hold', cl:(Lu - u) / sinI });
  // twins (SAGD pair): min distance to the final planar path, flagged against sagdClr
  const twinRep = twins.map(t => { let m = Infinity; t.P.forEach(q => { const i = Math.round(q.u); if (i < 0 || i >= NU) return; m = Math.min(m, Math.hypot(q.v - vAt[i], zPath(i) - q.z)); }); return { name: t.name, min: m, ok: m >= (o.sagdClr || 0) - 1e-6 }; });
  return { sections: secs, maneuvers, unresolved, twins: twinRep };
}

function padSolveWell(surf, land, tpl){
  if ((tpl.mode || 'turn') === 'turn') return padSolveTurn(surf, land, tpl);   // 2026-10-12: new default template
  if (tpl.mode === 'back') return padSolveBack(surf, land, tpl);   // 2026-10-31: back-projected from ICP (John's Compass method)
  // surf {n,e,rkb}; land {n,e,tvd,inc,az}; tpl {mode, kop, dls, incT, lt, lateral}
  const mode = tpl.mode;
  const keys = { kop_dls_len: ['azT','dls','lt'], kop_dls12: ['azT','dls1','dls2'], dls_kop_len: ['azT','kop','lt'] }[mode];
  if (!keys) return { error: 'Unknown mode' };
  const bearing = (((Math.atan2(land.e - surf.e, land.n - surf.n) * R2D) % 360) + 360) % 360;
  const toP = x => {
    const p = { kop: tpl.kop, incT: tpl.incT, lt: tpl.lt, dls1: tpl.dls, dls2: tpl.dls, azT: bearing };
    keys.forEach((k, i) => { if (k === 'dls'){ p.dls1 = x[i]; p.dls2 = x[i]; } else p[k] = x[i]; });
    return p;
  };
  const resid = x => {
    const p = toP(x);
    if (!(p.dls1 > 0.05) || !(p.dls2 > 0.05)) return null;
    const e = padLanding(surf, p, land);
    return [e.n - land.n, e.e - land.e, e.tvd - land.tvd];
  };
  const norm = r => Math.hypot(r[0], r[1], r[2]);
  const starts = [];
  const dlsG = [tpl.dls || 6, 3, 8, 12], ltG = [tpl.lt || 30, 0, 100, 300], kopG = [tpl.kop || 150, 50, 300, 500];
  [0, -20, 20, -45, 45].forEach(da => dlsG.forEach((dg, i) => {
    starts.push(keys.map(k => k === 'azT' ? bearing + da : (k === 'dls' || k === 'dls1' || k === 'dls2') ? dg : k === 'lt' ? ltG[i] : kopG[i]));
  }));
  let best = null;
  for (const x0 of starts){
    let x = x0.slice(), r = resid(x); if (!r) continue;
    let lambda = 1e-3;
    for (let it = 0; it < 150 && norm(r) > 1e-9; it++){
      const J = [[],[],[]];
      let bad = false;
      keys.forEach((k, j) => {
        const h = k === 'azT' ? 1e-5 : 1e-5 * Math.max(1, Math.abs(x[j]));
        const xp = x.slice(); xp[j] += h; const rp = resid(xp);
        if (!rp){ bad = true; return; }
        for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r[i]) / h;
      });
      if (bad) break;
      const JTJ = [0,1,2].map(a => [0,1,2].map(b => J[0][a]*J[0][b] + J[1][a]*J[1][b] + J[2][a]*J[2][b]));
      const JTr = [0,1,2].map(a => J[0][a]*r[0] + J[1][a]*r[1] + J[2][a]*r[2]);
      let ok = false;
      for (let t = 0; t < 10 && !ok; t++){
        const M = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? lambda * (v || 1) : 0)));
        const dx = solveLinear(M, JTr.map(v => -v));
        if (!dx){ lambda *= 10; continue; }
        const xn = x.map((v, i) => v + dx[i]);
        const rn = resid(xn);
        if (rn && norm(rn) < norm(r)){ x = xn; r = rn; lambda = Math.max(1e-10, lambda / 10); ok = true; } else lambda *= 10;
      }
      if (!ok) break;
    }
    const p = toP(x);
    const physical = p.kop >= -1e-6 && p.lt >= -1e-6 && p.dls1 > 0 && p.dls2 > 0;
    const miss = norm(r);
    const score = miss + (physical ? 0 : 1e6);
    if (!best || score < best.score) best = { score, p, miss, physical };
    if (miss < 1e-6 && physical) break;
  }
  if (!best) return { error: 'No solution' };
  const p = best.p; p.azT = ((p.azT % 360) + 360) % 360; p.kop = Math.max(0, p.kop); p.lt = Math.max(0, p.lt);
  const ok = best.miss < 1e-3 && best.physical;
  const sections = padSections(p, land, tpl.lateral || 0);
  return { ok, miss: best.miss, params: p, sections, maxDls: Math.max(p.dls1, p.dls2),
           error: ok ? null : (!best.physical ? 'Only a non-physical solution (negative KOP or tangent length) — try another mode or values' : 'Landing not reachable with these fixed values (closest miss ' + best.miss.toFixed(2) + ' m)') };
}

// Slot pattern: rows x slotsPerRow, numbered row by row. Row direction = rowAz;
// row k is offset rowSpacing to the RIGHT of row 1 (rowAz + 90°).
function padSlotPattern(o){
  const out = [], a = o.rowAz * D2R, b = (o.rowAz + 90) * D2R;
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.perRow; c++){
    out.push({ n: o.n + c*o.spacing*Math.cos(a) + r*o.rowSpacing*Math.cos(b),
               e: o.e + c*o.spacing*Math.sin(a) + r*o.rowSpacing*Math.sin(b) });
  }
  return out;
}
// Target pattern: count landings, spaced along spacingAz, all at the same Sub-Sea/Inc/Az.
function padTargetPattern(o){
  const out = [], a = o.spacingAz * D2R;
  for (let i = 0; i < o.count; i++) out.push({ n: o.n + i*o.spacing*Math.cos(a), e: o.e + i*o.spacing*Math.sin(a), ss: o.ss, inc: o.inc, az: o.az });
  return out;
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
  planBuildHold, planHbhbh, planCurveHoldCurve, planOptimumAlign, projectBack, threadToPoint, fitTargetLine, withDoglegIncrease, padOaFinalize, padDeepSearch, padDeepAvoid,   // 2026-11-06 Deep search (RRT)
    // 2026-11-06: planOptimumAlign, projectBack, Thread Targets
  toolfaceBetween, toArcs, arcsToSections, chainArcs, pointOnArc, findAnchor, insertTangent,
  padSections, padLanding, padSolveWell, padSlotPattern, padTargetPattern,
  padTurnSections, padSolveTurn,
  padBackChain, padAlign, padSolveBack, padAvoid, padKopStagger, padRuleCheck, padRulesActive,   // 2026-10-31; rules 2026-11-01
  padLateralAvoid   // 2026-11-01
};
})(typeof window !== 'undefined' ? window : globalThis);

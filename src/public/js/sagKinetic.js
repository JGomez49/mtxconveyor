/*
 * "Kinetic" sag model for SAGcorrection (added 2026-10-24).
 *
 * SAME PHYSICS AS "Beam" (the SurQC port in sagModel.js) — only the
 * numerical method changes, per John's choice of suggestions 1-3:
 *   - Euler-Bernoulli beam in the high-side/low-side plane, x = distance
 *     from bit face, y = lateral position (+ = high side), slope = dy/dx
 *     ("Sag", added to measured Inc exactly as SurQC does).
 *   - Lateral load w = steel 7700 kg/m3 * A * g * sin(Inc) * (7700-rho_mud)/7700
 *     (identical to SurQC SubComponentWithMechanicalProperties), EI = 210 GPa
 *     * pi(OD^4-ID^4)/64 * stiffness factor.
 *   - Bit centred (pin, y = 0); far-end support on the low side chosen with
 *     SurQC's own rule (BHAFiniteElementsExtensions.FarEndSupport: min
 *     atan((R_hole - r)/x)); hole radius = bit OD/2; bend = slope jump of
 *     +alpha (high side) at the bend distance.
 *
 * WHAT IS DIFFERENT (and why):
 *   #1 Contact: SurQC's iterative "push" loop (which oscillates forever with
 *      a stabiliser right above the bit — the SurQC freeze) is replaced by a
 *      standard finite-element solve with Hermite cubic beam elements
 *      (stiffness + consistent load vectors: Logan, "A First Course in the
 *      Finite Element Method", Ch. 4 beam element) and an active-set
 *      solution of the unilateral wall-contact conditions
 *      (-c <= y <= c, contact force pushes inward only). Hermite elements
 *      give exact nodal deflections/rotations for uniform load on
 *      piecewise-uniform beams, so there is no 2.5 mm tolerance noise.
 *      Real component lengths are kept (SurQC's ShrinkStabilisers length
 *      redistribution — the cause of the near-bit oscillation — is not
 *      applied); the bit is not treated as a stabiliser.
 *   #2 Sensor: slope read at the exact sensor position (a node is placed
 *      there), not 1-2 elements further up as in SurQC's SagAtLength.
 *   #3 Bend: applied at the exact bend distance regardless of component
 *      boundaries; Inc = 0 is solved (bend-only, no gravity) instead of
 *      forced to 0 — consistent with John's installed SurQC table
 *      (+0.289 deg at 0 deg). With no bend and Inc = 0 the result is 0.
 *
 * VALIDATION (2026-10-24, "MTX AC/SAGcorrection validation"):
 *   - Independent solver (finite-difference beam energy minimised with wall
 *     bounds, scipy lsq_linear/BVLS, h = 0.05 and 0.025 m) agrees within
 *     5e-4 deg at the sensor: no-contact collar, CNRL BHA (134 contact nodes),
 *     near-bit-stabiliser BHA (SurQC hangs on it); with a 1.5 deg bend within
 *     0.002 deg (the FD check smears the kink over one 0.05 m node).
 *   - vs Beam where Beam converges: differences 0.002-0.035 deg. Traced to
 *     Beam's contact tolerance: Beam leaves the BHA up to ~2.1 mm INSIDE the
 *     hole wall (2.5 mm allowed) over long contact stretches, e.g. CNRL at
 *     45 deg x=10 m: drop -12.7 mm vs 10.9 mm clearance. Kinetic enforces the
 *     wall exactly. Agreed 0.01 deg criterion is NOT met on CNRL/t1 for this
 *     reason — reported to John, not hidden.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SagKinetic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const E = 210e9, RHO = 7700, H = 0.1016;   // same constants as SurQC / Beam

    // Banded symmetric system solve (Gaussian elimination, no pivoting;
    // matrix is SPD after supports are applied). A: rows of width 2b+1.
    function bandSolve(A, f, n, b) {
        for (let k = 0; k < n; k++) {
            const pk = A[k][b];
            if (!(pk > 0)) return null;                   // not positive definite (buckled under axial load)
            for (let i = k + 1; i <= Math.min(n - 1, k + b); i++) {
                const fac = A[i][k - i + b] / pk;
                if (fac === 0) continue;
                for (let j = k; j <= Math.min(n - 1, k + b); j++) A[i][j - i + b] -= fac * A[k][j - k + b];
                f[i] -= fac * f[k];
            }
        }
        const u = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = f[i];
            for (let j = i + 1; j <= Math.min(n - 1, i + b); j++) s -= A[i][j - i + b] * u[j];
            u[i] = s / A[i][b];
        }
        return u;
    }

    // Build nodes: component boundaries, sensor, bend, subdivided to <= H.
    function buildMesh(input) {
        const comps = input.subComponents;
        const bounds = [0]; comps.forEach(c => bounds.push(bounds[bounds.length - 1] + c.len));
        const total = bounds[bounds.length - 1];
        const extra = [];
        if (input.sensorPosition > 0 && input.sensorPosition < total) extra.push(input.sensorPosition);
        if (input.bendDistance > 0 && input.bendDistance < total && input.bendAngleDeg) extra.push(input.bendDistance);
        const key = [...new Set(bounds.concat(extra).map(v => +v.toFixed(9)))].sort((a, b) => a - b);
        const xs = [0];
        for (let k = 1; k < key.length; k++) {
            const a = key[k - 1], L = key[k] - a; if (L <= 1e-9) continue;
            const m = Math.max(1, Math.ceil(L / H - 1e-9));
            for (let j = 1; j <= m; j++) xs.push(a + L * j / m);
        }
        const compAt = x => { for (let i = 0; i < comps.length; i++) if (x < bounds[i + 1] - 1e-12) return i; return comps.length - 1; };
        const els = [];
        for (let i = 0; i < xs.length - 1; i++) {
            const c = comps[compAt(0.5 * (xs[i] + xs[i + 1]))];
            els.push({ i, L: xs[i + 1] - xs[i], c });
        }
        // radius of each node = max OD of the elements touching it (contact surface)
        const r = xs.map((x, i) => Math.max(i > 0 ? els[i - 1].c.od / 2 : 0, i < els.length ? els[i].c.od / 2 : 0));
        return { xs, els, r, total, bitLen: comps[0].len };
    }

    function solve(input, incDeg, opts) {
        opts = opts || {};
        // Active-set iterations: one contact added/released per iteration
        // (typically 10-200). Cap only guards against pathological cycling.
        const maxIter = Math.min(opts.maxIterations || 5000, 20000);
        const inc = incDeg * Math.PI / 180, mud = input.mudDensity, g = input.gravity;
        // 2026-10-24 planar improvements #6-#8 (John chose "fast planar now,
        // 3-D later"): everything stays in the high-side plane.
        //  #6 bend projected on the high-side plane: alpha * cos(TF_bend)
        //  #8 hole curvature: build/drop component of the dogleg
        //     kv = kappa * cos(TF_hole) (rad/m, + = building); hole centre
        //     yc = kv x^2/2 (small-angle arc), local hole-axis slope kv x
        //  #7 axial load (input.axialLoad === true): element geometric
        //     stiffness N/(30L)[...] (Przemieniecki 1968), N(x) = -WOB +
        //     integral q cos(Inc) (tension +); verified against Timoshenko &
        //     Gere beam-column closed forms. Non-positive pivot -> 'buckled'.
        // With bendTF = 0, curvature 0 and axialLoad off this is exactly the
        // accepted Kinetic model (regression-tested).
        // LIMITATION (stated in the UI): lateral (right/left) components of
        // bend and dogleg are ignored; no azimuth correction.
        const bend = (input.bendAngleDeg || 0) * Math.PI / 180 * Math.cos((input.bendTFDeg || 0) * Math.PI / 180);
        const kv = input.curvatureV || 0;
        const useAxial = input.axialLoad === true, WOB = input.wob || 0;
        const res = { inc: incDeg, status: 'ok', iterations: 0, residualOutOfHole: 0, contacts: 0 };
        const M = buildMesh(input);
        const { xs, els, r } = M, n = xs.length, N = 2 * n, R = input.subComponents[0].od / 2;
        const c = r.map(ri => R - ri);                       // radial clearance at each node
        const yc = xs.map(x => kv * x * x / 2);              // hole centre (planar curvature)
        // bend node index (exact position) — slope jump applied to elements starting there
        let bendNode = -1;
        if (bend && input.bendDistance > 0) bendNode = xs.findIndex(x => Math.abs(x - input.bendDistance) < 1e-7);
        // Far-end support: SurQC rule, over nodes beyond the bit
        let far = n - 1, minRot = 1e10;
        for (let i = 1; i < n; i++) { if (xs[i] <= M.bitLen + 1e-9) continue;
            const rot = Math.atan(c[i] / xs[i]); if (rot <= minRot) { minRot = rot; far = i; } }
        // 2026-10-24 (improvement #5, Kinetic only): per-component material
        // (rho kg/m3, E Pa; default steel 7700 / 210e9 = SurQC values) and,
        // when the BHA row has a Wt (kg/m, air, incl. tool joints), that weight
        // is used for the lateral load instead of OD/ID x density. Buoyancy
        // factor 1 - rho_mud/rho_material (identical to SurQC's
        // (7700 - rho_mud)/7700 for steel). EI always from body OD/ID.
        const wOf = e => { const rho = e.c.rho || RHO, BF = (rho - mud) / rho;
            const massPerM = (e.c.wt > 0) ? e.c.wt : rho * Math.PI / 4 * (e.c.od * e.c.od - e.c.id * e.c.id);
            return massPerM * g * Math.sin(inc) * BF; };
        // Assemble K (banded, b = 3) and load f; bend handled by eliminating
        // theta+ = theta- + bend for elements starting at the bend node.
        const b = 3;
        const K0 = Array.from({ length: N }, () => new Float64Array(2 * b + 1));
        const f0 = new Float64Array(N);
        const qAx = e => { const rho = e.c.rho || RHO, BF = (rho - mud) / rho;
            const mpm = (e.c.wt > 0) ? e.c.wt : rho * Math.PI / 4 * (e.c.od * e.c.od - e.c.id * e.c.id);
            return mpm * g * BF * Math.cos(inc); };
        let accN = 0;
        const Nax = els.map(e => { if (!useAxial) return 0; const q = qAx(e); const mid = -WOB + accN + q * e.L / 2; accN += q * e.L; return mid; });
        res.axial = useAxial ? { atBit: -WOB, atTop: -WOB + accN } : null;
        // Buckling check (warning only): the planar model holds the BHA against
        // the low side, so it cannot show sinusoidal/helical buckling. Flag
        // when the compression exceeds the Dawson & Paslay critical load for an
        // inclined hole, F = 2 sqrt(E I w sin(Inc) / r) (Dawson & Paslay,
        // "Drillpipe Buckling in Inclined Holes", JPT 1984, SPE-11167), with w
        // = buoyed weight per length and r = radial clearance, per element.
        if (useAxial) {
            let worst = Infinity;
            els.forEach((e, ei) => { const cl = R - e.c.od / 2; if (cl <= 0 || Nax[ei] >= 0) return;
                const EI = (e.c.E || E) * Math.PI * (Math.pow(e.c.od, 4) - Math.pow(e.c.id, 4)) / 64 * (e.c.sf == null ? 1 : e.c.sf);
                const rho = e.c.rho || RHO, mpm = (e.c.wt > 0) ? e.c.wt : rho * Math.PI / 4 * (e.c.od * e.c.od - e.c.id * e.c.id);
                const w = mpm * g * ((rho - mud) / rho) * Math.sin(inc);            // buoyed weight per m x sin(Inc)
                const Fdp = 2 * Math.sqrt(EI * w / cl);
                worst = Math.min(worst, Fdp / -Nax[ei]); });
            res.dawsonPaslayRatio = isFinite(worst) ? worst : null;   // < 1 = compression above critical somewhere
        }
        els.forEach((e, ei) => {
            const L = e.L, EI = (e.c.E || E) * Math.PI * (Math.pow(e.c.od, 4) - Math.pow(e.c.id, 4)) / 64 * (e.c.sf == null ? 1 : e.c.sf);
            const k = EI / (L * L * L);
            const ke = [[12 * k, 6 * L * k, -12 * k, 6 * L * k], [6 * L * k, 4 * L * L * k, -6 * L * k, 2 * L * L * k],
                        [-12 * k, -6 * L * k, 12 * k, -6 * L * k], [6 * L * k, 2 * L * L * k, -6 * L * k, 4 * L * L * k]];
            if (useAxial) { const nk = Nax[ei] / (30 * L);
                const kg = [[36, 3 * L, -36, 3 * L], [3 * L, 4 * L * L, -3 * L, -L * L], [-36, -3 * L, 36, -3 * L], [3 * L, -L * L, -3 * L, 4 * L * L]];
                for (let a = 0; a < 4; a++) for (let q2 = 0; q2 < 4; q2++) ke[a][q2] += nk * kg[a][q2]; }
            const w = wOf(e);                                 // acts toward low side (-y)
            const fe = [-w * L / 2, -w * L * L / 12, -w * L / 2, w * L * L / 12];
            if (e.i === bendNode) for (let a = 0; a < 4; a++) fe[a] -= ke[a][1] * bend;   // theta1 = theta + bend
            const dof = [2 * e.i, 2 * e.i + 1, 2 * e.i + 2, 2 * e.i + 3];
            for (let a = 0; a < 4; a++) { f0[dof[a]] += fe[a]; for (let q = 0; q < 4; q++) K0[dof[a]][dof[q] - dof[a] + b] += ke[a][q]; }
        });
        // Supports: pin at bit face (y0 = 0), far support on low side.
        const fixedBase = new Map([[0, 0], [far, yc[far] - c[far]]]);
        // Gauge nodes (clearance <= 0, i.e. full-gauge stabilisers/bit body) are
        // bilateral (y = 0); nodes inside the bit length are part of the bit
        // body and not wall-checked (SurQC: bit = near-end support only).
        const inBit = i => xs[i] <= M.bitLen + 1e-9;
        const active = new Map();                             // node -> y value (contact)
        let u = null, lam = null;
        const solveWith = () => {
            const K = K0.map(row => Float64Array.from(row)), f = Float64Array.from(f0);
            const fix = new Map([...fixedBase, ...active]);
            fix.forEach((val, i) => { const d = 2 * i;
                for (let j = Math.max(0, d - b); j <= Math.min(N - 1, d + b); j++) {
                    if (j === d) continue; f[j] -= K[j][d - j + b] * val; K[j][d - j + b] = 0; K[d][j - d + b] = 0; }
                K[d][b] = 1; f[d] = val; });
            u = bandSolve(K, f, N, b);
            if (!u) return;
            // reaction at each fixed y-dof: lambda = K0 u - f0  (+ = pushes toward high side)
            lam = new Map();
            fix.forEach((v, i) => { const d = 2 * i; let s = -f0[d];
                for (let j = Math.max(0, d - b); j <= Math.min(N - 1, d + b); j++) s += K0[d][j - d + b] * u[j];
                lam.set(i, s); });
        };
        if (inc === 0 && !bend && !kv && !(useAxial && WOB)) {   // no load, no bend, straight hole: centred, zero sag
            u = new Float64Array(N); lam = new Map([[0, 0], [far, 0]]);
            // No lateral load and no bend: position undefined (no low side) -> 0, as SurQC.
        } else {
            // Under axial COMPRESSION the free beam can be unstable while the
            // wall-supported one is not, so: if the solve is not positive
            // definite, (a) at the start put every wall node on the low side
            // and release from there; (b) if a release makes it unstable, undo
            // it and keep that contact ('locked'). Only if the fully supported
            // BHA is still unstable is it reported as buckled.
            const locked = new Set(); let lastReleased = null, lowStart = false;
            // Long strings (> 1500 nodes, ~150 m): start with every wall node on
            // the low side and release in bulk — most of the pipe really does lie
            // there, so this reaches the solution in a few solves instead of
            // adding thousands of contacts. Same unique solution (tested).
            if (n > 1500 && inc !== 0) { lowStart = true; for (let i = 1; i < n; i++) if (i !== far && !inBit(i)) active.set(i, yc[i] - Math.max(c[i], 0)); }
            for (let it = 0; it < maxIter; it++) {
                res.iterations = it + 1;
                solveWith();
                if (!u) {
                    if (lastReleased) { active.set(lastReleased[0], lastReleased[1]); locked.add(lastReleased[0]); lastReleased = null; continue; }
                    if (!lowStart) { lowStart = true; for (let i = 1; i < n; i++) if (i !== far && !inBit(i)) active.set(i, yc[i] - Math.max(c[i], 0)); continue; }
                    res.status = 'buckled'; break; }
                lastReleased = null;
                // 1) release contacts pulling the wrong way (wall can only push inward)
                // Fast mode (first 300 iterations, no buckling recovery in progress):
                // release ALL wrong-sign contacts at once (primal-dual active set).
                // Fallback after that: one at a time (guaranteed progress), as before.
                const fast = it < 300 && !(useAxial && WOB > 0);   // bulk release can destabilise a compressed BHA -> original one-at-a-time path
                let worst = null, wmax = 1e-6; const wrongs = [];
                active.forEach((v, i) => { if (c[i] <= 1e-12 || locked.has(i)) return;   // bilateral gauge / locked: never released
                    const l = lam.get(i), wrong = (v - yc[i] < 0 ? -l : l);     // low side needs l >= 0, high side l <= 0
                    if (wrong > 1e-6) wrongs.push(i);
                    if (wrong > wmax) { wmax = wrong; worst = i; } });
                if (fast && wrongs.length > 1) { wrongs.forEach(i => active.delete(i)); lastReleased = null; continue; }
                if (worst !== null) { lastReleased = [worst, active.get(worst)]; active.delete(worst); continue; }
                // 2) add penetrating nodes. 2026-10-24: instead of only the single
                // worst node, add the deepest node of EVERY separate penetrating
                // stretch (local maxima of penetration) in one iteration, so long
                // strings with many contact zones converge in far fewer solves
                // (a 751 m string hit the cap adding one node at a time). The
                // release step above still removes any wrong-sign contact, so the
                // converged solution (no penetration, no pulling contacts) is the
                // same — regression-tested against the one-at-a-time version.
                const penOf = i => { if (i <= 0 || i >= n || i === far || active.has(i) || inBit(i)) return -1;
                    return Math.abs(u[2 * i] - yc[i]) - Math.max(c[i], 0); };
                let added = 0;
                if (!fast) {   // fallback: single worst node, as the original scheme
                    let pen = 1e-10, pi = -1;
                    for (let i = 1; i < n; i++) { const p = penOf(i); if (p > pen) { pen = p; pi = i; } }
                    if (pi >= 0) { active.set(pi, yc[pi] + Math.sign(u[2 * pi] - yc[pi]) * Math.max(c[pi], 0)); continue; }
                    break;
                }
                for (let i = 1; i < n; i++) { const p = penOf(i); if (!(p > 1e-10)) continue;
                    if (p >= penOf(i - 1) && p > penOf(i + 1)) {   // deepest point of this stretch
                        active.set(i, yc[i] + Math.sign(u[2 * i] - yc[i]) * Math.max(c[i], 0)); added++; } }
                if (added) continue;
                break;
            }
            if (res.status !== 'buckled' && res.iterations >= maxIter) res.status = 'capped';
        }
        if (res.status === 'buckled') { res.sensorSag = null; res.elements = []; res.xs = xs; return res; }
        // residual (max penetration) for reporting
        let maxPen = 0; for (let i = 1; i < n; i++) if (!inBit(i)) maxPen = Math.max(maxPen, Math.abs(u[2 * i] - yc[i]) - Math.max(c[i], 0));
        res.residualOutOfHole = Math.max(0, maxPen); res.contacts = active.size;
        // Element-wise outputs (same meaning/sign as Beam's elements): x, shear, moment by
        // statics from the bit (V = sum R - integral w, M = integral V), slope, y, reaction.
        const R_at = new Float64Array(n); lam.forEach((l, i) => { R_at[i] = l; });
        const out = []; let V = R_at[0], Mm = 0;
        // Drop / Sag are relative to the (possibly curved) hole centreline.
        // With axial load the statics shear/moment above omit the N*y' term,
        // so the moment is taken from the FE curvature (M = EI y'') instead.
        out.push({ DistanceFromBit: 0, ShearForce: V, BendingMoment: 0, Sag: u[1], Drop: u[0], ReactionForce: R_at[0] });
        els.forEach(e => { const w = wOf(e), j = e.i + 1;
            const V1 = V - w * e.L; Mm += (V + V1) / 2 * e.L; V = V1 + R_at[j];
            let Mo = Mm;
            if (useAxial) { const EI = (e.c.E || E) * Math.PI * (Math.pow(e.c.od, 4) - Math.pow(e.c.id, 4)) / 64 * (e.c.sf == null ? 1 : e.c.sf);
                Mo = EI * (u[2 * j + 1] - u[2 * e.i + 1] - (e.i === bendNode ? bend : 0)) / e.L; }
            out.push({ DistanceFromBit: xs[j], ShearForce: useAxial ? null : V, BendingMoment: Mo, Sag: u[2 * j + 1] - kv * xs[j], Drop: u[2 * j] - yc[j], ReactionForce: R_at[j],
                AxialForce: useAxial ? Nax[e.i] : null }); });
        // slope just above the bend node is theta+ (= theta- + bend)
        if (bendNode >= 0) out[bendNode].SagAbove = u[2 * bendNode + 1] + bend;
        res.elements = out; res.bendNode = bendNode; res.xs = xs;
        // sensor slope: theta at the sensor node; if the sensor sits on the bend node use theta+
        const si = xs.findIndex(x => Math.abs(x - input.sensorPosition) < 1e-7);
        res.sensorNode = si;
        res.sensorSag = si < 0 ? null : (u[2 * si + 1] + (si === bendNode ? bend : 0) - kv * xs[si]) * 180 / Math.PI;
        // Nodes above the bend carry the physical slope (bend included via the
        // eliminated theta+ of the element starting at the bend node).
        return res;
    }

    // =====================================================================
    // solve3D — NOT USED BY THE PAGE YET (2026-10-24): exact 3-D version of
    // #6-#8 (round hole wall, lateral bend/dogleg, azimuth). Validated, but
    // 1-12 s per station; John chose 'fast planar now, 3-D later'. Kept for
    // the follow-up (needs a faster contact algorithm).
    // Kinetic with improvements #6-#8 (added 2026-10-24).
    // Same beam physics, now in two planes (y = high side, z = right side
    // looking downhole; TF 0 = high side, 90 = right), with:
    //  #6 Bend orientation: slope jump alpha*(cos TF, sin TF) at the bend.
    //  #7 Axial load: element geometric stiffness for axial force N
    //     (tension +), consistent-mass form N/(30L)[36 3L -36 3L; 3L 4L^2
    //     -3L -L^2; -36 -3L 36 -3L; 3L -L^2 -3L 4L^2] (Przemieniecki, Theory
    //     of Matrix Structural Analysis, 1968; Cook et al., Concepts and
    //     Applications of FEA). N(x) = -WOB + integral_0^x q cos(Inc) dx
    //     (compression = WOB at the bit, reduced going up by the buoyed
    //     weight component along the axis). Checked against Timoshenko &
    //     Gere beam-column closed forms (verified independently, solve_bvp).
    //     A non-positive pivot = buckled -> status 'buckled'.
    //  #8 Hole curvature: hole centreline = circular arc of curvature kappa
    //     (survey DLS) in direction TFh; in the bit-tangent frame its offset
    //     is (kappa x^2/2)(cos TFh, sin TFh) (small-angle arc), slope
    //     kappa x (cos, sin). Wall: |(y,z) - centre(x)| <= c.
    //  Contact: circular wall, frictionless, penalty springs along the
    //  current radial direction (stiffness 1e4 x max beam stiffness),
    //  active-set + direction update until stable.
    //  Supports as Beam/Kinetic-2D: bit centred (y = z = 0), far support on
    //  the low side of the (curved) wall: y = yc - c, z = zc.
    //  Output: misalignment at the sensor relative to the LOCAL hole axis:
    //    dInc = y'(s) - yc'(s)   (same sign convention as Beam: added to Inc)
    //    dLat = z'(s) - zc'(s);  dAz = dLat / sin(Inc)  (added to Az)
    //  With kappa = 0, TF = 0 (or no bend) and WOB = 0 it reduces to solve()
    //  (tested).
    // =====================================================================
    function solve3D(input, incDeg, opts) {
        opts = opts || {};
        const maxIter = Math.min(opts.maxIterations || 5000, 20000);
        const inc = incDeg * Math.PI / 180, mud = input.mudDensity, g = input.gravity;
        const bend = (input.bendAngleDeg || 0) * Math.PI / 180;
        const tfB = (input.bendTFDeg || 0) * Math.PI / 180;
        const kap = (input.curvature || 0);                    // rad/m
        const tfH = (input.holeTFDeg || 0) * Math.PI / 180;
        const WOB = input.wob || 0;                            // N, compression at bit
        const res = { inc: incDeg, status: 'ok', iterations: 0, residualOutOfHole: 0, contacts: 0 };
        const M = buildMesh(input);
        const { xs, els, r } = M, n = xs.length, ND = 4, N = ND * n, R = input.subComponents[0].od / 2;
        const c = r.map(ri => R - ri);
        const yc = xs.map(x => kap * x * x / 2 * Math.cos(tfH)), zc = xs.map(x => kap * x * x / 2 * Math.sin(tfH));
        let bendNode = -1;
        if (bend && input.bendDistance > 0) bendNode = xs.findIndex(x => Math.abs(x - input.bendDistance) < 1e-7);
        let far = n - 1, minRot = 1e10;
        for (let i = 1; i < n; i++) { if (xs[i] <= M.bitLen + 1e-9) continue;
            const rot = Math.atan(c[i] / xs[i]); if (rot <= minRot) { minRot = rot; far = i; } }
        const qOf = e => { const rho = e.c.rho || RHO, BF = (rho - mud) / rho;
            const mpm = (e.c.wt > 0) ? e.c.wt : rho * Math.PI / 4 * (e.c.od * e.c.od - e.c.id * e.c.id);
            return mpm * g * BF; };                            // buoyed weight per metre (N/m)
        // axial force at element mid (tension +)
        let acc = 0;
        // input.axialLoad === false -> no geometric stiffness (pure beam, = solve()).
        // Note: even with WOB = 0 the BHA's own weight along the axis puts it
        // in tension above the bit (hanging), which stiffens it slightly.
        const useAxial = input.axialLoad !== false;
        const Nax = els.map(e => { if (!useAxial) return 0; const q = qOf(e) * Math.cos(inc); const mid = -WOB + acc + q * e.L / 2; acc += q * e.L; return mid; });
        const b = 7;
        const K0 = Array.from({ length: N }, () => new Float64Array(2 * b + 1));
        const f0 = new Float64Array(N);
        let kmax = 0;
        els.forEach((e, k) => {
            const L = e.L, EI = (e.c.E || E) * Math.PI * (Math.pow(e.c.od, 4) - Math.pow(e.c.id, 4)) / 64 * (e.c.sf == null ? 1 : e.c.sf);
            const kk = EI / (L * L * L), Nk = Nax[k] / (30 * L);
            const ke = [[12 * kk + 36 * Nk, 6 * L * kk + 3 * L * Nk, -12 * kk - 36 * Nk, 6 * L * kk + 3 * L * Nk],
                        [6 * L * kk + 3 * L * Nk, 4 * L * L * kk + 4 * L * L * Nk, -6 * L * kk - 3 * L * Nk, 2 * L * L * kk - L * L * Nk],
                        [-12 * kk - 36 * Nk, -6 * L * kk - 3 * L * Nk, 12 * kk + 36 * Nk, -6 * L * kk - 3 * L * Nk],
                        [6 * L * kk + 3 * L * Nk, 2 * L * L * kk - L * L * Nk, -6 * L * kk - 3 * L * Nk, 4 * L * L * kk + 4 * L * L * Nk]];
            kmax = Math.max(kmax, 12 * kk);
            const w = qOf(e) * Math.sin(inc);
            for (const pl of [0, 1]) {                         // 0 = y plane, 1 = z plane
                const fe = pl === 0 ? [-w * L / 2, -w * L * L / 12, -w * L / 2, w * L * L / 12] : [0, 0, 0, 0];
                const jump = pl === 0 ? bend * Math.cos(tfB) : bend * Math.sin(tfB);
                if (e.i === bendNode && jump) for (let a = 0; a < 4; a++) fe[a] -= ke[a][1] * jump;
                const o = pl === 0 ? 0 : 2;
                const dof = [ND * e.i + o, ND * e.i + o + 1, ND * (e.i + 1) + o, ND * (e.i + 1) + o + 1];
                for (let a = 0; a < 4; a++) { f0[dof[a]] += fe[a]; for (let q2 = 0; q2 < 4; q2++) K0[dof[a]][dof[q2] - dof[a] + b] += ke[a][q2]; }
            }
        });
        const kpen = 1e4 * kmax;
        const inBit = i => xs[i] <= M.bitLen + 1e-9;
        const fixedBase = new Map([[ND * 0, 0], [ND * 0 + 2, 0], [ND * far, yc[far] - Math.max(c[far], 0)], [ND * far + 2, zc[far]]]);
        // Contact: exact frictionless circular wall |d_i| <= c_i (d = (y,z) -
        // hole centre) at every wall-checked node. The equilibrium is the
        // minimiser of the potential energy 1/2 u'Ku - f'u subject to these
        // convex (second-order-cone) constraints, solved with the log-barrier
        // interior-point method (Boyd & Vandenberghe, Convex Optimization,
        // 2004, Ch. 11): minimise t*Pi(u) - sum log(c_i^2 - |d_i|^2) by
        // Newton's method (banded Hessian) for t = 1, 10, 100, ... until the
        // duality-gap bound m/t < 1e-9 J. Contact force = 2|d|/(t(c^2-|d|^2)).
        // History: an active-set with circle facets cycled, a pure penalty was
        // ill-conditioned, an augmented-Lagrangian was exact but 0.5-3 s per
        // station; all replaced by this (2026-10-24).
        // Full-gauge nodes (clearance <= 1 um) are held on the hole centre.
        let u = null, buckled = false;
        const wallNodes = [];
        for (let i = 1; i < n; i++) { if (i === far || inBit(i)) continue;
            if (c[i] <= 1e-6) { fixedBase.set(ND * i, yc[i]); fixedBase.set(ND * i + 2, zc[i]); } else wallNodes.push(i); }
        const fixedIdx = [...fixedBase.keys()];
        const Kmul = v => { const o = new Float64Array(N); for (let r2 = 0; r2 < N; r2++) { let sm = 0;
            for (let j = Math.max(0, r2 - b); j <= Math.min(N - 1, r2 + b); j++) sm += K0[r2][j - r2 + b] * v[j]; o[r2] = sm; } return o; };
        const slack = (v, i) => { const dy = v[ND * i] - yc[i], dz = v[ND * i + 2] - zc[i]; return [dy, dz, c[i] * c[i] - dy * dy - dz * dz]; };
        const phi = (v, tt) => { const Kv = Kmul(v); let e = 0; for (let d = 0; d < N; d++) e += 0.5 * v[d] * Kv[d] - f0[d] * v[d];
            e *= tt; for (const i of wallNodes) { const sl = slack(v, i)[2]; if (!(sl > 0)) return Infinity; e -= Math.log(sl); } return e; };
        const barrierNewton = (v, tt) => {       // returns {dv, dec2} or null if Hessian not PD
            const H = K0.map(row => row.map(x => x * tt)), gr = Kmul(v);
            for (let d = 0; d < N; d++) gr[d] = tt * (gr[d] - f0[d]);
            for (const i of wallNodes) { const [dy, dz, sl] = slack(v, i), iy = ND * i, iz = ND * i + 2;
                gr[iy] += 2 * dy / sl; gr[iz] += 2 * dz / sl;
                const s2 = sl * sl;
                H[iy][b] += 2 / sl + 4 * dy * dy / s2; H[iz][b] += 2 / sl + 4 * dz * dz / s2;
                H[iy][iz - iy + b] += 4 * dy * dz / s2; H[iz][iy - iz + b] += 4 * dy * dz / s2; }
            fixedIdx.forEach(d => { for (let j = Math.max(0, d - b); j <= Math.min(N - 1, d + b); j++) { H[j][d - j + b] = 0; H[d][j - d + b] = 0; } H[d][b] = 1; gr[d] = 0; });
            const rhs = gr.map(x => -x);
            for (let k = 0; k < N; k++) { const pk = H[k][b]; if (!(pk > 0)) return null;
                for (let i2 = k + 1; i2 <= Math.min(N - 1, k + b); i2++) { const fac = H[i2][k - i2 + b] / pk; if (fac === 0) continue;
                    for (let j = k; j <= Math.min(N - 1, k + b); j++) H[i2][j - i2 + b] -= fac * H[k][j - k + b]; rhs[i2] -= fac * rhs[k]; } }
            const dv = new Float64Array(N);
            for (let i2 = N - 1; i2 >= 0; i2--) { let sm = rhs[i2]; for (let j = i2 + 1; j <= Math.min(N - 1, i2 + b); j++) sm -= H[i2][j - i2 + b] * dv[j]; dv[i2] = sm / H[i2][b]; }
            let dec2 = 0; for (let d = 0; d < N; d++) dec2 -= gr[d] * dv[d];
            return { dv, dec2 };
        };
        const radial = i => { const dy = u[ND * i] - yc[i], dz = u[ND * i + 2] - zc[i]; return [dy, dz, Math.hypot(dy, dz)]; };
        const noLoad = (incDeg === 0 && !bend && !kap && !WOB);
        let tFinal = 1;
        if (noLoad) { u = new Float64Array(N); }
        else {
            // strictly feasible start: every wall node on the hole centre
            u = new Float64Array(N);
            for (const i of wallNodes) { u[ND * i] = yc[i]; u[ND * i + 2] = zc[i]; }
            fixedBase.forEach((val, d) => { u[d] = val; });
            const m = Math.max(1, wallNodes.length);
            let tt = 1, total = 0;
            // Warm start (consecutive survey stations): skip phase 1 and start
            // the exact polish from the previous station's solution + forces,
            // after projecting nodes back inside the (new) wall.
            const warm = (opts.warm && opts.warm.N === N && opts.warm.n === n) ? opts.warm : null;
            if (warm) {
                u.set(warm.u); fixedBase.forEach((val, d) => { u[d] = val; });
                for (const i of wallNodes) { const dy = u[ND * i] - yc[i], dz = u[ND * i + 2] - zc[i], dd = Math.hypot(dy, dz);
                    if (dd > c[i]) { u[ND * i] = yc[i] + dy * c[i] / dd; u[ND * i + 2] = zc[i] + dz * c[i] / dd; } }
            }
            outer: while (!warm) {
                let F0 = phi(u, tt);
                for (let inner = 0; inner < 100; inner++) {
                    if (++total > maxIter) break outer;
                    const st = barrierNewton(u, tt); if (!st) { buckled = true; break outer; }
                    if (st.dec2 / 2 < 1e-10) break;
                    let sc = 1, un = null, Fn = Infinity;
                    for (let ls = 0; ls < 60; ls++) { un = u.map((x, d) => x + sc * st.dv[d]); Fn = phi(un, tt);
                        if (Fn <= F0 - 0.25 * sc * st.dec2) break; sc *= 0.5; }
                    if (!(Fn < Infinity)) break;
                    u = un; F0 = Fn;
                }
                if (m / tt < 1e-3) break;      // phase 1 target: ~1e-5 m positions
                tt *= 10;
            }
            tFinal = tt;
            // ---- Phase 2: exact polish by augmented Lagrangian (multipliers
            // warm-started from the barrier's contact forces, so only a few outer
            // iterations are needed). Removes the barrier's residual offset
            // from the wall; converged when no node is outside the wall (1e-10 m)
            // and contact forces are stationary.
            if (!buckled) {
                const lamA = new Float64Array(n);
                if (warm) lamA.set(warm.lam);
                else for (const i of wallNodes) { const [dy, dz, sl] = slack(u, i); lamA[i] = 2 * Math.hypot(dy, dz) / (tt * sl); }
                const rho = 1e5 * kmax;
                const gapF = (v, i) => { const dy = v[ND * i] - yc[i], dz = v[ND * i + 2] - zc[i], dd = Math.hypot(dy, dz); return [dy, dz, dd, dd - c[i]]; };
                const Lval = v => { const Kv = Kmul(v); let e = 0; for (let d = 0; d < N; d++) e += 0.5 * v[d] * Kv[d] - f0[d] * v[d];
                    for (const i of wallNodes) { const mm = Math.max(0, lamA[i] + rho * gapF(v, i)[3]); e += (mm * mm - lamA[i] * lamA[i]) / (2 * rho); } return e; };
                const almNewton = v => {
                    const H = K0.map(row => Float64Array.from(row)), gr = Kmul(v);
                    for (let d = 0; d < N; d++) gr[d] -= f0[d];
                    for (const i of wallNodes) { const [dy, dz, dd, g2] = gapF(v, i); const mm = lamA[i] + rho * g2; if (mm <= 0 || dd < 1e-15) continue;
                        const ny = dy / dd, nz = dz / dd, iy = ND * i, iz = ND * i + 2, r1 = mm / dd;
                        gr[iy] += mm * ny; gr[iz] += mm * nz;
                        H[iy][b] += rho * ny * ny + r1 * (1 - ny * ny); H[iz][b] += rho * nz * nz + r1 * (1 - nz * nz);
                        const hyz = rho * ny * nz - r1 * ny * nz; H[iy][iz - iy + b] += hyz; H[iz][iy - iz + b] += hyz; }
                    fixedIdx.forEach(d => { for (let j = Math.max(0, d - b); j <= Math.min(N - 1, d + b); j++) { H[j][d - j + b] = 0; H[d][j - d + b] = 0; } H[d][b] = 1; gr[d] = 0; });
                    const rhs = gr.map(x => -x);
                    for (let k = 0; k < N; k++) { const pk = H[k][b]; if (!(pk > 0)) return null;
                        for (let i2 = k + 1; i2 <= Math.min(N - 1, k + b); i2++) { const fac = H[i2][k - i2 + b] / pk; if (fac === 0) continue;
                            for (let j = k; j <= Math.min(N - 1, k + b); j++) H[i2][j - i2 + b] -= fac * H[k][j - k + b]; rhs[i2] -= fac * rhs[k]; } }
                    const dv = new Float64Array(N);
                    for (let i2 = N - 1; i2 >= 0; i2--) { let sm = rhs[i2]; for (let j = i2 + 1; j <= Math.min(N - 1, i2 + b); j++) sm -= H[i2][j - i2 + b] * dv[j]; dv[i2] = sm / H[i2][b]; }
                    return dv; };
                let done = false;
                for (let outerIt = 0; outerIt < 100 && !done; outerIt++) {
                    let innerOk = false;
                    for (let inner = 0; inner < 40; inner++) {
                        if (++total > maxIter) break;
                        const dv = almNewton(u); if (!dv) { buckled = true; break; }
                        let mx = 0; for (let d = 0; d < N; d += 2) mx = Math.max(mx, Math.abs(dv[d]));
                        if (mx < 1e-11) { innerOk = true; break; }
                        const L0 = Lval(u); let sc = 1, un = null;
                        for (let ls = 0; ls < 30; ls++) { un = u.map((x, d) => x + sc * dv[d]); if (Lval(un) <= L0) break; sc *= 0.5; }
                        u = un;
                    }
                    if (buckled || total > maxIter) break;
                    let gmax = 0, changed = 0;
                    for (const i of wallNodes) { const g2 = gapF(u, i)[3]; if (g2 > gmax) gmax = g2;
                        const nl = Math.max(0, lamA[i] + rho * g2);
                        if (Math.abs(nl - lamA[i]) > 1e-4 * (1 + nl) + rho * 1e-11) changed++;
                        lamA[i] = nl; }
                    done = innerOk && gmax < 1e-10 && changed === 0;
                }
                res.lamFinal = lamA;
            }
            res.iterations = total;
            if (buckled) res.status = 'buckled';
            else if (total > maxIter) res.status = 'capped';
        }
        const lam = res.lamFinal || new Float64Array(n);
        if (buckled) { res.sensorSag = null; res.sensorLat = null; res.elements = []; res.xs = xs; return res; }
        let maxPen = 0; for (let i = 1; i < n; i++) if (!inBit(i)) maxPen = Math.max(maxPen, radial(i)[2] - Math.max(c[i], 0));
        res.residualOutOfHole = Math.max(0, maxPen);
        res.contacts = wallNodes.filter(i => lam[i] > 1).length;   // contact force > 1 N
        const si = xs.findIndex(x => Math.abs(x - input.sensorPosition) < 1e-7);
        res.sensorNode = si;
        if (si < 0) { res.sensorSag = null; res.sensorLat = null; }
        else {
            const onB = si === bendNode;
            res.sensorSag = (u[ND * si + 1] + (onB ? bend * Math.cos(tfB) : 0) - kap * xs[si] * Math.cos(tfH)) * 180 / Math.PI;
            res.sensorLat = (u[ND * si + 3] + (onB ? bend * Math.sin(tfB) : 0) - kap * xs[si] * Math.sin(tfH)) * 180 / Math.PI;
            res.sensorAz = Math.abs(Math.sin(inc)) > 1e-6 ? res.sensorLat / Math.sin(inc) : null;
        }
        // plot data (high-side plane, relative to hole centreline): same fields as solve()
        res.elements = xs.map((x, i) => ({ DistanceFromBit: x, Drop: u[ND * i] - yc[i], Sag: u[ND * i + 1] - kap * x * Math.cos(tfH),
            Lateral: u[ND * i + 2] - zc[i], LatSlope: u[ND * i + 3] - kap * x * Math.sin(tfH), ShearForce: 0, BendingMoment: 0, ReactionForce: 0,
            AxialForce: i < els.length ? Nax[i] : Nax[els.length - 1] }));
        // bending moment from curvature of the FE solution (M = EI * y'' at element mid, Hermite)
        els.forEach((e, k) => { const L = e.L, EI = (e.c.E || E) * Math.PI * (Math.pow(e.c.od, 4) - Math.pow(e.c.id, 4)) / 64 * (e.c.sf == null ? 1 : e.c.sf);
            const t1 = u[ND * e.i + 1] + (e.i === bendNode ? bend * Math.cos(tfB) : 0), t2 = u[ND * (e.i + 1) + 1];
            const ypp = (t2 - t1) / L;                            // Hermite curvature at mid-element
            res.elements[k + 1].BendingMoment = EI * ypp; });   // M = EI y'' (beam's own curvature)
        res.xs = xs; res.bendNode = bendNode;
        if (u && res.lamFinal) res.warm = { N, n, u: Float64Array.from(u), lam: Float64Array.from(res.lamFinal) };
        return res;
    }

    // Survey geometry per station (2026-10-24, for #6/#8 per-station mode):
    // dogleg beta and toolface gamma of the interval ENDING at each station
    // (station i uses stations i-1 -> i), from the same spherical triangle as
    // Bourgoyne et al., Applied Drilling Engineering, Eqs. 8.45-8.49
    // (iplanCore.js applyToolfaceBeta):
    //   cos(beta) = cos(dA) sinI1 sinI2 + cosI1 cosI2   (minimum-curvature dogleg)
    //   cos(gamma) = (cosI1 cos(beta) - cosI2) / (sinI1 sin(beta))
    //   sin(gamma) = sinI2 sin(dA) / sin(beta)            (spherical law of sines)
    // gamma: 0 = high side (build), 90 = right. kappa = beta / dMD (rad/m).
    // Station 0, straight intervals and I1 ~ 0 (toolface undefined) -> kappa
    // as computed, gamma = 0 (flagged tfDefined = false).
    function stationGeometry(survey) {
        const D = Math.PI / 180;
        return survey.map((s, i) => {
            if (i === 0) return { kappa: 0, tf: 0, dls30: 0, tfDefined: false };
            const p = survey[i - 1], I1 = p.inc * D, I2 = s.inc * D, dA = (s.az - p.az) * D, dmd = s.md - p.md;
            let cb = Math.cos(dA) * Math.sin(I1) * Math.sin(I2) + Math.cos(I1) * Math.cos(I2);
            cb = Math.max(-1, Math.min(1, cb)); const beta = Math.acos(cb);
            const kappa = dmd > 0 ? beta / dmd : 0, dls30 = dmd > 0 ? beta / D * 30 / dmd : 0;
            if (beta < 1e-9 || Math.sin(I1) < 1e-6) return { kappa, tf: 0, dls30, tfDefined: false };
            const cg = (Math.cos(I1) * Math.cos(beta) - Math.cos(I2)) / (Math.sin(I1) * Math.sin(beta));
            const sg = Math.sin(I2) * Math.sin(dA) / Math.sin(beta);
            return { kappa, tf: Math.atan2(sg, cg) / D, dls30, tfDefined: true };
        });
    }

    return { solve, solve3D, buildMesh, stationGeometry };
}));

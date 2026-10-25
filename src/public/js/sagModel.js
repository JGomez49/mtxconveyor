/*
 * sagModel.js — SAGcorrection engine for MTX Conveyor (browser + Node).
 *
 * WHAT THIS IS
 *   A line-by-line JavaScript port of the BHA sag solver in SurQC
 *   (SurveyQc C# source, 2015/2016 tree: "SurQC Source Code/SurveyQc/
 *   SurveyQc/DrillString/*", Analysis/SagAnalysis.cs,
 *   Analysis/InclinationCorrection.cs, Weights/*). Ported "as is" at the
 *   user's request (2026-10-24): SurQC is the company's source of truth.
 *   Every function below names the C# member it mirrors; arithmetic order
 *   is kept identical so results match SurQC to floating-point round-off.
 *
 * PHYSICS (as implemented by SurQC, not added by MTX)
 *   Euler-Bernoulli beam, 0.1016 m (4 in) elements, integrated from the bit:
 *     V_i = V_{i-1} - w_i + R_i
 *     M_i = M_{i-1} + (V_{i-1} + V_i) * dx/2
 *     theta_i = theta_{i-1} + bend + M_i * dx / EI       ("Sag")
 *     y_i = y_{i-1} + (theta_i + theta_{i-1}) * dx/2     ("Drop")
 *   Lateral load w = steel mass * g * sin(Inc) * (7700 - rho_mud)/7700,
 *   E = 210 GPa, I = pi(OD^4 - ID^4)/64, EI scaled by stiffness factor.
 *   Wall contact solved iteratively (support rotation to low side,
 *   stabiliser centring by elastic response, "push" forces on body
 *   elements out of the hole). Hole radius = bit OD / 2.
 *   Stabiliser = OD > 0.9 x bit OD and length < 1.2 m.
 *   Bend faces HIGH SIDE; enter a negative bend when dropping angle
 *   (SurQC manual, "Creating a BHA from components").
 *   Correction table: Inc 0..90 deg every 3 deg, mirrored to 180 deg;
 *   corrected Inc = measured Inc + linear interpolation of the table.
 *
 * VERIFICATION (2026-10-24)
 *   - Original C# compiled headless (.NET 8, verbatim SurQC algorithm files
 *     + plumbing-only unit stubs) and run on identical inputs; this port
 *     must match it (see test/sagModel.test.js).
 *   - Textbook check: uniform collar between bit and far-end low-side
 *     support with no wall contact reproduces the simply-supported beam
 *     slope theta(a) = w(L^3 - 6La^2 + 4a^3)/(24EI) (Timoshenko, Strength
 *     of Materials; Roark, Formulas for Stress and Strain) plus the rigid
 *     tilt (R_hole - r_collar)/L, within 0.003 deg (lumping/discretisation).
 *
 * ONLY DEVIATION FROM SURQC (deliberate, does not change converged results)
 *   SurQC's main loop is `while (converged != true)` with no hard exit;
 *   after 30000 checks it only exits if no in-hole element carries > 5 N,
 *   and the stabiliser-centring `while` has no cap at all. That is the
 *   likely cause of SurQC freezing. Here every loop has a hard cap
 *   (opts.maxIterations); if it is hit, the result is returned with
 *   status 'capped' and the residual out-of-hole distance, instead of
 *   hanging. Converged cases are bit-for-bit the SurQC algorithm.
 *
 * KNOWN SURQC QUIRKS KEPT ON PURPOSE (port "as is"; revisit later)
 *   1. SagAtLength indexes the element list that EXCLUDES the bit element
 *      and the far-end support, so the sensor is read ~0.1-0.2 m further
 *      from the bit than entered.
 *   2. Inc = 0 returns correction 0 (solver skipped), even with a bend.
 *      NOTE: the user's SurQC screenshot shows a non-zero value at 0 deg,
 *      so the build they run may be newer than the 2016 source we have.
 *   3. The bend angle is added only if the bend falls inside the same
 *      sub-component loop (flag resets per sub-component).
 *   4. Weight is from OD/ID and steel density 7700 kg/m3 only (a T&D
 *      "kg/m" column is not used).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SagModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // BHAFiniteElement constants
    const EL = 0.1016;                 // ElementLength (m)
    const HALF = 0.0508;               // _halfElementLength
    const REACTION_TOL = 0.0005;       // ReactionForceTolerance (N)
    const OUT_OF_HOLE_TOL = 0.0025;    // BHAWithSag._outOfHoleTolerance (m)
    const INTERNAL_FORCE_TOL = 5;      // InternalForceTolerance (N)
    const STEEL_DENSITY = 7700;        // kg/m3 (SubComponentWithMechanicalProperties)
    const YOUNGS = 210 * 1e9;          // Pa

    // ---------- element (StartBHAFiniteElement / ConsecutiveBHAFiniteElement)
    function makeElement(mech, distanceFromBit, prev, bendAngle) {
        return {
            DistanceFromBit: distanceFromBit,
            ElementWeight: mech.ElementWeight,
            OutsideRadius: mech.OutsideDiameter / 2,
            Drop: 0, Sag: 0, ShearForce: 0, BendingMoment: 0, ReactionForce: 0,
            _prev: prev,
            _elos: prev ? EL / mech.Stiffness : 0,
            _bend: bendAngle || 0,
        };
    }
    function reevaluate(e) {
        if (!e._prev) {                               // StartBHAFiniteElement.EvaluateShear
            e.ShearForce = e.ReactionForce - e.ElementWeight;
            e.BendingMoment = e.ShearForce * HALF;
        } else {                                       // ConsecutiveBHAFiniteElement.EvaluateSag
            const p = e._prev;
            e.ShearForce = p.ShearForce - e.ElementWeight + e.ReactionForce;
            e.BendingMoment = p.BendingMoment + (p.ShearForce * HALF) + (e.ShearForce * HALF);
            e.Sag = p.Sag + e._bend + (e.BendingMoment * e._elos);
            e.Drop = p.Drop + (HALF * (e.Sag + p.Sag));
        }
    }
    function addR(e, d) {                              // AddToReactionForce
        e.ReactionForce += d;
        if (Math.abs(e.ReactionForce) < REACTION_TOL) { d -= e.ReactionForce; e.ReactionForce = 0; }
        return d;
    }
    function removeR(e, d) {                           // RemoveFromReactionForce
        e.ReactionForce -= d;
        if (Math.abs(e.ReactionForce) < REACTION_TOL) { d += e.ReactionForce; e.ReactionForce = 0; }
        return d;
    }
    // BHAFiniteElementExtensions
    const above = (e, hr) => e.Drop + e.OutsideRadius - hr;
    const below = (e, hr) => e.OutsideRadius - hr - e.Drop;
    const maxOut = (e, hr) => Math.max(above(e, hr), below(e, hr));
    function deltaReactionForce(e, hr, push) {
        let d = 0;
        if (above(e, hr) > 0) d = -1 * push;
        else if (below(e, hr) > 0) d = push;
        if (above(e, hr) < 0 && below(e, hr) < 0 && e.ReactionForce !== 0) {
            if (Math.abs(e.ReactionForce) < push) d = -1 * e.ReactionForce;
            else d = -1 * push * Math.sign(e.ReactionForce);
        }
        return d;
    }
    const isLastElementAtOrBefore = (e, len) =>
        len <= e.DistanceFromBit && (e.DistanceFromBit - len) < EL;
    // MoreLinq MaxBy: first element with the maximum key
    function maxBy(arr, key) {
        let best = arr[0], bk = key(arr[0]);
        for (let i = 1; i < arr.length; i++) { const k = key(arr[i]); if (k > bk) { bk = k; best = arr[i]; } }
        return best;
    }

    // ---------- SubComponentListExtensions.ShrinkStabilisers
    function shrinkStabilisers(subs) {
        if (subs.length > 1) {
            const hr = subs[0].od / 2;
            const idx = [];
            for (let i = 0; i < subs.length; i++)
                if (subs[i].od > hr * 1.8 && subs[i].len < 1.2) idx.push(i);
            idx.forEach(si => {
                const n = subs.length;
                const lengthen = (ci, extra) => { subs[ci] = Object.assign({}, subs[ci], { len: subs[ci].len + extra }); };
                if (si === 0 && n > 1) lengthen(si + 1, subs[si].len - EL);
                else if (si > 0 && si < n - 1) {
                    const h = 0.5 * (subs[si].len - EL);
                    lengthen(si - 1, h); lengthen(si + 1, h);
                } else if (si === n - 1 && si !== 0) lengthen(si - 1, subs[si].len - EL);
                subs[si] = Object.assign({}, subs[si], { len: EL });
            });
        }
    }
    // ---------- SubComponentWithMechanicalProperties
    function mechProps(sc, incRad, mud, g) {
        const ri = sc.id / 2, ro = sc.od / 2;
        const volume = Math.PI * (ro + ri) * (ro - ri) * sc.len;
        const mass = STEEL_DENSITY * volume;
        let weight = mass * (g * Math.sin(incRad));          // VerticalForce(mass, VerticalAcceleration)
        weight *= ((7700.0 - mud) / 7700.0);
        const I = Math.PI * (Math.pow(sc.od, 4) - Math.pow(sc.id, 4)) / 64;
        return {
            sc, OutsideDiameter: sc.od, Weight: weight,
            ElementWeight: sc.len > 0 ? weight * (EL / sc.len) : weight * 10000,
            Stiffness: YOUNGS * I * (sc.sf == null ? 1 : sc.sf),
        };
    }
    // ---------- SubComponentsWithMechanicalPropertiesExtensions.CreateFiniteElements
    function createFiniteElements(mechs, bendDist, bendRad) {
        const fe = [];
        mechs.forEach(m => {
            const n = Math.trunc(m.sc.len / EL);           // (int)(Length / ElementLength)
            let addBend = false, prev;
            let start = 0;
            if (fe.length === 0) {
                prev = makeElement(m, EL, null, 0);
                reevaluate(prev);                           // StartBHAFiniteElement ctor
                fe.push(prev); start = 1;
            } else prev = fe[fe.length - 1];
            for (let i = start; i < n; i++) {
                const e = makeElement(m, prev.DistanceFromBit + EL, prev, !addBend ? 0 : bendRad);
                fe.push(e); prev = e;
                addBend = isLastElementAtOrBefore(e, bendDist);
            }
        });
        return fe;
    }
    // ---------- BHAFiniteElementsExtensions
    function farEndSupport(fe) {
        let minRot = 1e10; const hr = fe[0].OutsideRadius; let far = fe[0];
        for (let i = 1; i < fe.length; i++) {
            const rot = Math.atan((hr - fe[i].OutsideRadius) / fe[i].DistanceFromBit);
            if (rot <= minRot) { minRot = rot; far = fe[i]; }
        }
        return far;
    }
    function rotateSupportsToLowSide(fe, far) {
        const gap = fe[0].OutsideRadius - far.OutsideRadius;
        const dpl = (far.Drop + gap) / far.DistanceFromBit;
        const corr = Math.atan(dpl);
        for (let i = 0; i < fe.length; i++) {
            if (i !== 0) fe[i].Drop -= dpl * fe[i].DistanceFromBit;
            fe[i].Sag -= corr;
        }
    }
    function distributeExtraForceToEnds(near, far, f, x) {
        const m = f * x;
        if (far.DistanceFromBit !== 0) {
            const ff = m / far.DistanceFromBit;
            removeR(far, ff); addR(near, ff); removeR(near, f);
        }
    }
    const reevalAll = fe => { for (let i = 0; i < fe.length; i++) reevaluate(fe[i]); };

    // ---------- BHAWithSag
    function solveAtInclination(input, incDeg, opts) {
        opts = opts || {};
        const maxIter = opts.maxIterations || 200000;
        const incRad = incDeg * Math.PI / 180;
        const result = { inc: incDeg, status: 'ok', iterations: 0, residualOutOfHole: 0, elements: [], ewf: [], subLen: 0 };
        let subs = input.subComponents.map(s => ({ name: s.name, od: s.od, id: s.id, len: s.len, sf: s.sf }));
        if (!(subs.length > 0 && incRad !== 0)) return result;
        shrinkStabilisers(subs);
        const mud = input.mudDensity, g = input.gravity;
        const mechs = subs.map(s => mechProps(s, incRad, mud, g));
        const fe = createFiniteElements(mechs, input.bendDistance || 0, (input.bendAngleDeg || 0) * Math.PI / 180);
        const far = farEndSupport(fe), near = fe[0];
        // SetInitialReactionForces
        let sumM = 0, cum = 0;
        mechs.forEach(m => { sumM += m.Weight * (cum + m.sc.len / 2); cum += m.sc.len; });
        let sumW = 0; mechs.forEach(m => { sumW += m.Weight; });
        addR(far, sumM / far.DistanceFromBit);
        addR(near, sumW);
        removeR(near, far.ReactionForce);
        reevalAll(fe);
        rotateSupportsToLowSide(fe, far);
        const hr = subs[0].od / 2;
        const hrFe = fe[0].OutsideRadius;
        const stabs = fe.filter(e => hrFe - e.OutsideRadius < 0.0025).filter(e => e !== fe[0]);
        { const k = stabs.indexOf(far); if (k >= 0) stabs.splice(k, 1); }
        const ERF = 50;
        let guard = 0;
        // ElasticResponses
        const er = new Map();
        stabs.forEach(st => {
            let orig = st.Drop, resp = 0, prevResp = 0, conv = false;
            for (let i = 0; i < 100 && !conv; ++i) {
                addR(st, ERF);
                distributeExtraForceToEnds(near, far, ERF, st.DistanceFromBit);
                reevalAll(fe); rotateSupportsToLowSide(fe, far);
                resp = st.Drop - orig;
                conv = Math.abs(resp - prevResp) < 1e-8;
                prevResp = resp; orig = st.Drop;
            }
            er.set(st, resp);
        });
        // CreateFiniteElementsWithReactionForces (push = 0)
        let push = 0;
        const ewf = [];
        for (let i = 1; i < fe.length; i++) if (fe[i] !== far) {
            const w = { el: fe[i], delta: 0 };
            w.delta = addR(fe[i], deltaReactionForce(fe[i], hr, push));
            ewf.push(w);
        }
        const maxChecks = 40 * ewf.length < 30000 ? 30000 : 40 * ewf.length;
        const nonStab = ewf.filter(w => w.el.OutsideRadius < hr);
        let last = [];
        let numChecks = 0;
        const listMaxOut = () => {
            if (!nonStab.length) return 0;
            let mb = -Infinity, ma = -Infinity;
            nonStab.forEach(w => { const b = below(w.el, hr), a = above(w.el, hr); if (b > mb) mb = b; if (a > ma) ma = a; });
            return mb > ma ? mb : ma;
        };
        const internalForce = () => {
            const inHole = nonStab.filter(w => maxOut(w.el, hr) < -1e-3);
            return !inHole.every(w => Math.abs(w.el.ReactionForce) < INTERNAL_FORCE_TOL);
        };
        push = 5;
        let converged = false;
        while (converged !== true) {
            if (++guard > maxIter) { result.status = 'capped'; break; }
            // DistributeForces -> CentraliseStabilisers
            const tolS = 0.005 * push > OUT_OF_HOLE_TOL ? 0.005 * push : OUT_OF_HOLE_TOL;
            if (stabs.length > 0) {
                const hrS = fe[0].OutsideRadius;
                let most = maxBy(stabs, e => maxOut(e, hrS));
                let mx = maxOut(most, hrS);
                while (mx > tolS) {
                    if (++guard > maxIter) break;
                    const resp = er.get(most);
                    const da = above(most, hrS), db = below(most, hrS);
                    let d = ERF;
                    if (da > 0) d = -1 * ERF * (da / resp);
                    if (db > 0) d = ERF * (db / resp);
                    addR(most, d);
                    distributeExtraForceToEnds(near, far, d, most.DistanceFromBit);
                    reevalAll(fe); rotateSupportsToLowSide(fe, far);
                    most = maxBy(stabs, e => maxOut(e, hrS));
                    mx = maxOut(most, hrS);
                }
                if (guard > maxIter) { result.status = 'capped'; break; }
            }
            // UpdateReactionForces
            nonStab.forEach(w => { w.delta = addR(w.el, deltaReactionForce(w.el, hr, push)); });
            let extraM = 0; nonStab.forEach(w => { extraM += w.delta * w.el.DistanceFromBit; });
            if (far.DistanceFromBit !== 0) {
                const ff = extraM / far.DistanceFromBit;
                removeR(far, ff); addR(near, ff);
                let sd = 0; nonStab.forEach(w => { sd += w.delta; });
                removeR(near, sd);
            }
            reevalAll(fe); rotateSupportsToLowSide(fe, far);
            // Converged()
            converged = numChecks > maxChecks;
            if (!converged) {
                const tol = 0.005 * push > OUT_OF_HOLE_TOL ? 0.005 * push : OUT_OF_HOLE_TOL;
                converged = listMaxOut() < tol;
            } else converged = !internalForce();
            ++numChecks;
            if (converged) {
                if (push > 0.1) { push *= 0.5; converged = false; }
                else converged = !internalForce();
            }
            // AddedAndRemovedForcesAreEqual
            let equal = last.length === nonStab.length;
            for (let i = 0; i < nonStab.length && equal; ++i) equal = Math.abs(nonStab[i].delta + last[i]) < 1e-3;
            if (equal && !last.every(v => Math.abs(v) < 1e-6)) { push *= 0.75; converged = false; }
            last = nonStab.map(w => w.delta);
        }
        result.iterations = guard;
        result.residualOutOfHole = listMaxOut();
        result.elements = fe;
        result.ewf = ewf.map(w => w.el);
        result.subLen = mechs.reduce((s, m) => s + m.sc.len, 0);
        return result;
    }

    // BHAWithSag.SagAtLength -> degrees (null + failure if beyond BHA)
    function sagAtLength(res, length) {
        if (res.ewf.length === 0) return { value: 0 };
        const byEl = EL * res.ewf.length;
        if (length > byEl) {
            if (length > res.subLen) return { value: null, failure: 'LengthMustBeLessThanLengthOfBHA' };
            return { value: res.ewf[res.ewf.length - 1].Sag * 180 / Math.PI };
        }
        const idx = Math.trunc(length / EL);
        if (idx >= res.ewf.length) return { value: null, failure: 'IndexOutOfRange (SurQC would throw)' };
        return { value: res.ewf[idx].Sag * 180 / Math.PI };
    }

    // SagAnalysis.CalculateCorrections + AddPiTo2PiCorrections (degrees)
    function correctionTable(input, opts) {
        const rows = [];
        for (let i = 0; i < 31; ++i) {
            const inc = i * 3;
            const r = solveAtInclination(input, inc, opts);
            const s = sagAtLength(r, input.sensorPosition);
            rows.push({ inc, corr: s.value, status: s.failure ? 'failed: ' + s.failure : r.status,
                        iterations: r.iterations, residualOutOfHole: r.residualOutOfHole });
        }
        const n = rows.length, full = rows.slice();
        for (let i = n - 2; i > 0; --i) full.push({ inc: 180 - rows[i].inc, corr: rows[i].corr, mirrored: true });
        full.push({ inc: 180 - 1e-6 * 180 / Math.PI, corr: rows[0].corr, mirrored: true });
        return { rows, full };
    }

    // InclinationCorrectionExtensions.Correction: two nearest table points,
    // straight-line through them (LinearInterpolation). Degrees in/out.
    function correctionAt(full, incDeg) {
        if (!full.length) return 0;
        const sorted = full.slice().sort((a, b) => a.inc - b.inc);
        const pick = list => { let b = list[0]; for (const c of list) if (Math.abs(c.inc - incDeg) < Math.abs(b.inc - incDeg)) b = c; return b; };
        const a = pick(sorted); sorted.splice(sorted.indexOf(a), 1);
        const b = pick(sorted);
        if (a.corr == null || b.corr == null) return null;
        return a.corr + (incDeg - a.inc) * (b.corr - a.corr) / (b.inc - a.inc);
    }

    // Minimum curvature (Bourgoyne et al., Applied Drilling Engineering,
    // SPE 1986, Ch. 8 Eqs. 8.33-8.37 — same method used in iplanCore.js).
    // stations: [{md, inc, az}] degrees; tie: {tvd, n, e} of station 0.
    // Returns [{md, inc, az, tvd, n, e, dls}] (dls in deg per 30 m).
    function minimumCurvature(stations, tie) {
        const D = Math.PI / 180, out = [];
        let tvd = tie ? tie.tvd : 0, n = tie ? tie.n : 0, e = tie ? tie.e : 0;
        stations.forEach((s, i) => {
            if (i === 0) { out.push({ md: s.md, inc: s.inc, az: s.az, tvd, n, e, dls: 0 }); return; }
            const p = stations[i - 1];
            const i1 = p.inc * D, i2 = s.inc * D, a1 = p.az * D, a2 = s.az * D, dmd = s.md - p.md;
            let cb = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
            cb = Math.min(1, Math.max(-1, cb));
            const b = Math.acos(cb);
            const rf = b < 1e-9 ? 1 : (2 / b) * Math.tan(b / 2);
            n += dmd / 2 * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * rf;
            e += dmd / 2 * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * rf;
            tvd += dmd / 2 * (Math.cos(i1) + Math.cos(i2)) * rf;
            out.push({ md: s.md, inc: s.inc, az: s.az, tvd, n, e, dls: dmd > 0 ? b / D * 30 / dmd : 0 });
        });
        return out;
    }

    // Apply a correction table to a survey: corrected Inc = Inc + corr(Inc)
    // (SurQC CorrectedSurveyMeasurement.Inc). MD and Az unchanged.
    function correctSurvey(survey, full, tie) {
        const corrected = survey.map(s => {
            const c = correctionAt(full, s.inc);
            return { md: s.md, az: s.az, incRaw: s.inc, corr: c, inc: c == null ? s.inc : s.inc + c };
        });
        const raw = minimumCurvature(survey, tie);
        const cor = minimumCurvature(corrected, tie);
        return corrected.map((s, i) => Object.assign({}, s, {
            tvdRaw: raw[i].tvd, nRaw: raw[i].n, eRaw: raw[i].e,
            tvd: cor[i].tvd, n: cor[i].n, e: cor[i].e, dls: cor[i].dls,
            dTvd: cor[i].tvd - raw[i].tvd, dN: cor[i].n - raw[i].n, dE: cor[i].e - raw[i].e,
        }));
    }

    // Per-station variant (2026-10-24, Kinetic per-station mode): corr[i]
    // (deg or null) already computed for each station; same output as
    // correctSurvey. Engine code above is unchanged.
    function correctSurveyPerStation(survey, corrs, tie) {
        const corrected = survey.map((s, i) => { const c = corrs[i];
            return { md: s.md, az: s.az, incRaw: s.inc, corr: c, inc: c == null ? s.inc : s.inc + c }; });
        const raw = minimumCurvature(survey, tie), cor = minimumCurvature(corrected, tie);
        return corrected.map((s, i) => Object.assign({}, s, {
            tvdRaw: raw[i].tvd, nRaw: raw[i].n, eRaw: raw[i].e, tvd: cor[i].tvd, n: cor[i].n, e: cor[i].e, dls: cor[i].dls,
            dTvd: cor[i].tvd - raw[i].tvd, dN: cor[i].n - raw[i].n, dE: cor[i].e - raw[i].e }));
    }

    return { solveAtInclination, sagAtLength, correctionTable, correctionAt, minimumCurvature, correctSurvey, correctSurveyPerStation, ELEMENT_LENGTH: EL };
}));

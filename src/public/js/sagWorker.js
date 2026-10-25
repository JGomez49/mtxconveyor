/*
 * sagWorker.js — Web Worker for the SAGcorrection page (added 2026-10-24).
 * Runs the SurQC-port sag solver (sagModel.js) off the main thread so the
 * page can never freeze (SurQC itself hangs on some BHAs — see the header
 * of sagModel.js). Messages:
 *   {type:'table',   input, opts}  -> {type:'row', row} per inclination, then {type:'table', table}
 *   {type:'profile', input, inc, opts} -> {type:'profile', res}
 */
importScripts('/js/sagModel.js', '/js/sagKinetic.js');
// 2026-10-24: model selector. m.model = 'Beam' (SurQC port, sagModel.js —
// default) or 'Kinetic' (same physics, exact FE + active-set contact,
// sagKinetic.js). Both return the same element fields for the plots.
function solveOne(model, input, inc, opts) {
    if (model === 'Kinetic') {
        const r = SagKinetic.solve(input, inc, opts);
        return { r, s: r.sensorSag == null ? { value: null, failure: 'SensorBeyondBHA' } : { value: r.sensorSag } };
    }
    const r = SagModel.solveAtInclination(input, inc, opts);
    return { r, s: SagModel.sagAtLength(r, input.sensorPosition) };
}
self.onmessage = function (ev) {
    const m = ev.data;
    try {
        if (m.type === 'profile') {
            const { r, s } = solveOne(m.model, m.input, m.inc, m.opts);
            self.postMessage({ type: 'profile', res: {
                inc: m.inc, status: r.status, iterations: r.iterations,
                residualOutOfHole: r.residualOutOfHole, sensorSag: s.value, failure: s.failure || null,
                x: r.elements.map(e => e.DistanceFromBit), shear: r.elements.map(e => e.ShearForce),
                moment: r.elements.map(e => e.BendingMoment), sag: r.elements.map(e => e.Sag * 180 / Math.PI),
                drop: r.elements.map(e => e.Drop), reaction: r.elements.map(e => e.ReactionForce),
            } });
        } else if (m.type === 'stations') {
            // 2026-10-24 per-station mode (Kinetic planar #6-#8): one solve per
            // survey station with that station's dogleg/toolface/WOB.
            // m.stations = [{md, inc, curvatureV, bendTFDeg, wob}] (wob in N)
            const out = [];
            m.stations.forEach((st, k) => {
                const inp = Object.assign({}, m.input, { curvatureV: st.curvatureV, bendTFDeg: st.bendTFDeg, wob: st.wob });
                const incS = st.inc > 90 ? 180 - st.inc : st.inc;   // as SurQC: 90-180 mirrors 0-90
                const r = SagKinetic.solve(inp, incS, m.opts);
                out.push({ corr: r.status === 'ok' ? r.sensorSag : null, status: r.status, iterations: r.iterations, dp: r.dawsonPaslayRatio == null ? null : r.dawsonPaslayRatio });
                if (k % 5 === 0 || k === m.stations.length - 1) self.postMessage({ type: 'stationProgress', done: k + 1, total: m.stations.length });
            });
            self.postMessage({ type: 'stations', results: out });
        } else if (m.type === 'table') {
            const rows = [];
            for (let i = 0; i < 31; ++i) {
                const inc = i * 3;
                const { r, s } = solveOne(m.model, m.input, inc, m.opts);
                // A capped (non-converged) or failed solve is NOT a valid
                // correction: corr = null so it is never applied to a survey;
                // the raw last-iterate value is kept only for display.
                const st = s.failure ? 'failed: ' + s.failure : r.status;
                const row = { inc, corr: st === 'ok' ? s.value : null, rawValue: s.value, status: st,
                              iterations: r.iterations, residualOutOfHole: r.residualOutOfHole };
                rows.push(row);
                self.postMessage({ type: 'row', row, done: i + 1, total: 31 });
            }
            // Mirror exactly as SagAnalysis.AddPiTo2PiCorrections
            const full = rows.slice();
            for (let i = rows.length - 2; i > 0; --i) full.push({ inc: 180 - rows[i].inc, corr: rows[i].corr, mirrored: true });
            full.push({ inc: 180 - 1e-6 * 180 / Math.PI, corr: rows[0].corr, mirrored: true });
            self.postMessage({ type: 'table', table: { rows, full, model: m.model || 'Beam' } });
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: String(err && err.message || err) });
    }
};

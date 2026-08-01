const { Schema, model } = require("mongoose");

// Stores the Bit Hydraulics Program's input parameters (drill string,
// annulus/casing geometry, mud/pump params) and computed results PER
// WELL for one job, mirroring models/TDModel.js exactly:
//   - uploadHydraulics.ejs can reload/save a specific well's setup when
//     the same Job ID (MTX ID) + well is selected again
//   - job.ejs shows a read-only summary via the shared calculation module
//     (src/public/js/hydraulicsModel.js)
//
// SCENARIOS: same job-wide scenario pattern as TDModel — a job can hold
// several named scenarios (e.g. "6.125in Bit" / "8.5in Bit"), scenario
// names are shared across every well in the job, and each scenario has
// its own resultsByWell underneath. Exactly one scenario is "active"
// (activeScenario); the TOP-LEVEL resultsByWell always mirrors the active
// scenario's resultsByWell so job.ejs's accordion needs no scenario-aware
// code.
//
// All calculation uses the ONE shared module (src/public/js/hydraulicsModel.js,
// loaded by both the browser and this backend) — this collection only
// stores the resulting numbers. Physics basis: Bourgoyne et al., "Applied
// Drilling Engineering," SPE Textbook Series Vol. 2, 1986 — see the
// citation block at the top of hydraulicsModel.js.
const HydraulicsModelSchema = new Schema({
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, unique: true },

    // resultsByWell[wellKey] = {
    //   drillString, annulusGeom, params,  // inputs, mirror getDrillString()/getAnnulusGeom()/getParams()
    //   results,                           // output of HydraulicsModel.computeHydraulics()
    //   calculatedAt,
    //   calculatedByName,
    //   calculatedByUserId,
    // }
    // Always mirrors scenarios[activeScenario].resultsByWell.
    resultsByWell: { type: Schema.Types.Mixed, default: {} },

    // scenarios[scenarioName] = { resultsByWell: { <same shape as above> } }
    scenarios: { type: Schema.Types.Mixed, default: {} },
    activeScenario: { type: String, default: '' },

    user:         { type: Schema.Types.ObjectId, ref: "User" },
    calculatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("HydraulicsModel", HydraulicsModelSchema);

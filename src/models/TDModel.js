const { Schema, model } = require("mongoose");

// Stores the Torque & Drag Modeler's input parameters (casing, BHA, global
// params) and computed results PER WELL/LEG for one job, so:
//   - uploadTorqueAndDrag.ejs can reload/save a specific well's parameters
//     when the same Job ID (MTX ID) + well is selected again
//   - job.ejs can show results read-only, and recalculate live for any
//     subject well via the shared calculation module (src/public/js/tdModel.js)
//
// One document per job (noteId unique); resultsByWell keys are well/leg
// names (e.g. "[01]ETS 160504_L01"), each holding its own casings/bha/
// params/results plus who calculated it and when — switching wells never
// overwrites another well's saved run.
//
// All calculation uses the ONE shared soft-string (Johancsik 1984) module
// (src/public/js/tdModel.js, loaded by both the browser and this backend)
// — this collection only stores the resulting numbers.
const TDModelSchema = new Schema({
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, unique: true },

    // resultsByWell[wellKey] = {
    //   casings, bha, params,   // inputs, mirror getCasings()/getBHA()/getParams()
    //   results,                // display-unit arrays, ready for the Chart.js configs
    //   calculatedAt,           // Date
    //   calculatedByName,       // display name, e.g. "Camilo"
    //   calculatedByUserId,     // ref to User
    // }
    resultsByWell: { type: Schema.Types.Mixed, default: {} },

    // Legacy single-well fields, kept only so documents saved before this
    // per-well migration still read back correctly (see getTDModel).
    wellKey: { type: String, default: "" },
    casings: { type: Schema.Types.Mixed, default: [] },
    bha:     { type: Schema.Types.Mixed, default: [] },
    params:  { type: Schema.Types.Mixed, default: {} },
    results: { type: Schema.Types.Mixed, default: null },
    user:         { type: Schema.Types.ObjectId, ref: "User" },
    calculatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("TDModel", TDModelSchema);

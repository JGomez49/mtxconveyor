const { Schema, model } = require("mongoose");

// PipeStretchCase: a saved case from the standalone PipeStretch tool
// (src/views/pipeStretch.ejs), added 2026-10-25. Same shared, role-based
// pattern as SagCorrectionCase / SixAxisCase (viewer read-only; leader/user
// delete only their own; admin any). Stores inputs only (string rows, model,
// load case, temperatures, T&D casing/friction set, survey); results are
// always recomputed with public/js/stretchModel.js.
const PipeStretchCaseSchema = new Schema({
    user:      { type: Schema.Types.ObjectId, ref: "User", required: true },
    name:      { type: String, required: true, trim: true },
    inputData: { type: Schema.Types.Mixed, default: {} },
    survey:    { type: [Schema.Types.Mixed], default: [] },   // [{md, inc, az}] m / deg
}, { timestamps: true });

module.exports = model("PipeStretchCase", PipeStretchCaseSchema);

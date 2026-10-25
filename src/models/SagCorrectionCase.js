const { Schema, model } = require("mongoose");

// SagCorrectionCase: a saved case from the standalone SAGcorrection tool
// (src/views/sagCorrection.ejs), added 2026-10-24. Same shared, role-based
// pattern as SixAxisCase: every allowed rank can list/load any case,
// viewer cannot save/delete, leader/user delete only their own, admin any.
// Stores the inputs verbatim (BHA rows in display units, sag inputs, and
// the survey source) so reloading reproduces the analysis; results are
// always recomputed with public/js/sagModel.js, never stored.
const SagCorrectionCaseSchema = new Schema({
    user:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    name:   { type: String, required: true, trim: true },
    // { unit, bhaRows:[{name, od_mm, id_mm, len, sf, material}], sensor, mudWeight,
    //   bendDist, bendDeg, bhaLimit, source:{mtxJobId, wellKey, scenario} }
    inputData: { type: Schema.Types.Mixed, default: {} },
    // [{md, inc, az}] as imported/loaded (degrees, metres)
    survey: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true });

module.exports = model("SagCorrectionCase", SagCorrectionCaseSchema);

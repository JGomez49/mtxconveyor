const { Schema, model } = require("mongoose");

// NewSchedule: a single-document store for the raw uploaded schedule file.
// Every upload REPLACES this one document — no per-row documents, no
// batch-ID bookkeeping, no risk of stale/mixed rows across uploads.
const NewScheduleSchema = new Schema({
    headers:     { type: [String], default: [] },   // exact column headers, in order
    rows:        { type: [[Schema.Types.Mixed]], default: [] }, // one array per row, aligned to headers
    user:        { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt:  { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("NewSchedule", NewScheduleSchema);

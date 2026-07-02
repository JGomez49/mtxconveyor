const { Schema, model } = require("mongoose");

// Stores the Avg/Max/Min curves for all 7 Pason EDR plots for one job,
// exported from uploadPason.ejs as a single Excel file (1 sheet per plot)
// and re-uploaded here. One document per job — a fresh upload replaces it.
const PasonPlotsSchema = new Schema({
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, unique: true },
    // plots: { hl: { xHeader, rows: [[x, avg, max, min], ...] }, tq: {...}, ... }
    plots:      { type: Schema.Types.Mixed, default: {} },
    user:       { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("PasonPlots", PasonPlotsSchema);

const { Schema, model } = require("mongoose");

// Stores the PAD AC risk summary for one job (note).
// Each row = one offset well's worst-case AC station (16 columns).
const PadACSchema = new Schema({
    noteId:    { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, unique: true },
    headers:   { type: [String], default: [] },   // CUSTOM_HEADERS at save time
    rows:      { type: [[Schema.Types.Mixed]], default: [] }, // array of 16-value arrays
    uploadedAt:{ type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("PadAC", PadACSchema);

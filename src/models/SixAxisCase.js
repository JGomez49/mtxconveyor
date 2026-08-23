const { Schema, model } = require("mongoose");

// SixAxisCase: a saved "case" from the standalone 6-axis Data tool
// (src/views/sixAxisData.ejs). Added 2026-08-23 per the person's request
// to persist work between sessions — the tool itself stays standalone
// (not tied to a job/note), but cases are now saved per-user so they can
// be named, listed, reloaded, and deleted later.
//
// Stores exactly what was asked for: the raw imported Excel rows (as last
// loaded via Import Excel File / Use Already Uploaded File, whichever
// panel was used) and the full Input Data panel state, so reloading a
// case reproduces both the source data and the entry fields without
// re-uploading or re-typing anything.
const SixAxisCaseSchema = new Schema({
    user:      { type: Schema.Types.ObjectId, ref: "User", required: true },
    name:      { type: String, required: true, trim: true },

    // Raw uploaded Excel rows, header row included (row[0] = ["MD","Gx","Gy","Gz","Bx","By","Bz"]).
    rawRows:   { type: [[Schema.Types.Mixed]], default: [] },

    // Input Data panel fields, verbatim (strings, as read from the form
    // inputs) so reload can just set .value on each field.
    inputData: {
        mdInput:   { type: String, default: "" },
        gx:        { type: String, default: "" },
        gy:        { type: String, default: "" },
        gz:        { type: String, default: "" },
        bx:        { type: String, default: "" },
        by:        { type: String, default: "" },
        bz:        { type: String, default: "" },
        gxUnit:    { type: String, default: "g" },
        gyUnit:    { type: String, default: "g" },
        gzUnit:    { type: String, default: "g" },
        bxUnit:    { type: String, default: "nt" },
        byUnit:    { type: String, default: "nt" },
        bzUnit:    { type: String, default: "nt" },
        refBT:     { type: String, default: "" },
        refGT:     { type: String, default: "" },
        refInc:    { type: String, default: "" },
        refAz:     { type: String, default: "" },
        refDip:    { type: String, default: "" },
        refDec:    { type: String, default: "" },
        incError:  { type: String, default: "" },
        dipError:  { type: String, default: "" },
        azError:   { type: String, default: "" },
    },
}, { timestamps: true });

module.exports = model("SixAxisCase", SixAxisCaseSchema);

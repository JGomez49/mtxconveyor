const { Schema, model } = require("mongoose");

// SagMaterial (added 2026-10-24, SAGcorrection improvement #5): user-defined
// BHA materials for the Kinetic sag model. No non-steel values are shipped
// with MTX on purpose (no verified source) — users enter density and
// Young's modulus from their vendor spec sheets, with the source in `notes`.
// "Steel" (7700 kg/m3, 210 GPa = SurQC's constants) is built into the page
// and is not stored here. Shared across users; viewer cannot create/delete;
// leader/user delete only their own, admin any (same matrix as saved cases).
const SagMaterialSchema = new Schema({
    user:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    name:    { type: String, required: true, trim: true },
    density: { type: Number, required: true },   // kg/m3
    youngs:  { type: Number, required: true },   // Pa
    notes:   { type: String, default: "" },      // e.g. "Vendor X spec sheet rev 3"
}, { timestamps: true });

module.exports = model("SagMaterial", SagMaterialSchema);

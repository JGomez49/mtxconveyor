// ADDED 2026-10-28 (John): "Design Codes" — CNRL directional trajectory design
// guidelines (one document per code, e.g. T-001 SAGD, E-002 HEAVY OIL Hockey
// Stick). Seeded ONCE from CNRL_Design_Codes.xlsx (src/data/designCodes/
// seed.json + img/, pictures uploaded to Cloudinary folder "mtx-design-codes")
// when the collection is empty; maintained in MTX afterwards on
// /notes/designCodes (everyone can read, only admin can edit).
// Every sheet of the workbook follows the same template: Hole Section ->
// Parameter -> Description, so a code is: header fields + sections[] of
// {param, value, note} rows + pictures. A row with a param and no value is
// shown as a sub-heading (e.g. "Default Survey Program").
// code 'GENERAL' holds the Contents-sheet block that applies to all codes
// (province set-backs, sponsor approval, authors) and is shown on top.
// updatedDate is set automatically on each save; log[] keeps who/when/what.
const {Schema, model} = require('mongoose');

const RowSchema = new Schema({
    param: { type: String, default: '' },
    value: { type: String, default: '' },
    note:  { type: String, default: '' },
}, { _id: false });

const SectionSchema = new Schema({
    title: { type: String, default: '' },
    rows:  { type: [RowSchema], default: [] },
}, { _id: false });

const ImageSchema = new Schema({
    url:       { type: String, required: true },
    public_id: { type: String, default: '' },
    section:   { type: String, default: '' },   // shown under this section ('' = end of page)
    caption:   { type: String, default: '' },
}, { _id: true });

const DesignCodeSchema = new Schema({
    code:        { type: String, required: true, trim: true, unique: true },
    group:       { type: String, default: '' },   // Thermal / East / Central / West
    area:        { type: String, default: '' },
    formations:  { type: String, default: '' },
    updatedDate: { type: String, default: '' },   // YYYY-MM-DD
    sections:    { type: [SectionSchema], default: [] },
    images:      { type: [ImageSchema], default: [] },
    log:         { type: [{ user: String, at: Date, what: String }], default: [] },
},{ timestamps: true });

module.exports = model('DesignCode', DesignCodeSchema);

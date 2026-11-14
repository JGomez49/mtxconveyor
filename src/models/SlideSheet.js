// ADDED 2026-11-13 (John): slide sheets built from the rig EDR (views/slideSheet.ejs, public/js/slideSheetModel.js),
// saved per job + well. The LAS file itself is NOT stored (too big, ~200+ MB): only the result (slide / rotate
// intervals with their statistics), the detection settings, the hole-depth segments with the role the user gave
// each one (Main / Leg 2… / Ignore) and the LAS metadata, so the sheet can be shown on the job page and used by
// the slide-sheet survey correction (next step).
const { Schema, model } = require('mongoose');

const SlideSheetSchema = new Schema({
    noteId:     { type: Schema.Types.ObjectId, ref: 'NoteConveyor', required: true, index: true },
    mtxJobId:   { type: String, default: '' },
    wellKey:    { type: String, required: true },
    name:       { type: String, required: true, trim: true },
    tdScenario: { type: String, default: '' },
    las:        { file: String, well: String, rig: String, rows: Number, tStart: Number, tEnd: Number },
    settings:   { type: Schema.Types.Mixed, default: {} },
    roles:      [String],                                 // per hole-depth segment
    segments:   { type: [Schema.Types.Mixed], default: [] },
    intervals:  { type: [Schema.Types.Mixed], default: [] },  // {leg, run, mode, from, to, len, tf, tfRef, tfSd, rop, wob, difp, rpm, incStart, incEnd, azStart, azEnd, tStart, tEnd}
    summary:    { type: Schema.Types.Mixed, default: {} },
    user:       { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
SlideSheetSchema.index({ noteId: 1, wellKey: 1, name: 1 }, { unique: true });

module.exports = model('SlideSheet', SlideSheetSchema);

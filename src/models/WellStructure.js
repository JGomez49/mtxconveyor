// ADDED 2026-11-15 (John): well structure — Job (pad/site, NoteConveyor) -> Well -> Wellbore -> Run.
// PHASE 1 = an INDEX over the existing data. Nothing existing is moved or copied:
//   - Wellbore.wellKey is the exact well name every module already uses (WellboreTrajectory.wellName,
//     TDModel / Hydraulics / CasingDesign resultsByWell[wellKey], SlideSheet.wellKey, SAG source.wellKey).
//   - Run points to the T&D plan run by (tdScenario, tdRunId); BHA / surveys / cases are looked up live.
// Deleting the structure never deletes data. Future levels above the job (field, area…) = a new collection
// referenced by the job; nothing here changes.
const { Schema, model } = require('mongoose');
const opt = { timestamps: true };

const WellSchema = new Schema({
    noteId: { type: Schema.Types.ObjectId, ref: 'NoteConveyor', required: true, index: true },
    name:   { type: String, required: true, trim: true },
    uwi:    { type: String, default: '' },
    order:  { type: Number, default: 0 },
    user:   { type: Schema.Types.ObjectId, ref: 'User' },
}, opt);

const WellboreSchema = new Schema({
    noteId:  { type: Schema.Types.ObjectId, ref: 'NoteConveyor', required: true, index: true },
    wellId:  { type: Schema.Types.ObjectId, ref: 'Well', required: true, index: true },
    name:    { type: String, required: true, trim: true },          // Main, L02, ST1…
    wellKey: { type: String, required: true },                      // link to every existing module
    order:   { type: Number, default: 0 },
}, opt);
WellboreSchema.index({ noteId: 1, wellKey: 1 }, { unique: true });

const RunSchema = new Schema({
    noteId:     { type: Schema.Types.ObjectId, ref: 'NoteConveyor', required: true, index: true },
    wellboreId: { type: Schema.Types.ObjectId, ref: 'Wellbore', required: true, index: true },
    wellKey:    { type: String, required: true },
    name:       { type: String, required: true, trim: true },
    order:      { type: Number, default: 0 },
    mdFrom:     { type: Number, default: null },   // m
    mdTo:       { type: Number, default: null },   // m
    tdScenario: { type: String, default: '' },     // link to the T&D plan run (BHA lives there in phase 1)
    tdRunId:    { type: String, default: '' },
    source:     { type: String, default: 'td' },   // 'td' (built from the T&D plan) | 'manual' (created in the Wells accordion)
    // PHASE 2 (2026-11-15, John): the Run OWNS its BHA. The T&D plan run keeps a mirrored copy because the T&D
    // engine calculates from params.plan: Wells edits are pushed into the linked plan run, and every T&D save
    // syncs the plan runs back here (controllers/notes.controller.js wsPushRunToTD / wsSyncFromTD).
    bha:        { type: [Schema.Types.Mixed], default: [] },   // bit first: {name, od_m, id_m, len, wt (kg/m), material}
    sensor:     { type: Number, default: null },  // MWD sensor distance from bit (m)
    bendDeg:    { type: Number, default: null },
    bendDist:   { type: Number, default: null },  // bend to bit (m)
    bhaUpdatedAt: { type: Date, default: null },
    bhaPrev:    { type: Schema.Types.Mixed, default: null },   // 2026-11-15 (phase 3): BHA before the last Wells edit (stale T&D page guard)
    tdMissing:  { type: Boolean, default: false }, // linked plan run no longer in the T&D plan (kept, BHA preserved)
}, opt);

module.exports = { Well: model('Well', WellSchema), Wellbore: model('Wellbore', WellboreSchema), Run: model('Run', RunSchema) };

// ADDED 2026-10-27 (John): "Pad Distribution List" — e-mail recipients per
// pad (site), managed on the admin "VP Areas" page (views/vpAreas.ejs) by
// importing the ETS distribution-list export (.xls/.xlsx; names taken from
// the "ETS User" column, the "Role" column kept for display). Used by the
// Gantt "Handover" button in views/all-notes.ejs to fill the e-mail To:
// field (names joined with "; " for Outlook). An import REPLACES the pad's
// list (John's choice). Pads are matched to Gantt jobs by padKey = first 14
// characters of the site name, upper-cased and trimmed — the same 14-char
// site key the Gantt already uses (ganttNotesMap / inProgressSites).
const {Schema, model} = require('mongoose');

const PadDistListSchema = new Schema({
    pad:        { type: String, required: true, trim: true },
    // 2026-10-27 (John): lists are now entered by MTX ID; pad = that job's
    // project (site) and padKey is derived from it, so the Gantt matching is
    // unchanged. Lists saved before this change have no mtxJobId.
    mtxJobId:   { type: String, default: '' },
    padKey:     { type: String, required: true, unique: true },
    recipients: [{ role: { type: String, default: '' }, etsUser: { type: String, required: true } }],
    sourceFile: { type: String, default: '' },
    user:       { type: Schema.Types.ObjectId, ref: 'User' },
},{timestamps: true});

PadDistListSchema.statics.keyOf = function(site){ return String(site || '').trim().toUpperCase().slice(0, 14); };

module.exports = model('PadDistList', PadDistListSchema);

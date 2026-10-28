// ADDED 2026-10-28 (John): "Ops. Geo. Distribution List" — Exploration
// Manager -> Ops Geo e-mail(s). Managed on the admin "VP Areas" page (just
// before the Pad Distribution List). Rule (John): if an Exp. Manager is on
// the Handover e-mail (i.e. their name is in the pad's Pad Distribution List),
// that manager's Ops Geo address(es) are added to CC as well. Names are matched
// ignoring case, punctuation and word order ("Nagra, Amar" = "Amar Nagra").
// `opsGeos` is kept as typed (";"-separated, "Name <addr>" allowed).
const {Schema, model} = require('mongoose');

const OpsGeoDistListSchema = new Schema({
    expManager: { type: String, required: true, trim: true, unique: true },
    opsGeos:    { type: String, default: '' },
    user:       { type: Schema.Types.ObjectId, ref: 'User' },
},{timestamps: true});

module.exports = model('OpsGeoDistList', OpsGeoDistListSchema);

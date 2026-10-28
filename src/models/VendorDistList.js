// ADDED 2026-10-27 (John): "Vendor Distribution List" — DP vendor e-mail
// lists, managed on the admin "VP Areas" page under the Pad Distribution
// List. In the Gantt "Handover" e-mail the selected vendor's addresses go to
// To: (the pad list moved to CC after prelimdirectionalplanning@cnrl.com).
// `emails` is kept exactly as the admin typed it (";"-separated, entries may
// be "Name <addr>"); the Handover page splits on ";" and uses the address
// inside <...> when present. Vendors can be added, edited or deleted any time.
const {Schema, model} = require('mongoose');

const VendorDistListSchema = new Schema({
    name:   { type: String, required: true, trim: true, unique: true },
    emails: { type: String, default: '' },
    user:   { type: Schema.Types.ObjectId, ref: 'User' },
},{timestamps: true});

module.exports = model('VendorDistList', VendorDistListSchema);

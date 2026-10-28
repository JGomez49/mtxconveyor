// ADDED 2026-10-27 (John): "BV Rigs" — rig reference table (air gap,
// drilling supervisor, directional vendor, notes), managed on the admin
// "VP Areas" page below the Vendor Distribution List. Rows can be added,
// edited and deleted. Values are stored as typed (trimmed).
const {Schema, model} = require('mongoose');

const BvRigSchema = new Schema({
    rig:         { type: String, required: true, trim: true, unique: true },
    airgap:      { type: String, default: '', trim: true },
    drillingSup: { type: String, default: '', trim: true },
    vendor:      { type: String, default: '', trim: true },
    notes:       { type: String, default: '', trim: true },
    user:        { type: Schema.Types.ObjectId, ref: 'User' },
},{timestamps: true});

module.exports = model('BvRig', BvRigSchema);

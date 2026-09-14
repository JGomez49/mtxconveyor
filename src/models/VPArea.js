// ADDED 2026-09-14: VP → Main Area mapping, backing the admin-only
// "VP Areas" management page (/notes/vpAreas) and the "Snapshot" section
// of the New Schedule Gantt (src/views/all-notes.ejs), which groups jobs
// by Main Area (East/Central/West/Thermal) derived from siteObj.vp via
// this mapping. Modeled after src/models/User.js's require/export style.

const {Schema, model} = require('mongoose');

const VPAreaSchema = new Schema({
    vpName: {
        type: String,
        required: true,
        unique: true
    },
    mainArea: {
        type: String,
        enum: ['East','Central','West','Thermal'],
        required: true
    },
},{timestamps: true});

module.exports = model('VPArea', VPAreaSchema);

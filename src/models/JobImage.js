// RENAMED 2026-10-27 (John): was models/ImageMirelleDog.js (very old name).
// Stores the metadata of the image uploaded to a job (Cloudinary upload:
// filename/path/public_id...); notes.controller.js creates it on upload and
// deletes it when the image is replaced or the job is deleted.
// The MODEL NAME stays 'ImageMirelleDog' on purpose so Mongoose keeps using
// the existing MongoDB collection ("imagemirelledogs") — existing job images
// keep working; only the file/variable name changed.
// Also removed: an unused require('../controllers/notes.controller') that
// created a circular dependency between this model and the controller.

const {Schema, model} = require('mongoose');

const jobImageSchema = new Schema({

    // title: {type: String},
    // description: {type: String, default: 'Description'},

    filename: {type: String},
    path: {type: String},
    public_id: {type: String},
    originalname: {type: String},
    mimetype: {type: String},
    size: {type: Number},
    noteId: {type: String},

    // Created_at: {type: Date, default: Date.now()},

});

module.exports = model('ImageMirelleDog', jobImageSchema);

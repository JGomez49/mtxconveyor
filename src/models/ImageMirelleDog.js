

const {Schema, model} = require('mongoose');
const notesCrtl = require('../controllers/notes.controller');

const imageMirelleDogSchema = new Schema({

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

module.exports = model('ImageMirelleDog' , imageMirelleDogSchema);
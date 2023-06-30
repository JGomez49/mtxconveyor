
const {Schema, model} = require('mongoose');

const LogConveyorSchema = new Schema({

    log: {type: String, required: true},
    noteid: {type: String},
    user: {type: String},

},{timestamps: true})

module.exports = model('LogConveyor', LogConveyorSchema);
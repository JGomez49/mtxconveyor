
const {Schema, model} = require('mongoose');

const NoteConveyorSchema = new Schema({

    title: {type: String, required: true},
    description: {type: String, required: true},
    mtxJobId: {type: String, required: true},
    responsible: {type: String},
    customer: {type: String},
    customerJobNumber: {type: String},
    operator: {type: String},
    priority: {type: String},
    invoice: {type: String},
    user: {type: String},
    status: {type: String},
    dueDate: {type: String},
    rig: {type: String},
    project: {type: String},
    poc: {type: String},

},{timestamps: true})

module.exports = model('NoteConveyor', NoteConveyorSchema);
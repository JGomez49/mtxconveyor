
const {Schema, model} = require('mongoose');

const NoteConveyorSchema = new Schema({

    title: {type: String, required: true},
    description: {type: String},
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

    checkInitialInfo: {type: String, defaultValue: "No"},
    checkFoldersSetup: {type: String, defaultValue: "No"},
    checkOffsetWellsInfo: {type: String, defaultValue: "No"},
    checkCompassOffsets: {type: String, defaultValue: "No"},
    checkCompassSubject: {type: String, defaultValue: "No"},
    checkPlanning: {type: String, defaultValue: "No"},
    checkReports: {type: String, defaultValue: "No"},
    checkSent: {type: String, defaultValue: "No"},
    checkETSUpdate: {type: String, defaultValue: "No"},
    
    initialInfoDoneBy: {type: String},
    initialInfoDoneAt: {type: String},
    foldersDoneBy: {type: String},
    foldersDoneAt: {type: String},
    offsetsInfoDoneBy: {type: String},
    offsetsInfoDoneAt: {type: String},
    compassOffsetsDoneBy: {type: String},
    compassOffsetsDoneAt: {type: String},
    compassSubjectDoneBy: {type: String},
    compassSubjectDoneAt: {type: String},
    planningDoneBy: {type: String},
    planningDoneAt: {type: String},
    reportsDoneBy: {type: String},
    reportsDoneAt: {type: String},
    sentBy: {type: String},
    sentAt: {type: String},
    ETSUpdateBy: {type: String},
    ETSUpdateAt: {type: String}



},{timestamps: true})

module.exports = model('NoteConveyor', NoteConveyorSchema);
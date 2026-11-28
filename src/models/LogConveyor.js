
const {Schema, model} = require('mongoose');

const LogConveyorSchema = new Schema({

    log: {type: String, required: true},
    noteid: {type: String},
    user: {type: String},

},{timestamps: true})

// 2026-11-28 (John): SPEED — index on noteid. The job page reads this collection by job; without the index MongoDB scanned the
// whole collection (every job's documents) on each page view. Built automatically by Mongoose (autoIndex) at server start.
LogConveyorSchema.index({ noteid: 1 });

module.exports = model('LogConveyor', LogConveyorSchema);

const {Schema, model} = require('mongoose');

const MTXjobNumberSchema = new Schema({
    jobNumber: {type: String}
},{timestamps: true})

module.exports = model('MTXjobNumber', MTXjobNumberSchema);
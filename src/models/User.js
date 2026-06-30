
//16. Registro de Usuario o SignUp: https://www.youtube.com/watch?v=EpomajNVcMk


const {Schema, model} = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: false, 
        default: 'viewer'
    },
    list: {
        type: String,
        required: false
    },
    rank: {
        type: String,
        required: false
    },
    securityQuestion: {
        type: String,
        required: false,
        default: ''
    },
    securityAnswerHash: {
        type: String,
        required: false,
        default: ''
    },
},{timestamps: true});

UserSchema.methods.encryptPassword = async password => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

UserSchema.methods.matchPassword = async function(password){
    return await bcrypt.compare(password, this.password);
}

UserSchema.methods.encryptAnswer = async answer => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(String(answer).trim().toLowerCase(), salt);
};

UserSchema.methods.matchAnswer = async function(answer){
    if (!this.securityAnswerHash) return false;
    return await bcrypt.compare(String(answer).trim().toLowerCase(), this.securityAnswerHash);
}

module.exports = model('User', UserSchema);
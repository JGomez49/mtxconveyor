
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
},{timestamps: true});

UserSchema.methods.encryptPassword = async password => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

UserSchema.methods.matchPassword = async function(password){
    return await bcrypt.compare(password, this.password);
}

module.exports = model('User', UserSchema);
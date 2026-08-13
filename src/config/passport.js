// 17. Login de Usuarios con Passport y bcrypt: https://www.youtube.com/watch?v=NN-Jt6EjFAc

const passport = require('passport');

const LocalStrategy = require('passport-local').Strategy;

const User = require('../models/User');

passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email, password, done)=>{
    //match email — normalized to lowercase/trimmed so case doesn't matter
    //(the User model itself now lowercases stored emails too, but the
    //incoming login attempt still needs the same normalization applied
    //before the lookup, since schema setters don't touch query filters).
    const normalizedEmail = (email || '').trim().toLowerCase();
    const user = await User.findOne({email: normalizedEmail});
    if(!user){
        return done(null, false, {message: 'Not user found'});
    }else{
        //match password (encrypt y match estan definidos en el modelo user.js)
        const match = await user.matchPassword(password);
        if (match) {
            return done(null, user);
        }else{
            return done(null, false, {message: 'Incorrect password!'});
        }
    }   
}));

////done es el callback
passport.serializeUser((user, done)=>{
    done(null, user.id);
});

passport.deserializeUser((id, done)=> {
    User.findById(id, (err,user)=>{
        done(err,user);
    });
});
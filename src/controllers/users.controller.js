
const usersCtrl = {};
const passport = require('passport');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// -------------------------Sing Up---------------------------------

usersCtrl.renderSignUpForm = (req, res) => {
    //res.render('users/signup');
    res.render('signup');
};

usersCtrl.signup = async (req, res) => {
    const errors = [];
    const { name, email, password, confirm_password } = req.body

    if (password != confirm_password) {
        errors.push({ text: '   Passwords do not match' });
    }

    if (password.length < 4) {
        errors.push({ text: '   Passwords must be minimum 4 characters length' });
    }

    if (errors.length > 0) {
        res.render('signup', {errors, name, email})
    } else {
        const emailUser = await User.findOne({ email });
        if (emailUser) {
            req.flash('error_msg', '    The email is already in use.');
            res.redirect('/users/signup');
        } else {
            const newUser = new User({name, email, password});
            newUser.password = await newUser.encryptPassword(password);
            req.flash('success_msg', '  Congratulations, You are now registred!');
            await newUser.save();
            res.redirect('/users/signin');
        }
    }
};

// --------------------------------------Sing In----------------------------
usersCtrl.renderSigninForm = (req, res) => {
    res.render('signin');
}
usersCtrl.signin = passport.authenticate('local', {
    failureRedirect: '/signin',
    successRedirect: '/notes',
    failureFlash: true
});
//--------------------------------------------------------------------

// ---------------------------------------Log Out---------------------------
usersCtrl.logout = (req, res) => {
    // res.send('Logout!');
    //req.logout();
    req.logout(function(err) {
        if (err) { return next(err); }
        //res.redirect('/users/signin');
        req.flash('success_msg', '  Bye!... see you soon.');
        res.redirect('/users/signin');
      });
    // req.flash('success_msg', '  Bye!... see you soon.');
    // res.redirect('/users/signin');
};

module.exports = usersCtrl;
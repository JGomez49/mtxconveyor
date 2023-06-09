
const usersCtrl = {};
const passport = require('passport');
const User = require('../models/User');
const bcrypt = require('bcryptjs');



// -------------------------Sing Up-----------------------------------------
usersCtrl.renderSignUpForm = (req, res) => {res.render('signup.ejs')};


usersCtrl.signup = async (req, res) => {
    const errors = [];
    const { name, email, role, list, password, confirm_password } = req.body

    if (password != confirm_password) {
        errors.push({ text: '   Passwords do not match' });
    }

    if (password.length < 4) {
        errors.push({ text: '   Passwords must be minimum 4 characters length' });
    }

    if (errors.length > 0) {
        res.render('signup.ejs', {errors, name, email})
    } else {
        const emailUser = await User.findOne({ email });
        if (emailUser) {
            req.flash('error_msg', '    The email is already in use.');
            res.redirect('/users/signup');
        } else {
            const newUser = new User({name, email, role, list, password});
            newUser.password = await newUser.encryptPassword(password);
            req.flash('success_msg', '  Congratulations, You are now registred!');
            await newUser.save();
            res.redirect('/users/signin');
        }
    }
};
//==========================================================================





// ---------------------------------Edit User------------------------------- No esta funcionando el cambio de clave de usuario
usersCtrl.renderEditUserForm = (req, res) => {res.render('edit-user.ejs')};

usersCtrl.editUser = async (req, res) => {
    const errors = [];
    // console.log(req.body);
    const { name, email, role, password, confirm_password } = req.body;
    // console.log(req.params);
    // let userID = req.params.id;
    // console.log('>>>>>>>>>>>>>>>>>');
    // console.log(userID);
    // let user = await User.findById(req.params.id);
    // console.log(user);
    // let clave = await user.encryptPassword(password);
    // console.log(clave);

    if (password != confirm_password) {
        errors.push({ text: '   Passwords do not match' });
    }

    if (password.length < 4) {
        errors.push({ text: '   Passwords must be minimum 4 characters length' });
    }

    if (errors.length > 0) {
        res.render('signin.ejs', {errors, name, email})
    } else {
        const emailUser = await User.findOne({ email });
        if (emailUser) {
            req.flash('error_msg', '    The email is already in use.');
            res.redirect('/users/signin');
        } else {
            let user = await User.findById(req.params.id);
            console.log(user);
            await User.encryptPassword(password);
            // let clave = await user.encryptPassword(password);
            // console.log(clave);
            // password = await user.encryptPassword(password);
            await User.findByIdAndUpdate(req.params.id, {name, email, role, list, password});
            req.flash('success_msg', '  User has been updated!');
            res.redirect('/users/signin');
        }
    }
};
//==========================================================================





// --------------------------------------Sing In----------------------------
usersCtrl.renderSigninForm = (req, res) => {
    res.render('signin.ejs');
}
usersCtrl.signin = passport.authenticate('local', {
    failureRedirect: '/users/signin',
    successRedirect: '/notes',
    failureFlash: true
});
//==========================================================================







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
//==========================================================================

module.exports = usersCtrl;
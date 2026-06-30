
const usersCtrl = {};
const passport   = require('passport');
const User       = require('../models/User');
const bcrypt     = require('bcryptjs');
const SiteConfig = require('../models/SiteConfig');

const DEFAULT_BANNER = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1769889664/Planit_poster_02_neaxo6.png';



// -------------------------Sing Up-----------------------------------------
usersCtrl.renderSignUpForm = (req, res) => {res.render('signup.ejs')};


usersCtrl.signup = async (req, res) => {
    const errors = [];
    const { name, email, role, list, password, confirm_password, rank } = req.body

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
            const newUser = new User({name, email, role, list, password, rank});
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
usersCtrl.renderSigninForm = async (req, res) => {
    try {
        const cfg = await SiteConfig.findOne({ key: 'bannerUrl' }).lean();
        const bannerUrl = (cfg && cfg.value) ? cfg.value : DEFAULT_BANNER;
        res.render('signin.ejs', { bannerUrl });
    } catch(e) {
        res.render('signin.ejs', { bannerUrl: DEFAULT_BANNER });
    }
};
usersCtrl.signin = (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) { return next(err); }
        if (!user) {
            req.flash('error_msg', (info && info.message) || 'Invalid email or password.');
            return res.redirect('/users/signin');
        }
        req.logIn(user, (err) => {
            if (err) { return next(err); }
            if (!user.securityQuestion) {
                return res.redirect('/users/setup-security-question');
            }
            return res.redirect('/notes');
        });
    })(req, res, next);
};
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



// ---------------------------------------Security Question Setup-----------
// Shown once after login if the user has no security question set yet.
usersCtrl.renderSetupSecurityQuestion = (req, res) => {
    res.render('setup-security-question.ejs', { user: req.user });
};

usersCtrl.setupSecurityQuestion = async (req, res) => {
    try {
        const { question, answer } = req.body;
        if (!question || !question.trim() || !answer || !answer.trim()) {
            req.flash('error_msg', 'Please provide both a question and an answer.');
            return res.redirect('/users/setup-security-question');
        }
        const user = await User.findById(req.user._id);
        const answerHash = await user.encryptAnswer(answer);
        await User.findByIdAndUpdate(req.user._id, {
            securityQuestion: question.trim(),
            securityAnswerHash: answerHash,
        });
        req.flash('success_msg', 'Security question saved.');
        res.redirect('/notes');
    } catch(e) {
        console.error('setupSecurityQuestion:', e);
        req.flash('error_msg', 'Something went wrong. Please try again.');
        res.redirect('/users/setup-security-question');
    }
};
//==========================================================================



// ---------------------------------------Forgot Password-------------------
// Step 1: enter email → if a security question exists, show it.
usersCtrl.renderForgotPassword = (req, res) => {
    res.render('forgot-password.ejs', { step: 'email', email: '', question: '', error: null });
};

usersCtrl.forgotPasswordLookup = async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.securityQuestion) {
        // Don't reveal whether the email exists — generic message either way.
        return res.render('forgot-password.ejs', {
            step: 'email', email: email || '', question: '',
            error: 'No account with a security question was found for that email. Please contact an administrator.',
        });
    }
    res.render('forgot-password.ejs', {
        step: 'answer', email, question: user.securityQuestion, error: null,
    });
};

// Step 2: verify answer + set new password
usersCtrl.forgotPasswordReset = async (req, res) => {
    const { email, answer, password, confirm_password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !user.securityQuestion) {
        return res.render('forgot-password.ejs', {
            step: 'email', email: email || '', question: '',
            error: 'Something went wrong. Please start again.',
        });
    }

    const match = await user.matchAnswer(answer);
    if (!match) {
        return res.render('forgot-password.ejs', {
            step: 'answer', email, question: user.securityQuestion,
            error: 'That answer is incorrect.',
        });
    }

    if (!password || password.length < 4) {
        return res.render('forgot-password.ejs', {
            step: 'answer', email, question: user.securityQuestion,
            error: 'Password must be at least 4 characters.',
        });
    }
    if (password !== confirm_password) {
        return res.render('forgot-password.ejs', {
            step: 'answer', email, question: user.securityQuestion,
            error: 'Passwords do not match.',
        });
    }

    const newHash = await user.encryptPassword(password);
    await User.findByIdAndUpdate(user._id, { password: newHash });
    req.flash('success_msg', 'Your password has been reset. Please sign in.');
    res.redirect('/users/signin');
};
//==========================================================================



// ---------------------------------------Change Password (logged in)------
usersCtrl.renderChangePassword = (req, res) => {
    res.render('change-password.ejs', { user: req.user, error: null, success: null });
};

usersCtrl.changePassword = async (req, res) => {
    const { current_password, password, confirm_password, question, answer } = req.body;
    const user = await User.findById(req.user._id);

    // Verify current password first
    const currentOk = await user.matchPassword(current_password || '');
    if (!currentOk) {
        return res.render('change-password.ejs', {
            user: req.user, error: 'Current password is incorrect.', success: null,
        });
    }

    const updates = {};

    // Optional: change password
    if (password || confirm_password) {
        if (!password || password.length < 4) {
            return res.render('change-password.ejs', {
                user: req.user, error: 'New password must be at least 4 characters.', success: null,
            });
        }
        if (password !== confirm_password) {
            return res.render('change-password.ejs', {
                user: req.user, error: 'New passwords do not match.', success: null,
            });
        }
        updates.password = await user.encryptPassword(password);
    }

    // Optional: set/update security question
    if (question && question.trim()) {
        if (!answer || !answer.trim()) {
            return res.render('change-password.ejs', {
                user: req.user, error: 'Please provide an answer for the security question.', success: null,
            });
        }
        updates.securityQuestion = question.trim();
        updates.securityAnswerHash = await user.encryptAnswer(answer);
    }

    if (Object.keys(updates).length === 0) {
        return res.render('change-password.ejs', {
            user: req.user, error: 'Nothing to update.', success: null,
        });
    }

    await User.findByIdAndUpdate(req.user._id, updates);
    res.render('change-password.ejs', {
        user: req.user, error: null, success: 'Your changes have been saved.',
    });
};
//==========================================================================

module.exports = usersCtrl;
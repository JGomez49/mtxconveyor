
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

// -------------------------- Usage / Activity Dashboard (admin) -----------
// Turns the raw UserActivity pings (written by helpers/auth.js's
// isAuthenticated middleware) into: (1) a per-user, per-day estimated-
// minutes map for a GitHub-style contribution heatmap, (2) a per-user
// module/path usage breakdown, (3) an org-wide daily-active-users series,
// and (4) a per-user summary table. All computed here server-side and
// embedded as JSON for the view to render, same pattern job.ejs already
// uses for its own dashboards.
const UserActivity = require('../models/UserActivity');

const SESSION_IDLE_GAP_MS = 60 * 60 * 1000; // 60 min — see chat: matches the
    // requested idle-timeout for splitting continuous activity into
    // separate "sessions" when estimating time spent.
const MIN_SESSION_MS = 60 * 1000; // floor so even a single lone ping still
    // counts as ~1 minute of activity that day, rather than 0.
const HEATMAP_DAYS = 371; // ~53 weeks, matches a GitHub-style year heatmap

function dayKey(date){ return date.toISOString().slice(0, 10); } // UTC YYYY-MM-DD, approximate by design (see below)

// Groups a user's ascending-sorted ping timestamps into sessions (gap >
// SESSION_IDLE_GAP_MS starts a new one), then attributes each session's
// estimated duration to the UTC day of its FIRST ping. Sessions that cross
// midnight are rare here (bounded by the idle gap, and by normal working
// hours) and are not split across days — a documented approximation, not
// an attempt at to-the-second accuracy.
function computeUserDayMinutes(timestampsAsc){
    const dayMinutes = {};   // 'YYYY-MM-DD' -> minutes
    const daySet = new Set(); // days with any activity at all
    let lastLoginAt = null;
    if(!timestampsAsc.length) return { dayMinutes, daySet, lastLoginAt };

    let sessionStart = timestampsAsc[0];
    let prev = timestampsAsc[0];
    function flush(sessionEnd){
        const ms = Math.max(MIN_SESSION_MS, sessionEnd - sessionStart);
        const key = dayKey(sessionStart);
        dayMinutes[key] = (dayMinutes[key] || 0) + ms / 60000;
        daySet.add(key);
    }
    for(let i = 1; i < timestampsAsc.length; i++){
        const t = timestampsAsc[i];
        if(t - prev > SESSION_IDLE_GAP_MS){
            flush(prev);
            sessionStart = t;
        }
        prev = t;
    }
    flush(prev);
    lastLoginAt = timestampsAsc[timestampsAsc.length - 1];
    return { dayMinutes, daySet, lastLoginAt };
}

usersCtrl.renderActivityDashboard = async (req, res) => {
    try {
        const since = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000);
        const [users, pings] = await Promise.all([
            User.find({}).select('name email role').lean(),
            UserActivity.find({ timestamp: { $gte: since } })
                .select('userId userName path timestamp').sort({ timestamp: 1 }).lean(),
        ]);

        const byUser = {}; // userId (string) -> { timestamps: [], modules: {path: count} }
        pings.forEach(p => {
            const uid = String(p.userId);
            if(!byUser[uid]) byUser[uid] = { timestamps: [], modules: {} };
            byUser[uid].timestamps.push(new Date(p.timestamp));
            byUser[uid].modules[p.path] = (byUser[uid].modules[p.path] || 0) + 1;
        });

        const orgDayActiveUsers = {}; // 'YYYY-MM-DD' -> Set of userIds (converted to count below)
        const userSummaries = [];
        const userHeatmaps = {}; // uid -> { day: minutes }
        const userModules = {};  // uid -> [{path, count}] sorted desc

        users.forEach(u => {
            const uid = String(u._id);
            const entry = byUser[uid];
            const timestamps = entry ? entry.timestamps : [];
            const { dayMinutes, daySet, lastLoginAt } = computeUserDayMinutes(timestamps);

            daySet.forEach(d => {
                if(!orgDayActiveUsers[d]) orgDayActiveUsers[d] = new Set();
                orgDayActiveUsers[d].add(uid);
            });

            userHeatmaps[uid] = dayMinutes;
            const modules = entry ? Object.entries(entry.modules)
                .map(([path, count]) => ({ path, count }))
                .sort((a, b) => b.count - a.count) : [];
            userModules[uid] = modules;

            const totalMinutes = Object.values(dayMinutes).reduce((s, m) => s + m, 0);
            userSummaries.push({
                userId: uid,
                name: u.name || u.email || '(unknown)',
                role: u.role || 'viewer',
                daysActive: daySet.size,
                estHours: Math.round((totalMinutes / 60) * 10) / 10,
                lastActive: lastLoginAt ? lastLoginAt.toISOString() : null,
                topModule: modules.length ? modules[0].path : null,
            });
        });

        userSummaries.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));

        const orgDauSeries = Object.keys(orgDayActiveUsers).sort().map(d => ({ day: d, count: orgDayActiveUsers[d].size }));

        res.render('activity.ejs', {
            user: req.user,
            summaries: userSummaries,
            heatmaps: userHeatmaps,
            modules: userModules,
            orgDauSeries,
            heatmapDays: HEATMAP_DAYS,
        });
    } catch (err) {
        console.error('[activity dashboard] error:', err);
        req.flash('error_msg', 'Failed to load the activity dashboard.');
        res.redirect('/notes');
    }
};
//==========================================================================

module.exports = usersCtrl;
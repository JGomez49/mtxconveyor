
const usersCtrl = {};
const passport   = require('passport');
const User       = require('../models/User');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const mongoose   = require('../database');
const SiteConfig = require('../models/SiteConfig');
const UserActivityModel = require('../models/UserActivity');

const DEFAULT_BANNER = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1769889664/Planit_poster_02_neaxo6.png';
const VALID_ROLES = ['viewer', 'user', 'leader', 'admin'];

function genRandomPassword(len){
    len = len || 12;
    // Dependency-free, alphanumeric only (avoids awkward-to-relay symbols) —
    // this is shown once to the admin to relay to the user, not stored
    // anywhere in plaintext.
    return crypto.randomBytes(len * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

// ==========================================================================
// User management (admin only) — /users/manage. Replaces the old public
// self-registration (/users/signup, retired — see routes/users.routes.js)
// and the old broken /users/edit/:id (it stored passwords in PLAINTEXT: it
// called User.encryptPassword() as a static method — a no-op on the class
// itself rather than an instance — discarded the result, and wrote the raw
// req.body.password straight into the update). All of this is AJAX (JSON
// in, JSON out): the page never redirects, per the requirement that
// creating/editing a user keeps the admin right where they were.
// ==========================================================================

usersCtrl.renderManageUsers = async (req, res) => {
    try {
        const users = await User.find({}).select('name email role list rank createdAt').sort({ name: 1 }).lean();
        // Last-active per user, cheap version of what the activity dashboard
        // computes in full (no need for the whole session/heatmap pass just
        // for a list page) — most recent ping per user.
        const lastActiveRows = await UserActivityModel.aggregate([
            { $sort: { timestamp: -1 } },
            { $group: { _id: '$userId', lastActive: { $first: '$timestamp' } } },
        ]);
        const lastActiveByUser = {};
        lastActiveRows.forEach(r => { lastActiveByUser[String(r._id)] = r.lastActive; });

        const rows = users.map(u => ({
            _id: String(u._id),
            name: u.name, email: u.email, role: u.role || 'viewer',
            list: u.list || '', rank: u.rank || '',
            createdAt: u.createdAt ? u.createdAt.toISOString() : null,
            lastActive: lastActiveByUser[String(u._id)] ? lastActiveByUser[String(u._id)].toISOString() : null,
        }));

        res.render('manage-users.ejs', {
            user: req.user,
            users: rows,
            validRoles: VALID_ROLES,
            currentUserId: String(req.user._id),
        });
    } catch (err) {
        console.error('[manage users] render error:', err);
        req.flash('error_msg', 'Failed to load user management.');
        res.redirect('/notes');
    }
};

usersCtrl.createUser = async (req, res) => {
    try {
        const { name, role, list, rank, password, confirm_password } = req.body;
        // Emails are case-insensitive everywhere in this app (the User
        // model also lowercases on save) — normalize here so the
        // uniqueness check below actually catches "Name@X.com" vs
        // "name@x.com" as the same account.
        const email = (req.body.email || '').trim().toLowerCase();
        if(!name || !email || !password){
            return res.status(400).json({ error: 'Name, email, and password are required.' });
        }
        if(password !== confirm_password){
            return res.status(400).json({ error: 'Passwords do not match.' });
        }
        if(password.length < 4){
            return res.status(400).json({ error: 'Password must be at least 4 characters.' });
        }
        if(role && !VALID_ROLES.includes(role)){
            return res.status(400).json({ error: 'Invalid role.' });
        }
        const existing = await User.findOne({ email });
        if(existing){
            return res.status(409).json({ error: 'That email is already in use.' });
        }
        const newUser = new User({ name, email, role: role || 'viewer', list, rank });
        newUser.password = await newUser.encryptPassword(password);
        await newUser.save();
        res.json({
            ok: true,
            user: {
                _id: String(newUser._id), name: newUser.name, email: newUser.email,
                role: newUser.role, list: newUser.list || '', rank: newUser.rank || '',
                createdAt: newUser.createdAt ? newUser.createdAt.toISOString() : null,
                lastActive: null,
            },
        });
    } catch (err) {
        console.error('[create user] error:', err);
        res.status(500).json({ error: 'Failed to create user.' });
    }
};

usersCtrl.updateUser = async (req, res) => {
    try {
        const targetId = req.params.id;
        if(String(req.user._id) === String(targetId)){
            return res.status(400).json({ error: "Use Change Password to edit your own account from here." });
        }
        const { name, role, list, rank } = req.body;
        const email = (req.body.email || '').trim().toLowerCase();
        if(!name || !email){
            return res.status(400).json({ error: 'Name and email are required.' });
        }
        if(role && !VALID_ROLES.includes(role)){
            return res.status(400).json({ error: 'Invalid role.' });
        }
        const emailOwner = await User.findOne({ email, _id: { $ne: targetId } });
        if(emailOwner){
            return res.status(409).json({ error: 'That email is already in use by another user.' });
        }
        const updated = await User.findByIdAndUpdate(
            targetId,
            { name, email, role: role || 'viewer', list, rank },
            { new: true }
        ).lean();
        if(!updated) return res.status(404).json({ error: 'User not found.' });
        res.json({
            ok: true,
            user: {
                _id: String(updated._id), name: updated.name, email: updated.email,
                role: updated.role, list: updated.list || '', rank: updated.rank || '',
            },
        });
    } catch (err) {
        console.error('[update user] error:', err);
        res.status(500).json({ error: 'Failed to update user.' });
    }
};

usersCtrl.resetUserPassword = async (req, res) => {
    try {
        const targetId = req.params.id;
        if(String(req.user._id) === String(targetId)){
            return res.status(400).json({ error: "Use Change Password to reset your own password." });
        }
        const target = await User.findById(targetId);
        if(!target) return res.status(404).json({ error: 'User not found.' });
        const newPassword = genRandomPassword(12);
        target.password = await target.encryptPassword(newPassword);
        await target.save();
        // Returned once, in this response only — never stored or logged in
        // plaintext anywhere. Relay it to the user through your own
        // channel; they should change it after logging in.
        res.json({ ok: true, password: newPassword });
    } catch (err) {
        console.error('[reset password] error:', err);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
};

usersCtrl.deleteUser = async (req, res) => {
    try {
        const targetId = req.params.id;
        if(String(req.user._id) === String(targetId)){
            return res.status(400).json({ error: 'You cannot delete your own account from here.' });
        }
        const deleted = await User.findByIdAndDelete(targetId);
        if(!deleted) return res.status(404).json({ error: 'User not found.' });
        // Historical records elsewhere (T&D/Casing "calculated by", activity
        // pings, etc.) already store the person's name as a separate string
        // at the time of the action, so deleting the User doc doesn't erase
        // or corrupt that history — those fields just keep the name with a
        // now-dangling userId reference, same as any audit trail would.
        res.json({ ok: true });
    } catch (err) {
        console.error('[delete user] error:', err);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
};

// "Panic button" — force everyone logged out at once, including the admin
// who clicks it. Sessions are stored server-side in Mongo (see server.js's
// MongoDBStore, collection 'mySessions'), so wiping that collection
// invalidates every active session in one shot: the next request from any
// browser with an old session cookie fails req.isAuthenticated() and gets
// redirected to sign in, same as a normal logout. This response still
// completes normally for the admin's own current request (the deletion
// doesn't retroactively kill the in-flight response) — only their NEXT
// request will find no session and bounce to /users/signin, which the
// client-side JS handles with an explicit redirect after a short delay.
usersCtrl.forceLogoutAll = async (req, res) => {
    try {
        const result = await mongoose.connection.db.collection('mySessions').deleteMany({});
        res.json({ ok: true, sessionsCleared: result.deletedCount || 0 });
    } catch (err) {
        console.error('[force logout all] error:', err);
        res.status(500).json({ error: 'Failed to log out all users.' });
    }
};
//==========================================================================
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
    const email = (req.body.email || '').trim().toLowerCase();
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
    const { answer, password, confirm_password } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();
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
// and (4) a per-user summary table. Computation itself lives in
// helpers/activityStats.js, shared with the embedded "Users"/"Activity
// Heatmap" section on the main dashboard (all-notes.ejs) — this is the
// admin view over ALL users; that one is a filtered subset.
const { buildActivityReport, HEATMAP_DAYS } = require('../helpers/activityStats');

usersCtrl.renderActivityDashboard = async (req, res) => {
    try {
        const users = await User.find({}).select('name email role').lean();
        const report = await buildActivityReport(users);
        res.render('activity.ejs', {
            user: req.user,
            summaries: report.summaries,
            heatmaps: report.heatmaps,
            modules: report.modules,
            recentPings: report.recentPings,
            orgDauSeries: report.orgDauSeries,
            heatmapDays: report.heatmapDays,
            selectedUserId: req.query.userId || null,
        });
    } catch (err) {
        console.error('[activity dashboard] error:', err);
        req.flash('error_msg', 'Failed to load the activity dashboard.');
        res.redirect('/notes');
    }
};
//==========================================================================

module.exports = usersCtrl;
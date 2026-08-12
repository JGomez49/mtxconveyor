
//18, Proteger las rutas de Express con Passport -> https://www.youtube.com/watch?v=EdBZQ6IdlYs&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=19

const UserActivity = require('../models/UserActivity');

const helpers = {};

// ==========================================================================
// Activity logging (for the admin-only usage dashboard, /users/activity)
// ==========================================================================
// In-memory per-user throttle: resets on server restart, which just means
// a few extra pings right after a deploy — not a correctness issue, and
// avoids an extra DB read on every single request just to decide whether
// to write one.
const _lastPingAt = new Map(); // userId (string) -> ms epoch of last logged ping
const PING_THROTTLE_MS = 2 * 60 * 1000; // log at most once per user per 2 min

// Collapses Mongo ObjectId / pure-numeric path segments to ":id" so e.g.
// "/notes/job/64f1a2b3c4d5e6f7a8b9c0d1" and "/notes/job/64f9..." both group
// under the same normalized path when the dashboard aggregates by module —
// otherwise every distinct document/well/job would look like its own
// "module" and the module-usage breakdown would be meaningless.
function normalizePath(path){
    return (path || '/').split('/').map(seg => {
        if(/^[0-9a-fA-F]{24}$/.test(seg)) return ':id';
        if(/^\d+$/.test(seg)) return ':id';
        return seg;
    }).join('/') || '/';
}
helpers.normalizePath = normalizePath;

function logActivity(req){
    if(!req.user || !req.user._id) return;
    const uid = String(req.user._id);
    const now = Date.now();
    const last = _lastPingAt.get(uid) || 0;
    if(now - last < PING_THROTTLE_MS) return;
    _lastPingAt.set(uid, now);
    UserActivity.create({
        userId: req.user._id,
        userName: req.user.name || req.user.email || '',
        path: normalizePath(req.path),
        timestamp: new Date(),
    }).catch(err => console.error('[UserActivity] log failed:', err.message));
}

helpers.isAuthenticated = (req,res,next)=>{
    if(req.isAuthenticated()){
        logActivity(req);
        return next();
    }
    req.flash('error_msg', 'Please Signin to access this URL.');
    res.redirect('/users/signin');
}

// Admin-only route guard for the activity dashboard — mirrors the
// role-gated nav partials (navigation_Admin.ejs etc.) already used
// elsewhere, so "admin" here matches the same User.role values those rely
// on. Requires isAuthenticated to have already run (req.user present).
helpers.isAdmin = (req,res,next)=>{
    if(req.isAuthenticated() && req.user && req.user.role === 'admin'){
        return next();
    }
    req.flash('error_msg', 'Admin access required.');
    res.redirect('/notes');
}

module.exports = helpers
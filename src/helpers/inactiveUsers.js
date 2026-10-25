// ==========================================================================
// Inactive-user cleanup (ADDED 2026-10-23, per John).
// Rule: a NON-admin user is inactive when the newest of
//   (last UserActivity ping, account createdAt)
// is older than N days (admin setting, default 60). UserActivity is written by
// helpers/auth.js isAuthenticated on every protected page visit (throttled to
// one ping per user per 2 min), so it covers both logins and ongoing use;
// createdAt protects brand-new accounts that haven't signed in yet.
// Admins (role 'admin', any case) are NEVER listed or deleted.
// Deleting = User.findByIdAndDelete, same as the existing Manage Users delete:
// records elsewhere keep the person's name as a copied string, so history
// (jobs, scenarios, activity) is not broken.
// Settings live in SiteConfig (key/value strings):
//   inactiveUserDays   -> number of days (default 60)
//   inactiveAutoDelete -> 'true' | 'false' (default 'false')
//   inactiveLastRun    -> JSON {at, mode, deleted:[names]} of the last cleanup
// The daily automatic run (startInactiveUserScheduler) only deletes when
// inactiveAutoDelete is 'true'.
// ==========================================================================
const User         = require('../models/User');
const UserActivity = require('../models/UserActivity');
const SiteConfig   = require('../models/SiteConfig');

const DEFAULT_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

async function getCfg(key){ const c = await SiteConfig.findOne({ key }).lean(); return c ? c.value : null; }
async function setCfg(key, value, userId){
    await SiteConfig.findOneAndUpdate({ key }, { key, value: String(value), updatedBy: userId || undefined, updatedAt: new Date() }, { upsert: true });
}

async function getSettings(){
    const days = parseInt(await getCfg('inactiveUserDays'), 10);
    const auto = await getCfg('inactiveAutoDelete');
    let lastRun = null;
    try { lastRun = JSON.parse(await getCfg('inactiveLastRun') || 'null'); } catch(e){ lastRun = null; }
    return { days: (days > 0) ? days : DEFAULT_DAYS, autoDelete: auto === 'true', lastRun };
}

async function saveSettings({ days, autoDelete }, userId){
    const d = parseInt(days, 10);
    if(!(d >= 1 && d <= 3650)) throw new Error('Days must be a whole number between 1 and 3650.');
    await setCfg('inactiveUserDays', d, userId);
    await setCfg('inactiveAutoDelete', autoDelete ? 'true' : 'false', userId);
    return getSettings();
}

const isAdminRole = role => String(role || '').toLowerCase() === 'admin';

async function findInactiveUsers(days){
    const cutoff = Date.now() - days * DAY_MS;
    const users = (await User.find({}).select('name email role rank createdAt').lean()).filter(u => !isAdminRole(u.role));
    if(!users.length) return [];
    const rows = await UserActivity.aggregate([
        { $match: { userId: { $in: users.map(u => u._id) } } },
        { $group: { _id: '$userId', lastActive: { $max: '$timestamp' } } },
    ]);
    const last = {};
    rows.forEach(r => { last[String(r._id)] = r.lastActive; });
    return users.map(u => {
        const la = last[String(u._id)] || null;
        const created = u.createdAt || null;
        const lastSeen = Math.max(la ? new Date(la).getTime() : 0, created ? new Date(created).getTime() : 0);
        return {
            _id: String(u._id), name: u.name, email: u.email, role: u.role || 'viewer', rank: u.rank || '',
            lastActive: la ? new Date(la).toISOString() : null,
            createdAt: created ? new Date(created).toISOString() : null,
            daysInactive: lastSeen ? Math.floor((Date.now() - lastSeen) / DAY_MS) : null,
            _lastSeen: lastSeen,
        };
    }).filter(u => u._lastSeen < cutoff)       // lastSeen 0 (no activity, no createdAt) also counts as inactive
      .sort((a, b) => a._lastSeen - b._lastSeen)
      .map(({ _lastSeen, ...u }) => u);
}

// Deletes the given ids, but only those that are STILL inactive non-admins at
// this moment (re-checked server-side, so a stale page can't delete someone
// who has since signed in, or an admin).
async function deleteInactiveUsers(ids, days, mode, actorId){
    const inactive = await findInactiveUsers(days);
    const allowed = new Map(inactive.map(u => [u._id, u]));
    const toDelete = (ids || []).map(String).filter(id => allowed.has(id) && id !== String(actorId || ''));
    const names = toDelete.map(id => allowed.get(id).name + ' <' + allowed.get(id).email + '>');
    if(toDelete.length) await User.deleteMany({ _id: { $in: toDelete }, role: { $not: /^admin$/i } });
    await setCfg('inactiveLastRun', JSON.stringify({ at: new Date().toISOString(), mode, days, deleted: names }), actorId);
    if(toDelete.length) console.log(`[inactive users] ${mode}: deleted ${toDelete.length} account(s) inactive > ${days} days: ${names.join(', ')}`);
    return { deleted: names, skipped: (ids || []).length - toDelete.length };
}

async function runAutomaticCleanup(){
    try {
        const s = await getSettings();
        if(!s.autoDelete) return;
        const list = await findInactiveUsers(s.days);
        await deleteInactiveUsers(list.map(u => u._id), s.days, 'automatic');
    } catch(err){ console.error('[inactive users] automatic cleanup failed:', err.message); }
}

// Runs 5 min after start (DB connected by then), then every 24 h.
function startInactiveUserScheduler(){
    setTimeout(runAutomaticCleanup, 5 * 60 * 1000);
    setInterval(runAutomaticCleanup, DAY_MS);
}

module.exports = { getSettings, saveSettings, findInactiveUsers, deleteInactiveUsers, runAutomaticCleanup, startInactiveUserScheduler, DEFAULT_DAYS };

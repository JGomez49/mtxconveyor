// Shared activity-stats computation — used by both usersCtrl.
// renderActivityDashboard (/users/activity, all users) and
// notesCtrl.renderNotes's embedded "Users" + "Activity Heatmap" section
// (all-notes.ejs, restricted to a filtered subset of users). Extracted
// here rather than duplicated in two controllers so the session-grouping
// logic (and its 60-minute idle-gap rule) can't drift between the two.

const UserActivity = require('../models/UserActivity');

const SESSION_IDLE_GAP_MS = 60 * 60 * 1000; // 60 min idle-timeout for splitting
    // continuous activity into separate "sessions" when estimating time spent.
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

// users: array of {_id, name, email, role} (already filtered by the
// caller — e.g. all users for the admin dashboard, or list==='CNRL' users
// for the embedded notes.ejs section). Fetches pings for exactly those
// users within the last HEATMAP_DAYS and builds every derived view.
async function buildActivityReport(users){
    const since = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000);
    const userIds = users.map(u => u._id);
    const pings = await UserActivity.find({ userId: { $in: userIds }, timestamp: { $gte: since } })
        .select('userId userName path timestamp').sort({ timestamp: 1 }).lean();

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
    const userRecentPings = {}; // uid -> [{path, timestamp}] most recent 50

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

        const uPings = pings.filter(p => String(p.userId) === uid);
        userRecentPings[uid] = uPings.slice(-50).reverse().map(p => ({ path: p.path, timestamp: new Date(p.timestamp).toISOString() }));

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

    return {
        summaries: userSummaries,
        heatmaps: userHeatmaps,
        modules: userModules,
        recentPings: userRecentPings,
        orgDauSeries,
        heatmapDays: HEATMAP_DAYS,
    };
}

module.exports = { buildActivityReport, HEATMAP_DAYS };

const {Schema, model} = require('mongoose');

// One document = one throttled "activity ping": this user was doing
// something at this timestamp, on this (ID-normalized) path. Written from
// helpers/auth.js's isAuthenticated middleware, so it covers every
// protected route the person actually visits — no separate client-side
// tracking script needed. Throttled in-memory (see helpers/auth.js) to a
// few pings per user per throttle window rather than one per request, to
// keep volume sane while still being enough to reconstruct session length
// via the idle-gap grouping done in usersCtrl.activityDashboard.
const UserActivitySchema = new Schema({
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String },       // denormalized at write time so the
                                       // dashboard doesn't need to populate/
                                       // join for a user who's since been
                                       // renamed or removed
    path:     { type: String, required: true }, // normalized: numeric/
                                       // ObjectId path segments collapsed to
                                       // ":id" (see normalizePath in
                                       // helpers/auth.js) so "/notes/job/
                                       // 64f1..." and "/notes/job/64f2..."
                                       // group together as the same module
    timestamp:{ type: Date, required: true, default: Date.now },
});

UserActivitySchema.index({ userId: 1, timestamp: -1 });
UserActivitySchema.index({ timestamp: -1 });

module.exports = model('UserActivity', UserActivitySchema);

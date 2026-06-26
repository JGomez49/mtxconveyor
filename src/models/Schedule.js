
const { Schema, model } = require("mongoose");

const ScheduleSchema = new Schema(
  {
    rig: { type: String, default: "" },
    drillok: { type: String, default: ""},
    geook: { type: String, default: "" },
    dp: { type: String, default: "" },
    type: { type: String, default: "" },
    duration: { type: Number, default: 0 },
    vp: { type: String, default: "" },
    start: { type: Date, required: false },
    site: { type: String, default: "" },
    well: { type: String, default: "" },
    dpCompany: { type: String, default: "" },
    ETS: { type: String, default: "" },
    dpReq: { type: String, default: "" },
    group: { type: String, default: "" },
    geo: { type: String, default: "" },
    version: { type: String, default: "" },

    // ── New fields from updated schedule template ──
    dpReceivedDate:  { type: String, default: "" },
    primaryZone:     { type: String, default: "" },
    tvd:             { type: Number, default: null },
    target:          { type: String, default: "" },
    province:        { type: String, default: "" },
    playType:        { type: String, default: "" },
    afeYear:         { type: String, default: "" },
    prospectName:    { type: String, default: "" },
    bhLocation:      { type: String, default: "" },
    surfLocation:    { type: String, default: "" },
    license:         { type: String, default: "" },
    drillingSuper:   { type: String, default: "" },
    geolApprovalDate:{ type: Date,   default: null },

    user: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("Schedule", ScheduleSchema);

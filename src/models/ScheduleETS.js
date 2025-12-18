

const { Schema, model } = require("mongoose");

const ScheduleETSSchema = new Schema(


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
    user: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }

);

module.exports = model("ScheduleETS", ScheduleETSSchema);
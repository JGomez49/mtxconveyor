

const { Schema, model } = require("mongoose");

const ScheduleSchema = new Schema(
  {
    rig: { type: String, default: "" },
    //dp: { type: String, default: "" },
    dp: { type: Date }, //optional if store as Date
    type: { type: String, default: "" },
    duration: { type: Number, default: 0 },
    vp: { type: String, default: "" },
    //start: { type: String, default: ""  },
    start: { type: Date }, //optional if store as Date
    site: { type: String, default: "" },
    well: { type: String, default: "" },

    // optional: link schedules to a Note if needed
    // noteId: { type: Schema.Types.ObjectId, ref: "Note" },
    user: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = model("Schedule", ScheduleSchema);




const { Schema, model } = require("mongoose");

const DPStatsSchema = new Schema(
  {
    dpVersion: { type: String, default: "PX" },
    dpDays: { type: Number, default: 0 },

    user: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("DPStats", DPStatsSchema);


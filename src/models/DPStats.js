


const { Schema, model } = require("mongoose");

const DPStatsSchema = new Schema(
  {
    dpVersion: { type: String },
    dpDays: { type: Number },

    user: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("DPStats", DPStatsSchema);


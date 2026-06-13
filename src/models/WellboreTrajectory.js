const { Schema, model } = require("mongoose");

const SurveyPointSchema = new Schema(
  {
    well: { type: String, default: "" },
    md: { type: Number, default: 0 },
    incl: { type: Number, default: 0 },
    azim: { type: Number, default: 0 },
    tvd: { type: Number, default: 0 },
    subSea: { type: Number, default: 0 },
    vertSec: { type: Number, default: 0 },
    localN: { type: Number, default: 0 },
    localE: { type: Number, default: 0 },
    dogleg: { type: Number, default: 0 },
    northing: { type: Number, default: 0 },
    easting: { type: Number, default: 0 },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    comments: { type: String, default: "" },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

const WellboreTrajectorySchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true },
    wellName: { type: String, required: true },
    source: { type: String, default: "" },
    pad: { type: String, default: "" },
    colorHex: { type: String, default: "" },
    surveyCount: { type: Number, default: 0 },
    survey: [SurveyPointSchema],
    user: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("WellboreTrajectory", WellboreTrajectorySchema);

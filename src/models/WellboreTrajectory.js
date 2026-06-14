const { Schema, model } = require("mongoose");

const SurveyPointSchema = new Schema(
  {
    well:     { type: String, default: "" },
    md:       { type: Number, default: 0 },
    incl:     { type: Number, default: 0 },
    azim:     { type: Number, default: 0 },
    tvd:      { type: Number, default: 0 },
    subSea:   { type: Number, default: 0 },
    vertSec:  { type: Number, default: 0 },
    localN:   { type: Number, default: 0 },
    localE:   { type: Number, default: 0 },
    dogleg:   { type: Number, default: 0 },
    northing: { type: Number, default: 0 },
    easting:  { type: Number, default: 0 },
    latitude: { type: Number, default: 0 },
    longitude:{ type: Number, default: 0 },
    comments: { type: String, default: "" },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

// FracPlane box/cylinder sub-document.
// center {x,y,z} is the 3D viewer world position computed by linear
// interpolation of Northing/Easting/TVD at the given MD between the two
// nearest survey stations (X=Easting, Y=-TVD, Z=-Northing).
// tangent {x,y,z} is the wellbore direction unit vector at that MD,
// computed from interpolated incl/azim using standard direction cosines —
// used as the default cylinder axis before user Roll/Pitch/Yaw are applied.
const FracPlaneSchema = new Schema(
  {
    label:    { type: String, default: "" },
    geometry: { type: String, enum: ['box','cylinder'], default: 'box' },
    md:       { type: Number, required: true },
    // Box half-dimensions (m)
    dx: { type: Number, default: 10 },
    dy: { type: Number, default: 10 },
    dz: { type: Number, default: 10 },
    // Cylinder geometry (m)
    radius:   { type: Number, default: 10 },
    distance: { type: Number, default: 30 },
    // Orientation offsets applied on top of the default axis (Roll/Pitch/Yaw°)
    ax: { type: Number, default: 0 },
    ay: { type: Number, default: 0 },
    az: { type: Number, default: 0 },
    // Computed 3D position (world coords)
    center: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      z: { type: Number, default: 0 },
    },
    // Wellbore tangent unit vector at MD (used as cylinder default axis)
    tangent: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: -1 },
      z: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: Date.now },
  }
);

const WellboreTrajectorySchema = new Schema(
  {
    noteId:       { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true },
    wellName:     { type: String, required: true },
    source:       { type: String, default: "" },
    pad:          { type: String, default: "" },
    colorHex:     { type: String, default: "" },
    surveyCount:  { type: Number, default: 0 },
    survey:       [SurveyPointSchema],
    fracPlanes:   [FracPlaneSchema],
    user:         { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("WellboreTrajectory", WellboreTrajectorySchema);

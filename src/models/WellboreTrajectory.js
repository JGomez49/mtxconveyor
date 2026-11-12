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
    // ADDED 2026-11-12 (John, correction chain): the ORIGINAL (tally) MD / Inc / Az of this station, written on
    // every correction version (absent on uploaded surveys = the stored md/incl/azim ARE the originals). BHA runs
    // are always assigned by origMd, never by a stretch-corrected MD (John's decision 2026-11-12).
    origMd:   { type: Number },
    origIncl: { type: Number },
    origAzim: { type: Number },
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
    // Explicit subject/offset tag chosen at upload time (via the toggle next
    // to the folder picker). Empty string means "not tagged" — legacy data
    // uploaded before this field existed falls back to the [NN]..._LNN name
    // pattern (see wbtIsSubjectWell helpers) to infer its category.
    wellCategory: { type: String, enum: ['subject', 'offset', ''], default: '' },
    pad:          { type: String, default: "" },
    colorHex:     { type: String, default: "" },
    // Selected ISCWSA MWD Rev5 toolcode for this well's Separation Factor
    // calculation in the Anti-collision Plots accordion (public/js/
    // iscwsaModel.js + public/data/iscwsaToolcodes.json). Empty string
    // means "use the default" (MWD+SRGM) rather than an explicit choice.
    toolcode:     { type: String, default: "" },
    surveyCount:  { type: Number, default: 0 },
    survey:       [SurveyPointSchema],
    fracPlanes:   [FracPlaneSchema],
    // ADDED 2026-11-12 (John, correction chain — see controllers/notes.controller.js saveCorrectedVersion):
    // baseWellName = the uploaded well this version descends from ('' on uploaded wells);
    // correctionChain = every correction applied, in order, each with the per-station deltas it added
    // (dMd m, dInc deg, dAz deg; same order/length as survey) so a version is auditable and reportable.
    baseWellName: { type: String, default: "" },
    correctionChain: [new Schema({
        type:       { type: String, required: true },   // 'stretch' | 'sag' | 'shortcollar' | 'msa'
        tag:        { type: String, default: "" },      // 'STRETCH' | 'SAG' | 'SC' | 'MSA' (used in the well name)
        model:      { type: String, default: "" },
        label:      { type: String, default: "" },      // e.g. load case / options summary
        inputs:     { type: Schema.Types.Mixed, default: {} },
        sourceId:   { type: Schema.Types.ObjectId },     // version this step was applied to
        sourceName: { type: String, default: "" },
        userName:   { type: String, default: "" },
        date:       { type: Date, default: Date.now },
        dMd:  [Number], dInc: [Number], dAz: [Number],
    }, { _id: false })],
    user:         { type: Schema.Types.ObjectId, ref: "User" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("WellboreTrajectory", WellboreTrajectorySchema);

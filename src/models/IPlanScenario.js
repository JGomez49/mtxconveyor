const { Schema, model } = require("mongoose");

// iPlan scenario trajectory (ADDED 2026-10-10, iPlan step 4).
// A user-designed "what-if" wellbore drawn in the Wellbore 3D Trajectory
// accordion (green) and included in the Anti-collision Plots (green dotted).
// Job-level (noteId-keyed), visible to everyone on the job. Only the DESIGN
// is stored (start point + sections + targets + toolcode); stations are
// always recomputed in the browser with /js/iplanCore.js, so a saved
// scenario can never drift from the current planning math.
// NOT a WellboreTrajectory: never appears in score cards, pad stats or the
// Trajectories accordion.
const IPlanScenarioSchema = new Schema(
  {
    noteId:    { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, index: true },
    name:      { type: String, default: "Scenario" },
    // 'surface' = start from a planned well's surface (editable values in `start`)
    // 'tieon'   = start at tieMd on planned well `wellId` (position interpolated)
    startMode: { type: String, enum: ["surface", "tieon"], default: "surface" },
    wellId:    { type: String, default: "" },   // WellboreTrajectory _id of the selected planned well
    tieMd:     { type: Number, default: 0 },
    start: {
      md: Number, tvd: Number, n: Number, e: Number, inc: Number, az: Number, rkb: Number,
    },
    // Section objects exactly as iplanCore.js / QuickPlan use them ({kind, ...params}).
    sections:  { type: [Schema.Types.Mixed], default: [] },
    // Scenario targets: {name, n, e, ss (Sub-Sea, m), r}
    targets:   { type: [Schema.Types.Mixed], default: [] },
    toolcode:  { type: String, default: null },  // null = inherit from the planned well
    createdBy:     { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, default: "" },
    updatedBy:     { type: Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = model("IPlanScenario", IPlanScenarioSchema);



const { Schema, model } = require("mongoose");

const DPStatsSchema = new Schema(
  {
    // ── Computed / derived fields (kept for backward compatibility with
    //    the DP Timing Statistics box plot, which reads these two) ──
    dpVersion: { type: String },   // extracted from "DP Design/Plan No (All Plans)"
    dpDays:    { type: Number },   // DP Received Date - DP Request Date (days)

    // ── Raw columns from the source Excel export (Report sheet) ──
    etsId:                              { type: Number },
    bhLocation:                         { type: String },
    prospectName:                       { type: String },
    explorCoreArea:                     { type: String },
    fieldName:                          { type: String },
    wellType:                           { type: String },
    opNonOp:                            { type: String },
    afeTimingYear:                      { type: String },
    playType:                           { type: String },
    province:                           { type: String },
    dpProposedWellboresAllPlans:        { type: Number },
    dpProposedTotalDrilledMetersAllPlans:{ type: Number },
    dpProposedTotalLateralLengthAllPlans:{ type: Number },
    dpReceivedDateAllPlans:             { type: Date },
    dpRequestDateAllPlans:              { type: Date },
    dpRevisedSurveyNoAllPlans:          { type: String },
    dpTypeAllPlans:                     { type: String },
    dpCompanyNameAllPlans:              { type: String },
    dpCurrentPlanAllPlans:              { type: String },
    dpDesignPlanNoAllPlans:             { type: String },   // source of dpVersion
    dpDrillApprovedAllPlans:            { type: Date },
    dpGeolApprovedAllPlans:             { type: Date },
    dpJustificationAllPlans:            { type: String },
    dpProposedWellbores:                { type: Number },
    dpProposedTotalDrilledMeters:       { type: Number },
    dpProposedTotalLateralLength:       { type: Number },

    // ── New columns added in the 32-column export format ──
    rig:                                { type: String },
    rigDuration:                        { type: Number },
    scheduled:                          { type: String },
    siteName:                           { type: String },
    spudDate:                           { type: Date },
    rigReleaseDate:                     { type: Date },
    estStartDate:                       { type: Date },

    user: { type: Schema.Types.ObjectId, ref: "User" },
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor" },
    uploadedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("DPStats", DPStatsSchema);

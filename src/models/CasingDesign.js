const { Schema, model } = require("mongoose");

// Stores the Casing Design module's input (casing strings, well/load
// params) and computed results PER WELL for one job, mirroring
// models/HydraulicsModel.js and models/TDModel.js exactly:
//   - uploadCasingDesign.ejs can reload/save a specific well's setup when
//     the same Job ID (MTX ID) + well is selected again
//   - job.ejs shows a read-only summary via the shared calculation modules
//     (src/public/js/casingModel.js + casingLoadCases.js)
//
// SCENARIOS: same job-wide scenario pattern as TDModel/HydraulicsModel — a
// job can hold several named scenarios (e.g. "9-5/8in Intermediate" /
// "7in Intermediate Alt"), scenario names are shared across every well in
// the job, and each scenario has its own resultsByWell underneath. Exactly
// one scenario is "active" (activeScenario); the TOP-LEVEL resultsByWell
// always mirrors the active scenario's resultsByWell so job.ejs's accordion
// needs no scenario-aware code.
//
// All calculation uses the shared modules (src/public/js/casingModel.js —
// pipe capacity ratings + triaxial/VME stress; src/public/js/casingLoadCases.js
// — Simple Method load-case builder), loaded by both the browser and this
// backend — this collection only stores the resulting numbers. Physics
// basis: API TR 5C3, Bourgoyne et al. "Applied Drilling Engineering" Ch.7,
// and this well's "Casing Design Foundation" (CNRL, Rev 0) — see citation
// blocks at the top of casingModel.js / casingLoadCases.js.
const CasingDesignSchema = new Schema({
    noteId: { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true, unique: true },

    // resultsByWell[wellKey] = {
    //   casingStrings,   // [{ name, stringType, od_mm, id_mm, grade, weight_kgpm, thread,
    //                     //    shoeMD_m, shoeTVD_m, condition }], mirrors getCasingStrings()
    //                     //    thread is descriptive connection type (STC/LTC/BTC/8RD/VAM/
    //                     //    ER/Blue/S60/Vetco LS, default LTC) — display-only, does not
    //                     //    feed the Simple Method load cases or triaxial check.
    //   loadParams,      // { nextStringShoeTVD_m, formationPressureGradient_kPa_m,
    //                     //   mudGradient_kPa_m, h2sPartialPressure_kPa } per string, keyed by string name
    //   dfOverride,      // optional { burst, collapse, tension } — what-if design-factor
    //                     //   override used ONLY for the VME "Design Factor" curve on the
    //                     //   triaxial chart; never affects the pass/fail compliance check
    //   results,         // { byString: { <name>: { loads, check, triaxial, buckling } } }, output of computeCasingDesign()
    //   calculatedAt,
    //   calculatedByName,
    //   calculatedByUserId,
    // }
    // Always mirrors scenarios[activeScenario].resultsByWell.
    resultsByWell: { type: Schema.Types.Mixed, default: {} },

    // scenarios[scenarioName] = { resultsByWell: { <same shape as above> } }
    scenarios: { type: Schema.Types.Mixed, default: {} },
    activeScenario: { type: String, default: '' },

    user:         { type: Schema.Types.ObjectId, ref: "User" },
    calculatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = model("CasingDesign", CasingDesignSchema);

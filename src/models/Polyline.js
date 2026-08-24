const { Schema, model } = require("mongoose");

// Polyline: a closed map-view outline (Northing/Easting vertices, e.g. a
// channel/geobody extent imported from Excel) extruded vertically between
// two TVDss depths to form a solid volume in the Wellbore 3D Trajectory
// viewer. Added 2026-08-25 as a new accordion below Frac Planes — NOT
// nested inside it, and NOT tied to any one wellbore (points are plain
// Northing/Easting, same convention as survey stations, so the viewer's
// existing X=Easting/Y=-TVD/Z=-Northing transform applies directly).
const PolylinePointSchema = new Schema(
  {
    northing: { type: Number, required: true },
    easting:  { type: Number, required: true },
  },
  { _id: false }
);

const PolylineSchema = new Schema(
  {
    noteId:   { type: Schema.Types.ObjectId, ref: "NoteConveyor", required: true },
    name:     { type: String, default: "" },
    // Closed polygon vertices (Northing/Easting). If the uploaded file's
    // first/last rows don't already match, the controller auto-closes the
    // loop by appending a copy of the first point before saving.
    points:   { type: [PolylinePointSchema], default: [] },
    // TVDss (subsea) range the volume is extruded between. "From" is the
    // shallower depth, "To" the deeper one — the controller normalizes
    // order so From <= To regardless of input order.
    tvdFrom:  { type: Number, required: true },
    tvdTo:    { type: Number, required: true },
    colorHex: { type: String, default: "#ff0000" },
    // Added 2026-08-25: how this Polyline renders in the 3D viewer —
    // 'solid' = filled/shaded extruded volume (previous/default behavior),
    // 'wireframe' = the same extruded volume, edges only, 'lines' = just
    // the closed outline drawn at TVDss From and TVDss To (no extrusion,
    // no side walls) — "as entered".
    displayStyle: { type: String, enum: ['solid', 'wireframe', 'lines'], default: 'solid' },
    user:     { type: Schema.Types.ObjectId, ref: "User" },
    createdAt:{ type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = model("Polyline", PolylineSchema);

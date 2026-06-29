const { Schema, model } = require("mongoose");

// Simple key-value store for site-wide configuration.
const SiteConfigSchema = new Schema({
    key:       { type: String, required: true, unique: true },
    value:     { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date, default: Date.now },
});

module.exports = model("SiteConfig", SiteConfigSchema);

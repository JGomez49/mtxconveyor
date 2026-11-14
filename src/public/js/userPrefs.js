/*
 * userPrefs.js — ADDED 2026-11-14 (John): per-user display preferences shared by all pages.
 * Stored on the user (User.uiPrefs) through GET/POST /notes/userPrefs, so they follow the user to any browser.
 *   MTXPrefs.get(key, fallback)  -> value (loaded once per page, synchronously, so pages can use it while drawing)
 *   MTXPrefs.set(key, value)     -> saves (fire-and-forget) and updates the local copy
 * Keys in use: tdCurveStyle = 'sharp' | 'round' (Hole Depth vs Time curves — Pason Plots page and job page).
 */
(function (root) {
    'use strict';
    var prefs = null;
    function load() {
        if (prefs) return prefs; prefs = {};
        try { var x = new XMLHttpRequest(); x.open('GET', '/notes/userPrefs', false); x.send(null);
            if (x.status === 200) { var d = JSON.parse(x.responseText); prefs = (d && d.prefs) || {}; } } catch (e) { prefs = {}; }
        return prefs;
    }
    root.MTXPrefs = {
        get: function (key, fallback) { var p = load(); return (p[key] !== undefined && p[key] !== '') ? p[key] : fallback; },
        set: function (key, value) {
            load()[key] = value;
            try { fetch('/notes/userPrefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key, value: value }) }); } catch (e) { }
        }
    };
})(typeof window !== 'undefined' ? window : this);

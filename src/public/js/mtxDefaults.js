/*
 * mtxDefaults.js — ADDED 2026-11-14 (John): admin "Save this setup as default" for MTX modules
 * (same idea as the DSI page, which keeps its own copy).
 *
 * A page sets, BEFORE including this file:
 *   window.MTX_DEFAULTS_CFG = { module: 'sag', keys: ['mud', 'sensor', ...], unit: function(){ return 'metric'; } }
 * keys = ids of the page's setting inputs / selects / checkboxes (never job data, case names or tables).
 *
 * Load: synchronous GET /notes/moduleDefaults/<module> while the page is parsing (this script sits at the
 * end of <body>), so the saved values are in the inputs BEFORE the page's DOMContentLoaded / load code
 * reads them; no events are fired. Values are stored in METRIC display units: an admin can only save
 * while the page shows metric (unit() === 'metric'); the stored values are only applied to a page that
 * opens in metric (every module opens in metric by default).
 * Admin (server says isAdmin): adds "💾 Save defaults" and "↺ Built-in" to the page header (or a small
 * floating bar when the page has no <header>). Server: SiteConfig key 'defaults:<module>', admin-only POST.
 */
(function () {
    'use strict';
    var C = window.MTX_DEFAULTS_CFG; if (!C || !C.module || !C.keys) return;
    var url = '/notes/moduleDefaults/' + encodeURIComponent(C.module), info = { values: null, isAdmin: false };
    function unit() { try { return C.unit ? C.unit() : 'metric'; } catch (e) { return 'metric'; } }
    try { var x = new XMLHttpRequest(); x.open('GET', url, false); x.send(null); if (x.status === 200) info = JSON.parse(x.responseText); } catch (e) { }
    function el(k) { return document.getElementById(k); }
    var changed = [];
    if (info.values && unit() === 'metric') {
        C.keys.forEach(function (k) {
            var e = el(k), v = info.values[k]; if (!e || v === undefined || v === null) return;
            var before = e.type === 'checkbox' ? String(e.checked) : e.value;
            if (e.type === 'checkbox') e.checked = (v === 'true' || v === true); else e.value = v;
            var after = e.type === 'checkbox' ? String(e.checked) : e.value;
            if (before !== after && (e.tagName === 'SELECT' || e.type === 'checkbox') && e.hasAttribute('onchange')) changed.push(e);
        });
        // selects / checkboxes whose own onchange updates the page (show/hide options, notes): run it once the page is ready
        if (changed.length) window.addEventListener('load', function () { changed.forEach(function (e) { try { e.dispatchEvent(new Event('change')); } catch (er) { } }); });
    }
    if (!info.isAdmin) return;
    function msg(t, ok) { var m = el('mtxDefMsg'); if (m) { m.textContent = t; m.style.color = ok ? '#2ecc71' : '#ff5c5c'; } }
    async function save(reset) {
        if (!reset && unit() !== 'metric') { msg('Switch the page to metric before saving defaults.', false); return; }
        if (reset && !confirm('Go back to the built-in defaults of this page for everyone?')) return;
        var v = {}; C.keys.forEach(function (k) { var e = el(k); if (e) v[k] = e.type === 'checkbox' ? String(e.checked) : e.value; });
        try {
            var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reset ? { reset: true } : { values: v }) });
            var d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
            msg(reset ? 'Built-in defaults restored (reload to see them).' : 'Saved as default for everyone.', true);
        } catch (err) { msg('Save failed: ' + err.message, false); }
    }
    function addButtons() {
        var box = document.createElement('span'); box.className = 'mtx-def-box';
        box.style.cssText = 'display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap';
        var mk = function (t, title, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = title; b.style.cursor = 'pointer'; b.onclick = fn;
            if (document.querySelector('link[href*="bootswatch"]')) b.className = 'btn btn-sm btn-outline-secondary'; return b; };
        box.appendChild(mk('💾 Save defaults', 'Admin: save the current settings of this page as the default for everyone (' + C.keys.length + ' settings; job data is not saved)', function () { save(false); }));
        box.appendChild(mk('↺ Built-in', 'Admin: remove the saved defaults of this page', function () { save(true); }));
        var m = document.createElement('span'); m.id = 'mtxDefMsg'; m.style.fontSize = '12px'; box.appendChild(m);
        var hdr = document.querySelector('header');
        if (hdr) (hdr.querySelector('.row, .d-flex.gap-2, .hdr-right') || hdr).appendChild(box);
        else { box.style.cssText += ';position:fixed;right:12px;bottom:12px;z-index:9998;background:rgba(20,24,30,.9);padding:6px 8px;border-radius:6px;border:1px solid #2a313c'; document.body.appendChild(box); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons); else addButtons();
})();

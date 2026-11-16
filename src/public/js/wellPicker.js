/*
 * wellPicker.js — ADDED 2026-11-15 (John, well structure PHASE 3): "Well › Wellbore › Run" picker for the module pages
 * (SAG, Pipe Stretch, DSI, Slide Sheet, 6-axis Short Collar / MSA). After the page's own "Load job" it reads the job's
 * saved well structure (GET /notes/wellStructure/:noteId, models/WellStructure.js) and lets the user pick a wellbore or
 * a run. Picking only drives the page's EXISTING selectors (well / scenario / run) and buttons, so every module keeps
 * its own logic and still works without a structure:
 *   - well    -> the page's well selector is set to the wellbore's ENGINEERING survey (the Actual when there is one,
 *                else the highest plan version — chosen in the job page Wells accordion), then its change handler runs;
 *   - run     -> + the run's T&D scenario / plan run (the Run owns its BHA, mirrored in the T&D plan), then
 *                cfg.afterSelect(sel) loads BHA / survey as the page needs.
 * cfg = { mount: element id to insert the picker AFTER (waited for), wrap: name of the page's async load-job function,
 *         rebind: id of a button whose onclick holds the old function reference (re-pointed to the wrapper),
 *         getJob: () => job object with noteId + wells[{wellKey}], wellSel: id, onWell: name of the well change function,
 *         runs: true|false, afterSelect: function(sel) }   sel = { well, wellbore, run|null, wellIndex }
 */
(function (root) {
    'use strict';
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function f0(v) { return v == null || !isFinite(v) ? '?' : (+v).toFixed(0); }
    function attach(cfg) {
        // anchor may be built later by the page (6-axis builds its panel in JS): wait for it (max 60 s)
        if (!document.getElementById(cfg.mount)) { var n = 0, t = setInterval(function () { if (document.getElementById(cfg.mount) || ++n > 120) { clearInterval(t); if (n <= 120) attach(cfg); } }, 500); return; }
        var box = document.createElement('div'), state = { data: null };
        box.className = 'mtx-wellpicker';
        box.style.cssText = 'display:none;margin:8px 0;padding:8px 10px;border:1px solid rgba(77,163,255,.5);border-radius:6px;background:rgba(77,163,255,.06);font-size:13px;';
        box.innerHTML = '<label style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><b>🗂️ Well › Wellbore' + (cfg.runs === false ? '' : ' › Run') + '</b>' +
            '<select class="mtx-wp-sel" style="min-width:280px;max-width:100%;font-size:14px;padding:5px 8px;"></select><span class="mtx-wp-info" style="opacity:.8"></span></label>';
        var anchor = document.getElementById(cfg.mount); if (!anchor || !anchor.parentNode) return;
        anchor.parentNode.insertBefore(box, anchor.nextSibling);
        var sel = box.querySelector('.mtx-wp-sel'), info = box.querySelector('.mtx-wp-info');
        function render() {
            var d = state.data, job = cfg.getJob() || {}, keys = (job.wells || []).map(function (w) { return w.wellKey; });
            if (!d || !d.saved || !d.saved.length) { box.style.display = ''; sel.innerHTML = '<option value="">—</option>'; sel.disabled = true;
                info.innerHTML = 'No well structure saved for this job yet — build it in the job page “🗂️ Wells” accordion (optional; the selectors below still work).'; return; }
            sel.disabled = false; box.style.display = '';
            var h = '<option value="">— pick a wellbore' + (cfg.runs === false ? '' : ' or run') + ' —</option>';
            d.saved.forEach(function (w) { w.wellbores.forEach(function (b) {
                var ok = keys.indexOf(b.wellKey) >= 0;
                h += '<optgroup label="' + esc(w.name + ' › ' + b.name) + '"><option value="wb|' + esc(b.id) + '"' + (ok ? '' : ' disabled') + '>' + esc(w.name + ' › ' + b.name) + ' · survey ' + esc(b.wellKey) + (ok ? '' : ' (not in this page’s list)') + '</option>';
                if (cfg.runs !== false) b.runs.forEach(function (r) { h += '<option value="run|' + esc(r.id) + '"' + (ok ? '' : ' disabled') + '>&nbsp;&nbsp;' + esc(r.name) + ' · ' + f0(r.mdFrom) + '–' + f0(r.mdTo) + ' m · ' + (r.bha || []).length + ' BHA parts' + (r.tdMissing ? ' · not in T&D plan' : '') + '</option>'; });
                h += '</optgroup>'; }); });
            sel.innerHTML = h; info.textContent = '';
        }
        async function load() {
            var job = cfg.getJob(); if (!job || !job.noteId) return;
            try { var r = await fetch('/notes/wellStructure/' + job.noteId), d = await r.json(); state.data = d.ok ? d : null; } catch (e) { state.data = null; }
            render();
        }
        sel.addEventListener('change', function () {
            var v = sel.value; if (!v || !state.data) return;
            var p = v.split('|'), pick = null;
            state.data.saved.forEach(function (w) { w.wellbores.forEach(function (b) {
                if (p[0] === 'wb' && String(b.id) === p[1]) pick = { well: w, wellbore: b, run: null };
                b.runs.forEach(function (r) { if (p[0] === 'run' && String(r.id) === p[1]) pick = { well: w, wellbore: b, run: r }; }); }); });
            if (!pick) return;
            var job = cfg.getJob() || {}, i = (job.wells || []).findIndex(function (w) { return w.wellKey === pick.wellbore.wellKey; });
            if (i < 0) { info.textContent = 'Survey “' + pick.wellbore.wellKey + '” is not in this page’s well list.'; return; }
            pick.wellIndex = i;
            var ws = document.getElementById(cfg.wellSel); ws.value = String(i);
            if (typeof root[cfg.onWell] === 'function') root[cfg.onWell](); else ws.dispatchEvent(new Event('change'));
            info.textContent = pick.run ? 'Loaded ' + pick.wellbore.name + ' · ' + pick.run.name : 'Selected ' + pick.well.name + ' › ' + pick.wellbore.name;
            try { if (cfg.afterSelect) cfg.afterSelect(pick); } catch (e) { info.textContent += ' · ' + e.message; }
        });
        var orig = root[cfg.wrap];
        if (typeof orig === 'function') root[cfg.wrap] = async function () { var out = await orig.apply(this, arguments); await load(); return out; };
        if (cfg.rebind && document.getElementById(cfg.rebind)) document.getElementById(cfg.rebind).onclick = root[cfg.wrap];   // button bound to the old function reference
        if (cfg.getJob() && cfg.getJob().noteId) load();   // job already loaded before the picker was attached
        return { reload: load };
    }
    // helper for pages: set a <select> to a value if present, optionally firing its change handler
    function setSel(id, value, fire) { var e = document.getElementById(id); if (!e) return false; var ok = Array.prototype.some.call(e.options, function (o) { return o.value === String(value); });
        if (ok) { e.value = String(value); if (fire) e.dispatchEvent(new Event('change')); } return ok; }
    root.MTXWellPicker = { attach: attach, setSel: setSel };
}(typeof window !== 'undefined' ? window : this));

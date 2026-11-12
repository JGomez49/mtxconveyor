/*
 * mtxTheme.js — ADDED 2026-11-11 (John): one dark / light theme setting for every MTX module.
 *
 * Shared key: localStorage 'mtxThemePreference' = 'light' | 'dark' — the same key the job page, Gantt,
 * EDIT page, T&D, Hydraulics, Casing Design, PipeStretch and Frac Planes use. Changing it on any page
 * applies to the others (other open tabs follow at once through the 'storage' event).
 *
 * Included at the end of <body> by modules that had no light mode (SAGcorrection, DSI, 6-axis, QuickPlan,
 * Design Codes, DPI, Pad AC, Pason). It:
 *   1. toggles body.light-mode and fires window 'mtxThemeChange' {detail:{light}};
 *   2. adds a "🌓 Theme" button to the page <header> (skipped if the page has #themeToggleBtn already);
 *   3. light palette for the pages built on the shared CSS variables (--bg --panel --panel2 --border --text
 *      --muted --accent --good --bad --warn);
 *   4. Bootswatch pages: swaps the dark "slate" stylesheet for the light "flatly" one (same version) and
 *      bg-dark/text-light body classes;
 *   5. Plotly charts: re-colours paper/plot background, font and grid from the CSS variables, also for
 *      charts drawn later (Plotly.newPlot / react are wrapped); Chart.js charts: text and grid colours.
 * Three.js scenes keep their own background.
 */
(function () {
    'use strict';
    var K = 'mtxThemePreference';
    function stored() { try { return localStorage.getItem(K); } catch (e) { return null; } }
    function isLight() { return document.body.classList.contains('light-mode'); }

    // 3. light palette (only applies to pages that use these variable names)
    var css = document.createElement('style');
    css.textContent =
        'body.light-mode{--bg:#f0f4f8;--panel:#ffffff;--panel2:#f6f8fa;--border:#c8d4de;--text:#0a0d10;--muted:#454e57;' +
        '--accent:#0a6fd6;--good:#14843f;--bad:#c62828;--warn:#a86400;}' +
        'body.light-mode button.primary{color:#ffffff;}' +
        'body.light-mode .chart-wrap{background:#ffffff !important;border:1px solid #dee2e6;}' +
        '.mtx-theme-btn{cursor:pointer;white-space:nowrap;}';
    document.head.appendChild(css);

    // 4. Bootswatch slate <-> flatly
    function swapBootswatch(light) {
        document.querySelectorAll('link[rel=stylesheet][href*="bootswatch"]').forEach(function (l) {
            var h = l.getAttribute('href');
            var n = light ? h.replace('/slate/', '/flatly/') : h.replace('/flatly/', '/slate/');
            if (n !== h) l.setAttribute('href', n);
        });
        var b = document.body;
        if (light) {
            if (b.classList.contains('bg-dark')) { b.classList.remove('bg-dark'); b.classList.add('bg-light'); b.dataset.mtxWasDark = '1'; }
            if (b.classList.contains('text-light')) { b.classList.remove('text-light'); b.classList.add('text-dark'); b.dataset.mtxWasTextLight = '1'; }
        } else {
            if (b.dataset.mtxWasDark) { b.classList.remove('bg-light'); b.classList.add('bg-dark'); }
            if (b.dataset.mtxWasTextLight) { b.classList.remove('text-dark'); b.classList.add('text-light'); }
        }
    }

    // 5. charts
    function cssVar(v, fb) { var x = getComputedStyle(document.body).getPropertyValue(v).trim(); return x || fb; }
    function plotlyLayout() {
        var light = isLight();
        var bg = cssVar('--panel', light ? '#ffffff' : '#171b21'), fg = cssVar('--text', light ? '#0a0d10' : '#e6e9ef'), gr = cssVar('--border', light ? '#c8d4de' : '#2a313c');
        return { bg: bg, fg: fg, gr: gr };
    }
    function themePlot(el) {
        if (!window.Plotly || !el || !el.layout) return;
        if (!isLight() && !el.dataset.mtxThemed) return;   // dark: leave page colours alone unless we changed them
        if (el.closest && el.closest('[data-mtx-no-theme]')) return;
        el.dataset.mtxThemed = '1';
        var c = plotlyLayout(), u = { paper_bgcolor: c.bg, plot_bgcolor: c.bg, 'font.color': c.fg };
        Object.keys(el.layout).forEach(function (k) { if (/^[xy]axis\d*$/.test(k)) { u[k + '.gridcolor'] = c.gr; u[k + '.zerolinecolor'] = c.gr; } });   // only axes the chart already has
        try { window.Plotly.relayout(el, u); } catch (e) { }
    }
    function themeAllPlots() { document.querySelectorAll('.js-plotly-plot').forEach(themePlot); }
    function wrapPlotly() {
        var P = window.Plotly; if (!P || P.__mtxWrapped) return; P.__mtxWrapped = true;
        ['newPlot', 'react'].forEach(function (fn) {
            var orig = P[fn]; if (typeof orig !== 'function') return;
            P[fn] = function (gd) {
                var r = orig.apply(this, arguments), el = typeof gd === 'string' ? document.getElementById(gd) : gd;
                if (isLight() && r && r.then) r.then(function () { themePlot(el); });
                return r;
            };
        });
    }
    function themeChartJs() {
        var C = window.Chart; if (!C) return;
        var light = isLight(), fg = light ? '#212529' : '#e6e9ef', gr = light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)';
        try { C.defaults.color = fg; C.defaults.borderColor = gr; } catch (e) { }
        var list = C.instances ? Object.values(C.instances) : [];
        list.forEach(function (ch) {
            try {
                Object.values(ch.options.scales || {}).forEach(function (s) { if (s.ticks) s.ticks.color = fg; if (s.grid) s.grid.color = gr; if (s.title) s.title.color = fg; });
                if (ch.options.plugins && ch.options.plugins.legend && ch.options.plugins.legend.labels) ch.options.plugins.legend.labels.color = fg;
                ch.update('none');
            } catch (e) { }
        });
    }

    var btn = null;
    function apply(light) {
        document.body.classList.toggle('light-mode', light);
        swapBootswatch(light);
        if (btn) btn.title = light ? 'Switch to dark mode' : 'Switch to light mode';
        setTimeout(function () { themeAllPlots(); themeChartJs(); }, 50);
        window.dispatchEvent(new CustomEvent('mtxThemeChange', { detail: { light: light } }));
    }

    function init() {
        // 2. button in the header (pages with their own #themeToggleBtn keep theirs)
        if (!document.getElementById('themeToggleBtn')) {
            var hdr = document.querySelector('header');
            if (hdr) {
                btn = document.createElement('button');
                btn.type = 'button'; btn.id = 'themeToggleBtn';
                btn.className = 'mtx-theme-btn' + (document.querySelector('link[href*="bootswatch"]') ? ' btn btn-sm btn-outline-secondary' : '');
                btn.textContent = '🌓 Theme';
                btn.addEventListener('click', function () {
                    var light = !isLight();
                    try { localStorage.setItem(K, light ? 'light' : 'dark'); } catch (e) { }
                    apply(light);
                });
                var tgt = hdr.querySelector('.row, .d-flex.gap-2, .hdr-right') || hdr;
                tgt.appendChild(btn);
            }
        }
        wrapPlotly();
        apply(stored() === 'light');
        window.addEventListener('storage', function (e) { if (e.key === K) apply(e.newValue === 'light'); });
        // Plotly may be loaded after this script on some pages
        setTimeout(wrapPlotly, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

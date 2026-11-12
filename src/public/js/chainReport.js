/*
 * chainReport.js — Combined correction-chain QC report (ADDED 2026-11-12, John: phase 5 of the survey correction chain,
 * project doc claude/correction-chain-plan.md).
 *
 * For one saved survey version it shows every correction applied (PipeStretch, SAG, ...), the per-station
 * ΔMD / ΔInc / ΔAz of each step and in total, and the final positions vs the original (uploaded) survey.
 * Data: GET /notes/surveyVersion/:id (final version: survey incl. origMd/origInc/origAz + correctionChain with
 * per-step dMd/dInc/dAz arrays) and the same endpoint for the original well (its stored TVD/N/E).
 * No new maths: totals are differences of stored values; the positions are the ones each module saved
 * (minimum curvature, Bourgoyne Ch.8, applied by controllers/notes.controller.js saveCorrectedVersion).
 * QC check printed in the report: Σ(per-step deltas) − (final − original) at every station (should be ~0;
 * steps saved before 2026-11-12 have no per-station history and are flagged).
 * Printable page -> "Save as PDF"; "⬇ Excel" exports the station table.
 *
 * Usage: MtxChainReport.open({ versionId, originalId, well, job, unit: 'metric'|'imperial' })
 */
(function () {
    'use strict';
    var FT = 0.3048, LOGO = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1711167914/Canadian_Natural_logo_ygbbox.png', BLUE = '#00539B';
    var NAMES = { stretch: 'PipeStretch', sag: 'SAG', shortcollar: 'Short Collar', msa: 'MSA' };
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function f(v, d) { return (v == null || !isFinite(v)) ? '—' : (+v).toFixed(d); }
    function azd(a, b) { var d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
    async function get(id) { var r = await fetch('/notes/surveyVersion/' + id); var d = await r.json(); if (!d.ok) throw new Error(d.error || r.status); return d.version; }

    async function open(o) {
        var w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups for MTX to open the report.'); return; }
        w.document.write('<p style="font-family:sans-serif">Building QC report…</p>');
        try {
            var V = await get(o.versionId), O = o.originalId ? await get(o.originalId) : null;
            var imp = o.unit === 'imperial', L = function (m) { return imp ? m / FT : m; }, u = imp ? 'ft' : 'm';
            var S = V.survey, chain = V.chain || [], n = S.length;
            var steps = chain.map(function (c, k) {
                var has = Array.isArray(c.dMd) && c.dMd.length === n;
                return { k: k, c: c, has: has, dMd: has ? c.dMd : null, dInc: has ? c.dInc : null, dAz: has ? c.dAz : null };
            });
            var posOk = O && O.survey && O.survey.length === n;
            var rows = S.map(function (s, i) {
                var r = { oMd: s.origMd, oInc: s.origInc, oAz: s.origAz, md: s.md, inc: s.inc, az: s.az, tvd: s.tvd, n: s.n, e: s.e,
                    dMd: s.md - s.origMd, dInc: s.inc - s.origInc, dAz: azd(s.az, s.origAz), steps: steps.map(function (t) { return t.has ? [t.dMd[i], t.dInc[i], t.dAz[i]] : null; }) };
                if (posOk) { var p = O.survey[i]; r.dTvd = s.tvd - p.tvd; r.dN = s.n - p.n; r.dE = s.e - p.e; r.o = p; }
                var sm = [0, 0, 0], all = true;
                r.steps.forEach(function (x) { if (!x) all = false; else { sm[0] += x[0]; sm[1] += x[1]; sm[2] += x[2]; } });
                r.res = all ? Math.max(Math.abs(sm[0] - r.dMd), Math.abs(sm[1] - r.dInc), Math.abs(azd(sm[2], r.dAz))) : null;
                return r;
            });
            var mx = function (k) { return rows.reduce(function (a, r) { return Math.max(a, Math.abs(r[k] || 0)); }, 0); };
            var last = rows[n - 1], resMax = rows.reduce(function (a, r) { return r.res == null ? a : Math.max(a, r.res); }, 0);
            var legacy = steps.some(function (t) { return !t.has; });

            // plots (light theme, embedded as PNG)
            var img1 = '', img2 = '';
            if (window.Plotly) {
                var x = rows.map(function (r) { return L(r.oMd); }), lay = function (yt) { return { paper_bgcolor: '#fff', plot_bgcolor: '#fff', font: { color: '#111', size: 13 }, margin: { l: 70, r: 20, t: 20, b: 50 }, legend: { orientation: 'h', y: -0.25 },
                    xaxis: { title: 'Original MD (' + u + ')', gridcolor: '#ddd' }, yaxis: { title: yt, gridcolor: '#ddd' } }; };
                var tr = function (y, name, col, ax) { return { x: x, y: y, name: name, mode: 'lines', line: { color: col, width: 2 }, yaxis: ax || 'y' }; };
                try {
                    img1 = await Plotly.toImage({ data: [tr(rows.map(function (r) { return L(r.dMd); }), 'ΔMD (' + u + ')', '#1f77b4'), tr(rows.map(function (r) { return r.dInc; }), 'ΔInc (°)', '#d62728', 'y2'), tr(rows.map(function (r) { return r.dAz; }), 'ΔAz (°)', '#2ca02c', 'y2')],
                        layout: Object.assign(lay('ΔMD (' + u + ')'), { yaxis2: { title: 'ΔInc / ΔAz (°)', overlaying: 'y', side: 'right', showgrid: false } }) }, { format: 'png', width: 1100, height: 400, scale: 2 });
                    if (posOk) img2 = await Plotly.toImage({ data: [tr(rows.map(function (r) { return L(r.dTvd); }), 'ΔTVD', '#9467bd'), tr(rows.map(function (r) { return L(r.dN); }), 'ΔN', '#ff7f0e'), tr(rows.map(function (r) { return L(r.dE); }), 'ΔE', '#17becf')],
                        layout: lay('Position change (' + u + ')') }, { format: 'png', width: 1100, height: 400, scale: 2 });
                } catch (e) { }
            }
            var kv = function (a) { return '<table class="kv">' + a.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>'; };
            var stepMax = function (t, k) { return t.has ? Math.max.apply(null, t[k].map(Math.abs)) : null; };
            var stepsHtml = '<table><tr><th>#</th><th>Correction</th><th>Model</th><th>Details</th><th>Applied to</th><th>max |ΔMD| (' + u + ')</th><th>max |ΔInc| (°)</th><th>max |ΔAz| (°)</th><th>Date</th><th>By</th></tr>' +
                steps.map(function (t) { var c = t.c; return '<tr><td>' + (t.k + 1) + '</td><td>' + esc(NAMES[c.type] || c.tag) + '</td><td>' + esc(c.model || '—') + '</td><td>' + esc(c.label || '') + (t.has ? '' : ' <span class="bad">(no per-station history)</span>') + '</td><td>' + esc(c.sourceName || '—') + '</td>' +
                    '<td>' + f(t.has ? L(stepMax(t, 'dMd')) : null, 3) + '</td><td>' + f(stepMax(t, 'dInc'), 3) + '</td><td>' + f(stepMax(t, 'dAz'), 3) + '</td><td>' + (c.date ? new Date(c.date).toISOString().slice(0, 10) : '—') + '</td><td>' + esc(c.userName || '—') + '</td></tr>'; }).join('') + '</table>';
            var hdr = '<tr><th rowspan="2">Orig MD</th><th rowspan="2">Orig Inc</th><th rowspan="2">Orig Az</th>' + steps.map(function (t) { return '<th colspan="3">' + esc(NAMES[t.c.type] || t.c.tag) + '</th>'; }).join('') +
                '<th colspan="3">Total</th><th rowspan="2">Final MD</th><th rowspan="2">Final Inc</th><th rowspan="2">Final Az</th><th rowspan="2">TVD</th><th rowspan="2">N</th><th rowspan="2">E</th>' + (posOk ? '<th rowspan="2">ΔTVD</th><th rowspan="2">ΔN</th><th rowspan="2">ΔE</th>' : '') + '</tr><tr>' +
                steps.concat([0]).map(function () { return '<th>ΔMD</th><th>ΔInc</th><th>ΔAz</th>'; }).join('') + '</tr>';
            var body = rows.map(function (r) {
                return '<tr><td>' + f(L(r.oMd), 2) + '</td><td>' + f(r.oInc, 2) + '</td><td>' + f(r.oAz, 2) + '</td>' + r.steps.map(function (x) { return x ? '<td>' + f(L(x[0]), 3) + '</td><td>' + f(x[1], 3) + '</td><td>' + f(x[2], 3) + '</td>' : '<td colspan="3" class="mut">—</td>'; }).join('') +
                    '<td><b>' + f(L(r.dMd), 3) + '</b></td><td><b>' + f(r.dInc, 3) + '</b></td><td><b>' + f(r.dAz, 3) + '</b></td><td>' + f(L(r.md), 2) + '</td><td>' + f(r.inc, 2) + '</td><td>' + f(r.az, 2) + '</td><td>' + f(L(r.tvd), 2) + '</td><td>' + f(L(r.n), 2) + '</td><td>' + f(L(r.e), 2) + '</td>' +
                    (posOk ? '<td>' + f(L(r.dTvd), 3) + '</td><td>' + f(L(r.dN), 3) + '</td><td>' + f(L(r.dE), 3) + '</td>' : '') + '</tr>';
            }).join('');
            var today = new Date().toISOString().slice(0, 10);
            var css = 'body{font-family:Segoe UI,Arial,sans-serif;color:#111;margin:24px 28px;font-size:12px}h1{color:' + BLUE + ';font-size:22px;margin:0}h2{color:' + BLUE + ';font-size:16px;border-bottom:2px solid ' + BLUE + ';padding-bottom:3px;margin-top:22px}' +
                'table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccc;padding:3px 5px;text-align:right}th{background:#eef3f9;text-align:center}td:first-child{text-align:left}.kv th{width:34%;text-align:left}.kv td{text-align:left}' +
                '.hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid ' + BLUE + ';padding-bottom:8px}.bad{color:#c62828}.ok{color:#14843f}.mut{color:#999;text-align:center}.small{font-size:11px;color:#444}' +
                '.tbl{font-size:10.5px}@media print{.np{display:none}h2{break-after:avoid}thead{display:table-header-group}}';
            var h = '<!doctype html><html><head><meta charset="utf-8"><title>Correction chain QC — ' + esc(V.wellName) + '</title><style>' + css + '</style></head><body>' +
                '<div class="np" style="margin-bottom:10px"><button onclick="print()">🖨 Print / Save as PDF</button> <button id="xl">⬇ Excel (station table)</button></div>' +
                '<div class="hdr"><div><h1>Survey Correction Chain — QC Report</h1><div>' + esc(V.wellName) + (o.job ? ' · ' + esc(o.job) : '') + '</div></div><img src="' + LOGO + '" style="height:54px"></div>' +
                '<h2>1 · Summary</h2>' + kv([['Well (original)', esc(V.baseWellName || o.well || '—')], ['Final version', esc(V.wellName)], ['Toolcode of the final version', esc(V.toolcode || '—')],
                    ['Corrections (in order)', ['Original'].concat(steps.map(function (t) { return esc(NAMES[t.c.type] || t.c.tag) + (t.c.model ? ' (' + esc(t.c.model) + ')' : ''); })).join(' → ')],
                    ['Stations', n], ['Largest |ΔMD| / |ΔInc| / |ΔAz|', f(L(mx('dMd')), 3) + ' ' + u + ' / ' + f(mx('dInc'), 3) + '° / ' + f(mx('dAz'), 3) + '°'],
                    ['At the last station', 'ΔMD ' + f(L(last.dMd), 3) + ' ' + u + (posOk ? ' · ΔTVD ' + f(L(last.dTvd), 3) + ' · ΔN ' + f(L(last.dN), 3) + ' · ΔE ' + f(L(last.dE), 3) + ' ' + u + ' · horizontal shift ' + f(L(Math.hypot(last.dN, last.dE)), 3) + ' ' + u : '')],
                    ['QC — Σ step deltas vs final − original', legacy ? '<span class="bad">not available: a step was saved before 2026-11-12 (no per-station history)</span>' : (resMax < 1e-4 ? '<span class="ok">✔ consistent (max residual ' + resMax.toExponential(1) + ')</span>' : '<span class="bad">✖ max residual ' + resMax.toFixed(5) + '</span>')],
                    ['Report date', today]]) +
                '<h2>2 · Corrections applied</h2>' + stepsHtml +
                '<h2>3 · Corrections along the well</h2>' + (img1 ? '<img src="' + img1 + '" style="width:100%">' : '<p>(plot unavailable)</p>') +
                '<h2>4 · Position change vs the original survey</h2>' + (img2 ? '<img src="' + img2 + '" style="width:100%">' : (posOk ? '<p>(plot unavailable)</p>' : '<p class="small">Original survey positions not available — position changes not shown.</p>')) +
                '<h2>5 · Station table</h2><p class="small">Δ = corrected − original. MD in ' + u + ', angles in degrees. TVD / N / E as stored in the final version (minimum curvature from the original tie; each module adds its position change to the stored values of the version it started from).</p>' +
                '<table class="tbl"><thead>' + hdr + '</thead><tbody>' + body + '</tbody></table>' +
                '<h2>6 · Sign-off</h2><table><tr><th></th><th>Name</th><th>Signature</th><th>Date</th></tr><tr><td>Prepared by</td><td></td><td></td><td>' + today + '</td></tr><tr><td>Checked by</td><td></td><td></td><td></td></tr></table></body></html>';
            w.document.open(); w.document.write(h); w.document.close();
            var b = w.document.getElementById('xl');
            if (b) b.onclick = function () {
                if (!window.XLSX || !XLSX.utils) { alert('Excel library not loaded.'); return; }
                var data = rows.map(function (r) {
                    var x = {}; x['Orig MD (' + u + ')'] = +L(r.oMd).toFixed(3); x['Orig Inc'] = r.oInc; x['Orig Az'] = r.oAz;
                    steps.forEach(function (t, k) { var nm = (NAMES[t.c.type] || t.c.tag) + ' '; var s = r.steps[k]; x[nm + 'dMD'] = s ? +L(s[0]).toFixed(4) : ''; x[nm + 'dInc'] = s ? s[1] : ''; x[nm + 'dAz'] = s ? s[2] : ''; });
                    x['Total dMD (' + u + ')'] = +L(r.dMd).toFixed(4); x['Total dInc'] = +r.dInc.toFixed(5); x['Total dAz'] = +r.dAz.toFixed(5);
                    x['Final MD'] = +L(r.md).toFixed(3); x['Final Inc'] = r.inc; x['Final Az'] = r.az; x['TVD'] = +L(r.tvd).toFixed(3); x['N'] = +L(r.n).toFixed(3); x['E'] = +L(r.e).toFixed(3);
                    if (posOk) { x['dTVD'] = +L(r.dTvd).toFixed(4); x['dN'] = +L(r.dN).toFixed(4); x['dE'] = +L(r.dE).toFixed(4); }
                    return x;
                });
                var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'QC');
                XLSX.writeFile(wb, 'ChainQC_' + String(V.wellName).replace(/[^a-z0-9\-_ +]/gi, '_') + '.xlsx');
            };
        } catch (err) { w.document.open(); w.document.write('<p style="font-family:sans-serif;color:#c62828">QC report failed: ' + esc(err.message) + '</p>'); w.document.close(); }
    }
    window.MtxChainReport = { open: open };
})();

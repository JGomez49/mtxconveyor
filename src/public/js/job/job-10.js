/* MTX Conveyor — job page script 10. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 12941) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const PASON_NOTE_ID = window.MTX_JOB.noteId;

    // Same 7 plots / titles / units as uploadPason.ejs, so the viewer here
    // matches the source page exactly. Colours also match: Avg=cyan,
    // Max=green, Min=red.
    const PLOT_REGISTRY = [
        { id:'td',   name:'Hole Depth vs Time (days)',   xTitle:'Time (days from start)',  yTitle:'Hole Depth (m)',   reversedY:true  },
        { id:'hl',   name:'Hook Load vs Measured Depth', xTitle:'Measured Depth (m)',      yTitle:'Hook Load (kDaN)', reversedY:false },
        { id:'tq',   name:'Torque vs Measured Depth',    xTitle:'Measured Depth (m)',      yTitle:'Torque (kN·m)',    reversedY:false },
        { id:'wob',  name:'WOB vs Measured Depth',       xTitle:'Measured Depth (m)',      yTitle:'WOB (kDaN)',       reversedY:false },
        { id:'rop',  name:'ROP vs Measured Depth',       xTitle:'Measured Depth (m)',      yTitle:'ROP (m/h)',        reversedY:false },
        { id:'mse',  name:'MSE vs Measured Depth',       xTitle:'Measured Depth (m)',      yTitle:'MSE (ksi)',        reversedY:false },
        { id:'flow', name:'Flow vs Measured Depth',      xTitle:'Measured Depth (m)',      yTitle:'Flow (m³/min)',    reversedY:false },
        // 2026-11-21 (John): slide / rotate ROP and Motor Yield tabs of the Pason Plots export (views/uploadPason.ejs). Read-only,
        // listed only when the uploaded file has them; the three MY entries act as the Slide / Rotary / Corrected toggle.
        { id:'rops', name:'ROP Slide vs Measured Depth',  xTitle:'Measured Depth (m)',     yTitle:'Slide ROP (m/h)',  reversedY:false },
        { id:'ropr', name:'ROP Rotate vs Measured Depth', xTitle:'Measured Depth (m)',     yTitle:'Rotate ROP (m/h)', reversedY:false },
        { id:'mys',  name:'Motor Yield (slide) vs MD',    xTitle:'Measured Depth (m)',     yTitle:'MY (°/30 m)',      reversedY:false },
        { id:'myr',  name:'Rotary tendency (DLS) vs MD',  xTitle:'Measured Depth (m)',     yTitle:'DLS (°/30 m)',     reversedY:false },
        { id:'myc',  name:'Motor Yield (rotation-corrected) vs MD', xTitle:'Measured Depth (m)', yTitle:'MY (°/30 m)', reversedY:false },
        { id:'myb',  name:'Rotary build rate vs MD',      xTitle:'Measured Depth (m)',     yTitle:'Build (°/30 m, + up)', reversedY:false },
        { id:'myw',  name:'Rotary walk rate vs MD',       xTitle:'Measured Depth (m)',     yTitle:'Walk (°/30 m, + right)', reversedY:false },
    ];
    const SHEET_NAME_TO_ID = { 'hook load':'hl', 'torque':'tq', 'wob':'wob', 'rop':'rop', 'mse':'mse', 'flow':'flow', 'hole depth vs time':'td', 'rop slide':'rops', 'rop rotate':'ropr', 'my slide':'mys', 'my rotary dls':'myr', 'my corrected':'myc', 'my rot build':'myb', 'my rot walk':'myw' };

    let _plots = null;      // { hl: {xHeader, rows}, tq: {...}, ... }
    let _chart = null;
    let _snowChart = null;   // 2026-11-22 snowball chart
    // 2026-11-22: phone chart options (<= 576 px wide): fill the CSS box, 10 px fonts, fewer ticks, legend at the bottom
    function mtxPhone(){ return window.matchMedia && window.matchMedia('(max-width: 576px)').matches; }
    function mtxPhoneChart(opt, shortX, shortY){ if(!mtxPhone()) return opt;
        opt.maintainAspectRatio = false; opt.layout = { padding: 2 };
        const lg = opt.plugins && opt.plugins.legend; if(lg){ lg.position = 'bottom'; lg.labels = Object.assign({}, lg.labels, { boxWidth: 12, boxHeight: 8, padding: 6, font: { size: 10 } }); }
        ['x', 'y'].forEach(k => { const a = opt.scales && opt.scales[k]; if(!a) return; a.ticks = Object.assign({}, a.ticks, { font: { size: 10 }, maxTicksLimit: k === 'x' ? 6 : 8 });
            if(a.title){ a.title.font = { size: 10 }; a.title.text = (k === 'x' ? shortX : shortY) || a.title.text; } });
        return opt; }
    let _mtxWasPhone = mtxPhone();
    window.addEventListener('resize', () => { const ph = mtxPhone(); if(ph === _mtxWasPhone) return; _mtxWasPhone = ph; const sel = el('pasonPlotSelect'); if(sel && sel.value && _plots) renderPasonChart(sel.value); });

    const el = id => document.getElementById(id);
    

    function setStatus(msg){ const s = el('pasonPlotsStatus'); if(s) s.textContent = msg; }

    // ── Load existing data on page open ─────────────────────────────────
    function loadFromEmbedded(){
        const dataEl = el('pasonPlotsData');
        if(!dataEl) return;
        let doc;
        try { doc = JSON.parse(dataEl.textContent); } catch(e){ return; }
        if(doc && doc.slideRotModel && doc.plots && !doc.plots.td) doc.plots.td = { xHeader: 'Time (days)', rows: [] };   // 2026-11-20: planned well with a slide/rotate model and no Pason data
        if(!doc || !doc.plots || !Object.keys(doc.plots).length) return;
        _plots = doc.plots;
        showViewer();
        const meta = el('pasonPlotsMeta');
        if(meta){
            const when = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : '';
            meta.textContent = `Uploaded ${when}` + (doc.user ? '' : '');
        }
    }

    function populateDropdown(){
        const sel = el('pasonPlotSelect');
        if(!sel) return;
        sel.innerHTML = '';
        PLOT_REGISTRY.forEach(p => {
            if(!_plots[p.id]) return; // only list plots that actually have data
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        // Default: Hook Load vs Measured Depth if present, else first available
        sel.value = _plots['td'] ? 'td' : (sel.options[0] ? sel.options[0].value : '');
    }

    function showViewer(){
        populateDropdown();
        const sel = el('pasonPlotSelect');
        if(!sel || !sel.value){ return; } // nothing to show
        el('pasonPlotsViewer').style.display = '';
        el('pasonPlotsEmpty').style.display = 'none';
        renderPasonChart(sel.value);
        if(typeof renderDmk === 'function') renderDmk();   // 2026-11-20 KPIs per section
    }

    function renderPasonChart(plotId){
        const plotDef = PLOT_REGISTRY.find(p => p.id === plotId);
        const data = _plots && _plots[plotId];
        const canvas = el('pasonChart');
        if(!plotDef || !data || !canvas) return;

        if(_chart){ try{ _chart.destroy(); }catch(e){} _chart = null; }

        const isLight = document.body.classList.contains('light-mode');
        const wrap = el('pasonChartWrap');
        if(wrap) wrap.style.background = isLight ? '#ffffff' : '#1b1e21';
        const textColor = isLight ? '#212529' : '#e9ecef';
        const tickColor = isLight ? '#495057' : '#adb5bd';
        const gridColor = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(173,181,189,0.2)';

        const rows = data.rows || [];
        const avgPts = [], maxPts = [], minPts = [];
        rows.forEach(r => {
            const x = r[0];
            if(r[1] !== '' && r[1] !== null && r[1] !== undefined) avgPts.push({x, y:r[1]});
            if(r[2] !== '' && r[2] !== null && r[2] !== undefined) maxPts.push({x, y:r[2]});
            if(r[3] !== '' && r[3] !== null && r[3] !== undefined) minPts.push({x, y:r[3]});
        });

        const datasets = [];
        // For "Hole Depth vs Time (days)" specifically, only the Calculated
        // Time vs Depth curve is shown — the raw Min/Max/Average lines from
        // the EDR export aren't meaningful for a planned-trajectory view.
        if(plotId !== 'td'){
            if(minPts.length) datasets.push({ label:'Min', data:minPts, borderColor:'#ff0000', backgroundColor:'#ff0000', showLine:true, borderWidth:2, pointRadius:0, fill:false, tension:0.25 });
            if(maxPts.length) datasets.push({ label:'Max', data:maxPts, borderColor:'#00ff00', backgroundColor:'#00ff00', showLine:true, borderWidth:2, pointRadius:0, fill:false, tension:0.25 });
            if(avgPts.length) datasets.push({ label:'Average', data:avgPts, borderColor:'#00e5ff', backgroundColor:'#00e5ff', showLine:true, borderWidth:2, pointRadius:0, fill:false, tension:0.25 });
        }

        // Optional: imported raw rig X,Y data for this plot, shown as dots.
        const raw = data.raw;
        const dotSizeRow = el('pasonDotSizeRow');
        if(raw && raw.points && raw.points.length){
            const pointSize = raw.pointSize != null && isFinite(raw.pointSize) && raw.pointSize >= 0 ? Number(raw.pointSize) : 3;
            // 2026-11-22 (John): dot size had no visible effect — each dot also had the default 1 px outline (pointBorderWidth),
            // so with hundreds of dense points even radius 1 looked like a thick line. Outline removed; radius only.
            datasets.push({
                label: 'Raw X,Y', data: raw.points.map(p => ({x:p[0], y:p[1]})),
                showLine:false, pointRadius: pointSize, pointHoverRadius: pointSize > 0 ? pointSize+2 : 0, pointBorderWidth: 0, pointHoverBorderWidth: 0,
                pointStyle: 'circle', pointBackgroundColor: '#ffa500', pointBorderColor: '#ffa500', hidden: !(pointSize > 0), order: -1,   // 2026-11-22: explicit colours, on top, 0 = hidden
                borderColor:'#ffa500', backgroundColor:'#ffa500',
            });
            if(dotSizeRow){
                dotSizeRow.style.display = '';
                const slider = el('pasonDotSizeSlider'), val = el('pasonDotSizeVal');
                if(slider){ slider.value = pointSize; }
                if(val){ val.textContent = pointSize; }
            }
        } else if(dotSizeRow){
            dotSizeRow.style.display = 'none';
        }

        // Optional: calculated Time vs Depth curve (only meaningful for 'td' plot).
        // Reads a saved per-well curve if one exists; otherwise auto-computes
        // an ephemeral, view-only preview (using default pause values, never
        // saved to MongoDB) so anyone — including viewer — can explore any
        // well's planned Time vs Depth just by selecting it.
        const tdWellSel = el('pasonTDWellSelect');
        const selectedWellKey = tdWellSel && tdWellSel.value;
        const tdCalcRow = el('pasonTDCalcRow');
        if(tdCalcRow) tdCalcRow.style.display = (plotId === 'td') ? '' : 'none';

        // 2026-11-21 (John): the purple curve is ALWAYS calculated live (follows the Min / Avg / Max selector and the time model);
        // a stored curve is shown separately as the saved budget (grey dashed). Was: a saved curve replaced the live one.
        let calc = null, isPreview = true, budget = null;
        const tdPreviewNote = el('pasonTDPreviewNote');
        if(plotId === 'td' && selectedWellKey){
            budget = data.calculatedByWell && data.calculatedByWell[selectedWellKey];
            const live = calculateTimeVsDepth(selectedWellKey);
            if(!live.error) calc = { points: live.points };
            if(tdPreviewNote){ tdPreviewNote.style.display = ''; tdPreviewNote.innerHTML = live.error ? '⚠ ' + live.error : live.info; }
        } else if(tdPreviewNote) tdPreviewNote.style.display = 'none';
        if(plotId === 'td' && budget && budget.points && budget.points.length) datasets.push({ label: 'Saved budget' + (budget.savedAt ? ' ' + new Date(budget.savedAt).toLocaleDateString() : '') + (budget.ropCurve ? ' (' + budget.ropCurve + ')' : ''),
            data: budget.points.map(p => ({ x: p[0], y: p[1] })), showLine: true, pointRadius: 0, borderWidth: 1.5, borderDash: [2, 4], fill: false, tension: 0, borderColor: '#8a93a3', backgroundColor: '#8a93a3' });

        const planPts = (plotId === 'td' && calc && calc.points) ? calc.points.map(p => [p[0], p[1]]) : null;   // 2026-11-21: planned-vs-actual align / calibrate removed
        if(plotId === 'td' && calc && calc.points && calc.points.length){
            datasets.push({
                label: 'Planned Time vs Depth (live, ' + { min: 'Min', avg: 'Avg', max: 'Max' }[window.MTX_ROP.curve] + (window.MTX_SRM.active() ? ', slide/rotate model' : ', Pason ROP') + ')',
                data: planPts.map(p => ({x:p[0], y:p[1]})),
                showLine:true, pointRadius:0, borderWidth:2, borderDash:[6,3], fill:false, tension:0,
                borderColor:'#b264ff', backgroundColor:'#b264ff',
            });
        }

        const ctx = canvas.getContext('2d');
        _chart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: mtxPhoneChart({
                responsive: true,
                plugins: {
                    legend: { display:true, labels:{ color:textColor } },
                    tooltip: {
                        mode:'nearest', intersect:false,
                        callbacks: { label: (ctx) => {
                            const y = ctx.parsed.y, x = ctx.parsed.x;
                            const name = ctx.dataset.label || 'Series';
                            const xf = Number.isFinite(x) ? x.toFixed(2) : '—';
                            const yf = Number.isFinite(y) ? y.toFixed(2) : '—';
                            return `${name}: ${yf} @ ${xf}`;
                        }}
                    },
                    zoom: { pan:{enabled:true, mode:'xy'}, zoom:{ wheel:{enabled:true, modifierKey:'ctrl'}, pinch:{enabled:true}, mode:'xy' } }
                },
                scales: {
                    x: { type:'linear', title:{display:true, text:plotDef.xTitle, color:textColor}, ticks:{color:tickColor}, grid:{color:gridColor} },
                    y: { type:'linear', reverse: !!plotDef.reversedY, title:{display:true, text:plotDef.yTitle, color:textColor}, ticks:{color:tickColor}, grid:{color:gridColor} },
                }
            }, plotId === 'td' ? 'Days' : 'MD (m)', plotDef.yTitle.replace(/\s*\(.*$/, '') + ((plotDef.yTitle.match(/\(([^)]*)\)/) || [])[1] ? ' (' + plotDef.yTitle.match(/\(([^)]*)\)/)[1] + ')' : ''))
        });
        renderSnowball(plotId, selectedWellKey, calc, budget, raw, { textColor, tickColor, gridColor });   // 2026-11-22
    }

    /* ── 2026-11-22 (John): SNOWBALL TIME VS DEPTH ─────────────────────────────────────────────────────────────────────────
     * Y = total drilled metres = leg 1 from 0 + each later leg's new hole (its depth below its own deepest point so far), X = days.
     * Conversion of a hole-depth-vs-time series (planned, saved budget, Raw X,Y dots): a new leg starts when the depth drops
     * > 10 m below the current leg's deepest point; until drilling resumes (depth 0.5 m above the leg's shallowest point) the leg's
     * reference follows the shallowest depth, so tripping in / reaming adds nothing. The Pason Min / Avg / Max curves are not
     * converted (they average depth across wells at each time, mixing legs).
     * Strips: from the PLAN of the selected well — leg 1 split Surface (0→SC) / Build (SC→IC) / Lateral (IC→TD), each later leg
     * one strip of length TD − STK, stacked in total metres. MTX choices (display only).
     */
    function snowSeries(pts){
        const out = []; let cum = 0, ref = null, seek = false, peak = null;
        (pts || []).forEach(p => { const t = +p[0], d = +p[1]; if(!isFinite(t) || !isFinite(d)) return;
            if(ref === null){ ref = d; peak = d; cum = 0; }
            else if(d < peak - 10){ seek = true; ref = d; peak = d; }
            else if(seek){ if(d < ref) ref = d; else if(d > ref + 0.5){ seek = false; cum += d - ref; ref = d; peak = d; } peak = Math.max(peak, ref); }
            else if(d > ref){ cum += d - ref; ref = d; peak = d; }
            out.push({ x: t, y: cum }); });
        return out;
    }
    const SNOW_COLORS = ['#3d7bd9', '#e0a030', '#47b36b', '#c94f7c', '#8a63d2', '#2bb3b3', '#d96a3d', '#7c9c2a', '#b04fc9', '#4f8fc9', '#c9a04f', '#5fc94f'];
    function snowStrips(wellKey){
        const g = getTrajectoryWellGroups(), legs = g.wells && g.wells[wellKey]; if(!legs || !legs.length) return [];
        const L = legs.map(tdBuildLegInfo), out = [], l1 = L[0], c0 = SNOW_COLORS[0];
        const cuts = [['Surface', 0]]; if(l1.scMD != null) cuts.push(['Build', l1.scMD]); if(l1.icpMD != null) cuts.push(['Lateral', l1.icpMD]);
        cuts.forEach((c, i) => { const to = i + 1 < cuts.length ? cuts[i + 1][1] : l1.tdMD; if(to > c[1]) out.push({ from: c[1], to, color: c0, alpha: [0.10, 0.20, 0.32][i] || 0.32, label: 'Leg 1 · ' + c[0] + ' ' + c[1].toFixed(0) + '→' + to.toFixed(0) + ' m' }); });
        let cum = l1.tdMD;
        for(let k = 1; k < L.length; k++){ const lg = L[k]; if(lg.stkMD == null) continue; const len = lg.tdMD - lg.stkMD; if(!(len > 0)) continue;
            out.push({ from: cum, to: cum + len, color: SNOW_COLORS[k % SNOW_COLORS.length], alpha: 0.22, label: 'Leg ' + (k + 1) + ' · STK ' + lg.stkMD.toFixed(0) + ' → TD ' + lg.tdMD.toFixed(0) + ' m · ' + len.toFixed(0) + ' m' }); cum += len; }
        return out;
    }
    function snowRgba(hex, a){ const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
    const snowStripPlugin = { id: 'snowStrips', beforeDatasetsDraw(chart){ const st = chart.options.plugins.snowStrips && chart.options.plugins.snowStrips.strips; if(!st || !st.length) return;
        const { ctx, chartArea: ca, scales: { y } } = chart; ctx.save(); ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.width, ca.height); ctx.clip();
        st.forEach(b => { const y1 = y.getPixelForValue(b.from), y2 = y.getPixelForValue(b.to), top = Math.min(y1, y2), h = Math.abs(y2 - y1); if(h <= 0) return;
            ctx.fillStyle = snowRgba(b.color, b.alpha); ctx.fillRect(ca.left, top, ca.width, h);
            ctx.strokeStyle = snowRgba(b.color, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ca.left, top); ctx.lineTo(ca.right, top); ctx.stroke();
            const ph = mtxPhone(), lbl = ph ? b.label.split(' · ').slice(0, 2).join(' · ') : b.label;   // phone: shorter label
            if(h >= (ph ? 9 : 11)){ ctx.fillStyle = snowRgba(b.color, 0.95); ctx.font = (ph ? '9px' : '11px') + ' sans-serif'; ctx.textBaseline = 'top'; ctx.fillText(lbl, ca.left + 4, top + 1); } });
        ctx.restore(); } };
    function renderSnowball(plotId, wellKey, calc, budget, raw, col){
        const wrap = el('pasonSnowWrap'), cv = el('pasonSnowChart'); if(!wrap || !cv) return;
        if(_snowChart){ _snowChart.destroy(); _snowChart = null; }
        if(plotId !== 'td'){ wrap.style.display = 'none'; return; }
        const ds = [];
        if(raw && raw.points && raw.points.length){ const ps = raw.pointSize != null && isFinite(raw.pointSize) ? +raw.pointSize : 3;
            ds.push({ label: 'Actual (Raw X,Y)', data: snowSeries(raw.points.slice().sort((a, b) => a[0] - b[0])), showLine: false, pointRadius: ps, pointBorderWidth: 0, pointBackgroundColor: '#ffa500', borderColor: '#ffa500', backgroundColor: '#ffa500', hidden: !(ps > 0) }); }
        if(budget && budget.points && budget.points.length) ds.push({ label: 'Saved budget', data: snowSeries(budget.points), showLine: true, pointRadius: 0, borderWidth: 1.5, borderDash: [2, 4], borderColor: '#8a93a3', backgroundColor: '#8a93a3', tension: 0, fill: false });
        if(calc && calc.points && calc.points.length) ds.push({ label: 'Planned (live, ' + { min: 'Min', avg: 'Avg', max: 'Max' }[window.MTX_ROP.curve] + ')', data: snowSeries(calc.points), showLine: true, pointRadius: 0, borderWidth: 2, borderDash: [6, 3], borderColor: '#b264ff', backgroundColor: '#b264ff', tension: 0, fill: false });
        const strips = wellKey ? snowStrips(wellKey) : [];
        if(!ds.length && !strips.length){ wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        // 2026-11-28 (John): follow the light / dark theme like the saw-teeth chart above. Was: box and title fixed dark (#1b1e21) in job.ejs.
        { const isLight = document.body.classList.contains('light-mode'); wrap.style.background = isLight ? '#ffffff' : '#1b1e21';
          const tt = el('pasonSnowTitle'); if(tt) tt.style.color = col.textColor; }
        const yMax = Math.max(strips.length ? strips[strips.length - 1].to : 0, ...ds.map(d => d.data.length ? d.data[d.data.length - 1].y : 0));
        _snowChart = new Chart(cv.getContext('2d'), { type: 'line', data: { datasets: ds }, plugins: [snowStripPlugin],
            options: mtxPhoneChart({ responsive: true, animation: false,
                plugins: { snowStrips: { strips },
                    legend: { display: true, labels: { color: col.textColor } },
                    tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.parsed.y.toFixed(0) + ' m @ ' + c.parsed.x.toFixed(2) + ' d' } },
                    zoom: { pan: { enabled: true, mode: 'xy' }, zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode: 'xy' } } },
                scales: { x: { type: 'linear', title: { display: true, text: 'Time (days from start)', color: col.textColor }, ticks: { color: col.tickColor }, grid: { color: col.gridColor } },
                          y: { type: 'linear', reverse: true, min: 0, suggestedMax: yMax > 0 ? yMax * 1.02 : undefined, title: { display: true, text: 'Total drilled depth, all legs (m)', color: col.textColor }, ticks: { color: col.tickColor }, grid: { color: col.gridColor } } } }, 'Days', 'Total m') });
    }

    // ── Upload + parse xlsx (admin/leader/user only) ─────────────────────
    const fileInput = el('pasonPlotsFileInput');
    const uploadBtn = el('pasonPlotsUploadBtn');
    let _parsedForUpload = null;

    if(fileInput){
        fileInput.addEventListener('change', function(e){
            const file = e.target.files[0];
            if(!file) return;
            uploadBtn.disabled = true;
            _parsedForUpload = null;
            setStatus('Reading file…');
            const reader = new FileReader();
            reader.onload = function(ev){
                try {
                    const wb = XLSX.read(ev.target.result, { type:'array' });
                    const plots = {};
                    wb.SheetNames.forEach(sheetName => {
                        // 2026-11-21 (John): LAS time statistics tabs (Pason Plots page, LAS wells) for the time model
                        const lk = sheetName.trim().toLowerCase();
                        if(lk === 'flat times'){ plots.flatTimes = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' }).slice(1).filter(r => r.length && r[0] !== ''); return; }   // 2026-11-21
                        if(lk === 'las time per 100 m' || lk === 'las stops'){
                            const a2 = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' }).slice(1).filter(r => r.length && r[0] !== '');
                            plots[lk === 'las stops' ? 'lasStops' : 'lasTime'] = a2; return;
                        }
                        const id = SHEET_NAME_TO_ID[sheetName.trim().toLowerCase()];
                        if(!id) return; // unrecognised sheet — skip
                        const ws = wb.Sheets[sheetName];
                        const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
                        if(aoa.length < 2) return;
                        const xHeader = aoa[0][0] || 'X';
                        const rows = aoa.slice(1)
                            .filter(r => r.length && r[0] !== '' && r[0] !== null && r[0] !== undefined)
                            .map(r => [Number(r[0]), r[1]===''?'':Number(r[1]), r[2]===''?'':Number(r[2]), r[3]===''?'':Number(r[3])]);
                        plots[id] = { xHeader, rows };
                    });
                    if(!Object.keys(plots).length){
                        setStatus('⚠ No recognised plot sheets found in this file. Expected sheet names: Hook Load, Torque, WOB, ROP, MSE, Flow, Hole Depth vs Time.');
                        return;
                    }
                    _parsedForUpload = plots;
                    setStatus(`✅ Parsed ${Object.keys(plots).length} plot(s). Click Save to store.`);
                    uploadBtn.disabled = false;
                } catch(err){
                    console.error(err);
                    setStatus('❌ Parse error: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    if(uploadBtn){
        uploadBtn.addEventListener('click', async function(){
            if(!_parsedForUpload) return;
            setStatus('Saving…');
            uploadBtn.disabled = true;
            try {
                const res = await fetch('/notes/pasonPlots/' + PASON_NOTE_ID, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ noteId: PASON_NOTE_ID, plots: _parsedForUpload }),
                });
                const data = await res.json();
                if(res.ok){
                    setStatus(`✅ Saved ${data.plotCount} plot(s) to this job.`);
                    _plots = _parsedForUpload;
                    showViewer();
                } else {
                    setStatus('❌ Save failed: ' + (data.error || res.statusText));
                    uploadBtn.disabled = false;
                }
            } catch(err){
                setStatus('❌ Error: ' + err.message);
                uploadBtn.disabled = false;
            }
        });
    }

    // ── Import raw X,Y (dots) for the currently selected plot ────────────
    const rawFileInput = el('pasonRawXYFileInput');
    const rawImportBtn = el('pasonRawXYImportBtn');
    let _parsedRawXY = null;

    async function persistPlots(successMsg){
        const res = await fetch('/notes/pasonPlots/' + PASON_NOTE_ID, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId: PASON_NOTE_ID, plots: _plots }),
        });
        const data = await res.json();
        if(res.ok){ setStatus(successMsg); return true; }
        setStatus('❌ Save failed: ' + (data.error || res.statusText));
        return false;
    }

    if(rawFileInput){
        rawFileInput.addEventListener('change', function(e){
            const file = e.target.files[0];
            if(!file) return;
            rawImportBtn.disabled = true;
            _parsedRawXY = null;
            const rawStatus = el('pasonRawXYStatus');
            if(rawStatus) rawStatus.textContent = 'Reading file…';
            const reader = new FileReader();
            reader.onload = function(ev){
                try {
                    const wb = XLSX.read(ev.target.result, { type:'array' });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
                    if(aoa.length < 2) throw new Error('File has no data rows.');
                    const points = aoa.slice(1)
                        .filter(r => r.length >= 2 && r[0] !== '' && r[1] !== '' && r[0] !== null && r[1] !== null)
                        .map(r => [Number(r[0]), Number(r[1])])
                        .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
                    if(!points.length) throw new Error('No valid numeric X,Y rows found.');
                    _parsedRawXY = points;
                    if(rawStatus) rawStatus.textContent = `✅ Parsed ${points.length} points. Click Import to add as dots.`;
                    rawImportBtn.disabled = false;
                } catch(err){
                    if(rawStatus) rawStatus.textContent = '❌ ' + err.message;
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    if(rawImportBtn){
        rawImportBtn.addEventListener('click', async function(){
            if(!_parsedRawXY || !_plots) return;
            const sel = el('pasonPlotSelect');
            const plotId = sel && sel.value;
            if(!plotId){ return; }
            const rawStatus = el('pasonRawXYStatus');
            if(rawStatus) rawStatus.textContent = 'Saving…';
            rawImportBtn.disabled = true;

            if(!_plots[plotId]) _plots[plotId] = { xHeader:'X', rows:[] };
            const existingPointSize = (_plots[plotId].raw && _plots[plotId].raw.pointSize) || 3;
            _plots[plotId].raw = { points: _parsedRawXY, pointSize: existingPointSize };

            const ok = await persistPlots(`✅ Imported ${_parsedRawXY.length} X,Y points for this plot.`);
            if(ok){
                if(rawStatus) rawStatus.textContent = `✅ Imported ${_parsedRawXY.length} points and saved.`;
                renderPasonChart(plotId);
            } else {
                rawImportBtn.disabled = false;
            }
        });
    }

    const removeRawBtn = el('pasonRawXYRemoveBtn');
    if(removeRawBtn){
        removeRawBtn.addEventListener('click', async function(){
            const sel = el('pasonPlotSelect');
            const plotId = sel && sel.value;
            if(!plotId || !_plots || !_plots[plotId] || !_plots[plotId].raw) return;
            if(!confirm('Remove the imported X,Y dots for this plot?')) return;
            delete _plots[plotId].raw;
            const ok = await persistPlots('✅ Removed imported dots and saved.');
            if(ok) renderPasonChart(plotId);
        });
    }

    const dotSizeSlider = el('pasonDotSizeSlider');
    if(dotSizeSlider){
        // Live-update the dot size as the slider is dragged (no server call).
        dotSizeSlider.addEventListener('input', function(){
            const val = Number(dotSizeSlider.value);
            const valLabel = el('pasonDotSizeVal');
            if(valLabel) valLabel.textContent = val;
            if(_chart){
                const ds = _chart.data.datasets.find(d => d.label === 'Raw X,Y');
                if(ds){ ds.pointRadius = val; ds.pointHoverRadius = val > 0 ? val + 2 : 0; ds.pointBorderWidth = 0; ds.hidden = !(val > 0); const i = _chart.data.datasets.indexOf(ds); if(i >= 0) _chart.setDatasetVisibility(i, val > 0); _chart.update(); }
            }
        });
        // Persist the chosen size once the user releases the slider.
        dotSizeSlider.addEventListener('change', async function(){
            const sel = el('pasonPlotSelect');
            const plotId = sel && sel.value;
            if(!plotId || !_plots || !_plots[plotId] || !_plots[plotId].raw) return;
            _plots[plotId].raw.pointSize = Number(dotSizeSlider.value);
            await persistPlots('✅ Dot size saved.');
        });
    }

    // ── Calculated Time vs Depth (uses planned trajectory + ROP average) ──
    // Reuses the same well-grouping / leg-numbering / STK-detection
    // conventions already established in the Legs Summary feature, applied
    // client-side here since this script runs independently of that one.
    function tdExtractWellAndLeg(wellName){
        var wn = (wellName || '').trim();
        var bm = wn.match(/^(\[\d+\])/);
        var wellKey = bm ? bm[1] : wn;
        var lm = wn.match(/_L(\d+)$/i);
        var legNum = lm ? 'L' + lm[1].padStart(2,'0') : 'L01';
        return { well: wellKey, legNum: legNum };
    }

    // Same logic as wbtIsSubjectWell in the 3D viewer script (duplicated here
    // since this script block runs independently): explicit wellCategory tag
    // takes priority; untagged legacy wells fall back to the name pattern.
    function tdIsSubjectWell(well){
        var wn = (well.wellName || '').trim();
        if(well.wellCategory === 'subject') return true;
        if(well.wellCategory === 'offset') return false;
        return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
    }

    function getTrajectoryWellGroups(){
        var dataEl = el('wbtData');
        if(!dataEl) return { wells: {}, keys: [] };
        var wbtArr;
        try { wbtArr = JSON.parse(dataEl.textContent); } catch(e){ return { wells: {}, keys: [] }; }

        var wells = {}; // wellKey -> array of { traj, legNum }
        wbtArr.forEach(function(traj){
            if(!traj.survey || !traj.survey.length) return;
            if(!tdIsSubjectWell(traj)) return;
            var p = tdExtractWellAndLeg(traj.wellName || '');
            if(!wells[p.well]) wells[p.well] = [];
            wells[p.well].push({ traj: traj, legNum: p.legNum });
        });
        Object.keys(wells).forEach(function(k){
            wells[k].sort(function(a,b){ return a.legNum.localeCompare(b.legNum); });
        });
        var keys = Object.keys(wells).sort();
        return { wells: wells, keys: keys };
    }

    function populateTDWellDropdown(){
        var sel = el('pasonTDWellSelect');
        if(!sel) return;
        var groups = getTrajectoryWellGroups();
        sel.innerHTML = '';
        if(!groups.keys.length){
            var opt = document.createElement('option');
            opt.value = ''; opt.textContent = 'No trajectory uploaded';
            sel.appendChild(opt);
            return;
        }
        groups.keys.forEach(function(k){
            var opt = document.createElement('option');
            opt.value = k; opt.textContent = k;
            sel.appendChild(opt);
        });

        // Prefer a well that already has a saved Calculated Time vs Depth
        // curve, so the user sees what was saved rather than an arbitrary
        // well. Falls back to alphabetically first (which will show an
        // ephemeral preview) if no well has been saved yet.
        var savedWellKey = null;
        var dataEl = el('pasonPlotsData');
        if(dataEl){
            try {
                var doc = JSON.parse(dataEl.textContent);
                var byWell = doc && doc.plots && doc.plots['td'] && doc.plots['td'].calculatedByWell;
                if(byWell){
                    savedWellKey = groups.keys.find(function(k){ return !!byWell[k]; }) || null;
                }
            } catch(e){}
        }
        sel.value = savedWellKey || groups.keys[0];
    }

    // Build per-leg milestone info: SurfaceCasing / IntermediateCasing (Leg1
    // only) / STK tie-on (sidetracks only) / TD, matching the exact same
    // comment-keyword detection used by the scorecards and Legs Summary.
    function tdBuildLegInfo(legEntry){
        var sv = legEntry.traj.survey;
        var td = sv[sv.length - 1];

        var scPt = null, icpPt = null, stkPt = null, stkComment = null;
        sv.forEach(function(pt){
            var cm = (pt.comments || '').trim();
            if(!cm) return;
            if(!scPt && /^SURFACECASING/i.test(cm.replace(/\s+/g,''))) scPt = pt;
            if(!icpPt && /^(ICP|IntermediateCasing)/i.test(cm)) icpPt = pt;
            if(/^STK/i.test(cm)){ stkPt = pt; stkComment = cm; } // last STK wins, matching Legs Summary
        });

        return {
            legNum: legEntry.legNum,
            wellName: legEntry.traj.wellName,
            scMD: scPt ? Number(scPt.md) : null,
            icpMD: icpPt ? Number(icpPt.md) : null,
            stkMD: stkPt ? Number(stkPt.md) : null,
            tdMD: Number(td.md),
        };
    }

    // Average the ROP-vs-Measured-Depth "Average" curve's y-values across
    // [mdStart, mdEnd]. Returns null (no fabricated fallback) if the ROP
    // plot hasn't been uploaded or has no points in that range.
    function averageROPInRange(mdStart, mdEnd, sec){
        if(sec && window.MTX_SRM.rop(sec)) return window.MTX_SRM.rop(sec);   // 2026-11-20: slide / rotate model when active
        var ropData = _plots && _plots['rop'];
        if(!ropData || !ropData.rows || !ropData.rows.length) return null;
        return window.MTX_ROP.lw(ropData.rows, mdStart, mdEnd);   // 2026-11-20: length-weighted, selected curve (was plain mean of Average)
    }

    // 2026-11-21 (John): planned Time vs Depth with the auto time model (window.MTX_TM). Was: one ROP per range + manual pauses.
    /* ── 2026-11-21 (John): PLANNED TIME VS DEPTH BY SIMULATION (used when the Pason export has the MY / slide-rotate tabs) ──
     * Per step of 'Sim step (m)' (default 30 m ≈ one stand) along each planned leg:
     *  1. Plan change dInc, dAz between the step ends (Inc / Azi linearly interpolated between plan stations, Azi wrapped).
     *  2. Slid length Ls from: sqrt((dInc - BR·Lr/30)² + ((dAz - WR·Lr/30)·sin Imid)²) = MY·Ls/30, Lr = L - Ls; solved by bisection.
     *     BR / WR = rotary build / walk (tabs 'MY Rot Build' / 'MY Rot Walk', Avg column), MY = rotation-corrected MY ('MY Corrected').
     *     Same small-angle relation as the Slide Sheet rotation correction (public/js/motorYield.js; eBook V9.10 pp. 57-58
     *     dInc = DLS·L·cosTF, dAz = DLS·L·sinTF / sinI) used in reverse — MTX choice, not a published planning method.
     *     If even Ls = L cannot give the plan curvature, Ls = L and the step is flagged (plan DLS above the offsets' MY).
     *  3. On-bottom h = Ls / slide ROP + (L - Ls) / rotate ROP ('ROP Slide' / 'ROP Rotate' tabs).
     *  4. Other in-hole h and trip h = median over the offset wells of (hours / metres drilled) per section × L ('Flat times' tab).
     *  5. Casing points: + median SC / IC flat of the offsets at the plan's SC / IC; each new leg: + median LegEnd of the offsets.
     * Curve (Min / Avg / Max) = the column of MY and both ROPs (Min = slowest: low MY → more sliding, low ROPs). BR / WR always Avg.
     */
    function simReady(){ return !!(_plots && _plots.myc && _plots.rops && _plots.ropr); }
    function simCol(id, x, col){ const d = _plots[id]; if(!d || !d.rows || !d.rows.length) return null; const r = d.rows.filter(q => q[col] !== '' && q[col] != null && isFinite(+q[col])).map(q => [+q[0], +q[col]]).sort((a, b) => a[0] - b[0]);
        if(!r.length) return null; if(x <= r[0][0]) return r[0][1]; if(x >= r[r.length - 1][0]) return r[r.length - 1][1];
        for(let i = 1; i < r.length; i++){ if(r[i][0] >= x){ const a = r[i - 1], b = r[i], f = (x - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * f; } } return null; }
    function simMedian(v){ const a = v.filter(x => isFinite(x)).sort((x, y) => x - y); if(!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
    function simFlats(){
        const ft = (_plots && _plots.flatTimes) || [], by = {}; ft.forEach(r => { const w = r[0], ty = r[1], sec = r[2]; (by[w] || (by[w] = [])).push({ ty, sec, h: +r[4], m: +r[5] }); });
        const wells = Object.keys(by), med = f => simMedian(wells.map(f).filter(v => v != null));
        const rate = (ty, sec) => med(w => { const x = by[w].filter(q => q.sec === sec); const m = x.filter(q => q.ty === 'OnBottom').reduce((a, q) => a + q.m, 0); if(!(m > 0)) return null; return x.filter(q => q.ty === ty).reduce((a, q) => a + q.h, 0) / m; });
        const ev = ty => simMedian(ft.filter(r => r[1] === ty).map(r => +r[4]));
        return { n: wells.length, sc: ev('SC'), ic: ev('IC'), leg: ev('LegEnd'), oth: s2 => rate('Other', s2), trip: s2 => rate('Trip', s2) };
    }
    function simLeg(sv, a, b, sec, step, col, F, acc, pts, tRef){
        const D = Math.PI / 180, wrap = d => ((d + 180) % 360 + 360) % 360 - 180;
        // 2026-11-22 (John): trajectory stations store incl / azim (was read as inc / az → no stations → "Cannot read properties of
        // undefined (reading 'md')" on upload). Both spellings accepted; fewer than 2 stations → a clear error instead of a crash.
        const st = (sv || []).map(p => ({ md: +p.md, inc: +(p.incl != null ? p.incl : p.inc), az: +(p.azim != null ? p.azim : p.az) })).filter(p => isFinite(p.md) && isFinite(p.inc) && isFinite(p.az)).sort((x, y) => x.md - y.md);
        if(st.length < 2) return { error: 'The planned trajectory has fewer than 2 stations with MD / Inc / Azi (' + a.toFixed(0) + '–' + b.toFixed(0) + ' m).' };
        const at = md => { let k = 1; while(k < st.length && st[k].md < md) k++; const u = st[Math.max(0, k - 1)], v = st[Math.min(k, st.length - 1)], f = v.md > u.md ? Math.max(0, Math.min(1, (md - u.md) / (v.md - u.md))) : 0; return { inc: u.inc + (v.inc - u.inc) * f, az: u.az + wrap(v.az - u.az) * f }; };
        for(let x = a; x < b - 1e-6; ){ const y = Math.min(b, x + step), L = y - x, sc = typeof sec === 'function' ? sec(x) : sec, mid = (x + y) / 2;
            const p0 = at(x), p1 = at(y), dI = p1.inc - p0.inc, dA = wrap(p1.az - p0.az), sI = Math.sin((p0.inc + p1.inc) / 2 * D);
            const MY = simCol('myc', mid, col), BR = simCol('myb', mid, 1) || 0, WR = simCol('myw', mid, 1) || 0, Rs = simCol('rops', mid, col), Rr = simCol('ropr', mid, col);
            if(!(MY > 0) || !(Rs > 0) || !(Rr > 0)) return { error: 'No MY / slide / rotate ROP at ' + mid.toFixed(0) + ' m' };
            const g = Ls => { const Lr = L - Ls, di = dI - BR * Lr / 30, da = (dA - WR * Lr / 30) * sI; return Math.sqrt(di * di + da * da) - MY * Ls / 30; };
            let Ls; if(g(0) <= 0) Ls = 0; else if(g(L) > 0){ Ls = L; acc.flag.push(mid.toFixed(0)); } else { let lo = 0, hi = L; for(let it = 0; it < 40; it++){ const m = (lo + hi) / 2; if(g(m) > 0) lo = m; else hi = m; } Ls = hi; }
            const onb = Ls / Rs + (L - Ls) / Rr, oth = (F.oth(sc) || 0) * L, trp = (F.trip(sc) || 0) * L;
            acc.slid += Ls; acc.rot += L - Ls; acc.onb += onb; acc.oth += oth; acc.trip += trp; tRef.t += (onb + oth + trp) / 24; pts.push([tRef.t, y]); x = y; }
        return null;
    }
    function simulateTimeVsDepth(wellKey){
        const groups = getTrajectoryWellGroups(), legs = groups.wells[wellKey]; if(!legs || !legs.length) return { error: 'No trajectory found for well ' + wellKey + '.' };
        const col = window.MTX_ROP.COL[window.MTX_ROP.curve] || 1, step = Math.max(1, parseFloat((el('pasonSimStep') || {}).value) || 30), F = simFlats();
        const L = legs.map(tdBuildLegInfo), l1 = L[0], pts = [[0, 0]], tRef = { t: 0 }, acc = { slid: 0, rot: 0, onb: 0, oth: 0, trip: 0, cas: 0, leg: 0, flag: [] };
        const secOf = md => (l1.scMD != null && md < l1.scMD) ? 'Surface' : (l1.icpMD != null && md < l1.icpMD ? 'Build' : 'Lateral');
        const cuts = [0].concat([l1.scMD, l1.icpMD].filter(v => v != null)).concat([l1.tdMD]);
        for(let i = 0; i + 1 < cuts.length; i++){ const e = simLeg(legs[0].traj.survey, cuts[i], cuts[i + 1], secOf, step, col, F, acc, pts, tRef); if(e) return e;
            if(i + 2 < cuts.length){ const h = (cuts[i + 1] === l1.scMD ? F.sc : F.ic) || 0; acc.cas += h; tRef.t += h / 24; pts.push([tRef.t, cuts[i + 1]]); } }
        for(let k = 1; k < L.length; k++){ const lg = L[k]; if(lg.stkMD == null) return { error: 'No STK tie-on point found for ' + lg.wellName + '.' };
            const h = F.leg || 0; acc.leg += h; tRef.t += h / 24; pts.push([tRef.t, lg.stkMD]);
            const e = simLeg(legs[k].traj.survey, lg.stkMD, lg.tdMD, 'Lateral', step, col, F, acc, pts, tRef); if(e) return e; }
        const d = h => (h / 24).toFixed(2), f1 = v => v == null ? '—' : v.toFixed(1);
        const info = 'Simulated (' + step + ' m steps, ' + window.MTX_ROP.curve + ' curve): total <b>' + tRef.t.toFixed(2) + ' days</b> = on-bottom ' + d(acc.onb) + ' d (slid ' + acc.slid.toFixed(0) + ' m, rotated ' + acc.rot.toFixed(0) + ' m, slide ' + (100 * acc.slid / Math.max(1, acc.slid + acc.rot)).toFixed(1) + ' %) + other in-hole ' + d(acc.oth) + ' d + trips ' + d(acc.trip) + ' d + casing points ' + d(acc.cas) + ' d + leg changes ' + d(acc.leg) + ' d'
            + ' · offsets ' + F.n + ' well(s): SC ' + f1(F.sc) + ' h, IC ' + f1(F.ic) + ' h, per new leg ' + f1(F.leg) + ' h (medians)'
            + (acc.flag.length ? ' · ⚠ plan DLS above the offsets\' MY at ' + acc.flag.length + ' step(s) (first at ' + acc.flag[0] + ' m)' : '') + (F.n ? '' : ' · ⚠ no "Flat times" tab — flats / other time = 0 (re-export from Pason Plots)');
        return { points: pts, info, sum: acc };
    }
    function calculateTimeVsDepth(wellKey){
        if(simReady()) return simulateTimeVsDepth(wellKey);   // 2026-11-21: simulation when the MY / slide-rotate tabs are uploaded
        window.MTX_TM._livePlots = _plots;   // freshly uploaded data before it is saved
        var groups = getTrajectoryWellGroups(), legs = groups.wells[wellKey];
        if(!legs || !legs.length) return { error: 'No trajectory found for well ' + wellKey + '.' };
        var TM = window.MTX_TM, L = legs.map(tdBuildLegInfo), pts = [[0, 0]], t = 0, notes = [];
        var leg1 = L[0], ms = [];
        if(leg1.scMD !== null) ms.push({ md: leg1.scMD, sec: 'Surface', stop: true });
        if(leg1.icpMD !== null) ms.push({ md: leg1.icpMD, sec: leg1.scMD !== null ? 'Build' : 'Surface', stop: true });
        ms.push({ md: leg1.tdMD, sec: leg1.icpMD !== null ? 'Lateral' : 'Build', stop: false });
        var prev = 0, sum = { onb: 0, oth: 0, stop: 0, leg: 0 };
        // 2026-11-21 (John): LATERAL RATE per metre, fixed from the main bore's lateral (IC→TD of leg 1) and applied to every leg.
        // Was: each leg used the ROP / other time of its own MD range (STK→TD); the offsets' ROP and time curves vary with depth
        // (and mix legs), so legs of similar length got very different slopes. Slope of a leg = metres / (on-bottom + other) time.
        var latA = leg1.icpMD !== null ? leg1.icpMD : (leg1.scMD !== null ? leg1.scMD : 0), latB = leg1.tdMD, latL = latB - latA;
        var latOnb = latL > 0 ? TM.onBottomH(latA, latB, 'Lateral') : null, latOth = latL > 0 ? TM.otherH(latA, latB, 'Lateral').h : 0;
        var latRate = latOnb != null && latL > 0 ? { onb: latOnb / latL, oth: latOth / latL } : null;
        for(var i = 0; i < ms.length; i++){ var m = ms[i];
            var onb = TM.onBottomH(prev, m.md, m.sec); if(onb == null) return { error: 'No ROP for ' + prev.toFixed(0) + '–' + m.md.toFixed(0) + ' m (upload the Pason data or switch on the slide / rotate model).' };
            var oth = TM.otherH(prev, m.md, m.sec), segL = m.md - prev;
            // 2026-11-21: drill to each inner flat, add it as a horizontal step at its depth, then continue (time pro rata by metres)
            var at = prev; TM.innerFlats(prev, m.md).forEach(function(f){ t += (onb + oth.h) * (f.depth - at) / segL / 24; pts.push([t, f.depth]); t += f.hours / 24; pts.push([t, f.depth]); sum.stop += f.hours; at = f.depth; notes.push('flat ' + f.hours.toFixed(1) + ' h @ ' + f.depth.toFixed(0) + ' m'); });
            t += (onb + oth.h) * (m.md - at) / segL / 24; sum.onb += onb; sum.oth += oth.h; pts.push([t, m.md]);
            if(m.stop){ var st = TM.stopH(m.md, (i === 0 && leg1.scMD !== null) ? 'SC' : 'IC'); t += st.h / 24; sum.stop += st.h; pts.push([t, m.md]); notes.push((i === 0 && leg1.scMD !== null ? 'SC' : 'IC') + ' stop ' + st.h.toFixed(1) + ' h (' + st.src + ')'); }
            prev = m.md;
        }
        var lg = TM.legH();
        for(var li = 1; li < L.length; li++){ var leg = L[li];
            if(leg.stkMD === null) return { error: 'No STK tie-on point found for ' + leg.wellName + ' — cannot determine where this sidetrack ties in.' };
            t += lg.h / 24; sum.leg += lg.h; pts.push([t, leg.stkMD]);
            if(!latRate) return { error: 'No lateral ROP (main bore ' + latA.toFixed(0) + '–' + latB.toFixed(0) + ' m) for ' + leg.wellName + '.' };
            var len2 = leg.tdMD - leg.stkMD, onb2 = latRate.onb * len2, oth2 = latRate.oth * len2;
            t += (onb2 + oth2) / 24; sum.onb += onb2; sum.oth += oth2; pts.push([t, leg.tdMD]);
        }
        if(L.length > 1) notes.push('per new leg ' + lg.h.toFixed(1) + ' h (' + lg.src + ')' + (lg.missing ? ' ⚠' : ''));
        if(latRate) notes.push('lateral rate (every leg) ' + (24 / (latRate.onb + latRate.oth)).toFixed(0) + ' m/day = on-bottom ' + (1 / latRate.onb).toFixed(1) + ' m/h + other ' + (latRate.oth * 100).toFixed(2) + ' h/100 m');
        var info = 'Total <b>' + t.toFixed(2) + ' days</b> = on-bottom ' + (sum.onb / 24).toFixed(2) + ' d + other in-hole ' + (sum.oth / 24).toFixed(2) + ' d (' + TM.otherH(0, 1e9).src + ') + stops ' + ((sum.stop + sum.leg) / 24).toFixed(2) + ' d · ' + notes.join(' · ');
        // 2026-11-22: say why the simulation / offset flat times are not used (job saved with an older Pason Plots export)
        var miss = ['myc', 'rops', 'ropr', 'flatTimes'].filter(function(k){ return !_plots || !_plots[k]; });
        if(miss.length) info = '⚠ This job\'s Drilling Mechanics data was saved from an older Pason Plots export (missing: ' + miss.map(function(k){ return { myc: 'MY Corrected', rops: 'ROP Slide', ropr: 'ROP Rotate', flatTimes: 'Flat times' }[k]; }).join(', ') + '), so the casing / leg flat times and the slide-rotate simulation are not used. Re-export from Pason Plots and upload here. · ' + info;
        return { points: pts, info: info, sum: sum };
    }

    // ── 2026-11-20 (John): KPIs per hole section ─────────────────────────────────────────────────────────
    // Sections from the selected well's trajectory milestones (same comment keywords as the score cards / Time vs Depth):
    // Surface 0→SC, Build SC→IC, Lateral IC→TD (missing milestones merge the sections). For each Pason plot the KPI is
    // the MEAN of the chosen curve (Min / Avg / Max column of the export) over the points whose MD lies in the section.
    // ROP also shows the time-consistent (harmonic) mean = section length / Σ(Δmd/ROP), used for drilling time.
    const DMK_COL = { avg: 1, max: 2, min: 3 }, DMK_COLOR = { min: '#ff4d4d', avg: '#00e5ff', max: '#39ff14' };
    const DMK_PLOTS = [['hl', 'HKLD', 'kDaN', 1], ['tq', 'Torque', 'kN·m', 1], ['wob', 'WOB', 'kDaN', 1], ['rop', 'ROP', 'm/h', 1], ['mse', 'MSE', 'ksi', 0], ['flow', 'Flow', 'm³/min', 2]];
    function dmkSections(wellKey){
        const groups = getTrajectoryWellGroups(), legs = groups.wells && groups.wells[wellKey]; if(!legs || !legs.length) return [];
        const L = tdBuildLegInfo(legs[0]), out = [], pts = [['Surface', 0]];
        if(L.scMD != null) pts.push(['Build', L.scMD]);
        if(L.icpMD != null) pts.push(['Lateral', L.icpMD]);
        for(let i = 0; i < pts.length; i++){ const to = i + 1 < pts.length ? pts[i + 1][1] : L.tdMD; if(to > pts[i][1]) out.push({ name: pts[i][0], from: pts[i][1], to }); }
        return out;
    }
    function dmkPts(plotId, col, from, to){
        const d = _plots && _plots[plotId]; if(!d || !d.rows) return [];
        return d.rows.map(r => [Number(r[0]), r[col]]).filter(p => isFinite(p[0]) && p[1] !== '' && p[1] != null && isFinite(Number(p[1])) && p[0] >= from && p[0] <= to).map(p => [p[0], Number(p[1])]).sort((a, b) => a[0] - b[0]);
    }
    function dmkStat(plotId, col, from, to, curve){
        const pts = dmkPts(plotId, col, from, to); if(!pts.length) return null;
        const mean = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const lw = plotId === 'rop' ? window.MTX_ROP.lw(_plots.rop.rows, from, to, curve) : null;
        return { mean, lw, n: pts.length, pts };
    }
    // MSE flag (2026-11-20, MTX choice): points above factor x the section median; flagged length = sum of the MD steps
    // starting at a flagged point; consecutive flagged points are merged into intervals.
    function dmkMseFlag(pts, factor){
        if(!pts || pts.length < 3) return null;
        const v = pts.map(p => p[1]).sort((a, b) => a - b), med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
        if(!(med > 0)) return null;
        const lim = factor * med, iv = []; let len = 0, tot = 0, cur = null;
        for(let i = 0; i < pts.length; i++){ const step = i + 1 < pts.length ? pts[i + 1][0] - pts[i][0] : 0; tot += step;
            if(pts[i][1] > lim){ len += step; if(!cur){ cur = [pts[i][0], pts[i][0], pts[i][1]]; iv.push(cur); } cur[1] = i + 1 < pts.length ? pts[i + 1][0] : pts[i][0]; cur[2] = Math.max(cur[2], pts[i][1]); } else cur = null; }
        return { med, lim, len, pct: tot > 0 ? 100 * len / tot : 0, iv: iv.sort((a, b) => b[2] - a[2]) };
    }
    let DMK_OFF = null;   // offsets from /notes/pasonOffsets
    function dmkRopTxt(v){ if(v == null) return '—'; return (window.DMK_ROPU === 'mday') ? (v * 24).toFixed(0) : v.toFixed(1); }
    function dmkRopU(){ return window.DMK_ROPU === 'mday' ? 'm/day' : 'm/h'; }
    function dmkOffsetFor(secName, curve){
        if(!DMK_OFF || !DMK_OFF.length) return null;
        const vals = [];
        DMK_OFF.forEach(o => { let a = null, b = null;
            if(secName === 'Surface'){ a = 0; b = o.sc != null ? o.sc : (o.ic != null ? o.ic : o.td); }
            else if(secName === 'Build'){ a = o.sc; b = o.ic; } else if(secName === 'Lateral'){ a = o.ic; b = o.td; }
            if(a == null || b == null || !(b > a)) return;
            const r = window.MTX_ROP.lw(o.rows, a, b, curve); if(r) vals.push({ r, o }); });
        if(!vals.length) return null;
        return { mean: vals.reduce((x, y) => x + y.r, 0) / vals.length, n: vals.length, list: vals };
    }
    function renderDmk(){
        const grid = el('dmkGrid'), ws = el('dmkWell'), cs = el('dmkCurve'); if(!grid || !ws || !cs || !_plots) return;
        const curve = cs.value || 'min', col = DMK_COL[curve], secs = ws.value ? dmkSections(ws.value) : [], fac = parseFloat(el('dmkMseFactor').value) || 2;
        cs.style.color = DMK_COLOR[curve];
        if(!secs.length){ grid.innerHTML = '<div style="font-size:12px;color:var(--an-text-dim,#5a7080);">No sections for this well (needs a trajectory with SurfaceCasing / IntermediateCasing comments).</div>'; return; }
        el('dmkInfo').textContent = 'mean of the ' + { min: 'Min', avg: 'Average', max: 'Max' }[curve] + ' curve per section (ROP: length-weighted, the value used for drilling time; click it for m/h ↔ m/day)';
        grid.innerHTML = secs.map(s => {
            let ropLw = null, mseFlag = null;
            const cards = DMK_PLOTS.map(p => { const st = dmkStat(p[0], col, s.from, s.to, curve);
                if(p[0] === 'rop' && st) ropLw = st.lw; if(p[0] === 'mse' && st) mseFlag = dmkMseFlag(st.pts, fac);
                if(p[0] === 'rop') return '<div class="dmk-c rop" data-act="ropu" title="Click: m/h ↔ m/day' + (st ? ' · ' + st.n + ' points · plain mean ' + st.mean.toFixed(1) + ' m/h' : '') + '"><div class="l">ROP</div><div class="v" style="color:' + DMK_COLOR[curve] + '">' + dmkRopTxt(st ? st.lw : null) + '</div><div class="u">' + dmkRopU() + ' · length-weighted</div></div>';
                return '<div class="dmk-c" title="' + (st ? st.n + ' points' : 'no data in this section') + '"><div class="l">' + p[1] + '</div><div class="v" style="color:' + DMK_COLOR[curve] + '">' + (st ? st.mean.toFixed(p[3]) : '—') + '</div><div class="u">' + p[2] + '</div></div>'; }).join('');
            const off = dmkOffsetFor(s.name, curve);
            const offTxt = !DMK_OFF ? '' : !off ? '<div class="dmk-off">ROP vs offsets: no offset data for this section.</div>' :
                '<div class="dmk-off" title="' + off.list.map(x => (x.o.mtxJobId || '') + ' ' + x.o.wellName + ': ' + dmkRopTxt(x.r) + ' ' + dmkRopU()).join('\n') + '">ROP vs offsets (' + off.n + ' job' + (off.n > 1 ? 's' : '') + ', same curve): <b>' + dmkRopTxt(off.mean) + ' ' + dmkRopU() + '</b>' +
                (ropLw ? ' · this well <b style="color:' + (ropLw >= off.mean ? '#39ff14' : '#ff6b6b') + '">' + (ropLw >= off.mean ? '+' : '') + (100 * (ropLw / off.mean - 1)).toFixed(0) + ' %</b>' : '') + '</div>';
            const fl = !mseFlag ? '' : mseFlag.len > 0 ? '<div class="dmk-flag bad" title="Section median MSE ' + mseFlag.med.toFixed(1) + ' ksi; limit ' + fac + '× = ' + mseFlag.lim.toFixed(1) + ' ksi (MTX choice)">⚠ MSE above ' + fac + '× section median (' + mseFlag.lim.toFixed(1) + ' ksi) over ' + mseFlag.len.toFixed(0) + ' m (' + mseFlag.pct.toFixed(0) + ' %): ' +
                mseFlag.iv.slice(0, 3).map(x => x[0].toFixed(0) + '–' + x[1].toFixed(0) + ' m (max ' + x[2].toFixed(0) + ')').join(', ') + (mseFlag.iv.length > 3 ? ' …' : '') + ' — possible drilling inefficiency</div>'
                : '<div class="dmk-flag ok">✔ MSE never above ' + fac + '× the section median (' + mseFlag.med.toFixed(1) + ' ksi)</div>';
            return '<div class="dmk-sec"><h6>' + s.name + ' <span>' + s.from.toFixed(0) + '–' + s.to.toFixed(0) + ' m · ' + (s.to - s.from).toFixed(0) + ' m</span></h6><div class="dmk-cards">' + cards + '</div>' + offTxt + fl + '</div>';
        }).join('');
    }
    async function dmkLoadOffsets(){
        const btn = el('dmkOffsetBtn'); btn.disabled = true; btn.textContent = 'Loading…';
        try{ const d = await (await fetch('/notes/pasonOffsets/' + PASON_NOTE_ID + '?ids=' + encodeURIComponent(el('dmkOffsetIds').value || ''))).json(); if(!d.ok) throw new Error(d.error);
            DMK_OFF = d.offsets; el('dmkInfo').textContent = d.offsets.length ? 'Offsets: ' + d.offsets.map(o => o.mtxJobId || o.title).join(', ') + (d.mode === 'area' ? ' (same Area ' + d.area + ')' : '') : (d.note || 'No offset job with Pason ROP found.');
            renderDmk(); if(d.offsets.length) el('dmkInfo').textContent = 'Offsets: ' + d.offsets.map(o => o.mtxJobId || o.title).join(', ') + (d.mode === 'area' ? ' (same Area ' + d.area + ')' : ''); }
        catch(err){ el('dmkInfo').textContent = 'Offsets: ' + err.message; }
        btn.disabled = false; btn.textContent = 'Compare';
    }
    // Excel: one sheet per Drilling Mechanics plot (x, Average, Max, Min), + KPIs per section, + calculated Time vs Depth
    function dmkExcel(){
        if(!_plots || !window.XLSX){ alert('No Drilling Mechanics data.'); return; }
        const wb = XLSX.utils.book_new(), used = {};
        PLOT_REGISTRY.forEach(p => { const d = _plots[p.id]; if(!d || !(d.rows || []).length) return;
            const head = [p.id === 'td' ? 'Time (days)' : (d.xHeader || 'Measured Depth (m)'), 'Average', 'Max', 'Min'], rows = d.rows.map(r => [r[0], r[1], r[2], r[3]]);
            let nm = p.name.replace(/[\\\/\?\*\[\]:]/g, '').slice(0, 31); while(used[nm]) nm = nm.slice(0, 29) + '_' + Object.keys(used).length; used[nm] = 1;
            const sh = XLSX.utils.aoa_to_sheet([[p.name + ' — ' + p.yTitle]].concat([head], rows)); XLSX.utils.book_append_sheet(wb, sh, nm);
            if(p.id === 'td' && d.calculatedByWell) Object.keys(d.calculatedByWell).forEach(k => { const c = d.calculatedByWell[k]; if(!c || !c.points) return;
                let n2 = ('Calc TvD ' + k).replace(/[\\\/\?\*\[\]:]/g, '').slice(0, 31); if(used[n2]) return; used[n2] = 1;
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Calculated Time vs Depth — ' + k], ['Time (days)', 'Hole Depth (m)']].concat(c.points)), n2); }); });
        const ws = el('dmkWell'), curve = el('dmkCurve').value, secs = ws && ws.value ? dmkSections(ws.value) : [];
        if(secs.length){ const aoa = [['KPIs per section — well ' + ws.value + ' — curve ' + curve + ' (mean; ROP length-weighted)'], ['Section', 'From (m)', 'To (m)'].concat(DMK_PLOTS.map(p => p[1] + ' (' + p[2] + ')'))];
            secs.forEach(s => aoa.push([s.name, s.from, s.to].concat(DMK_PLOTS.map(p => { const st = dmkStat(p[0], DMK_COL[curve], s.from, s.to, curve); return st ? +(p[0] === 'rop' ? st.lw : st.mean).toFixed(3) : ''; }))));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'KPIs per section'); }
        XLSX.writeFile(wb, 'Drilling_Mechanics_' + (PASON_NOTE_ID || 'job') + '.xlsx');
    }
    function initDmk(){
        const ws = el('dmkWell'), tw = el('pasonTDWellSelect'), cs = el('dmkCurve'); if(!ws || !cs) return;
        if(tw){ ws.innerHTML = tw.innerHTML; ws.value = tw.value; }
        cs.value = window.MTX_ROP.curve || 'avg'; if(!cs.value) cs.value = 'avg';
        window.DMK_ROPU = window.MTXPrefs ? MTXPrefs.get('dmRopUnit', 'mh') : 'mh';
        const mf = el('dmkMseFactor'); if(mf && window.MTXPrefs) mf.value = MTXPrefs.get('dmMseFactor', '2') || '2';
        if(mf) mf.addEventListener('change', function(){ if(window.MTXPrefs) MTXPrefs.set('dmMseFactor', mf.value); renderDmk(); });
        cs.addEventListener('change', function(){
            window.MTX_ROP.curve = cs.value; if(window.MTXPrefs) MTXPrefs.set('dmKpiCurve', cs.value); renderDmk();
            if(typeof window.wbtRerenderCards === 'function') window.wbtRerenderCards();   // score-card times follow the curve
            const sel = el('pasonPlotSelect'); if(sel && sel.value === 'td') renderPasonChart('td');   // preview Time vs Depth follows the curve
        });
        ws.addEventListener('change', function(){ if(tw && tw.value !== ws.value){ tw.value = ws.value; tw.dispatchEvent(new Event('change')); } renderDmk(); });
        if(tw) tw.addEventListener('change', function(){ if(ws.value !== tw.value){ ws.value = tw.value; renderDmk(); } });
        el('dmkGrid').addEventListener('click', function(e){ if(e.target.closest('[data-act="ropu"]')){ window.DMK_ROPU = window.DMK_ROPU === 'mday' ? 'mh' : 'mday'; if(window.MTXPrefs) MTXPrefs.set('dmRopUnit', window.DMK_ROPU); renderDmk(); } });
        el('dmkOffsetBtn').addEventListener('click', dmkLoadOffsets);
        el('dmkXlsBtn').addEventListener('click', dmkExcel);
        renderDmk();
    }

    // ── 2026-11-20 (John): slide / rotate time model (see window.MTX_SRM at the top of the page) ──
    const SRM_SECS = ['Surface', 'Build', 'Lateral'];
    let SRM = window.MTX_SRM.model ? JSON.parse(JSON.stringify(window.MTX_SRM.model)) : { sources: [], active: false };
    function srmSectionsOf(sc, ic, td){   // own milestones of a source; else the selected well's sections
        if(td != null && (sc != null || ic != null)){ const out = [], pts = [['Surface', 0]]; if(sc != null) pts.push(['Build', sc]); if(ic != null) pts.push(['Lateral', ic]);
            for(let i = 0; i < pts.length; i++){ const to = i + 1 < pts.length ? pts[i + 1][1] : td; if(to > pts[i][1]) out.push({ name: pts[i][0], from: pts[i][1], to }); } return { secs: out, own: true }; }
        const tw = el('pasonTDWellSelect'); return { secs: tw && tw.value ? dmkSections(tw.value) : [], own: false };
    }
    function srmPerSection(intervals, secs){
        const ps = {}; secs.forEach(s => { ps[s.name] = { Ls: 0, Ts: 0, Lr: 0, Tr: 0, from: s.from, to: s.to }; });
        (intervals || []).forEach(iv => { const rop = +iv.rop; if(!(rop > 0) || !(iv.to > iv.from)) return;
            secs.forEach(s => { const o = Math.min(iv.to, s.to) - Math.max(iv.from, s.from); if(o <= 0) return; const q = ps[s.name], t = o / rop;
                if(iv.mode === 'slide'){ q.Ls += o; q.Ts += t; } else { q.Lr += o; q.Tr += t; } }); });
        return ps;
    }
    function srmFmt(v, d){ return v == null || !isFinite(v) ? '—' : (+v).toFixed(d); }
    function srmRender(){
        window.MTX_SRM.model = SRM;   // live (unsaved changes included)
        const act = el('srmActive'); if(act) act.value = SRM.active ? '1' : '0';
        el('srmBadge').textContent = SRM.sources.length ? '· ' + SRM.sources.length + ' source(s)' + (SRM.active ? ' · ACTIVE for Time vs Depth and score cards' : ' · not active') + (SRM.savedAt ? ' · saved ' + new Date(SRM.savedAt).toLocaleDateString() : ' · unsaved') : '· no sources yet';
        el('srmSources').innerHTML = SRM.sources.length ? '<div class="table-responsive"><table class="table table-sm table-dark" style="font-size:12px"><thead><tr><th>Use</th><th>Source</th>' +
            SRM_SECS.map(n => '<th>' + n + '<br><span style="font-weight:400">slid / rot m · ROP s / r (m/h)</span></th>').join('') + '<th></th></tr></thead><tbody>' +
            SRM.sources.map((src, i) => '<tr><td><input type="checkbox" data-srm-on="' + i + '"' + (src.on === false ? '' : ' checked') + '></td><td>' + src.type + ' · <b>' + (src.name || '').replace(/</g, '&lt;') + '</b>' + (src.ownSections ? '' : ' <span title="sections of the selected well">*</span>') + '</td>' +
                SRM_SECS.map(n => { const q = src.perSection && src.perSection[n]; return '<td>' + (q && q.Ls + q.Lr > 0 ? srmFmt(q.Ls, 0) + ' / ' + srmFmt(q.Lr, 0) + ' · ' + srmFmt(q.Ts > 0 ? q.Ls / q.Ts : null, 1) + ' / ' + srmFmt(q.Tr > 0 ? q.Lr / q.Tr : null, 1) : '—') + '</td>'; }).join('') +
                '<td><button type="button" class="btn btn-sm btn-outline-danger" data-srm-del="' + i + '">✕</button></td></tr>').join('') + '</tbody></table></div><div style="font-size:10.5px;color:var(--an-text-dim,#5a7080)">* LAS file: sections taken from the well selected in Drilling Mechanics.</div>' : '<div style="color:var(--an-text-dim,#5a7080)">No sources yet — load saved Slide Sheets of offset jobs and / or upload LAS files.</div>';
        const a = window.MTX_SRM.agg(), cu = { min: 'Min (slowest source)', avg: 'Avg (pooled)', max: 'Max (fastest source)' }[window.MTX_ROP.curve];
        el('srmModelTbl').innerHTML = Object.keys(a).length ? '<div style="margin-top:6px"><b>Model per section</b> <span style="color:var(--an-text-dim,#5a7080)">— ' + cu + ' (curve selector)</span></div><div class="table-responsive"><table class="table table-sm table-dark" style="font-size:12.5px"><thead><tr><th>Section</th><th>Slide %</th><th>ROP slide (m/h)</th><th>ROP rotate (m/h)</th><th>Effective ROP (m/h)</th><th>Sources</th></tr></thead><tbody>' +
            SRM_SECS.filter(n => a[n]).map(n => '<tr><td>' + n + '</td><td>' + srmFmt(100 * a[n].f, 1) + ' %</td><td>' + srmFmt(a[n].ropS, 1) + '</td><td>' + srmFmt(a[n].ropR, 1) + '</td><td><b>' + srmFmt(a[n].eff, 1) + '</b></td><td>' + a[n].n + '</td></tr>').join('') + '</tbody></table></div>' : '';
    }
    function srmChanged(){ srmRender(); if(typeof window.wbtRerenderCards === 'function') window.wbtRerenderCards(); const sel = el('pasonPlotSelect'); if(sel && sel.value === 'td') renderPasonChart('td'); }
    async function srmLoadSaved(){
        el('srmStatus').textContent = 'Loading saved Slide Sheets…';
        try{ const d = await (await fetch('/notes/slideOffsets/' + PASON_NOTE_ID + '?ids=' + encodeURIComponent(el('srmIds').value || ''))).json(); if(!d.ok) throw new Error(d.error);
            let n = 0; d.sources.forEach(src => { const key = 'SS:' + src.mtxJobId + ':' + src.name; if(SRM.sources.some(x => x.key === key)) return;
                const sp = srmSectionsOf(src.sc, src.ic, src.td); if(!sp.secs.length) return;
                SRM.sources.push({ key, type: 'Slide Sheet', name: src.name, ownSections: sp.own, perSection: srmPerSection(src.intervals, sp.secs), on: true }); n++; });
            el('srmStatus').textContent = n ? n + ' Slide Sheet(s) added.' : (d.note || 'No new saved Slide Sheet found.'); srmChanged(); }
        catch(err){ el('srmStatus').textContent = err.message; }
    }
    async function srmLoadLas(evt){
        const files = Array.from(evt.target.files || []); evt.target.value = '';
        const sp = srmSectionsOf(null, null, null); if(!sp.secs.length){ el('srmStatus').textContent = 'Select a well with SurfaceCasing / IntermediateCasing comments first (Drilling Mechanics well).'; return; }
        for(const f of files){
            try{ const p = new SlideSheetModel.LasParser(), dec = new TextDecoder(), CH = 8 << 20;
                for(let off = 0; off < f.size; off += CH){ const buf = await f.slice(off, Math.min(off + CH, f.size)).arrayBuffer(); p.push(dec.decode(buf, { stream: off + CH < f.size }));
                    el('srmStatus').textContent = 'Reading ' + f.name + ' ' + Math.min(100, Math.round(100 * (off + CH) / f.size)) + ' %…'; await new Promise(r => setTimeout(r, 0)); }
                const las = p.finish(); el('srmStatus').textContent = 'Detecting slides in ' + f.name + '…'; await new Promise(r => setTimeout(r, 0));
                const res = SlideSheetModel.detect(las, {});
                SRM.sources.push({ key: 'LAS:' + f.name + ':' + f.size, type: 'LAS', name: (las.well && las.well.WELL ? las.well.WELL + ' — ' : '') + f.name, ownSections: false,
                    perSection: srmPerSection((res.intervals || []).filter(i => !i.leg || i.leg === 'Main'), sp.secs), on: true });
                el('srmStatus').textContent = f.name + ': ' + (res.slides || []).length + ' slides detected.'; srmChanged();
            }catch(err){ el('srmStatus').textContent = f.name + ': ' + err.message; }
        }
    }
    async function srmSave(){
        try{ const r = await fetch('/notes/pasonSlideModel/' + PASON_NOTE_ID, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: SRM }) }), d = await r.json();
            if(!d.ok) throw new Error(d.error); SRM.savedAt = new Date().toISOString(); el('srmStatus').textContent = '✅ Model saved to this job.'; srmRender(); }
        catch(err){ el('srmStatus').textContent = 'Save failed: ' + err.message; }
    }
    function initSrm(){
        if(!el('srmPanel')) return;
        el('srmActive').addEventListener('change', function(){ SRM.active = this.value === '1'; SRM.savedAt = null; srmChanged(); });
        el('srmLoadBtn').addEventListener('click', srmLoadSaved);
        el('srmLas').addEventListener('change', srmLoadLas);
        if(el('srmSaveBtn')) el('srmSaveBtn').addEventListener('click', srmSave);
        el('srmSources').addEventListener('change', function(e){ const i = e.target.getAttribute('data-srm-on'); if(i != null){ SRM.sources[+i].on = e.target.checked; SRM.savedAt = null; srmChanged(); } });
        el('srmSources').addEventListener('click', function(e){ const i = e.target.getAttribute('data-srm-del'); if(i != null){ SRM.sources.splice(+i, 1); SRM.savedAt = null; srmChanged(); } });
        const cs = el('dmkCurve'); if(cs) cs.addEventListener('change', srmRender);
        srmRender();
    }

    { const ss = el('pasonSimStep'); if(ss) ss.addEventListener('change', () => { const sel = el('pasonPlotSelect'); if(sel && sel.value === 'td') renderPasonChart('td'); if(typeof window.wbtRerenderCards === 'function') window.wbtRerenderCards(); }); }   // 2026-11-21
    // Populate the well dropdown once, and wire the Calculate button.
    populateTDWellDropdown();
    initSrm();   // 2026-11-20 slide / rotate time model
    initDmk();   // 2026-11-20 KPIs per section
    const tdWellSelectEl = el('pasonTDWellSelect');
    if(tdWellSelectEl){
        tdWellSelectEl.addEventListener('change', function(){
            const sel = el('pasonPlotSelect');
            if(sel && sel.value === 'td') renderPasonChart('td');
        });
    }
    const tdCalcBtn = el('pasonTDCalcBtn');
    if(tdCalcBtn){
        tdCalcBtn.addEventListener('click', async function(){
            const wellSel = el('pasonTDWellSelect');
            const wellKey = wellSel && wellSel.value;
            const calcStatus = el('pasonTDCalcStatus');
            if(!wellKey){ if(calcStatus) calcStatus.textContent = '⚠ No well selected.'; return; }

            if(calcStatus) calcStatus.textContent = 'Calculating…';
            tdCalcBtn.disabled = true;

            const result = calculateTimeVsDepth(wellKey);
            if(result.error){
                if(calcStatus) calcStatus.textContent = '❌ ' + result.error;
                tdCalcBtn.disabled = false;
                return;
            }

            if(!_plots['td']) _plots['td'] = { xHeader:'Time_days', rows: [] };
            if(!_plots['td'].calculatedByWell) _plots['td'].calculatedByWell = {};
            _plots['td'].calculatedByWell[wellKey] = { points: result.points, savedAt: new Date().toISOString(), info: result.info, ropCurve: { min: 'Min', avg: 'Avg', max: 'Max' }[window.MTX_ROP.curve] + (window.MTX_SRM.active() ? ' slide/rotate model' : ' (length-weighted)') };   // 2026-11-20

            const ok = await persistPlots('✅ Budget Time vs Depth for ' + wellKey + ' saved.');
            tdCalcBtn.disabled = false;
            if(ok){
                if(calcStatus) calcStatus.textContent = '✅ Saved (' + result.points.length + ' points).';
                renderPasonChart('td');
            }
        });
    }


    // ── Dropdown + zoom reset ─────────────────────────────────────────────
    const selectEl = el('pasonPlotSelect');
    if(selectEl) selectEl.addEventListener('change', () => renderPasonChart(selectEl.value));

    const resetZoomBtn = el('pasonZoomResetBtn');
    if(resetZoomBtn) resetZoomBtn.addEventListener('click', () => { if(_chart && _chart.resetZoom) _chart.resetZoom(); });

    window.addEventListener('mtxThemeChange', function(){
        const sel = el('pasonPlotSelect');
        if(sel && sel.value) renderPasonChart(sel.value);
    });

    loadFromEmbedded();
})();

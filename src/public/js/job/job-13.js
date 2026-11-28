/* MTX Conveyor — job page script 13. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 14915) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const CSD_NOTE_ID = window.MTX_JOB.noteId;
    if(!document.getElementById('csdWellSelect2')) return;
    const dataEl = document.getElementById('casingDesignData');
    if(!dataEl){ console.log('[Csd] #casingDesignData element not found on this page.'); return; }
    let csdDoc;
    try { csdDoc = JSON.parse(dataEl.textContent); } catch(e){ console.error('[Csd] Failed to parse casingDesignData JSON:', e); csdDoc = null; }
    if(csdDoc && !csdDoc.resultsByWell) csdDoc.resultsByWell = {};

    function csdIsSubjectWell(well){
        var wn = (well.wellName || '').trim();
        if(well.wellCategory === 'subject') return true;
        if(well.wellCategory === 'offset') return false;
        return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
    }
    function getSubjectWellKeys(){
        var dataEl2 = document.getElementById('wbtData');
        if(!dataEl2) return [];
        var wbtArr;
        try { wbtArr = JSON.parse(dataEl2.textContent); } catch(e){ return []; }
        return wbtArr.filter(function(w){ return w.survey && w.survey.length && csdIsSubjectWell(w); })
                      .map(function(w){ return w.wellName; })
                      .sort();
    }

    const wellSelect = document.getElementById('csdWellSelect2');
    const scenarioSelect = document.getElementById('csdScenarioSelect2');
    const statusText = document.getElementById('csdStatusText');
    const emptyMsg = document.getElementById('csdEmptyMsg');
    const resultsWrap = document.getElementById('csdResultsWrap');

    function fmt(v, d){ return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d != null ? d : 1); }
    function fmtPa_kPa(pa){ return fmt(pa/1000, 0); }
    function fmtN_kN(n){ return fmt(n/1000, 0); }

    var csdCharts = {};
    function renderTriaxialChart(name, triaxial, buckling){
        var canvasId = 'csdTriChart_' + name.replace(/[^a-z0-9]/gi, '_');
        var canvas = document.getElementById(canvasId);
        if(!canvas) return;
        // Themed per 2026-08-26 light-mode fix (same isLight pattern as
        // renderPasonChart/buildTDCharts/renderPlot) — this chart's axis
        // title/tick/grid colors were hardcoded to the dark-theme values.
        var isLight = document.body.classList.contains('light-mode');
        var csdAxisTitleColor = isLight ? '#495057' : '#5a7080';
        var csdTickColor = isLight ? '#000000' : '#c8d8e8';
        var csdGridColor = isLight ? 'rgba(0,0,0,.15)' : '#1e2d3d';
        var envelope = triaxial.envelope;
        var high = envelope.map(function(p){ return { x: p.dp_Pa/1e6, y: p.FaHigh_N/1000 }; });
        var low = envelope.map(function(p){ return { x: p.dp_Pa/1e6, y: p.FaLow_N/1000 }; });
        var designEnv = triaxial.designEnvelope || [];
        var designHigh = designEnv.map(function(p){ return { x: p.dp_Pa/1e6, y: p.FaHigh_N/1000 }; });
        var designLow = designEnv.map(function(p){ return { x: p.dp_Pa/1e6, y: p.FaLow_N/1000 }; });
        var bucklingLine = (triaxial.bucklingLine || []).map(function(p){ return { x: p.dp_Pa/1e6, y: p.Fa_N/1000 }; });
        var loadPts = triaxial.points.map(function(p){ return { x: p.dp_Pa/1e6, y: p.Fa_N/1000, label: p.label }; });
        var simplePts = loadPts.filter(function(p){ return p.label.indexOf('simple') !== -1; });
        var altPts = loadPts.filter(function(p){ return p.label.indexOf('alternative') !== -1; });
        var engPts = loadPts.filter(function(p){ return p.label.indexOf('engineered') !== -1; });

        // "As landed" reference — vertical line at that condition's dp
        // (see casingLoadCases.js), spanning the chart's y-range, plus a
        // marker at the actual as-landed Fa.
        var asLandedLine = [], asLandedPt = [];
        if(buckling && buckling.asLanded){
            var al = buckling.asLanded;
            var allY = high.map(function(p){ return p.y; }).concat(low.map(function(p){ return p.y; }));
            var yMin = allY.length ? Math.min.apply(null, allY) : -1000;
            var yMax = allY.length ? Math.max.apply(null, allY) : 1000;
            var x0 = al.dp_Pa / 1e6;
            asLandedLine = [{ x: x0, y: yMin }, { x: x0, y: yMax }];
            asLandedPt = [{ x: x0, y: al.Fa_N / 1000, label: 'As Landed' }];
        }

        if(csdCharts[name]) csdCharts[name].destroy();
        csdCharts[name] = new Chart(canvas.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: [
                    { label: 'VME — MYS', data: high, showLine: true, borderColor: '#00c8ff', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 },
                    { label: 'VME — MYS', data: low, showLine: true, borderColor: '#00c8ff', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 },
                    { label: 'VME — Design Factor', data: designHigh, showLine: true, borderColor: '#ff4060', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 },
                    { label: 'VME — Design Factor', data: designLow, showLine: true, borderColor: '#ff4060', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 },
                    { label: 'Buckling threshold (Goins)', data: bucklingLine, showLine: true, borderColor: '#7d9e34', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5, borderDash: [5,3] },
                    { label: 'As Landed (ref.)', data: asLandedLine, showLine: true, borderColor: '#c8d8e8', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1, borderDash: [2,2] },
                    { label: 'As Landed', data: asLandedPt, showLine: false, backgroundColor: '#ffffff', borderColor: '#111820', borderWidth: 1.5, pointStyle: 'crossRot', pointRadius: 7, pointHoverRadius: 9 },
                    { label: 'Simple', data: simplePts, showLine: false, backgroundColor: '#ff6b35', pointRadius: 5 },
                    { label: 'Alternative', data: altPts, showLine: false, backgroundColor: '#ffd060', pointStyle: 'triangle', pointRadius: 6 },
                    { label: 'Engineered', data: engPts, showLine: false, backgroundColor: '#39ff14', pointStyle: 'rect', pointRadius: 5 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function(ctx){
                        var d = ctx.raw;
                        return (d.label || ctx.dataset.label) + ': Δp=' + d.x.toFixed(2) + ' MPa, Fa=' + d.y.toFixed(0) + ' kN';
                    } } },
                    zoom: {
                        pan: { enabled: true, mode: 'xy' },
                        zoom: { wheel: { enabled: true, speed: 0.08 }, pinch: { enabled: true }, mode: 'xy' },
                        limits: { x: { min: 'original', max: 'original' }, y: { min: 'original', max: 'original' } }
                    }
                },
                scales: {
                    x: { title: { display: true, text: 'Δp = pi − po (MPa)', color: csdAxisTitleColor }, grid: { color: csdGridColor }, ticks: { color: csdTickColor } },
                    y: { title: { display: true, text: 'Fa (kN)', color: csdAxisTitleColor }, grid: { color: csdGridColor }, ticks: { color: csdTickColor } }
                }
            }
        });
    }

    function renderEntry(entry){
        if(!entry || !entry.results || !entry.results.byString){
            resultsWrap.style.display = 'none';
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No saved run for this well/scenario yet' + (window.MTX_JOB.canUseModelers ? ' — use "Open in Casing Design" to set one up.' : '.');
            statusText.textContent = '';
            return;
        }
        emptyMsg.style.display = 'none';
        resultsWrap.style.display = 'block';

        var cardsEl = document.getElementById('csdStringCards');
        cardsEl.innerHTML = '';
        var pendingCharts = [];
        Object.keys(entry.results.byString).forEach(function(name){
            var e = entry.results.byString[name];
            var gov = e.governing;
            var row = document.createElement('div');
            row.style.cssText = 'border:1px solid var(--an-border);border-radius:4px;padding:8px 10px;';
            var pieces = ['burst', 'collapse', 'tension'].map(function(key){
                var label = key.charAt(0).toUpperCase() + key.slice(1);
                var g = gov[key];
                var src = g.governedBy === 'engineered' ? e.engineered.check[key] : (g.governedBy === 'alternative' ? e.alternative.check[key] : e.simple.check[key]);
                var isForce = key === 'tension';
                var color = g.status === 'pass' ? '#39ff14' : '#ff4060';
                var loadStr = isForce ? fmtN_kN(src.load) + ' kN' : fmtPa_kPa(src.load) + ' kPa';
                var methodTag = g.governedBy === 'engineered' ? ' [eng]' : (g.governedBy === 'alternative' ? ' [alt]' : '');
                return '<span style="margin-right:14px;">' + label + ' <b style="color:' + color + ';">DF ' + fmt(src.achievedDF, 2) +
                    '</b><span style="color:var(--an-text-dim,#5a7080);">' + methodTag + ' (req ' + fmt(src.requiredDF, 2) + ', load ' + loadStr + ')</span></span>';
            }).join('');
            var parentLine = '';
            if(e.parentCheck && !e.parentCheck.error){
                var pc = e.parentCheck;
                var pcOk = pc.check.burst.pass && pc.check.collapse.pass && pc.check.tension.pass;
                parentLine = '<div style="font-size:10px;color:' + (pcOk?'#39ff14':'#ff4060') + ';margin-top:3px;">Parent (' + pc.parentStringName + ') check: ' + (pcOk?'pass':'FAIL') + '</div>';
            }
            var overpullLine = '';
            if(e.overpull){
                var op = e.overpull;
                overpullLine = '<div style="font-size:10px;color:' + (op.pass?'#39ff14':'#ffd060') + ';margin-top:3px;">Overpull: ' +
                    (op.pass?'OK':'SHORT') + ' — ' + fmt(op.availableOverpull_kdaN,1) + ' kdaN available (tension governed by ' + op.governedBy + ')</div>';
            }
            var bucklingLine2 = '';
            if(e.buckling){
                var bk = e.buckling, al = bk.asLanded, bkOk = !al.willBuckle;
                bucklingLine2 = '<div style="font-size:10px;color:' + (bkOk?'#39ff14':'#ffd060') + ';margin-top:3px;">Buckling (As Landed): ' +
                    (bkOk?'OK':'BUCKLES') + ' — Fbu ' + fmt(al.Fbu_N/1000,0) + ' kN';
                if(bk.parentStringName){
                    bucklingLine2 += ', Δr ' + fmt(bk.radialClearance_mm,1) + ' mm (inside ' + bk.parentStringName + ')';
                    if(bk.lengthChange_m != null) bucklingLine2 += ', length change ' + fmt(bk.lengthChange_m*1000,1) + ' mm';
                }
                bucklingLine2 += '</div>';
            }
            var canvasId = 'csdTriChart_' + name.replace(/[^a-z0-9]/gi, '_');
            var chartHtml = '';
            if(e.triaxial && e.triaxial.envelope && e.triaxial.envelope.length){
                chartHtml = '<div style="height:260px;background:var(--an-panel2,#161e28);border:1px solid var(--an-border);border-radius:4px;padding:6px;margin-top:8px;">' +
                    '<canvas id="' + canvasId + '"></canvas></div>';
            }
            row.innerHTML = '<div style="font-family:var(--cond, inherit);font-weight:700;color:var(--an-text-bright,#e8f4ff);margin-bottom:4px;">' + name + '</div>' +
                '<div style="font-size:11px;font-family:monospace;">' + pieces + '</div>' + parentLine + overpullLine + bucklingLine2 + chartHtml;
            cardsEl.appendChild(row);
            if(e.triaxial && e.triaxial.envelope && e.triaxial.envelope.length){
                pendingCharts.push({ name: name, triaxial: e.triaxial, buckling: e.buckling });
            }
        });
        pendingCharts.forEach(function(c){ renderTriaxialChart(c.name, c.triaxial, c.buckling); });

        statusText.textContent = entry.calculatedAt
            ? ('Calculated ' + new Date(entry.calculatedAt).toLocaleString() + (entry.calculatedByName ? ' by ' + entry.calculatedByName : ''))
            : '';
    }

    function onWellChange(){
        var wk = wellSelect.value;
        var scenarios = csdDoc && csdDoc.scenarios ? csdDoc.scenarios : {};
        var scenarioName = scenarioSelect.value || (csdDoc && csdDoc.activeScenario);
        var rbw = (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || (csdDoc && csdDoc.resultsByWell) || {};
        renderEntry(rbw[wk]);
    }

    async function onScenarioChange(){
        var scenarioName = scenarioSelect.value;
        if(!csdDoc || scenarioName === csdDoc.activeScenario){ onWellChange(); return; }
        try {
            var res = await fetch('/notes/casingDesign/' + CSD_NOTE_ID + '/scenario/setActive', {
                method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ scenario: scenarioName })
            });
            if(res.ok){
                var res2 = await fetch('/notes/casingDesign/' + CSD_NOTE_ID);
                csdDoc = await res2.json();
                if(csdDoc && !csdDoc.resultsByWell) csdDoc.resultsByWell = {};
            }
        } catch(e){ console.error('[Csd] scenario switch failed:', e); }
        onWellChange();
    }

    function initCsd(){
        if(!csdDoc){
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No Casing Design model saved yet for this job.';
            statusText.textContent = '';
            return;
        }
        var subjectWells = getSubjectWellKeys();
        var wellKeys = Object.keys(csdDoc.resultsByWell || {});
        var allKeys = subjectWells.slice();
        wellKeys.forEach(function(k){ if(allKeys.indexOf(k) === -1) allKeys.push(k); });
        if(!allKeys.length){
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No Casing Design model saved yet for this job.';
            statusText.textContent = '';
            return;
        }
        wellSelect.innerHTML = '';
        allKeys.forEach(function(wk){
            var opt = document.createElement('option');
            opt.value = wk; opt.textContent = wk;
            wellSelect.appendChild(opt);
        });
        wellSelect.style.display = '';
        wellSelect.addEventListener('change', onWellChange);

        var scenarioNames = csdDoc.scenarios ? Object.keys(csdDoc.scenarios) : ['Default'];
        if(!scenarioNames.length) scenarioNames = ['Default'];
        scenarioSelect.innerHTML = '';
        scenarioNames.forEach(function(n){
            var opt = document.createElement('option');
            opt.value = n; opt.textContent = n;
            scenarioSelect.appendChild(opt);
        });
        scenarioSelect.value = (csdDoc.activeScenario && scenarioNames.indexOf(csdDoc.activeScenario) !== -1) ? csdDoc.activeScenario : scenarioNames[0];
        scenarioSelect.style.display = '';
        scenarioSelect.addEventListener('change', onScenarioChange);

        var latest = null, defaultWell = allKeys[0];
        Object.keys(csdDoc.resultsByWell || {}).forEach(function(wk){
            var entry = csdDoc.resultsByWell[wk];
            if(!entry || !entry.calculatedAt) return;
            if(!latest || new Date(entry.calculatedAt) > new Date(latest)){
                latest = entry.calculatedAt;
                defaultWell = wk;
            }
        });
        wellSelect.value = defaultWell;
        onWellChange();
    }

    let csdInitDone = false;
    function initCsdOnce(){ if(csdInitDone) return; csdInitDone = true; initCsd(); }
    const collapseCsdEl = document.getElementById('collapseCsd');
    if(collapseCsdEl){
        collapseCsdEl.addEventListener('shown.bs.collapse', initCsdOnce);
        if(collapseCsdEl.classList.contains('show')) initCsdOnce();
    } else {
        initCsdOnce();
    }
})();

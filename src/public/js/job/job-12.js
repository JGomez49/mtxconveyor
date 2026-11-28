/* MTX Conveyor — job page script 12. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 14692) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const HYD_NOTE_ID = window.MTX_JOB.noteId;
    if(!document.getElementById('hydWellSelect2')) return;
    const dataEl = document.getElementById('hydraulicsModelData');
    if(!dataEl){ console.log('[Hyd] #hydraulicsModelData element not found on this page.'); return; }
    let hydDoc;
    try { hydDoc = JSON.parse(dataEl.textContent); } catch(e){ console.error('[Hyd] Failed to parse hydraulicsModelData JSON:', e); hydDoc = null; }
    if(hydDoc && !hydDoc.resultsByWell) hydDoc.resultsByWell = {};

    function hydIsSubjectWell(well){
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
        return wbtArr.filter(function(w){ return w.survey && w.survey.length && hydIsSubjectWell(w); })
                      .map(function(w){ return w.wellName; })
                      .sort();
    }

    const wellSelect = document.getElementById('hydWellSelect2');
    const scenarioSelect = document.getElementById('hydScenarioSelect2');
    const statusText = document.getElementById('hydStatusText');
    const emptyMsg = document.getElementById('hydEmptyMsg');
    const resultsWrap = document.getElementById('hydResultsWrap');

    function fmt(v, d){ return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d != null ? d : 1); }

    function renderEntry(entry){
        if(!entry || !entry.results){
            resultsWrap.style.display = 'none';
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No saved run for this well/scenario yet' + (window.MTX_JOB.canUseModelers ? ' — use "Open in Bit Hydraulics Program" to set one up.' : '.');
            statusText.textContent = '';
            return;
        }
        emptyMsg.style.display = 'none';
        resultsWrap.style.display = 'block';
        var r = entry.results;

        var warnEl = document.getElementById('hydWarnings');
        warnEl.innerHTML = '';
        (r.warnings || []).forEach(function(w){
            var d = document.createElement('div');
            var severe = /No pressure available|higher than maximum/.test(w);
            d.style.cssText = 'border:1px solid ' + (severe ? '#ff4060' : '#ffd060') + ';background:rgba(' + (severe ? '255,64,96' : '255,208,96') + ',.08);color:' + (severe ? '#ff4060' : '#ffd060') + ';border-radius:4px;padding:8px 10px;font-size:11px;margin-bottom:6px;';
            d.textContent = '⚠ ' + w;
            warnEl.appendChild(d);
        });

        var cardsEl = document.getElementById('hydResultCards');
        cardsEl.innerHTML = '';
        if(r.bitHydraulics){
            var bh = r.bitHydraulics;
            // Same conversion constants as uploadHydraulics.ejs.
            var IN2_PER_MM2 = 645.16;
            var FT_PER_M = 1 / 0.3048;
            var PSI_PER_KPA = 1 / 6.894757293168;
            var HP_PER_W = 1 / 745.699872;
            var LBF_PER_N = 1 / 4.4482216152605;
            var PPG_PER_KGM3 = 1 / 119.826427;
            var cards = [
                ['Min. TFA', fmt(bh.minTfa_mm2,1) + ' mm²', fmt(bh.minTfa_mm2/IN2_PER_MM2,3) + ' in²'],
                ['Total TFA', fmt(bh.totalTfa_mm2,1) + ' mm²', fmt(bh.totalTfa_mm2/IN2_PER_MM2,3) + ' in²'],
                ['Jet Velocity', fmt(bh.jetVelocity_ms,2) + ' m/s', fmt(bh.jetVelocity_ms*FT_PER_M,1) + ' ft/s'],
                ['Bit Pressure Drop', fmt(bh.bitPressureDrop_kPa,0) + ' kPa', fmt(bh.bitPressureDrop_kPa*PSI_PER_KPA,0) + ' psi'],
                ['Bit Hyd. Power', fmt(bh.bitHydraulicPower_W,0) + ' W', fmt(bh.bitHydraulicPower_W*HP_PER_W,2) + ' hp'],
                ['H.S.I.', fmt(bh.hsi_Wmm2,3) + ' W/mm²', fmt(bh.hsi_Wmm2*IN2_PER_MM2*HP_PER_W,3) + ' hp/in²'],
                ['Impact Force', fmt(bh.impactForce_N,0) + ' N', fmt(bh.impactForce_N*LBF_PER_N,1) + ' lbf'],
                ['ECD', fmt(bh.ecd_kgm3,1) + ' kg/m³', fmt(bh.ecd_kgm3*PPG_PER_KGM3,3) + ' ppg'],
                ['Standpipe Pressure', fmt(bh.standpipePressure_kPa,0) + ' kPa', fmt(bh.standpipePressure_kPa*PSI_PER_KPA,0) + ' psi'],
            ];
            if(bh.nozzleSizes_mm && bh.nozzleSizes_mm.length){
                cards.push(['Nozzles',
                    bh.nozzleSizes_mm.map(function(v){ return fmt(v,2); }).join(', ') + ' mm',
                    bh.nozzleSizes_mm.map(function(v){ return Math.round(v/25.4*32); }).join(', ') + ' /32in']);
            }
            cards.forEach(function(c){
                var d = document.createElement('div');
                d.style.cssText = 'background:var(--an-panel2,#161e28);border:1px solid var(--an-border);border-radius:4px;padding:8px 10px;';
                d.innerHTML = '<div style="font-size:10px;color:var(--an-text-dim,#5a7080);text-transform:uppercase;letter-spacing:.5px;">'+c[0]+'</div><div style="font-family:monospace;font-size:15px;color:var(--an-text-bright,#e8f4ff);">'+c[1]+'</div><div style="font-family:monospace;font-size:11px;color:var(--an-text-dim,#5a7080);margin-top:2px;">'+c[2]+'</div>';
                cardsEl.appendChild(d);
            });
        }

        var pct = r.pressureLossPct || {};
        var segs = [
            { label:'DS', pct: pct.drillString || 0, color:'#00c8ff' },
            { label:'ANN', pct: pct.annulus || 0, color:'#ff6b35' },
            { label:'SURF', pct: pct.surface || 0, color:'#39ff14' },
            { label:'BIT', pct: pct.bit || 0, color:'#ffd060' },
        ];
        var bar = document.getElementById('hydPlBar');
        bar.innerHTML = '';
        segs.forEach(function(s){
            if(s.pct <= 0) return;
            var d = document.createElement('div');
            d.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:9px;color:#000;font-family:monospace;width:' + s.pct + '%;background:' + s.color + ';';
            d.title = s.label + ': ' + s.pct.toFixed(1) + '%';
            d.textContent = s.pct > 6 ? (s.label + ' ' + s.pct.toFixed(0) + '%') : '';
            bar.appendChild(d);
        });

        var dsBody = document.querySelector('#hydDsTable tbody');
        dsBody.innerHTML = '';
        (r.pipeRows || []).forEach(function(row){
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>'+row.name+'</td><td>'+fmt(row.capacity_bbl,2)+'</td><td>'+fmt(row.pressureLoss_kPa,0)+'</td>';
            dsBody.appendChild(tr);
        });

        var annBody = document.querySelector('#hydAnnTable tbody');
        annBody.innerHTML = '';
        (r.annulusRows || []).forEach(function(row){
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>'+row.section+'</td><td>'+fmt(row.length_m,1)+'</td><td>'+row.flowRegime+'</td><td>'+fmt(row.pressureLoss_kPa,0)+'</td>';
            annBody.appendChild(tr);
        });

        statusText.textContent = entry.calculatedAt
            ? ('Calculated ' + new Date(entry.calculatedAt).toLocaleString() + (entry.calculatedByName ? ' by ' + entry.calculatedByName : ''))
            : '';
    }

    function onWellChange(){
        var wk = wellSelect.value;
        var scenarios = hydDoc && hydDoc.scenarios ? hydDoc.scenarios : {};
        var scenarioName = scenarioSelect.value || (hydDoc && hydDoc.activeScenario);
        var rbw = (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || (hydDoc && hydDoc.resultsByWell) || {};
        renderEntry(rbw[wk]);
    }

    async function onScenarioChange(){
        var scenarioName = scenarioSelect.value;
        if(!hydDoc || scenarioName === hydDoc.activeScenario){ onWellChange(); return; }
        try {
            var res = await fetch('/notes/hydraulicsModel/' + HYD_NOTE_ID + '/scenario/setActive', {
                method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ scenario: scenarioName })
            });
            if(res.ok){
                var res2 = await fetch('/notes/hydraulicsModel/' + HYD_NOTE_ID);
                hydDoc = await res2.json();
                if(hydDoc && !hydDoc.resultsByWell) hydDoc.resultsByWell = {};
            }
        } catch(e){ console.error('[Hyd] scenario switch failed:', e); }
        onWellChange();
    }

    function initHyd(){
        if(!hydDoc){
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No Bit Hydraulics model saved yet for this job.';
            statusText.textContent = '';
            return;
        }
        var subjectWells = getSubjectWellKeys();
        var wellKeys = Object.keys(hydDoc.resultsByWell || {});
        // Union of tagged subject wells and whatever wells actually have a
        // saved run (covers the "General" fallback key used when a job has
        // no subject-well trajectories tagged yet).
        var allKeys = subjectWells.slice();
        wellKeys.forEach(function(k){ if(allKeys.indexOf(k) === -1) allKeys.push(k); });
        if(!allKeys.length){
            emptyMsg.style.display = 'block';
            emptyMsg.textContent = 'No Bit Hydraulics model saved yet for this job.';
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

        var scenarioNames = hydDoc.scenarios ? Object.keys(hydDoc.scenarios) : ['Default'];
        if(!scenarioNames.length) scenarioNames = ['Default'];
        scenarioSelect.innerHTML = '';
        scenarioNames.forEach(function(n){
            var opt = document.createElement('option');
            opt.value = n; opt.textContent = n;
            scenarioSelect.appendChild(opt);
        });
        scenarioSelect.value = (hydDoc.activeScenario && scenarioNames.indexOf(hydDoc.activeScenario) !== -1) ? hydDoc.activeScenario : scenarioNames[0];
        scenarioSelect.style.display = '';
        scenarioSelect.addEventListener('change', onScenarioChange);

        // Default to whichever well/scenario has the most recent calculation.
        var latest = null, defaultWell = allKeys[0];
        Object.keys(hydDoc.resultsByWell || {}).forEach(function(wk){
            var entry = hydDoc.resultsByWell[wk];
            if(!entry || !entry.calculatedAt) return;
            if(!latest || new Date(entry.calculatedAt) > new Date(latest)){
                latest = entry.calculatedAt;
                defaultWell = wk;
            }
        });
        wellSelect.value = defaultWell;
        onWellChange();
    }

    let hydInitDone = false;
    function initHydOnce(){ if(hydInitDone) return; hydInitDone = true; initHyd(); }
    const collapseHydEl = document.getElementById('collapseHyd');
    if(collapseHydEl){
        collapseHydEl.addEventListener('shown.bs.collapse', initHydOnce);
        if(collapseHydEl.classList.contains('show')) initHydOnce();
    } else {
        initHydOnce();
    }
})();

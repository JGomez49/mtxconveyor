/* MTX Conveyor — job page script 9. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 12783) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    var legsEl   = document.getElementById('legsContainer');
    var empty    = document.getElementById('legsEmpty');
    var dlBtn    = document.getElementById('legsDownloadBtn');
    var dataEl   = document.getElementById('legsData');
    if(!dataEl) return;
    var wellsArr = JSON.parse(dataEl.textContent);
    if(!wellsArr.length){ if(empty) empty.style.display=''; return; }
    if(empty) empty.style.display='none';
    if(!legsEl) return;
    legsEl.innerHTML = '';

    // Sort wells by wellKey
    wellsArr.sort(function(a,b){ return a.wellKey.localeCompare(b.wellKey); });

    function fmt(v,d){
        if(v===null||v===undefined||isNaN(Number(v))) return String.fromCharCode(8212);
        return Number(v).toFixed(d);
    }

    // ── Render each well ──────────────────────────────────────────────
    wellsArr.forEach(function(well){
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:20px;';

        // ── Header / highlights ───────────────────────────────────────
        var header = document.createElement('div');
        header.style.cssText = 'background:var(--an-panel,#111820);border:1px solid var(--an-border,#1e2d3d);border-radius:4px 4px 0 0;padding:10px 14px;display:flex;gap:14px;align-items:stretch;flex-wrap:wrap;';

        var wellLabel = document.createElement('span');
        wellLabel.style.cssText = 'font-weight:700;font-size:14px;letter-spacing:1px;color:var(--an-text-bright,#e8f4ff);align-self:center;margin-right:6px;';
        wellLabel.textContent = well.wellKey;
        header.appendChild(wellLabel);

        function makeChip(label, value, bg, fg){
            var chip = document.createElement('div');
            chip.style.cssText = 'background:'+bg+';color:'+fg+';border-radius:4px;padding:6px 14px;display:flex;flex-direction:column;align-items:center;min-width:130px;user-select:all;cursor:text;';
            var lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.85;margin-bottom:2px;';
            lbl.textContent = label;
            var val = document.createElement('div');
            val.style.cssText = 'font-size:16px;font-weight:700;font-family:monospace;letter-spacing:0.5px;';
            val.textContent = value;
            chip.appendChild(lbl);
            chip.appendChild(val);
            return chip;
        }

        header.appendChild(makeChip('Total Lateral', fmt(well.totalLateral,1)+' m', 'var(--an-accent,#00c8ff)', '#000'));
        if(well.totalMD !== null)
            header.appendChild(makeChip('Total MD', fmt(well.totalMD,1)+' m', 'var(--an-accent2,#ff6b35)', '#fff'));
        if(well.icpMD !== null)
            header.appendChild(makeChip('Tie-on MD', fmt(well.icpMD,1)+' m', 'var(--an-panel2,#161e28)', 'var(--an-text,#c8d8e8)'));

        wrap.appendChild(header);

        // ── Table ─────────────────────────────────────────────────────
        var tableWrap = document.createElement('div');
        tableWrap.style.cssText = 'overflow-x:auto;';
        var table = document.createElement('table');
        table.className = 'table table-dark table-hover table-bordered table-sm mb-0';
        table.style.fontSize = '11px';
        table.dataset.wellKey = well.wellKey;

        var thead = document.createElement('thead');
        var trh = document.createElement('tr');
        ['Wellbore','Parent / Tie-on','Tie-on MD (m)','TD MD (m)','Lateral (m)'].forEach(function(h){
            var th = document.createElement('th'); th.textContent = h; trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        // Sort legs by wellName
        well.legs.sort(function(a,b){ return a.wellName.localeCompare(b.wellName); });
        well.legs.forEach(function(leg){
            var tr = document.createElement('tr');
            if(leg.isLeg1) tr.style.borderLeft = '3px solid var(--an-accent,#00c8ff)';
            [
                leg.wellName,
                leg.parentLabel || String.fromCharCode(8212),
                leg.tieOnMD !== null ? fmt(leg.tieOnMD,1) : String.fromCharCode(8212),
                fmt(leg.tdMD,1),
                fmt(leg.lateral,1),
            ].forEach(function(val){
                var td = document.createElement('td'); td.textContent = val; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        wrap.appendChild(tableWrap);
        legsEl.appendChild(wrap);
    });

    // ── Enable download button ────────────────────────────────────────
    if(dlBtn) dlBtn.disabled = false;

    // ── Excel download ────────────────────────────────────────────────
    if(dlBtn){
        dlBtn.addEventListener('click', function(){
            if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
            var wb = XLSX.utils.book_new();

            wellsArr.forEach(function(well){
                // Sheet name: sanitise wellKey
                var sheetName = well.wellKey.replace(/[\[\]\*\/\\\?:]/g,'').slice(0,31) || 'Well';

                var aoa = [];
                // Highlight rows
                aoa.push(['Total Lateral (m)', well.totalLateral]);
                if(well.totalMD !== null) aoa.push(['Total MD (m)', well.totalMD]);
                if(well.icpMD  !== null) aoa.push(['Tie-on MD (m)', well.icpMD]);
                aoa.push([]);
                // Table header
                aoa.push(['Wellbore','Parent / Tie-on','Tie-on MD (m)','TD MD (m)','Lateral (m)']);
                // Rows
                well.legs.forEach(function(leg){
                    aoa.push([
                        leg.wellName,
                        leg.parentLabel || '',
                        leg.tieOnMD !== null ? leg.tieOnMD : '',
                        leg.tdMD !== null ? leg.tdMD : '',
                        leg.lateral !== null ? leg.lateral : '',
                    ]);
                });

                var ws = XLSX.utils.aoa_to_sheet(aoa);

                // Style highlight rows cyan/orange
                var range = XLSX.utils.decode_range(ws['!ref']);
                // Rows 0-2 are highlights — bold them
                [0,1,2].forEach(function(r){
                    var cellA = XLSX.utils.encode_cell({r:r,c:0});
                    var cellB = XLSX.utils.encode_cell({r:r,c:1});
                    if(ws[cellA]) ws[cellA].s = {font:{bold:true},fill:{fgColor:{rgb:'00C8FF'}}};
                    if(ws[cellB]) ws[cellB].s = {font:{bold:true}};
                });
                // Header row (row 4 = index 4)
                for(var ci=0; ci<=4; ci++){
                    var hCell = XLSX.utils.encode_cell({r:4,c:ci});
                    if(ws[hCell]) ws[hCell].s = {font:{bold:true},fill:{fgColor:{rgb:'1E2D3D'}}};
                }
                // Column widths
                ws['!cols'] = [{wch:30},{wch:20},{wch:14},{wch:12},{wch:12}];

                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            XLSX.writeFile(wb, 'legs_summary.xlsx');
        });
    }
})();

/* MTX Conveyor — job page script 7. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 9486) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const PAD_AC_NOTE_ID = window.MTX_JOB.noteId;

    // ── Helpers (ported from uploadPadAC.ejs) ───────────────────────────
    const padAC_el = id => document.getElementById(id);
    const nonEmpty = v => v !== null && v !== undefined && String(v).trim() !== '';
    const norm     = v => String(v || '').trim();

    function parseNumber(val) {
        if (val === null || val === undefined) return null;
        const s = String(val).replace(/−/g, '-');
        const cleaned = s.replace(/[^0-9eE.\-+]/g, '');
        if (!cleaned) return null;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
    }
    const oneDec = v => { const n = parseNumber(v); return n === null ? '' : n.toFixed(1); };
    const int0   = v => { const n = parseNumber(v); return n === null ? '' : n.toFixed(0); };

    function parseProbabilityFraction(val) {
        const m = String(val || '').match(/1\s*in\s*([\d,]+)/i);
        if (!m) return null;
        const x = Number(m[1].replace(/,/g, ''));
        return Number.isFinite(x) && x > 0 ? x : null;
    }
    function probabilityToPercent(val, dec = 3) {
        const x = parseProbabilityFraction(val);
        return x ? (100 / x).toFixed(dec) : '';
    }
    function isProbTiny(val) {
        const s = norm(val).replace(/\s+/g, ' ');
        if (!s) return false;
        if (s.includes('1E+9') && s.includes('<')) return true;
        return /^\<\s*1\s+in\s+1e\+?\d+\s*$/i.test(s);
    }
    function classForC2C(val) {
        const n = parseNumber(val); if (n === null) return '';
        if (n < 10) return 'risk-red'; if (n < 15) return 'risk-amber'; return 'risk-green';
    }
    function classForSF(val) {
        const n = parseNumber(val); if (n === null) return '';
        if (n < 1.0) return 'risk-red'; if (n < 1.25) return 'risk-amber'; return 'risk-green';
    }

    // ── Report structure matchers (exact from uploadPadAC.ejs) ──────────
    const isOffsetDesignRow = row0 => /^(offset\s+design)\b/i.test(norm(row0));
    function isDetailHeaderRow(row) {
        const cells = row.map(c => norm(c));
        return cells.some(c => /measured\s*depth/i.test(c)) &&
               cells.some(c => /(between\s*centres|distance\s*between\s*centres)/i.test(c)) &&
               cells.some(c => /separation\s*factor/i.test(c));
    }

    function getLabelValue(rows, labelRegex, searchRows = 400) {
        for (let r = 0; r < Math.min(rows.length, searchRows); r++) {
            const row = rows[r] || [];
            for (let c = 0; c < row.length; c++) {
                if (labelRegex.test(norm(row[c]))) {
                    for (let k = c + 1; k < row.length; k++) if (nonEmpty(row[k])) return norm(row[k]);
                    for (let rr = r + 1; rr < Math.min(r + 4, rows.length); rr++) {
                        const nrow = rows[rr] || []; const cand = nrow.find(nonEmpty);
                        if (cand) return norm(cand);
                    }
                    return '';
                }
            }
        }
        return '';
    }
    function buildSubjectWell(rows) {
        return [
            getLabelValue(rows, /^reference\s*site\b/i),
            getLabelValue(rows, /^reference\s*well\b/i),
            getLabelValue(rows, /^reference\s*wellbore\b/i),
            getLabelValue(rows, /^reference\s*design\b/i),
        ].filter(nonEmpty).join(' - ');
    }
    function buildCompositeHeader(allRows, headerRowIdx) {
        const main = (allRows[headerRowIdx] || []).map(c => norm(c));
        const up1  = (allRows[headerRowIdx - 1] || []).map(c => norm(c));
        const up2  = (allRows[headerRowIdx - 2] || []).map(c => norm(c));
        const composite = main.map((label, i) => {
            const above = (up1[i] || up2[i] || '').trim();
            if (!above) return label;
            const mainIsGeneric =
                /^(reference|offset)\b/i.test(label) || /\(m\)/i.test(label) ||
                /depth|axis|centres|ellipses|separation|probability|warning/i.test(label);
            return mainIsGeneric ? `${above} ${label}`.replace(/\s+/g, ' ').trim() : label;
        });
        return { composite, up1, up2, main };
    }
    function belongsToUmbrella(i, up1, up2, umbrellaRegex, searchLeft = 6) {
        const here = (up1[i] || up2[i] || '').trim();
        if (umbrellaRegex.test(here)) return true;
        for (let k = 1; k <= searchLeft; k++) {
            const j = i - k; if (j < 0) break;
            const a1 = (up1[j] || '').trim(); const a2 = (up2[j] || '').trim();
            if (a1 || a2) return umbrellaRegex.test(a1) || umbrellaRegex.test(a2);
        }
        return false;
    }

    // ── Parse one file (same logic as uploadPadAC.ejs parseReport) ──────
    async function parseReport(file, thC2C, thSF) {
        const buf = await file.arrayBuffer();
        let wb;
        try { wb = XLSX.read(buf, { type: 'array' }); }
        catch(e) {
            const csv = new TextDecoder('utf-8').decode(new Uint8Array(buf));
            wb = XLSX.read(csv, { type: 'string' });
        }
        const allRows = [];
        wb.SheetNames.forEach(name => {
            const ws = wb.Sheets[name];
            if (ws) {
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
                if (rows.length) allRows.push(...rows, ...Array(3).fill([]));
            }
        });

        const subjectWell = buildSubjectWell(allRows);
        const results = [];
        let i = 0;

        while (i < allRows.length) {
            const row = allRows[i] || [];
            if (isOffsetDesignRow(row[0])) {
                const offsetName = norm(row[2]);
                let headerRowIdx = -1;
                for (let k = i + 1; k < Math.min(i + 400, allRows.length); k++) {
                    if (isDetailHeaderRow(allRows[k])) { headerRowIdx = k; break; }
                }
                if (headerRowIdx === -1) { i++; continue; }

                const { composite: header, up1, up2, main } = buildCompositeHeader(allRows, headerRowIdx);
                const findAllIdx = re => header.reduce((a, h, idx) => (re.test(h) ? (a.push(idx), a) : a), []);
                const findIdx    = re => header.findIndex(h => re.test(h));

                const idxsMD  = findAllIdx(/measured\s*depth/i);
                const idxsTVD = findAllIdx(/vertical\s*depth/i);
                let idxsSMAJ  = findAllIdx(/semi\s*major\s*axis/i);

                const idxC2C  = findIdx(/between\s*centres/i);
                const idxW2W  = findIdx(/wall[-\s]*wall/i);
                const idxE2E  = findIdx(/ellipse/i);
                const idxMin  = findIdx(/minimum\s*separation/i);
                const idxSF   = findIdx(/separation\s*factor/i);
                const idxProb = findIdx(/probability\s*of\s*collision/i);
                const idxWarn = findIdx(/\bwarning\b/i);

                if (idxsSMAJ.length < 2) {
                    const umb = /semi\s*major/i;
                    const refs = [], offs = [];
                    main.forEach((t, idx) => {
                        if (/^reference\b/i.test(t) && belongsToUmbrella(idx, up1, up2, umb)) refs.push(idx);
                        if (/^offset\b/i.test(t) && belongsToUmbrella(idx, up1, up2, umb)) offs.push(idx);
                    });
                    if (refs.length && offs.length) idxsSMAJ = [refs[0], offs[0]];
                }

                let worst = null;
                for (let r = headerRowIdx + 1; r < allRows.length; r++) {
                    const cur = allRows[r] || [];
                    const rowText = cur.map(norm).join(' ');
                    if (isOffsetDesignRow(norm(cur[0])) || isDetailHeaderRow(cur) ||
                        /offset\s+site\s+error/i.test(rowText)) break;
                    if (!cur.some(nonEmpty)) continue;

                    const getAt = idx => (idx >= 0 && idx < cur.length) ? cur[idx] : '';
                    const c2c = getAt(idxC2C), sf = getAt(idxSF), prob = getAt(idxProb);
                    const c2cNum = parseNumber(c2c), sfNum = parseNumber(sf);
                    if (!((c2cNum !== null && c2cNum < thC2C) || (sfNum !== null && sfNum < thSF))) continue;

                    const probNum = (() => {
                        const m = String(prob || '').match(/1\s*in\s*([\d,]+)/i);
                        return m ? Number(m[1].replace(/,/g, '')) : Infinity;
                    })();
                    const candidate = {
                        probNum, sfNum: sfNum || Infinity, c2cNum: c2cNum || Infinity,
                        refMDNum: parseNumber(getAt(idxsMD[0])) || 0,
                        reason: `Selected: highest collision probability (1 in ${probNum.toLocaleString()})`,
                        columns: [
                            subjectWell, offsetName,
                            getAt(idxsMD[0]), getAt(idxsTVD[0]), getAt(idxsMD[1]), getAt(idxsTVD[1]),
                            getAt(idxsSMAJ[0]), getAt(idxsSMAJ[1]),
                            c2c, getAt(idxW2W), getAt(idxE2E), getAt(idxMin), sf, prob, null, getAt(idxWarn)
                        ]
                    };
                    if (!worst ||
                        candidate.probNum < worst.probNum ||
                        (candidate.probNum === worst.probNum && candidate.sfNum < worst.sfNum) ||
                        (candidate.sfNum === worst.sfNum && candidate.c2cNum < worst.c2cNum) ||
                        (candidate.c2cNum === worst.c2cNum && candidate.refMDNum > worst.refMDNum)) {
                        worst = candidate;
                    }
                }
                if (worst) results.push({ subjectWell, offsetName, columns: worst.columns, reason: worst.reason });
                i = headerRowIdx + 1; continue;
            }
            i++;
        }
        return results;
    }

    // ── State ────────────────────────────────────────────────────────────
    const CUSTOM_HEADERS = [
        'Ref. Well','Offset Well',
        'Ref. MD','Ref. TVD','Offset MD','Offset TVD',
        'Ref. Semi Major','Off. Semi Major','C2C',
        'W2W','E2E','Min. Sep.','SF',
        'Prob.Sta.','Prob.%','Warning'
    ];

    let lastResults = [];
    let sortState   = { col: null, dir: 'asc' };
    const filters = {
        refMDlt100: true, e2eEmpty: true, probTiny: false, crossDup: true, showAND: false,
        hideSemiMajor: true, hideW2W: true, hideE2E: true, hideMinSep: true,
        hideProbPct: true, hideWarning: true,
    };

    function setStatus(msg) {
        const el = padAC_el('padACStatus'); if (el) el.textContent = msg;
    }

    // ── Filtering & sorting ──────────────────────────────────────────────
    function dedupeCrossPairs(rows) {
        const seen = new Set(), out = [];
        for (const r of rows) {
            const a = norm(r.columns[0]).toLowerCase(), b = norm(r.columns[1]).toLowerCase();
            const key = a < b ? `${a}||${b}` : `${b}||${a}`;
            if (seen.has(key)) continue;
            seen.add(key); out.push(r);
        }
        return out;
    }
    function getFilteredResults() {
        let f = lastResults.filter(r => {
            const c = r.columns;
            if (filters.refMDlt100) { const n = parseNumber(c[2]); if (n !== null && n < 100) return false; }
            if (filters.e2eEmpty)   { if (!nonEmpty(c[10])) return false; }
            if (filters.probTiny)   { if (isProbTiny(c[13])) return false; }
            if (filters.showAND) {
                const c2cN = parseNumber(c[8]), sfN = parseNumber(c[12]);
                if (!(c2cN !== null && c2cN < 15 && sfN !== null && sfN < 1.0)) return false;
            }
            return true;
        });
        if (filters.crossDup) f = dedupeCrossPairs(f);
        return f;
    }
    function isColVisible(col1) {
        if ((col1 === 7 || col1 === 8) && filters.hideSemiMajor) return false;
        if (col1 === 10 && filters.hideW2W)     return false;
        if (col1 === 11 && filters.hideE2E)     return false;
        if (col1 === 12 && filters.hideMinSep)  return false;
        if (col1 === 15 && filters.hideProbPct) return false;
        if (col1 === 16 && filters.hideWarning) return false;
        return true;
    }
    function getVisibleCols() { return CUSTOM_HEADERS.map((_, i) => i + 1).filter(isColVisible); }
    const NUMERIC_COLS = new Set([3,4,5,6,7,8,9,10,11,12,13]);
    function compareCells(aV, bV, col1) {
        if (NUMERIC_COLS.has(col1)) {
            const an = parseNumber(aV), bn = parseNumber(bV);
            if (an === null && bn === null) return 0;
            if (an === null) return 1; if (bn === null) return -1;
            return an - bn;
        }
        const as = norm(aV).toLowerCase(), bs = norm(bV).toLowerCase();
        return as < bs ? -1 : as > bs ? 1 : 0;
    }
    function getViewResults() {
        const arr = getFilteredResults().slice();
        if (!sortState.col || !isColVisible(sortState.col)) return arr;
        const col = sortState.col, dir = sortState.dir;
        arr.sort((ra, rb) => { const cmp = compareCells(ra.columns[col-1], rb.columns[col-1], col); return dir === 'asc' ? cmp : -cmp; });
        return arr;
    }
    function setSort(col1) {
        if (sortState.col === col1) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        else { sortState.col = col1; sortState.dir = 'asc'; }
        renderTable(lastResults);
    }

    // ── Render table ─────────────────────────────────────────────────────
    function renderTable(resultsAll) {
        const thead = padAC_el('padACThead'), tbody = padAC_el('padACTbody');
        const empty = padAC_el('padACEmpty'), count = padAC_el('padACCount');
        if (!thead || !tbody) return;
        thead.innerHTML = ''; tbody.innerHTML = '';

        const visibleCols = getVisibleCols();

        // Header: checkbox (select-all) + sort buttons
        const trh = document.createElement('tr');
        // Select-all checkbox cell
        const thCb = document.createElement('th');
        const cbAll = document.createElement('input');
        cbAll.type = 'checkbox';
        cbAll.title = 'Select / deselect all';
        cbAll.addEventListener('change', () => {
            tbody.querySelectorAll('input.padac-row-cb').forEach(cb => cb.checked = cbAll.checked);
        });
        thCb.appendChild(cbAll);
        trh.appendChild(thCb);
        visibleCols.forEach(col1 => {
            const th = document.createElement('th');
            const dir = sortState.col === col1 ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
            th.innerHTML = `<button type="button" style="all:unset;cursor:pointer;white-space:nowrap;"
                data-col="${col1}">${CUSTOM_HEADERS[col1-1]}${dir}</button>`;
            th.querySelector('button').addEventListener('click', e => setSort(Number(e.currentTarget.dataset.col)));
            trh.appendChild(th);
        });
        thead.appendChild(trh);

        const results = getViewResults();
        if (!results.length) {
            if (count) count.textContent = 'No rows match current filters.';
            if (empty) empty.style.display = (resultsAll && resultsAll.length) ? '' : '';
            return;
        }
        if (empty) empty.style.display = 'none';

        results.forEach((res, ri) => {
            const tr = document.createElement('tr');
            // Checkbox cell — store index + site names for "select same site"
            const tdCb = document.createElement('td');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'padac-row-cb';
            cb.dataset.idx = lastResults.indexOf(res);  // stable index
            // Extract site: everything before first ' - [' in the well name
            function extractSite(name) {
                const m = String(name || '').match(/^(.*?)\s+-\s+\[/);
                return m ? m[1].trim() : String(name || '').trim();
            }
            cb.dataset.refSite = extractSite(res.columns[0]);
            cb.dataset.offSite = extractSite(res.columns[1]);
            // Store Ref. MD (col index 2, 0-based) for lateral lookup
            cb.dataset.refMD   = res.columns[2] || '';
            // Store ref well name for trajectory matching
            cb.dataset.refWell = String(res.columns[0] || '');
            tdCb.appendChild(cb);
            tr.appendChild(tdCb);
            visibleCols.forEach(col1 => {
                const val = res.columns[col1 - 1];
                const td = document.createElement('td');
                if (col1 === 2 && res.reason) { td.title = res.reason; }
                if (col1 >= 3 && col1 <= 6)        td.textContent = int0(val);
                else if (col1 >= 9 && col1 <= 13)  td.textContent = oneDec(val);
                else if (col1 === 15)               td.textContent = probabilityToPercent(res.columns[13]);
                else                                td.textContent = val || '';
                if (col1 === 9)  { const cls = classForC2C(val); if (cls) td.classList.add(cls); }
                if (col1 === 13) { const cls = classForSF(val);  if (cls) td.classList.add(cls); }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        if (count) count.textContent = `${results.length} row(s) shown (from ${resultsAll.length} total).`;
    }

    // ── Subject badges ───────────────────────────────────────────────────
    function renderBadges(results, fileCount) {
        const holder = padAC_el('padACBadges'); if (!holder) return;
        holder.innerHTML = '';
        const counts = new Map();
        results.forEach(r => { const k = r.subjectWell || '(unknown)'; counts.set(k, (counts.get(k)||0)+1); });
        counts.forEach((cnt, name) => {
            const b = document.createElement('span');
            b.className = 'badge bg-info text-dark';
            b.textContent = `${name} (${cnt})`;
            holder.appendChild(b);
        });
    }

    // ── Export helpers ───────────────────────────────────────────────────
    function buildExportAoA() {
        const visibleCols = getVisibleCols();
        const results = getViewResults();
        const headers = visibleCols.map(c => CUSTOM_HEADERS[c - 1]);
        const rows = results.map(r => visibleCols.map(c1 => {
            if (c1 === 15) return probabilityToPercent(r.columns[13]);
            const v = r.columns[c1-1];
            if (c1 >= 3 && c1 <= 6) return int0(v);
            if (c1 >= 9 && c1 <= 13) return oneDec(v);
            return v || '';
        }));
        return { headers, rows };
    }
    function downloadCSV() {
        const { headers, rows } = buildExportAoA(); if (!rows.length) return;
        const csv = [headers, ...rows].map(r => r.map(v => {
            const s = String(v || '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'ac_risk_summary.csv'; a.click();
    }
    function downloadXLSX_padAC() {
        const { headers, rows } = buildExportAoA(); if (!rows.length) return;
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb2 = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb2, ws, 'Summary');
        XLSX.writeFile(wb2, 'ac_risk_summary.xlsx');
    }

    // ── Parse button ─────────────────────────────────────────────────────
    const parseBtn = padAC_el('padACParseBtn');
    const saveBtn  = padAC_el('padACSaveBtn');
    if (parseBtn) {
        parseBtn.addEventListener('click', async () => {
            const fileInput = padAC_el('padACFileInput');
            const files = Array.from(fileInput ? fileInput.files : []);
            if (!files.length) { setStatus('⚠ Please choose report files or a folder first.'); return; }
            const thC2C = Number((padAC_el('padACThC2C') || {}).value || 15);
            const thSF  = Number((padAC_el('padACThSF')  || {}).value || 1.25);

            lastResults = [];
            if (saveBtn) saveBtn.disabled = true;
            padAC_el('padACCsvBtn')  && (padAC_el('padACCsvBtn').disabled  = true);
            padAC_el('padACXlsxBtn') && (padAC_el('padACXlsxBtn').disabled = true);
            padAC_el('padACDownloadBtn') && (padAC_el('padACDownloadBtn').disabled = true);
            renderBadges([], 0);
            renderTable([]);

            let processed = 0;
            for (const f of files) {
                setStatus(`Parsing ${f.name} (${++processed}/${files.length})…`);
                try {
                    const res = await parseReport(f, thC2C, thSF);
                    lastResults.push(...res);
                    renderBadges(lastResults, processed);
                    renderTable(lastResults);
                } catch(e) {
                    console.error(e);
                    setStatus(`⚠ Failed parsing ${f.name}: ${e.message}`);
                }
            }

            if (lastResults.length) {
                setStatus(`✅ Done. Parsed ${processed} file(s). ${lastResults.length} rows. Click Save to store.`);
                if (saveBtn) saveBtn.disabled = false;
                padAC_el('padACSelectSiteBtn') && (padAC_el('padACSelectSiteBtn').disabled = false);
                padAC_el('padACLateralBtn') && (padAC_el('padACLateralBtn').disabled = false);
                padAC_el('padACDupMDBtn') && (padAC_el('padACDupMDBtn').disabled = false);
                padAC_el('padACDeleteBtn') && (padAC_el('padACDeleteBtn').disabled = false);
                padAC_el('padACCsvBtn')  && (padAC_el('padACCsvBtn').disabled  = false);
                padAC_el('padACXlsxBtn') && (padAC_el('padACXlsxBtn').disabled = false);
                padAC_el('padACDownloadBtn') && (padAC_el('padACDownloadBtn').disabled = false);
            } else {
                setStatus(`⚠ Parsed ${processed} file(s). No rows matched thresholds.`);
            }
        });
    }

    // ── Save to MongoDB ──────────────────────────────────────────────────
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (!lastResults.length) return;
            setStatus('Saving…'); saveBtn.disabled = true;
            try {
                const res = await fetch('/notes/padAC/' + PAD_AC_NOTE_ID, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        noteId: PAD_AC_NOTE_ID,
                        headers: CUSTOM_HEADERS,
                        rows: lastResults.map(r => r.columns)
                    })
                });
                const data = await res.json();
                if (res.ok) setStatus(`✅ Saved ${data.count} rows to this job.`);
                else { setStatus('❌ Save failed: ' + (data.error || res.statusText)); saveBtn.disabled = false; }
            } catch(e) {
                setStatus('❌ Error: ' + e.message); saveBtn.disabled = false;
            }
        });
    }

    // ── Filter events ────────────────────────────────────────────────────
    const wireFilter = (id, key) => {
        const el = padAC_el(id);
        if (el) el.addEventListener('change', e => { filters[key] = e.target.checked; renderTable(lastResults); });
    };
    wireFilter('padACfRefMD',  'refMDlt100');
    wireFilter('padACfE2E',    'e2eEmpty');
    wireFilter('padACfProb',   'probTiny');
    wireFilter('padACfDup',    'crossDup');
    wireFilter('padACfAND',    'showAND');
    wireFilter('padACfSemi',   'hideSemiMajor');
    wireFilter('padACfW2W',    'hideW2W');
    wireFilter('padACfE2Ecol', 'hideE2E');
    wireFilter('padACfMinSep', 'hideMinSep');
    wireFilter('padACfProbPct','hideProbPct');
    wireFilter('padACfWarn',   'hideWarning');

    // ── Select Same Site ─────────────────────────────────────────────────
    const selectSiteBtn = padAC_el('padACSelectSiteBtn');
    if (selectSiteBtn) {
        selectSiteBtn.addEventListener('click', () => {
            const allCbs = Array.from(document.querySelectorAll('input.padac-row-cb'));
            if (!allCbs.length) { setStatus('⚠ No rows in table.'); return; }

            // Collect unique sites from checked rows (if any), else from all rows
            const checkedCbs = allCbs.filter(cb => cb.checked);
            const sourceCbs  = checkedCbs.length ? checkedCbs : allCbs;

            const targetSites = new Set();
            sourceCbs.forEach(cb => {
                // Only add a site if BOTH ref and offset share it (same-site row)
                if (cb.dataset.refSite && cb.dataset.refSite === cb.dataset.offSite) {
                    targetSites.add(cb.dataset.refSite);
                } else if (checkedCbs.length) {
                    // If user pre-checked rows, also include their individual sites
                    if (cb.dataset.refSite) targetSites.add(cb.dataset.refSite);
                    if (cb.dataset.offSite) targetSites.add(cb.dataset.offSite);
                }
            });

            if (!targetSites.size) {
                setStatus('⚠ No same-site rows found. Check one row first to identify the site.');
                return;
            }

            // Select every row where BOTH ref and offset site are in targetSites
            let selected = 0;
            allCbs.forEach(cb => {
                if (targetSites.has(cb.dataset.refSite) && targetSites.has(cb.dataset.offSite)) {
                    cb.checked = true;
                    selected++;
                }
            });
            setStatus('🎯 ' + selected + ' row(s) selected — site(s): ' + [...targetSites].join(', '));
        });
    }

    // ── All in Lateral ───────────────────────────────────────────────────
    // Selects rows where the Ref. Well inclination at Ref. MD > 88°
    // Uses WELLBORES (already on page) to look up inclination by MD.
    const lateralBtn = padAC_el('padACLateralBtn');
    if (lateralBtn) {
        lateralBtn.addEventListener('click', () => {
            // Build trajectory lookup: wellName → survey[]
            // WELLBORES may not be in scope here (only defined inside WBT if-block)
            // so we read from the wbtData JSON element if available
            let trajMap = {};
            const wbtEl = document.getElementById('wbtData');
            const wbtArr = wbtEl ? JSON.parse(wbtEl.textContent) : (typeof WELLBORES !== 'undefined' ? WELLBORES : []);

            wbtArr.forEach(function(traj) {
                if (traj.wellName && traj.survey) trajMap[traj.wellName] = traj.survey;
            });

            if (!Object.keys(trajMap).length) {
                setStatus('⚠ No wellbore trajectories uploaded for this job.');
                return;
            }

            // Extract wellbore identifier from PAD AC well name:
            // "04-08-061-03W4 [P1-652] - [01]ETS 156991_W30 - L01 - L01"
            // → wellbore key: "[01]ETS 156991_W30" + leg: "L01"
            // → trajectory wellName: "[01]ETS 156991_W30_L01"
            function extractWellboreKey(padACName) {
                // Split on ' - ' to get parts
                const parts = padACName.split(/\s+-\s+/);
                // parts[0] = site, parts[1] = wellbore, parts[2] = leg, parts[3] = sub-leg
                if (parts.length >= 3) {
                    const wb  = parts[1].trim();  // e.g. "[01]ETS 156991_W30"
                    const leg = parts[2].trim();  // e.g. "L01"
                    return wb + '_' + leg;         // e.g. "[01]ETS 156991_W30_L01"
                }
                return padACName;
            }

            // Find inclination at a given MD in a survey (linear interpolation)
            function getInclAtMD(survey, targetMD) {
                const md = parseFloat(targetMD);
                if (isNaN(md) || !survey || !survey.length) return null;
                // Find bracketing stations
                for (let i = 1; i < survey.length; i++) {
                    const md0 = parseFloat(survey[i-1].md);
                    const md1 = parseFloat(survey[i].md);
                    if (md >= md0 && md <= md1) {
                        const t = (md1 > md0) ? (md - md0) / (md1 - md0) : 0;
                        const i0 = parseFloat(survey[i-1].incl);
                        const i1 = parseFloat(survey[i].incl);
                        return i0 + t * (i1 - i0);
                    }
                }
                // Beyond last station — use last value
                const last = survey[survey.length - 1];
                if (parseFloat(last.md) <= md) return parseFloat(last.incl);
                return null;
            }

            const allCbs = Array.from(document.querySelectorAll('input.padac-row-cb'));
            let selected = 0, noMatch = 0, checked = 0;

            allCbs.forEach(function(cb) {
                const refWellFull = cb.dataset.refWell || '';
                const refMD       = cb.dataset.refMD;
                const trajKey     = extractWellboreKey(refWellFull);

                // Try exact match first, then fuzzy (contains)
                let survey = trajMap[trajKey];
                if (!survey) {
                    // Fuzzy: find trajectory whose wellName is contained in trajKey or vice versa
                    const key = Object.keys(trajMap).find(k =>
                        trajKey.includes(k) || k.includes(trajKey.replace(/_L\d+$/i,''))
                    );
                    if (key) survey = trajMap[key];
                }

                if (!survey) { noMatch++; return; }

                const incl = getInclAtMD(survey, refMD);
                if (incl !== null && incl > 88) {
                    cb.checked = true;
                    selected++;
                }
                checked++;
            });

            if (noMatch === allCbs.length) {
                setStatus('⚠ Could not match any PAD AC well names to uploaded trajectories.');
            } else {
                setStatus('📐 ' + selected + ' row(s) selected where Ref. incl > 88° at Ref. MD' +
                    (noMatch ? ' (' + noMatch + ' rows had no matching trajectory)' : '') + '.');
            }
        });
    }

    // ── Same Ref.MD ───────────────────────────────────────────────────────
    // Selects all rows whose Ref. MD value appears more than once in the table.
    const dupMDBtn = padAC_el('padACDupMDBtn');
    if (dupMDBtn) {
        dupMDBtn.addEventListener('click', () => {
            const allCbs = Array.from(document.querySelectorAll('input.padac-row-cb'));
            if (!allCbs.length) { setStatus('⚠ No rows in table.'); return; }

            // Count occurrences of each Ref. MD value
            const mdCount = {};
            allCbs.forEach(cb => {
                const md = String(cb.dataset.refMD || '').trim();
                if (md) mdCount[md] = (mdCount[md] || 0) + 1;
            });

            // Select all rows whose Ref. MD appears more than once
            let selected = 0;
            allCbs.forEach(cb => {
                const md = String(cb.dataset.refMD || '').trim();
                if (md && mdCount[md] > 1) {
                    cb.checked = true;
                    selected++;
                }
            });

            const dupMDs = Object.keys(mdCount).filter(md => mdCount[md] > 1);
            if (!selected) {
                setStatus('✅ No duplicated Ref. MD values found — all rows are unique.');
            } else {
                setStatus('🔁 ' + selected + ' row(s) selected with duplicated Ref. MD: ' + dupMDs.join(', '));
            }
        });
    }

    // ── Delete Selected ──────────────────────────────────────────────────
    const deleteBtn = padAC_el('padACDeleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const checked = Array.from(
                document.querySelectorAll('input.padac-row-cb:checked')
            );
            if (!checked.length) { setStatus('⚠ No rows selected.'); return; }
            // Collect indices to remove (stored as data-idx on each checkbox)
            const idxsToRemove = new Set(checked.map(cb => Number(cb.dataset.idx)));
            lastResults = lastResults.filter((_, i) => !idxsToRemove.has(i));
            renderBadges(lastResults, 0);
            renderTable(lastResults);
            // Re-enable delete btn only if rows remain
            deleteBtn.disabled = !lastResults.length;
            if (saveBtn) saveBtn.disabled = !lastResults.length;
            setStatus(`🗑 Deleted ${idxsToRemove.size} row(s). ${lastResults.length} remaining. Save when ready.`);
        });
    }

    // ── Export events ────────────────────────────────────────────────────
    padAC_el('padACCsvBtn')  && padAC_el('padACCsvBtn').addEventListener('click', downloadCSV);
    padAC_el('padACXlsxBtn') && padAC_el('padACXlsxBtn').addEventListener('click', downloadXLSX_padAC);

    // ── Download Table (all roles) — reads live DOM with colours ─────────
    function downloadPadACTable() {
        if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
        const table = padAC_el('padACTable');
        if(!table || table.style.display === 'none'){
            alert('No table to download.'); return;
        }
        // Colour map: CSS class → ARGB hex for xlsx-style
        const CLASS_FILL = {
            'risk-red':   'FFB22222',
            'risk-amber': 'FFF0C640',
            'risk-green': 'FF2E7D32',
        };
        const CLASS_FONT = {
            'risk-red':   'FFFFFFFF',
            'risk-amber': 'FF000000',
            'risk-green': 'FFFFFFFF',
        };
        const aoa = [];
        const styles = [];   // parallel array of row→col→style

        // Header
        const headers = Array.from(table.querySelectorAll('thead tr th'))
            .map(th => th.textContent.trim());
        aoa.push(headers);
        styles.push(headers.map(() => ({
            font: { bold: true, color: { rgb: 'FFE8F4FF' } },
            fill: { fgColor: { rgb: 'FF1E2D3D' } },
        })));

        // Body rows
        Array.from(table.querySelectorAll('tbody tr')).forEach(function(tr) {
            const row = [], rowStyle = [];
            Array.from(tr.querySelectorAll('td')).forEach(function(td) {
                row.push(td.textContent.trim());
                // Find if td has a risk colour class
                let fill = null, font = null;
                for(const cls of Object.keys(CLASS_FILL)) {
                    if(td.classList.contains(cls)) {
                        fill = CLASS_FILL[cls];
                        font = CLASS_FONT[cls];
                        break;
                    }
                }
                rowStyle.push(fill ? {
                    fill: { fgColor: { rgb: fill } },
                    font: { color: { rgb: font } },
                } : null);
            });
            aoa.push(row);
            styles.push(rowStyle);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);

        // Apply styles cell by cell
        styles.forEach(function(rowStyle, r) {
            rowStyle.forEach(function(s, c) {
                if(!s) return;
                const addr = XLSX.utils.encode_cell({r, c});
                if(!ws[addr]) return;
                ws[addr].s = s;
            });
        });

        // Auto column widths
        const colWidths = aoa[0].map((_, ci) => ({
            wch: Math.min(40, Math.max(10,
                Math.max(...aoa.map(row => String(row[ci]||'').length))
            ))
        }));
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'PAD AC');
        XLSX.writeFile(wb, 'pad_ac_summary.xlsx');
    }

    const dlBtn = padAC_el('padACDownloadBtn');
    if(dlBtn) dlBtn.addEventListener('click', downloadPadACTable);

    // ── Reset ────────────────────────────────────────────────────────────
    const resetBtn = padAC_el('padACResetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const fi = padAC_el('padACFileInput'); if (fi) fi.value = '';
            lastResults = []; sortState = { col: null, dir: 'asc' };
            Object.assign(filters, {
                refMDlt100:true,e2eEmpty:true,probTiny:false,crossDup:true,showAND:false,
                hideSemiMajor:true,hideW2W:true,hideE2E:true,hideMinSep:true,hideProbPct:true,hideWarning:true
            });
            ['padACfRefMD','padACfE2E','padACfDup','padACfSemi','padACfW2W','padACfE2Ecol','padACfMinSep','padACfProbPct','padACfWarn']
                .forEach(id => { const e = padAC_el(id); if (e) e.checked = true; });
            const fAND  = padAC_el('padACfAND');  if (fAND)  fAND.checked  = false;
            const fProb = padAC_el('padACfProb'); if (fProb) fProb.checked = false;
            if (saveBtn) saveBtn.disabled = true;
            padAC_el('padACCsvBtn')  && (padAC_el('padACCsvBtn').disabled  = true);
            padAC_el('padACXlsxBtn') && (padAC_el('padACXlsxBtn').disabled = true);
            padAC_el('padACDownloadBtn') && (padAC_el('padACDownloadBtn').disabled = true);
            padAC_el('padACSelectSiteBtn') && (padAC_el('padACSelectSiteBtn').disabled = true);
            padAC_el('padACLateralBtn') && (padAC_el('padACLateralBtn').disabled = true);
            padAC_el('padACDupMDBtn') && (padAC_el('padACDupMDBtn').disabled = true);
            padAC_el('padACDeleteBtn') && (padAC_el('padACDeleteBtn').disabled = true);
            renderBadges([], 0);
            renderTable([]);
            setStatus('');
            const empty = padAC_el('padACEmpty'); if (empty) empty.style.display = '';
            const count = padAC_el('padACCount'); if (count) count.textContent = '';
        });
    }

    // ── Load saved data on page open ─────────────────────────────────────
    async function loadPadAC() {
        try {
            const res = await fetch('/notes/padAC/' + PAD_AC_NOTE_ID);
            if (!res.ok) return;
            const doc = await res.json();
            if (doc && doc.rows && doc.rows.length) {
                // Reconstruct lastResults from saved rows so filters/sorting work
                lastResults = doc.rows.map(cols => ({
                    subjectWell: cols[0] || '',
                    offsetName:  cols[1] || '',
                    columns: cols,
                    reason: ''
                }));
                renderBadges(lastResults, 0);
                renderTable(lastResults);
                const saved = doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '';
                setStatus(`✅ ${doc.rows.length} rows loaded (saved ${saved})`);
                padAC_el('padACCsvBtn')  && (padAC_el('padACCsvBtn').disabled  = false);
                padAC_el('padACXlsxBtn') && (padAC_el('padACXlsxBtn').disabled = false);
                padAC_el('padACDownloadBtn') && (padAC_el('padACDownloadBtn').disabled = false);
                padAC_el('padACSelectSiteBtn') && (padAC_el('padACSelectSiteBtn').disabled = false);
                padAC_el('padACLateralBtn') && (padAC_el('padACLateralBtn').disabled = false);
                padAC_el('padACDupMDBtn') && (padAC_el('padACDupMDBtn').disabled = false);
                padAC_el('padACDeleteBtn') && (padAC_el('padACDeleteBtn').disabled = false);
                if (saveBtn) saveBtn.disabled = false;
                const empty = padAC_el('padACEmpty'); if (empty) empty.style.display = 'none';
            }
        } catch(e) { console.warn('loadPadAC:', e); }
    }

    loadPadAC();
})();

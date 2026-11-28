/* MTX Conveyor — job page script 5. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 6551) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

    (function(){
        const C = window.IPlanCore;
        const api = window.wbtSceneApi;
        if(!C || !api){ console.warn('[iPlan] IPlanCore or wbtSceneApi missing — iPlan disabled'); return; }

        const WELLS = (api.WELLBORES || []).filter(w => w.survey && w.survey.length >= 2);
        const STEP = 10;                 // m between computed stations (same as QuickPlan)
        const GREEN = 0x00e676;
        const n = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
        const f = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d);
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

        let scenarios = [];   // {id, name, visible, startMode:'surface'|'tieon', wellId, tieMd, start:{md,tvd,n,e,inc,az,rkb}, sections:[], _calc, _mesh}
        let selId = null, seq = 0;
        window.IPLAN_SCENARIOS = scenarios;
        // ADDED 2026-11-09: used by the 3D view's "New target" dialog (double-click a trajectory / profile chart).
        // Same steps as "+ Blank target": push, redraw + autosave (refresh), re-render if that scenario is open.
        window.IPLAN_SELECTED_ID = () => selId;
        window.IPLAN_ADD_TARGET = function(scId, t){
            const sc = scenarios.find(x => x.id === scId); if(!sc) return false;
            if(!Array.isArray(sc.targets)) sc.targets = [];
            sc.targets.push(t);
            refresh(sc);
            if(sc.id === selId){ renderTargets(sc); renderSections(sc); updateResults(sc); }
            return true;
        };
        // ADDED 2026-11-09 (iLab, admin): create a scenario from a design {name, wellId, start, sections, targets}.
        // Same steps as the "+ New Scenario" button (POST, show it, compute/draw, select); start = surface mode.
        window.IPLAN_CREATE_SCENARIO = async function(d){
            const design = { name: d.name || ('Scenario ' + (scenarios.length + 1)), startMode: 'surface',
                wellId: d.wellId || (WELLS[0] ? String(WELLS[0]._id) : null), tieMd: 0,
                start: d.start, sections: d.sections || [], targets: d.targets || [], toolcode: null };
            const doc = await apiJson('/notes/iplan/' + NOTE_ID, 'POST', design);
            const sc = fromDoc(doc);
            sc.visible = true;
            scenarios.push(sc); selId = sc.id;
            compute(sc); draw(sc); drawTargets(sc);
            window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } }));
            setSaveStatus(sc, 'Saved ✓');
            renderList(); renderEditor();
            return sc;
        };

        // ---------- Persistence (STEP 4, ADDED 2026-10-10) ----------
        // Saved per job in MongoDB (model IPlanScenario, routes /notes/iplan/*).
        // Only the design is stored; stations are recomputed here on load.
        // Visibility is NOT stored: every saved scenario loads inactive (unticked).
        // Edits autosave ~1 s after the last change (last save wins if two people
        // edit the same scenario at once).
        const NOTE_ID = window.MTX_JOB.noteId;
        const DESIGN_KEYS = ['name','startMode','wellId','tieMd','start','sections','targets','toolcode','group']; // 'group' = iPad pad (2026-10-12)
        function designOf(sc){ const o = {}; DESIGN_KEYS.forEach(k => { o[k] = sc[k]; }); return o; }
        function setSaveStatus(sc, txt, bad){
            sc._saveStatus = txt; sc._saveBad = !!bad;
            const el = document.getElementById('iplSave');
            if(el && sc.id === selId){ el.textContent = txt; el.style.color = bad ? '#ff4c4c' : 'var(--wbt-text-dim)'; }
        }
        async function apiJson(url, method, body){
            const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
            let data = null; try { data = await r.json(); } catch(e){}
            if(!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
            return data;
        }
        function markDirty(sc){
            clearTimeout(sc._saveTimer);
            setSaveStatus(sc, 'Unsaved changes…');
            sc._saveTimer = setTimeout(async () => {
                setSaveStatus(sc, 'Saving…');
                try {
                    const doc = await apiJson('/notes/iplan/' + sc.id, 'PUT', designOf(sc));
                    sc.updatedByName = doc.updatedByName; sc.updatedAt = doc.updatedAt;
                    setSaveStatus(sc, 'Saved ✓');
                    const meta = document.getElementById('iplMeta'); if(meta && sc.id === selId) meta.innerHTML = metaText(sc);
                } catch(err){ setSaveStatus(sc, 'Not saved: ' + err.message, true); }
            }, 1000);
        }
        function metaText(sc){
            const d = v => v ? new Date(v).toLocaleString() : '—';
            return `Created by <b>${esc(sc.createdByName || '—')}</b> ${d(sc.createdAt)} &middot; last edited by <b>${esc(sc.updatedByName || '—')}</b> ${d(sc.updatedAt)}`;
        }
        function fromDoc(doc){
            return {
                id: String(doc._id), name: doc.name || 'Scenario', visible: false,
                startMode: doc.startMode || 'surface', wellId: doc.wellId, tieMd: doc.tieMd || 0,
                start: Object.assign({ md:0, tvd:0, n:0, e:0, inc:0, az:0, rkb:0 }, doc.start || {}),
                sections: doc.sections || [], targets: doc.targets || [], toolcode: doc.toolcode || null, group: doc.group || '',
                createdByName: doc.createdByName, createdAt: doc.createdAt, updatedByName: doc.updatedByName, updatedAt: doc.updatedAt,
                _calc: null, _mesh: null, _tMeshes: []
            };
        }

        function wellById(id){ return WELLS.find(w => String(w._id) === String(id)) || null; }
        function sortedSurvey(w){ return (w.survey || []).slice().sort((a,b) => n(a.md) - n(b.md)); }

        // RKB elevation of a planned well = TVD + Sub-Sea at any station
        // (Sub-Sea is stored as RKB elevation minus TVD in the survey tables).
        function wellRkb(w){
            const s = sortedSurvey(w).find(r => r.subSea !== undefined && r.subSea !== null && r.subSea !== '');
            return s ? n(s.tvd) + n(s.subSea) : 0;
        }
        // Option 1: same surface point as the selected planned well (its first station).
        function surfaceStartFromWell(w){
            const s = sortedSurvey(w)[0];
            return { md:n(s.md), tvd:n(s.tvd), n:n(s.northing), e:n(s.easting), inc:n(s.incl), az:n(s.azim), rkb:wellRkb(w) };
        }

        // ---------- Targets (STEP 2, ADDED 2026-10-10) ----------
        // Pad target catalogue: the commented stations of every planned well
        // (same comment patterns the score cards use: SurfaceCasing, KickOff,
        // IntermediateCasing, Landing) plus TD = last station. Read-only here;
        // the user copies them into a scenario's own (editable) target list.
        const TARGET_TYPES = [['SurfaceCasing','SURFACECASING'],['KickOff','KICKOFF'],['IntermediateCasing','INTERMEDIATECASING'],['Landing','LANDING']];
        const PAD_TARGETS = [];
        WELLS.forEach(w => {
            const sv = sortedSurvey(w);
            const rkb = wellRkb(w);
            const push = (type, r) => PAD_TARGETS.push({
                key: PAD_TARGETS.length, well: w.wellName, type,
                md: n(r.md), n: n(r.northing), e: n(r.easting), tvd: n(r.tvd), rkb,
                inc: n(r.incl), az: n(r.azim)   // 2026-11-06: attitude at the point (Optimum Align "Final Target" Inc / Azi)
            });
            TARGET_TYPES.forEach(([type, pat]) => {
                const r = sv.find(x => String(x.comments || '').toUpperCase().includes(pat));
                if(r) push(type, r);
            });
            push('TD', sv[sv.length - 1]);
        });

        // CHANGED 2026-10-10 (user): scenario targets are stored and edited in
        // SUB-SEA (elevation, m; Sub-Sea = RKB - TVD, same convention as the
        // survey tables), so they are datum-independent. Wherever a TVD is needed
        // (feedback, 3D, wizards, "TVD from target") it is derived with the
        // scenario's own RKB: TVD = RKB_scenario - SubSea.
        function tvdOf(sc, t){ return scenarioRkb(sc) - n(t.ss); }
        function scenarioRkb(sc){
            if(sc.startMode === 'tieon'){ const w = wellById(sc.wellId); return w ? wellRkb(w) : 0; }
            return n(sc.start.rkb);
        }

        // Live feedback — same rule as QuickPlan renderTargetFeedback(): closest
        // 3D distance from any computed station (every 10 m) to the target,
        // "within radius" if that distance <= R; plus distance from the end.
        function targetFeedback(sc, t){
            const st = sc._calc && sc._calc.stations;
            if(!st || !st.length) return null;
            let best = Infinity, bestMd = null;
            st.forEach(p => {
                const d = Math.sqrt((p.n - t.n) ** 2 + (p.e - t.e) ** 2 + (p.tvd - tvdOf(sc, t)) ** 2);
                if(d < best){ best = d; bestMd = p.md; }
            });
            const L = st[st.length - 1];
            const fin = Math.sqrt((L.n - t.n) ** 2 + (L.e - t.e) ** 2 + (L.tvd - tvdOf(sc, t)) ** 2);
            return { best, bestMd, fin, hit: best <= t.r };
        }

        // Resolve the scenario's actual start state.
        function resolveStart(sc){
            const w = wellById(sc.wellId);
            if(sc.startMode === 'tieon'){
                if(!w) return { error:'Select a planned well to tie on to.' };
                const p = C.interpolateSurveyAtMD(w.survey, n(sc.tieMd));
                if(!p){
                    const sv = sortedSurvey(w);
                    return { error:'Tie-on MD must be between ' + f(n(sv[0].md),1) + ' and ' + f(n(sv[sv.length-1].md),1) + ' m.' };
                }
                return Object.assign(p, { rkb: wellRkb(w) });
            }
            return Object.assign({}, sc.start);
        }

        function compute(sc){
            const st = resolveStart(sc);
            if(st.error){ sc._calc = { error: st.error }; return; }
            try { solveOaGroups(sc, st); } catch(e){ sc._oaErr = e.message; }   // 2026-11-06: live Optimum Align groups (Compass)
            const res = C.computeStations({ md:st.md, tvd:st.tvd, n:st.n, e:st.e, inc:st.inc, az:st.az }, sc.sections, STEP);
            res.stations.forEach(s => { s.subSea = st.rkb - s.tvd; });
            sc._calc = { start: st, stations: res.stations, sections: res.sections };
        }

        // ---------- 3D ----------
        function removeMesh(sc){
            if(sc._mesh){ api.getGroup().remove(sc._mesh); sc._mesh.geometry.dispose(); sc._mesh.material.dispose(); sc._mesh = null; }
        }
        function draw(sc){
            removeMesh(sc);
            const c = sc._calc;
            if(!sc.visible || !c || c.error || c.stations.length < 2) return;
            // Same scene axes as planned wells: X = Easting, Y = -TVD, Z = -Northing
            const pts = c.stations.map(s => new THREE.Vector3(s.e, s.subSea, -s.n));   // 2026-10-21: Sub-Sea elevation
            const mesh = api.buildWellLine(pts, GREEN);
            const k = api.getThickness(sc.id);
            const ud = mesh.userData;
            mesh.geometry.dispose();
            mesh.geometry = new THREE.TubeGeometry(ud.curve, ud.tubularSegments, ud.baseRadius * k, 6, false);
            mesh.userData.iplan = sc.id;
            mesh.userData.pickName = (sc.name || 'Scenario') + ' (scenario)';   // 2026-11-02
            mesh.userData.pick = () => ({ name: sc.name || 'Scenario', color: GREEN, rows: (sc._calc && sc._calc.stations || []).map(s0 => ({ md: s0.md, inc: s0.inc, az: s0.az, tvd: s0.tvd, ss: s0.subSea, dls: s0.dls30, n: s0.n, e: s0.e, comment: '' })),   // 2026-11-01: profile panel
                ac: () => { const A = window.acpPadApi; return A ? (A.scenarioWells().find(x => x.scenarioId === sc.id) || null) : null; } });
            api.getGroup().add(mesh);
            sc._mesh = mesh;
        }
        // Scenario targets in 3D: translucent green sphere of radius R at (E, -TVD, -N).
        function removeTargetMeshes(sc){
            (sc._tMeshes || []).forEach(m => { api.getGroup().remove(m); m.geometry.dispose(); m.material.dispose(); });
            sc._tMeshes = [];
        }
        function drawTargets(sc){
            removeTargetMeshes(sc);
            if(!sc.visible) return;
            (sc.targets || []).forEach(t => {
                const g = new THREE.SphereGeometry(Math.max(0.5, n(t.r)), 16, 12);
                const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.25, wireframe: true }));
                m.position.set(n(t.e), n(t.ss), -n(t.n));   // 2026-10-21: target Sub-Sea = elevation
                api.getGroup().add(m);
                sc._tMeshes.push(m);
            });
        }
        function refresh(sc){
            compute(sc); draw(sc); drawTargets(sc);
            markDirty(sc);   // step 4: every design change autosaves
            window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } }));
        }
        // 2026-10-11: redraw on any thickness change (group sliders or individual override)
        window.addEventListener('wbtThicknessChanged', () => scenarios.forEach(draw));

        // ---------- UI: list ----------
        function renderList(){
            const box = document.getElementById('iplList');
            box.innerHTML = '';
            if(!scenarios.length){ box.innerHTML = '<div style="color:var(--wbt-text-dim);">No scenarios yet.</div>'; }
            scenarios.forEach(sc => {
                const row = document.createElement('div');
                row.className = 'ipl-scn' + (sc.id === selId ? ' sel' : '');
                row.title = 'Created by ' + (sc.createdByName || '—') + (sc.createdAt ? ' on ' + new Date(sc.createdAt).toLocaleDateString() : '');
                row.innerHTML = `<input type="checkbox" ${sc.visible ? 'checked' : ''} title="Show in 3D">
                    <span style="width:10px;height:10px;border-radius:2px;background:#00e676;display:inline-block;"></span>
                    <span class="nm">${esc(sc.name)}</span>${sc.group ? `<span style="font-size:9px;color:var(--wbt-text-dim);border:1px solid var(--wbt-border);border-radius:2px;padding:0 3px;" title="iPad pad group">${esc(sc.group)}</span>` : ''}
                    <button type="button" class="wbt-btn" style="padding:1px 6px;" title="Delete">&times;</button>`;
                const [cb] = row.getElementsByTagName('input');
                const del = row.querySelector('button');
                cb.addEventListener('click', e => {
                    e.stopPropagation(); sc.visible = cb.checked; draw(sc); drawTargets(sc);
                    // 2026-10-10: hidden scenarios also leave the Anti-collision Plots
                    window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } }));
                });
                del.addEventListener('click', async e => {
                    e.stopPropagation();
                    if(!confirm('Delete scenario "' + sc.name + '" for everyone on this job?')) return;
                    try { await apiJson('/notes/iplan/' + sc.id, 'DELETE'); }
                    catch(err){ alert('Could not delete: ' + err.message); return; }
                    clearTimeout(sc._saveTimer);
                    removeMesh(sc); removeTargetMeshes(sc);
                    scenarios.splice(scenarios.indexOf(sc), 1);
                    if(selId === sc.id) selId = scenarios.length ? scenarios[0].id : null;
                    window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id, deleted: true } }));
                    renderList(); renderEditor();
                });
                row.addEventListener('click', () => { selId = sc.id; renderList(); renderEditor(); });
                box.appendChild(row);
            });
            document.getElementById('iplHeadInfo').textContent = scenarios.length + ' scenario(s)';
        }

        // ---------- UI: editor ----------
        function wellOptions(selected){
            return WELLS.map(w => `<option value="${esc(w._id)}" ${String(w._id) === String(selected) ? 'selected' : ''}>${esc(w.wellName)}</option>`).join('');
        }
        function numInput(id, val, step){ return `<input type="number" id="${id}" step="${step || 0.1}" value="${val}">`; }

        function renderEditor(){
            const ed = document.getElementById('iplEditor');
            const sc = scenarios.find(s => s.id === selId);
            if(!sc){ ed.innerHTML = '<div style="color:var(--wbt-text-dim);">Create or select a scenario.</div>';
                const gb = document.getElementById('iplGridBox'), pb = document.getElementById('iplPmBox'); if(gb) gb.innerHTML = '<div style="color:var(--wbt-text-dim);">Select a scenario.</div>'; if(pb) pb.innerHTML = ''; return; }
            const s0 = sc.start;
            ed.innerHTML = `<div class="ipl-ed-wrap"><div class="ipl-ed-left">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="color:var(--wbt-text-dim);">Name</label>
                    <input type="text" id="iplName" value="${esc(sc.name)}" style="width:220px;">
                    <button type="button" class="wbt-btn" id="iplCsv">&#11015; Download CSV</button>
                    <span id="iplSave" style="font-size:11px;color:${sc._saveBad ? '#ff4c4c' : 'var(--wbt-text-dim)'};">${esc(sc._saveStatus || '')}</span>
                </div>
                <div id="iplMeta" style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">${metaText(sc)}</div>
                <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="color:var(--wbt-text-dim);">AC toolcode</label>
                    <select id="iplToolcode">${toolcodeOptions(sc)}</select>
                    <span style="font-size:10px;color:var(--wbt-text-dim);">Used in Anti-collision Plots (green dotted). Visible scenarios are offsets for every reference well and can be picked as the reference well there.</span>
                </div>
                <div class="ipl-h">Start point</div>
                <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
                    <label><input type="radio" name="iplMode" value="surface" ${sc.startMode === 'surface' ? 'checked' : ''}> Surface of planned well (editable)</label>
                    <label><input type="radio" name="iplMode" value="tieon" ${sc.startMode === 'tieon' ? 'checked' : ''}> Tie-on at MD of planned well</label>
                </div>
                <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="color:var(--wbt-text-dim);">Planned well</label>
                    <select id="iplWell" style="max-width:320px;">${wellOptions(sc.wellId)}</select>
                    ${sc.startMode === 'surface'
                        ? '<button type="button" class="wbt-btn" id="iplReload" title="Copy the surface of the selected planned well again">&#8634; Reload from well</button>'
                        : `<label style="color:var(--wbt-text-dim);">Tie-on MD (m)</label>${numInput('iplTieMd', sc.tieMd, 1)}`}
                </div>
                ${sc.startMode === 'surface' ? `
                <div class="ipl-grid">
                    <label>Northing</label>${numInput('iplN', s0.n, 0.01)}
                    <label>Easting</label>${numInput('iplE', s0.e, 0.01)}
                    <label>RKB elev. (m)</label>${numInput('iplRkb', s0.rkb, 0.01)}
                    <label>MD (m)</label>${numInput('iplMd', s0.md, 0.1)}
                    <label>TVD (m)</label>${numInput('iplTvd', s0.tvd, 0.1)}
                    <label>Inc (°)</label>${numInput('iplInc', s0.inc, 0.1)}
                    <label>Az (°)</label>${numInput('iplAz', s0.az, 0.1)}
                </div>` : `<div class="ipl-sum" id="iplTieInfo"></div>`}
                <div class="ipl-h">Targets</div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
                    <select id="iplPadTarget" style="max-width:420px;">
                        <option value="">Add target from pad wells…</option>
                        ${padTargetOptions()}
                    </select>
                    <button type="button" class="wbt-btn" id="iplBlankTarget">+ Blank target</button>
                </div>
                <div id="iplTargets"></div>
                <div class="ipl-h">Sections</div>
                <div id="iplSections"></div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="wbt-btn" id="iplAddSec">+ Add Section</button>
                    <button type="button" class="wbt-btn" data-wiz="bh">&#127919; Build &amp; Hold to Target</button>
                    <button type="button" class="wbt-btn" data-wiz="hbhbh">&#127919; Build-Hold-Build-Hold to Target</button>
                    <button type="button" class="wbt-btn" data-wiz="chc">&#127919; Curve-Hold-Curve to Target</button>
                    <button type="button" class="wbt-btn" id="iplTanBtn">&#128207; Insert Tangent</button>
                    ${(sc._undo && sc._undo.length) ? '<button type="button" class="wbt-btn" id="iplUndo" title="Undo the last wizard on this scenario (this session only)">&#8630; Undo last wizard</button>' : ''}
                </div>
                <div id="iplWiz"></div>
                <div class="ipl-sum" id="iplSummary"></div></div></div>`;

            document.getElementById('iplName').addEventListener('input', e => { sc.name = e.target.value; renderListNamesOnly(); markDirty(sc); window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } })); });
            document.getElementById('iplToolcode').addEventListener('change', e => {
                sc.toolcode = e.target.value || null;   // '' = inherit from the planned well
                markDirty(sc);
                window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } }));
            });
            ed.querySelectorAll('input[name=iplMode]').forEach(r => r.addEventListener('change', e => {
                sc.startMode = e.target.value;
                if(sc.startMode === 'tieon' && !(sc.tieMd > 0)){
                    const w = wellById(sc.wellId); const sv = w ? sortedSurvey(w) : [];
                    if(sv.length) sc.tieMd = Math.round(n(sv[Math.floor(sv.length / 2)].md));
                }
                refresh(sc); renderEditor();
            }));
            document.getElementById('iplWell').addEventListener('change', e => {
                sc.wellId = e.target.value;
                if(sc.startMode === 'surface'){ const w = wellById(sc.wellId); if(w) sc.start = surfaceStartFromWell(w); }
                refresh(sc); renderEditor();
            });
            if(sc.startMode === 'surface'){
                document.getElementById('iplReload').addEventListener('click', () => {
                    const w = wellById(sc.wellId); if(w) sc.start = surfaceStartFromWell(w);
                    refresh(sc); renderEditor();
                });
                [['iplN','n'],['iplE','e'],['iplRkb','rkb'],['iplMd','md'],['iplTvd','tvd'],['iplInc','inc'],['iplAz','az']].forEach(([id, key]) => {
                    document.getElementById(id).addEventListener('input', e => { sc.start[key] = n(e.target.value); refresh(sc); updateResults(sc); });
                });
            } else {
                document.getElementById('iplTieMd').addEventListener('input', e => { sc.tieMd = n(e.target.value); refresh(sc); updateResults(sc); });
            }
            document.getElementById('iplAddSec').addEventListener('click', () => {
                sc.sections.push(defaultSection(sc.sections.length ? 'hold' : 'dlstf'));
                refresh(sc); renderSections(sc); updateResults(sc);
            });
            document.getElementById('iplCsv').addEventListener('click', () => downloadCsv(sc));
            document.getElementById('iplPadTarget').addEventListener('change', e => {
                const pt = PAD_TARGETS[parseInt(e.target.value, 10)];
                if(!pt) return;
                sc.targets.push({ name: pt.well + ' ' + pt.type, n: pt.n, e: pt.e, ss: Math.round((pt.rkb - pt.tvd) * 100) / 100, r: 15, inc: pt.inc, az: pt.az });   // 2026-11-06: + inc/az
                e.target.value = '';
                refresh(sc); renderTargets(sc); renderSections(sc); updateResults(sc);
            });
            document.getElementById('iplBlankTarget').addEventListener('click', () => {
                const st = sc._calc && sc._calc.stations; const L = st && st.length ? st[st.length - 1] : sc.start;
                sc.targets.push({ name: 'Target ' + (sc.targets.length + 1), n: n(L.n), e: n(L.e), ss: Math.round((scenarioRkb(sc) - n(L.tvd)) * 100) / 100, r: 15 });
                refresh(sc); renderTargets(sc); renderSections(sc); updateResults(sc);
            });
            ed.querySelectorAll('[data-wiz]').forEach(b => b.addEventListener('click', () => openWizard(sc, b.dataset.wiz)));
            document.getElementById('iplTanBtn').addEventListener('click', () => openTangentWizard(sc));
            const undoBtn = document.getElementById('iplUndo');
            if(undoBtn) undoBtn.addEventListener('click', () => {
                const prev = sc._undo.pop(); if(!prev) return;
                sc.sections = prev; refresh(sc); renderEditor();
            });
            renderTargets(sc);
            renderSections(sc);
            renderPlanMethods(sc);   // 2026-11-06
            updateResults(sc);
        }

        // ================= ADDED 2026-11-06 (John): Compass-style plan grid + Planning Methods =================
        // One row per SECTION END (row 0 = start / tie-on), the same sections as the list on the left (one data
        // model: editing either updates both). White cells = the inputs of that row's method (C.KIND_FIELDS of its
        // kind), grey = computed by IPlanCore.computeStations (minimum curvature, Bourgoyne Eqs. 8.33-8.37, as before).
        // Edit a white cell + Enter/Tab -> that row and everything below recalculate; Enter / arrows move down / up.
        // NS / EW are relative to the planned well's surface (or the start point when not available).
        // V.Sec = NS cos(VSaz) + EW sin(VSaz); VS azimuth default = start -> last target, else the final azimuth.
        // T.Face: the input TF for DLS+TF rows; for other rows the toolface of the section's arc from its start to
        // its end attitude: TF = atan2(sin I2 sin dA, sin I2 cos I1 cos dA - cos I2 sin I1) (direction of the end
        // tangent seen from the start tangent, measured from high side; = end azimuth when the start is vertical).
        const GRID_COLS = [['md','MD<br>(m)'],['cl','CL<br>(m)'],['inc','Inc<br>(°)'],['az','Azi<br>(°)'],['tvd','TVD<br>(m)'],['dtvd','DTVD<br>(m)'],['tvdss','TVDSS<br>(m)'],
            ['ns','NS<br>(m)'],['ew','EW<br>(m)'],['n','Northing<br>(m)'],['e','Easting<br>(m)'],['vs','V.Sec<br>(m)'],['dls','Dogleg<br>(°/30m)'],['tf','T.Face<br>(°)']];
        const GRID_IN = {   // column -> section parameter, per kind
            direct:{cl:'cl',inc:'inc',az:'az'}, hold:{cl:'cl'}, dlstf:{cl:'cl',dls:'dls',tf:'tf'},
            dlstf_inc:{inc:'targetInc',dls:'dls',tf:'tf'}, dlstf_az:{az:'targetAz',dls:'dls',tf:'tf'}, dlstf_tvd:{tvd:'targetTvd',dls:'dls',tf:'tf'},
            md_inc_az:{md:'targetMd',inc:'inc',az:'az'}, tvd_inc_az:{tvd:'targetTvd',inc:'inc',az:'az'}, dls_inc_az:{inc:'inc',az:'az',dls:'dls'},
            hold_tvd:{tvd:'targetTvd'}, build_turn_cl:{cl:'cl'}, tvd_dls_az:{tvd:'targetTvd',az:'targetAz',dls:'dls'}
        };
        const gridSel = {};   // scenario id -> selected section index (insert after it)
        // ADDED 2026-11-06 (John): display precision (default 2 decimals everywhere; values are kept at full precision,
        // only shown rounded — an input is applied only if you change what is shown). Settings ⚙ above the grid,
        // remembered in this browser. Units (m / ft) not yet — planned in the same Settings.
        const GRID_DEC = Object.assign({ len: 2, ang: 2, dls: 2, coord: 2 }, (() => { try { return JSON.parse(localStorage.getItem('mtxGridDec') || '{}'); } catch(e){ return {}; } })());
        const GRID_DEC_OF = { md:'len', cl:'len', tvd:'len', dtvd:'len', tvdss:'len', ns:'len', ew:'len', vs:'len', n:'coord', e:'coord', inc:'ang', az:'ang', tf:'ang', dls:'dls' };
        function gridToolface(i1, a1, i2, a2){
            if(Math.abs(i1 - i2) < 1e-9 && Math.abs(((a2 - a1 + 540) % 360) - 180) < 1e-9) return 0;
            const I1 = i1 * Math.PI / 180, I2 = i2 * Math.PI / 180, dA = (a2 - a1) * Math.PI / 180;
            let t = Math.atan2(Math.sin(I2) * Math.sin(dA), Math.sin(I2) * Math.cos(I1) * Math.cos(dA) - Math.cos(I2) * Math.sin(I1)) * 180 / Math.PI;
            return t;
        }
        function gridRows(sc){
            const c = sc._calc; if(!c || c.error || !c.stations || !c.stations.length) return null;
            const st = c.stations, rkb = scenarioRkb(sc), s0 = st[0];
            const w = wellById(sc.wellId), sv = w ? sortedSurvey(w) : [], o = sv.length ? { n: n(sv[0].northing), e: n(sv[0].easting) } : { n: s0.n, e: s0.e };
            const lastT = sc.targets.length ? sc.targets[sc.targets.length - 1] : null, L = st[st.length - 1];
            let vsAz = sc.vsAz;
            if(vsAz == null || vsAz === ''){ vsAz = lastT ? (Math.atan2(n(lastT.e) - o.e, n(lastT.n) - o.n) * 180 / Math.PI + 360) % 360 : L.az; }
            const mk = (p, extra) => { const ns = p.n - o.n, ew = p.e - o.e, va = vsAz * Math.PI / 180;
                return Object.assign({ md: p.md, inc: p.inc, az: p.az, tvd: p.tvd, tvdss: -(rkb - p.tvd), ns, ew, n: p.n, e: p.e, vs: ns * Math.cos(va) + ew * Math.sin(va) }, extra); };
            const rows = [mk(s0, { i: -1, cl: null, dtvd: null, dls: 0, tf: 0 })];
            let prev = s0;
            sc.sections.forEach((sec, i) => {
                const pts = st.filter(p => p.section === i + 1), end = pts.length ? pts[pts.length - 1] : prev, r = (c.sections || [])[i] || {};
                // 2026-11-06: rows of an Optimum Align group (see solveOaGroups)
                const dls = pts.length ? pts[pts.length - 1].dls30 : 0;
                const tf = (sec.tf !== undefined) ? n(sec.tf) : (dls > 1e-6 ? gridToolface(prev.inc, prev.az, end.inc, end.az) : 0);
                const tgt = sc.targets.find(t => Math.hypot(end.n - n(t.n), end.e - n(t.e), (rkb - end.tvd) - n(t.ss)) <= (n(t.r) || 0));
                rows.push(mk(end, { i, cl: end.md - prev.md, dtvd: end.tvd - prev.tvd, dls, tf, kind: sec.kind, warn: r.warning || '', target: tgt ? tgt.name : '' }));
                prev = end;
            });
            return { rows, vsAz };
        }
        function renderGrid(sc){
            const box = document.getElementById('iplGridBox'); if(!box) return;
            const G = gridRows(sc), c = sc._calc || {};
            if(!G){ box.innerHTML = `<div style="color:${c.error ? '#ff4c4c' : 'var(--wbt-text-dim)'};">${esc(c.error || 'No stations yet.')}</div>`; return; }
            const maxD = (() => { const el = document.getElementById('ipdMaxDls'); return 10; })(), sel = gridSel[sc.id];
            const fmt = (k, v) => v == null || v === '' || !isFinite(v) ? '' : (+v).toFixed(GRID_DEC[GRID_DEC_OF[k] || 'len']);
            let h = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px;font-size:11px;">
                <span>V.Sec azimuth (°)</span><input type="number" step="0.1" id="iplVsAz" value="${sc.vsAz != null && sc.vsAz !== '' ? sc.vsAz : ''}" placeholder="${(+G.vsAz).toFixed(2)} (auto)" style="width:110px;">
                <button type="button" class="wbt-btn" id="iplGridSet" style="padding:1px 8px;" title="Settings: decimal places">&#9881; Settings</button>
                <span style="color:var(--wbt-text-dim);">White = inputs of the row's method (Enter to apply) · click a row # to insert the next method after it</span></div>
                <div id="iplGridSetBox" style="display:${window.__iplGridSetOpen ? 'flex' : 'none'};gap:10px;flex-wrap:wrap;align-items:center;font-size:11px;margin-bottom:4px;border:1px solid var(--wbt-border);border-radius:3px;padding:4px 6px;">
                    <b>Decimal places</b>${[['len','Depths / lengths (MD, TVD, NS, EW, V.Sec)'],['coord','Northing / Easting'],['ang','Inc / Azi / T.Face'],['dls','Dogleg']].map(([k, l]) => `<span>${l} <input type="number" min="0" max="6" step="1" data-gdec="${k}" value="${GRID_DEC[k]}" style="width:50px;"></span>`).join('')}
                    <span style="color:var(--wbt-text-dim);">Units (m / ft): coming here next.</span></div>
                <div style="max-height:520px;overflow:auto;"><table class="ipl-grid-tbl"><tr><th>#</th>${GRID_COLS.map(c0 => `<th>${c0[1]}</th>`).join('')}<th>Method</th><th>Target</th><th></th></tr>`;
            G.rows.forEach((r, ri) => {
                const sec = r.i >= 0 ? sc.sections[r.i] : null;
                // 2026-11-06: Optimum Align groups — align rows are solved (no white cells; edit in the panel), Project Back
                // rows show their own inputs (CL / TVD / Inc / Azi + Dogleg = the chain item's DLS)
                const head = sec && sec.oaG ? oaGroupHead(sc, sec.oaG) : null, pb = head && sec.oaPart === 'pb' ? (head.oaDef.back || [])[sec.oaPb] : null;
                const map = !sec || sec.thG ? {} : head ? (pb ? ({ cl:{cl:'cl',dls:'dls'}, tvd:{tvd:'tvd',dls:'dls'}, inc:{inc:'inc',dls:'dls'}, incazi:{inc:'inc',az:'az',dls:'dls'} }[pb.mode] || {}) : {}) : (GRID_IN[sec.kind] || {});
                const src = pb || sec;
                h += `<tr class="${sel === r.i && r.i >= 0 ? 'sel' : ''}"><td class="rn" data-gsel="${r.i}" title="Select: the next Planning Method is inserted after this row">${ri + 1}</td>` + GRID_COLS.map(([k]) => {
                    if(map[k]) return `<td class="in"><input data-gi="${r.i}" data-gk="${map[k]}" data-gc="${k}" ${pb ? 'data-gpb="1"' : ''} value="${esc(fmt(k, src[map[k]]))}" data-shown="${esc(fmt(k, src[map[k]]))}" title="${esc(String(src[map[k]]))}"></td>`;
                    const bad = (k === 'dls' && r.dls > 10 + 1e-9) ? ' bad' : '';
                    return `<td class="${bad}">${fmt(k, r[k])}</td>`;
                }).join('') + `<td style="color:${head || (sec && sec.thG) ? '#ffd060' : 'var(--wbt-text-dim)'};" title="${esc(r.warn || '')}">${sec ? (head ? (pb ? 'Project Back · ' + PB_LABEL(pb) : sec.oaPart === 'ah' ? 'Hold to ' + esc((head.oaDef.alignOn || {}).name || '') : 'Optimum Align') : sec.thG ? 'Thread · ' + esc((TH_METHODS.find(m => m[0] === ((sc.sections.find(x => x.thG === sec.thG && x.thDef) || {}).thDef || {}).method) || ['', ''])[1]) : esc(C.KIND_LABEL[sec.kind] || sec.kind)) + (r.warn ? ' <span style="color:#ff4c4c;">&#9888;</span>' : '') : (sc.startMode === 'tieon' ? 'Tie-on' : 'Start')}</td>
                    <td class="tg">${esc((sec && sec.thT) || (sec && sec.oaPart === 'ah' && head ? (head.oaDef.alignOn || {}).name : '') || r.target || '')}</td><td>${sec ? `<button type="button" class="wbt-btn" data-gdel="${r.i}" style="padding:0 5px;" title="Delete this row (section)">&times;</button>` : ''}</td></tr>`;
            });
            h += '</table></div>';
            box.innerHTML = h;
            document.getElementById('iplGridSet').addEventListener('click', () => { window.__iplGridSetOpen = !window.__iplGridSetOpen; renderGrid(sc); });
            box.querySelectorAll('[data-gdec]').forEach(inp => inp.addEventListener('change', e => { GRID_DEC[e.target.dataset.gdec] = Math.max(0, Math.min(6, Math.round(n(e.target.value))));
                try { localStorage.setItem('mtxGridDec', JSON.stringify(GRID_DEC)); } catch(err){} renderGrid(sc); }));
            const vs = document.getElementById('iplVsAz');
            vs.addEventListener('change', e => { sc.vsAz = e.target.value === '' ? null : n(e.target.value); markDirty(sc); renderGrid(sc); });
            box.querySelectorAll('[data-gsel]').forEach(td => td.addEventListener('click', () => { const i = +td.dataset.gsel; gridSel[sc.id] = (gridSel[sc.id] === i || i < 0) ? undefined : i;
                const s1 = sc.sections[gridSel[sc.id]];   // 2026-11-06: a row of an Optimum Align group opens it in the panel
                if(s1 && s1.oaG && oaGroupHead(sc, s1.oaG)){ pmState.m = 'oa'; oaLoad(sc, s1.oaG); } else oaState.editG = null;
                renderGrid(sc); renderPlanMethods(sc); }));
            box.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', () => { const k = +b.dataset.gdel, s1 = sc.sections[k];
                if(s1 && s1.oaG){ const h = oaGroupHead(sc, s1.oaG);   // 2026-11-06: Project Back row -> remove that chain item; align row -> remove the whole group
                    if(h && s1.oaPart === 'pb'){ h.oaDef.back.splice(s1.oaPb, 1); }
                    else if(h && s1.oaPart === 'ah'){ h.oaDef.alignOn = null; }   // 2026-11-06: delete the Align-on hold -> Freehand (Inc / Azi kept)
                    else { const g = s1.oaG; sc.sections = sc.sections.filter(x => x.oaG !== g); } }
                else if(s1 && s1.thG){ const g = s1.thG; sc.sections = sc.sections.filter(x => x.thG !== g); }   // 2026-11-06: Thread group -> remove it whole
                else sc.sections.splice(k, 1);
                gridSel[sc.id] = undefined; oaState.editG = null; refresh(sc); renderEditor(); }));
            const inputs = [...box.querySelectorAll('input[data-gi]')];
            inputs.forEach(inp => {
                const apply = () => { let sec = sc.sections[+inp.dataset.gi]; if(!sec) return; if(inp.value === inp.dataset.shown) return false;   // unchanged display -> keep full precision
                    if(inp.dataset.gpb){ const h = oaGroupHead(sc, sec.oaG); sec = h && h.oaDef.back[sec.oaPb]; if(!sec) return false; }   // 2026-11-06: Project Back item value
                    const v = n(inp.value); if(String(sec[inp.dataset.gk]) === String(v)) return false; sec[inp.dataset.gk] = v; return true; };
                const go = dir => {   // same column, next / previous input row
                    const col = inp.dataset.gc, gi = +inp.dataset.gi;
                    const same = [...document.querySelectorAll('#iplGridBox input[data-gc="' + col + '"]')], k = same.findIndex(x => +x.dataset.gi === gi);
                    const nx = same[k + dir]; if(nx){ nx.focus(); nx.select(); }
                };
                inp.addEventListener('keydown', e => {
                    if(e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp'){
                        e.preventDefault(); const dir = e.key === 'ArrowUp' ? -1 : 1, col = inp.dataset.gc, gi = +inp.dataset.gi;
                        if(apply()){ refresh(sc); renderSections(sc); updateResults(sc);
                            const same = [...document.querySelectorAll('#iplGridBox input[data-gc="' + col + '"]')], k = same.findIndex(x => +x.dataset.gi === gi);
                            const nx = same[k + dir] || same[k]; if(nx){ nx.focus(); nx.select(); } }
                        else go(dir);
                    }
                });
                inp.addEventListener('change', () => { if(apply()){ refresh(sc); renderSections(sc); updateResults(sc); } });
                inp.addEventListener('focus', () => inp.select());
            });
        }
        // Planning Methods (Compass layout): each method adds section(s) of the existing kinds after the selected row
        // (or at the end). Slant / S Well / Optimum Align open the existing target wizards (Build & Hold, BHBH, CHC).
        const PM = {
            dt:   { label: 'Dogleg Toolface', subs: [['dlstf','DLS, TF, CL'],['dlstf_inc','DLS, TF, until Inc'],['dlstf_az','DLS, TF, until Azi'],['dlstf_tvd','DLS, TF, until TVD']] },
            curve:{ label: 'Curve', subs: [['md_inc_az','MD, INC, AZI'],['tvd_inc_az','TVD, INC, AZI'],['dls_inc_az','DLS, INC, AZI'],['tvd_dls_az','TVD, DLS, AZI'],['direct','INC, AZI, CL']] },
            hold: { label: 'Hold', subs: [['hold','CL'],['hold_tvd','to TVD'],['hold_md','to MD']] },
            bt:   { label: 'Build Turn', subs: [['build_turn_cl','Build, Turn, CL']] },
            nudge:{ label: 'Nudge', subs: [['nudge','Build, Hold, Drop']] },
            slant:{ label: 'Slant (to target)', wiz: 'bh' }, swell:{ label: 'S Well (to target)', wiz: 'hbhbh' }, oa:{ label: 'Optimum Align', oa: true },
            th:{ label: 'Thread Targets', th: true }   // 2026-11-06 (John: Compass "Thread Targets")
        };
        const pmState = { m: 'dt', sub: 'dlstf', v: {} };
        // ADDED 2026-11-06 (John: Compass "Optimum Align" — Type Curve-Hold-Curve / Curve-Curve; Doglegs 1,2 or
        // Tangent Length; Final Target = a scenario target or freehand TVD / N/S / E/W (relative to the planned well's
        // surface, like the grid NS / EW) + final Inc and Azi). Solver: IPlanCore.planOptimumAlign (see its comment).
        // CHANGED 2026-11-06 (John): Final Target lists the scenario targets AND the pad wells' points (ICP, TD,
        // comment points of every planned well) and fills TVD, Sub-Sea, N/S, E/W, Inc, Azi; Sub-Sea shown and
        // editable (TVD = scenario RKB - Sub-Sea, same convention as the targets table).
        const oaState = { type: 'chc', mode: 'dls', dls1: 6, dls2: 6, L: 30, tgt: '', tvd: 0, ss: 0, ns: 0, ew: 0, inc: 90, az: 0 };
        function gridOrigin(sc){ const w = wellById(sc.wellId), sv = w ? sortedSurvey(w) : []; const c = sc._calc, s0 = c && c.stations && c.stations[0];
            return sv.length ? { n: n(sv[0].northing), e: n(sv[0].easting) } : { n: s0 ? s0.n : 0, e: s0 ? s0.e : 0 }; }
        // CHANGED 2026-11-06 (John's Compass clip "how to use optimum align 1.mp4"): an Optimum Align is a LIVE GROUP,
        // like in Compass — its definition (oaDef on the group's first section: type / mode / doglegs / TVDs / tangent,
        // final target {n, e, ss, inc, az} and the Project Back chain) is stored with the sections, and the group is
        // re-solved on every recalculation (solveOaGroups, called by compute): editing anything above it, or a Project
        // Back value, re-solves the align. Project Back items chain ("nest"): from the target backwards, each item is
        // one curve (or, CL with DLS 0, a hold) — e.g. the clip: hold 10 m to the ICP, then a DLS 6 curve back to
        // 80° / 310°, then a 30 m hold; the align lands on the start of the chain. Sections of a group carry oaG (group
        // id), oaPart ('oa' = the align, 'pb' = a projected-back piece) and oaPb (chain index).
        Object.assign(oaState, { ccMode: 'eq', tvd1: 0, tvd2: 0, last: null, chain: [], nb: { mode: 'cl', cl: 10, tvd: 0, inc: 90, az: 0, dls: 0 }, editG: null, tname: '', al: '', alPt: null });
        // ADDED 2026-11-06 (John's Compass clip, 0:12-0:26): "Align on" — picking a second point (there: 148514 TD)
        // sets the Final Target Inc / Azi to the direction of the straight line Final Target -> that point
        // (Compass showed Inc 89.76, Azi 316.27 for ICP -> TD); typing an Inc / Azi by hand returns it to
        // "No Target (Freehand)", as in Compass. Pure geometry: Azi = atan2(dE, dN), Inc = atan2(horizontal, dTVD).
        // Stored as oaDef.alignOn {name, n, e, ss}; re-applied on every re-solve, so if the target moves, the
        // alignment follows.
        function oaAlignDir(T, P, rkb){   // T, P: {n, e, ss} -> {inc, az} or null (same point)
            const dN = n(P.n) - n(T.n), dE = n(P.e) - n(T.e), dV = (rkb - n(P.ss)) - (rkb - n(T.ss)), h = Math.hypot(dN, dE);
            if(h < 1e-6 && Math.abs(dV) < 1e-6) return null;
            return { inc: Math.atan2(h, dV) * 180 / Math.PI, az: ((Math.atan2(dE, dN) * 180 / Math.PI) % 360 + 360) % 360 };
        }
        function oaPoint(sc, key){   // 's:i' / 'p:k' -> {name, n, e, ss, inc, az}
            if(!key) return null;
            if(key.startsWith('s:')){ const t = sc.targets[+key.slice(2)]; return t ? { name: t.name, n: n(t.n), e: n(t.e), ss: n(t.ss), inc: t.inc, az: t.az, r: n(t.r) } : null; }
            if(key.startsWith('p:')){ const t = PAD_TARGETS[+key.slice(2)]; return t ? { name: t.well + ' ' + t.type, n: t.n, e: t.e, ss: t.rkb - t.tvd, inc: t.inc, az: t.az } : null; }
            return null;
        }
        function oaApplyAlign(sc){   // panel: re-derive Inc / Azi from Final Target + Align on point
            const O = oaState; if(!O.alPt) return; const o0 = gridOrigin(sc);
            const d = oaAlignDir({ n: o0.n + O.ns, e: o0.e + O.ew, ss: O.ss }, O.alPt, scenarioRkb(sc));
            if(d){ O.inc = +d.inc.toFixed(2); O.az = +d.az.toFixed(2); }
        }
        function oaGroupHead(sc, gid){ return sc.sections.find(x => x.oaG === gid && x.oaDef); }
        function solveOaGroups(sc, st){
            const secs = sc.sections; sc._oaErr = null; let i = 0;
            while(i < secs.length){
                const h = secs[i];
                if(h.thDef){   // 2026-11-06: live Thread Targets group (thBuild)
                    const tg = h.thG; let j = i + 1; while(j < secs.length && secs[j].thG === tg && !secs[j].thDef) j++;
                    const pre = C.computeStations({ md:st.md, tvd:st.tvd, n:st.n, e:st.e, inc:st.inc, az:st.az }, secs.slice(0, i), 1e6).stations;
                    const r = thBuild(sc, h.thDef, pre[pre.length - 1], tg);
                    if(r.error){ sc._oaErr = 'Thread Targets: ' + r.error; i = j; continue; }
                    secs.splice(i, j - i, ...r.sections); i += r.sections.length; continue;
                }
                if(!h.oaDef){ i++; continue; }
                const gid = h.oaG; let j = i + 1; while(j < secs.length && secs[j].oaG === gid && !secs[j].oaDef) j++;
                const pre = C.computeStations({ md:st.md, tvd:st.tvd, n:st.n, e:st.e, inc:st.inc, az:st.az }, secs.slice(0, i), 1e6).stations, end = pre[pre.length - 1];
                const r = oaBuild(sc, h.oaDef, end, gid);
                if(r.error){ sc._oaErr = 'Optimum Align: ' + r.error; i = j; continue; }
                secs.splice(i, j - i, ...r.sections); i += r.sections.length;
            }
        }
        function oaBuild(sc, D, end, gid){
            const rkb = scenarioRkb(sc); if(D.alignOn){ const d = oaAlignDir(D.target, D.alignOn, rkb); if(d){ D.target.inc = d.inc; D.target.az = d.az; } }   // "Align on" (see oaAlignDir)
            let T = { n: n(D.target.n), e: n(D.target.e), tvd: rkb - n(D.target.ss) }, inc = n(D.target.inc), az = n(D.target.az); const back = [];
            for(let k = 0; k < (D.back || []).length; k++){
                const pr = C.projectBack(T, inc, az, D.back[k]); if(pr.error) return { error: 'Project Back #' + (k + 1) + ': ' + pr.error };
                back.push({ sec: pr.sec, k, cl: pr.cl, P: pr.P }); T = { n: pr.P.n, e: pr.P.e, tvd: pr.P.tvd }; inc = pr.P.inc; az = pr.P.az;
            }
            const r = C.planOptimumAlign({ md: end.md, tvd: end.tvd, n: end.n, e: end.e, inc: end.inc, az: end.az }, T, inc, az,
                { type: D.type, mode: D.type === 'cc' ? D.ccMode : D.mode, dls1: D.dls1, dls2: D.dls2, L: D.L, tvd1: D.tvd1, tvd2: D.tvd2 });
            if(r.error) return r;
            const out = r.sections.map(x => Object.assign(x, { oaG: gid, oaPart: 'oa' }));
            if(!out.length) out.push({ kind: 'hold', cl: 0, oaG: gid, oaPart: 'oa' });
            for(let k = back.length - 1; k >= 0; k--) out.push(Object.assign({}, back[k].sec || { kind: 'hold', cl: 0 }, { oaG: gid, oaPart: 'pb', oaPb: back[k].k }));
            // ADDED 2026-11-06 (COMPASS Training Manual 2003.5 p.183: "Line up on target ... This target is remembered in
            // the plan, and a hold is computed between the two targets"): with Align on, a hold from the Final Target to
            // that point (the arrival direction already points at it, oaAlignDir).
            if(D.alignOn){ const A = D.alignOn, L = Math.hypot(n(A.n) - n(D.target.n), n(A.e) - n(D.target.e), n(A.ss) - n(D.target.ss));
                if(L > 1e-6) out.push({ kind: 'hold', cl: L, oaG: gid, oaPart: 'ah' }); }
            D.last = r.solved; out[0].oaDef = D;
            return { sections: out };
        }
        function oaLoad(sc, gid){   // selected group -> panel
            const h = oaGroupHead(sc, gid); if(!h) return; const D = h.oaDef, O = oaState, o0 = gridOrigin(sc), rkb = scenarioRkb(sc);
            Object.assign(O, { type: D.type, mode: D.mode, ccMode: D.ccMode || 'eq', dls1: D.dls1, dls2: D.dls2, L: D.L, tvd1: D.tvd1, tvd2: D.tvd2, last: D.last || null,
                chain: JSON.parse(JSON.stringify(D.back || [])), editG: gid, tname: D.target.name || '', tgt: '',
                ss: +n(D.target.ss).toFixed(2), tvd: +(rkb - n(D.target.ss)).toFixed(2), ns: +(n(D.target.n) - o0.n).toFixed(2), ew: +(n(D.target.e) - o0.e).toFixed(2), inc: n(D.target.inc), az: n(D.target.az), al: '', alPt: D.alignOn || null });
        }
        const PB_LABEL = b => b.mode === 'cl' ? `CL ${f(b.cl,2)} m` : b.mode === 'tvd' ? `TVD ${f(b.tvd,2)}` : b.mode === 'inc' ? `Inc ${f(b.inc,2)}°` : `Inc/Azi ${f(b.inc,2)}° / ${f(b.az,2)}°`;
        function oaHtml(sc){
            const O = oaState, NB = O.nb, S = O.last || {}, num = (k, v, w, dis) => `<input type="number" step="0.1" data-oa="${k}" value="${v}" style="width:${w || 80}px;${dis ? 'opacity:.55;' : ''}" ${dis ? 'title="solved (last Calculate)"' : ''}>`;
            const sv = (k, v) => (S[k] != null && isFinite(S[k])) ? (+S[k]).toFixed(2) : v, chc = O.type === 'chc';
            return `${O.editG ? `<div style="margin-top:4px;color:#ffd060;">Editing the selected Optimum Align — Calculate updates it (it re-solves by itself when anything above changes). <button type="button" class="wbt-btn" id="iplOaNew" style="padding:0 6px;">New one instead</button></div>` : ''}
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
                <div class="ipl-pm" style="margin:0;">
                    <div><b>Type:</b> <label><input type="radio" name="iplOaType" value="chc" ${chc ? 'checked' : ''}> Curve-Hold-Curve</label><label><input type="radio" name="iplOaType" value="cc" ${!chc ? 'checked' : ''}> Curve-Curve</label></div>
                    ${chc ? `
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaMode" value="dls" ${O.mode === 'dls' ? 'checked' : ''}> Doglegs</label> 1: ${num('dls1', O.mode === 'dls' ? O.dls1 : sv('d1', O.dls1), 70, O.mode !== 'dls')} 2: ${num('dls2', O.mode === 'dls' ? O.dls2 : sv('d2', O.dls2), 70, O.mode !== 'dls')} °/30m</div>
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaMode" value="tvd" ${O.mode === 'tvd' ? 'checked' : ''}> TVD</label> 1: ${num('tvd1', O.mode === 'tvd' ? O.tvd1 : sv('tvd1', O.tvd1), 80, O.mode !== 'tvd')} 2: ${num('tvd2', O.mode === 'tvd' ? O.tvd2 : sv('tvd2', O.tvd2), 80, O.mode !== 'tvd')} m <span style="font-size:10px;color:var(--wbt-text-dim);">(end of curve 1 / end of hold)</span></div>
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaMode" value="tan" ${O.mode === 'tan' ? 'checked' : ''}> Tangent Length</label> ${num('L', O.mode === 'tan' ? O.L : sv('L', O.L), 80, O.mode !== 'tan')} m <span style="font-size:10px;color:var(--wbt-text-dim);">(one DLS for both curves)</span></div>`
                    : `
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaCc" value="eq" ${O.ccMode === 'eq' ? 'checked' : ''}> Same DLS on both curves (solved)</label></div>
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaCc" value="d1" ${O.ccMode === 'd1' ? 'checked' : ''}> DLS 1 given</label> ${num('dls1', O.ccMode === 'd1' ? O.dls1 : sv('d1', O.dls1), 70, O.ccMode !== 'd1')} <span style="font-size:10px;color:var(--wbt-text-dim);">→ DLS 2 solved</span></div>
                    <div style="margin-top:4px;"><label><input type="radio" name="iplOaCc" value="d2" ${O.ccMode === 'd2' ? 'checked' : ''}> DLS 2 given</label> ${num('dls2', O.ccMode === 'd2' ? O.dls2 : sv('d2', O.dls2), 70, O.ccMode !== 'd2')} <span style="font-size:10px;color:var(--wbt-text-dim);">→ DLS 1 solved</span></div>`}
                    ${S.d1 != null ? `<div style="font-size:10px;color:var(--wbt-text-dim);margin-top:4px;">Last solve: DLS ${f(S.d1,2)} / ${f(S.d2,2)} · hold ${f(S.L,2)} m · TVD ${f(S.tvd1,2)} / ${f(S.tvd2,2)}</div>` : ''}
                </div>
                <div class="ipl-pm" style="margin:0;">
                    <div><b>Project Back</b> <span style="font-size:10px;color:var(--wbt-text-dim);">chain, from the Final Target backwards (each item = one curve; CL with DLS 0 = a hold)</span></div>
                    ${O.chain.length ? `<table style="font-size:11px;margin-top:3px;"><tr><th>#</th><th>To</th><th>DLS</th><th></th></tr>${O.chain.map((b, k) => `<tr><td>${k + 1}</td><td>${PB_LABEL(b)}</td><td>${f(b.dls,2)}</td><td><button type="button" class="wbt-btn" data-pbdel="${k}" style="padding:0 5px;">&times;</button></td></tr>`).join('')}</table>` : '<div style="font-size:11px;color:var(--wbt-text-dim);margin-top:3px;">No Project Back — the align lands on the Final Target.</div>'}
                    <div style="margin-top:5px;">${[['cl','CL'],['tvd','TVD'],['inc','Inc'],['incazi','IncAzi']].map(([k, l]) => `<label><input type="radio" name="iplNbMode" value="${k}" ${NB.mode === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:3px;align-items:center;">
                        ${NB.mode === 'cl' ? `<span>CL</span><input type="number" step="1" data-nb="cl" value="${NB.cl}" style="width:70px;">` : ''}
                        ${NB.mode === 'tvd' ? `<span>TVD</span><input type="number" step="0.1" data-nb="tvd" value="${NB.tvd}" style="width:80px;">` : ''}
                        ${NB.mode === 'inc' || NB.mode === 'incazi' ? `<span>Inc</span><input type="number" step="0.1" data-nb="inc" value="${NB.inc}" style="width:60px;">` : ''}
                        ${NB.mode === 'incazi' ? `<span>Azi</span><input type="number" step="0.1" data-nb="az" value="${NB.az}" style="width:65px;">` : ''}
                        <span>DLS</span><input type="number" step="0.1" data-nb="dls" value="${NB.dls}" style="width:55px;">
                        <button type="button" class="wbt-btn" id="iplNbAdd" style="padding:1px 8px;">+ Project Back</button>
                    </div>
                </div>
                <div class="ipl-pm" style="margin:0;">
                    <div><b>Final Target:</b> <select id="iplOaTgt" style="max-width:520px;"><option value="">${O.tname ? esc(O.tname) : 'No Target (Freehand)'}</option>
                        ${sc.targets.length ? `<optgroup label="Scenario targets">${sc.targets.map((t, i) => `<option value="s:${i}" ${O.tgt === 's:' + i ? 'selected' : ''}>T${i + 1} ${esc(t.name)} — Sub-Sea ${f(n(t.ss),2)}</option>`).join('')}</optgroup>` : ''}
                        ${(() => { const by = {}; PAD_TARGETS.forEach(t => (by[t.well] = by[t.well] || []).push(t));
                            return Object.keys(by).map(wn => `<optgroup label="${esc(wn)}">` + by[wn].map(t => `<option value="p:${t.key}" ${O.tgt === 'p:' + t.key ? 'selected' : ''}>${esc(t.type)} — MD ${f(t.md,1)} · Sub-Sea ${f(t.rkb - t.tvd,2)} · Inc ${f(t.inc,1)} · Az ${f(t.az,1)}</option>`).join('') + '</optgroup>').join(''); })()}
                    </select></div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;align-items:center;">
                        <span>TVD</span>${num('tvd', O.tvd, 85)} <span>Sub-Sea</span>${num('ss', O.ss, 85)} <span>N/S</span>${num('ns', O.ns, 85)} <span>E/W</span>${num('ew', O.ew, 85)} <span>Inc</span>${num('inc', O.inc, 65)} <span>Azi</span>${num('az', O.az, 65)}
                    </div>
                    <div style="margin-top:4px;"><b>Align on:</b> <select id="iplOaAl" style="max-width:520px;"><option value="">${O.alPt ? esc(O.alPt.name) : 'No Target (Freehand)'}</option>${O.alPt ? '<option value="-">No Target (Freehand)</option>' : ''}
                        ${sc.targets.length ? `<optgroup label="Scenario targets">${sc.targets.map((t, i) => `<option value="s:${i}">T${i + 1} ${esc(t.name)} — Sub-Sea ${f(n(t.ss),2)}</option>`).join('')}</optgroup>` : ''}
                        ${(() => { const by = {}; PAD_TARGETS.forEach(t => (by[t.well] = by[t.well] || []).push(t));
                            return Object.keys(by).map(wn => `<optgroup label="${esc(wn)}">` + by[wn].map(t => `<option value="p:${t.key}">${esc(t.type)} — MD ${f(t.md,1)} · Sub-Sea ${f(t.rkb - t.tvd,2)}</option>`).join('') + '</optgroup>').join(''); })()}
                    </select> <span style="font-size:10px;color:var(--wbt-text-dim);">sets Inc / Azi along the line Final Target → that point (typing Inc / Azi = Freehand)</span></div>
                    <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:2px;">N/S, E/W from the planned well's surface (same as the grid). Inc / Azi = attitude when arriving at the target.</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;justify-content:center;">
                    <button type="button" class="wbt-btn" id="iplOaCalc">Calculate</button>
                    <button type="button" class="wbt-btn" id="iplOaNext">Calculate + Next</button>
                </div></div><div id="iplOaMsg" style="font-size:11px;margin-top:4px;">${sc._oaErr ? '<span style="color:#ff4c4c;">' + esc(sc._oaErr) + '</span>' : ''}</div>`;
        }
        function wireOa(sc, box, sel){
            const O = oaState, NB = O.nb;
            const on = (q, ev, fn) => box.querySelectorAll(q).forEach(el => el.addEventListener(ev, fn));
            on('input[name=iplOaType]', 'change', e => { O.type = e.target.value; renderPlanMethods(sc); });
            on('input[name=iplOaMode]', 'change', e => { O.mode = e.target.value; renderPlanMethods(sc); });
            on('input[name=iplOaCc]', 'change', e => { O.ccMode = e.target.value; renderPlanMethods(sc); });
            on('input[name=iplNbMode]', 'change', e => { NB.mode = e.target.value; renderPlanMethods(sc); });
            on('[data-nb]', 'input', e => { NB[e.target.dataset.nb] = n(e.target.value); });
            on('[data-pbdel]', 'click', e => { O.chain.splice(+e.currentTarget.dataset.pbdel, 1); renderPlanMethods(sc); });
            document.getElementById('iplNbAdd').addEventListener('click', () => { O.chain.push(Object.assign({}, NB)); renderPlanMethods(sc); });
            const nw = document.getElementById('iplOaNew'); if(nw) nw.addEventListener('click', () => { O.editG = null; renderPlanMethods(sc); });
            const rkb = scenarioRkb(sc);
            on('[data-oa]', 'change', e => { const k = e.target.dataset.oa;   // Align on: typed Inc/Azi -> Freehand; moved target -> re-aligned
                if(k === 'inc' || k === 'az'){ if(O.alPt){ O.alPt = null; renderPlanMethods(sc); } }
                else if(O.alPt && ['tvd','ss','ns','ew'].includes(k)){ oaApplyAlign(sc); renderPlanMethods(sc); } });
            on('[data-oa]', 'input', e => { const k = e.target.dataset.oa; O[k] = n(e.target.value);
                if(k === 'tvd' || k === 'ss'){ if(k === 'tvd') O.ss = +(rkb - O.tvd).toFixed(2); else O.tvd = +(rkb - O.ss).toFixed(2);
                    const other = box.querySelector(`[data-oa="${k === 'tvd' ? 'ss' : 'tvd'}"]`); if(other) other.value = k === 'tvd' ? O.ss : O.tvd; } });
            document.getElementById('iplOaTgt').addEventListener('change', e => { O.tgt = e.target.value; const o0 = gridOrigin(sc);
                let Q = null;
                if(O.tgt.startsWith('s:')){ const t = sc.targets[+O.tgt.slice(2)]; if(t) Q = { name: t.name, n: n(t.n), e: n(t.e), ss: n(t.ss), inc: t.inc, az: t.az }; }
                else if(O.tgt.startsWith('p:')){ const t = PAD_TARGETS[+O.tgt.slice(2)]; if(t) Q = { name: t.well + ' ' + t.type, n: t.n, e: t.e, ss: t.rkb - t.tvd, inc: t.inc, az: t.az }; }
                if(Q){ O.tname = Q.name; O.ss = +Q.ss.toFixed(2); O.tvd = +(rkb - Q.ss).toFixed(2); O.ns = +(Q.n - o0.n).toFixed(2); O.ew = +(Q.e - o0.e).toFixed(2);
                    if(Q.inc != null && isFinite(Q.inc)) O.inc = +(+Q.inc).toFixed(2); if(Q.az != null && isFinite(Q.az)) O.az = +(+Q.az).toFixed(2); }
                oaApplyAlign(sc); renderPlanMethods(sc); });
            document.getElementById('iplOaAl').addEventListener('change', e => { const v = e.target.value;
                if(v === '-'){ O.alPt = null; renderPlanMethods(sc); return; }
                const P = oaPoint(sc, v); if(!P) return; const o0 = gridOrigin(sc);
                if(!oaAlignDir({ n: o0.n + O.ns, e: o0.e + O.ew, ss: O.ss }, P, scenarioRkb(sc))){ const m = document.getElementById('iplOaMsg'); if(m) m.innerHTML = '<span style="color:#ff4c4c;">Align on: that point is the Final Target itself.</span>'; return; }
                O.alPt = { name: P.name, n: P.n, e: P.e, ss: P.ss }; oaApplyAlign(sc); renderPlanMethods(sc); });
            const go = next => {
                const o0 = gridOrigin(sc);
                const D = { type: O.type, mode: O.mode, ccMode: O.ccMode, dls1: O.dls1, dls2: O.dls2, L: O.L, tvd1: O.tvd1, tvd2: O.tvd2,
                    target: { name: O.tname || 'Freehand', n: o0.n + O.ns, e: o0.e + O.ew, ss: O.ss, inc: O.inc, az: O.az }, alignOn: O.alPt ? Object.assign({}, O.alPt) : null, back: JSON.parse(JSON.stringify(O.chain)) };
                const before = JSON.parse(JSON.stringify(sc.sections));
                let gid = O.editG;
                if(gid && oaGroupHead(sc, gid)){ oaGroupHead(sc, gid).oaDef = D; }
                else {
                    gid = 'g' + Date.now().toString(36);
                    const pos = sel != null ? sel + 1 : sc.sections.length;
                    sc.sections.splice(pos, 0, { kind: 'hold', cl: 0, oaG: gid, oaPart: 'oa', oaDef: D });
                }
                refresh(sc);
                if(sc._oaErr){ sc.sections = before; refresh(sc); renderEditor(); const m = document.getElementById('iplOaMsg'); if(m) m.innerHTML = '<span style="color:#ff4c4c;">' + esc(sc._oaErr) + '</span>'; return; }
                sc._undo = sc._undo || []; sc._undo.push(before);
                O.editG = gid; O.last = D.last;
                const idx = sc.sections.map((x, k) => x.oaG === gid ? k : -1).filter(k => k >= 0);
                gridSel[sc.id] = (next ? idx[idx.length - 1] : idx[0]);
                if(next){ O.editG = null; }
                renderEditor();
                const m2 = document.getElementById('iplOaMsg'); const S = D.last || {};
                if(m2) m2.innerHTML = `<span style="color:#00e676;">Optimum Align: DLS ${f(S.d1,2)} / ${f(S.d2,2)}, hold ${f(S.L,2)} m, TVD ${f(S.tvd1,2)} / ${f(S.tvd2,2)}${D.back.length ? ' · ' + D.back.length + ' Project Back item(s)' : ''}. It re-solves by itself when anything above changes. Undo with "Undo last wizard".</span>`;
            };
            document.getElementById('iplOaCalc').addEventListener('click', () => go(false));
            document.getElementById('iplOaNext').addEventListener('click', () => go(true));
        }
        // ADDED 2026-11-06 (John: Compass "Thread Targets" dialog, screenshots 2026-11-06). Pick targets (Available ->
        // Targets To), sort them (Displacement from the well's surface / Descending TVD / Ascending TVD / Name — the
        // sort is the threading order, John's answer), choose the Thread Method and "Dogleg to"; OK inserts a LIVE group
        // (thDef on the first section; sections carry thG, thT = target name on the section ending at it) that is
        // re-solved on every recalculation like Optimum Align. Methods: Curve Only (DLS solved), Curve-Hold (DLS =
        // "Dogleg to"), Straight Line (station dogleg + hold) — IPlanCore.threadToPoint; Optimum Align =
        // IPlanCore.planOptimumAlign Curve-Hold-Curve with both doglegs = "Dogleg to" and the target's Inc / Azi.
        // Least Turn: not implemented (John: skip for now).
        const TH_METHODS = [['curve','Curve Only'],['curvehold','Curve-Hold'],['oa','Optimum Align'],['line','Straight Line']];
        const thState = { sort: 'disp', to: [], method: 'curvehold', dls: 3, pick: null, pickTo: null };
        function thSort(sc, keys){
            const o0 = gridOrigin(sc), rkb = scenarioRkb(sc), P = keys.map(k => ({ k, p: oaPoint(sc, k) })).filter(x => x.p);
            const disp = p => Math.hypot(p.n - o0.n, p.e - o0.e), tvd = p => rkb - p.ss, S = thState.sort;
            // FIXED 2026-11-06 (COMPASS Training Manual 2003.5 p.190-191): "Descending" = shallowest target first then
            // deeper (was deepest first); "Ascending" = deepest first (up-dip); "Name" = the order the targets were put in
            // the thread list (was alphabetical). Displacement = increasing horizontal displacement from the slot.
            if(S === 'name') return P;   // keys already in list order
            P.sort((a, b) => S === 'disp' ? disp(a.p) - disp(b.p) : S === 'dtvd' ? tvd(a.p) - tvd(b.p) : tvd(b.p) - tvd(a.p));
            return P;
        }
        // REWRITTEN 2026-11-06 per the COMPASS Training Manual 2003.5 (ch. 5 Thread Targets, p.190-191):
        //  - "Dogleg to" too small -> raised automatically to the smallest workable DLS (IPlanCore.withDoglegIncrease;
        //    was: error). Not for Curve Only (DLS solved). The DLS used per target is kept in D.used and shown.
        //  - Optimum Align: "three sections per target ... and connects the last two targets via a straight line":
        //    each target is reached curve-hold-curve LINED UP ON THE NEXT target, the last one by a hold (was: each
        //    target's own Inc / Azi). One target only: its own Inc / Azi (as Optimum Align freehand).
        //  - Straight Line: "best straight line through the targets, optimum align to get to the first" ->
        //    IPlanCore.fitTargetLine (my interpretation of the fit, see there) + Optimum Align (curve-hold-curve at
        //    "Dogleg to") onto the line's start with the line's attitude, then a hold along the line; targets off the
        //    line beyond their radius are reported (D.missed). Was: a station dogleg + hold to each target (wrong).
        function thBuild(sc, D, end, gid){
            const rkb = scenarioRkb(sc), out = []; let cur = { md: end.md, tvd: end.tvd, n: end.n, e: end.e, inc: end.inc, az: end.az };
            const P = D.targets.map(t => ({ name: t.name || 'target', n: n(t.n), e: n(t.e), tvd: rkb - n(t.ss), r: n(t.r), inc: t.inc, az: t.az }));
            const used = []; D.missed = [];
            const push = (secs, name) => { secs = secs.length ? secs : [{ kind: 'hold', cl: 0 }]; secs.forEach(x => Object.assign(x, { thG: gid })); if(name != null) secs[secs.length - 1].thT = name;
                out.push(...secs); const s2 = C.computeStations(cur, secs, 1e6).stations, E = s2[s2.length - 1]; cur = { md: E.md, tvd: E.tvd, n: E.n, e: E.e, inc: E.inc, az: E.az }; };
            const oaTo = (T, inc, az, nm) => { const r = C.withDoglegIncrease(D.dls, d => C.planOptimumAlign(cur, T, inc, az, { type: 'chc', mode: 'dls', dls1: d, dls2: d }));
                if(r.error) return nm + ': ' + r.error; used.push({ name: nm, dls: r.dlsUsed, raised: r.raised }); push(r.sections, nm); return null; };
            const dir = (A, B) => { const dN = B.n - A.n, dE = B.e - A.e, dV = B.tvd - A.tvd; return { inc: Math.atan2(Math.hypot(dN, dE), dV) * 180 / Math.PI, az: ((Math.atan2(dE, dN) * 180 / Math.PI) % 360 + 360) % 360, L: Math.hypot(dN, dE, dV) }; };
            if(D.method === 'line'){
                if(P.length < 2) return { error: 'Straight Line needs at least 2 targets.' };
                const Lf = C.fitTargetLine(P, D.sort === 'disp'); if(Lf.error) return Lf;
                const e = oaTo(Lf.a, Lf.inc, Lf.az, 'line start'); if(e) return { error: e };
                push([{ kind: 'hold', cl: Math.hypot(Lf.b.n - Lf.a.n, Lf.b.e - Lf.a.e, Lf.b.tvd - Lf.a.tvd) }], P[P.length - 1].name);
                D.missed = Lf.miss.filter(m => m.missed).map(m => ({ name: P[m.i].name, dist: m.dist, r: m.r }));
            } else if(D.method === 'oa'){
                for(let i = 0; i < P.length; i++){
                    if(i > 0 && i === P.length - 1){ const d = dir(cur, P[i]); push([{ kind: 'hold', cl: d.L }], P[i].name); break; }   // last two joined by a straight line
                    let inc, az;
                    if(i + 1 < P.length){ const d = dir(P[i], P[i + 1]); inc = d.inc; az = d.az; }
                    else { if(P[i].inc == null || P[i].inc === '' || !isFinite(P[i].inc) || P[i].az == null || P[i].az === '' || !isFinite(P[i].az)) return { error: P[i].name + ' has no Inc / Azi — with one target, Optimum Align needs them.' }; inc = n(P[i].inc); az = n(P[i].az); }
                    const e = oaTo(P[i], inc, az, P[i].name); if(e) return { error: e };
                }
            } else {
                for(const T of P){
                    const r = D.method === 'curve' ? C.threadToPoint(cur, T, 'curve') : C.withDoglegIncrease(D.dls, d => C.threadToPoint(cur, T, 'curvehold', d));
                    if(r.error) return { error: T.name + ': ' + r.error };
                    if(D.method !== 'curve') used.push({ name: T.name, dls: r.dlsUsed, raised: r.raised });
                    push(r.sections, T.name);
                }
            }
            D.used = used;
            if(!out.length) out.push({ kind: 'hold', cl: 0, thG: gid });
            out[0].thDef = D; return { sections: out };
        }
        function thHtml(sc){
            const T = thState, rkb = scenarioRkb(sc);
            const all = sc.targets.map((t, i) => 's:' + i).concat(PAD_TARGETS.map(t => 'p:' + t.key));
            const avail = thSort(sc, all.filter(k => !T.to.includes(k))), to = thSort(sc, T.to);
            const row = (x, attr, selk) => `<div ${attr}="${x.k}" style="cursor:pointer;padding:1px 4px;display:flex;justify-content:space-between;gap:10px;${selk === x.k ? 'background:rgba(0,150,255,.35);' : ''}"><span>${esc(x.p.name)}</span><span>${f(rkb - x.p.ss, 2)}</span></div>`;
            const list = (arr, attr, selk) => `<div style="border:1px solid var(--wbt-border);height:150px;overflow:auto;min-width:260px;font-size:11px;"><div style="display:flex;justify-content:space-between;padding:1px 4px;color:var(--wbt-text-dim);"><span>Name</span><span>TVD (m)</span></div>${arr.map(x => row(x, attr, selk)).join('')}</div>`;
            return `<div class="ipl-pm" style="margin-top:6px;">
                <div><b>Sort Targets</b> ${[['disp','Displacement'],['dtvd','Descending TVD'],['atvd','Ascending TVD'],['name','Name']].map(([k, l]) => `<label><input type="radio" name="iplThSort" value="${k}" ${T.sort === k ? 'checked' : ''}> ${l}</label>`).join('')}
                    <span style="font-size:10px;color:var(--wbt-text-dim);">(also the threading order)</span></div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
                    <div><div style="text-align:center;">Available</div>${list(avail, 'data-tha', T.pick)}</div>
                    <div style="display:flex;flex-direction:column;gap:6px;"><button type="button" class="wbt-btn" id="iplThAdd">==&gt;</button><button type="button" class="wbt-btn" id="iplThRem">&lt;==</button></div>
                    <div><div style="text-align:center;">Targets To</div>${list(to, 'data-tht', T.pickTo)}</div>
                </div>
                <div style="margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><b>Thread Method</b>
                    <select id="iplThM">${TH_METHODS.map(([k, l]) => `<option value="${k}" ${T.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <span>Dogleg to</span><input type="number" step="0.1" id="iplThDls" value="${T.dls}" style="width:70px;" ${T.method === 'curve' || T.method === 'line' ? 'disabled title="not used by this method"' : ''}> °/30m
                    <button type="button" class="wbt-btn" id="iplThOk">OK</button></div>
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">Curve Only: one arc, DLS solved · Curve-Hold: arc at "Dogleg to" + hold · Optimum Align: curve-hold-curve per target lined up on the next target, last two joined by a hold · Straight Line: best-fit line through the targets (weighted to small targets), optimum align onto it, then hold. "Dogleg to" too small → raised automatically (shown after OK); a very small value gives the minimum. Double-click a name to move it. Least Turn: not yet.</div>
                <div id="iplThMsg" style="font-size:11px;margin-top:4px;">${sc._oaErr ? '<span style="color:#ff4c4c;">' + esc(sc._oaErr) + '</span>' : ''}</div></div>`;
        }
        function wireTh(sc, box, sel){
            const T = thState, re = () => renderPlanMethods(sc);
            box.querySelectorAll('input[name=iplThSort]').forEach(r => r.addEventListener('change', e => { T.sort = e.target.value; re(); }));
            box.querySelectorAll('[data-tha]').forEach(d => { d.addEventListener('click', () => { T.pick = d.dataset.tha; re(); }); d.addEventListener('dblclick', () => { T.to.push(d.dataset.tha); T.pick = null; re(); }); });
            box.querySelectorAll('[data-tht]').forEach(d => { d.addEventListener('click', () => { T.pickTo = d.dataset.tht; re(); }); d.addEventListener('dblclick', () => { T.to = T.to.filter(k => k !== d.dataset.tht); T.pickTo = null; re(); }); });
            document.getElementById('iplThAdd').addEventListener('click', () => { if(T.pick && !T.to.includes(T.pick)) T.to.push(T.pick); T.pick = null; re(); });
            document.getElementById('iplThRem').addEventListener('click', () => { T.to = T.to.filter(k => k !== T.pickTo); T.pickTo = null; re(); });
            document.getElementById('iplThM').addEventListener('change', e => { T.method = e.target.value; re(); });
            document.getElementById('iplThDls').addEventListener('input', e => { T.dls = n(e.target.value); });
            document.getElementById('iplThOk').addEventListener('click', () => {
                const msg = t => { const m = document.getElementById('iplThMsg'); if(m) m.innerHTML = t; };
                if(!T.to.length){ msg('<span style="color:#ff4c4c;">Move at least one target to "Targets To".</span>'); return; }
                const D = { method: T.method, dls: T.dls, sort: T.sort,
                    targets: thSort(sc, T.to).map(x => ({ name: x.p.name, n: x.p.n, e: x.p.e, ss: x.p.ss, inc: x.p.inc, az: x.p.az, r: x.p.r })) };
                const before = JSON.parse(JSON.stringify(sc.sections)), gid = 't' + Date.now().toString(36);
                sc.sections.splice(sel != null ? sel + 1 : sc.sections.length, 0, { kind: 'hold', cl: 0, thG: gid, thDef: D });
                refresh(sc);
                if(sc._oaErr){ const e0 = sc._oaErr; sc.sections = before; refresh(sc); renderEditor(); msg('<span style="color:#ff4c4c;">' + esc(e0) + '</span>'); return; }
                sc._undo = sc._undo || []; sc._undo.push(before);
                const idx = sc.sections.map((x, k) => x.thG === gid ? k : -1).filter(k => k >= 0); gridSel[sc.id] = idx[idx.length - 1];
                T.to = []; renderEditor();
                msg(`<span style="color:#00e676;">Threaded ${D.targets.length} target(s) — ${TH_METHODS.find(m => m[0] === D.method)[1]}. Re-solves by itself when anything above changes. Undo with "Undo last wizard".</span>`
                    + ((D.used || []).some(u => u.raised) ? `<br><span style="color:#ffd060;">Dogleg raised to hit: ${D.used.filter(u => u.raised).map(u => esc(u.name) + ' ' + f(u.dls, 2) + '°/30m').join(', ')}</span>` : '')
                    + ((D.missed || []).length ? `<br><span style="color:#ff4c4c;">Missed by the line: ${D.missed.map(m => esc(m.name) + ' (' + f(m.dist, 2) + ' m, radius ' + f(m.r, 2) + ')').join(', ')}</span>` : ''));
            });
        }
        function renderPlanMethods(sc){
            const box = document.getElementById('iplPmBox'); if(!box) return;
            const M = PM[pmState.m], sel = gridSel[sc.id];
            if(M.subs && !M.subs.some(x => x[0] === pmState.sub)) pmState.sub = M.subs[0][0];
            const L = sc._calc && sc._calc.stations && sc._calc.stations.length ? sc._calc.stations[sc._calc.stations.length - 1] : { inc: 0, az: 0, md: 0, tvd: 0 };
            const fields = !M.subs ? [] : pmState.sub === 'nudge' ? [['dls','DLS (°/30m)',2],['inc','Inc (°)',5],['az','Azi (°)',0],['cl','Hold CL (m)',100],['dls2','Drop DLS (°/30m)',2]]
                : pmState.sub === 'hold_md' ? [['targetMd','MD (m)',Math.round(L.md + 100)]] : (C.KIND_FIELDS[pmState.sub] || []);
            const val = (k, d) => pmState.v[pmState.sub + '.' + k] != null ? pmState.v[pmState.sub + '.' + k] : d;
            box.innerHTML = `<div class="ipl-pm"><div style="font-weight:600;margin-bottom:4px;">Planning Methods <span style="font-weight:400;color:var(--wbt-text-dim);font-size:10px;">— inserted ${sel != null ? 'after row ' + (sel + 2) : 'at the end'}</span></div>
                <div>${Object.keys(PM).map(k => `<label><input type="radio" name="iplPm" value="${k}" ${pmState.m === k ? 'checked' : ''}> ${PM[k].label}</label>`).join('')}</div>
                ${M.subs ? `<div style="margin-top:4px;">${M.subs.map(([k, l]) => `<label><input type="radio" name="iplPmSub" value="${k}" ${pmState.sub === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center;">${fields.map(([k, l, d]) => `<span class="fld"><span>${l}</span> <input type="number" step="0.1" data-pmk="${k}" value="${val(k, d)}" style="width:80px;"></span>`).join('')}
                    <button type="button" class="wbt-btn" id="iplPmCalc">Calculate</button> <button type="button" class="wbt-btn" id="iplPmNext" title="Calculate and keep adding after the new row">Calculate + Next</button></div>`
                : M.oa ? oaHtml(sc)
                : M.th ? thHtml(sc)
                : `<div style="margin-top:4px;"><button type="button" class="wbt-btn" id="iplPmWiz">Open ${M.label} wizard</button> <span style="font-size:10px;color:var(--wbt-text-dim);">Uses the scenario targets (left).</span></div>`}</div>`;
            if(M.oa) wireOa(sc, box, sel);
            if(M.th) wireTh(sc, box, sel);
            box.querySelectorAll('input[name=iplPm]').forEach(r => r.addEventListener('change', e => { pmState.m = e.target.value; renderPlanMethods(sc); }));
            box.querySelectorAll('input[name=iplPmSub]').forEach(r => r.addEventListener('change', e => { pmState.sub = e.target.value; renderPlanMethods(sc); }));
            box.querySelectorAll('[data-pmk]').forEach(inp => inp.addEventListener('input', e => { pmState.v[pmState.sub + '.' + e.target.dataset.pmk] = n(e.target.value); }));
            const wz = document.getElementById('iplPmWiz'); if(wz) wz.addEventListener('click', () => { openWizard(sc, M.wiz); const w0 = document.getElementById('iplWiz'); if(w0) w0.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
            const add = next => {
                const get = k => n(box.querySelector(`[data-pmk="${k}"]`).value);
                let secs;
                if(pmState.sub === 'nudge') secs = [{ kind:'dls_inc_az', dls:get('dls'), inc:get('inc'), az:get('az') }, { kind:'hold', cl:get('cl') }, { kind:'dls_inc_az', dls:get('dls2'), inc:0, az:get('az') }];
                else if(pmState.sub === 'hold_md'){ const at = sel != null ? gridRows(sc).rows[sel + 1] : L; secs = [{ kind:'md_inc_az', targetMd:get('targetMd'), inc:at.inc, az:at.az }]; }
                else { const s1 = { kind: pmState.sub }; (C.KIND_FIELDS[pmState.sub] || []).forEach(([k]) => { s1[k] = get(k); }); secs = [s1]; }
                const at = sel != null ? sel + 1 : sc.sections.length;
                sc.sections.splice(at, 0, ...secs);
                gridSel[sc.id] = next ? at + secs.length - 1 : (sel != null ? at + secs.length - 1 : undefined);
                refresh(sc); renderSections(sc); updateResults(sc); renderPlanMethods(sc);
            };
            const cb = document.getElementById('iplPmCalc'), nb = document.getElementById('iplPmNext');
            if(cb) cb.addEventListener('click', () => add(false)); if(nb) nb.addEventListener('click', () => add(true));
        }

        function padTargetOptions(){
            const byWell = {};
            PAD_TARGETS.forEach(t => { (byWell[t.well] = byWell[t.well] || []).push(t); });
            return Object.keys(byWell).map(wn => `<optgroup label="${esc(wn)}">` +
                byWell[wn].map(t => `<option value="${t.key}">${esc(t.type)} — MD ${f(t.md,1)} · Sub-Sea ${f(t.rkb - t.tvd,1)} · N ${f(t.n,1)} · E ${f(t.e,1)}</option>`).join('') +
                '</optgroup>').join('');
        }

        // Editable scenario targets: name, N, E, TVD (scenario RKB), radius.
        function renderTargets(sc){
            const box = document.getElementById('iplTargets');
            box.innerHTML = '';
            if(!sc.targets.length){ box.innerHTML = '<div style="color:var(--wbt-text-dim);margin-bottom:4px;">No targets.</div>'; return; }
            sc.targets.forEach((t, i) => {
                const row = document.createElement('div');
                row.className = 'ipl-sec';
                row.innerHTML = `<span class="idx">T${i + 1}</span>
                    <input type="text" data-k="name" value="${esc(t.name)}" style="width:200px;">
                    <span class="fld"><span>N</span><input type="number" step="0.01" data-k="n" value="${t.n}" style="width:110px;"></span>
                    <span class="fld"><span>E</span><input type="number" step="0.01" data-k="e" value="${t.e}" style="width:100px;"></span>
                    <span class="fld"><span>Sub-Sea</span><input type="number" step="0.1" data-k="ss" value="${t.ss}"></span>
                    <span class="fld"><span data-role="ttvd" style="font-family:var(--wbt-mono);">(TVD ${f(tvdOf(sc, t),1)})</span></span>
                    <span class="fld"><span>R (m)</span><input type="number" step="1" data-k="r" value="${t.r}" style="width:60px;"></span>
                    <button type="button" class="wbt-btn" data-role="del" style="padding:1px 6px;" title="Delete">&times;</button>
                    <div class="ipl-res" data-role="tres"></div>`;
                row.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', e => {
                    const k = e.target.dataset.k;
                    t[k] = (k === 'name') ? e.target.value : n(e.target.value);
                    if(k === 'name') renderSections(sc);
                    refresh(sc); updateResults(sc);
                }));
                row.querySelector('[data-role=del]').addEventListener('click', () => {
                    sc.targets.splice(i, 1); refresh(sc); renderTargets(sc); renderSections(sc); updateResults(sc);
                });
                box.appendChild(row);
            });
        }

        // ---------- Target-design wizards (ADDED 2026-10-10) ----------
        // Same three wizards as QuickPlan, same solvers (IPlanCore.planBuildHold /
        // planHbhbh / planCurveHoldCurve wrap the verbatim-moved QuickPlan solvers).
        // They append sections to the END of the scenario, starting from its last
        // computed station; targets are converted Sub-Sea -> TVD with the scenario RKB.
        const WIZ = {
            bh: { title:'Build &amp; Hold to Target', note:'Check exactly 2 KNOWNS; the other 2 are solved. Requires the scenario to be vertical (Inc = 0°) where this design starts.',
                  fields:[['dls','Build DLS (°/30m)',3,true],['D1','1st Hold Len (m)',200,false],['theta','Max Angle (Inc, °)',45,true],['L2','2nd Hold Len (m)',200,false]] },
            hbhbh: { title:'Build-Hold-Build-Hold to Target', note:'Check exactly 2 UNKNOWNS to solve; the other 5 are used as entered. Requires Inc = 0° where this design starts.',
                  fields:[['D1','1st Hold Len (m)',200,false],['dls1','1st Build (DLS, °/30m)',3,false],['thetaMax','Max Angle (Inc, °)',60,true],['D2','2nd Hold Len (m)',200,false],['dls2','2nd Build (DLS, °/30m)',2,false],['thetaFinal','Final Inc (°)',35,true],['L3','Final Hold (m)',300,false]] },
            chc: { title:'Curve-Hold-Curve to Target', note:'Fully 3D: Curve (DLS1) → Hold → Curve (DLS2) landing on the target at the Inc/Az you enter. Works from any inclination.',
                  fields:[['incT','Target Inc (°)',60],['azT','Target Az (°)',0],['dls1','1st Curve DLS (°/30m)',3],['dls2','2nd Curve DLS (°/30m)',3]] }
        };
        function openWizard(sc, kind){
            const box = document.getElementById('iplWiz');
            if(!sc.targets.length){ box.innerHTML = '<div class="ipl-res bad" style="padding-left:0;">Add at least one target first.</div>'; return; }
            const W = WIZ[kind], chk = kind !== 'chc';
            box.innerHTML = `<div class="ipl-sec" style="display:block;margin-top:6px;">
                <div style="font-weight:700;color:#00e676;margin-bottom:4px;">${W.title}</div>
                <div style="font-size:11px;color:var(--wbt-text-dim);margin-bottom:6px;">${W.note}</div>
                <div style="margin-bottom:6px;"><span style="color:var(--wbt-text-dim);">Target </span>
                    <select data-role="t">${sc.targets.map((t, i) => `<option value="${i}">T${i + 1} ${esc(t.name)} (Sub-Sea ${f(n(t.ss),1)} · TVD ${f(tvdOf(sc, t),1)})</option>`).join('')}</select></div>
                ${W.fields.map(([k, lbl, def, on]) => `<div class="fld" style="margin:3px 0;">
                    ${chk ? `<input type="checkbox" data-c="${k}" ${on ? 'checked' : ''}>` : ''}
                    <span style="display:inline-block;width:170px;">${lbl}</span><input type="number" step="0.1" data-v="${k}" value="${def}"></div>`).join('')}
                <div class="ipl-res bad" data-role="err" style="padding-left:0;"></div>
                <button type="button" class="wbt-btn" data-role="go">Solve &amp; Insert</button>
                <button type="button" class="wbt-btn" data-role="x">Cancel</button></div>`;
            box.querySelector('[data-role=x]').addEventListener('click', () => { box.innerHTML = ''; });
            box.querySelector('[data-role=go]').addEventListener('click', () => {
                const errEl = box.querySelector('[data-role=err]');
                const c = sc._calc;
                if(!c || c.error || !c.stations){ errEl.textContent = (c && c.error) || 'Scenario has no start point.'; return; }
                const L = c.stations[c.stations.length - 1];
                const end = { md:L.md, inc:L.inc, az:L.az, tvd:L.tvd, n:L.n, e:L.e };
                const t0 = sc.targets[parseInt(box.querySelector('[data-role=t]').value, 10)];
                const t = { n:n(t0.n), e:n(t0.e), tvd:tvdOf(sc, t0) };
                const val = k => n(box.querySelector(`[data-v="${k}"]`).value);
                const checked = k => box.querySelector(`[data-c="${k}"]`).checked;
                let r;
                if(kind === 'bh'){
                    const knowns = {}; W.fields.forEach(([k]) => { if(checked(k)) knowns[k] = val(k); });
                    r = C.planBuildHold(end, t, knowns);
                } else if(kind === 'hbhbh'){
                    const values = {}; W.fields.forEach(([k]) => { values[k] = val(k); });
                    r = C.planHbhbh(end, t, values, W.fields.map(([k]) => k).filter(checked));
                } else {
                    r = C.planCurveHoldCurve(end, t, val('incT'), val('azT'), val('dls1'), val('dls2'));
                }
                if(r.error){ errEl.textContent = r.error; return; }
                (sc._undo = sc._undo || []).push(JSON.parse(JSON.stringify(sc.sections)));
                r.sections.forEach(x => sc.sections.push(x));
                box.innerHTML = '';
                refresh(sc); renderEditor();
            });
        }

        // ---------- Insert Tangent wizard (ADDED 2026-10-11) ----------
        // Uses IPlanCore.insertTangent (see the long comment in iplanCore.js).
        // Live preview: yellow ghost line in 3D + before/after table; nothing is
        // changed until Apply. Result sections are explicit Inc/Az/CL arcs.
        let tanGhost = null;
        function clearGhost(){ if(tanGhost){ api.getGroup().remove(tanGhost); tanGhost.geometry.dispose(); tanGhost.material.dispose(); tanGhost = null; } }
        function openTangentWizard(sc){
            const box = document.getElementById('iplWiz');
            const c = sc._calc;
            if(!c || c.error || !sc.sections.length){ box.innerHTML = '<div class="ipl-res bad" style="padding-left:0;">The scenario needs a start point and at least one section.</div>'; return; }
            const start = { md:c.start.md, tvd:c.start.tvd, n:c.start.n, e:c.start.e, inc:c.start.inc, az:c.start.az };
            const arcs = C.toArcs(start, sc.sections);
            const st = C.chainArcs(start, arcs);
            const isCurve = i => C.impliedBetaDeg(st[i].inc, st[i].az, arcs[i].inc1, arcs[i].az1) > 1e-6;
            const dlsOf = i => isCurve(i) ? C.impliedBetaDeg(st[i].inc, st[i].az, arcs[i].inc1, arcs[i].az1) / arcs[i].cl * 30 : 0;
            const firstCurveDls = (arcs.map((a, i) => dlsOf(i)).find(d => d > 0) || 3);
            box.innerHTML = `<div class="ipl-sec" style="display:block;margin-top:6px;">
                <div style="font-weight:700;color:#00e676;margin-bottom:4px;">&#128207; Insert Tangent</div>
                <div style="font-size:11px;color:var(--wbt-text-dim);margin-bottom:6px;">Adds a hold of the given length at an MD, TVD or inclination of this scenario, and optionally keeps a point below it (e.g. the landing) where it was. Preview below; nothing changes until Apply.</div>
                <div class="fld" style="margin:3px 0;flex-wrap:wrap;gap:6px;">
                    <span>Anchor</span><select data-t="type"><option value="inc">INC (°)</option><option value="md">MD (m)</option><option value="tvd">TVD (m, RKB)</option></select>
                    <input type="number" step="0.1" data-t="value" value="60">
                    <select data-t="at"><option value="start">tangent STARTS here</option><option value="end">tangent ENDS here</option></select>
                    <span>Length (m)</span><input type="number" step="1" data-t="L" value="30">
                </div>
                <div class="fld" style="margin:6px 0 3px;"><span style="width:110px;display:inline-block;">Keep fixed</span><select data-t="fix" style="max-width:520px;"></select></div>
                <div data-t="modeBox" style="margin:4px 0 4px 0;">
                    <label><input type="radio" name="iplTanMode" value="solve" checked> Adjust:</label>
                    <label style="margin-left:6px;"><input type="checkbox" data-f="dlsBefore" checked> DLS before</label>
                    <label style="margin-left:6px;"><input type="checkbox" data-f="dlsAfter" checked> DLS after</label>
                    <span style="font-size:10px;color:var(--wbt-text-dim);">(both = one shared DLS)</span>
                    <label style="margin-left:6px;"><input type="checkbox" data-f="holdBefore" checked> Hold before the curve (move curve start)</label>
                    <label style="margin-left:6px;"><input type="checkbox" data-f="holdAfter"> Hold after the tangent</label>
                    <label style="margin-left:6px;"><input type="checkbox" data-f="azAfter" checked> Allow small azimuth change at end of curve</label>
                    <br><label><input type="radio" name="iplTanMode" value="chc"> Re-solve below the tangent with Curve-Hold-Curve to the fixed point &mdash; DLS1</label>
                    <input type="number" step="0.1" data-t="dls1" value="${f(firstCurveDls,2)}"> DLS2 <input type="number" step="0.1" data-t="dls2" value="${f(firstCurveDls,2)}"> °/30m
                </div>
                <div class="fld" style="margin:3px 0;"><span>Max allowed DLS (°/30m)</span><input type="number" step="0.1" data-t="maxDls" value="${f(Math.max(firstCurveDls * 1.5, firstCurveDls + 2),1)}"></div>
                <div data-t="out" style="font-family:var(--wbt-mono);font-size:11px;margin:6px 0;"></div>
                <button type="button" class="wbt-btn" data-t="apply">Apply</button>
                <button type="button" class="wbt-btn" data-t="copy">Apply to a copy</button>
                <button type="button" class="wbt-btn" data-t="x">Cancel</button></div>`;
            const q = k => box.querySelector(`[data-t="${k}"]`);
            // fixed-point choices: end of each arc (index); default = first curve end at/after the anchor
            function fillFix(){
                const anchor = { type: q('type').value, value: n(q('value').value), at: q('at').value };
                const loc = C.findAnchor(start, arcs, anchor, n(q('L').value));
                const prev = q('fix').value;
                let html = '<option value="">Nothing &mdash; everything below the tangent just shifts</option>', def = '';
                arcs.forEach((a, i) => {
                    if(loc && i < loc.k) return;
                    const e = st[i + 1];
                    const lbl = (isCurve(i) ? 'End of curve' : 'End of hold') + ` (arc ${i + 1}) — MD ${f(e.md,1)} · TVD ${f(e.tvd,1)} · Inc ${f(e.inc,1)}° · Az ${f(e.az,1)}°` + (i === arcs.length - 1 ? ' (TD)' : '');
                    if(def === '' && isCurve(i)) def = String(i);
                    html += `<option value="${i}">${lbl}</option>`;
                });
                q('fix').innerHTML = html;
                q('fix').value = (prev !== undefined && [...q('fix').options].some(o => o.value === prev) && prev !== '') ? prev : def;
            }
            let last = null, timer = null;
            function run(){
                const anchor = { type: q('type').value, value: n(q('value').value), at: q('at').value };
                q('at').disabled = anchor.type === 'inc';
                const fixV = q('fix').value;
                const mode = fixV === '' ? 'none' : box.querySelector('input[name=iplTanMode]:checked').value;
                const free = {}; box.querySelectorAll('[data-f]').forEach(cb => { free[cb.dataset.f] = cb.checked; });
                q('modeBox').style.opacity = fixV === '' ? 0.4 : 1;
                const r = C.insertTangent(start, sc.sections, { anchor, L: n(q('L').value), fixIdx: fixV === '' ? null : parseInt(fixV, 10), mode, free, chc: { dls1: n(q('dls1').value), dls2: n(q('dls2').value) } });
                last = r;
                clearGhost();
                if(r.error){ q('out').innerHTML = `<span style="color:#ff4c4c;">${esc(r.error)}</span>`; return; }
                // preview stations + ghost
                const pv = C.computeStations(start, r.sections, STEP).stations;
                if(sc.visible && pv.length > 1){
                    const rkbG = scenarioRkb(sc);
                    tanGhost = api.buildWellLine(pv.map(p => new THREE.Vector3(p.e, rkbG - p.tvd, -p.n)), 0xffd060);   // 2026-10-21: Sub-Sea
                    api.getGroup().add(tanGhost);
                }
                const i = r.info, maxD = n(q('maxDls').value);
                const lastO = st[st.length - 1], lastN = pv[pv.length - 1];
                const row = (lbl, a, b) => `<tr><td style="padding:1px 8px 1px 0;color:var(--wbt-text-dim);">${lbl}</td><td style="padding:1px 8px;">${a}</td><td style="padding:1px 8px;">${b}</td></tr>`;
                const P = x => x ? `MD ${f(x.md,1)} · TVD ${f(x.tvd,2)} · N ${f(x.n,2)} · E ${f(x.e,2)} · Inc ${f(x.inc,2)}° · Az ${f(x.az,2)}°` : '—';
                let html = '<table>' + row('', '<b>before</b>', '<b>after</b>');
                if(i.fixOrig) html += row('Fixed point', P(i.fixOrig), P(i.fixNew));
                html += row('TD', P(lastO), P({ md:lastN.md, tvd:lastN.tvd, n:lastN.n, e:lastN.e, inc:lastN.inc, az:lastN.az }));
                html += '</table>';
                if(i.miss != null) html += `<div style="color:${i.miss > 0.01 ? '#ff4c4c' : '#00e676'};">Fixed point miss: ${f(i.miss,3)} m${i.miss > 0.01 ? ' — not enough free values ticked to hold it exactly; tick more (e.g. Hold before) or use Curve-Hold-Curve.' : ' ✔'}</div>`;
                const pr = i.params || {};
                const ch = [];
                if(pr.dA != null && pr.dS == null) ch.push(`DLS before ${f(i.d0A,2)} → ${f(pr.dA,2)}`);
                if(pr.dB != null && pr.dS == null) ch.push(`DLS after ${f(i.d0B,2)} → ${f(pr.dB,2)}`);
                if(pr.dS != null) ch.push(`shared DLS ${f(i.d0A || i.d0B,2)} → ${f(pr.dS,2)}`);
                if(pr.dHb) ch.push(`hold before curve ${pr.dHb > 0 ? '+' : ''}${f(pr.dHb,2)} m (curve starts ${pr.dHb > 0 ? 'deeper' : 'shallower'})`);
                if(pr.dHa) ch.push(`hold after tangent ${pr.dHa > 0 ? '+' : ''}${f(pr.dHa,2)} m`);
                if(pr.dAz) ch.push(`azimuth at end of curve ${pr.dAz > 0 ? '+' : ''}${f(pr.dAz,3)}°`);
                if(i.solved && i.solved.L != null) ch.push(`CHC: curve to Inc ${f(i.solved.inc1,2)}° / Az ${f(i.solved.az1,2)}°, hold ${f(i.solved.L,1)} m`);
                if(ch.length) html += '<div>Changes: ' + ch.join(' · ') + '</div>';
                html += `<div style="color:${i.maxDls > maxD + 1e-9 ? '#ff4c4c' : 'inherit'};">Max DLS: ${f(i.maxDls,2)} °/30m${i.maxDls > maxD + 1e-9 ? ' — EXCEEDS the max allowed ' + f(maxD,1) : ''}</div>`;
                if(pr.dAz && Math.abs(pr.dAz) > 2) html += `<div style="color:#ff4c4c;">Azimuth change at end of curve is larger than 2°.</div>`;
                if(i.warn) html += `<div style="color:#ffd060;">${esc(i.warn)}</div>`;
                q('out').innerHTML = html;
            }
            const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
            box.querySelectorAll('input,select').forEach(el => el.addEventListener('input', () => {
                if(['type','value','at','L'].includes(el.dataset.t)) fillFix();
                schedule();
            }));
            box.querySelectorAll('input[type=radio],input[type=checkbox],select').forEach(el => el.addEventListener('change', schedule));
            q('type').addEventListener('change', () => { q('value').value = q('type').value === 'inc' ? 60 : f(st[Math.floor(st.length / 2)][q('type').value], 1); fillFix(); schedule(); });
            q('x').addEventListener('click', () => { clearGhost(); box.innerHTML = ''; });
            q('apply').addEventListener('click', () => {
                if(!last || last.error) return;
                if(last.info.maxDls > n(q('maxDls').value) + 1e-9 && !confirm('Max DLS ' + f(last.info.maxDls,2) + ' exceeds the allowed ' + q('maxDls').value + '. Apply anyway?')) return;
                (sc._undo = sc._undo || []).push(JSON.parse(JSON.stringify(sc.sections)));
                sc.sections = last.sections;
                clearGhost(); box.innerHTML = '';
                refresh(sc); renderEditor();
            });
            q('copy').addEventListener('click', async () => {
                if(!last || last.error) return;
                const design = designOf(sc); design.sections = last.sections; design.name = sc.name + ' + tangent';
                let doc;
                try { doc = await apiJson('/notes/iplan/' + NOTE_ID, 'POST', design); }
                catch(err){ alert('Could not create the copy: ' + err.message); return; }
                const nsc = fromDoc(doc); nsc.visible = true;
                scenarios.push(nsc); selId = nsc.id;
                clearGhost(); box.innerHTML = '';
                compute(nsc); draw(nsc); drawTargets(nsc);
                window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: nsc.id } }));
                setSaveStatus(nsc, 'Saved ✓'); renderList(); renderEditor();
            });
            fillFix(); run();
        }

        // ---------- AC toolcode (STEP 3, 2026-10-10) ----------
        // Same MWD/EMS/DIPMETER (no GYRO) list the Anti-collision Plots offer,
        // read from the same /data/iscwsaToolcodes.json. '' = inherit from the
        // selected planned well (its saved toolcode, else MWD+LRGM default).
        let TOOLCODE_NAMES = null;
        fetch('/data/iscwsaToolcodes.json').then(r => r.json()).then(data => {
            TOOLCODE_NAMES = Object.keys(data).filter(nm => (nm.indexOf('MWD') === 0 || nm.indexOf('EMS') === 0 || nm.indexOf('DIPMETER') === 0) && nm.indexOf('GYRO') === -1).sort();
            const sel = document.getElementById('iplToolcode');
            const sc = scenarios.find(x => x.id === selId);
            if(sel && sc) sel.innerHTML = toolcodeOptions(sc);
        }).catch(err => console.warn('[iPlan] toolcode list not loaded', err));
        function toolcodeOptions(sc){
            const w = wellById(sc.wellId);
            const inh = (w && w.toolcode) ? w.toolcode : 'MWD+LRGM';
            const names = TOOLCODE_NAMES || (sc.toolcode ? [sc.toolcode] : []);
            return `<option value="" ${!sc.toolcode ? 'selected' : ''}>Inherit from planned well (${esc(inh)})</option>` +
                names.map(nm => `<option value="${esc(nm)}" ${nm === sc.toolcode ? 'selected' : ''}>${esc(nm)}</option>`).join('');
        }
        // AC toolcode dropdown changed while a scenario was the reference well
        window.addEventListener('iplanToolcodeChangedFromAC', e => {
            const sel = document.getElementById('iplToolcode');
            const sc = scenarios.find(x => x.id === selId);
            if(sel && sc && e.detail && e.detail.id === sc.id) sel.innerHTML = toolcodeOptions(sc);
            const changed = scenarios.find(x => e.detail && x.id === e.detail.id);
            if(changed) markDirty(changed);
        });

        function renderListNamesOnly(){
            const rows = document.querySelectorAll('#iplList .ipl-scn .nm');
            scenarios.forEach((sc, i) => { if(rows[i]) rows[i].textContent = sc.name; });
        }

        function defaultSection(kind, from){
            const s = { kind };
            (C.KIND_FIELDS[kind] || []).forEach(([k, , def]) => { s[k] = (from && from[k] !== undefined) ? from[k] : def; });
            return s;
        }

        function renderSections(sc){
            const box = document.getElementById('iplSections');
            box.innerHTML = '';
            if(!sc.sections.length){ box.innerHTML = '<div style="color:var(--wbt-text-dim);margin-bottom:4px;">No sections yet.</div>'; }
            sc.sections.forEach((s, i) => {
                const row = document.createElement('div');
                row.className = 'ipl-sec';
                const kindOpts = Object.keys(C.KIND_LABEL).map(k => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${C.KIND_LABEL[k]}</option>`).join('');
                const flds = (C.KIND_FIELDS[s.kind] || []).map(([k, lbl]) =>
                    `<span class="fld"><span>${lbl}</span><input type="number" step="0.1" data-k="${k}" value="${s[k]}"></span>`).join('');
                row.innerHTML = `<span class="idx">#${i + 1}</span>
                    <select data-role="kind">${kindOpts}</select>${flds}
                    ${(s.targetTvd !== undefined && sc.targets.length) ? `<select data-role="fromT" title="Set Target TVD from a scenario target"><option value="">TVD from target…</option>${sc.targets.map((t, ti) => `<option value="${ti}">T${ti + 1} ${esc(t.name)} (TVD ${f(tvdOf(sc, t),1)})</option>`).join('')}</select>` : ''}
                    <button type="button" class="wbt-btn" data-role="up" style="padding:1px 6px;" title="Move up">&uarr;</button>
                    <button type="button" class="wbt-btn" data-role="del" style="padding:1px 6px;" title="Delete">&times;</button>
                    <div class="ipl-res" data-role="res"></div>`;
                row.querySelector('[data-role=kind]').addEventListener('change', e => {
                    sc.sections[i] = defaultSection(e.target.value, s);
                    refresh(sc); renderSections(sc); updateResults(sc);
                });
                row.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', e => {
                    s[e.target.dataset.k] = n(e.target.value); refresh(sc); updateResults(sc);
                }));
                const fromT = row.querySelector('[data-role=fromT]');
                if(fromT) fromT.addEventListener('change', e => {
                    const t = sc.targets[parseInt(e.target.value, 10)];
                    if(!t) return;
                    s.targetTvd = Math.round(tvdOf(sc, t) * 100) / 100; // Sub-Sea -> TVD with scenario RKB
                    refresh(sc); renderSections(sc); updateResults(sc);
                });
                row.querySelector('[data-role=del]').addEventListener('click', () => {
                    sc.sections.splice(i, 1); refresh(sc); renderSections(sc); updateResults(sc);
                });
                row.querySelector('[data-role=up]').addEventListener('click', () => {
                    if(i === 0) return;
                    [sc.sections[i - 1], sc.sections[i]] = [sc.sections[i], sc.sections[i - 1]];
                    refresh(sc); renderSections(sc); updateResults(sc);
                });
                box.appendChild(row);
            });
        }

        // Updates only result text (keeps input focus while typing).
        function updateResults(sc){
            try { renderGrid(sc); } catch(e){ console.warn('iPlan grid', e); }   // 2026-11-06: keep the plan grid in sync
            const c = sc._calc || {};
            const tie = document.getElementById('iplTieInfo');
            if(tie){
                tie.innerHTML = c.error ? `<span style="color:#ff4c4c;">${esc(c.error)}</span>`
                    : `Tie-on point: MD ${f(c.start.md,1)} &middot; Inc ${f(c.start.inc,2)}° &middot; Az ${f(c.start.az,2)}° &middot; TVD ${f(c.start.tvd,2)} &middot; N ${f(c.start.n,2)} &middot; E ${f(c.start.e,2)} &middot; RKB ${f(c.start.rkb,2)}`;
            }
            const rows = document.querySelectorAll('#iplSections .ipl-sec');
            rows.forEach((row, i) => {
                const el = row.querySelector('[data-role=res]');
                const r = c.sections && c.sections[i];
                if(c.error || !r){ el.textContent = ''; el.className = 'ipl-res'; return; }
                el.className = 'ipl-res' + (r.warning ? ' bad' : '');
                el.innerHTML = r.warning ? esc(r.warning)
                    : `&rarr; MD ${f(r.startMd + r.cl,1)} &middot; Inc ${f(r.endInc,2)}° &middot; Az ${f(r.endAz,2)}° &middot; TVD ${f(r.startTvd + r.dTvd,2)} &middot; CL ${f(r.cl,1)} m` +
                      (r.tf !== undefined ? ` &middot; TF (auto) ${f(r.tf,1)}°` : '');
            });
            document.querySelectorAll('#iplTargets .ipl-sec').forEach((row, i) => {
                const el = row.querySelector('[data-role=tres]');
                const t = sc.targets[i];
                const fb = (!c.error && t) ? targetFeedback(sc, t) : null;
                if(!fb){ el.textContent = ''; el.className = 'ipl-res'; return; }
                el.className = 'ipl-res' + (fb.hit ? '' : ' bad');
                const tt = row.querySelector('[data-role=ttvd]'); if(tt) tt.textContent = '(TVD ' + f(tvdOf(sc, t),1) + ')';
                el.innerHTML = `${fb.hit ? '&#10004; WITHIN RADIUS' : '&#10008; MISSED'} &middot; closest approach ${f(fb.best,1)} m at MD ${f(fb.bestMd,1)} &middot; from trajectory end ${f(fb.fin,1)} m`;
                if(fb.hit) el.style.color = '#00e676'; else el.style.color = '';
            });
            const sum = document.getElementById('iplSummary');
            if(sum){
                if(c.error || !c.stations){ sum.textContent = ''; return; }
                const last = c.stations[c.stations.length - 1];
                sum.innerHTML = `End: MD ${f(last.md,1)} &middot; Inc ${f(last.inc,2)}° &middot; Az ${f(last.az,2)}° &middot; TVD ${f(last.tvd,2)} &middot; N ${f(last.n,2)} &middot; E ${f(last.e,2)} &middot; ${c.stations.length} stations`;
            }
        }

        function downloadCsv(sc){
            const c = sc._calc;
            if(!c || c.error || !c.stations){ alert('Nothing to export: ' + ((c && c.error) || 'no stations')); return; }
            const head = ['MD (m)','Incl (deg)','Azim (deg)','TVD (m)','Sub-Sea (m)','Northing','Easting','DLS (deg/30m)','Section'];
            const lines = [head.join(',')].concat(c.stations.map(s => [
                s.md.toFixed(2), s.inc.toFixed(3), s.az.toFixed(3), s.tvd.toFixed(2), s.subSea.toFixed(2),
                s.n.toFixed(3), s.e.toFixed(3), s.dls30.toFixed(2), s.section ? '#' + s.section : 'Start'
            ].join(',')));
            const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (sc.name || 'scenario').replace(/[^\w\- ]+/g, '_') + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }

        // ---------- new scenario ----------
        document.getElementById('iplNewBtn').addEventListener('click', async () => {
            if(!WELLS.length){ alert('No planned wellbores with survey data on this job.'); return; }
            const w = WELLS[0];
            const design = {
                name: 'Scenario ' + (scenarios.length + 1), startMode: 'surface', wellId: String(w._id), tieMd: 0,
                start: surfaceStartFromWell(w), sections: [], targets: [], toolcode: null
            };
            let doc;
            try { doc = await apiJson('/notes/iplan/' + NOTE_ID, 'POST', design); }
            catch(err){ alert('Could not create scenario: ' + err.message); return; }
            const sc = fromDoc(doc);
            sc.visible = true;                       // the one you just created is shown
            scenarios.push(sc); selId = sc.id;
            compute(sc); draw(sc); drawTargets(sc);  // no autosave needed: just created
            window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { id: sc.id } }));
            setSaveStatus(sc, 'Saved ✓');
            renderList(); renderEditor();
        });
        document.getElementById('iplHead').addEventListener('click', () => document.getElementById('iplRoot').classList.toggle('open'));
        renderList();

        // ================= iPad — Pad Planner (ADDED 2026-10-12, phase 1) =================
        // Surfaces (Name, N, E, Sub-Sea) + Targets (Name, N, E, Sub-Sea, Inc, Az) — from
        // a pattern or pasted from Excel — assigned by order (surface i -> target i).
        // Template solved per well with IPlanCore.padSolveWell (see its comment).
        // Sub-Sea convention = the survey tables': Sub-Sea = RKB elevation - TVD, so a
        // SURFACE's Sub-Sea is its RKB elevation, and target TVD = surface SS - target SS.
        // Wells are created as normal iPlan scenarios with group = the pad name.
        const ipd = {
            surfaces: [], targets: [], tds: [], alignAz: false,
            // ADDED 2026-11-01 (John): design rules (IPlanCore.padRuleCheck). No nudge above 10 deg ON by default
            // (tolerance 2 deg: a pure turn at constant DLS dips Inc ~2 deg — seen on pad 163 W2 70 -> 68 while turning,
            // that is not a nudge); max turn 90 deg ON; formation zones (Sub-Sea) optional.
            rules: { noNudge:{ on:true, incMin:10, tol:0.5, windows:[] }, maxTurn:{ on:true, deg:90 }, zones:[] },   // 2026-11-01 (John): TD targets + 'align ICP azimuth to TD'
            tpl: { mode:'back', kop:150, kopStep:10, dls:6, incT:80, lt:30, lateral:800, maxDls:10, tangents:'83/30, 85/30, 90/30',  // 2026-10-12: 'turn'; 2026-10-31: 'back' default
                   // 2026-10-31 (John): "Back-projected from ICP" design freedoms (IPlanCore.padSolveBack). KOP = surface casing (one per pad) + 20 m (+ optional stagger).
                   sc:130, backKopStep:0, back:{ t1Min:70, t1Max:75, t2Min:80, t2Max:85, L1:30, L2:30, dMin:6, dMax:9, dFMin:4, dFMax:6, dTvd1Min:28, dTvd1Max:38, dTvd2Min:5, dTvd2Max:8, objective:'short', icpAlong:0, icpAcross:0,
                   autoKopStep:40, nudgeOn:true, nudgeKop:50, nudgeDls:4, nudgeIncMax:6 } },   // 2026-10-31: auto KOP stagger + AC nudge (Design Codes "AC Nudges")   // 2026-10-31: Delta TVD per pump tangent; ICP tolerance (used by Avoidance)
            name: 'Pad iPad', refWell: WELLS.length ? String(WELLS[0]._id) : '', preview: null, ghosts: [], showExisting: true,
            plotZoom: 1, plotFit: 'slots',
            formations: []   // 2026-10-31 (John): [{name, ss}] pasted Formation / Subsea table -> formation-top comments in the export   // 2026-10-31: slot plot zoom (wheel / buttons); fit to the pad's slots by default
        };
        // ADDED 2026-10-31 (John): pre-loaded test setups (button "Load pre-loaded"). Pad 163 = John's
        // 14-06-069-04W4 Pad163 [P3-2316]: surfaces [N, E, Sub-Sea] and ICPs [N, E, Sub-Sea, Inc, Az] as he gave them.
        const IPD_PRESETS = {
            'Pad 163 (14-06-069-04W4, P3-2316)': {
                surfaces: [[6089002.11,525531.03,713.24],[6089036.99,525520.95,713.24],[6089002.08,525521.03,713.24],[6089036.97,525510.96,713.24],[6089002.06,525511.04,713.24],[6089036.94,525500.96,713.24],[6089002.04,525501.04,713.24],[6089036.92,525490.96,713.24],[6089002.01,525491.05,713.24],[6089036.9,525480.97,713.24],[6089001.99,525481.05,713.24],[6089036.87,525470.97,713.24],[6089001.96,525471.05,713.24],[6089036.85,525460.98,713.24],[6089001.94,525461.06,713.24],[6089036.83,525450.98,713.24],[6089001.92,525451.06,713.24],[6089036.8,525440.98,713.24],[6089001.89,525441.06,713.24],[6089036.78,525430.99,713.24],[6089001.87,525431.07,713.24],[6089036.76,525420.99,713.24],[6089001.85,525421.07,713.24],[6089036.76,525410.99,713.24],[6089001.82,525411.08,713.24]],
                targets:  [[6089280.0,526035.0,219.0,90.0,0.0],[6089280.0,525975.0,219.05,90.0,0.2],[6089280.0,525915.0,219.77,90.0,0.0],[6089280.0,525855.0,220.46,90.0,0.0],[6089280.0,525795.0,220.5,90.0,0.0],[6089335.17,525735.06,220.49,90.0,0.0],[6089358.32,525667.82,220.48,90.0,0.0],[6089357.89,525612.61,220.46,90.0,0.0],[6089358.96,525555.0,219.23,90.0,0.0],[6089358.51,525495.0,219.0,90.0,0.0],[6089358.5,525435.0,219.17,90.0,0.0],[6089358.51,525375.0,221.55,90.0,0.0],[6089358.5,525315.0,222.0,90.0,0.0],[6089358.5,525255.0,222.73,90.0,0.0],[6089358.5,525195.0,223.5,90.0,0.0],[6089358.5,525135.0,223.46,90.0,0.0],[6089358.5,525075.0,223.33,90.0,0.0],[6089358.51,525015.0,222.98,90.0,0.0],[6089358.5,524955.0,222.59,90.0,0.0],[6089358.5,524895.0,222.5,90.0,0.3],[6089358.5,524835.0,222.6,90.0,0.0],[6089358.5,524775.0,223.26,90.0,0.0],[6089358.51,524715.0,223.74,90.0,0.0],[6089358.5,524655.0,223.53,90.0,0.0],[6089358.51,524595.0,223.5,90.0,357.0]],
                // ADDED 2026-11-01 (John): TDs [N, E, Sub-Sea, Inc, Az] as he gave them
                tds:      [[6091300.10,526033.25,221.52,90,0],[6091312.76,525974.98,222.01,90,0],[6091304.60,525915.00,222.52,90,0],[6091305.53,525855.00,222.96,90,0],[6091290.40,525795.00,222.96,90,0],[6091275.37,525735.00,222.99,90,0],[6091277.07,525674.93,223.27,90,0],[6091293.73,525615.00,223.88,90,0],[6091300.95,525555.00,223.80,90,0],[6091306.97,525495.00,223.72,90,0],[6091294.65,525435.00,223.79,90,0],[6091301.48,525375.00,223.72,90,0],[6091177.75,525315.00,223.35,90,0],[6090703.12,525255.00,225.88,90,0],[6090688.84,525195.00,225.97,90,0],[6090704.74,525135.00,226.01,90,0],[6090683.60,525074.83,226.23,90,0],[6090676.89,525015.00,227.33,90,0],[6090691.39,524955.00,227.90,90,0],[6090681.58,524894.72,225.26,90,0],[6090693.58,524835.00,227.98,90,0],[6090700.19,524774.94,228.53,90,0],[6090699.65,524714.99,230.22,90,0],[6090694.50,524654.94,230.84,90,0],[6090676.22,524594.84,230.34,90,0]]
            }
        };
        const ipdRoot = document.getElementById('ipdRoot');
        // 2026-10-31 (John): iPad preview ghost thickness = "iPad previews" slider (Line Thickness panel).
        function ipdScaleGhost(m){
            const el = document.getElementById('wbtLineThicknessIpad'), k = el ? (parseFloat(el.value) || 1) : 1, u = m.userData || {};
            if(!u.curve) return;
            m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(u.curve, u.tubularSegments, u.baseRadius * k, 6, false);
        }
        window.addEventListener('wbtThicknessChanged', () => (ipd.ghosts || []).forEach(ipdScaleGhost));
        // ADDED 2026-10-31 (John): spheres at every point that gets an export Comment (same list as the Excel
        // "Comments" column, via ipdCommentedStations). Size = "iPad markers" slider (Line Thickness panel),
        // visibility = its "show" tick. Hover not needed: colour per comment kind; mixed comments take the first.
        const IPD_MK_COL = { SurfaceCasing:0xb0b0b0, Nudge:0xff9800, KickOff:0x00e5ff, 'Start Steamflood Tang':0x00e676, 'End Steamflood Tang':0x00e676, 'Start Tang':0x76ff03, 'End Tang':0x76ff03, IntermediateCasing:0xe040fb, TD:0xff4c4c, 'Start Lateral Avoidance':0xffeb3b, 'End Lateral Avoidance':0xffeb3b };   // 2026-11-01: lateral avoidance = yellow
        ipd.markers = [];
        function ipdMkK(){ const el = document.getElementById('wbtIpadMkSize'); return el ? (parseFloat(el.value) || 1) : 1; }
        function ipdMkShow(){ const el = document.getElementById('wbtIpadMkShow'); return !el || el.checked; }
        function ipdClearMarkers(){ ipd.markers.forEach(m => { api.getGroup().remove(m); m.geometry.dispose(); m.material.dispose(); }); ipd.markers = []; }
        function ipdBuildMarkers(wells){
            ipdClearMarkers();
            const k = ipdMkK(), vis = ipdMkShow();
            wells.forEach((w, wi) => {
                const g = ipd.ghosts.find(x => x.userData && x.userData.ipdWell === wi), base = g && g.userData.baseRadius ? g.userData.baseRadius * 3 : 3;
                let pts = []; try { pts = ipdCommentedStations(w).filter(p => p.comment); } catch(e){ return; }
                pts.forEach(p => {
                    const first = String(p.comment).split(';')[0].trim(), col = IPD_MK_COL[first] != null ? IPD_MK_COL[first] : 0xffffff;   // white = formation top
                    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: col }));
                    m.position.set(p.e, n(w.s.ss) - p.tvd, -p.n); m.userData.mkBase = base; m.scale.setScalar(base * k); m.visible = vis;
                    m.userData.label = w.name + ' — ' + p.comment + ' @ MD ' + p.md.toFixed(1);
                    api.getGroup().add(m); ipd.markers.push(m);
                });
            });
        }
        function ipdMkUpdate(){ const k = ipdMkK(), vis = ipdMkShow(), lb = document.getElementById('wbtLtIpadMkVal'); if(lb) lb.textContent = '× ' + k.toFixed(1);
            ipd.markers.forEach(m => { m.scale.setScalar(m.userData.mkBase * k); m.visible = vis; }); }
        ['wbtIpadMkSize','wbtIpadMkShow'].forEach(id => { const el = document.getElementById(id); if(el){ el.addEventListener('input', ipdMkUpdate); el.addEventListener('change', ipdMkUpdate); } });
        function ipdClearGhosts(){ ipdClearMarkers(); ipd.ghosts.forEach(m => { api.getGroup().remove(m); m.geometry.dispose(); m.material.dispose(); }); ipd.ghosts = []; if(typeof ipdClearTunnels === 'function') ipdClearTunnels(); }   // 2026-10-31: tunnels go with the preview
        function ipdParse(text, cols){
            // tab / comma / semicolon separated; header row skipped if its numeric columns aren't numbers;
            // Name column optional (rows with one fewer value get an automatic name).
            const rows = [];
            String(text || '').split(/\r?\n/).forEach(line => {
                const c = line.split(/\t|;|,/).map(x => x.trim()).filter((x, i, a) => !(x === '' && i === a.length - 1));
                if(!c.length || c.every(x => x === '')) return;
                let name = null, nums = c;
                if(c.length >= cols && isNaN(parseFloat(c[0]))){ name = c[0]; nums = c.slice(1); }
                if(nums.length < cols - 1 || nums.slice(0, cols - 1).some(x => isNaN(parseFloat(x)))) return; // header / junk
                rows.push({ name, v: nums.slice(0, cols - 1).map(Number) });
            });
            return rows;
        }
        function ipdTableHtml(kind){
            const T = kind === 's' ? ipd.surfaces : kind === 'd' ? ipd.tds : ipd.targets;   // 2026-11-01: 'd' = TDs
            const cols = kind === 's' ? [['name','Name','text'],['n','Northing'],['e','Easting'],['ss','Sub-Sea (RKB elev.)']]
                                      : [['name','Name','text'],['n','Northing'],['e','Easting'],['ss','Sub-Sea'],['inc','Inc (°)'],['az','Az (°)']];
            if(!T.length) return '<div style="color:var(--wbt-text-dim);">No rows yet.</div>';
            return `<div style="max-height:220px;overflow:auto;"><table style="font-size:11px;"><tr><th>#</th>${cols.map(c => `<th style="padding:0 4px;">${c[1]}</th>`).join('')}<th></th></tr>` +
                T.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(([k, , t]) => `<td><input type="${t || 'number'}" step="0.01" data-${kind}="${i}" data-k="${k}" value="${esc(r[k])}" style="width:${t ? '120px' : '100px'};"></td>`).join('')}
                    <td><button type="button" class="wbt-btn" data-${kind}del="${i}" style="padding:0 6px;">&times;</button></td></tr>`).join('') + '</table></div>';
        }
        function ipdGroups(){
            const g = {}; scenarios.forEach(sc => { if(sc.group) (g[sc.group] = g[sc.group] || []).push(sc); });
            return g;
        }
        function ipdRender(){
            const body = document.getElementById('ipdBody'); const t = ipd.tpl;
            const groups = ipdGroups();
            body.innerHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                <label style="color:var(--wbt-text-dim);">Pad name</label><input type="text" id="ipdName" value="${esc(ipd.name)}" style="width:160px;">
                <select id="ipdPresetSel" style="margin-left:8px;" title="Pre-loaded surfaces + ICPs (2026-10-31)">${Object.keys(IPD_PRESETS).map(k => `<option>${esc(k)}</option>`).join('')}</select>
                <button type="button" class="wbt-btn" id="ipdPresetLoad" title="Replaces the Surfaces and Targets tables">&#11014; Load pre-loaded</button>
                <span style="font-size:10px;color:var(--wbt-text-dim);">wells → "${esc(ipd.name)} W01…"</span>
                <label style="color:var(--wbt-text-dim);">Reference planned well (magnetics / AC toolcode)</label><select id="ipdRef" style="max-width:260px;">${wellOptions(ipd.refWell)}</select>
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;">
              <div style="flex:1;min-width:420px;">
                <div class="ipl-h">1 · Surfaces (slots)</div>
                <div class="ipl-sec" style="display:block;">
                    <div style="font-size:11px;color:var(--wbt-text-dim);">Pattern — numbered row by row; row 2 is offset to the RIGHT of the row direction</div>
                    <div class="ipl-grid" style="grid-template-columns:repeat(6,auto);">
                        <label>1st slot N</label><input type="number" step="0.01" id="ipsN" value="${WELLS.length ? f(surfaceStartFromWell(WELLS[0]).n,2) : 0}">
                        <label>1st slot E</label><input type="number" step="0.01" id="ipsE" value="${WELLS.length ? f(surfaceStartFromWell(WELLS[0]).e,2) : 0}">
                        <label>RKB elev. (Sub-Sea)</label><input type="number" step="0.01" id="ipsSS" value="${WELLS.length ? f(wellRkb(WELLS[0]),2) : 0}">
                        <label>Rows</label><input type="number" step="1" id="ipsRows" value="1">
                        <label>Slots per row</label><input type="number" step="1" id="ipsPer" value="10">
                        <label>Slot spacing (m)</label><input type="number" step="0.1" id="ipsSp" value="7">
                        <label>Row spacing (m)</label><input type="number" step="0.1" id="ipsRSp" value="15">
                        <label>Row azimuth (°)</label><input type="number" step="0.1" id="ipsAz" value="90">
                    </div>
                    <button type="button" class="wbt-btn" id="ipsGen">Generate surfaces</button>
                    <details style="margin-top:4px;"><summary style="font-size:11px;cursor:pointer;">Paste from Excel (Name, N, E, Sub-Sea)</summary>
                        <textarea id="ipsPaste" rows="4" style="width:100%;font-family:var(--wbt-mono);font-size:11px;background:var(--wbt-panel2);color:var(--wbt-text);"></textarea>
                        <button type="button" class="wbt-btn" id="ipsLoad">Load pasted (replaces table)</button></details>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin-top:6px;">
                        <div style="flex:1;min-width:300px;">
                            <div id="ipsTable">${ipdTableHtml('s')}</div>
                            <button type="button" class="wbt-btn" id="ipsAdd">+ row</button> <button type="button" class="wbt-btn" id="ipsClr">Clear</button>
                        </div>
                        <div><div style="display:flex;gap:4px;margin-bottom:3px;font-size:10px;align-items:center;">
                                <button type="button" class="wbt-btn" id="ipsZoomIn" style="padding:0 7px;" title="Zoom in (or mouse wheel)">+</button>
                                <button type="button" class="wbt-btn" id="ipsZoomOut" style="padding:0 7px;" title="Zoom out (or mouse wheel)">&minus;</button>
                                <button type="button" class="wbt-btn" id="ipsFitSlots" style="padding:0 6px;" title="Fit to this pad's slots">Fit pad</button>
                                <button type="button" class="wbt-btn" id="ipsFitAll" style="padding:0 6px;" title="Fit pad + existing wells">Fit all</button></div>
                            <div id="ipsPlot"></div>
                            <label style="font-size:10px;color:var(--wbt-text-dim);"><input type="checkbox" id="ipsPlotExisting" ${ipd.showExisting ? 'checked' : ''}> show existing planned wells' surfaces</label></div>
                    </div>
                </div>
              </div>
              <div style="flex:1;min-width:480px;">
                <div class="ipl-h">2 · Targets (landing points)</div>
                <div class="ipl-sec" style="display:block;">
                    <div style="font-size:11px;color:var(--wbt-text-dim);">Pattern — landings spaced along a direction, same Sub-Sea / Inc / Az</div>
                    <div class="ipl-grid" style="grid-template-columns:repeat(6,auto);">
                        <label>1st landing N</label><input type="number" step="0.01" id="iptN" value="0">
                        <label>1st landing E</label><input type="number" step="0.01" id="iptE" value="0">
                        <label>Landing Sub-Sea</label><input type="number" step="0.01" id="iptSS" value="0">
                        <label>Count</label><input type="number" step="1" id="iptCnt" value="10">
                        <label>Spacing (m)</label><input type="number" step="0.1" id="iptSp" value="70">
                        <label>Spacing az (°)</label><input type="number" step="0.1" id="iptSpAz" value="90">
                        <label>Landing Inc (°)</label><input type="number" step="0.1" id="iptInc" value="90">
                        <label>Lateral Az (°)</label><input type="number" step="0.1" id="iptAz" value="180">
                    </div>
                    <button type="button" class="wbt-btn" id="iptGen">Generate targets</button>
                    <details style="margin-top:4px;"><summary style="font-size:11px;cursor:pointer;">Paste from Excel (Name, N, E, Sub-Sea, Inc, Az)</summary>
                        <textarea id="iptPaste" rows="4" style="width:100%;font-family:var(--wbt-mono);font-size:11px;background:var(--wbt-panel2);color:var(--wbt-text);"></textarea>
                        <button type="button" class="wbt-btn" id="iptLoad">Load pasted (replaces table)</button></details>
                    <div id="iptTable" style="margin-top:6px;">${ipdTableHtml('t')}</div>
                    <button type="button" class="wbt-btn" id="iptAdd">+ row</button> <button type="button" class="wbt-btn" id="iptClr">Clear</button>
                </div>
                <!-- ADDED 2026-11-01 (John): TD targets. Assigned by order like the ICPs (ICP i -> TD i). With a TD the
                     lateral is a hold at the ICP Inc/Az ending abreast of the TD (replaces "Lateral length" for that well);
                     "Align ICP azimuth to TD" overwrites each ICP Az with the grid azimuth ICP -> TD. -->
                <div class="ipl-h">2b · TDs (lateral end, optional)</div>
                <div class="ipl-sec" style="display:block;">
                    <label><input type="checkbox" id="ipdAlignAz" ${ipd.alignAz ? 'checked' : ''}> Align ICP azimuth to the TD (overwrites the ICP Az in table 2)</label>
                    <details style="margin-top:4px;"><summary style="font-size:11px;cursor:pointer;">Paste from Excel (Name, N, E, Sub-Sea, Inc, Az)</summary>
                        <textarea id="ipdPaste" rows="4" style="width:100%;font-family:var(--wbt-mono);font-size:11px;background:var(--wbt-panel2);color:var(--wbt-text);"></textarea>
                        <button type="button" class="wbt-btn" id="ipdTdLoad">Load pasted (replaces table)</button></details>
                    <div style="margin-top:6px;">${ipdTableHtml('d')}</div>
                    <button type="button" class="wbt-btn" id="ipdTdAdd">+ row</button> <button type="button" class="wbt-btn" id="ipdTdClr">Clear</button>
                    <span style="font-size:10px;color:var(--wbt-text-dim);margin-left:6px;">No TD for a well → the "Lateral length" setting is used. TD Inc/Az are informative only.</span>
                </div>
              </div>
            </div>
            <!-- 2026-10-31 (John): formation tops for the export comments — pasted from Excel (Formation, Subsea) -->
            <div class="ipl-h">Formations (for the export comments)</div>
            <div class="ipl-sec" style="display:block;">
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-bottom:3px;">Paste 2 columns from Excel: <b>Formation</b>, <b>Subsea</b> (header row optional). Each top is written in the export's Comments column where the well crosses that Subsea (formations taken as flat). Empty table = no formation comments (design comments only).</div>
                <details><summary style="cursor:pointer;font-size:11px;">Paste from Excel</summary>
                    <textarea id="ipfPaste" rows="4" style="width:100%;font-family:var(--wbt-mono);font-size:11px;background:var(--wbt-panel2);color:var(--wbt-text);" placeholder="QUATERNARY&#9;639.82&#10;NIOBRARA&#9;527.81"></textarea>
                    <button type="button" class="wbt-btn" id="ipfLoad">Load pasted (replaces table)</button></details>
                <div style="max-height:200px;overflow:auto;margin-top:4px;">${ipd.formations.length ? `<table style="font-size:11px;"><tr><th>#</th><th>Formation</th><th>Subsea (m)</th><th></th></tr>` +
                    ipd.formations.map((f0, i) => `<tr><td>${i + 1}</td><td><input type="text" data-f="${i}" data-k="name" value="${esc(f0.name)}" style="width:180px;"></td><td><input type="number" step="0.01" data-f="${i}" data-k="ss" value="${esc(f0.ss)}" style="width:90px;"></td><td><button type="button" class="wbt-btn" data-fdel="${i}" style="padding:0 6px;">&times;</button></td></tr>`).join('') + '</table>'
                    : '<div style="color:var(--wbt-text-dim);">No formations — the export will have design comments only.</div>'}</div>
                <button type="button" class="wbt-btn" id="ipfAdd">+ row</button> <button type="button" class="wbt-btn" id="ipfClr">Clear</button>
            </div>
            <div class="ipl-h">3 · Template (assigned by order: surface 1 → target 1, …)</div>
            <div class="ipl-sec" style="display:block;">
                <div style="font-size:11px;color:var(--wbt-text-dim);margin-bottom:4px;">Vertical → KOP → curve 1 (builds &amp; turns) → tangent → curve 2 to landing Inc/Az → lateral. Landing N/E/TVD needs 3 solved values per well: the tangent azimuth + two more:</div>
 <select id="ipdMode" style="max-width:520px;">
                    <option value="back" ${t.mode === 'back' ? 'selected' : ''}>Back-projected from ICP (Compass style): SC + 20 m → optimum align (curve-hold-curve) → tangent 1 → curve → tangent 2 → ICP, with ranges</option>
                    <option value="turn" ${t.mode === 'turn' ? 'selected' : ''}>Build &amp; turn early (recommended): fixed KOP &amp; tangents → solve curve A Inc/Az + one DLS</option>
                    <option value="kop_dls12" ${t.mode === 'kop_dls12' ? 'selected' : ''}>Fixed KOP &amp; tangent → solve DLS curve 1 + DLS curve 2</option>
                    <option value="kop_dls_len" ${t.mode === 'kop_dls_len' ? 'selected' : ''}>Fixed KOP &amp; tangent Inc → solve one shared DLS + tangent length</option>
                    <option value="dls_kop_len" ${t.mode === 'dls_kop_len' ? 'selected' : ''}>Fixed DLS (both curves) &amp; tangent Inc → solve KOP + tangent length</option>
                </select>
                <div id="ipdBackBox" style="display:${t.mode === 'back' ? 'block' : 'none'};margin:6px 0;border:1px solid var(--wbt-border);border-radius:4px;padding:6px;">
                    <div style="font-size:11px;color:var(--wbt-text-dim);margin-bottom:4px;">Design freedoms (2026-10-31). Built backwards from the ICP like in Compass: final curve → tangent 2 (lateral azimuth) → curve → tangent 1 (azimuth free) → optimum align (curve – hold – curve, hold length free) up to KOP = surface casing + 20 m. ICP Sub-Sea / N / E / Inc / Az are fixed (targets table). Inside the ranges the solver picks the design by the objective; values sitting on a range limit are listed per well.</div>
                    <div class="ipl-grid" style="grid-template-columns:repeat(6,auto);">
                        <label>Surface casing TVD (pad, m)</label><input type="number" step="1" data-tb="sc" value="${t.sc}">
                        <label>KOP = SC + 20, stagger / well (m)</label><input type="number" step="1" data-tb="backKopStep" value="${t.backKopStep}">
                        <label>Objective</label><select data-tbo="objective">
                            <option value="short" ${t.back.objective === 'short' ? 'selected' : ''}>Shortest build (MD to ICP)</option>
                            <option value="smooth" ${t.back.objective === 'smooth' ? 'selected' : ''}>Smoothest (lowest DLS)</option>
                            <option value="typical" ${t.back.objective === 'typical' ? 'selected' : ''}>Typical (middle of the ranges)</option></select>
                        <label>Upper tangent T1 Inc min–max (°)</label><span><input type="number" step="0.5" data-tbb="t1Min" value="${t.back.t1Min}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="t1Max" value="${t.back.t1Max}" style="width:55px;"></span>
                        <label>Upper tangent T1 length ≥ (m)</label><input type="number" step="1" data-tbb="L1" value="${t.back.L1}">
                        <label>Curve DLS min–max (°/30m)</label><span><input type="number" step="0.5" data-tbb="dMin" value="${t.back.dMin}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="dMax" value="${t.back.dMax}" style="width:55px;"></span>
                        <label>Lower tangent T2 (near ICP) Inc min–max (°)</label><span><input type="number" step="0.5" data-tbb="t2Min" value="${t.back.t2Min}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="t2Max" value="${t.back.t2Max}" style="width:55px;"></span>
                        <label>Lower tangent T2 length ≥ (m)</label><input type="number" step="1" data-tbb="L2" value="${t.back.L2}">
                        <label>Final curve DLS min–max (°/30m)</label><span><input type="number" step="0.5" data-tbb="dFMin" value="${t.back.dFMin}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="dFMax" value="${t.back.dFMax}" style="width:55px;"></span>
                        <label>Δ TVD ICP − bottom of T1 (m)</label><span><input type="number" step="0.5" data-tbb="dTvd1Min" value="${t.back.dTvd1Min}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="dTvd1Max" value="${t.back.dTvd1Max}" style="width:55px;"></span>
                        <label title="Neighbouring slots get different KOPs (level x step), like the hand designs. 0 = off (uses the linear stagger)">Auto KOP stagger step (m, 0 = off)</label><input type="number" step="5" min="0" data-tbb="autoKopStep" value="${t.back.autoKopStep}">
                        <label title="AC nudge used by Avoidance: vertical to the nudge KOP, build at the nudge DLS to up to the max Inc (in 8 directions), hold to the main KOP">AC nudge (Avoidance): KOP TVD / DLS / max Inc</label><span><input type="checkbox" data-tbc="nudgeOn" ${t.back.nudgeOn ? 'checked' : ''}> <input type="number" step="5" min="0" data-tbb="nudgeKop" value="${t.back.nudgeKop}" style="width:50px;"> / <input type="number" step="0.5" min="0.5" data-tbb="nudgeDls" value="${t.back.nudgeDls}" style="width:45px;"> / <input type="number" step="0.5" min="0" data-tbb="nudgeIncMax" value="${t.back.nudgeIncMax}" style="width:45px;"></span>
                        <label title="Used by Avoidance: the ICP may move this much along / across the lateral (Sub-Sea fixed)">ICP tolerance ± along / ± across lateral (m)</label><span><input type="number" step="1" min="0" data-tbb="icpAlong" value="${t.back.icpAlong || 0}" style="width:55px;"> / <input type="number" step="1" min="0" data-tbb="icpAcross" value="${t.back.icpAcross || 0}" style="width:55px;"></span>
                        <label>Δ TVD ICP − bottom of T2 (m)</label><span><input type="number" step="0.5" data-tbb="dTvd2Min" value="${t.back.dTvd2Min}" style="width:55px;"> – <input type="number" step="0.5" data-tbb="dTvd2Max" value="${t.back.dTvd2Max}" style="width:55px;"></span>
                    </div>
                    <div style="font-size:10px;color:var(--wbt-text-dim);">Takes ~2 s per well. Lateral length and Max DLS below still apply.</div>
                </div>
                <div class="ipl-grid" style="grid-template-columns:repeat(8,auto);">
                    <label>KOP 1st well (m)</label><input type="number" step="1" data-tp="kop" value="${t.kop}">
                    <label>KOP stagger / well (m)</label><input type="number" step="1" data-tp="kopStep" value="${t.kopStep}">
                    <label>DLS (°/30m)</label><input type="number" step="0.1" data-tp="dls" value="${t.dls}">
                    <label>Tangent Inc (°)</label><input type="number" step="0.1" data-tp="incT" value="${t.incT}">
                    <label>Tangent length (m)</label><input type="number" step="1" data-tp="lt" value="${t.lt}">
                    <label>Lateral length (m)</label><input type="number" step="1" data-tp="lateral" value="${t.lateral}">
                    <label>Max DLS (°/30m)</label><input type="number" step="0.1" data-tp="maxDls" value="${t.maxDls}">
                </div>
                <div class="fld" style="margin:4px 0;"><span style="width:250px;display:inline-block;">Tangents (Inc/Length, on lateral azimuth)</span>
                    <input type="text" id="ipdTangents" value="${esc(t.tangents)}" style="width:260px;" title="e.g. 83/30, 85/30, 90/30 — the last one ends at the landing / ICP">
                    <span style="font-size:10px;color:var(--wbt-text-dim);">"Build &amp; turn early" only — e.g. 83/30, 85/30, 90/30 (the last tangent ends at the landing / ICP)</span></div>
                <div style="font-size:10px;color:var(--wbt-text-dim);">Fixed values are used as entered; the solved ones replace them per well. In "solve KOP" mode the KOP fields are only the starting guess.</div>
                ${ipdRulesHtml()}
                <button type="button" class="wbt-btn" id="ipdPreview" style="margin-top:6px;">&#128269; Preview</button>
                <div id="ipdOut" style="margin-top:6px;"></div>
            </div>
            <div class="ipl-h">Pad groups on this job</div>
            <div>${Object.keys(groups).length ? Object.keys(groups).map(g => `<div class="ipl-sec"><span style="flex:1;">${esc(g)} &middot; ${groups[g].length} well(s)</span>
                <button type="button" class="wbt-btn" data-gshow="${esc(g)}">Show all</button>
                <button type="button" class="wbt-btn" data-ghide="${esc(g)}">Hide all</button>
                <button type="button" class="wbt-btn" data-gdel="${esc(g)}" style="color:#ff4c4c;">Delete group</button></div>`).join('') : '<div style="color:var(--wbt-text-dim);">None yet.</div>'}</div>`;
            ipdWire();
        }
        function ipdNum(id){ return n(document.getElementById(id).value); }

        // ADDED 2026-10-12: plan-view plot of the surface slots (true N/E, equal
        // scale, East right / North up), redrawn live as the table changes.
        // Optional grey dots = surfaces (first station) of the job's planned wells.
        function ipdSlotPlot(){
            const box = document.getElementById('ipsPlot'); if(!box) return;
            const W = 300, H = 280, pad = 34;
            const slots = ipd.surfaces.map(s => ({ n:n(s.n), e:n(s.e), name:s.name }));
            const ex = ipd.showExisting ? WELLS.map(w => { const s0 = surfaceStartFromWell(w); return { n:s0.n, e:s0.e, name:w.wellName }; }) : [];
            const all = slots.concat(ex);
            const light = document.body.classList.contains('light-mode');
            const bg = light ? '#ffffff' : '#000000', grid = light ? '#d0d7de' : '#3a3f44', txt = light ? '#000000' : '#ffffff';
            if(!all.length){ box.innerHTML = `<svg width="${W}" height="${H}" style="background:${bg};border:1px solid var(--wbt-border);"><text x="${W/2}" y="${H/2}" fill="${txt}" font-size="11" text-anchor="middle">No slots yet</text></svg>`; return; }
            // 2026-10-31: view = the pad's slots ("Fit pad", default) or everything ("Fit all"), divided by the zoom factor
            const fitPts = (ipd.plotFit === 'slots' && slots.length) ? slots : all;
            let minE = Math.min(...fitPts.map(p => p.e)), maxE = Math.max(...fitPts.map(p => p.e));
            let minN = Math.min(...fitPts.map(p => p.n)), maxN = Math.max(...fitPts.map(p => p.n));
            const span = Math.max(maxE - minE, maxN - minN, 10) * 1.4 / (ipd.plotZoom || 1);   // equal scale in both axes; margin for labels
            const cE = (minE + maxE) / 2, cN = (minN + maxN) / 2;
            minE = cE - span / 2; maxE = cE + span / 2; minN = cN - span / 2; maxN = cN + span / 2;
            const sz = Math.min(W, H) - 2 * pad;
            const X = e => pad + (e - minE) / span * sz, Y = nn => pad + (maxN - nn) / span * sz;
            const raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(k => k * mag).find(v => v >= raw);
            let g = '';
            for(let e = Math.ceil(minE / step) * step; e <= maxE; e += step) g += `<line x1="${X(e)}" y1="${pad}" x2="${X(e)}" y2="${pad + sz}" stroke="${grid}" stroke-width="0.6"/><text x="${X(e)}" y="${pad + sz + 11}" fill="${txt}" font-size="8" text-anchor="middle">${Math.round(e % 1000)}</text>`;
            for(let nn = Math.ceil(minN / step) * step; nn <= maxN; nn += step) g += `<line x1="${pad}" y1="${Y(nn)}" x2="${pad + sz}" y2="${Y(nn)}" stroke="${grid}" stroke-width="0.6"/><text x="${pad - 3}" y="${Y(nn) + 3}" fill="${txt}" font-size="8" text-anchor="end">${Math.round(nn % 1000)}</text>`;
            const exDots = ex.map(p => `<circle cx="${X(p.e)}" cy="${Y(p.n)}" r="2.5" fill="#888"><title>${esc(p.name)}</title></circle>`).join('');
            const dots = slots.map(p => `<circle cx="${X(p.e)}" cy="${Y(p.n)}" r="4.5" fill="#ffffff" stroke="#00c8ff" stroke-width="2"><title>${esc(p.name)}: N ${f(p.n,2)} · E ${f(p.e,2)}</title></circle>
                <text x="${X(p.e) + 7}" y="${Y(p.n) + 4}" fill="${txt}" font-size="10" font-weight="700">${esc(p.name)}</text>`).join('');
            const north = `<g transform="translate(${pad + sz - 10},${pad + 14})"><path d="M0,-10 L5,4 L0,1 L-5,4 Z" fill="${txt}"/><text x="0" y="15" fill="${txt}" font-size="9" text-anchor="middle">N</text></g>`;
            box.innerHTML = `<svg width="${W}" height="${H}" style="background:${bg};border:1px solid var(--wbt-border);" role="img" aria-label="Surface slot layout, plan view">
                <rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>${g}<rect x="${pad}" y="${pad}" width="${sz}" height="${sz}" fill="none" stroke="${grid}"/>
                ${exDots}${dots}${north}
                <text x="${pad + sz / 2}" y="${H - 4}" fill="${txt}" font-size="9" text-anchor="middle">Easting (last 3 digits, m) · grid ${step} m</text>
                <text x="10" y="${pad + sz / 2}" fill="${txt}" font-size="9" text-anchor="middle" transform="rotate(-90 10 ${pad + sz / 2})">Northing</text></svg>`;
        }
        function ipdWire(){
            const g = id => document.getElementById(id);
            g('ipdName').addEventListener('input', e => { ipd.name = e.target.value; });
            g('ipdPresetLoad').addEventListener('click', () => {   // 2026-10-31: pre-loaded setups
                const k = g('ipdPresetSel').value, P = IPD_PRESETS[k]; if(!P) return;
                if((ipd.surfaces.length || ipd.targets.length) && !confirm('Replace the current Surfaces and Targets with "' + k + '"?')) return;
                ipd.surfaces = P.surfaces.map((r, i) => ({ name:'S' + String(i + 1).padStart(2, '0'), n:r[0], e:r[1], ss:r[2] }));
                ipd.targets  = P.targets.map((r, i) => ({ name:'T' + String(i + 1).padStart(2, '0'), n:r[0], e:r[1], ss:r[2], inc:r[3], az:r[4] }));
                ipd.tds = (P.tds || []).map((r, i) => ({ name:'TD' + String(i + 1).padStart(2, '0'), n:r[0], e:r[1], ss:r[2], inc:r[3], az:r[4] }));   // 2026-11-01
                if(ipd.alignAz) ipdAlignAz();
                ipd.plotFit = 'slots'; ipd.plotZoom = 1;
                ipdRender();
            });
            g('ipdRef').addEventListener('change', e => { ipd.refWell = e.target.value; });
            g('ipdMode').addEventListener('change', e => { ipd.tpl.mode = e.target.value; g('ipdBackBox').style.display = e.target.value === 'back' ? 'block' : 'none'; });
            document.querySelectorAll('#ipdBody [data-tb]').forEach(el => el.addEventListener('input', e => { ipd.tpl[e.target.dataset.tb] = n(e.target.value); }));   // 2026-10-31
            document.querySelectorAll('#ipdBody [data-tbb]').forEach(el => el.addEventListener('input', e => { ipd.tpl.back[e.target.dataset.tbb] = n(e.target.value); }));
            document.querySelectorAll('#ipdBody [data-tbc]').forEach(el => el.addEventListener('change', e => { ipd.tpl.back[e.target.dataset.tbc] = e.target.checked; }));   // 2026-10-31
            document.querySelectorAll('#ipdBody [data-tbo]').forEach(el => el.addEventListener('change', e => { ipd.tpl.back[e.target.dataset.tbo] = e.target.value; }));
            g('ipdTangents').addEventListener('input', e => { ipd.tpl.tangents = e.target.value; });
            document.querySelectorAll('#ipdBody [data-tp]').forEach(el => el.addEventListener('input', e => { ipd.tpl[e.target.dataset.tp] = n(e.target.value); }));
            g('ipsGen').addEventListener('click', () => {
                const ss = ipdNum('ipsSS');
                ipd.surfaces = C.padSlotPattern({ n:ipdNum('ipsN'), e:ipdNum('ipsE'), rows:Math.max(1, Math.round(ipdNum('ipsRows'))), perRow:Math.max(1, Math.round(ipdNum('ipsPer'))),
                    spacing:ipdNum('ipsSp'), rowSpacing:ipdNum('ipsRSp'), rowAz:ipdNum('ipsAz') })
                    .map((p, i) => ({ name:'S' + String(i + 1).padStart(2, '0'), n:+p.n.toFixed(3), e:+p.e.toFixed(3), ss }));
                ipdRender();
            });
            g('iptGen').addEventListener('click', () => {
                ipd.targets = C.padTargetPattern({ n:ipdNum('iptN'), e:ipdNum('iptE'), count:Math.max(1, Math.round(ipdNum('iptCnt'))), spacing:ipdNum('iptSp'),
                    spacingAz:ipdNum('iptSpAz'), ss:ipdNum('iptSS'), inc:ipdNum('iptInc'), az:ipdNum('iptAz') })
                    .map((p, i) => ({ name:'T' + String(i + 1).padStart(2, '0'), n:+p.n.toFixed(3), e:+p.e.toFixed(3), ss:p.ss, inc:p.inc, az:p.az }));
                ipdRender();
            });
            g('ipsLoad').addEventListener('click', () => {
                const r = ipdParse(g('ipsPaste').value, 4);
                if(!r.length){ alert('No rows recognised. Expected: Name, N, E, Sub-Sea (Name optional).'); return; }
                ipd.surfaces = r.map((x, i) => ({ name: x.name || ('S' + String(i + 1).padStart(2, '0')), n:x.v[0], e:x.v[1], ss:x.v[2] }));
                ipdRender();
            });
            // 2026-10-31: formations table
            g('ipfLoad').addEventListener('click', () => {
                const r = ipdParse(g('ipfPaste').value, 2);
                if(!r.length){ alert('No rows recognised. Expected 2 columns: Formation, Subsea.'); return; }
                ipd.formations = r.filter(x => x.name).map(x => ({ name: x.name, ss: x.v[0] }));
                ipdRender();
            });
            g('ipfAdd').addEventListener('click', () => { ipd.formations.push({ name: 'NEW', ss: 0 }); ipdRender(); });
            g('ipfClr').addEventListener('click', () => { ipd.formations = []; ipdRender(); });
            document.querySelectorAll('#ipdBody [data-f]').forEach(el => el.addEventListener('input', e => { const f0 = ipd.formations[+e.target.dataset.f]; if(f0) f0[e.target.dataset.k] = e.target.dataset.k === 'ss' ? n(e.target.value) : e.target.value; }));
            document.querySelectorAll('#ipdBody [data-fdel]').forEach(el => el.addEventListener('click', e => { ipd.formations.splice(+e.currentTarget.dataset.fdel, 1); ipdRender(); }));
            g('iptLoad').addEventListener('click', () => {
                const r = ipdParse(g('iptPaste').value, 6);
                if(!r.length){ alert('No rows recognised. Expected: Name, N, E, Sub-Sea, Inc, Az (Name optional).'); return; }
                ipd.targets = r.map((x, i) => ({ name: x.name || ('T' + String(i + 1).padStart(2, '0')), n:x.v[0], e:x.v[1], ss:x.v[2], inc:x.v[3], az:x.v[4] }));
                ipdRender();
            });
            // 2026-11-01: TDs table + align ICP azimuth
            g('ipdTdLoad').addEventListener('click', () => {
                const r = ipdParse(g('ipdPaste').value, 6);
                if(!r.length){ alert('No rows recognised. Expected: Name, N, E, Sub-Sea, Inc, Az (Name optional).'); return; }
                ipd.tds = r.map((x, i) => ({ name: x.name || ('TD' + String(i + 1).padStart(2, '0')), n:x.v[0], e:x.v[1], ss:x.v[2], inc:x.v[3], az:x.v[4] }));
                if(ipd.alignAz) ipdAlignAz(); ipdRender();
            });
            g('ipdTdAdd').addEventListener('click', () => { const L = ipd.tds[ipd.tds.length - 1] || { n:0, e:0, ss:0, inc:90, az:0 }; ipd.tds.push(Object.assign({}, L, { name:'TD' + String(ipd.tds.length + 1).padStart(2, '0') })); ipdRender(); });
            g('ipdTdClr').addEventListener('click', () => { ipd.tds = []; ipdRender(); });
            g('ipdAlignAz').addEventListener('change', e => { ipd.alignAz = e.target.checked; if(ipd.alignAz){ ipdAlignAz(); ipdRender(); } });
            document.querySelectorAll('#ipdBody [data-d]').forEach(el => el.addEventListener('input', e => { const r0 = ipd.tds[+e.target.dataset.d], k = e.target.dataset.k; if(r0) r0[k] = k === 'name' ? e.target.value : n(e.target.value); }));
            document.querySelectorAll('#ipdBody [data-ddel]').forEach(b => b.addEventListener('click', () => { ipd.tds.splice(+b.dataset.ddel, 1); ipdRender(); }));
            g('ipsAdd').addEventListener('click', () => { const L = ipd.surfaces[ipd.surfaces.length - 1] || { n:0, e:0, ss:0 }; ipd.surfaces.push({ name:'S' + String(ipd.surfaces.length + 1).padStart(2, '0'), n:L.n, e:L.e, ss:L.ss }); ipdRender(); });
            g('iptAdd').addEventListener('click', () => { const L = ipd.targets[ipd.targets.length - 1] || { n:0, e:0, ss:0, inc:90, az:0 }; ipd.targets.push(Object.assign({}, L, { name:'T' + String(ipd.targets.length + 1).padStart(2, '0') })); ipdRender(); });
            g('ipsClr').addEventListener('click', () => { ipd.surfaces = []; ipdRender(); });
            g('iptClr').addEventListener('click', () => { ipd.targets = []; ipdRender(); });
            document.querySelectorAll('#ipdBody [data-s],#ipdBody [data-t]').forEach(el => el.addEventListener('input', e => {
                const arr = e.target.dataset.s !== undefined ? ipd.surfaces : ipd.targets, i = +(e.target.dataset.s !== undefined ? e.target.dataset.s : e.target.dataset.t), k = e.target.dataset.k;
                arr[i][k] = k === 'name' ? e.target.value : n(e.target.value);
                if(arr === ipd.surfaces) ipdSlotPlot();   // live slot plot
            }));
            document.querySelectorAll('#ipdBody [data-sdel],#ipdBody [data-tdel]').forEach(b => b.addEventListener('click', () => {
                if(b.dataset.sdel !== undefined) ipd.surfaces.splice(+b.dataset.sdel, 1); else ipd.targets.splice(+b.dataset.tdel, 1);
                ipdRender();
            }));
            g('ipdPreview').addEventListener('click', ipdRunPreview);
            ipdWireRules();   // 2026-11-01
            g('ipsPlotExisting').addEventListener('change', e => { ipd.showExisting = e.target.checked; ipdSlotPlot(); });
            // 2026-10-31: slot plot zoom
            const zoom = k => { ipd.plotZoom = Math.min(200, Math.max(0.05, ipd.plotZoom * k)); ipdSlotPlot(); };
            g('ipsZoomIn').addEventListener('click', () => zoom(1.5));
            g('ipsZoomOut').addEventListener('click', () => zoom(1 / 1.5));
            g('ipsFitSlots').addEventListener('click', () => { ipd.plotFit = 'slots'; ipd.plotZoom = 1; ipdSlotPlot(); });
            g('ipsFitAll').addEventListener('click', () => { ipd.plotFit = 'all'; ipd.plotZoom = 1; ipdSlotPlot(); });
            g('ipsPlot').addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
            ipdSlotPlot();
            document.querySelectorAll('#ipdBody [data-gshow],#ipdBody [data-ghide]').forEach(b => b.addEventListener('click', () => {
                const name = b.dataset.gshow || b.dataset.ghide, vis = !!b.dataset.gshow;
                scenarios.filter(sc => sc.group === name).forEach(sc => { sc.visible = vis; if(!sc._calc) compute(sc); draw(sc); drawTargets(sc); });
                window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { group: name } }));
                renderList();
            }));
            document.querySelectorAll('#ipdBody [data-gdel]').forEach(b => b.addEventListener('click', async () => {
                const name = b.dataset.gdel, list = scenarios.filter(sc => sc.group === name);
                if(!confirm('Delete pad group "' + name + '" (' + list.length + ' scenarios) for everyone on this job?')) return;
                for(const sc of list){
                    try { await apiJson('/notes/iplan/' + sc.id, 'DELETE'); } catch(err){ alert('Could not delete ' + sc.name + ': ' + err.message); break; }
                    clearTimeout(sc._saveTimer); removeMesh(sc); removeTargetMeshes(sc);
                    scenarios.splice(scenarios.indexOf(sc), 1);
                    if(selId === sc.id) selId = null;
                }
                if(!selId && scenarios.length) selId = scenarios[0].id;
                window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { group: name, deleted: true } }));
                renderList(); renderEditor(); ipdRender();
            }));
        }
        // ADDED 2026-11-01 (John): TDs. Grid azimuth ICP -> TD = atan2(dE, dN) (0-360°), written into the ICP
        // table when "Align ICP azimuth to the TD" is ticked (also re-applied before each Preview, so edited
        // TDs / ICPs are honoured). Lateral length to a TD: hold at the ICP attitude, length chosen so the
        // horizontal advance along the ICP azimuth equals the TD's: L = h / sin(Inc), h = dN cos(Az) + dE sin(Az).
        // The end point can miss the TD (off-azimuth if not aligned, vertically if TD Sub-Sea != the hold's);
        // the miss is reported per well ("TD miss") instead of bending the lateral.
        function ipdAzTo(a, b){ let z = Math.atan2(n(b.e) - n(a.e), n(b.n) - n(a.n)) * 180 / Math.PI; if(z < 0) z += 360; return z; }
        function ipdAlignAz(){ ipd.targets.forEach((tg, i) => { const td = ipd.tds[i]; if(td) tg.az = +ipdAzTo(tg, td).toFixed(2); }); }
        function ipdLatOf(i, land){
            const td = ipd.tds[i]; if(!td) return n(ipd.tpl.lateral);
            const az = n(land.az) * Math.PI / 180, h = (n(td.n) - n(land.n)) * Math.cos(az) + (n(td.e) - n(land.e)) * Math.sin(az), si = Math.sin(n(land.inc) * Math.PI / 180);
            return (h > 0 && si > 1e-3) ? h / si : 0;
        }
        function ipdTdMiss(w){
            const td = ipd.tds[w.i]; if(!td || !w.st.length) return null; const p = w.st[w.st.length - 1];
            return { d: Math.hypot(p.n - n(td.n), p.e - n(td.e), (n(w.s.ss) - p.tvd) - n(td.ss)), dv: (n(w.s.ss) - p.tvd) - n(td.ss) };
        }
        // ---------- iPad: Design rules (ADDED 2026-11-01, John) ----------
        // Used by the "Back-projected" solver as a filter (rule-clean designs first; if none, KOP raised in 10 m steps
        // down to surface casing + 20; if still none, the design with the fewest violations is kept and flagged red)
        // and as a checker on every preview well (any template, after Avoidance / lateral avoidance too).
        function ipdRulesHtml(){
            const R = ipd.rules, nn = R.noNudge, mt = R.maxTurn;
            const fOpts = (ipd.formations || []).map((f0, i) => `<option value="${i}">${esc(f0.name)} (${f(n(f0.ss),1)})</option>`).join('');
            return `<div style="margin:6px 0;border:1px solid var(--wbt-border);border-radius:4px;padding:6px;">
                <div style="font-weight:700;font-size:11px;margin-bottom:3px;">Design rules</div>
                <div><label><input type="checkbox" data-rl="noNudge.on" ${nn.on ? 'checked' : ''}> No nudge above</label> <input type="number" step="1" data-rl="noNudge.incMin" value="${nn.incMin}" style="width:50px;">°
                    <span style="margin-left:6px;" title="Max allowed drop between section ends (2026-11-01: measured per section, so turns that dip Inc inside an arc are not flagged; keep it small, e.g. 0.5)">drop tolerance</span> <input type="number" step="0.5" data-rl="noNudge.tol" value="${nn.tol}" style="width:50px;">°
                    <span style="margin-left:6px;" title="Peak inclination windows where a nudge IS allowed, e.g. 30-40, 60-65">nudge allowed at Inc</span> <input type="text" id="ipdRlWin" value="${esc((nn.windows || []).map(w => w.a + '-' + w.b).join(', '))}" placeholder="e.g. 30-40" style="width:110px;">
                    <span style="font-size:10px;color:var(--wbt-text-dim);">(nudge = build, optional tangent, drop; lateral excluded)</span></div>
                <div style="margin-top:3px;"><label><input type="checkbox" data-rl="maxTurn.on" ${mt.on ? 'checked' : ''}> Max turn</label> <input type="number" step="5" data-rl="maxTurn.deg" value="${mt.deg}" style="width:55px;">° <span style="font-size:10px;color:var(--wbt-text-dim);">(azimuth range from Inc ≥ 3° to the ICP)</span></div>
                <div style="margin-top:3px;">Formation zones (Sub-Sea) ${fOpts ? `<select id="ipdRlFm"><option value="">+ zone from formation…</option>${fOpts}</select>` : ''} <button type="button" class="wbt-btn" id="ipdRlZoneAdd" style="padding:0 6px;">+ zone</button></div>
                ${R.zones.length ? `<table style="font-size:11px;margin-top:3px;"><tr><th>On</th><th>Name</th><th>Top SS</th><th>Base SS</th><th>Max DLS</th><th>Inc min</th><th>Inc max</th><th>No drop</th><th></th></tr>` +
                    R.zones.map((z, i) => `<tr><td><input type="checkbox" data-rz="${i}" data-k="on" ${z.on !== false ? 'checked' : ''}></td><td><input type="text" data-rz="${i}" data-k="name" value="${esc(z.name)}" style="width:110px;"></td>` +
                        ['top','base','dlsMax','incMin','incMax'].map(k => `<td><input type="number" step="0.1" data-rz="${i}" data-k="${k}" value="${z[k] == null ? '' : esc(z[k])}" style="width:70px;"></td>`).join('') +
                        `<td><input type="checkbox" data-rz="${i}" data-k="noDrop" ${z.noDrop ? 'checked' : ''}></td><td><button type="button" class="wbt-btn" data-rzdel="${i}" style="padding:0 6px;">&times;</button></td></tr>`).join('') + '</table>' : ''}
            </div>`;
        }
        function ipdWireRules(){
            const R = ipd.rules, g = id => document.getElementById(id);
            document.querySelectorAll('#ipdBody [data-rl]').forEach(el => el.addEventListener('change', e => { const [a, k] = e.target.dataset.rl.split('.'); R[a][k] = e.target.type === 'checkbox' ? e.target.checked : n(e.target.value); }));
            const win = g('ipdRlWin'); if(win) win.addEventListener('change', e => { R.noNudge.windows = String(e.target.value).split(/[,;]/).map(x => x.split('-').map(Number)).filter(a => a.length === 2 && a.every(isFinite)).map(([a, b]) => ({ a: Math.min(a, b), b: Math.max(a, b) })); });
            document.querySelectorAll('#ipdBody [data-rz]').forEach(el => el.addEventListener('change', e => { const z = R.zones[+e.target.dataset.rz], k = e.target.dataset.k; if(!z) return;
                z[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'name' ? e.target.value : (e.target.value === '' ? null : n(e.target.value)); }));
            document.querySelectorAll('#ipdBody [data-rzdel]').forEach(b => b.addEventListener('click', () => { R.zones.splice(+b.dataset.rzdel, 1); ipdRender(); }));
            if(g('ipdRlZoneAdd')) g('ipdRlZoneAdd').addEventListener('click', () => { R.zones.push({ on:true, name:'Zone ' + (R.zones.length + 1), top:0, base:0, dlsMax:null, incMin:null, incMax:null, noDrop:false }); ipdRender(); });
            if(g('ipdRlFm')) g('ipdRlFm').addEventListener('change', e => { if(e.target.value === '') return; const F = ipd.formations, i = +e.target.value, f0 = F[i];
                const below = F.filter(x => n(x.ss) < n(f0.ss)).sort((a, b) => n(b.ss) - n(a.ss))[0];   // next deeper top = base
                R.zones.push({ on:true, name:f0.name, top:n(f0.ss), base: below ? n(below.ss) : n(f0.ss) - 50, dlsMax:null, incMin:null, incMax:null, noDrop:false }); ipdRender(); });
        }
        const ipdRulesForSolver = () => C.padRulesActive(ipd.rules) ? JSON.parse(JSON.stringify(ipd.rules)) : null;
        async function ipdRunPreview(){   // 2026-10-31: async so the slower "back" template can show progress
            ipdClearGhosts();
            const out = document.getElementById('ipdOut'), t = ipd.tpl;
            if(ipd.alignAz && ipd.tds.length){ ipdAlignAz(); ipd.targets.forEach((tg, i) => { const el = document.querySelector(`#ipdBody [data-t="${i}"][data-k="az"]`); if(el) el.value = tg.az; }); }   // 2026-11-01
            const N = Math.min(ipd.surfaces.length, ipd.targets.length);
            if(!N){ out.innerHTML = '<span style="color:#ff4c4c;">Add surfaces and targets first.</span>'; return; }
            const wells = [];
            for(let i = 0; i < N; i++){
                if(t.mode === 'back'){ out.innerHTML = `<span style="color:var(--wbt-text-dim);">Designing well ${i + 1} of ${N}…</span>`; await new Promise(res => setTimeout(res, 0)); }
                const s = ipd.surfaces[i], tg = ipd.targets[i];
                const land = { n:n(tg.n), e:n(tg.e), tvd:n(s.ss) - n(tg.ss), inc:n(tg.inc), az:n(tg.az) };
                const tangents = String(t.tangents || '').split(/[,;]/).map(x => x.split('/').map(Number)).filter(a => a.length === 2 && a.every(isFinite)).map(([inc, L]) => ({ inc, L }));
                const r = t.mode === 'back'
                    ? C.padSolveWell({ n:n(s.n), e:n(s.e), rkb:n(s.ss) }, land, { mode:'back', kop:ipdKopOf(i), lateral:ipdLatOf(i, land), back:Object.assign({}, t.back), rules:ipdRulesForSolver(), kopMin:n(t.sc) + 20 })   // 2026-11-01: design rules
                    : C.padSolveWell({ n:n(s.n), e:n(s.e), rkb:n(s.ss) }, land, { mode:t.mode, kop:t.kop + i * t.kopStep, dls:t.dls, incT:t.incT, lt:t.lt, lateral:ipdLatOf(i, land), tangents });   // 2026-11-01: lateral to TD
                wells.push(ipdMakeWell(i, s, tg, land, r));
            }
            ipd.previewOrig = null; ipd.avoidHtml = '';   // 2026-10-31: a new preview drops any Avoidance result
            ipd.latOrig = null; ipd.latHtml = '';   // 2026-11-01: ... and any lateral avoidance
            ipdShowPreview(wells, N);
        }
        // 2026-10-31 (refactor for Avoidance): one preview well + its ghost line; preview table + buttons.
        // ADDED 2026-10-31 (John): KOP of well i for the back template = SC + 20 + automatic stagger
        // (IPlanCore.padKopStagger: neighbouring slots get different KOP levels, level x step) when the
        // "Auto KOP stagger step" > 0, else the old linear stagger (i x backKopStep).
        function ipdKopOf(i){
            const t = ipd.tpl, base = n(t.sc) + 20, step = n(t.back.autoKopStep);
            if(step > 0){ const offs = C.padKopStagger(ipd.surfaces.map(s => ({ n:n(s.n), e:n(s.e) })), step); return base + (offs[i] || 0); }
            return base + i * n(t.backKopStep);
        }
        function ipdMakeWell(i, s, tg, land, r){
            const t = ipd.tpl, name = ipd.name + ' W' + String(i + 1).padStart(2, '0');
            const st = r.sections ? C.computeStations({ md:0, tvd:0, n:n(s.n), e:n(s.e), inc:0, az:0 }, r.sections, STEP).stations : [];
            const latL = ipdLatOf(i, land);   // 2026-11-01: per-well lateral (TD) instead of the pad setting
            const landMd = !r.sections ? null : r.tags ? r.sections.reduce((a, x, k) => a + (r.tags[k] === 'lateral' ? 0 : x.cl), 0)   // 2026-11-01: lateral may be several sections (lateral avoidance)
                : r.sections.slice(0, latL > 1e-6 ? -1 : undefined).reduce((a, x) => a + x.cl, 0);
            const viol = (st.length && C.padRulesActive(ipd.rules)) ? C.padRuleCheck(st, ipd.rules, n(s.ss), landMd) : [];   // 2026-11-01: design rules checker
            return { i, name, s, tg, land, r, st, landMd, viol, tdMd: st.length ? st[st.length - 1].md : null, over: r.maxDls > t.maxDls + 1e-9 };
        }
        function ipdShowPreview(wells, N){
            const out = document.getElementById('ipdOut'), t = ipd.tpl;
            ipdClearGhosts();
            wells.forEach(w => { if(w.st.length > 1){
                const g = api.buildWellLine(w.st.map(p => new THREE.Vector3(p.e, n(w.s.ss) - p.tvd, -p.n)), (w.r.ok && !w.over && !(w.viol || []).length) ? 0xffd060 : 0xff4c4c);   // 2026-11-01: rule violations red
                ipdScaleGhost(g);   // 2026-10-31: "iPad previews" thickness slider
                g.userData.ipdWell = wells.indexOf(w);
                g.userData.pickName = w.name + ' (iPad preview)';   // 2026-11-02
                g.userData.pick = () => ({ name: w.name + ' (iPad preview)', color: (w.r.ok && !w.over && !(w.viol || []).length) ? 0xffd060 : 0xff4c4c,   // 2026-11-01: profile panel
                    rows: (pts => pts.map((p, k) => { let d = p.dls; for(let j = k + 1; (d == null || !isFinite(d)) && j < pts.length; j++) d = pts[j].dls;   // inserted comment points take the next station's DLS
                        return { md: p.md, inc: p.inc, az: p.az, tvd: p.tvd, ss: n(w.s.ss) - p.tvd, dls: d, n: p.n, e: p.e, comment: p.comment || '' }; }))(ipdCommentedStations(w)),
                    // AC pseudo-well (same as the Pad separation check: reference well's toolcode / location for magnetics)
                    ac: () => { const A = window.acpPadApi; if(!A) return null; const ref = A.surfaceLatLon(ipd.refWell);
                        return { wellName: '__pf__ ' + w.name, toolcode: ref.toolcode, survey: w.st.map(p => ({ md:p.md, incl:p.inc, azim:p.az, tvd:p.tvd, northing:p.n, easting:p.e, subSea:n(w.s.ss) - p.tvd, latitude:ref.lat, longitude:ref.lon })) }; } });
                api.getGroup().add(g); ipd.ghosts.push(g);
            } });
            ipd.preview = wells;
            try { ipdBuildMarkers(wells); } catch(e){ console.warn('iPad markers', e); }   // 2026-10-31: comment markers
            const good = wells.filter(w => w.r.ok && !w.over).length;
            let warn = '';
            if(ipd.surfaces.length !== ipd.targets.length) warn = `<div style="color:#ffd060;">${ipd.surfaces.length} surfaces vs ${ipd.targets.length} targets — only the first ${N} pairs are planned.</div>`;
            out.innerHTML = warn + `<div style="max-height:300px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);">
                <tr>${['Well','Surface','Target','Status','KOP','Curve A','Hold','DLS 1','DLS 2','Tangent(s)','Tan Az','Landing MD','TD MD','TD miss (m)','Max DLS','Range limits hit','Design rules'].map(h => `<th style="padding:0 6px;text-align:left;">${h}</th>`).join('')}</tr>` +
                wells.map(w => { const p = w.r.params || {}, bad = !w.r.ok || w.over || (w.viol || []).length;
                    return `<tr style="color:${bad ? '#ff4c4c' : 'inherit'};"><td style="padding:0 6px;">${esc(w.name)}</td><td>${esc(w.s.name)}</td><td>${esc(w.tg.name)}</td>
                    <td title="${esc(w.r.error || '')}">${w.r.ok ? (w.over ? 'DLS > max' : 'OK') : esc(w.r.error || 'failed')}</td>
                    <td>${f(p.kop,1)}</td><td>${p.incA != null ? f(p.incA,1) + '° / Az ' + f(p.azA,1) + '°' : '—'}</td><td>${f(p.hold,0)}</td><td>${f(p.dls1,2)}</td><td>${f(p.dls2,2)}</td>
                    <td>${p.tangents ? p.tangents.map(x => f(x.inc,1) + '°/' + f(x.L,0) + (x.az != null ? ' @' + f(x.az,1) + '°' : '')).join(', ') : f(p.lt,1) + ' m @ ' + f(p.incT,1) + '°'}</td><td>${f(p.azT,1)}°</td>
                    <td>${f(w.landMd,1)}</td><td>${f(w.tdMd,1)}</td><td>${(m => m ? `<span style="color:${m.d > 5 ? '#ff9f1c' : 'inherit'};" title="3D distance end of lateral → TD (vertical ${f(m.dv,2)} m)">${f(m.d,2)}</span>` : '—')(ipdTdMiss(w))}</td><td>${f(w.r.maxDls,2)}</td><td style="padding:0 6px;color:#ffd060;">${esc((w.r.edges || []).join('; '))}</td><td style="padding:0 6px;white-space:normal;color:${(w.viol || []).length ? '#ff4c4c' : '#00e676'};">${(w.viol || []).length ? (w.viol.map(v => esc(v.msg)).join('<br>') + ' <span style="color:var(--wbt-text-dim);">(fewest violations found)</span>') : (C.padRulesActive(ipd.rules) ? 'OK' : '—')}</td></tr>`; }).join('') +
                `</table></div>
                <div style="margin-top:6px;">${good} of ${N} wells OK (yellow ghost lines in 3D; failed / over-DLS wells in red).</div>
                <button type="button" class="wbt-btn" id="ipdCreate" ${good ? '' : 'disabled'}>Create ${good} scenario(s) in group "${esc(ipd.name)}"</button>
                <button type="button" class="wbt-btn" id="ipdClearPv">Clear preview</button>
                <button type="button" class="wbt-btn" id="ipdExport" title="All preview wells, including failed / over-DLS (2026-10-31)">&#11015; Export preview (Excel)</button>
                <button type="button" class="wbt-btn" id="ipdCmpRun" title="Match each iPad well to the existing well on the same slot (2026-10-31)">&#8646; Compare with existing wells</button>
                <div id="ipdCmpOut" style="margin-top:6px;"></div>` + ipdTunnelBlock() + ipdAvoidBlock() + ipdLatBlock() + ipdSepBlock();   // 2026-11-01: lateral tunnel / avoidance   // 2026-10-31: Tunnel + Avoidance before the SF check
            document.getElementById('ipdClearPv').addEventListener('click', () => { ipdClearGhosts(); out.innerHTML = ''; });
            document.getElementById('ipdCreate').addEventListener('click', ipdCreate);
            document.getElementById('ipdExport').addEventListener('click', ipdExportXlsx);   // 2026-10-31
            document.getElementById('ipdCmpRun').addEventListener('click', () => { try { ipdCompareRender(); } catch(err){ document.getElementById('ipdCmpOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; } });
            document.getElementById('ipdTunRun').addEventListener('click', () => { try { ipdRunTunnels(); } catch(err){ document.getElementById('ipdTunOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; } });
            document.getElementById('ipdTunClr').addEventListener('click', () => { ipdClearTunnels(); document.getElementById('ipdTunOut').innerHTML = ''; });
            document.getElementById('ipdAvRun').addEventListener('click', () => { ipdRunAvoid().catch(err => { document.getElementById('ipdAvOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; }); });
            document.getElementById('ipdAvRevert').addEventListener('click', ipdAvoidRevert);
            // 2026-11-01: lateral tunnel / avoidance vs offset wells
            document.getElementById('ipdLatTun').addEventListener('click', () => { try { ipdLatTunnel(); } catch(err){ document.getElementById('ipdLatOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; } });
            document.getElementById('ipdLatRun').addEventListener('click', () => { try { ipdLatAvoid(); } catch(err){ document.getElementById('ipdLatOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; } });
            document.getElementById('ipdLatRevert').addEventListener('click', () => { if(!ipd.latOrig) return; const w = ipd.latOrig; ipd.latOrig = null; ipd.latHtml = ''; ipdShowPreview(w, w.length); });
            document.getElementById('ipdCardsRun').addEventListener('click', () => { try { ipdRunCards(); } catch(err){ document.getElementById('ipdCardsGrid').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; } });   // 2026-11-01
            document.getElementById('ipdSepRun').addEventListener('click', () => { ipdRunSeparation().catch(err => { document.getElementById('ipdSepOut').innerHTML = '<span style="color:#ff4c4c;">' + esc(err.message) + '</span>'; }); });
        }

        // ---------- iPad: export ALL preview wells + compare with existing wells (ADDED 2026-10-31, John) ----------
        // WHY: "Create scenarios" only keeps wells that solved within limits, so failed / over-DLS wells could
        // not be exported to compare a pad (e.g. pad 163) with the real hand-designed wells.
        // Export: every preview well (Status column), summary + 10 m stations (iPad's own computeStations).
        // Compare: each iPad well is matched to the existing (Planned/Subject) well on the same slot = nearest
        // first-station N/E to the iPad surface; if several wells share that slot (within 1 m), the one passing
        // closest to the iPad target wins. Positions compared in Sub-Sea elevation (RKB - TVD) so both use the
        // same vertical datum. Existing-well DLS = dogleg between consecutive survey stations
        // (cos b = cos(I2-I1) - sinI1 sinI2 (1 - cos(A2-A1)), Bourgoyne Eq. 8.33) per 30 m. KOP = first station
        // with Inc >= 1 deg (both wells, same rule). Landing MD = MD of the station closest to the iPad target.
        const D2R_ = Math.PI / 180;
        const dogleg30 = (a, b) => { const cl = n(b.md) - n(a.md); if(!(cl > 0)) return 0;
            const i1 = n(a.inc) * D2R_, i2 = n(b.inc) * D2R_, az1 = n(a.az) * D2R_, az2 = n(b.az) * D2R_;
            const c = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(az2 - az1));
            return Math.acos(Math.max(-1, Math.min(1, c))) / D2R_ * 30 / cl; };
        // existing well -> [{md, inc, az, tvd, n, e, el}] (el = Sub-Sea elevation)
        const exStations = w => { const rkb = wellRkb(w); return sortedSurvey(w).map(r => ({ md:n(r.md), inc:n(r.incl), az:n(r.azim), tvd:n(r.tvd), n:n(r.northing), e:n(r.easting), el: rkb - n(r.tvd) })); };
        const ipdStations = w => (w.st || []).map(p => ({ md:p.md, inc:p.inc, az:p.az, tvd:p.tvd, n:p.n, e:p.e, el: n(w.s.ss) - p.tvd, dls:p.dls30 }));
        const d3 = (a, b) => Math.hypot(a.n - b.n, a.e - b.e, a.el - b.el);
        // distance from point p to polyline pts (segments, linear between stations)
        function distToPath(p, pts){
            let best = Infinity;
            for(let i = 1; i < pts.length; i++){
                const a = pts[i-1], b = pts[i], v = [b.n - a.n, b.e - a.e, b.el - a.el], w0 = [p.n - a.n, p.e - a.e, p.el - a.el];
                const L2 = v[0]*v[0] + v[1]*v[1] + v[2]*v[2]; let t = L2 > 0 ? (w0[0]*v[0] + w0[1]*v[1] + w0[2]*v[2]) / L2 : 0; t = Math.max(0, Math.min(1, t));
                const d = Math.hypot(w0[0] - t*v[0], w0[1] - t*v[1], w0[2] - t*v[2]); if(d < best) best = d;
            }
            return best;
        }
        const kopOf = pts => { const s = pts.find(p => p.inc >= 1); return s ? s.md : null; };
        const maxDlsTo = (pts, mdMax) => { let m = 0; for(let i = 1; i < pts.length && pts[i].md <= mdMax + 1e-6; i++){ m = Math.max(m, pts[i].dls != null ? pts[i].dls : dogleg30(pts[i-1], pts[i])); } return m; };
        function ipdCompareRows(){
            const cands = WELLS.map(w => ({ w, pts: exStations(w) })).filter(x => x.pts.length > 1);
            return (ipd.preview || []).filter(w => w.st && w.st.length > 1).map(w => {
                const ip = ipdStations(w), tgt = { n:n(w.tg.n), e:n(w.tg.e), el:n(w.tg.ss) };
                const sd = cands.map(c => ({ c, d: Math.hypot(c.pts[0].n - n(w.s.n), c.pts[0].e - n(w.s.e)) })).sort((a, b) => a.d - b.d);
                if(!sd.length) return { w, ip, ex: null };
                const slot = sd.filter(x => x.d <= sd[0].d + 1).map(x => Object.assign(x, { dt: Math.min(...x.c.pts.map(p => d3(p, tgt))) })).sort((a, b) => a.dt - b.dt)[0];
                const ex = slot.c.pts, exLand = ex.reduce((b, p) => d3(p, tgt) < d3(b, tgt) ? p : b, ex[0]);
                const ipLandMd = w.landMd != null ? w.landMd : ip[ip.length - 1].md;
                const ipTo = ip.filter(p => p.md <= ipLandMd + 1e-6), dists = ipTo.map(p => distToPath(p, ex));
                return { w, ip, ex: slot.c.w, slotD: slot.d, tgtD: slot.dt,
                    ipKop: kopOf(ip), exKop: kopOf(ex), ipDls: maxDlsTo(ip, ipLandMd), exDls: maxDlsTo(ex, exLand.md),
                    ipLand: ipLandMd, exLand: exLand.md, ipTd: ip[ip.length - 1].md, exTd: ex[ex.length - 1].md,
                    maxD: dists.length ? Math.max(...dists) : null, avgD: dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null };
            });
        }
        const ipdStatus = w => w.r.ok ? (w.over ? 'DLS > max' : (w.viol || []).length ? 'Rules: ' + w.viol.length + ' violation(s)' : 'OK') : (w.r.error || 'failed');   // 2026-11-01: design rules
        function ipdCompareRender(){
            const rows = ipdCompareRows(), out = document.getElementById('ipdCmpOut');
            const th = h => `<th style="padding:0 6px;text-align:left;white-space:nowrap;">${h}</th>`;
            const pair = (a, b, d) => `<td style="padding:0 6px;white-space:nowrap;">${f(a,d)} <span style="color:var(--wbt-text-dim);">/ ${f(b,d)}</span></td>`;
            out.innerHTML = `<div style="max-height:300px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);">
                <tr>${['iPad well','Status','Existing well','Slot Δ (m)','KOP iPad / exist.','Max DLS to landing','Landing MD','TD MD','Path Δ max (m)','Path Δ avg (m)'].map(th).join('')}</tr>` +
                rows.map(x => `<tr style="color:${!x.w.r.ok || x.w.over ? '#ff4c4c' : 'inherit'};"><td style="padding:0 6px;">${esc(x.w.name)}</td><td style="padding:0 6px;">${esc(ipdStatus(x.w))}</td>` +
                    (x.ex ? `<td style="padding:0 6px;">${esc(x.ex.wellName || x.ex.name || '')}</td><td>${f(x.slotD,1)}</td>` + pair(x.ipKop, x.exKop, 1) + pair(x.ipDls, x.exDls, 2) + pair(x.ipLand, x.exLand, 1) + pair(x.ipTd, x.exTd, 1) +
                        `<td style="padding:0 6px;">${f(x.maxD,1)}</td><td style="padding:0 6px;">${f(x.avgD,1)}</td>` : `<td colspan="8" style="padding:0 6px;">no existing well found</td>`) + '</tr>').join('') +
                `</table></div><div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">Matched by nearest slot (first-station N/E); if several wells share the slot, the one closest to the iPad target. "Path Δ" = 3D distance from each iPad station (surface → landing) to the existing well path, Sub-Sea datum. KOP = first Inc ≥ 1°. Existing DLS = station-to-station dogleg per 30 m.</div>`;
            return rows;
        }
        // ADDED 2026-10-31 (John): Compass-style comments for the export "Stations" sheet.
        // Design points (same names as John's Compass wells, which the Trajectories accordion also reads):
        //   SurfaceCasing (back template: surface casing TVD; vertical there, so MD = TVD), KickOff,
        //   Start/End Steamflood Tang (upper tangent T1), Start/End Tang (lower tangent T2),
        //   IntermediateCasing (ICP / landing), TD.
        // Formation tops: names + Sub-Sea taken from the matched existing well (same slot, see Compare) —
        // the comments of its survey that are not design points (same rule as the 3D formations:
        // WBT reserved keywords) — and placed where THIS well's path crosses that Sub-Sea
        // (bisection on min-curvature interpolation, IPlanCore.interpolateSurveyAtMD). Formations are
        // treated as flat at the matched well's top Sub-Sea (as the 3D formation planes are).
        const IPD_RESERVED = ['SURFACECASING','KICKOFF','INTERMEDIATECASING','LANDING','STK','START TANG','END TANG','STEAMFLOOD','TD'];
        function ipdCommentedStations(w, cmp){
            const pts = ipdStations(w); if(pts.length < 2) return pts;
            const surv = pts.map(p => ({ md:p.md, incl:p.inc, azim:p.az, tvd:p.tvd, northing:p.n, easting:p.e }));
            const ss = n(w.s.ss), at = md => { const q = C.interpolateSurveyAtMD(surv, md); return q ? { md:q.md, inc:q.inc, az:q.az, tvd:q.tvd, n:q.n, e:q.e, el:ss - q.tvd, dls:null } : null; };
            const ev = [];   // {md, comment}
            const tags = w.r.tags || [];
            if(w.r.sections){
                let md = 0; const bounds = w.r.sections.map((sec, i) => { const a = md; md += sec.cl; return { tag: tags[i] || '', a, b: md }; });
                const first = t => bounds.find(x => x.tag === t);
                if(ipd.tpl.mode === 'back' && n(ipd.tpl.sc) > 0) ev.push({ md: n(ipd.tpl.sc), comment: 'SurfaceCasing' });
                const pn = w.r.params && w.r.params.nudge;   // 2026-10-31: AC nudge -> "Nudge" at its KOP, KickOff stays at the main KOP
                if(pn) ev.push({ md: pn.kop, comment: 'Nudge' });
                const fp = first('pre');   // 2026-11-06: Deep search well — KickOff where its first tree row starts (params.kop is the tree's end there)
                const kop = fp ? { b: fp.a } : ((!pn && first('kop')) || (w.r.params && w.r.params.kop ? { b: w.r.params.kop } : null)); if(kop) ev.push({ md: kop.b, comment: 'KickOff' });
                const t1 = first('t1'); if(t1){ ev.push({ md: t1.a, comment: 'Start Steamflood Tang' }); ev.push({ md: t1.b, comment: 'End Steamflood Tang' }); }
                const t2 = first('t2'); if(t2){ ev.push({ md: t2.a, comment: 'Start Tang' }); ev.push({ md: t2.b, comment: 'End Tang' }); }
                if(w.landMd != null) ev.push({ md: w.landMd, comment: 'IntermediateCasing' });
                (w.r.latAv || []).forEach(m0 => { ev.push({ md: m0.a, comment: 'Start Lateral Avoidance' }); if(m0.b != null) ev.push({ md: m0.b, comment: 'End Lateral Avoidance' }); });   // 2026-11-01
            }
            // formation tops: ONLY the pasted Formation/Subsea table (CHANGED 2026-10-31, John: no table -> no
            // formation comments; the earlier fallback to the matched existing well's tops was removed).
            const tops = (ipd.formations || []).filter(f0 => String(f0.name || '').trim()).map(f0 => ({ name: String(f0.name).trim(), ss: n(f0.ss) }));
            tops.forEach(tp => {
                const name = tp.name, S = tp.ss;
                for(let i = 1; i < pts.length; i++){
                    if(pts[i - 1].el > S && pts[i].el <= S){
                        let lo = pts[i - 1].md, hi = pts[i].md;
                        for(let k = 0; k < 40; k++){ const m = (lo + hi) / 2, q = at(m); if(!q) break; if(q.el > S) lo = m; else hi = m; }
                        ev.push({ md: hi, comment: name }); break;
                    }
                }
            });
            const out = pts.map(p => Object.assign({}, p));
            ev.forEach(e => {
                const hit = out.find(p => Math.abs(p.md - e.md) < 0.005);
                if(hit){ hit.comment = hit.comment ? hit.comment + '; ' + e.comment : e.comment; return; }
                const q = at(e.md); if(q){ q.comment = e.comment; out.push(q); }
            });
            out.sort((a, b) => a.md - b.md);
            const last = out[out.length - 1]; last.comment = last.comment ? last.comment + '; TD' : 'TD';
            return out;
        }
        function ipdExportXlsx(){
            if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
            const wells = (ipd.preview || []); if(!wells.length) return;
            const wb = XLSX.utils.book_new();
            const sum = [['Well','Surface','Target','Status','Error','KOP','Curve A Inc','Curve A Az','DLS 1','DLS 2','Tangents (inc/L)','Tan Az','Landing MD','TD MD','Max DLS','Surface N','Surface E','RKB (SS)','Target N','Target E','Target SS','Target Inc','Target Az','Hold (m)','Delta TVD T2 (m)','Delta TVD T1 (m)','Range limits hit','Design rule violations']]
                .concat(wells.map(w => { const p = w.r.params || {}, r = v => (v == null || !isFinite(v)) ? '' : +Number(v).toFixed(3);
                    return [w.name, w.s.name, w.tg.name, ipdStatus(w), w.r.error || '', r(p.kop), r(p.incA), r(p.azA), r(p.dls1), r(p.dls2),
                        p.tangents ? p.tangents.map(x => +Number(x.inc).toFixed(2) + '/' + x.L + (x.az != null ? '@' + (+Number(x.az).toFixed(1)) : '')).join(', ') : '', r(p.azT), r(w.landMd), r(w.tdMd), r(w.r.maxDls),
                        r(n(w.s.n)), r(n(w.s.e)), r(n(w.s.ss)), r(n(w.tg.n)), r(n(w.tg.e)), r(n(w.tg.ss)), r(n(w.tg.inc)), r(n(w.tg.az)), r(p.hold), r(p.dTvd), r(p.dTvd1), (w.r.edges || []).join('; '), (w.viol || []).map(v => v.msg).join('; ')]; }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), 'Summary');
            // CHANGED 2026-10-31 (John): Comments column like his Compass exports — design points + formation tops.
            const st = [['Well','Status','MD','Inc','Az','TVD','SubSea','N','E','DLS/30m','Comments']];
            const cmpRows = ipdCompareRows();
            wells.forEach((w, wi) => ipdCommentedStations(w, cmpRows.find(x => x.w === w)).forEach(p => st.push([w.name, ipdStatus(w), +p.md.toFixed(2), +p.inc.toFixed(3), +p.az.toFixed(3), +p.tvd.toFixed(2), +p.el.toFixed(2), +p.n.toFixed(2), +p.e.toFixed(2), +n(p.dls).toFixed(3), p.comment || ''])));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), 'Stations');
            const rows = ipdCompareRows();
            const cmp = [['iPad well','Status','Existing well','Slot dist (m)','Dist to target (m)','KOP iPad','KOP existing','Max DLS iPad','Max DLS existing','Landing MD iPad','Landing MD existing','TD MD iPad','TD MD existing','Path dist max (m)','Path dist avg (m)']]
                .concat(rows.map(x => { const r = v => (v == null || !isFinite(v)) ? '' : +Number(v).toFixed(3);
                    return [x.w.name, ipdStatus(x.w), x.ex ? (x.ex.wellName || x.ex.name || '') : '', r(x.slotD), r(x.tgtD), r(x.ipKop), r(x.exKop), r(x.ipDls), r(x.exDls), r(x.ipLand), r(x.exLand), r(x.ipTd), r(x.exTd), r(x.maxD), r(x.avgD)]; }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), 'Compare existing');
            // 2026-11-01: design rules sheet (settings + every violation)
            const R0 = ipd.rules, rs = [['Design rules'], ['No nudge above (deg)', R0.noNudge.on ? R0.noNudge.incMin : 'off', 'drop tol (deg)', R0.noNudge.tol, 'allowed windows', (R0.noNudge.windows || []).map(w0 => w0.a + '-' + w0.b).join(', ')],
                ['Max turn (deg)', R0.maxTurn.on ? R0.maxTurn.deg : 'off']].concat(R0.zones.map(z => ['Zone', z.name, 'top SS', z.top, 'base SS', z.base, 'max DLS', z.dlsMax == null ? '' : z.dlsMax, 'Inc min', z.incMin == null ? '' : z.incMin, 'Inc max', z.incMax == null ? '' : z.incMax, 'no drop', z.noDrop ? 'yes' : 'no', z.on === false ? 'OFF' : '']))
                .concat([[], ['Well', 'Rule', 'MD', 'Violation']]).concat([].concat(...wells.map(w => (w.viol || []).map(v => [w.name, v.rule, +(+v.md).toFixed(1), v.msg]))));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rs), 'Design rules');
            XLSX.writeFile(wb, (ipd.name || 'pad').replace(/[^\w\- ]+/g, '_') + '_iPad_preview.xlsx');
        }
        // ---------- iPad: Tunnel (ADDED 2026-10-31, John) ----------
        // One tube ("tunnel") per preview well, centred on its trajectory, radius R (default 10 m, user-set),
        // cross-sections perpendicular to the path. Two tunnels touch / overlap where the centre-to-centre
        // distance between their trajectories is <= 2R; those parts are drawn red, the rest translucent blue.
        // Distance = from each tunnel ring centre to the nearest point of every other pad well's path
        // (3D, Sub-Sea datum, straight segments between 10 m stations). Geometric only — NOT an
        // uncertainty / SF check (that is the "Pad separation check" below).
        ipd.tunnels = [];
        function ipdClearTunnels(){ (ipd.tunnels || []).forEach(m => { api.getGroup().remove(m); m.geometry.dispose(); m.material.dispose(); }); ipd.tunnels = []; }
        function ipdTunnelBlock(){
            return `<div class="ipl-h" style="margin-top:10px;">Tunnel (geometric clearance)</div>
            <div class="ipl-sec" style="display:block;">
                <span title="Clearance between well centres (2026-10-31, John: (b)). Tunnel radius drawn = half of it.">Min C2C clearance (m)</span> <input type="number" step="0.5" min="0.5" id="ipdTunR" value="${ipd.tunR || 10}" style="width:70px;">
                <span style="margin-left:10px;">Depth</span> <select id="ipdTunDepth"><option value="icp" ${ipd.tunDepth !== 'full' ? 'selected' : ''}>Surface → ICP / landing</option><option value="full" ${ipd.tunDepth === 'full' ? 'selected' : ''}>Full well</option></select>
                <span style="margin-left:10px;">From MD (m)</span> <input type="number" step="10" min="0" id="ipdTunFrom" value="${ipd.tunFrom || 0}" style="width:70px;" title="Skip the top of the wells (e.g. the vertical section where slots are close)">
                <button type="button" class="wbt-btn" id="ipdTunRun" style="margin-left:8px;">&#9711; Tunnel</button>
                <button type="button" class="wbt-btn" id="ipdTunClr">Clear tunnels</button>
                <!-- ADDED 2026-11-04 (John, SD9): offsets / planned wells as obstacles in Tunnel + Avoidance, with his zones -->
                <div style="margin-top:4px;">
                    <label><input type="checkbox" id="ipdObsOn" ${ipd.obsOn !== false ? 'checked' : ''}> Include offsets &amp; planned wells</label>
                    <span style="margin-left:8px;" title="From the slot down to this MD: 'as close to the clearance as the slot allows' (= min(clearance, distance at the slot))">Near-surface to MD</span> <input type="number" step="10" min="0" id="ipdObsNear" value="${ipd.obsNear != null ? ipd.obsNear : 200}" style="width:60px;">
                    <span style="margin-left:8px;" title="Last part of the build before the ICP where the SAGD clearance applies">ICP zone (m)</span> <input type="number" step="10" min="0" id="ipdObsIcpZone" value="${ipd.obsIcpZone != null ? ipd.obsIcpZone : 100}" style="width:60px;">
                    <span>ICP clearance (m)</span> <input type="number" step="0.5" min="0" id="ipdObsIcpClr" value="${ipd.obsIcpClr != null ? ipd.obsIcpClr : 5}" style="width:55px;">
                    <span style="font-size:10px;color:var(--wbt-text-dim);">Planned wells starting within 3 m of an iPad slot are the wells being redesigned — left out.</span>
                </div>
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">One tunnel per well, radius = half the clearance. <span style="color:#ff4c4c;">Red</span> = centre-to-centre distance below the clearance (tunnels overlap). Geometric only — no uncertainty (see the SF check below).</div>
                <div id="ipdTunOut" style="margin-top:6px;"></div>
            </div>`;
        }
        // ADDED 2026-11-04 (John, SD9): obstacles for Tunnel / Avoidance = planned + offset wells of the job
        // (AC module's base wells), minus the ones being redesigned (surface within 3 m of an iPad slot), only near the pad.
        function ipdObsSettings(){
            const g = id => document.getElementById(id);
            ipd.obsOn = g('ipdObsOn') ? g('ipdObsOn').checked : true;
            ipd.obsNear = g('ipdObsNear') ? Math.max(0, n(g('ipdObsNear').value)) : 200;
            ipd.obsIcpZone = g('ipdObsIcpZone') ? Math.max(0, n(g('ipdObsIcpZone').value)) : 100;
            ipd.obsIcpClr = g('ipdObsIcpClr') ? Math.max(0, n(g('ipdObsIcpClr').value)) : 5;
            return { on: ipd.obsOn, nearMd: ipd.obsNear, icpZone: ipd.obsIcpZone, icpClr: ipd.obsIcpClr };
        }
        function ipdObstacles(wells){
            const A = window.acpPadApi; if(!A) return [];
            const slots = ipd.surfaces.map(s0 => ({ n: n(s0.n), e: n(s0.e) }));
            const pts = []; (wells || []).forEach(w => (w.st || []).forEach(p => pts.push(p)));
            const bb = pts.reduce((b, p) => [Math.min(b[0], p.n), Math.max(b[1], p.n), Math.min(b[2], p.e), Math.max(b[3], p.e)], [Infinity, -Infinity, Infinity, -Infinity]), pad = 400;
            return A.baseWells().map(x => {
                const P = (x.well.survey || []).map(p => ({ md: n(p.md), n: n(p.northing), e: n(p.easting), z: n(p.subSea) })).filter(p => isFinite(p.n) && isFinite(p.e) && isFinite(p.z)).sort((a, b) => a.md - b.md);
                if(P.length < 2) return null;
                if(slots.some(s0 => Math.hypot(s0.n - P[0].n, s0.e - P[0].e) < 3)) return null;   // the well being redesigned
                if(!P.some(p => p.n > bb[0] - pad && p.n < bb[1] + pad && p.e > bb[2] - pad && p.e < bb[3] + pad)) return null;
                return { name: x.well.wellName || 'well', cat: x.cat, pts: P };
            }).filter(Boolean);
        }
        function ipdRunTunnels(){
            ipdClearTunnels();
            // CHANGED 2026-10-31 (John, option b): the input is the min centre-to-centre CLEARANCE; tunnel radius = clearance / 2.
            const clr = Math.max(0.1, n(document.getElementById('ipdTunR').value)), R = clr / 2, full = document.getElementById('ipdTunDepth').value === 'full', from = Math.max(0, n(document.getElementById('ipdTunFrom').value));
            ipd.tunR = clr; ipd.tunDepth = full ? 'full' : 'icp'; ipd.tunFrom = from;
            const wells = (ipd.preview || []).filter(w => w.st && w.st.length > 1).map(w => {
                const end = full || w.landMd == null ? Infinity : w.landMd + 1e-6;
                const pts = ipdStations(w).filter(p => p.md >= from - 1e-6 && p.md <= end);
                return { w, pts, v: pts.map(p => new THREE.Vector3(p.e, p.el, -p.n)) };
            }).filter(x => x.pts.length > 1);
            const segDist = (p, pts) => { let b = Infinity, bi = -1; for(let i = 1; i < pts.length; i++){ const a = pts[i-1], c = pts[i];
                const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z, wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z, L2 = vx*vx + vy*vy + vz*vz;
                let t = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; t = Math.max(0, Math.min(1, t));
                const d = Math.hypot(wx - t*vx, wy - t*vy, wz - t*vz); if(d < b){ b = d; bi = i; } } return b; };
            const red = new THREE.Color(0xff3030), ok = new THREE.Color(0x3aa0ff), report = [];
            // 2026-11-04: offsets / planned wells (fixed), required clearance by zone (same rule as padAvoid's obstacles)
            const OS = ipdObsSettings(), obs = OS.on ? ipdObstacles(wells.map(x => x.w)).map(o0 => ({ name: o0.name, P: o0.pts, v: o0.pts.map(p => new THREE.Vector3(p.e, p.z, -p.n)) })) : [];
            const obsBB = obs.map(o0 => o0.P.reduce((b, p) => [Math.min(b[0], p.e), Math.max(b[1], p.e), Math.min(b[2], -p.n), Math.max(b[3], -p.n)], [Infinity, -Infinity, Infinity, -Infinity]));
            wells.forEach((x, wi) => {
                const s0 = new THREE.Vector3(n(x.w.s.e), n(x.w.s.ss), -n(x.w.s.n)), slotD = obs.map(o0 => segDist(s0, o0.v)), landMd = x.w.landMd != null ? x.w.landMd : Infinity;
                const obsRanges = {};
                const curve = new THREE.CatmullRomCurve3(x.v), segs = Math.max(8, x.v.length * 2), radial = 14;
                const geo = new THREE.TubeGeometry(curve, segs, R, radial, false);
                const total = x.pts[x.pts.length - 1].md - x.pts[0].md, cols = [], ranges = {};
                let minD = Infinity, minWith = '';
                for(let i = 0; i <= segs; i++){
                    const c = curve.getPointAt(i / segs), md = x.pts[0].md + total * i / segs;
                    let hit = false;
                    wells.forEach((y, wj) => { if(wj === wi) return; const d = segDist(c, y.v);
                        if(d < minD){ minD = d; minWith = y.w.name; }
                        if(d < 2 * R - 1e-6){ hit = true; const r0 = ranges[y.w.name] = ranges[y.w.name] || { a: md, b: md, min: d }; r0.a = Math.min(r0.a, md); r0.b = Math.max(r0.b, md); r0.min = Math.min(r0.min, d); } });
                    obs.forEach((o0, k) => {   // 2026-11-04
                        const req = md < OS.nearMd ? Math.min(clr, slotD[k] - 0.3) : (md >= landMd - OS.icpZone ? Math.min(clr, OS.icpClr) : clr), b0 = obsBB[k];
                        if(c.x < b0[0] - req || c.x > b0[1] + req || c.z < b0[2] - req || c.z > b0[3] + req) return;
                        const d = segDist(c, o0.v);
                        if(d < req - 1e-6){ hit = true; const r0 = obsRanges[o0.name] = obsRanges[o0.name] || { a: md, b: md, min: d, req }; r0.a = Math.min(r0.a, md); r0.b = Math.max(r0.b, md); if(d < r0.min){ r0.min = d; r0.req = req; } }
                    });
                    const col = hit ? red : ok;
                    for(let j = 0; j <= radial; j++) cols.push(col.r, col.g, col.b);
                }
                geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
                api.getGroup().add(mesh); ipd.tunnels.push(mesh);
                report.push({ name: x.w.name, minD, minWith, ranges, obsRanges });
            });
            const nHit = report.filter(r => Object.keys(r.ranges).length).length, nObs = report.filter(r => Object.keys(r.obsRanges).length).length;
            document.getElementById('ipdTunOut').innerHTML = `<div style="margin-bottom:4px;">${wells.length} tunnel(s), clearance ${f(clr,1)} m (radius ${f(R,1)} m) — <span style="color:${nHit ? '#ff4c4c' : '#00e676'};">${nHit} well(s) with overlaps between pad wells</span> · ${OS.on ? `<span style="color:${nObs ? '#ff4c4c' : '#00e676'};">${nObs} well(s) too close to offsets / planned wells</span> (${obs.length} checked; near-surface to MD ${f(OS.nearMd,0)} = as the slot allows, last ${f(OS.icpZone,0)} m before the ICP = ${f(OS.icpClr,1)} m)` : 'offsets not checked'}</div>
                <div style="max-height:260px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);"><tr><th>Well</th><th>Min C2C pad (m)</th><th>Closest pad well</th><th>Overlaps pad wells (MD from–to, min)</th><th>Offsets / planned too close (MD from–to, min / required)</th></tr>` +
                report.map(r => `<tr style="color:${Object.keys(r.ranges).length || Object.keys(r.obsRanges).length ? '#ff4c4c' : 'inherit'};"><td>${esc(r.name)}</td><td>${f(r.minD,1)}</td><td>${esc(r.minWith)}</td><td style="white-space:normal;">${Object.keys(r.ranges).map(k => esc(k) + ': ' + f(r.ranges[k].a,0) + '–' + f(r.ranges[k].b,0) + ' (' + f(r.ranges[k].min,1) + ')').join('<br>') || '—'}</td><td style="white-space:normal;">${Object.keys(r.obsRanges).sort((a, b) => r.obsRanges[a].min - r.obsRanges[b].min).map(k => esc(k) + ': ' + f(r.obsRanges[k].a,0) + '–' + f(r.obsRanges[k].b,0) + ' (' + f(r.obsRanges[k].min,1) + ' / ' + f(r.obsRanges[k].req,1) + ')').join('<br>') || '—'}</td></tr>`).join('') + '</table></div>';
        }
        // ---------- iPad: Avoidance (ADDED 2026-10-31, John) ----------
        // Re-designs the preview wells so their tunnels never touch (IPlanCore.padAvoid — see its comment):
        // same Tunnel radius / From MD / Depth as the Tunnel section; levers = other designs inside the
        // Design freedoms ranges, KOP stagger (free, step / max here), ICP tolerance (Design freedoms).
        // Only the new pad wells (offsets later). If not everything clears, the best combination is shown.
        function ipdAvoidBlock(){
            return `<div class="ipl-h" style="margin-top:10px;">Avoidance (tunnels never touch)</div>
            <div class="ipl-sec" style="display:block;">
                <span>KOP stagger step (m)</span> <input type="number" step="5" min="5" id="ipdAvKopStep" value="${ipd.avKopStep || 20}" style="width:60px;">
                <span style="margin-left:8px;">max (m)</span> <input type="number" step="10" min="0" id="ipdAvKopMax" value="${ipd.avKopMax != null ? ipd.avKopMax : 300}" style="width:60px;">
                <span style="margin-left:8px;">Time limit (s)</span> <input type="number" step="10" min="10" id="ipdAvTime" value="${ipd.avTime || 120}" style="width:60px;">
                <!-- ADDED 2026-10-31 (John): "Safest" goal = after removing touching pairs, keep raising the pad-wide min C2C (safest first, then shortest MD). See padAvoid o.safest in iplanCore.js. -->
                <span style="margin-left:8px;">Goal</span> <select id="ipdAvGoal"><option value="clear"${ipd.avGoal !== 'safest' ? ' selected' : ''}>No touching (clearance)</option><option value="safest"${ipd.avGoal === 'safest' ? ' selected' : ''}>Safest (maximize min C2C)</option></select>
                <!-- ADDED 2026-11-06 (John): Deep search (RRT) for wells still in conflict after the normal search — IPlanCore.padDeepAvoid -->
                <label style="margin-left:8px;" title="For wells still in conflict after the normal search: random-tree search of the shallow hole (any drillable shape inside the nudge / DLS limits), connected to the ICP by the back-projected template, then smoothed. Slower; results vary run to run."><input type="checkbox" id="ipdAvDeep" ${ipd.avDeep ? 'checked' : ''}> Deep search (RRT)</label>
                <span>s / well</span> <input type="number" step="10" min="15" id="ipdAvDeepS" value="${ipd.avDeepS || 60}" style="width:55px;">
                <button type="button" class="wbt-btn" id="ipdAvRun" style="margin-left:8px;">&#10227; Run avoidance</button>
                <button type="button" class="wbt-btn" id="ipdAvRevert" ${ipd.previewOrig ? '' : 'disabled'}>Revert to original</button>
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">Uses the Tunnel radius, Depth and From MD above. Every new design stays inside the Design freedoms ranges and lands on the ICP (or inside its tolerance box). Levers, cheapest first: another design in the ranges → extra KOP stagger → AC nudge (Design freedoms) → ICP tolerance. "Back-projected" template only. Note: at From MD the wells are still as close as their slots — start the tunnels below where the wells can separate.</div>
                <div id="ipdAvOut" style="margin-top:6px;">${ipd.avoidHtml || ''}</div>
            </div>`;
        }
        // ---------- iPad: Lateral tunnel + avoidance vs OFFSET wells (ADDED 2026-11-01, John) ----------
        // Lateral clearance (default 15 m, build section uses the Tunnel clearance, default 10 m). Tunnel only on the
        // iPad laterals (ICP -> TD), radius = clearance; red where an OFFSET well's centre line is inside it (no
        // tunnels for offsets). Avoidance = IPlanCore.padLateralAvoid (John's Compass TF-DLS-CL manoeuvre: out,
        // back to the original line and azimuth; start point found automatically; see its comment).
        // SAGD tick: an offset running alongside the iPad lateral (>= 40 % of its lateral stations within the
        // lateral clearance) is taken as its SAGD pair: not avoided, flagged only when closer than the SAGD
        // clearance (default 5 m). Only offset wells (Standard colour "offset", red), per John.
        function ipdLatBlock(){
            const L = ipd.lat || (ipd.lat = { clr: 15, dlsMax: 5, prefer: 'backoff', sagd: false, sagdClr: 5 });
            return `<div class="ipl-h" style="margin-top:10px;">Lateral tunnel &amp; avoidance (offset wells)</div>
            <div class="ipl-sec" style="display:block;">
                <span>Lateral C2C clearance (m)</span> <input type="number" step="0.5" min="0.5" id="ipdLatClr" value="${L.clr}" style="width:60px;">
                <span style="margin-left:8px;">Max lateral DLS (°/30m)</span> <input type="number" step="0.5" min="0.5" id="ipdLatDls" value="${L.dlsMax}" style="width:55px;">
                <span style="margin-left:8px;">Prefer</span> <select id="ipdLatPrefer"><option value="backoff" ${L.prefer !== 'dls' ? 'selected' : ''}>Shortest back-off</option><option value="dls" ${L.prefer === 'dls' ? 'selected' : ''}>Lowest DLS</option></select>
                <label style="margin-left:8px;"><input type="checkbox" id="ipdLatSagd" ${L.sagd ? 'checked' : ''}> SAGD pairs</label>
                <span>clearance (m)</span> <input type="number" step="0.5" min="0" id="ipdLatSagdClr" value="${L.sagdClr}" style="width:50px;">
                <div style="margin-top:4px;">
                    <button type="button" class="wbt-btn" id="ipdLatTun">&#9711; Lateral tunnel</button>
                    <button type="button" class="wbt-btn" id="ipdLatRun">&#10227; Avoid in lateral</button>
                    <button type="button" class="wbt-btn" id="ipdLatRevert" ${ipd.latOrig ? '' : 'disabled'}>Revert lateral</button>
                </div>
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">Manoeuvre (Compass TF-DLS-CL): TF ∓90 / DLS / CL a → TF ±90 / 2a (or a, hold, a) → TF ∓90 / a — out and back to the original line and azimuth, then on to the TD. Start point, side, DLS (≤ max) and a are found automatically. Sideways only: an offset crossing at the same depth cannot be passed sideways and is listed as unresolved. Run after the build-section Avoidance (a new Preview / Avoidance rebuilds the laterals).</div>
                <div id="ipdLatOut" style="margin-top:6px;">${ipd.latHtml || ''}</div>
            </div>`;
        }
        function ipdLatRead(){
            const g = id => document.getElementById(id), L = ipd.lat;
            L.clr = Math.max(0.5, n(g('ipdLatClr').value)); L.dlsMax = Math.max(0.5, n(g('ipdLatDls').value)); L.prefer = g('ipdLatPrefer').value;
            L.sagd = g('ipdLatSagd').checked; L.sagdClr = Math.max(0, n(g('ipdLatSagdClr').value)); return L;
        }
        function ipdOffsetWells(){
            const A = window.acpPadApi; if(!A) throw new Error('Anti-collision module not loaded on this page.');
            return A.baseWells().filter(x => x.cat === 'offset').map(x => ({ name: x.well.wellName || x.well.name || 'offset',
                pts: (x.well.survey || []).map(p => ({ md: n(p.md), n: n(p.northing), e: n(p.easting), el: n(p.subSea) })).filter(p => isFinite(p.n) && isFinite(p.e) && isFinite(p.el)).sort((a, b) => a.md - b.md) })).filter(x => x.pts.length > 1);
        }
        const ipdSegD = (p, pts) => { let b = Infinity; for(let i = 1; i < pts.length; i++){ const a = pts[i-1], c = pts[i];
            const vx = c.n - a.n, vy = c.e - a.e, vz = c.el - a.el, wx = p.n - a.n, wy = p.e - a.e, wz = p.el - a.el, L2 = vx*vx + vy*vy + vz*vz;
            let t = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(wx - t*vx, wy - t*vy, wz - t*vz); if(d < b) b = d; } return b; };
        function ipdLatPts(w){ return w.landMd == null ? [] : ipdStations(w).filter(p => p.md >= w.landMd - 1e-6); }
        // offsets near this lateral (bounding box prefilter) + SAGD twin flag
        function ipdLatOffsets(w, offs, L){
            const lp = ipdLatPts(w); if(lp.length < 2) return [];
            const pad = L.clr + 100, bb = lp.reduce((b, p) => [Math.min(b[0], p.n), Math.max(b[1], p.n), Math.min(b[2], p.e), Math.max(b[3], p.e)], [Infinity, -Infinity, Infinity, -Infinity]);
            return offs.map(o => ({ name: o.name, pts: o.pts.filter(p => p.n > bb[0] - pad && p.n < bb[1] + pad && p.e > bb[2] - pad && p.e < bb[3] + pad) })).filter(o => o.pts.length > 1)
                .map(o => { const near = lp.filter(p => ipdSegD(p, o.pts) < L.clr).length; return Object.assign(o, { twin: L.sagd && near >= 0.4 * lp.length }); });
        }
        function ipdLatTunnel(){
            const L = ipdLatRead(), offs = ipdOffsetWells(), wells = (ipd.preview || []).filter(w => w.st && w.st.length > 1 && w.landMd != null);
            if(!wells.length) throw new Error('Run the Preview first.');
            ipdClearTunnels();
            const red = new THREE.Color(0xff3030), ok = new THREE.Color(0x3aa0ff), orange = new THREE.Color(0xff9f1c), rep = [];
            wells.forEach(w => {
                const lp = ipdLatPts(w); if(lp.length < 2) return;
                const near = ipdLatOffsets(w, offs, L), v = lp.map(p => new THREE.Vector3(p.e, p.el, -p.n));
                const curve = new THREE.CatmullRomCurve3(v), segs = Math.max(8, v.length), radial = 14, total = lp[lp.length - 1].md - lp[0].md;
                const geo = new THREE.TubeGeometry(curve, segs, L.clr, radial, false), cols = [], hits = {};
                let minD = Infinity, minWith = '';
                for(let i = 0; i <= segs; i++){
                    const c = curve.getPointAt(i / segs), md = lp[0].md + total * i / segs, P = { n: -c.z, e: c.x, el: c.y };
                    let col = ok;
                    near.forEach(o => { const d = ipdSegD(P, o.pts), lim = o.twin ? L.sagdClr : L.clr;
                        if(!o.twin && d < minD){ minD = d; minWith = o.name; }
                        if(d < lim - 1e-6){ col = o.twin ? (col === red ? red : orange) : red; const h = hits[o.name] = hits[o.name] || { a: md, b: md, min: d, twin: o.twin }; h.a = Math.min(h.a, md); h.b = Math.max(h.b, md); h.min = Math.min(h.min, d); } });
                    for(let j = 0; j <= radial; j++) cols.push(col.r, col.g, col.b);
                }
                geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
                const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
                api.getGroup().add(mesh); ipd.tunnels.push(mesh);
                rep.push({ w, minD, minWith, hits, twins: near.filter(o => o.twin).map(o => o.name) });
            });
            const nHit = rep.filter(r => Object.values(r.hits).some(h => !h.twin)).length;
            document.getElementById('ipdLatOut').innerHTML = `<div style="margin-bottom:4px;">${rep.length} lateral tunnel(s), radius = clearance ${f(L.clr,1)} m vs ${offs.length} offset well(s) — <span style="color:${nHit ? '#ff4c4c' : '#00e676'};">${nHit} lateral(s) with an offset centre inside</span>${L.sagd ? ` · SAGD pairs checked at ${f(L.sagdClr,1)} m (orange)` : ''}</div>
                <div style="max-height:260px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);"><tr><th>Well</th><th>Min C2C to offsets (m)</th><th>Closest</th><th>Inside tunnel (offset: MD from–to, min C2C)</th><th>SAGD pair</th></tr>` +
                rep.map(r => { const bad = Object.values(r.hits).some(h => !h.twin); return `<tr style="color:${bad ? '#ff4c4c' : 'inherit'};"><td>${esc(r.w.name)}</td><td>${isFinite(r.minD) ? f(r.minD,1) : '—'}</td><td>${esc(r.minWith || '—')}</td><td style="white-space:normal;">${Object.keys(r.hits).map(k => (r.hits[k].twin ? '<span style="color:#ff9f1c;">SAGD </span>' : '') + esc(k) + ': ' + f(r.hits[k].a,0) + '–' + f(r.hits[k].b,0) + ' (' + f(r.hits[k].min,1) + ')').join('<br>') || '—'}</td><td>${esc(r.twins.join(', ') || '—')}</td></tr>`; }).join('') + '</table></div>';
        }
        function ipdLatAvoid(){
            const L = ipdLatRead(), offs = ipdOffsetWells(), base = ipd.latOrig || ipd.preview || [];
            if(!base.length) throw new Error('Run the Preview first.');
            const out = [], rows = [];
            base.forEach(w => {
                if(!w.r || !w.r.sections || w.landMd == null || !w.st.length){ out.push(w); return; }
                const tags = w.r.tags || w.r.sections.map((x, k) => k === w.r.sections.length - 1 && ipdLatOf(w.i, w.land) > 1e-6 ? 'lateral' : '');
                const pre = w.r.sections.filter((x, k) => tags[k] !== 'lateral'), preTags = tags.filter(t0 => t0 !== 'lateral');
                const latL = w.r.sections.filter((x, k) => tags[k] === 'lateral').reduce((a, x) => a + x.cl, 0);
                const icpSt = C.computeStations({ md:0, tvd:0, n:n(w.s.n), e:n(w.s.e), inc:0, az:0 }, pre, STEP).stations.slice(-1)[0];
                if(!(latL > 1) || !icpSt){ out.push(w); return; }
                const near = ipdLatOffsets(w, offs, L);
                const res = C.padLateralAvoid({ icp: { n: icpSt.n, e: icpSt.e, el: n(w.s.ss) - icpSt.tvd, inc: icpSt.inc, az: icpSt.az }, L: latL, offsets: near, clr: L.clr, dlsMax: L.dlsMax, prefer: L.prefer, sagdClr: L.sagdClr });
                if(!res.maneuvers.length){ out.push(w); rows.push({ w, res }); return; }
                // MDs of the manoeuvres (Start / End Lateral Avoidance comments)
                let md = icpSt.md; const marks = [];
                res.sections.forEach(x => { if(x._lat === 'start') marks.push({ a: md }); md += x.cl; if(x._lat === 'end') marks[marks.length - 1].b = md; });
                const secs = res.sections.map(x => { const y = Object.assign({}, x); delete y._lat; return y; });
                const r2 = Object.assign({}, w.r, { sections: pre.concat(secs), tags: preTags.concat(secs.map(() => 'lateral')), latAv: marks.map((m0, k) => Object.assign({}, res.maneuvers[k], m0)),
                    maxDls: Math.max(n(w.r.maxDls), ...res.maneuvers.map(m0 => m0.dls)) });
                const nw = ipdMakeWell(w.i, w.s, w.tg, w.land, r2); nw.avoid = w.avoid; out.push(nw); rows.push({ w: nw, res, marks });
            });
            ipd.latOrig = base;
            const nM = rows.reduce((a, r) => a + r.res.maneuvers.length, 0), nU = rows.reduce((a, r) => a + r.res.unresolved.length, 0);
            ipd.latHtml = `<div style="margin-bottom:4px;">${nM} manoeuvre(s) on ${rows.filter(r => r.res.maneuvers.length).length} lateral(s) · clearance ${f(L.clr,1)} m · max DLS ${f(L.dlsMax,1)}${nU ? ` · <b style="color:#ff4c4c;">${nU} unresolved</b>` : ''}</div>
                <div style="max-height:260px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);"><tr><th>Well</th><th>Avoids</th><th>Side</th><th>Start MD</th><th>Back-off (m)</th><th>TF / DLS / CL</th><th>Peak shift (m)</th><th>End MD</th><th>Min C2C after (m)</th><th>Unresolved / SAGD</th></tr>` +
                rows.filter(r => r.res.maneuvers.length || r.res.unresolved.length || r.res.twins.length).map(r => {
                    const ms = r.res.maneuvers, tf = m0 => m0.side === 'right' ? 90 : -90, seq = m0 => m0.P > 1e-6 ? `${tf(m0)}/${f(m0.dls,1)}/${m0.a} → ${-tf(m0)}/${f(m0.dls,1)}/${m0.a} → hold ${f(m0.P,0)} → ${-tf(m0)}/${f(m0.dls,1)}/${m0.a} → ${tf(m0)}/${f(m0.dls,1)}/${m0.a}` : `${tf(m0)}/${f(m0.dls,1)}/${m0.a} → ${-tf(m0)}/${f(m0.dls,1)}/${2 * m0.a} → ${tf(m0)}/${f(m0.dls,1)}/${m0.a}`;
                    const extra = r.res.unresolved.map(u0 => `<span style="color:#ff4c4c;" title="${esc(u0.why || '')}">${esc(u0.with)} (C2C ${f(u0.d,1)}) — ${esc(u0.why || 'unresolved')}</span>`).concat(r.res.twins.map(t0 => `<span style="color:${t0.ok ? '#00e676' : '#ff9f1c'};">SAGD ${esc(t0.name)} ${f(t0.min,1)} m</span>`)).join('<br>') || '—';
                    if(!ms.length) return `<tr><td>${esc(r.w.name)}</td><td colspan="8">—</td><td>${extra}</td></tr>`;
                    return ms.map((m0, k) => `<tr><td>${k ? '' : esc(r.w.name)}</td><td>${esc(m0.with)}</td><td>${m0.side}</td><td>${f(r.marks[k].a,0)}</td><td>${f(m0.backoff,0)}</td><td>${seq(m0)}</td><td>${f(m0.peak,1)}</td><td>${f(r.marks[k].b,0)}</td><td>${k ? '' : (isFinite(r.res.minC2C) ? f(r.res.minC2C,1) : '—')}</td><td>${k ? '' : extra}</td></tr>`).join('');
                }).join('') + '</table></div>';
            ipdShowPreview(out, out.length);
            try { ipdLatTunnel(); } catch(e){}
        }
        function ipdAvoidRevert(){
            if(!ipd.previewOrig) return;
            const w = ipd.previewOrig; ipd.previewOrig = null; ipd.avoidHtml = '';
            ipdShowPreview(w, w.length);
        }
        async function ipdRunAvoid(){
            const outEl = () => document.getElementById('ipdAvOut');
            if(ipd.tpl.mode !== 'back'){ outEl().innerHTML = '<span style="color:#ff4c4c;">Avoidance needs the "Back-projected from ICP" template — run the Preview with it first.</span>'; return; }
            const base = ipd.previewOrig || ipd.preview || [];
            if(base.length < 2){ outEl().innerHTML = '<span style="color:#ff4c4c;">Run the Preview first (2 or more wells).</span>'; return; }
            const clr = Math.max(0.1, n(document.getElementById('ipdTunR').value)), R = clr / 2, full = document.getElementById('ipdTunDepth').value === 'full', from = Math.max(0, n(document.getElementById('ipdTunFrom').value));
            ipd.tunR = clr; ipd.tunDepth = full ? 'full' : 'icp'; ipd.tunFrom = from;
            ipd.avKopStep = Math.max(5, n(document.getElementById('ipdAvKopStep').value)); ipd.avKopMax = Math.max(0, n(document.getElementById('ipdAvKopMax').value)); ipd.avTime = Math.max(10, n(document.getElementById('ipdAvTime').value)); ipd.avGoal = document.getElementById('ipdAvGoal').value; ipd.avDeep = document.getElementById('ipdAvDeep').checked; ipd.avDeepS = Math.max(15, n(document.getElementById('ipdAvDeepS').value));
            const t = ipd.tpl, btn = document.getElementById('ipdAvRun'); btn.disabled = true;
            const input = base.map((w, i) => ({ surf: { n:n(w.s.n), e:n(w.s.e) }, ss: n(w.s.ss), land: Object.assign({}, w.land),
                tpl: { mode:'back', kop: (w.r.params && w.r.params.kop > 0) ? w.r.params.kop : ipdKopOf(w.i), lateral: ipdLatOf(w.i, w.land), back: Object.assign({}, t.back, (w.r.edges || []).some(e => /T1 raised/.test(e)) && w.r.params ? { t1Min: w.r.params.incT, t1Max: w.r.params.incT } : {}), rules: ipdRulesForSolver(), kopMin: n(t.sc) + 20, rkb: n(w.s.ss), _noKopRetry: true } }));   // 2026-11-01: keep a T1 the rules raised for this well   // 2026-11-01: start from the preview's KOP (already raised by the rules if needed); Avoidance's own KOP lever only adds depth, so no KOP retry inside it (speed)   // 2026-11-01: lateral to TD; design rules   // 2026-11-01: lateral to TD
            let res;
            try {
                const OS = ipdObsSettings();   // 2026-11-04: offsets / planned wells as fixed obstacles
                res = await C.padAvoid(input, { R, fromMd: from, full, obstacles: OS.on ? ipdObstacles(base) : null, obsClr: clr, nearMd: OS.nearMd, icpZone: OS.icpZone, icpClr: OS.icpClr, nudge: t.back.nudgeOn ? { kop: n(t.back.nudgeKop), dls: n(t.back.nudgeDls), incMax: n(t.back.nudgeIncMax) } : null, kopStep: ipd.avKopStep, kopMax: ipd.avKopMax, tolAlong: n(t.back.icpAlong), tolAcross: n(t.back.icpAcross), timeMs: ipd.avTime * 1000, safest: ipd.avGoal === 'safest' },
                    async msg => { const el = outEl(); if(el) el.innerHTML = '<span style="color:var(--wbt-text-dim);">' + esc(msg) + '…</span>'; await new Promise(r => setTimeout(r, 0)); });
                // ADDED 2026-11-06: Deep search (RRT) for the wells still in conflict (offsets / planned or pad pairs)
                if(ipd.avDeep && ((res.end.oh || 0) + (res.end.pairs || 0)) > 0){
                    await C.padDeepAvoid(input, res, { R, fromMd: from, obstacles: OS.on ? ipdObstacles(base) : null, obsClr: clr, nearMd: OS.nearMd, icpZone: OS.icpZone, icpClr: OS.icpClr, nudge: t.back.nudgeOn ? { kop: n(t.back.nudgeKop), dls: n(t.back.nudgeDls), incMax: n(t.back.nudgeIncMax) } : null, tolAlong: n(t.back.icpAlong), deepMs: ipd.avDeepS * 1000, rounds: 2 },
                        async msg => { const el = outEl(); if(el) el.innerHTML = '<span style="color:var(--wbt-text-dim);">' + esc(msg) + '…</span>'; await new Promise(r => setTimeout(r, 0)); });
                }
            } finally { btn.disabled = false; }
            const orig = base, wells = orig.map((w, i) => {
                const c = res.wells[i]; if(!c) return w;
                const tg = Object.assign({}, w.tg, { n: +c.land.n.toFixed(3), e: +c.land.e.toFixed(3) });
                const nw = ipdMakeWell(w.i, w.s, tg, c.land, c.r); nw.avoid = c; return nw;
            });
            const rows = wells.map((w, i) => { const o0 = orig[i], c = w.avoid, p = (w.r.params || {}), q = (o0.r.params || {});
                const ch = [];
                if(c && c.deep) ch.push('Deep search (RRT): ' + c.deep.nPre + ' shallow row(s)' + (c.deep.smoothed ? ' (smoothed from ' + c.deep.smoothed.before + ')' : ''));   // 2026-11-06
                if(c){ if(c.kopAdd) ch.push('KOP +' + c.kopAdd + ' m'); if(c.nudge) ch.push('AC nudge ' + f(c.nudge.inc,1) + '° @' + f(c.nudge.az,0) + '° from ' + f(c.nudge.kop,0) + ' m'); if(c.shift[0] || c.shift[1]) ch.push('ICP ' + (c.shift[0] ? (c.shift[0] > 0 ? '+' : '') + c.shift[0] + ' along ' : '') + (c.shift[1] ? (c.shift[1] > 0 ? '+' : '') + c.shift[1] + ' across' : ''));
                    if(Math.abs((p.azT || 0) - (q.azT || 0)) > 0.5) ch.push('T1 Az ' + f(q.azT,1) + '→' + f(p.azT,1) + '°');
                    if(p.incT !== q.incT) ch.push('T1 Inc ' + f(q.incT,1) + '→' + f(p.incT,1) + '°');
                    if(p.tangents && q.tangents && p.tangents[1].inc !== q.tangents[1].inc) ch.push('T2 Inc ' + f(q.tangents[1].inc,1) + '→' + f(p.tangents[1].inc,1) + '°');
                    if(p.dls1 !== q.dls1) ch.push('DLS ' + f(q.dls1,1) + '→' + f(p.dls1,1)); if(p.dls2 !== q.dls2) ch.push('final DLS ' + f(q.dls2,1) + '→' + f(p.dls2,1)); }
                const touching = res.pairs.filter(x => x.i === i || x.j === i).map(x => base[x.i === i ? x.j : x.i].name.split(' ').pop() + ' (' + f(x.d,1) + ')')
                    .concat(((c && c.obs) || []).map(x => x.name + ' (' + f(x.d,1) + ' / ' + f(x.req,1) + ' @ MD ' + f(x.md,0) + ')'));   // 2026-11-04: offsets / planned (min / required)
                return `<tr style="color:${touching.length ? '#ff4c4c' : 'inherit'};"><td>${esc(w.name)}</td><td style="white-space:normal;">${c ? esc(ch.join('; ') || 'no change') : '<span style="color:#ff4c4c;">no valid design with these levers — kept the original</span>'}</td><td>${f(w.landMd,0)}</td><td>${w.landMd != null && o0.landMd != null ? (w.landMd - o0.landMd >= 0 ? '+' : '') + f(w.landMd - o0.landMd,0) : '—'}</td><td>${c ? f(c.minC2C,1) : '—'}</td><td>${esc(touching.join(', ') || '—')}</td></tr>`; }).join('');
            ipd.previewOrig = orig;
            ipd.latOrig = null; ipd.latHtml = '';   // 2026-11-01: build-section avoidance rebuilds the laterals
            ipd.avoidHtml = `<div style="margin-bottom:4px;">Offset / planned conflicts: <b>${res.start.oh || 0}</b> → <b style="color:${res.end.oh ? '#ff4c4c' : '#00e676'};">${res.end.oh || 0}</b> · Touching pairs: <b>${res.start.pairs}</b> → <b style="color:${res.end.pairs ? '#ff4c4c' : '#00e676'};">${res.end.pairs}</b>${(res.end.pairs || res.end.oh) ? ' (best combination found — widen the ranges / ICP tolerance / nudge, or accept the listed wells)' : ' — all clear'} · clearance ${f(clr,1)} m from MD ${f(from,0)} · ${f(res.ms / 1000,1)} s${res.minBefore != null ? ` · Safest: pad min C2C <b>${isFinite(res.minBefore) ? f(res.minBefore,1) : '&gt;' + f(6*R,0)}</b> → <b style="color:#00e676;">${isFinite(res.minAfter) ? f(res.minAfter,1) : '&gt;' + f(6*R,0)}</b> m (${res.safeMoves} move(s))` : ''}</div>
                <div style="max-height:300px;overflow:auto;"><table style="font-size:11px;font-family:var(--wbt-mono);"><tr><th>Well</th><th>Changes vs original</th><th>Landing MD</th><th>Δ MD</th><th>Min C2C pad (m)</th><th>Still too close (C2C / required)</th></tr>${rows}</table></div>`;
            ipdShowPreview(wells, wells.length);
            try { ipdRunTunnels(); } catch(e){}
        }
        // ---------- iPad phase 2: pad separation check (ADDED 2026-10-12) ----------
        // Min SF per pair via window.acpPadApi (the Anti-collision module's own SF
        // code — see its comment). New wells = this preview; each is checked from
        // surface down to its ICP/landing (or full well) against the other new
        // wells and the chosen existing groups (Planned/blue, Offset/red, Scenarios).
        // Thresholds per John: red < 1.0, orange < 1.25.
        let ipdRun = 0;
        function ipdSepBlock(){
            return `<div class="ipl-h" style="margin-top:10px;">Pad separation check (min SF)</div>
            <div class="ipl-sec" style="display:block;">
                <span>Check new wells against:</span>
                <label style="margin-left:6px;"><input type="checkbox" id="ipdSepNew" checked> each other</label>
                <label style="margin-left:6px;"><input type="checkbox" id="ipdSepPlanned" checked> <span style="color:#0066ff;">Planned</span></label>
                <label style="margin-left:6px;"><input type="checkbox" id="ipdSepOffset" checked> <span style="color:#ff4c4c;">Offset</span></label>
                <label style="margin-left:6px;"><input type="checkbox" id="ipdSepScn"> <span style="color:#00e676;">Scenarios</span></label>
                <span style="margin-left:12px;">Depth</span> <select id="ipdSepDepth"><option value="icp" selected>Surface → ICP / landing</option><option value="full">Full well</option></select>
                <span style="margin-left:12px;">Red &lt;</span> <input type="number" step="0.05" id="ipdSepRed" value="1.0" style="width:60px;">
                <span>Orange &lt;</span> <input type="number" step="0.05" id="ipdSepOrange" value="1.25" style="width:60px;">
                <button type="button" class="wbt-btn" id="ipdSepRun" style="margin-left:8px;">&#9888; Run check</button>
                <span id="ipdSepProg" style="margin-left:8px;font-size:11px;color:var(--wbt-text-dim);"></span>
                <div style="font-size:10px;color:var(--wbt-text-dim);margin-top:3px;">Same SF as the Anti-collision Plots (ISCWSA, per-well toolcode, Confidence K from that panel). New wells use the reference planned well's toolcode and location for magnetics.</div>
                <div id="ipdSepOut" style="margin-top:6px;"></div>
            </div>
            <!-- ADDED 2026-11-01 (John): iPad preview score cards = same cards as the Score Cards module, marked WORK IN PROGRESS -->
            <div class="ipl-h" style="margin-top:10px;">Preview score cards (work in progress)</div>
            <div class="ipl-sec" style="display:block;">
                <button type="button" class="wbt-btn" id="ipdCardsRun">&#9776; Generate score cards</button>
                <button type="button" class="wbt-btn wbt-btn-excel" id="ipdCardsXls" style="display:none;">Download (Excel)</button>
                <span style="font-size:10px;color:var(--wbt-text-dim);margin-left:6px;">Same cards as Score Cards, from the current preview wells and their export comments. Min SF row comes from the last Pad separation check. Nothing is saved to the job.</span>
                <div class="wbt-pad-summary" id="ipdCardsSummary" style="margin-top:6px;"></div>
                <div class="wbt-dash-grid" id="ipdCardsGrid"></div>
            </div>`;
        }
        // Score cards for the iPad preview wells (ADDED 2026-11-01). Survey rows built from ipdCommentedStations
        // (same comments as the Excel export) in the field names the Score Cards code reads. Inserted comment
        // points have no DLS of their own -> they take the DLS of the next station (same interval).
        function ipdRunCards(){
            const wells = ipd.preview || [], grid = document.getElementById('ipdCardsGrid');
            if(!wells.length){ grid.innerHTML = '<span style="color:#ff4c4c;">Run the Preview first.</span>'; return; }
            if(typeof window.wbtRenderDashboard !== 'function'){ grid.innerHTML = '<span style="color:#ff4c4c;">Score Cards module not loaded on this page.</span>'; return; }
            const pal = [0xffd060, 0x00e5ff, 0xff9800, 0x76ff03, 0xe040fb, 0x40c4ff, 0xff4081, 0xb2ff59];
            const list = wells.filter(w => w.st && w.st.length > 1).map((w, i) => {
                const pts = ipdCommentedStations(w);
                const survey = pts.map((p, k) => { let d = p.dls; for(let j = k + 1; (d == null || !isFinite(d)) && j < pts.length; j++) d = pts[j].dls;
                    return { md:p.md, incl:p.inc, azim:p.az, tvd:p.tvd, northing:p.n, easting:p.e, dogleg: (d != null && isFinite(d)) ? d : 0, comments: p.comment || '' }; });
                return { name: w.name, survey, color: pal[i % pal.length] };
            });
            const sep = {}; (ipd.sepSumm || []).forEach(x => { if(x && x.a) sep[x.a.label] = x; });
            const red = n((document.getElementById('ipdSepRed') || {}).value) || 1, orange = n((document.getElementById('ipdSepOrange') || {}).value) || 1.25;
            window.wbtRenderDashboard(list, { containerId:'ipdCardsGrid', summaryId:'ipdCardsSummary', exportBtnId:'ipdCardsXls', noSave:true, wip:true,
                extraRows: name => { const x = Object.keys(sep).find(k => k === name || k.endsWith(' ' + name) || k.endsWith(name)); const s0 = x ? sep[x] : null;
                    if(!s0 || !s0.b) return [['Min SF (iPad AC)', ipd.sepSumm ? '—' : 'run Pad separation check']];
                    return [['Min SF (iPad AC)', f(s0.b.sf, 2) + ' vs ' + s0.other + ' (C2C ' + f(s0.b.c2c, 1) + ' m @ MD ' + f(s0.b.refMd, 0) + ')', s0.b.sf < red ? '#ff4c4c' : s0.b.sf < orange ? '#ff9f1c' : '#4caf50']]; } });
            document.getElementById('ipdCardsXls').style.display = '';
        }
        async function ipdRunSeparation(){
            const A = window.acpPadApi, out = document.getElementById('ipdSepOut'), prog = document.getElementById('ipdSepProg');
            if(!A){ out.innerHTML = '<span style="color:#ff4c4c;">Anti-collision module not available on this page.</span>'; return; }
            const wells = (ipd.preview || []).filter(w => w.st && w.st.length > 1);
            if(!wells.length){ out.innerHTML = '<span style="color:#ff4c4c;">Run Preview first.</span>'; return; }
            const red = n(document.getElementById('ipdSepRed').value) || 1.0, orange = n(document.getElementById('ipdSepOrange').value) || 1.25;
            const depth = document.getElementById('ipdSepDepth').value;
            prog.textContent = 'Loading toolcodes…';
            await A.ready();
            const run = ++ipdRun, prefix = '__ipd' + run + '__ ';
            const ref = A.surfaceLatLon(ipd.refWell);
            // preview wells as AC pseudo-wells (Sub-Sea = surface RKB elev. - TVD, same as iPlan scenarios)
            const news = wells.map(w => ({
                label: w.name, maxMd: depth === 'icp' ? w.landMd : Infinity,
                well: { wellName: prefix + w.name, toolcode: ref.toolcode,
                        survey: w.st.map(p => ({ md:p.md, incl:p.inc, azim:p.az, tvd:p.tvd, northing:p.n, easting:p.e, subSea:n(w.s.ss) - p.tvd, latitude:ref.lat, longitude:ref.lon })) }
            }));
            const others = [];
            const cats = { planned: document.getElementById('ipdSepPlanned').checked, offset: document.getElementById('ipdSepOffset').checked };
            A.baseWells().forEach(x => { if(cats[x.cat]) others.push({ label: x.well.wellName, cat: x.cat, well: x.well }); });
            if(document.getElementById('ipdSepScn').checked) A.scenarioWells().forEach(w => others.push({ label: w.wellName, cat: 'scenario', well: w }));
            const vsNew = document.getElementById('ipdSepNew').checked;
            const cols = (vsNew ? news.map(x => ({ label: x.label, cat: 'new', well: x.well, isNew: true })) : []).concat(others);
            // pairs: new i vs new j (once, i<j, both directions take the min), new i vs others
            const res = news.map(() => cols.map(() => null));
            const jobs = [];
            news.forEach((a, i) => cols.forEach((c, j) => {
                if(c.isNew){ if(j > i) jobs.push([i, j]); } else jobs.push([i, j]);
            }));
            let done = 0;
            for(const [i, j] of jobs){
                if(run !== ipdRun) return;   // a newer run started
                const c = cols[j];
                let r = A.pairMinSF(news[i].well, c.well, news[i].maxMd);
                if(c.isNew){
                    const r2 = A.pairMinSF(news[j].well, news[i].well, news[j].maxMd);   // check from the other side too
                    if(r2 && (!r || r2.sf < r.sf)) r = { sf:r2.sf, c2c:r2.c2c, refMd:r2.offMd, offMd:r2.refMd, real:r2.real };
                    res[j][i] = r ? Object.assign({}, r, { refMd: r.offMd, offMd: r.refMd }) : null;   // mirror (row j, column i): swap MDs to row j's view
                }
                res[i][j] = r;
                if(++done % 15 === 0){ prog.textContent = `Computing… ${done} / ${jobs.length} pairs`; await new Promise(rs => setTimeout(rs, 0)); }
            }
            A.forget(prefix);
            prog.textContent = `${jobs.length} pairs checked.`;
            const col = sf => sf == null ? 'inherit' : sf < red ? '#ff4c4c' : sf < orange ? '#ff9f1c' : '#00e676';
            // per-well summary
            const summ = news.map((a, i) => {
                let b = null, bj = -1;
                res[i].forEach((r, j) => { if(r && (!b || r.sf < b.sf)){ b = r; bj = j; } });
                return { a, b, other: bj >= 0 ? cols[bj].label : '—' };
            });
            ipd.sepSumm = summ;   // 2026-11-01: Min SF row on the iPad preview score cards
            const nRed = summ.filter(x => x.b && x.b.sf < red).length, nOr = summ.filter(x => x.b && x.b.sf >= red && x.b.sf < orange).length;
            let html = `<div style="margin-bottom:4px;">${nRed ? `<b style="color:#ff4c4c;">${nRed} well(s) below SF ${red}</b> · ` : ''}${nOr ? `<b style="color:#ff9f1c;">${nOr} well(s) below SF ${orange}</b> · ` : ''}${(!nRed && !nOr) ? '<b style="color:#00e676;">All new wells ≥ SF ' + orange + '</b>' : ''}</div>`;
            html += `<table style="font-size:11px;font-family:var(--wbt-mono);"><tr>${['Well','Min SF','Against','C2C (m)','at MD','offset MD'].map(h => `<th style="padding:0 8px 0 0;text-align:left;">${h}</th>`).join('')}</tr>` +
                summ.map(x => `<tr><td style="padding-right:8px;">${esc(x.a.label)}</td><td style="color:${col(x.b && x.b.sf)};font-weight:700;">${x.b ? f(Math.min(x.b.sf, 99), 2) : '—'}</td><td>${esc(x.other)}</td><td>${x.b ? f(x.b.c2c, 2) : '—'}</td><td>${x.b ? f(x.b.refMd, 1) : '—'}</td><td>${x.b ? f(x.b.offMd, 1) : '—'}</td></tr>`).join('') + '</table>';
            // matrix — CHANGED 2026-11-02 (John: with the existing wells as vertical column headers the long
            // names filled the scroll box and the rows could not be seen). TRANSPOSED: rows = existing / other wells
            // (full names readable, horizontal), columns = the new pad wells (short names); header row and name column
            // are sticky; rows sorted by their lowest SF; filter "only rows below the orange SF". Excel unchanged.
            const cc = c => c.cat === 'planned' ? '#0066ff' : c.cat === 'offset' ? '#ff4c4c' : c.cat === 'scenario' ? '#00e676' : 'var(--wbt-text)';
            const mRows = cols.map((c, j) => { let mn = Infinity; news.forEach((a, i) => { const r = res[i][j]; if(r && !(c.isNew && j === i) && r.sf < mn) mn = r.sf; }); return { c, j, mn }; }).sort((x, y) => x.mn - y.mn);
            html += `<details style="margin-top:6px;" open><summary style="cursor:pointer;">Matrix (rows = wells checked against, columns = new wells; sorted by lowest SF; hover a cell for C2C / MDs)</summary>
                <label style="font-size:11px;"><input type="checkbox" id="ipdSepOnlyBad"> only rows with SF &lt; ${orange}</label>
                <div style="max-height:420px;max-width:100%;overflow:auto;margin-top:3px;">
                <table style="font-size:10px;font-family:var(--wbt-mono);border-collapse:separate;border-spacing:0;"><tr><th style="position:sticky;top:0;left:0;z-index:3;background:var(--wbt-panel,#0d131b);text-align:left;padding:2px 6px;">Well \ new well</th>${news.map(a => `<th style="position:sticky;top:0;z-index:2;background:var(--wbt-panel,#0d131b);padding:2px 4px;white-space:nowrap;">${esc(String(a.label).split(' ').pop())}</th>`).join('')}<th style="position:sticky;top:0;z-index:2;background:var(--wbt-panel,#0d131b);padding:2px 4px;">Min</th></tr>` +
                mRows.map(({ c, j, mn }) => `<tr data-ipdmn="${isFinite(mn) ? mn : 99}"><th style="position:sticky;left:0;z-index:1;background:var(--wbt-panel,#0d131b);text-align:left;padding:1px 6px;white-space:nowrap;color:${cc(c)};font-weight:400;">${esc(c.label)}</th>` + news.map((a, i) => {
                    const r = res[i][j];
                    if(c.isNew && j === i) return '<td style="background:#222;"></td>';
                    if(!r) return '<td style="padding:1px 3px;color:var(--wbt-text-dim);text-align:center;">—</td>';
                    const bg = r.sf < red ? 'rgba(255,76,76,.35)' : r.sf < orange ? 'rgba(255,159,28,.35)' : 'rgba(0,230,118,.12)';
                    return `<td title="${esc(a.label)} vs ${esc(c.label)}: SF ${f(r.sf,2)}, C2C ${f(r.c2c,2)} m at MD ${f(r.refMd,1)} (offset MD ${f(r.offMd,1)})${r.real ? '' : ' — simplified model (no toolcode/magnetics)'}" style="padding:1px 4px;text-align:center;background:${bg};">${f(Math.min(r.sf, 99), 2)}</td>`;
                }).join('') + `<td style="padding:1px 4px;text-align:center;color:${col(mn)};font-weight:700;">${isFinite(mn) ? f(Math.min(mn, 99), 2) : '—'}</td></tr>`).join('') + '</table></div></details>';
            html += `<button type="button" class="wbt-btn" id="ipdSepXls" style="margin-top:6px;">&#11015; Download Excel</button>`;
            out.innerHTML = html;
            document.getElementById('ipdSepOnlyBad').addEventListener('change', e => { out.querySelectorAll('tr[data-ipdmn]').forEach(tr => { tr.style.display = (e.target.checked && +tr.dataset.ipdmn >= orange) ? 'none' : ''; }); });   // 2026-11-02
            document.getElementById('ipdSepXls').addEventListener('click', () => {
                if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
                const wb = XLSX.utils.book_new();
                const s1 = [['Well','Min SF','Against','C2C (m)','at MD (m)','Offset MD (m)']].concat(summ.map(x => [x.a.label, x.b ? +x.b.sf.toFixed(3) : '', x.other, x.b ? +x.b.c2c.toFixed(2) : '', x.b ? +x.b.refMd.toFixed(1) : '', x.b ? +x.b.offMd.toFixed(1) : '']));
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'Summary');
                const s2 = [[''].concat(cols.map(c => c.label))].concat(news.map((a, i) => [a.label].concat(cols.map((c, j) => res[i][j] ? +res[i][j].sf.toFixed(3) : ''))));
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'Min SF matrix');
                XLSX.writeFile(wb, (ipd.name || 'pad').replace(/[^\w\- ]+/g, '_') + '_separation.xlsx');
            });
        }

        async function ipdCreate(){
            const wells = (ipd.preview || []).filter(w => w.r.ok && !w.over);
            if(!wells.length) return;
            let group = ipd.name.trim() || 'Pad iPad';
            if(scenarios.some(sc => sc.group === group) && !confirm('A pad group named "' + group + '" already exists. Add these wells to it?')) return;
            const ref = WELLS.find(w => String(w._id) === String(ipd.refWell)) || WELLS[0];
            const items = wells.map(w => ({
                name: w.name, group, startMode: 'surface', wellId: ref ? String(ref._id) : '', tieMd: 0,
                start: { md:0, tvd:0, n:n(w.s.n), e:n(w.s.e), inc:0, az:0, rkb:n(w.s.ss) },
                // CHANGED 2026-11-06 (John): a back-projected iPad well is stored as an iPlan Optimum Align LIVE GROUP
                // (KOP / nudge rows, then the align + Project Back chain to the ICP, then the lateral) when the core
                // confirmed it with the Compass-validated solver (w.r.oaPlan); otherwise the plain sections (fallback).
                sections: w.r.oaPlan ? (() => { const g = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), P = w.r.oaPlan;
                    return P.pre.map(x => Object.assign({}, x)).concat([{ kind: 'hold', cl: 0, oaG: g, oaPart: 'oa', oaDef: JSON.parse(JSON.stringify(P.def)) }], P.post.map(x => Object.assign({}, x))); })() : w.r.sections,
                targets: [{ name: w.tg.name, n:n(w.tg.n), e:n(w.tg.e), ss:n(w.tg.ss), r:15 }],
                toolcode: null
            }));
            let docs;
            try { docs = await apiJson('/notes/iplan/batch/' + NOTE_ID, 'POST', { items }); }
            catch(err){ alert('Could not create the pad: ' + err.message); return; }
            ipdClearGhosts();
            docs.forEach(doc => { const sc = fromDoc(doc); sc.visible = true; compute(sc); draw(sc); drawTargets(sc); scenarios.push(sc); });
            selId = String(docs[0]._id);
            window.dispatchEvent(new CustomEvent('iplanScenariosChanged', { detail: { group } }));
            renderList(); renderEditor(); ipdRender();
            document.getElementById('ipdOut').innerHTML = `<span style="color:#00e676;">Created ${docs.length} scenario(s) in group "${esc(group)}".</span>`;
        }
        // 2026-10-12: panel only exists for admins (EJS role check) -> skip wiring otherwise
        if(document.getElementById('ipdHead')) document.getElementById('ipdHead').addEventListener('click', () => {
            const b = document.getElementById('ipdBody');
            const open = b.style.display === 'none';
            b.style.display = open ? 'flex' : 'none';
            if(open) ipdRender();
        });

        // Load the job's saved scenarios (all inactive/unticked by default).
        apiJson('/notes/iplan/list/' + NOTE_ID, 'GET').then(list => {
            (list || []).forEach(doc => { const sc = fromDoc(doc); compute(sc); scenarios.push(sc); });
            if(scenarios.length && !selId) selId = scenarios[0].id;
            renderList(); renderEditor();
        }).catch(err => console.warn('[iPlan] could not load saved scenarios:', err));
    })();
    
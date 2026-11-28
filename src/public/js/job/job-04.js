/* MTX Conveyor — job page script 4. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 3592) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

    (function(){
        const WELLBORES = JSON.parse(document.getElementById('wbtData').textContent);

        // ── Vertical axis = Sub-Sea elevation (CHANGED 2026-10-21) ─────────────
        // BUG: the 3D scene used Y = -TVD. TVD is measured from each well's OWN
        // RKB, so wells/pads with different RKB elevations were shifted against
        // each other (seen on ID2411). The Anti-collision module already uses
        // Sub-Sea for the same reason. Now every 3D object uses Y = Sub-Sea
        // (elevation, m, positive up; same convention as the survey "Sub-Sea"
        // column = RKB elevation - TVD). Up is still +Y, so orientations are
        // unchanged. Each station gets r._ss once here; wells with no Sub-Sea
        // data (legacy uploads) fall back to (median pad RKB - TVD) and are
        // listed in a warning on the viewer.
        const WBT_SS_FALLBACK = [];
        (function(){
            const ssNum = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
            const has = w => (w.survey || []).some(r => Math.abs(ssNum(r.subSea)) > 0.01);
            const rkbs = WELLBORES.filter(has).map(w => {
                const r = w.survey.find(x => Math.abs(ssNum(x.subSea)) > 0.01);
                return ssNum(r.tvd) + ssNum(r.subSea);
            }).sort((a, b) => a - b);
            const refRkb = rkbs.length ? rkbs[Math.floor(rkbs.length / 2)] : 0;
            WELLBORES.forEach(w => {
                const ok = has(w);
                if(!ok && (w.survey || []).length) WBT_SS_FALLBACK.push(w.wellName);
                (w.survey || []).forEach(r => { r._ss = ok ? ssNum(r.subSea) : refRkb - ssNum(r.tvd); });
            });
        })();
        function wbtYOf(row){ return (row && row._ss != null) ? row._ss : -(parseFloat(row && row.tvd) || 0); }
        const fallbackColors = [0x00c8ff, 0xff6b35, 0x39ff14, 0xffd060, 0xc084fc, 0x2dd4bf, 0xff4060, 0x79c0ff];

        // Added 2026-08-25: Single-mode colors — every Subject well navy
        // blue (light mode) / electric blue (dark mode), every Offset well
        // red. Dark-mode Subject color changed 2026-08-26 from navy
        // (0x1a3fa0) to electric blue (0x0066ff) per the person's direct
        // request — navy read too dark/low-contrast against the viewer's
        // near-black background. Light mode keeps navy, which reads fine
        // against the light-mode viewer background.
        const WBT_SINGLE_SUBJECT_COLOR_LIGHT = 0x1a3fa0; // navy blue
        const WBT_SINGLE_SUBJECT_COLOR_DARK  = 0x0066ff; // electric blue
        const WBT_SINGLE_OFFSET_COLOR        = 0xff0000; // red

        // Subject/Offset classification shared by both coloring modes and
        // the dashboard/table logic below — explicit wellCategory tag wins;
        // for legacy untagged data, fall back to the [NN]..._LNN name
        // pattern (same rule duplicated at several other points in this
        // file, e.g. wbtIsSubjectWell inside loadWellbores()).
        function wbtWellIsSubjectByCategory(well){
            const wn = (well.wellName || '').trim();
            if(well.wellCategory === 'subject') return true;
            if(well.wellCategory === 'offset') return false;
            return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
        }

        // Returns the numeric THREE color for one well, honoring the
        // current WBT_COLOR_MODE. In 'multi' mode this is exactly the
        // original behavior (well.colorHex if set, else a fallback from
        // the palette by index).
        function wbtColorForWell(well, idx){
            if(WBT_COLOR_MODE === 'single'){
                if(!wbtWellIsSubjectByCategory(well)) return WBT_SINGLE_OFFSET_COLOR;
                var isLight = document.body.classList.contains('light-mode');
                return isLight ? WBT_SINGLE_SUBJECT_COLOR_LIGHT : WBT_SINGLE_SUBJECT_COLOR_DARK;
            }
            return well.colorHex ? parseInt(well.colorHex.replace('#',''), 16) : fallbackColors[idx % fallbackColors.length];
        }

        let scene, camera, renderer, controls;
        let group, axesHelper, gridHelper, curtainGroup;
        let wellsData = [];

        function initScene(){
            const canvas = document.getElementById('wbtViewer');
            if(!canvas) return;

            scene = new THREE.Scene();
            scene.background = new THREE.Color(document.body.classList.contains('light-mode') ? 0xffffff : 0x0a0e14);

            const w = canvas.clientWidth, h = canvas.clientHeight;
            camera = new THREE.PerspectiveCamera(20, w/h, 0.1, 1000000);

            renderer = new THREE.WebGLRenderer({canvas, antialias:true});
            renderer.setSize(w, h);
            renderer.setPixelRatio(window.devicePixelRatio || 1);

            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;

            scene.add(new THREE.AmbientLight(0xffffff, 0.9));

            group = new THREE.Group();
            scene.add(group);

            axesHelper = new THREE.AxesHelper(200);
            group.add(axesHelper);

            gridHelper = new THREE.GridHelper(2000, 20, 0x1e2d3d, 0x161e28);
            group.add(gridHelper);

            curtainGroup = new THREE.Group();
            group.add(curtainGroup);

            wbtFormationGroup = new THREE.Group();
            group.add(wbtFormationGroup);

            wbtMarkerGroup = new THREE.Group();
            group.add(wbtMarkerGroup);
            wbtInitTooltip();
            wbtPfInit();   // 2026-11-01: click a trajectory -> profile panel
            wbtTgInit3D(); // 2026-11-09: double-click a trajectory -> new target dialog

            animate();
            window.addEventListener('resize', onResize);
            // The viewer now lives inside a collapsed-by-default accordion,
            // so its canvas has zero size until first opened — Three.js
            // would otherwise keep the 0x0 viewport it initialised with.
            const wbtCollapseEl = document.getElementById('collapseWbt');
            if(wbtCollapseEl){
                wbtCollapseEl.addEventListener('shown.bs.collapse', function(){
                    onResize();
                    // Also re-fit the camera to the full box: loadWellbores()
                    // ran once already at page load, while the accordion
                    // (and canvas) was still collapsed/zero-sized.
                    let pts = [];
                    wellsData.forEach(w => {
                        const curve = w.mesh.userData.curve;
                        if(curve && curve.points) pts = pts.concat(curve.points);
                    });
                    if(pts.length) fitCameraToObject(pts);
                });
            }
            setupWbtUI();
            loadWellbores();
            wbtFPInit();
            wbtPolyInit();
        }

        function onResize(){
            const canvas = document.getElementById('wbtViewer');
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if(w === 0 || h === 0) return;
            camera.aspect = w/h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        }

        function animate(){
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }

        // ---------------- Thick line (tube mesh) ----------------
        function buildWellLine(points, color){
            const curve = new THREE.CatmullRomCurve3(points);
            const baseRadius = Math.max(1, estimateScale(points) * 0.004);
            const tubularSegments = Math.max(2, points.length * 2);
            const geometry = new THREE.TubeGeometry(curve, tubularSegments, baseRadius, 6, false);

            const material = new THREE.MeshBasicMaterial({color});
            const line = new THREE.Mesh(geometry, material);
            line.userData.curve = curve;
            line.userData.baseRadius = baseRadius;
            line.userData.tubularSegments = tubularSegments;
            return line;
        }

        function estimateScale(points){
            if(points.length === 0) return 100;
            const box = new THREE.Box3();
            points.forEach(p => box.expandByPoint(p));
            const size = box.getSize(new THREE.Vector3());
            return Math.max(size.x, size.y, size.z, 10);
        }

        // ---------------- Curtains ----------------
        function buildCurtains(allPoints){
            const grp = new THREE.Group();
            if(allPoints.length === 0) return grp;

            const box = new THREE.Box3();
            allPoints.forEach(p => box.expandByPoint(p));

            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const boxGeo = new THREE.BoxGeometry(size.x || 1, size.y || 1, size.z || 1);
            const edges = new THREE.EdgesGeometry(boxGeo);
            const lineMat = new THREE.LineBasicMaterial({color: 0x00c8ff, transparent:true, opacity:0.35});
            const boxLines = new THREE.LineSegments(edges, lineMat);
            boxLines.position.copy(center);
            grp.add(boxLines);

            const ewGeo = new THREE.PlaneGeometry(size.x || 1, size.y || 1);
            const ewMat = new THREE.MeshBasicMaterial({color:0x1e2d3d, transparent:true, opacity:0.12, side:THREE.DoubleSide});
            const ewWall = new THREE.Mesh(ewGeo, ewMat);
            ewWall.position.set(center.x, center.y, box.max.z);
            grp.add(ewWall);

            const nsGeo = new THREE.PlaneGeometry(size.z || 1, size.y || 1);
            const nsMat = new THREE.MeshBasicMaterial({color:0x1e2d3d, transparent:true, opacity:0.12, side:THREE.DoubleSide});
            const nsWall = new THREE.Mesh(nsGeo, nsMat);
            nsWall.rotation.y = Math.PI/2;
            nsWall.position.set(box.min.x, center.y, center.z);
            grp.add(nsWall);

            return grp;
        }

        function fitCameraToObject(points){
            if(points.length === 0) return;
            const box = new THREE.Box3();
            points.forEach(p => box.expandByPoint(p));
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z, 10);

            // Fit the ENTIRE bounding box in view, regardless of how
            // elongated it is in any direction. Standard technique: treat
            // the box's bounding sphere (radius = half its diagonal, which
            // always fully contains the box) and compute the distance
            // needed so that sphere fits inside the camera's field of view
            // (distance = radius / sin(halfFOV) — the standard perspective
            // "fit sphere to frustum" relationship).
            const sphereRadius = size.length() / 2;
            const fovRad = camera.fov * (Math.PI / 180);
            // NOTE: margin must be > 1 for headroom — a value < 1 (as this
            // was previously set: 0.7) moves the camera CLOSER than the
            // exact-fit distance, which crops the box rather than framing
            // it with room to spare. That was the bug behind "the full box
            // isn't visible by default".
            const margin = 0.8 //1.08; // 1.2 headroom x 0.9 = 10% closer/bigger than the previous default, still with some breathing room
            const distance = (sphereRadius / Math.sin(fovRad / 2)) * margin;

            // True isometric direction (equal foreshortening on all three
            // axes) rather than the previous (1, 0.5, 1), which skewed the
            // default/reset view toward a flatter top-down angle.
            const dir = new THREE.Vector3(1, 1, 1).normalize();
            controls.target.copy(center);
            camera.position.copy(center).addScaledVector(dir, distance);
            camera.near = Math.max(distance / 1000, 0.01);
            camera.far  = distance * 100;
            camera.updateProjectionMatrix();
            controls.update();
        }

        // ---------------- Tables ----------------
        const fieldLabels = [
            {key:'well', label:'Well'},
            {key:'md', label:'MD'},
            {key:'incl', label:'Incl'},
            {key:'azim', label:'Azim'},
            {key:'tvd', label:'TVD'},
            {key:'subSea', label:'Sub-Sea'},
            {key:'vertSec', label:'Vert. Sec.'},
            {key:'localN', label:'Local N'},
            {key:'localE', label:'Local E'},
            {key:'dogleg', label:'Dogleg'},
            {key:'northing', label:'Northings'},
            {key:'easting', label:'Eastings'},
            {key:'latitude', label:'Latitude'},
            {key:'longitude', label:'Longitude'},
            {key:'comments', label:'Comments'},
        ];

        function renderTable(name, survey, color){
            const wrap = document.createElement('div');
            wrap.className = 'wbt-table-wrap';

            const header = document.createElement('div');
            header.style.padding = '6px 10px';
            header.style.fontFamily = 'var(--wbt-cond)';
            header.style.fontSize = '11px';
            header.style.letterSpacing = '1px';
            header.style.textTransform = 'uppercase';
            header.style.color = 'var(--wbt-text-bright)';
            header.style.background = 'var(--wbt-panel2)';
            header.style.borderBottom = '1px solid var(--wbt-border)';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.gap = '8px';

            const sw = document.createElement('span');
            sw.className = 'wbt-swatch';
            sw.style.background = '#' + color.toString(16).padStart(6,'0');
            header.appendChild(sw);
            header.appendChild(document.createTextNode(name + ' (' + survey.length + ' rows)'));
            wrap.appendChild(header);

            const table = document.createElement('table');
            table.className = 'wbt-table';

            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            fieldLabels.forEach(f => {
                const th = document.createElement('th');
                th.textContent = f.label;
                trh.appendChild(th);
            });
            thead.appendChild(trh);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            survey.forEach(r => {
                const tr = document.createElement('tr');
                fieldLabels.forEach(f => {
                    const td = document.createElement('td');
                    const val = r[f.key];
                    // CHANGED 2026-11-13 (John): uniform decimals — 2 for every number, 5 for latitude / longitude (was raw floats,
                    // e.g. 2750.7551882734156). Display only; the stored values and the Excel download keep full precision.
                    td.textContent = (val === undefined || val === null || val === '') ? '' :
                        (f.key !== 'well' && f.key !== 'comments' && String(val).trim() !== '' && isFinite(+val)) ? (+val).toFixed(f.key === 'latitude' || f.key === 'longitude' ? 5 : 2) : val;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            wrap.appendChild(table);
            wbtRenderSteerRow(wrap, name, survey, color);
            document.getElementById('wbtTables').appendChild(wrap);
        }        // ---------------- Load wellbores from server data ----------------
        function loadWellbores(){
            const legendList = document.getElementById('wbtLegendList');
            legendList.innerHTML = '';
            document.getElementById('wbtTables').innerHTML = '';
            wellsData = [];
            wbtTubeMeshData = [];
            wbtClearMarkers();
            let allPoints = [];

            WELLBORES.forEach((well, idx) => {
                const color = wbtColorForWell(well, idx);
                const survey = well.survey || [];
                // X = Eastings, Y = -TVD (only TVD goes down), Z = -Northings.
                // Recomputed here from raw easting/tvd/northing (not the stored
                // position field) so the orientation is correct regardless of
                // when the data was uploaded.
                const points = survey.map(p => new THREE.Vector3(
                    p.easting || 0,
                    wbtYOf(p),   // 2026-10-21: Sub-Sea elevation (was -(p.tvd))
                    -(p.northing || 0)
                ));

                if(points.length < 2) return;

                const mesh = buildWellLine(points, color);
                group.add(mesh);
                allPoints = allPoints.concat(points);

                // Track tube mesh for raycasting tooltip
                wbtTubeMeshData.push({ mesh, name: well.wellName, colorHex: well.colorHex, survey });
                mesh.userData.pickName = well.wellName;   // 2026-11-02: profile panel dropdown
                mesh.userData.pick = () => ({ name: well.wellName, color: well.colorHex || color, rows: wbtPfRowsFromSurvey(survey),   // 2026-11-01: profile panel
                    ac: () => { const A = window.acpPadApi; const x = A && A.baseWells().find(b => String(b.well._id) === String(well._id) || b.well.wellName === well.wellName); return x ? x.well : null; } });

                wellsData.push({name: well.wellName, wellName: well.wellName, color, mesh, _id: well._id, pad: well.pad, source: well.source, wellCategory: well.wellCategory, colorHex: well.colorHex || ('#' + color.toString(16).padStart(6,'0')), surveyCount: well.surveyCount});

                const item = document.createElement('div');
                item.className = 'wbt-legend-item';
                const sw = document.createElement('span');
                sw.className = 'wbt-swatch';
                sw.style.background = '#' + color.toString(16).padStart(6,'0');
                item.appendChild(sw);
                item.appendChild(document.createTextNode(well.wellName));
                legendList.appendChild(item);

                // Trajectories accordion tables: subject wells only (offset
                // wells still render in the 3D view and legend above, they
                // just aren't tabulated/reported).
                if(wbtIsSubjectWell(well)) renderTable(well.wellName, survey, color);
            });

            const curtains = buildCurtains(allPoints);
            curtainGroup.add(curtains);

            buildWbtWellList();
            applyWbtLineThickness();
            wbtFillIndivSelect();
            if(WBT_SS_FALLBACK.length){   // 2026-10-21: wells drawn without real Sub-Sea data
                const wrap = document.getElementById('wbtViewer') && document.getElementById('wbtViewer').parentElement;
                if(wrap){
                    const d = document.createElement('div');
                    d.style.cssText = 'position:absolute;left:8px;bottom:8px;max-width:60%;background:rgba(255,208,96,.12);border:1px solid #ffd060;color:#ffd060;font-size:10px;padding:4px 8px;border-radius:3px;z-index:3;';
                    d.textContent = '⚠ No Sub-Sea data for: ' + WBT_SS_FALLBACK.join(', ') + ' — drawn using the pad RKB − TVD (approximate). Re-upload with a Sub-Sea column for exact elevation.';
                    wrap.appendChild(d);
                }
            }
            fitCameraToObject(allPoints);
            applyWbtVisibility();

            // Dashboard + accordion + Excel export (job.ejs is read-only: data comes from WELLBORES)
            // A well is "subject" if explicitly tagged that way at upload
            // time (wellCategory), or — for legacy data uploaded before that
            // field existed — if its name follows the [NN]..._LNN convention.
            // Explicitly tagged "offset" always excludes it, regardless of name.
            function wbtIsSubjectWell(well){
                const wn = (well.wellName || '').trim();
                if(well.wellCategory === 'subject') return true;
                if(well.wellCategory === 'offset') return false;
                return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
            }

            const wellsForDashboard = WELLBORES
                .filter(wbtIsSubjectWell)
                .map((well, idx) => ({
                    name: well.wellName,
                    color: wbtColorForWell(well, idx),
                    survey: well.survey || []
                }));
            wbtRenderDashboard(wellsForDashboard);
            window.wbtRerenderCards = function(){ wbtRenderDashboard(wellsForDashboard); };   // 2026-11-20: re-run when the ROP curve changes
            wbtSetupAccordion();

            const padLabel = (WELLBORES[0] && WELLBORES[0].pad) ? WELLBORES[0].pad : 'Pad';
            const exportBtn = document.getElementById('wbtExportExcel');
            if(exportBtn){
                exportBtn.addEventListener('click', () => wbtExportToExcel(wellsForDashboard, padLabel));
            }

            // Geological formations + markers
            if(WELLBORES.length > 0 && allPoints.length > 0){
                wbtPadBBox = new THREE.Box3();
                allPoints.forEach(p => wbtPadBBox.expandByPoint(p));
                const firstSurvey = WELLBORES[0].survey || [];
                const allComments = wbtExtractFormations(firstSurvey, 'comments', 'tvd');
                wbtBuildFormations(allComments, wbtPadBBox, firstSurvey);

                // Build sphere markers for all wellbores
                const scaleEst = Math.max(wbtPadBBox.max.x - wbtPadBBox.min.x, wbtPadBBox.max.z - wbtPadBBox.min.z, 100);
                wbtClearMarkers();
                WELLBORES.forEach(well => {
                    wbtBuildMarkersForSurvey(well.survey || [], scaleEst);
                });
            }
        }
        // ---------------- Wellbore visibility list ----------------
        function buildWbtWellList(){
            const container = document.getElementById('wbtWellList');
            window.wbtBuildTree(container, wellsData, {
                allowDelete: false,
                getVisible: (id) => {
                    const w = wellsData.find(x => String(x._id) === String(id));
                    return w ? w.mesh.visible : true;
                },
                onToggleWell: (id, visible) => {
                    const w = wellsData.find(x => String(x._id) === String(id));
                    if(w) w.mesh.visible = visible;
                }
            });
        }

        // ---------------- Line thickness ----------------
        // CHANGED 2026-10-11: thickness factor per group (Subjects / Offsets /
        // Scenarios sliders) with an optional per-trajectory override
        // (WBT_LT_OVERRIDE, session only). Keys: 'w:<wellbore _id>' for planned
        // wells, 's:<scenario id>' for iPlan scenarios.
        const WBT_LT_OVERRIDE = {};
        function wbtSliderVal(id){ const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0.5) : 0.5; }
        function wbtThicknessForWell(w){
            const k = 'w:' + w._id;
            if(WBT_LT_OVERRIDE[k] != null) return WBT_LT_OVERRIDE[k];
            return wbtWellIsSubjectByCategory(w) ? wbtSliderVal('wbtLineThickness') : wbtSliderVal('wbtLineThicknessOffset');
        }
        function wbtThicknessForScenario(id){
            const k = 's:' + id;
            return WBT_LT_OVERRIDE[k] != null ? WBT_LT_OVERRIDE[k] : wbtSliderVal('wbtLineThicknessScenario');
        }
        function applyWbtLineThickness(){
            wellsData.forEach(w => {
                const factor = wbtThicknessForWell(w);
                const mesh = w.mesh;
                const {curve, baseRadius, tubularSegments} = mesh.userData;
                mesh.geometry.dispose();
                mesh.geometry = new THREE.TubeGeometry(curve, tubularSegments, baseRadius * factor, 6, false);
            });
            [['wbtLtSubjVal','wbtLineThickness'],['wbtLtOffVal','wbtLineThicknessOffset'],['wbtLtScnVal','wbtLineThicknessScenario'],['wbtLtIpadVal','wbtLineThicknessIpad']].forEach(([lbl, id]) => {
                const el = document.getElementById(lbl); if(el) el.textContent = '× ' + wbtSliderVal(id).toFixed(1);
            });
            // iPlan redraws its scenario tubes on this event (see iPlan script)
            window.dispatchEvent(new CustomEvent('wbtThicknessChanged'));
        }
        // Individual-trajectory picker: planned wells + current iPlan scenarios.
        function wbtFillIndivSelect(){
            const sel = document.getElementById('wbtLtIndivSel'); if(!sel) return;
            const prev = sel.value;
            let html = '<option value="">— select —</option><optgroup label="Planned wells">' +
                wellsData.map(w => `<option value="w:${w._id}">${(w.wellName || '').replace(/</g,'&lt;')}</option>`).join('') + '</optgroup>';
            const scn = (window.IPLAN_SCENARIOS || []);
            if(scn.length) html += '<optgroup label="iPlan scenarios">' + scn.map(sc => `<option value="s:${sc.id}">${String(sc.name || sc.id).replace(/</g,'&lt;')}</option>`).join('') + '</optgroup>';
            sel.innerHTML = html;
            if(prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
            wbtSyncIndivSlider();
        }
        function wbtCurrentFactor(key){
            if(!key) return 0.5;
            if(key.indexOf('s:') === 0) return wbtThicknessForScenario(key.slice(2));
            const w = wellsData.find(x => 'w:' + x._id === key);
            return w ? wbtThicknessForWell(w) : 0.5;
        }
        function wbtSyncIndivSlider(){
            const sel = document.getElementById('wbtLtIndivSel'), sl = document.getElementById('wbtLtIndiv');
            const rs = document.getElementById('wbtLtIndivReset'), lb = document.getElementById('wbtLtIndivVal');
            if(!sel || !sl) return;
            const key = sel.value;
            sl.disabled = !key; rs.disabled = !key || WBT_LT_OVERRIDE[key] == null;
            if(key) sl.value = wbtCurrentFactor(key);
            lb.textContent = key ? ('× ' + wbtCurrentFactor(key).toFixed(1) + (WBT_LT_OVERRIDE[key] != null ? ' (custom)' : ' (group)')) : '';
        }

        // ---------------- Visibility toggles ----------------
        function applyWbtVisibility(){
            axesHelper.visible = document.getElementById('wbtToggleAxes').checked;
            gridHelper.visible = document.getElementById('wbtToggleGrid').checked;
            curtainGroup.visible = document.getElementById('wbtToggleCurtains').checked;
            // Formation visibility is per-mesh (checkbox per formation), not a global toggle;
            // the formationGroup itself stays visible — individual meshes are toggled.
            document.getElementById('wbtLegendPanel').style.display =
                document.getElementById('wbtToggleLegend').checked ? 'block' : 'none';
        }

        // ---------------- UI wiring ----------------
        // Added 2026-08-25: recolor every already-built wellbore tube mesh
        // + legend swatch + tooltip color in place, without touching
        // anything else (curtains/markers/formations) — loadWellbores()
        // itself can't safely be called a second time since it ADDS new
        // meshes/curtains rather than replacing them.
        function wbtApplyColorMode(){
            wellsData.forEach((w, idx) => {
                const well = WELLBORES.find(b => String(b._id) === String(w._id)) || w;
                const color = wbtColorForWell(well, idx);
                w.color = color;
                w.colorHex = '#' + color.toString(16).padStart(6, '0');
                if(w.mesh && w.mesh.material) w.mesh.material.color.setHex(color);
            });
            // Legend swatches (rebuilt in well order, same as loadWellbores())
            const swatches = document.querySelectorAll('#wbtLegendList .wbt-swatch');
            swatches.forEach((sw, idx) => {
                if(wellsData[idx]) sw.style.background = wellsData[idx].colorHex;
            });
            // Tooltip color tint (see wbtTubeMeshData usage in the tooltip builder)
            wbtTubeMeshData.forEach(td => {
                const w = wellsData.find(x => x.mesh === td.mesh);
                if(w) td.colorHex = w.colorHex;
            });
        }

        function setupWbtUI(){
            const colorModeEl = document.getElementById('wbtColorMode');
            if(colorModeEl){
                colorModeEl.value = WBT_COLOR_MODE;
                colorModeEl.addEventListener('change', async (e) => {
                    WBT_COLOR_MODE = e.target.value;
                    wbtApplyColorMode();
                    try{
                        await fetch('/notes/wbtColorMode/' + WBT_NOTE_ID, {
                            method: 'PATCH',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ wbtColorMode: WBT_COLOR_MODE }),
                        });
                    }catch(err){
                        console.error('[wbtColorMode] save failed', err);
                    }
                });
            }

            ['wbtToggleAxes','wbtToggleCurtains','wbtToggleLegend','wbtToggleGrid'].forEach(id => {
                document.getElementById(id).addEventListener('change', applyWbtVisibility);
            });

            document.getElementById('wbtLineThickness').addEventListener('input', () => { applyWbtLineThickness(); wbtSyncIndivSlider(); });
            ['wbtLineThicknessOffset','wbtLineThicknessScenario','wbtLineThicknessIpad'].forEach(id => {
                const el = document.getElementById(id);
                if(el) el.addEventListener('input', () => { applyWbtLineThickness(); wbtSyncIndivSlider(); });
            });
            const ltSel = document.getElementById('wbtLtIndivSel');
            if(ltSel){
                ltSel.addEventListener('focus', wbtFillIndivSelect);   // pick up newly created scenarios
                ltSel.addEventListener('change', wbtSyncIndivSlider);
                document.getElementById('wbtLtIndiv').addEventListener('input', e => {
                    if(!ltSel.value) return;
                    WBT_LT_OVERRIDE[ltSel.value] = parseFloat(e.target.value);
                    applyWbtLineThickness(); wbtSyncIndivSlider();
                });
                document.getElementById('wbtLtIndivReset').addEventListener('click', () => {
                    delete WBT_LT_OVERRIDE[ltSel.value];
                    applyWbtLineThickness(); wbtSyncIndivSlider();
                });
                window.addEventListener('iplanScenariosChanged', wbtFillIndivSelect);
            }

            document.getElementById('wbtMarkerSize').addEventListener('input', (e) => {
                wbtMarkerScale = parseFloat(e.target.value);
                wbtRebuildAllMarkers();
            });

            // Formation mesh density: regenerate each formation's line grid
            // at the new resolution, preserving whatever visibility the user
            // had toggled (so adjusting density doesn't reset the checkboxes).
            const densityEl = document.getElementById('wbtFormationDensity');
            if(densityEl){
                densityEl.addEventListener('input', (e) => {
                    wbtFormationDensity = parseInt(e.target.value, 10);
                    const lbl = document.getElementById('wbtFormationDensityVal');
                    if(lbl) lbl.innerHTML = wbtFormationDensity + ' &times; ' + wbtFormationDensity;
                    if(!wbtPadBBox) return;
                    wbtFormations.forEach(f => {
                        if(!f.mesh) return;
                        const wasVisible = f.mesh.visible;
                        wbtFormationGroup.remove(f.mesh);
                        if(f.mesh.geometry) f.mesh.geometry.dispose();
                        const newMesh = wbtBuildFormationMesh(f.y, wbtPadBBox);   // 2026-10-21: Sub-Sea
                        newMesh.visible = wasVisible;
                        wbtFormationGroup.add(newMesh);
                        f.mesh = newMesh;
                        // Keep the raycast-tooltip entry pointing at the new mesh
                        const pd = wbtFormPlaneData.find(p => p.name === f.name);
                        if(pd) Object.defineProperty(pd, 'visible', { get(){ return newMesh.visible; }, configurable: true });
                    });
                });
            }

            document.getElementById('wbtRotationAxis').addEventListener('change', (e) => {
                const axis = e.target.value;
                if(axis === 'none'){
                    controls.minPolarAngle = 0;
                    controls.maxPolarAngle = Math.PI;
                    controls.minAzimuthAngle = -Infinity;
                    controls.maxAzimuthAngle = Infinity;
                    controls.enableRotate = true;
                    return;
                }
                controls.enableRotate = true;
                if(axis === 'y'){
                    controls.minPolarAngle = controls.getPolarAngle();
                    controls.maxPolarAngle = controls.getPolarAngle();
                    controls.minAzimuthAngle = -Infinity;
                    controls.maxAzimuthAngle = Infinity;
                } else if(axis === 'x' || axis === 'z'){
                    controls.minAzimuthAngle = controls.getAzimuthalAngle();
                    controls.maxAzimuthAngle = controls.getAzimuthalAngle();
                    controls.minPolarAngle = 0;
                    controls.maxPolarAngle = Math.PI;
                }
            });

            document.getElementById('wbtResetView').addEventListener('click', () => {
                let allPoints = [];
                wellsData.forEach(w => {
                    const pos = w.mesh.geometry.attributes.position;
                    // fallback: use curve points
                });
                // Recompute from curves
                allPoints = [];
                wellsData.forEach(w => {
                    const curve = w.mesh.userData.curve;
                    if(curve && curve.points) allPoints = allPoints.concat(curve.points);
                });
                fitCameraToObject(allPoints);
                document.getElementById('wbtRotationAxis').value = 'none';
                controls.enableRotate = true;
                controls.minPolarAngle = 0;
                controls.maxPolarAngle = Math.PI;
                controls.minAzimuthAngle = -Infinity;
                controls.maxAzimuthAngle = Infinity;
            });
        }


        function num(v){
            const n = parseFloat(v);
            return isNaN(n) ? 0 : n;
        }

        // ---------------- Pad Trajectory Dashboard & Excel Export ----------------
        // All values used as-stored (same units as trajectory tables).
        // No unit conversion applied.
        //
        // Comment-based station identification (case-insensitive, tolerant of
        // repeated/decorated text e.g. "sKOP - sKOP", "ICP - ", "ICP -ICP"):
        //   SC         -> Surface Casing point
        //   KOP        -> Kick-off Point (start of build)
        //   ICP        -> End of build / start of lateral
        //   LP         -> Landing Point (fallback if no ICP)
        //   START TANG -> Start of tangent section
        //   END TANG   -> End of tangent section
        //   START STEAMFLOOD TANG / END STEAMFLOOD TANG -> optional pump
        //       ("Steamflood") tangent, added 2026-10-09. These do NOT match the
        //       'START TANG'/'END TANG' patterns above (the word STEAMFLOOD sits
        //       in between), so the two tangents never get confused.
        // Fallbacks when comments absent:
        //   KOP  -> first station where Incl > 0
        //   ICP  -> first Incl == 90, else first Incl >= 88, else TD
        //
        // Steer Index (reproduced exactly from uploadDPI.ejs):
        //   effort = sum over all intervals of max(DLS - 1, 0)^2 * dMD
        //   steer_index = effort / total_MD
        //   Source: same formula used in DPI dashboard.
        //
        // DDI (Oag & Williams, IADC/SPE 59196, 2000):
        //   DDI = log10( MD * AHD * Tortuosity / TVD )
        //   Tortuosity = sum of Dogleg values, AHD = horizontal displacement.

        function wbtFindByComment(survey, patterns){
            return survey.find(r => {
                const c = (r.comments || '').toUpperCase();
                return patterns.some(p => c.includes(p));
            });
        }

        // Steer effort (from uploadDPI.ejs - computeSteerEffortFullPath)
        function wbtComputeSteerEffort(survey){
            if(!survey || survey.length < 2) return null;
            let tot = 0;
            for(let i = 1; i < survey.length; i++){
                const dls = num(survey[i].dogleg);
                const md  = num(survey[i].md);
                const mdp = num(survey[i-1].md);
                if(!isFinite(dls) || !isFinite(md) || !isFinite(mdp)) continue;
                const dMD = md - mdp;
                if(dMD <= 0) continue;
                const above = Math.max(dls - 1, 0);
                tot += (above * above) * dMD;
            }
            return tot;
        }

        function wbtNormalizeClamp(val, lo, hi){
            if(!isFinite(val) || !isFinite(lo) || !isFinite(hi) || hi === lo) return null;
            return Math.min(Math.max((val - lo) / (hi - lo), 0), 1);
        }

        // Average the ROP-vs-Measured-Depth "Average" curve's y-values
        // across [mdStart, mdEnd]. Uses the same Drilling Mechanics data
        // (#pasonPlotsData) already embedded on the page — re-parsed here
        // since this script runs independently of the Drilling Mechanics
        // script block. Returns null (no fabricated fallback) if the ROP
        // plot hasn't been uploaded or has no points in that range.
        function wbtAverageROPInRange(mdStart, mdEnd, sec){
            if(sec && window.MTX_SRM && window.MTX_SRM.rop(sec)) return window.MTX_SRM.rop(sec);   // 2026-11-20: slide / rotate model when active
            const dataEl = document.getElementById('pasonPlotsData');
            if(!dataEl) return null;
            let doc;
            try { doc = JSON.parse(dataEl.textContent); } catch(e){ return null; }
            const ropData = doc && doc.plots && doc.plots['rop'];
            if(!ropData || !ropData.rows || !ropData.rows.length) return null;
            return window.MTX_ROP.lw(ropData.rows, mdStart, mdEnd);   // 2026-11-20: length-weighted, selected curve (was plain mean of Average)
        }

        // Read the pause values used by the Calculated Time vs Depth chart
        // (saved on the last "Calculate" click), or fall back to the same
        // defaults shown in that chart's input fields if nothing has been
        // calculated yet. This keeps the scorecard's Build/Lateral times
        // consistent with whatever the chart is actually showing.
        function wbtGetSavedPauseValues(){
            const dataEl = document.getElementById('pasonPlotsData');
            const defaults = { pauseDefault: 0.15, pauseIC: 1.0 };
            if(!dataEl) return defaults;
            let doc;
            try { doc = JSON.parse(dataEl.textContent); } catch(e){ return defaults; }
            const calc = doc && doc.plots && doc.plots['td'] && doc.plots['td'].calculated;
            if(!calc) return defaults;
            return {
                pauseDefault: (typeof calc.pauseDefault === 'number') ? calc.pauseDefault : defaults.pauseDefault,
                pauseIC:      (typeof calc.pauseIC === 'number')      ? calc.pauseIC      : defaults.pauseIC,
            };
        }

        function wbtComputeMetrics(wellName, survey){
            if(!survey || survey.length === 0) return null;

            const first = survey[0];
            const last  = survey[survey.length - 1];

            // Surface Casing — look for "SurfaceCasing" in comment
            const sc = wbtFindByComment(survey, ['SURFACECASING']);

            // ADDED 2026-10-09: Surface KickOff flag — true when ANY station from
            // surface down to (and including) the "SurfaceCasing" comment station
            // has Dogleg > 0, i.e. steering happened in the surface hole.
            // null when there is no SurfaceCasing comment (can't tell -> shown "—").
            const surfaceKickoff = sc
                ? survey.some(r => num(r.md) <= num(sc.md) && num(r.dogleg) > 0)
                : null;

            // KOP — look for "KickOff" in comment, fallback to first incl > 0
            let kop = wbtFindByComment(survey, ['KICKOFF']);
            if(!kop) kop = survey.find(r => num(r.incl) > 0);
            if(!kop) kop = first;

            // Intermediate Casing — look for "IntermediateCasing"
            const ic = wbtFindByComment(survey, ['INTERMEDIATECASING']);

            // Landing Point — look for "Landing"
            const lp = wbtFindByComment(survey, ['LANDING']);

            // Determine ICP / Landing used for lateral calculation:
            // Priority 1: if LP exists AND (no IC, OR LP.md > IC.md) → use LP
            // Priority 2: if IC exists AND IC.md > LP.md (or no LP) → use IC
            // Fallback: first survey point where incl ≥ 88°
            // Last resort: TD
            let icp, icpSource;

            if(lp && (!ic || num(lp.md) > num(ic.md))){
                icp       = lp;
                icpSource = 'Landing (comment)';
            } else if(ic && (!lp || num(ic.md) >= num(lp.md))){
                icp       = ic;
                icpSource = 'IntermediateCasing (comment)';
            } else {
                // No IC and no Landing comment — use first point ≥ 88°
                const fallback88 = survey.find(r => num(r.incl) >= 88);
                if(fallback88){
                    icp       = fallback88;
                    icpSource = 'Incl ≥ 88° (no comment found)';
                } else {
                    icp       = last;
                    icpSource = 'TD (no landing found)';
                }
            }

            // Lateral length:
            // If Landing.md > IC.md (or no IC) → lateral = TD - Landing
            // If IC exists and IC.md > Landing.md → lateral = TD - IC
            // (already handled above since icp is set to whichever is deeper)
            const lateralLength = num(last.md) - num(icp.md);

            // Tangent section
            const tangentStart = wbtFindByComment(survey, ['START TANG']);
            const tangentEnd   = wbtFindByComment(survey, ['END TANG']);
            let tangent = null;
            if(tangentStart || tangentEnd){
                const tS = tangentStart || tangentEnd;
                const tE = tangentEnd   || tangentStart;
                tangent = {
                    mdStart : num(tS.md),
                    mdEnd   : num(tE.md),
                    tvdStart: num(tS.tvd),
                    tvdEnd  : num(tE.tvd),
                    inclFirst: num(tS.incl),
                    inclLast : num(tE.incl),
                };
                tangent.length = tangent.mdEnd - tangent.mdStart;
                // delta TVD from End Tangent to ICP
                tangent.deltaTVDtoICP = num(icp.tvd) - tangent.tvdEnd;
            }

            // ADDED 2026-10-09: optional Steamflood (pump) tangent, marked in the
            // survey comments as "Start Steamflood Tang" / "End Steamflood Tang".
            // Same fields and same arithmetic as the regular tangent above;
            // null when neither comment is present (card then shows nothing).
            const sfStart = wbtFindByComment(survey, ['START STEAMFLOOD TANG']);
            const sfEnd   = wbtFindByComment(survey, ['END STEAMFLOOD TANG']);
            let steamfloodTangent = null;
            if(sfStart || sfEnd){
                const sS = sfStart || sfEnd;
                const sE = sfEnd   || sfStart;
                steamfloodTangent = {
                    mdStart : num(sS.md),
                    mdEnd   : num(sE.md),
                    tvdStart: num(sS.tvd),
                    tvdEnd  : num(sE.tvd),
                    inclFirst: num(sS.incl),
                    inclLast : num(sE.incl),
                };
                steamfloodTangent.length = steamfloodTangent.mdEnd - steamfloodTangent.mdStart;
                steamfloodTangent.deltaTVDtoICP = num(icp.tvd) - steamfloodTangent.tvdEnd;
            }

            // Max DLS in build (KOP→ICP) and lateral (ICP→TD)
            // Steering meters: MD intervals where DLS > 0.1°/30m
            const STEER_DLS_THRESHOLD = 0.1;
            let maxDlsBuild = 0, maxDlsLateral = 0, tortuosity = 0;
            let steerMdBuild = 0, steerMdLateral = 0;
            for(let i = 1; i < survey.length; i++){
                const r    = survey[i];
                const prev = survey[i-1];
                const dls  = num(r.dogleg);
                const md   = num(r.md);
                const mdPrev = num(prev.md);
                const interval = md - mdPrev;
                tortuosity += dls;
                // Build section: MD=0 → icp.md
                if(md <= num(icp.md)){
                    if(dls > maxDlsBuild) maxDlsBuild = dls;
                    if(dls > STEER_DLS_THRESHOLD) steerMdBuild += interval;
                }
                // Lateral section: icp.md+30 → TD
                if(md >= num(icp.md) + 30){
                    if(dls > maxDlsLateral) maxDlsLateral = dls;
                    if(dls > STEER_DLS_THRESHOLD) steerMdLateral += interval;
                }
            }

            const totalMD  = num(last.md);
            const totalTVD = num(last.tvd);

            const dN = num(last.northing) - num(first.northing);
            const dE = num(last.easting)  - num(first.easting);
            const ahd = Math.sqrt(dN*dN + dE*dE);
            let closureAz = Math.atan2(dE, dN) * 180 / Math.PI;
            if(closureAz < 0) closureAz += 360;

            // DDI (Oag & Williams 2000)
            let ddi = null;
            if(totalTVD > 0 && ahd > 0 && tortuosity > 0 && totalMD > 0){
                ddi = Math.log10((totalMD * ahd * tortuosity) / totalTVD);
            }

            // Steer Index (same formula as uploadDPI.ejs)
            let steerIndex = null;
            const effort = wbtComputeSteerEffort(survey);
            if(isFinite(effort) && totalMD > 0) steerIndex = effort / totalMD;

            // Time to drill the Build Section (SurfaceCasing → IntermediateCasing)
            // and the Lateral Section (IntermediateCasing → TD), using the same
            // distance/ROP relationship as the Calculated Time vs Depth curve —
            // hours = distance(m) / ROP(m/h) — with ROP averaged over each
            // range from the ROP vs Measured Depth "Average" curve. Matches
            // the chart's convention exactly by also including the same
            // milestone pauses the chart adds: the pause after SurfaceCasing
            // (before IC drilling starts) is counted in Build, and the pause
            // after IntermediateCasing (before lateral drilling starts) is
            // counted in Lateral. Returns null (shown as "—") if
            // SurfaceCasing/IntermediateCasing weren't detected, or if no
            // ROP data covers that MD range.
            // 2026-11-21 (John): auto time model (window.MTX_TM — on-bottom + other in-hole time + casing stops from the offsets'
            // EDR); was drilling time from one ROP + manual pauses (0.15 d / 1.0 d). Build = SC→IC + stop at SC; Lateral = IC→TD + stop at IC.
            let buildTimeDays = null, lateralTimeDays = null;
            if(sc && ic){
                const d = window.MTX_TM.sectionDays(num(sc.md), num(ic.md), 'Build');
                if(d != null) buildTimeDays = Math.round((d + window.MTX_TM.stopH(num(sc.md), 'SC').h / 24) * 100) / 100;
            }
            if(ic){
                const d = window.MTX_TM.sectionDays(num(ic.md), num(last.md), 'Lateral');
                if(d != null) lateralTimeDays = Math.round((d + window.MTX_TM.stopH(num(ic.md), 'IC').h / 24) * 100) / 100;
            }

            return {
                wellName,
                sc      : sc ? {md: num(sc.md), tvd: num(sc.tvd)} : null,
                surfaceKickoff,
                kopMD   : num(kop.md),
                icpMD   : num(icp.md),
                icpTVD  : num(icp.tvd),
                icpSource,
                icRaw   : ic ? {md: num(ic.md), tvd: num(ic.tvd)} : null,
                lpRaw   : lp ? {md: num(lp.md), tvd: num(lp.tvd)} : null,
                totalMD, totalTVD,
                lateralLength,
                buildTimeDays,
                lateralTimeDays,
                lateralDisplacement: ahd,
                closureAz,
                maxDlsBuild, maxDlsLateral,
                steerMdBuild   : Math.round(steerMdBuild * 10) / 10,
                steerMdLateral : Math.round(steerMdLateral * 10) / 10,
                steerPctBuild  : num(icp.md) > 0 ? Math.round(steerMdBuild / num(icp.md) * 1000) / 10 : null,
                steerPctLateral: lateralLength > 0 ? Math.round(steerMdLateral / lateralLength * 1000) / 10 : null,
                finalIncl: num(last.incl),
                finalAzim: num(last.azim),
                tangent,
                steamfloodTangent,
                ddi,
                steerIndex,
            };
        }

        function wbtFmt(v, d){ return (v === null || v === undefined || isNaN(v)) ? '-' : v.toFixed(d !== undefined ? d : 1); }

        // Exposed for the Torque & Drag "Wellbore Geometry & BHA" schematic
        // (see renderTDSchematic below): gives the same SC / ICP(LP) / TD
        // measured depths shown on this well's score card, computed from
        // the trajectory survey's own comment markers, so the T&D widget's
        // casing schema can auto-sync to the well actually selected instead
        // of reusing whatever depths were last in play for a different well.
        window.mtxGetWellKeyDepths = function(wellName){
            var w = WELLBORES.find(function(x){ return x.wellName === wellName; });
            if(!w || !w.survey || !w.survey.length) return null;
            var m = wbtComputeMetrics(w.wellName, w.survey);
            if(!m) return null;
            return {
                scMD:  m.sc ? m.sc.md : null,
                icpMD: (m.icpMD !== null && m.icpMD !== undefined && !isNaN(m.icpMD)) ? m.icpMD : null,
                tdMD:  (m.totalMD !== null && m.totalMD !== undefined && !isNaN(m.totalMD)) ? m.totalMD : null
            };
        };

        window.wbtRenderDashboard = function(w, o){ return wbtRenderDashboard(w, o); };   // 2026-11-01: used by iPad preview score cards
        // Stored after each wbtRenderDashboard call for Excel export
        let wbtLastDashboardMetrics = [];

        // CHANGED 2026-11-01 (John): optional opts so the iPad module can reuse these cards for its preview
        // wells ("work in progress"): {containerId, summaryId, exportBtnId, noSave (no padStats PATCH, no
        // overwrite of the official export data), wip (badge on each card), extraRows(wellName) -> [[label, value]]}.
        // Called without opts it behaves exactly as before.
        function wbtRenderDashboard(wellsForDashboard, opts){
            opts = opts || {};
            const container = document.getElementById(opts.containerId || 'wbtDashboard');
            if(!container) return;
            container.innerHTML = '';

            // Compute pad averages for Steer Index and DDI
            const validMetrics = wellsForDashboard.map(w => wbtComputeMetrics(w.name, w.survey)).filter(Boolean);
            const padAvgSteer = validMetrics.filter(m => m.steerIndex !== null).reduce((s,m,_,a) => s + m.steerIndex/a.length, 0) || null;
            const padAvgDDI   = validMetrics.filter(m => m.ddi   !== null).reduce((s,m,_,a) => s + m.ddi/a.length, 0)   || null;

            // Store for Excel export and wire button
            const metricsForExport = validMetrics.map((m, idx) => ({
                ...m, color: (wellsForDashboard[idx] || {}).color || 0
            }));
            if(!opts.noSave) wbtLastDashboardMetrics = metricsForExport;
            const dashExportBtn = document.getElementById(opts.exportBtnId || 'wbtExportDashboard');
            if(dashExportBtn){
                dashExportBtn.onclick = () => wbtExportDashboardExcel(metricsForExport);
            }

            // Auto-save pad summary stats to the note in MongoDB (official cards only)
            // CHANGED 2026-11-28 (John): saved ONLY when the numbers differ from what the job already has (window.MTX_JOB.padStats,
            // written by job.ejs; updated here after a save). Was: a PATCH on every page view (~0.3-0.75 s request, a DB write each time).
            const padStatsNow = {
                trajWells:         validMetrics.length,
                trajAvgDDI:        padAvgDDI        !== null ? parseFloat(padAvgDDI.toFixed(2))        : null,
                trajAvgSteerIndex: padAvgSteer      !== null ? parseFloat(padAvgSteer.toFixed(3))      : null,
            };
            const padStatsSaved = (window.MTX_JOB && window.MTX_JOB.padStats) || null;
            const padStatsSame = !!padStatsSaved && ['trajWells', 'trajAvgDDI', 'trajAvgSteerIndex'].every(k =>
                (padStatsSaved[k] == null ? null : Number(padStatsSaved[k])) === padStatsNow[k]);
            if(!opts.noSave && !padStatsSame) fetch('/notes/padStats/' + window.MTX_JOB.noteId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(padStatsNow)
            }).then(r => { if(r.ok && window.MTX_JOB) window.MTX_JOB.padStats = Object.assign({}, padStatsNow); })
              .catch(err => console.warn('padStats save failed:', err));

            // Pad summary bar
            const summary = document.getElementById(opts.summaryId || 'wbtPadSummary');
            if(summary){
                summary.innerHTML = '';
                function padStat(lbl, val){
                    summary.innerHTML += `<div class="wbt-pad-stat"><div class="wbt-pad-stat-label">${lbl}</div><div class="wbt-pad-stat-value">${val}</div></div>`;
                }
                padStat('Wells', validMetrics.length);
                padStat('Avg DDI', wbtFmt(padAvgDDI, 2));
                padStat('Avg Steer Index', wbtFmt(padAvgSteer, 2));
            }

            wellsForDashboard.forEach(w => {
                const metrics = wbtComputeMetrics(w.name, w.survey);
                if(!metrics) return;

                const card = document.createElement('div');
                card.className = 'wbt-dash-card';

                // Card header
                const title = document.createElement('div');
                title.className = 'wbt-dash-card-title';
                const sw = document.createElement('span');
                sw.className = 'wbt-swatch';
                sw.style.background = '#' + w.color.toString(16).padStart(6,'0');
                title.appendChild(sw);
                title.appendChild(document.createTextNode(metrics.wellName));
                if(opts.wip){ const b = document.createElement('span'); b.textContent = 'WORK IN PROGRESS'; b.title = 'iPad preview design — not an official / drilled trajectory';
                    b.style.cssText = 'margin-left:auto;font-size:9px;padding:1px 6px;border:1px dashed #ffd060;color:#ffd060;border-radius:3px;'; title.style.display = 'flex'; title.style.alignItems = 'center'; title.appendChild(b); }
                card.appendChild(title);

                // Highlighted key points: SC / ICP / LP / TD. ICP
                // (IntermediateCasing comment) and LP (Landing comment) are
                // shown as separate, independent boxes — they are NOT
                // necessarily the same survey point, and conflating them
                // into one "ICP/LP" box (showing only whichever is deeper)
                // was confusing when a well has both comments at different
                // depths. Lateral length still uses whichever is deeper
                // (unchanged), marked "used for lateral" on that one box.
                const highlights = document.createElement('div');
                highlights.className = 'wbt-highlight-row';
                function addHL(lbl, mdVal, tvdVal, found, active){
                    highlights.innerHTML += `
                        <div class="wbt-highlight-box wbt-hl-${lbl.toLowerCase().split(' ')[0]}">
                            <div class="wbt-highlight-label">${lbl}${active ? ' ★' : ''}</div>
                            <div class="wbt-highlight-value">${mdVal !== null && mdVal !== undefined ? wbtFmt(mdVal) + ' m' : '—'}</div>
                            <div class="wbt-highlight-extra">${found !== false ? 'TVD ' + (tvdVal !== null ? wbtFmt(tvdVal) + ' m' : '—') : 'Not found'}</div>
                        </div>`;
                }
                const icpIsIC = metrics.icpSource === 'IntermediateCasing (comment)';
                const icpIsLP = metrics.icpSource === 'Landing (comment)';
                addHL('SC',  metrics.sc ? metrics.sc.md : null, metrics.sc ? metrics.sc.tvd : null, !!metrics.sc);
                addHL('ICP', metrics.icRaw ? metrics.icRaw.md : null, metrics.icRaw ? metrics.icRaw.tvd : null, !!metrics.icRaw, icpIsIC);
                addHL('LP',  metrics.lpRaw ? metrics.lpRaw.md : null, metrics.lpRaw ? metrics.lpRaw.tvd : null, !!metrics.lpRaw, icpIsLP);
                addHL('TD',  metrics.totalMD, metrics.totalTVD, true);
                card.appendChild(highlights);

                // Metric grid
                const grid = document.createElement('div');
                grid.className = 'wbt-metric-grid';
                function m(lbl, val, full){
                    const l = document.createElement('div');
                    l.className = 'wbt-metric-label' + (full ? ' wbt-metric-full' : '');
                    l.textContent = lbl;
                    const v = document.createElement('div');
                    v.className = 'wbt-metric-value' + (full ? ' wbt-metric-full' : '');
                    v.textContent = val;
                    grid.appendChild(l); grid.appendChild(v);
                    return [l, v]; // 2026-10-09: returned so a row can be highlighted
                }
                // ADDED 2026-10-09: highlight a tangent's "Incl" row — green when
                // start and end inclination are the same, red when they differ
                // (black text either way). Compared at the 0.1° shown on the card,
                // so what the user reads matches the colour.
                function tangInclHighlight(cells, incl1, incl2){
                    if(!cells || !isFinite(incl1) || !isFinite(incl2)) return;
                    const same = wbtFmt(incl1, 1) === wbtFmt(incl2, 1);
                    cells.forEach(c => {
                        c.style.setProperty('background-color', same ? '#4caf50' : '#ff4c4c', 'important');
                        c.style.setProperty('color', '#000000', 'important');
                    });
                }

                // ADDED 2026-10-09: dogleg > 0 between surface and SurfaceCasing
                m('Surface KickOff', metrics.surfaceKickoff === null ? '— (no SurfaceCasing)' : (metrics.surfaceKickoff ? 'Yes' : 'No'));
                m('KOP (MD)', wbtFmt(metrics.kopMD) + ' m');
                m('Landing basis', metrics.icpSource);

                if(metrics.tangent){
                    m('Tangent MD', wbtFmt(metrics.tangent.mdStart) + ' – ' + wbtFmt(metrics.tangent.mdEnd) + ' m');
                    m('Tangent Length', wbtFmt(metrics.tangent.length) + ' m');
                    tangInclHighlight(
                        m('Tangent Incl', wbtFmt(metrics.tangent.inclFirst,1) + ' – ' + wbtFmt(metrics.tangent.inclLast,1) + '°'),
                        metrics.tangent.inclFirst, metrics.tangent.inclLast);
                    m('ΔTvD End Tang→ICP', wbtFmt(metrics.tangent.deltaTVDtoICP,2) + ' m');
                } else {
                    m('Tangent Section', 'NO', true);
                }

                // ADDED 2026-10-09: Steamflood (pump) tangent — only shown when present.
                if(metrics.steamfloodTangent){
                    const sf = metrics.steamfloodTangent;
                    m('Steamflood Tang MD', wbtFmt(sf.mdStart) + ' – ' + wbtFmt(sf.mdEnd) + ' m');
                    m('Steamflood Tang Length', wbtFmt(sf.length) + ' m');
                    tangInclHighlight(
                        m('Steamflood Tang Incl', wbtFmt(sf.inclFirst,1) + ' – ' + wbtFmt(sf.inclLast,1) + '°'),
                        sf.inclFirst, sf.inclLast);
                    m('ΔTvD End SF Tang→ICP', wbtFmt(sf.deltaTVDtoICP,2) + ' m');
                }

                m('Lateral Length', wbtFmt(metrics.lateralLength) + ' m');
                m('Lateral Displacement', wbtFmt(metrics.lateralDisplacement) + ' m');
                m('Max DLS – Build',   wbtFmt(metrics.maxDlsBuild, 2));
                m('Max DLS – Lateral', wbtFmt(metrics.maxDlsLateral, 2));
                m('Steering – Build',   wbtFmt(metrics.steerMdBuild, 1) + ' m  (' + (metrics.steerPctBuild !== null ? metrics.steerPctBuild.toFixed(1) : '-') + '%)');
                m('Steering – Lateral', wbtFmt(metrics.steerMdLateral, 1) + ' m  (' + (metrics.steerPctLateral !== null ? metrics.steerPctLateral.toFixed(1) : '-') + '%)');
                m('Time – Build (SC→IC)',       metrics.buildTimeDays   !== null ? metrics.buildTimeDays.toFixed(2)   + ' days' : '—');
                m('Time – Lateral (IC→TD)',     metrics.lateralTimeDays !== null ? metrics.lateralTimeDays.toFixed(2) + ' days' : '—');
                m('Total Time (Build + Lateral)', (metrics.buildTimeDays !== null && metrics.lateralTimeDays !== null) ? (Math.round((metrics.buildTimeDays + metrics.lateralTimeDays) * 100) / 100).toFixed(2) + ' days' : '—');
                m('Closure Azimuth', wbtFmt(metrics.closureAz, 1) + '°');
                m('Final Incl / Azim', wbtFmt(metrics.finalIncl,1) + '° / ' + wbtFmt(metrics.finalAzim,1) + '°');
                m('DDI (Oag & Williams)', wbtFmt(metrics.ddi, 2));
                m('Steer Index', wbtFmt(metrics.steerIndex, 3));
                if(opts.extraRows) (opts.extraRows(w.name) || []).forEach(x => { const c = m(x[0], x[1]); if(x[2]) c.forEach(el => { el.style.setProperty('background-color', x[2], 'important'); el.style.setProperty('color', '#000000', 'important'); }); });

                card.appendChild(grid);
                container.appendChild(card);
            });

            // ── Limit to 4 cards by default, show toggle if more ────────
            const MAX_CARDS = 4;
            const allCards = Array.from(container.querySelectorAll('.wbt-dash-card'));
            if(allCards.length > MAX_CARDS){
                allCards.slice(MAX_CARDS).forEach(function(card){ card.style.display = 'none'; });
                var existingBtn = container.parentElement.querySelector('.wbt-show-all-btn');
                if(existingBtn) existingBtn.remove();
                var toggleBtn = document.createElement('button');
                toggleBtn.className = 'btn btn-sm btn-outline-info mt-2 wbt-show-all-btn';
                var totalCards = allCards.length;
                toggleBtn.textContent = 'Show all ' + totalCards + ' score cards';
                var expanded = false;
                toggleBtn.addEventListener('click', function(){
                    expanded = !expanded;
                    allCards.slice(MAX_CARDS).forEach(function(card){ card.style.display = expanded ? '' : 'none'; });
                    toggleBtn.textContent = expanded
                        ? 'Show first ' + MAX_CARDS + ' score cards'
                        : 'Show all ' + totalCards + ' score cards';
                });
                container.parentElement.insertBefore(toggleBtn, container.nextSibling);
            }

        }

        // ---------------- Accordion toggle ----------------
        // ── Dashboard Excel Export ──
        // One tab per wellbore, each containing all computed metrics as a
        // vertical key→value table (metric name in col A, value in col B).
        function wbtExportDashboardExcel(metrics){
            if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
            if(!metrics || metrics.length === 0){ alert('No dashboard data to export.'); return; }

            const wb = XLSX.utils.book_new();

            metrics.forEach(m => {
                const rows = [
                    ['Metric', 'Value'],
                    ['Well Name', m.wellName || ''],
                    [''],
                    ['── KEY POINTS ──', ''],
                    ['SC (MD)',              m.sc ? m.sc.md : 'Not found'],
                    ['SC (TVD)',             m.sc ? m.sc.tvd : 'Not found'],
                    ['Surface KickOff',      m.surfaceKickoff === null ? '—' : (m.surfaceKickoff ? 'Yes' : 'No')], // 2026-10-09
                    ['KOP (MD)',             m.kopMD],
                    ['ICP — IntermediateCasing (MD)',  m.icRaw ? m.icRaw.md : 'Not found'],
                    ['ICP — IntermediateCasing (TVD)', m.icRaw ? m.icRaw.tvd : 'Not found'],
                    ['LP — Landing (MD)',              m.lpRaw ? m.lpRaw.md : 'Not found'],
                    ['LP — Landing (TVD)',             m.lpRaw ? m.lpRaw.tvd : 'Not found'],
                    ['ICP / Landing used for lateral (MD)',   m.icpMD],
                    ['ICP / Landing used for lateral (TVD)',  m.icpTVD],
                    ['ICP Source',           m.icpSource],
                    ['Landing basis', m.icpSource || ''],
                    ['TD (Total MD)', m.totalMD],
                    ['TD (Total TVD)', m.totalTVD],
                    [''],
                    ['── TRAJECTORY ──', ''],
                    ['Lateral Length (m)', m.lateralLength],
                    ['Lateral Displacement (m)', m.lateralDisplacement],
                    ['Closure Azimuth (deg)', m.closureAz],
                    ['Final Inclination (deg)', m.finalIncl],
                    ['Final Azimuth (deg)', m.finalAzim],
                    [''],
                    ['── DLS ──', ''],
                    ['Max DLS - Build', m.maxDlsBuild],
                    ['Max DLS - Lateral', m.maxDlsLateral],
                    ['Steering Build (m)', m.steerMdBuild],
                    ['Steering Build (%)', m.steerPctBuild],
                    ['Steering Lateral (m)', m.steerMdLateral],
                    ['Steering Lateral (%)', m.steerPctLateral],
                    ['Time - Build SC to IC (days)', m.buildTimeDays],
                    ['Time - Lateral IC to TD (days)', m.lateralTimeDays],
                    ['Total Time - Build + Lateral (days)', (m.buildTimeDays !== null && m.lateralTimeDays !== null) ? Math.round((m.buildTimeDays + m.lateralTimeDays) * 100) / 100 : null],
                    [''],
                    ['── TANGENT ──', ''],
                    ['Tangent MD Start (m)', m.tangent ? m.tangent.mdStart : 'NO'],
                    ['Tangent MD End (m)', m.tangent ? m.tangent.mdEnd : 'NO'],
                    ['Tangent Length (m)', m.tangent ? m.tangent.length : 'NO'],
                    ['Tangent Incl Start (deg)', m.tangent ? m.tangent.inclFirst : 'NO'],
                    ['Tangent Incl End (deg)', m.tangent ? m.tangent.inclLast : 'NO'],
                    ['ΔTvD End Tang → ICP (m)', m.tangent ? m.tangent.deltaTVDtoICP : 'NO'],
                    // ADDED 2026-10-09: Steamflood (pump) tangent
                    ['Steamflood Tang MD Start (m)', m.steamfloodTangent ? m.steamfloodTangent.mdStart : 'NO'],
                    ['Steamflood Tang MD End (m)', m.steamfloodTangent ? m.steamfloodTangent.mdEnd : 'NO'],
                    ['Steamflood Tang Length (m)', m.steamfloodTangent ? m.steamfloodTangent.length : 'NO'],
                    ['Steamflood Tang Incl Start (deg)', m.steamfloodTangent ? m.steamfloodTangent.inclFirst : 'NO'],
                    ['Steamflood Tang Incl End (deg)', m.steamfloodTangent ? m.steamfloodTangent.inclLast : 'NO'],
                    ['ΔTvD End SF Tang → ICP (m)', m.steamfloodTangent ? m.steamfloodTangent.deltaTVDtoICP : 'NO'],
                    [''],
                    ['── DIFFICULTY INDICES ──', ''],
                    ['DDI (Oag & Williams)', m.ddi !== null ? m.ddi : '-'],
                    ['Steer Index', m.steerIndex !== null ? m.steerIndex : '-'],
                ];

                const ws = XLSX.utils.aoa_to_sheet(rows);

                // Column widths
                ws['!cols'] = [{wch: 30}, {wch: 22}];

                // Sanitize sheet name (max 31 chars, no invalid chars)
                let sheetName = (m.wellName || 'Well').replace(/[\\\/\?\*\[\]:]/g, '-').substring(0, 31) || 'Well';
                let finalName = sheetName;
                let counter = 1;
                while(wb.SheetNames.includes(finalName)){
                    finalName = sheetName.substring(0, 28) + '_' + counter++;
                }

                XLSX.utils.book_append_sheet(wb, ws, finalName);
            });

            // Also add a summary sheet with all wells side by side
            const summaryRows = [
                ['Metric', ...metrics.map(m => m.wellName || 'Well')],
                ['SC MD', ...metrics.map(m => m.sc ? m.sc.md : '')],
                ['SC TVD', ...metrics.map(m => m.sc ? m.sc.tvd : '')],
                ['Surface KickOff', ...metrics.map(m => m.surfaceKickoff === null ? '—' : (m.surfaceKickoff ? 'Yes' : 'No'))], // 2026-10-09
                ['KOP MD', ...metrics.map(m => m.kopMD)],
                ['ICP (IntermediateCasing) MD', ...metrics.map(m => m.icRaw ? m.icRaw.md : '')],
                ['ICP (IntermediateCasing) TVD', ...metrics.map(m => m.icRaw ? m.icRaw.tvd : '')],
                ['LP (Landing) MD', ...metrics.map(m => m.lpRaw ? m.lpRaw.md : '')],
                ['LP (Landing) TVD', ...metrics.map(m => m.lpRaw ? m.lpRaw.tvd : '')],
                ['ICP/Landing used for lateral MD', ...metrics.map(m => m.icpMD)],
                ['ICP/Landing used for lateral TVD', ...metrics.map(m => m.icpTVD)],
                ['Landing basis', ...metrics.map(m => m.icpSource || '')],
                ['Total MD', ...metrics.map(m => m.totalMD)],
                ['Total TVD', ...metrics.map(m => m.totalTVD)],
                ['Lateral Length (m)', ...metrics.map(m => m.lateralLength)],
                ['Lateral Displacement (m)', ...metrics.map(m => m.lateralDisplacement)],
                ['Closure Azimuth (deg)', ...metrics.map(m => m.closureAz)],
                ['Final Incl (deg)', ...metrics.map(m => m.finalIncl)],
                ['Final Azim (deg)', ...metrics.map(m => m.finalAzim)],
                ['Max DLS - Build', ...metrics.map(m => m.maxDlsBuild)],
                ['Max DLS - Lateral', ...metrics.map(m => m.maxDlsLateral)],
                ['Tangent MD Start (m)', ...metrics.map(m => m.tangent ? m.tangent.mdStart : 'NO')],
                ['Tangent MD End (m)', ...metrics.map(m => m.tangent ? m.tangent.mdEnd : 'NO')],
                ['Tangent Length (m)', ...metrics.map(m => m.tangent ? m.tangent.length : 'NO')],
                ['ΔTvD End Tang → ICP (m)', ...metrics.map(m => m.tangent ? m.tangent.deltaTVDtoICP : 'NO')],
                // ADDED 2026-10-09: Steamflood (pump) tangent
                ['Steamflood Tang MD Start (m)', ...metrics.map(m => m.steamfloodTangent ? m.steamfloodTangent.mdStart : 'NO')],
                ['Steamflood Tang MD End (m)', ...metrics.map(m => m.steamfloodTangent ? m.steamfloodTangent.mdEnd : 'NO')],
                ['Steamflood Tang Length (m)', ...metrics.map(m => m.steamfloodTangent ? m.steamfloodTangent.length : 'NO')],
                ['ΔTvD End SF Tang → ICP (m)', ...metrics.map(m => m.steamfloodTangent ? m.steamfloodTangent.deltaTVDtoICP : 'NO')],
                ['DDI (Oag & Williams)', ...metrics.map(m => m.ddi !== null ? m.ddi : '')],
                ['Steer Index', ...metrics.map(m => m.steerIndex !== null ? m.steerIndex : '')],
            ];
            const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
            wsSummary['!cols'] = [{wch:28}, ...metrics.map(() => ({wch:20}))];
            XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

            const padLabel = (WELLBORES[0] && WELLBORES[0].pad) ? WELLBORES[0].pad.replace(/[^a-z0-9\-_ ]/gi,'_') : 'Pad';
            XLSX.writeFile(wb, padLabel + '_Dashboard.xlsx');
        }

        function wbtSetupAccordion(){
            [['wbtAccordionHeader','wbtTablesOuter'], ['wbtScoreCardsHeader','wbtScoreCardsBody']].forEach(function(pair){
                const header = document.getElementById(pair[0]);
                const body   = document.getElementById(pair[1]);
                if(!header || !body || header.dataset.wired) return;
                header.dataset.wired = '1';
                header.addEventListener('click', () => {
                    header.classList.toggle('collapsed');
                    body.classList.toggle('collapsed');
                });
            });
        }

        // Per-well Steer Index row rendered at top of each table (inside accordion)
        function wbtRenderSteerRow(container, wellName, survey, color){
            const effort = wbtComputeSteerEffort(survey);
            const totalMD = survey.length ? num(survey[survey.length-1].md) : 0;
            const si = (isFinite(effort) && totalMD > 0) ? effort / totalMD : null;
            const siNorm = wbtNormalizeClamp(si, 0.5, 6.0);
            const hex = '#' + color.toString(16).padStart(6,'0');

            const bar = document.createElement('div');
            bar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:4px 10px;' +
                'background:var(--wbt-panel2);border-bottom:1px solid var(--wbt-border);' +
                'font-family:var(--wbt-mono);font-size:10px;color:var(--wbt-text-dim);';
            bar.innerHTML =
                `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${hex};flex-shrink:0"></span>` +
                `<span style="color:var(--wbt-text-bright);font-size:11px;font-family:var(--wbt-cond);letter-spacing:1px;text-transform:uppercase">${wellName}</span>` +
                `<span>Steer Index: <b style="color:var(--wbt-accent)">${si !== null ? si.toFixed(3) : '—'}</b></span>` +
                `<span>Norm: <b style="color:var(--wbt-accent2)">${siNorm !== null ? siNorm.toFixed(3) : '—'}</b></span>`;
            container.insertBefore(bar, container.firstChild);
        }

        // ---------------- Excel export ----------------
        const wbtExcelCols = [
            {key:'well', label:'Well'},
            {key:'md', label:'MD'},
            {key:'incl', label:'Incl'},
            {key:'azim', label:'Azim'},
            {key:'tvd', label:'TVD'},
            {key:'subSea', label:'Sub-Sea'},
            {key:'vertSec', label:'Vert. Sec.'},
            {key:'localN', label:'Local N'},
            {key:'localE', label:'Local E'},
            {key:'dogleg', label:'Dogleg'},
            {key:'northing', label:'Northings'},
            {key:'easting', label:'Eastings'},
            {key:'latitude', label:'Latitude'},
            {key:'longitude', label:'Longitude'},
            {key:'comments', label:'Comments'},
        ];

        function wbtExportToExcel(wellsForExport, padLabel){
            if(typeof XLSX === 'undefined'){ alert('Excel library not loaded.'); return; }
            const wb = XLSX.utils.book_new();
            wellsForExport.forEach(w => {
                const sheetData = [
                    wbtExcelCols.map(c => c.label),
                    ...(w.survey || []).map(r => wbtExcelCols.map(c => {
                        const v = r[c.key];
                        return (v !== undefined && v !== null) ? v : '';
                    }))
                ];
                const ws = XLSX.utils.aoa_to_sheet(sheetData);
                let name = (w.name || 'Well').replace(/[\\\/\?\*\[\]:]/g,'-').substring(0,31) || 'Well';
                let final = name, n = 1;
                while(wb.SheetNames.includes(final)) final = name.substring(0,28) + '_' + n++;
                XLSX.utils.book_append_sheet(wb, ws, final);
            });
            const fname = (padLabel||'Pad').replace(/[^a-z0-9\-_ ]/gi,'_') + '_Trajectories.xlsx';
            XLSX.writeFile(wb, fname);
        }




        // ================================================================
        // FRACPLANE CONTROLLER v2 — Box + Cylinder geometries
        // ================================================================
        // Position interpolation: linear interpolation of Northing/Easting/TVD
        // between bracketing survey stations (option a, as agreed).
        //
        // Cylinder axis: the wellbore tangent unit vector at the given MD,
        // computed from interpolated incl/azim using standard direction cosines
        // (SPE/ISCWSA convention). User Roll/Pitch/Yaw offsets are applied on
        // top of this default axis via THREE.Euler.
        //
        // Three.js CylinderGeometry default axis is Y.
        // We compute the quaternion that rotates Y → wellboreTangent,
        // then apply the user's Roll/Pitch/Yaw offsets on top.

        let wbtFPActiveTrajId  = null;
        let wbtFPActiveFPId    = null;
        let wbtFPMeshes        = {};   // { trajectoryId: [THREE.Object3D, ...] }

        // ── Geometry-type toggle ──
        function wbtFPOnGeomChange(){
            const geom = document.getElementById('wbtFPGeometry').value;
            document.getElementById('wbtFPBoxInputs').style.display = geom === 'box'      ? '' : 'none';
            document.getElementById('wbtFPCylInputs').style.display = geom === 'cylinder' ? '' : 'none';
        }

        // ── Accordion toggle ──
        function wbtFPSetupAccordion(){
            const hdr = document.getElementById('wbtFPAccHeader');
            const bdy = document.getElementById('wbtFPAccBody');
            if(!hdr || !bdy) return;
            hdr.addEventListener('click', () => {
                hdr.classList.toggle('collapsed');
                bdy.classList.toggle('collapsed');
            });
        }

        // ── Client-side interpolation (mirrors server logic) ──
        function wbtInterpolateAtMD(survey, targetMD){
            const D2R = Math.PI / 180;
            if(!survey || survey.length === 0) return { center:{x:0,y:0,z:0}, tangent:{x:0,y:-1,z:0} };

            function toResult(s){
                const incl = num(s.incl||0)*D2R, azim = num(s.azim||0)*D2R;
                return {
                    center: { x: num(s.easting), y: wbtYOf(s), z: -num(s.northing) },   // 2026-10-21: Sub-Sea (was -tvd)
                    tangent: {
                        x:  Math.sin(incl)*Math.sin(azim),
                        y: -Math.cos(incl),
                        z: -Math.sin(incl)*Math.cos(azim),
                    },
                };
            }

            const n = num(targetMD);
            if(n <= num(survey[0].md)) return toResult(survey[0]);
            const last = survey[survey.length-1];
            if(n >= num(last.md)) return toResult(last);

            for(let i = 1; i < survey.length; i++){
                const s0 = survey[i-1], s1 = survey[i];
                const md0 = num(s0.md), md1 = num(s1.md);
                if(n >= md0 && n <= md1){
                    const t = (md1-md0) === 0 ? 0 : (n-md0)/(md1-md0);
                    const east  = num(s0.easting)  + t*(num(s1.easting)  - num(s0.easting));
                    const yEl   = wbtYOf(s0)       + t*(wbtYOf(s1)       - wbtYOf(s0));   // 2026-10-21: Sub-Sea
                    const north = num(s0.northing) + t*(num(s1.northing) - num(s0.northing));
                    const incl  = (num(s0.incl||0) + t*(num(s1.incl||0)-num(s0.incl||0)))*D2R;
                    const azim  = (num(s0.azim||0) + t*(num(s1.azim||0)-num(s0.azim||0)))*D2R;
                    return {
                        center: { x: east, y: yEl, z: -north },
                        tangent: {
                            x:  Math.sin(incl)*Math.sin(azim),
                            y: -Math.cos(incl),
                            z: -Math.sin(incl)*Math.cos(azim),
                        },
                    };
                }
            }
            return toResult(last);
        }

        // ── 3D mesh builders ──

        // Box: wireframe EdgesGeometry, center at fp.center, half-dims dx/dy/dz
        function wbtBuildBoxMesh(fp, color){
            const geo   = new THREE.BoxGeometry(fp.dx*2, fp.dy*2, fp.dz*2);
            const edges = new THREE.EdgesGeometry(geo);
            const mat   = new THREE.LineBasicMaterial({ color: color || 0xffd060 });
            const mesh  = new THREE.LineSegments(edges, mat);
            mesh.position.set(fp.center.x, fp.center.y, fp.center.z);
            const D2R = Math.PI/180;
            mesh.rotation.set((fp.ax||0)*D2R, (fp.ay||0)*D2R, (fp.az||0)*D2R, 'XYZ');
            return mesh;
        }

        // Cylinder: wireframe, axis aligned to wellbore tangent + user offsets.
        // THREE.CylinderGeometry's natural axis is Y.
        // We:
        //  1. Compute quaternion Q that rotates Y → tangent vector
        //  2. Apply user Roll/Pitch/Yaw as an additional Euler on top
        // The cylinder extends distance/2 each side of center (MD point is center).
        function wbtBuildCylinderMesh(fp, color){
            const radius   = fp.radius   || 10;
            const distance = fp.distance || 30;

            const geo   = new THREE.CylinderGeometry(radius, radius, distance, 16, 1, true);
            const edges = new THREE.EdgesGeometry(geo);
            const mat   = new THREE.LineBasicMaterial({ color: color || 0xffd060 });
            const mesh  = new THREE.LineSegments(edges, mat);

            mesh.position.set(fp.center.x, fp.center.y, fp.center.z);

            // Step 1: rotate default Y-axis to wellbore tangent
            const tang = fp.tangent || {x:0, y:-1, z:0};
            const tangVec = new THREE.Vector3(tang.x, tang.y, tang.z).normalize();
            const yAxis   = new THREE.Vector3(0, 1, 0);
            const qTang   = new THREE.Quaternion().setFromUnitVectors(yAxis, tangVec);
            mesh.quaternion.copy(qTang);

            // Step 2: apply user Roll/Pitch/Yaw offsets on top
            const D2R = Math.PI/180;
            const qOffset = new THREE.Quaternion().setFromEuler(
                new THREE.Euler((fp.ax||0)*D2R, (fp.ay||0)*D2R, (fp.az||0)*D2R, 'XYZ')
            );
            mesh.quaternion.multiply(qOffset);

            return mesh;
        }

        function wbtClearFPMeshes(trajectoryId){
            if(!wbtFPMeshes[trajectoryId]) return;
            wbtFPMeshes[trajectoryId].forEach(m => group.remove(m));
            wbtFPMeshes[trajectoryId] = [];
        }

        function wbtRenderFPMeshes(trajectoryId, fracPlanes, wellColor){
            wbtClearFPMeshes(trajectoryId);
            wbtFPMeshes[trajectoryId] = [];
            if(!fracPlanes || fracPlanes.length === 0) return;

            // 2026-10-21: recompute each centre from its MD with the Sub-Sea vertical
            // axis (the server-saved centre of older frac planes used -TVD).
            const fpWell = WELLBORES.find(w => String(w._id) === String(trajectoryId));
            const fpSurvey = fpWell ? (fpWell.survey || []).slice().sort((a, b) => num(a.md) - num(b.md)) : null;
            fracPlanes.forEach(fp => {
                if(fpSurvey && fpSurvey.length && fp.md != null) fp = Object.assign({}, fp, { center: wbtInterpolateAtMD(fpSurvey, fp.md).center });
                if(!fp.center) return;
                const mesh = (fp.geometry === 'cylinder')
                    ? wbtBuildCylinderMesh(fp, wellColor || 0xffd060)
                    : wbtBuildBoxMesh(fp, wellColor || 0xffd060);
                mesh.userData.fpId = String(fp._id);
                group.add(mesh);
                wbtFPMeshes[trajectoryId].push(mesh);
            });
        }

        // ── Form helpers ──
        function wbtFPReadForm(){
            const geom = document.getElementById('wbtFPGeometry').value;
            return {
                label:    document.getElementById('wbtFPLabel').value.trim(),
                geometry: geom,
                md:       Number(document.getElementById('wbtFPMD').value),
                dx:       Number(document.getElementById('wbtFPDX').value),
                dy:       Number(document.getElementById('wbtFPDY').value),
                dz:       Number(document.getElementById('wbtFPDZ').value),
                ax:       Number(geom==='box'      ? document.getElementById('wbtFPAX').value  : document.getElementById('wbtFPCAX').value),
                ay:       Number(geom==='box'      ? document.getElementById('wbtFPAY').value  : document.getElementById('wbtFPCAY').value),
                az:       Number(geom==='box'      ? document.getElementById('wbtFPAZ').value  : document.getElementById('wbtFPCAZ').value),
                radius:   Number(document.getElementById('wbtFPRadius').value),
                distance: Number(document.getElementById('wbtFPDist').value),
            };
        }

        function wbtFPFillForm(fp){
            document.getElementById('wbtFPLabel').value    = fp.label    || '';
            document.getElementById('wbtFPGeometry').value = fp.geometry || 'box';
            document.getElementById('wbtFPMD').value       = fp.md       || 0;
            document.getElementById('wbtFPDX').value       = fp.dx       || 10;
            document.getElementById('wbtFPDY').value       = fp.dy       || 10;
            document.getElementById('wbtFPDZ').value       = fp.dz       || 10;
            document.getElementById('wbtFPAX').value       = fp.ax       || 0;
            document.getElementById('wbtFPAY').value       = fp.ay       || 0;
            document.getElementById('wbtFPAZ').value       = fp.az       || 0;
            document.getElementById('wbtFPRadius').value   = fp.radius   || 10;
            document.getElementById('wbtFPDist').value     = fp.distance || 30;
            document.getElementById('wbtFPCAX').value      = fp.ax       || 0;
            document.getElementById('wbtFPCAY').value      = fp.ay       || 0;
            document.getElementById('wbtFPCAZ').value      = fp.az       || 0;
            wbtFPOnGeomChange();
        }

        function wbtFPClearForm(){
            document.getElementById('wbtFPLabel').value    = '';
            document.getElementById('wbtFPGeometry').value = 'box';
            document.getElementById('wbtFPMD').value       = 500;
            document.getElementById('wbtFPDX').value       = 10;
            document.getElementById('wbtFPDY').value       = 10;
            document.getElementById('wbtFPDZ').value       = 10;
            document.getElementById('wbtFPAX').value       = 0;
            document.getElementById('wbtFPAY').value       = 0;
            document.getElementById('wbtFPAZ').value       = 0;
            document.getElementById('wbtFPRadius').value   = 10;
            document.getElementById('wbtFPDist').value     = 30;
            document.getElementById('wbtFPCAX').value      = 0;
            document.getElementById('wbtFPCAY').value      = 0;
            document.getElementById('wbtFPCAZ').value      = 0;
            wbtFPOnGeomChange();
            wbtFPActiveFPId = null;
            document.getElementById('wbtFPUpdBtn').disabled = true;
            document.getElementById('wbtFPDelBtn').disabled = true;
            document.querySelectorAll('.wbt-fp-list-item').forEach(el => el.classList.remove('active'));
        }

        function wbtFPSetStatus(msg, ok){
            const el = document.getElementById('wbtFPStatus');
            if(!el) return;
            el.textContent = msg;
            el.style.color = ok === false ? 'var(--wbt-red)' : ok === true ? 'var(--wbt-accent3)' : 'var(--wbt-text-dim)';
        }

        // ── FracPlane list ──
        function wbtFPRebuildList(fracPlanes, trajectoryId, wellColor){
            const listEl = document.getElementById('wbtFPList');
            listEl.innerHTML = '';
            if(!fracPlanes || fracPlanes.length === 0){
                listEl.innerHTML = '<div style="font-family:var(--wbt-mono);font-size:10px;color:var(--wbt-text-dim);padding:4px 0">No frac planes defined for this wellbore.</div>';
                return;
            }
            fracPlanes.forEach(fp => {
                const geomTag = fp.geometry === 'cylinder' ? 'CYL' : 'BOX';
                const details = fp.geometry === 'cylinder'
                    ? `R:${fp.radius} L:${fp.distance}`
                    : `DX:${fp.dx} DY:${fp.dy} DZ:${fp.dz}`;
                const item = document.createElement('div');
                item.className = 'wbt-fp-list-item';
                item.dataset.fpid = String(fp._id);
                item.innerHTML =
                    `<span style="font-family:var(--wbt-mono);font-size:9px;color:#ffd060;border:1px solid #ffd06060;padding:1px 4px;border-radius:2px">${geomTag}</span>` +
                    `<span class="wbt-fp-lbl">${fp.label||'(no label)'} &nbsp;MD:${fp.md}m</span>` +
                    `<span class="wbt-fp-meta">${details} | R:${fp.ax} P:${fp.ay} Y:${fp.az}</span>`;
                item.addEventListener('click', () => {
                    document.querySelectorAll('.wbt-fp-list-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    wbtFPActiveFPId = String(fp._id);
                    wbtFPFillForm(fp);
                    document.getElementById('wbtFPUpdBtn').disabled = false;
                    document.getElementById('wbtFPDelBtn').disabled = false;
                });
                listEl.appendChild(item);
            });
        }

        // ── CRUD API calls ──
        async function wbtFPAdd(){
            if(!wbtFPActiveTrajId){ wbtFPSetStatus('Select a wellbore first.', false); return; }
            const body = wbtFPReadForm();
            wbtFPSetStatus('Adding...');
            try{
                const res = await fetch('/notes/fracPlane/' + wbtFPActiveTrajId, {
                    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
                });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtFPSetStatus('Frac plane added.', true);
                await wbtFPRefresh(wbtFPActiveTrajId);
                wbtFPClearForm();
            } catch(e){ wbtFPSetStatus('Error: ' + e.message, false); }
        }

        async function wbtFPUpdate(){
            if(!wbtFPActiveTrajId || !wbtFPActiveFPId){ wbtFPSetStatus('Select a frac plane to update.', false); return; }
            const body = wbtFPReadForm();
            wbtFPSetStatus('Updating...');
            try{
                const res = await fetch('/notes/fracPlane/' + wbtFPActiveTrajId + '/' + wbtFPActiveFPId, {
                    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
                });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtFPSetStatus('Frac plane updated.', true);
                await wbtFPRefresh(wbtFPActiveTrajId);
            } catch(e){ wbtFPSetStatus('Error: ' + e.message, false); }
        }

        async function wbtFPDelete(){
            if(!wbtFPActiveTrajId || !wbtFPActiveFPId){ wbtFPSetStatus('Select a frac plane to delete.', false); return; }
            if(!confirm('Delete this frac plane? This cannot be undone.')) return;
            wbtFPSetStatus('Deleting...');
            try{
                const res = await fetch('/notes/fracPlane/' + wbtFPActiveTrajId + '/' + wbtFPActiveFPId, { method:'DELETE' });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtFPSetStatus('Frac plane deleted.', true);
                wbtFPActiveFPId = null;
                document.getElementById('wbtFPUpdBtn').disabled = true;
                document.getElementById('wbtFPDelBtn').disabled = true;
                await wbtFPRefresh(wbtFPActiveTrajId);
                wbtFPClearForm();
            } catch(e){ wbtFPSetStatus('Error: ' + e.message, false); }
        }

        async function wbtFPRefresh(trajectoryId){
            try{
                const res = await fetch('/notes/wellboreTrajectory/list/' + WBT_NOTE_ID);
                const data = await res.json();
                if(!res.ok) return;
                const traj = (data.trajectories||[]).find(t => String(t._id) === String(trajectoryId));
                if(!traj) return;
                const wellColor = wbtGetColorForTraj(trajectoryId);
                wbtRenderFPMeshes(trajectoryId, traj.fracPlanes||[], wellColor);
                wbtFPRebuildList(traj.fracPlanes||[], trajectoryId, wellColor);
            } catch(e){ console.error('wbtFPRefresh', e); }
        }

        // ── Well selector ──
        function wbtFPPopulateWellSelector(trajList){
            const sel = document.getElementById('wbtFPWell');
            if(!sel) return;
            sel.innerHTML = '<option value="">— Select wellbore —</option>';
            trajList.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                sel.appendChild(opt);
            });
        }

        function wbtFPOnWellChange(trajList){
            const sel = document.getElementById('wbtFPWell');
            const id  = sel.value;
            if(!id){ wbtFPActiveTrajId = null; wbtFPClearForm(); document.getElementById('wbtFPList').innerHTML=''; return; }
            wbtFPActiveTrajId = id;
            wbtFPClearForm();
            const traj = trajList.find(t => t.id === id);
            if(traj){
                wbtRenderFPMeshes(id, traj.fracPlanes||[], traj.color);
                wbtFPRebuildList(traj.fracPlanes||[], id, traj.color);
            }
            wbtFPSetStatus('Wellbore selected. Enter parameters and click + ADD.');
        }

        function wbtFPSetupButtons(){
            document.getElementById('wbtFPAddBtn').addEventListener('click', wbtFPAdd);
            document.getElementById('wbtFPUpdBtn').addEventListener('click', wbtFPUpdate);
            document.getElementById('wbtFPDelBtn').addEventListener('click', wbtFPDelete);
            document.getElementById('wbtFPClearBtn').addEventListener('click', wbtFPClearForm);
            wbtFPSetupAccordion();
            wbtFPOnGeomChange(); // set initial visibility
        }


        // ── FracPlane glue (job.ejs) ──
        const WBT_NOTE_ID = window.MTX_JOB.noteId;
        // Added 2026-08-25: Single/Multi wellbore coloring mode, saved on
        // the job (Note.wbtColorMode) so every viewer sees the same choice.
        // The model defaults new/legacy jobs to 'single' server-side too.
        let WBT_COLOR_MODE = window.MTX_JOB.wbtColorMode;

        // Return numeric color for a trajectory by its _id
        function wbtGetColorForTraj(trajectoryId){
            const w = WELLBORES.find(b => String(b._id) === String(trajectoryId));
            if(!w) return 0xffd060;
            return w.colorHex ? parseInt(w.colorHex.replace('#',''), 16) : 0xffd060;
        }

        // Build trajList from WELLBORES for the FP selector
        function wbtFPInit(){
            const trajList = WELLBORES.map(b => ({
                id:         String(b._id),
                name:       b.wellName,
                color:      b.colorHex ? parseInt(b.colorHex.replace('#',''), 16) : 0xffd060,
                survey:     b.survey || [],
                fracPlanes: b.fracPlanes || [],
            }));
            // FIX 2026-09-13: render FIRST and unconditionally — this must run
            // for every role, since the edit-form elements referenced below
            // (wbtFPWell etc.) no longer exist in the DOM for roles without
            // edit permission (see the HTML comment above the Frac Planes
            // accordion). Previously this whole function crashed on the next
            // line's now-guarded document.getElementById(...).addEventListener
            // call for those roles, which silently aborted initScene() before
            // it ever reached wbtPolyInit() — so Polylines never rendered for
            // any role outside admin/leader/user either.
            trajList.forEach(t => {
                wbtRenderFPMeshes(t.id, t.fracPlanes, t.color);
            });
            wbtFPPopulateWellSelector(trajList); // no-ops if wbtFPWell doesn't exist (already guarded)
            const sel = document.getElementById('wbtFPWell');
            if(!sel) return; // no edit form for this role — read-only rendering above already ran
            sel.addEventListener('change', () => wbtFPOnWellChange(trajList));
            wbtFPSetupButtons();
        }

        // ================================================================
        // POLYLINES — closed map-view outlines extruded into solid volumes
        // ================================================================
        // Added 2026-08-25. A Polyline is a job-level feature (keyed by
        // noteId only, NOT tied to a wellbore): a closed Northing/Easting
        // polygon (e.g. an imported channel/geobody outline) is extruded
        // vertically between two TVDss depths into a solid, semi-
        // transparent volume, using the same X=Easting/Y=-TVD/Z=-Northing
        // convention as everything else in this viewer.
        //
        // Mesh construction: build a THREE.Shape from (easting, northing)
        // points (both un-negated at this stage), extrude it along the
        // shape's local Z by (tvdTo - tvdFrom), then:
        //   1. rotateX(-PI/2) — maps local Z (extrusion) -> world Y, and
        //      local Y (northing) -> world -Z (i.e. -northing, matching the
        //      viewer's Z=-Northing convention). Local X (easting) is
        //      untouched by an X-axis rotation, so it stays world X.
        //   2. scale(1,-1,1) — flips the extrusion so it grows in -Y
        //      (deeper => more negative Y, matching Y=-TVD) instead of +Y.
        // The mesh is then positioned at Y = -tvdFrom (its "top" face,
        // i.e. z=0 before rotation) so it spans world Y from -tvdFrom down
        // to -tvdTo.

        let wbtPolyActiveId = null;
        let wbtPolyMeshes   = [];      // THREE.Mesh[] currently in the scene
        let wbtPolyImportedPoints = null; // [{northing,easting}, ...] from the last file import
        let WBT_POLYLINES = [];        // cache of the loaded list (for edit/re-render)

        function wbtPolySetupAccordion(){
            const hdr = document.getElementById('wbtPolyAccHeader');
            const bdy = document.getElementById('wbtPolyAccBody');
            if(!hdr || !bdy) return;
            hdr.addEventListener('click', () => {
                hdr.classList.toggle('collapsed');
                bdy.classList.toggle('collapsed');
            });
        }

        // ── Excel import (Northing, Easting columns — same convention as
        //    the wellbore survey uploads). Header names are matched
        //    case-insensitively; column ORDER is what actually matters
        //    (column 1 = Northing, column 2 = Easting), matching the
        //    person's sample file. ──
        function wbtPolySetupFileInput(){
            const fileEl = document.getElementById('wbtPolyFile');
            if(!fileEl) return; // no edit form for this role (2026-09-13 fix)
            fileEl.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                const statusEl = document.getElementById('wbtPolyImportStatus');
                if(!file) return;
                try{
                    const buf = await file.arrayBuffer();
                    let wb;
                    try { wb = XLSX.read(buf, { type: 'array' }); }
                    catch(err){
                        const csv = new TextDecoder('utf-8').decode(new Uint8Array(buf));
                        wb = XLSX.read(csv, { type: 'string' });
                    }
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
                    const dataRows = rows.slice(1).filter(r => r.length >= 2 && r[0] !== '' && r[1] !== '');
                    if(dataRows.length < 3){
                        statusEl.textContent = 'File needs at least 3 data rows (Northing, Easting).';
                        statusEl.style.color = 'var(--wbt-red)';
                        wbtPolyImportedPoints = null;
                        return;
                    }
                    wbtPolyImportedPoints = dataRows.map(r => ({ northing: Number(r[0]), easting: Number(r[1]) }));
                    const closed = Math.abs(wbtPolyImportedPoints[0].northing - wbtPolyImportedPoints[wbtPolyImportedPoints.length-1].northing) < 1e-6
                                 && Math.abs(wbtPolyImportedPoints[0].easting  - wbtPolyImportedPoints[wbtPolyImportedPoints.length-1].easting)  < 1e-6;
                    statusEl.textContent = `Imported ${wbtPolyImportedPoints.length} points from "${file.name}"` + (closed ? ' (closed loop).' : ' (open — will be auto-closed on save).');
                    statusEl.style.color = 'var(--wbt-accent3)';
                } catch(err){
                    console.error(err);
                    statusEl.textContent = 'Could not read this file — check it has Northing/Easting columns.';
                    statusEl.style.color = 'var(--wbt-red)';
                    wbtPolyImportedPoints = null;
                }
            });
        }

        // ── 3D mesh builder ──
        // Added 2026-08-25: three display styles, chosen per-polyline
        // (poly.displayStyle, saved in the DB):
        //   'solid'     — filled/shaded extruded volume (original behavior).
        //   'wireframe' — the same extruded volume, edges only (EdgesGeometry
        //                 + LineSegments, same technique as the Frac Plane
        //                 box/cylinder wireframes above).
        //   'lines'     — no extrusion at all: just the closed outline drawn
        //                 twice, once at TVDss From and once at TVDss To
        //                 ("as entered"), with no side walls/caps connecting
        //                 them.
        // Returns a THREE.Object3D (Mesh, LineSegments, or a Group of two
        // LineLoops) — the caller (wbtRenderPolyMeshes) treats all three
        // uniformly via group.add()/group.remove().
        function wbtBuildExtrudedGeometry(poly){
            const shapePts = poly.points.map(p => new THREE.Vector2(p.easting, p.northing));
            const shape = new THREE.Shape(shapePts);
            const depth = Math.max(Math.abs((poly.tvdTo||0) - (poly.tvdFrom||0)), 0.01);
            const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
            geo.rotateX(-Math.PI/2);
            geo.scale(1, -1, 1);
            return geo;
        }

        function wbtBuildPolylineMesh(poly, colorInt){
            if(!poly.points || poly.points.length < 3) return null;
            const style = poly.displayStyle || 'solid';

            if(style === 'lines'){
                // Just the closed outline "as entered", at each depth — no
                // extrusion, no side walls.
                const group3d = new THREE.Group();
                const mat = new THREE.LineBasicMaterial({ color: colorInt });
                // 2026-10-21: TVDss From/To are Sub-Sea ELEVATIONS (same convention as the
                // survey Sub-Sea column, confirmed by John) -> Y = value (was -value).
                [poly.tvdFrom||0, poly.tvdTo||0].forEach(ss => {
                    const pts = poly.points.map(p => new THREE.Vector3(p.easting, ss, -p.northing));
                    const geo = new THREE.BufferGeometry().setFromPoints(pts);
                    group3d.add(new THREE.LineLoop(geo, mat));
                });
                return group3d;
            }

            const geo = wbtBuildExtrudedGeometry(poly);

            if(style === 'wireframe'){
                const edges = new THREE.EdgesGeometry(geo);
                const mat = new THREE.LineBasicMaterial({ color: colorInt });
                const mesh = new THREE.LineSegments(edges, mat);
                mesh.position.set(0, Math.max(poly.tvdFrom||0, poly.tvdTo||0), 0);   // 2026-10-21: top = higher elevation, extrudes down
                return mesh;
            }

            // 'solid' (default)
            const mat = new THREE.MeshBasicMaterial({
                color: colorInt, transparent: true, opacity: 0.45,
                side: THREE.DoubleSide, depthWrite: false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, Math.max(poly.tvdFrom||0, poly.tvdTo||0), 0);   // 2026-10-21: top = higher elevation, extrudes down
            return mesh;
        }

        function wbtClearPolyMeshes(){
            wbtPolyMeshes.forEach(m => group.remove(m));
            wbtPolyMeshes = [];
        }

        function wbtRenderPolyMeshes(polylines){
            wbtClearPolyMeshes();
            (polylines||[]).forEach(poly => {
                const colorInt = poly.colorHex ? parseInt(poly.colorHex.replace('#',''), 16) : 0xff0000;
                const mesh = wbtBuildPolylineMesh(poly, colorInt);
                if(mesh){ group.add(mesh); wbtPolyMeshes.push(mesh); }
            });
        }

        // ── List panel ──
        function wbtPolyRebuildList(polylines){
            const listEl = document.getElementById('wbtPolyList');
            listEl.innerHTML = '';
            if(!polylines || polylines.length === 0){
                listEl.innerHTML = '<div style="font-family:var(--wbt-mono);font-size:10px;color:var(--wbt-text-dim);padding:4px 0">No polylines defined for this job.</div>';
                return;
            }
            polylines.forEach(poly => {
                const item = document.createElement('div');
                item.className = 'wbt-fp-list-item';
                item.dataset.polyid = String(poly._id);
                const styleTag = { solid: 'FILL', wireframe: 'WIRE', lines: 'LINES' }[poly.displayStyle] || 'FILL';
                item.innerHTML =
                    `<span style="font-family:var(--wbt-mono);font-size:9px;color:${poly.colorHex||'#ff0000'};border:1px solid ${poly.colorHex||'#ff0000'}60;padding:1px 4px;border-radius:2px">${(poly.points||[]).length}pt</span>` +
                    `<span style="font-family:var(--wbt-mono);font-size:9px;color:var(--wbt-text-dim);border:1px solid var(--wbt-border);padding:1px 4px;border-radius:2px">${styleTag}</span>` +
                    `<span class="wbt-fp-lbl">${poly.name||'(no name)'}</span>` +
                    `<span class="wbt-fp-meta">TVDss ${poly.tvdFrom}–${poly.tvdTo}m</span>`;
                item.addEventListener('click', () => {
                    document.querySelectorAll('#wbtPolyList .wbt-fp-list-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    wbtPolyActiveId = String(poly._id);
                    wbtPolyFillForm(poly);
                    // FIX 2026-09-13: view-only roles (no edit form rendered) don't
                    // have these buttons — guard so clicking a list item to inspect
                    // it doesn't throw and silently break the rest of the viewer.
                    const updBtn = document.getElementById('wbtPolyUpdBtn');
                    const delBtn = document.getElementById('wbtPolyDelBtn');
                    if(updBtn) updBtn.disabled = false;
                    if(delBtn) delBtn.disabled = false;
                });
                listEl.appendChild(item);
            });
        }

        function wbtPolyFillForm(poly){
            // FIX 2026-09-13: no edit form exists for view-only roles — bail
            // out before touching any form field so viewing the list doesn't
            // throw (see wbtFPInit()/wbtPolyInit() comments for the crash
            // mechanism this whole round of fixes addresses).
            const nameEl = document.getElementById('wbtPolyName');
            if(!nameEl) return;
            nameEl.value  = poly.name || '';
            document.getElementById('wbtPolyFrom').value  = poly.tvdFrom;
            document.getElementById('wbtPolyTo').value    = poly.tvdTo;
            document.getElementById('wbtPolyColor').value = poly.colorHex || '#ff0000';
            document.getElementById('wbtPolyStyle').value = poly.displayStyle || 'solid';
            wbtPolyImportedPoints = poly.points || null; // re-uploading is optional on update
            document.getElementById('wbtPolyImportStatus').textContent =
                `Using this polyline's ${ (poly.points||[]).length } saved points (import a new file to replace them).`;
            document.getElementById('wbtPolyImportStatus').style.color = 'var(--wbt-text-dim)';
        }

        function wbtPolyClearForm(){
            document.getElementById('wbtPolyName').value = '';
            document.getElementById('wbtPolyFrom').value = '';
            document.getElementById('wbtPolyTo').value = '';
            document.getElementById('wbtPolyColor').value = '#ff0000';
            document.getElementById('wbtPolyStyle').value = 'solid';
            document.getElementById('wbtPolyFile').value = '';
            document.getElementById('wbtPolyImportStatus').textContent = 'No file imported yet.';
            document.getElementById('wbtPolyImportStatus').style.color = 'var(--wbt-text-dim)';
            wbtPolyImportedPoints = null;
            wbtPolyActiveId = null;
            document.getElementById('wbtPolyUpdBtn').disabled = true;
            document.getElementById('wbtPolyDelBtn').disabled = true;
            document.querySelectorAll('#wbtPolyList .wbt-fp-list-item').forEach(el => el.classList.remove('active'));
        }

        function wbtPolySetStatus(msg, ok){
            const el = document.getElementById('wbtPolyStatus');
            el.textContent = msg;
            el.style.color = ok === true ? 'var(--wbt-accent3)' : (ok === false ? 'var(--wbt-red)' : 'var(--wbt-text-dim)');
        }

        function wbtPolyReadForm(){
            return {
                name: document.getElementById('wbtPolyName').value || '',
                tvdFrom: Number(document.getElementById('wbtPolyFrom').value),
                tvdTo: Number(document.getElementById('wbtPolyTo').value),
                colorHex: document.getElementById('wbtPolyColor').value || '#ff0000',
                displayStyle: document.getElementById('wbtPolyStyle').value || 'solid',
                points: wbtPolyImportedPoints,
            };
        }

        async function wbtPolyRefresh(){
            const res = await fetch('/notes/polyline/list/' + WBT_NOTE_ID);
            const data = await res.json();
            if(!res.ok) throw new Error(data.error || res.statusText);
            WBT_POLYLINES = data.polylines || [];
            wbtRenderPolyMeshes(WBT_POLYLINES);
            wbtPolyRebuildList(WBT_POLYLINES);
        }

        async function wbtPolyAdd(){
            const body = wbtPolyReadForm();
            if(!body.points || body.points.length < 3){
                wbtPolySetStatus('Import an Excel file with at least 3 points first.', false);
                return;
            }
            if(!Number.isFinite(body.tvdFrom) || !Number.isFinite(body.tvdTo)){
                wbtPolySetStatus('Enter numeric TVDss From/To values.', false);
                return;
            }
            wbtPolySetStatus('Adding...');
            try{
                const res = await fetch('/notes/polyline/' + WBT_NOTE_ID, {
                    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
                });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtPolySetStatus('Polyline added.', true);
                await wbtPolyRefresh();
                wbtPolyClearForm();
            } catch(err){
                wbtPolySetStatus('Error: ' + err.message, false);
            }
        }

        async function wbtPolyUpdate(){
            if(!wbtPolyActiveId){ wbtPolySetStatus('Select a polyline to update.', false); return; }
            const body = wbtPolyReadForm();
            wbtPolySetStatus('Updating...');
            try{
                const res = await fetch('/notes/polyline/' + wbtPolyActiveId, {
                    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
                });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtPolySetStatus('Polyline updated.', true);
                await wbtPolyRefresh();
                wbtPolyClearForm();
            } catch(err){
                wbtPolySetStatus('Error: ' + err.message, false);
            }
        }

        async function wbtPolyDelete(){
            if(!wbtPolyActiveId){ wbtPolySetStatus('Select a polyline to delete.', false); return; }
            if(!confirm('Delete this polyline? This cannot be undone.')) return;
            wbtPolySetStatus('Deleting...');
            try{
                const res = await fetch('/notes/polyline/' + wbtPolyActiveId, { method:'DELETE' });
                const data = await res.json();
                if(!res.ok) throw new Error(data.error || res.statusText);
                wbtPolySetStatus('Polyline deleted.', true);
                await wbtPolyRefresh();
                wbtPolyClearForm();
            } catch(err){
                wbtPolySetStatus('Error: ' + err.message, false);
            }
        }

        function wbtPolyInit(){
            // FIX 2026-09-13: the accordion (header + list) now renders for
            // EVERY role — only the edit form below is role-gated in the EJS
            // (see wbtCanEdit). Previously this function bailed out entirely
            // for any role lacking 'wbtPolyAccHeader', which meant restricted
            // roles (e.g. a "DE" role, or any string outside admin/leader/user)
            // never got wbtPolyRefresh() called, so Polylines never rendered
            // for them at all. Fix: always set up the accordion toggle and
            // load/render the polylines first; only wire up the edit-only
            // buttons/file-input if the edit form actually exists for this role.
            wbtPolySetupAccordion();
            wbtPolyRefresh().catch(err => console.error('[Polyline] initial load failed', err));
            const addBtn = document.getElementById('wbtPolyAddBtn');
            if(!addBtn) return; // view-only role — no edit form, rendering above already covers it
            wbtPolySetupFileInput();
            addBtn.addEventListener('click', wbtPolyAdd);
            document.getElementById('wbtPolyUpdBtn').addEventListener('click', wbtPolyUpdate);
            document.getElementById('wbtPolyDelBtn').addEventListener('click', wbtPolyDelete);
            document.getElementById('wbtPolyClearBtn').addEventListener('click', wbtPolyClearForm);
        }

        // ================================================================
        // TRAJECTORY MARKERS (SC, Start Tang, End Tang, LP, ICP)
        // ================================================================
        // Each keyword detection uses the same comment-matching rules as
        // wbtIsReservedComment. One sphere per occurrence per wellbore.
        // Colors: SC=blue(#58a6ff), ICP=orange(#ff6b35), LP=yellow(#ffd060),
        //         Start Tang / End Tang = purple(#c084fc).

        const WBT_MARKER_DEFS = [
            { key: 'SURFACECASING',      color: 0x58a6ff, label: 'Surface Casing' },
            { key: 'KICKOFF',            color: 0x39ff14, label: 'KOP' },
            { key: 'INTERMEDIATECASING', color: 0xff6b35, label: 'Int. Casing' },
            { key: 'LANDING',            color: 0xffd060, label: 'Landing' },
            { key: 'START TANG',         color: 0xc084fc, label: 'Start Tang' },
            { key: 'END TANG',           color: 0xc084fc, label: 'End Tang' },
            { key: 'STK',                color: 0xff4060, label: 'STK' },
        ];

        let wbtMarkerGroup = new THREE.Group();
        // markerData: array of {mesh, label, md, tvd} for raycasting
        let wbtMarkerData  = [];
        // Scale factor for marker spheres (1.0 = base size, 0.4 = 60% smaller default)
        let wbtMarkerScale = 0.4;
        let wbtPadScale    = 100;  // estimated pad extent, set when markers are built

        function wbtAddMarkerGroup(){
            group.add(wbtMarkerGroup);
        }

        function wbtClearMarkers(){
            while(wbtMarkerGroup.children.length) wbtMarkerGroup.remove(wbtMarkerGroup.children[0]);
            wbtMarkerData = [];
        }

        // Build sphere markers for one wellbore's survey (db-keyed fields).
        // Radius = wbtMarkerScale * base, where base = max(padScale*0.0024, 0.8).
        // (base at scale=1.0 was max(padScale*0.006,2); new default wbtMarkerScale=0.4
        //  gives 40% of that = max(padScale*0.0024, 0.8) — 60% smaller.)
        function wbtComputeMarkerRadius(){
            return Math.max(wbtPadScale * 0.006 * wbtMarkerScale,
                            0.8 * wbtMarkerScale);
        }

        function wbtBuildMarkersForSurvey(survey, scale){
            wbtPadScale = scale || wbtPadScale;
            const radius = wbtComputeMarkerRadius();

            survey.forEach(row => {
                const raw = (row.comments || '').toUpperCase().trim();
                if(!raw) return;

                WBT_MARKER_DEFS.forEach(def => {
                    if(!raw.includes(def.key)) return;
                    const pos = wbtInterpolateAtMD(survey, num(row.md));
                    const geo = new THREE.SphereGeometry(radius, 8, 8);
                    const mat = new THREE.MeshBasicMaterial({ color: def.color });
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.position.set(pos.center.x, pos.center.y, pos.center.z);
                    mesh.userData.isMarker = true;
                    mesh.userData.label  = def.label;
                    mesh.userData.md     = num(row.md);
                    mesh.userData.tvd    = num(row.tvd);
                    mesh.userData.subSea = num(row.subSea);
                    wbtMarkerGroup.add(mesh);
                    wbtMarkerData.push({ mesh, label: def.label, md: num(row.md), tvd: num(row.tvd) });
                });
            });
        }

        // Rebuild all markers at new size (called by slider)
        function wbtRebuildAllMarkers(){
            wbtClearMarkers();
            if(typeof WELLBORES !== 'undefined'){
                // job.ejs path
                WELLBORES.forEach(well => wbtBuildMarkersForSurvey(well.survey || [], wbtPadScale));
            } else {
                // edit-note.ejs path — use wbtTubeMeshData
                (wbtTubeMeshData || []).forEach(td => wbtBuildMarkersForSurvey(td.survey, wbtPadScale));
            }
        }

        // ================================================================
        // TOOLTIP
        // ================================================================
        // Shows on hover over:
        //   - Wellbore tube mesh → closest survey station's MD/Incl/Azim/TVD/TVDss/DLS/N/E
        //   - Formation invisible plane → formation name + TVD + TVDss
        //   - Marker sphere → label + MD + TVD
        // Uses Raycaster on mousemove.

        let wbtTooltipEl = null;
        let wbtRaycaster = null;
        let wbtMouseVec  = new THREE.Vector2();

        // Per-wellbore data needed for raycasting tooltip
        // [{mesh: THREE.Mesh, survey: [...], color}]
        let wbtTubeMeshData = [];

        // Formation invisible planes for raycasting
        // [{mesh: THREE.Mesh, name, tvd, subSea}]
        let wbtFormPlaneData = [];


        // ================================================================
        // ADDED 2026-11-01 (John): CLICK A TRAJECTORY -> PROFILE PANEL
        // Floating panel over the 3D view with three tabs: Inclination / Azimuth / DLS vs MD. Works for every
        // tube that carries mesh.userData.pick() -> { name, color, rows:[{md, inc, az, tvd, ss, dls, n, e, comment}] }
        // (planned / offset wells here, iPlan scenarios and iPad previews set it where they build their tubes).
        // Click = show that well; Shift+click = overlay (max 4). Comment points (KickOff, Nudge, tangents,
        // IntermediateCasing, TD, ...) drawn as markers. Hover = read-out + a sphere at that MD in 3D.
        // A click is a press/release without dragging (< 5 px) so orbiting the view does not open it.
        // Azimuth is unwrapped (continuous through 0/360) for plotting; tick labels are shown modulo 360.
        // ================================================================
        const WBT_PF_MK = { SURFACECASING:'#b0b0b0', NUDGE:'#ff9800', KICKOFF:'#00e5ff', 'START STEAMFLOOD TANG':'#00e676', 'END STEAMFLOOD TANG':'#00e676',
            'START TANG':'#76ff03', 'END TANG':'#76ff03', INTERMEDIATECASING:'#e040fb', LANDING:'#e040fb', TD:'#ff4c4c', 'START LATERAL AVOIDANCE':'#ffeb3b', 'END LATERAL AVOIDANCE':'#ffeb3b' };
        const wbtPf = { wells: [], tab: 'inc', el: null, sphere: null, down: null };
        function wbtPfColor(c){ return typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : (c || '#00c8ff'); }
        function wbtPfInit(){
            const canvas = document.getElementById('wbtViewer'); if(!canvas) return;
            canvas.addEventListener('pointerdown', e => { wbtPf.down = { x: e.clientX, y: e.clientY }; });
            canvas.addEventListener('pointerup', e => {
                const d = wbtPf.down; wbtPf.down = null;
                if(!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || e.button !== 0) return;
                const rect = canvas.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
                const rc = new THREE.Raycaster(); rc.setFromCamera(v, camera);
                const meshes = []; group.traverse(o => { if(o.isMesh && o.visible && o.userData && typeof o.userData.pick === 'function') meshes.push(o); });
                const hit = rc.intersectObjects(meshes, false)[0]; if(!hit) return;
                let info = null; try { info = hit.object.userData.pick(); } catch(err){ console.warn('profile pick', err); }
                if(!info || !info.rows || info.rows.length < 2) return;
                info.color = wbtPfColor(info.color);
                info.mesh = hit.object; wbtPf.sepCache = null;
                if(e.shiftKey && wbtPf.wells.length){ if(!wbtPf.wells.some(w => w.name === info.name)){ wbtPf.wells.push(info); if(wbtPf.wells.length > 4) wbtPf.wells.shift(); } }
                else wbtPf.wells = [info];
                wbtPfRender();
            });
        }
        // ================================================================
        // ADDED 2026-11-09 (John): CREATE A TARGET ON THE FLY
        // Double-click the profile panel chart (Inclination / Azimuth / DLS) or a trajectory in the 3D view ->
        // dialog: name, point at that MD (auto-filled), optional offset, radius, iPlan scenario to add it to.
        //  - Point = EXACT MD (not the nearest station): IPlanCore.interpolateSurveyAtMD — position along the
        //    minimum-curvature arc between the two bracketing stations (attitude slerp + Bourgoyne Eqs. 8.33-8.37).
        //    Sub-Sea at that MD = SS(station above) - (TVD - TVD(station above))   (Sub-Sea = RKB - TVD).
        //  - Offset, two frames (toggle):
        //      Grid:  dN, dE, dTVD (TVD positive DOWN, so dSS = -dTVD)
        //      Well:  Up (high side) / Right (lateral) / Ahead (along hole), the borehole HLA axes of the
        //             ISCWSA Error Model Rev 5.13 definition, sec. 4.8 Eq. 38 (NEV -> HLA direction cosines):
        //             h = (cosI cosA, cosI sinA, -sinI), l = (-sinA, cosA, 0), a = (sinI cosA, sinI sinA, cosI)
        //             in (North, East, Down);  dNEV = Up*h + Right*l + Ahead*a.  Below ~1 deg Inc the high side
        //             is not defined (h, l follow the azimuth) -> warning.
        //  - The target {name, n, e, ss, r, inc, az} goes to the chosen iPlan scenario through
        //    window.IPLAN_ADD_TARGET (same as "+ Blank target": redraw + autosave). Inc / Az = attitude at the
        //    picked MD (used by Optimum Align "Final Target").
        // ================================================================
        const wbtTg = { el: null };
        function wbtTgRowsToSurvey(rows){ return rows.filter(r => isFinite(r.md)).map(r => ({ md: r.md, incl: r.inc, azim: r.az, tvd: r.tvd, northing: r.n, easting: r.e, ss: r.ss })); }
        function wbtTgPointAt(well, md){
            const C = window.IPlanCore; if(!C || !C.interpolateSurveyAtMD) return null;
            const sv = wbtTgRowsToSurvey(well.rows).sort((a, b) => a.md - b.md);
            const p = C.interpolateSurveyAtMD(sv, md); if(!p) return null;
            let up = sv[0]; for(const r of sv){ if(r.md <= md + 1e-6) up = r; else break; }
            p.ss = (isFinite(up.ss) && isFinite(up.tvd)) ? up.ss - (p.tvd - up.tvd) : NaN;
            return p;
        }
        // closest MD on a well to a 3D point (scene coords x=E, y=SS, z=-N): project on the station polyline
        function wbtTgMdNear(well, pt){
            const rows = well.rows.filter(r => isFinite(r.md) && isFinite(r.n) && isFinite(r.e) && isFinite(r.ss)).slice().sort((a, b) => a.md - b.md);
            let best = { d: Infinity, md: null };
            for(let i = 1; i < rows.length; i++){
                const a = rows[i - 1], b = rows[i];
                const A = [a.e, a.ss, -a.n], B = [b.e, b.ss, -b.n], P = [pt.x, pt.y, pt.z];
                const AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], AP = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
                const L2 = AB[0] * AB[0] + AB[1] * AB[1] + AB[2] * AB[2];
                const t = L2 > 0 ? Math.max(0, Math.min(1, (AP[0] * AB[0] + AP[1] * AB[1] + AP[2] * AB[2]) / L2)) : 0;
                const Q = [A[0] + t * AB[0], A[1] + t * AB[1], A[2] + t * AB[2]], d = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
                if(d < best.d) best = { d, md: a.md + t * (b.md - a.md) };
            }
            return best.md;
        }
        function wbtTgOpen(wells, wellIdx, md){
            const scs = (window.IPLAN_SCENARIOS || []);
            if(!wbtTg.el){
                const el = document.createElement('div'); wbtTg.el = el;
                el.style.cssText = 'position:fixed;inset:0;z-index:1090;background:rgba(0,0,0,.55);display:none;align-items:flex-start;justify-content:center;padding:6vh 12px;';
                el.addEventListener('click', e => { if(e.target === el) el.style.display = 'none'; });
                document.addEventListener('keydown', e => { if(e.key === 'Escape' && el.style.display !== 'none') el.style.display = 'none'; });
                document.body.appendChild(el);
            }
            const el = wbtTg.el, st = { frame: 'grid', wells, wi: wellIdx || 0, md };
            const f = (v, d) => (v == null || !isFinite(v)) ? '—' : (+v).toFixed(d);
            const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
            const selId = typeof window.IPLAN_SELECTED_ID === 'function' ? window.IPLAN_SELECTED_ID() : null;
            const inp = 'background:var(--wbt-bg,#0a0e14);color:var(--wbt-text,#c8d8e8);border:1px solid var(--wbt-border,#1e2d3d);border-radius:3px;padding:4px 6px;font-size:13px;';
            el.innerHTML = `<div style="width:min(620px,96vw);background:var(--wbt-panel,#0d131b);border:1px solid #00c8ff;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.6);color:var(--wbt-text,#c8d8e8);font-size:13px;">
                <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--wbt-border,#1e2d3d);"><b style="flex:1;letter-spacing:1px;">NEW TARGET</b>
                    <button type="button" data-x style="background:none;border:1px solid var(--wbt-border,#1e2d3d);color:inherit;width:30px;height:30px;border-radius:4px;cursor:pointer;">&times;</button></div>
                <div style="padding:12px 14px;display:grid;grid-template-columns:130px 1fr;gap:8px 10px;align-items:center;">
                    <span>Name</span><input data-k="name" style="${inp}">
                    <span>From well</span><select data-k="well" style="${inp}">${wells.map((w, i) => `<option value="${i}"${i === st.wi ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
                    <span>MD (m)</span><input data-k="md" type="number" step="0.1" style="${inp}width:140px;">
                    <span>Point</span><div data-k="pt" style="font-family:var(--wbt-mono,monospace);font-size:12px;"></div>
                    <span>Offset</span><div>
                        <div style="display:flex;gap:6px;margin-bottom:6px;">
                            <button type="button" class="wbt-btn" data-fr="grid">Grid (N / E / TVD)</button>
                            <button type="button" class="wbt-btn" data-fr="well">Well (Up / Right / Ahead)</button></div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <label style="display:flex;gap:4px;align-items:center;"><span data-l="0">ΔN</span><input data-o="0" type="number" step="0.1" value="0" style="${inp}width:80px;"></label>
                            <label style="display:flex;gap:4px;align-items:center;"><span data-l="1">ΔE</span><input data-o="1" type="number" step="0.1" value="0" style="${inp}width:80px;"></label>
                            <label style="display:flex;gap:4px;align-items:center;"><span data-l="2">ΔTVD</span><input data-o="2" type="number" step="0.1" value="0" style="${inp}width:80px;"></label>
                            <span style="opacity:.7">m</span></div>
                        <div data-k="fnote" style="font-size:11px;opacity:.75;margin-top:4px;"></div></div>
                    <span>Radius (m)</span><input data-k="r" type="number" step="1" value="15" style="${inp}width:90px;">
                    <span>Target</span><div data-k="res" style="font-family:var(--wbt-mono,monospace);font-size:12px;color:#00e676;"></div>
                    <span>Add to scenario</span>${scs.length ? `<select data-k="sc" style="${inp}">${scs.map(s => `<option value="${esc(s.id)}"${s.id === selId ? ' selected' : ''}>${esc(s.name || 'Scenario')}</option>`).join('')}</select>`
                        : `<div style="color:#ffb300;">No iPlan scenario yet — create one in iPlan first.</div>`}
                </div>
                <div data-k="msg" style="padding:0 14px;font-size:12px;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--wbt-border,#1e2d3d);">
                    <button type="button" class="wbt-btn" data-cancel>Cancel</button>
                    <button type="button" class="wbt-btn" data-ok style="border-color:#00e676;color:#00e676;"${scs.length ? '' : ' disabled'}>Create target</button></div></div>`;
            const q = s => el.querySelector(s);
            q('[data-k=md]').value = (+md).toFixed(1);
            const nameDef = () => wells[st.wi].name + ' @ MD ' + (+q('[data-k=md]').value).toFixed(0);
            q('[data-k=name]').value = nameDef(); let nameTouched = false;
            q('[data-k=name]').addEventListener('input', () => { nameTouched = true; });
            const upd = () => {
                st.wi = +q('[data-k=well]').value;
                const w = wells[st.wi], mdv = parseFloat(q('[data-k=md]').value);
                if(!nameTouched) q('[data-k=name]').value = nameDef();
                el.querySelectorAll('[data-fr]').forEach(b => { const on = b.dataset.fr === st.frame; b.style.borderColor = on ? '#00c8ff' : ''; b.style.color = on ? '#00c8ff' : ''; });
                const labs = st.frame === 'grid' ? ['ΔN', 'ΔE', 'ΔTVD'] : ['Up', 'Right', 'Ahead'];
                labs.forEach((t, i) => { q(`[data-l="${i}"]`).textContent = t; });
                q('[data-k=fnote]').textContent = st.frame === 'grid'
                    ? 'Grid north / east; TVD positive down (ΔTVD = +5 → 5 m deeper).'
                    : 'Relative to the hole at this MD: Up = high side, Right = lateral, Ahead = along hole (ISCWSA HLA axes, Rev 5.13 Eq. 38).';
                const P = isFinite(mdv) ? wbtTgPointAt(w, mdv) : null; st.P = P;
                const okBtn = q('[data-ok]'), msg = q('[data-k=msg]');
                if(!P){ q('[data-k=pt]').textContent = '—'; q('[data-k=res]').textContent = '—'; msg.innerHTML = '<span style="color:#ff4c4c;">MD outside this well (' + f(w.rows[0] && Math.min(...w.rows.map(r => r.md)), 1) + ' – ' + f(Math.max(...w.rows.map(r => r.md)), 1) + ' m).</span>'; if(okBtn) okBtn.disabled = true; return; }
                q('[data-k=pt]').innerHTML = `Inc ${f(P.inc,2)}° · Az ${f(P.az,2)}° · TVD ${f(P.tvd,2)} · SS ${f(P.ss,2)}<br>N ${f(P.n,2)} · E ${f(P.e,2)}`;
                const o = [0, 1, 2].map(i => parseFloat(q(`[data-o="${i}"]`).value) || 0), R = Math.PI / 180;
                let dN, dE, dD;
                if(st.frame === 'grid'){ dN = o[0]; dE = o[1]; dD = o[2]; }
                else {
                    const I = P.inc * R, A = P.az * R, h = [Math.cos(I) * Math.cos(A), Math.cos(I) * Math.sin(A), -Math.sin(I)], l = [-Math.sin(A), Math.cos(A), 0], a = [Math.sin(I) * Math.cos(A), Math.sin(I) * Math.sin(A), Math.cos(I)];
                    dN = o[0] * h[0] + o[1] * l[0] + o[2] * a[0]; dE = o[0] * h[1] + o[1] * l[1] + o[2] * a[1]; dD = o[0] * h[2] + o[1] * l[2] + o[2] * a[2];
                }
                st.T = { n: P.n + dN, e: P.e + dE, ss: P.ss - dD, tvd: P.tvd + dD };
                q('[data-k=res]').innerHTML = `N ${f(st.T.n,2)} · E ${f(st.T.e,2)} · SS ${f(st.T.ss,2)} (TVD ${f(st.T.tvd,2)} on this well's RKB)<br><span style="color:var(--wbt-text-dim,#8aa);">ΔN ${f(dN,2)} · ΔE ${f(dE,2)} · ΔTVD ${f(dD,2)} · distance ${f(Math.hypot(dN, dE, dD),2)} m</span>`;
                msg.innerHTML = (st.frame === 'well' && P.inc < 1 && (o[0] || o[1])) ? '<span style="color:#ffb300;">Inc &lt; 1°: the high side is not defined — Up / Right follow the azimuth (' + f(P.az,1) + '°).</span>'
                    : (!isFinite(P.ss) ? '<span style="color:#ff4c4c;">This trajectory has no Sub-Sea values.</span>' : '');
                if(okBtn) okBtn.disabled = !scs.length || !isFinite(P.ss);
            };
            el.querySelectorAll('input,select').forEach(x => x.addEventListener('input', upd));
            el.querySelectorAll('[data-fr]').forEach(b => b.addEventListener('click', () => { st.frame = b.dataset.fr; upd(); }));
            q('[data-x]').onclick = q('[data-cancel]').onclick = () => { el.style.display = 'none'; };
            const ok = q('[data-ok]');
            if(ok) ok.onclick = () => {
                if(!st.T || !st.P) return;
                const t = { name: q('[data-k=name]').value.trim() || nameDef(), n: Math.round(st.T.n * 100) / 100, e: Math.round(st.T.e * 100) / 100,
                    ss: Math.round(st.T.ss * 100) / 100, r: Math.max(0.5, parseFloat(q('[data-k=r]').value) || 15), inc: +st.P.inc.toFixed(3), az: +st.P.az.toFixed(3) };
                const scId = q('[data-k=sc]').value;
                const done = typeof window.IPLAN_ADD_TARGET === 'function' && window.IPLAN_ADD_TARGET(scId, t);
                if(done){ el.style.display = 'none'; const sc = scs.find(s => s.id === scId);
                    if(typeof setStatusMsg === 'function') setStatusMsg('Target "' + t.name + '" added to ' + (sc ? sc.name : 'scenario'));
                    if(sc && !sc.visible) q('[data-k=msg]').textContent = '';
                } else q('[data-k=msg]').innerHTML = '<span style="color:#ff4c4c;">Could not add the target (iPlan not ready).</span>';
            };
            el.style.display = 'flex'; upd(); q('[data-k=name]').focus(); q('[data-k=name]').select();
        }
        function wbtTgInit3D(){
            const canvas = document.getElementById('wbtViewer'); if(!canvas) return;
            canvas.addEventListener('dblclick', e => {
                const rect = canvas.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
                const rc = new THREE.Raycaster(); rc.setFromCamera(v, camera);
                const meshes = []; group.traverse(o => { if(o.isMesh && o.visible && o.userData && typeof o.userData.pick === 'function') meshes.push(o); });
                const hit = rc.intersectObjects(meshes, false)[0]; if(!hit) return;
                let info = null; try { info = hit.object.userData.pick(); } catch(err){ return; }
                if(!info || !info.rows || info.rows.length < 2) return;
                const md = wbtTgMdNear(info, group.worldToLocal(hit.point.clone()));
                if(md != null) wbtTgOpen([info], 0, md);
            });
        }

        // ADDED 2026-11-02: every pickable trajectory in the scene, sorted by name (iPad previews first)
        function wbtPfPickList(){
            const L = []; group.traverse(o => { if(o.isMesh && o.visible && o.userData && typeof o.userData.pick === 'function') L.push(o); });
            const key = m => (/iPad preview/.test(m.userData.pickName || '') ? '0' : /scenario/.test(m.userData.pickName || '') ? '1' : '2') + String(m.userData.pickName || '');
            L.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
            wbtPf.pickList = L; return L;
        }
        function wbtPfClose(){ if(wbtPf.el) wbtPf.el.style.display = 'none'; wbtPf.wells = []; wbtPf.sepCache = null; wbtPfSphere(null); }
        function wbtPfSphere(row, color){
            if(!row){ if(wbtPf.sphere) wbtPf.sphere.visible = false; return; }
            if(!wbtPf.sphere){ wbtPf.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); group.add(wbtPf.sphere); }
            if(wbtPf.sphere.parent !== group) group.add(wbtPf.sphere);
            const r = Math.max(3, (wbtPf.wells[0] && wbtPf.wells[0].rows.length ? 6 : 6));
            wbtPf.sphere.scale.setScalar(r); wbtPf.sphere.material.color.set(color || '#ffffff');
            wbtPf.sphere.position.set(row.e, row.ss, -row.n); wbtPf.sphere.visible = true;
        }
        function wbtPfRender(){
            const canvas = document.getElementById('wbtViewer'); if(!canvas) return;
            const host = canvas.parentElement; if(getComputedStyle(host).position === 'static') host.style.position = 'relative';
            if(!wbtPf.el){
                const el = document.createElement('div'); wbtPf.el = el;
                el.style.cssText = 'position:absolute;top:8px;right:8px;width:min(560px,calc(100% - 16px));background:var(--wbt-panel,#0d131b);border:1px solid var(--wbt-border,#1e2d3d);border-radius:6px;z-index:20;padding:6px 8px;font-size:11px;color:var(--wbt-text,#c8d8e8);box-shadow:0 4px 16px rgba(0,0,0,.4);';
                host.appendChild(el);
            }
            const el = wbtPf.el; el.style.display = 'block';
            const tabs = [['inc','Inclination'],['az','Azimuth'],['dls','DLS'],['sep','Separation']];   // 2026-11-01: Separation tab
            el.innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
                ${tabs.map(([k, l]) => `<button type="button" class="wbt-btn" data-pftab="${k}" style="padding:2px 8px;${wbtPf.tab === k ? 'border-color:#00c8ff;color:#00c8ff;' : ''}">${l}</button>`).join('')}
                <select data-pfsel style="max-width:230px;font-size:11px;" title="Trajectory to evaluate (replaces the reference; Shift+click in 3D still overlays)">${wbtPfPickList().map((m, i) => `<option value="${i}" ${wbtPf.wells[0] && wbtPf.wells[0].mesh === m ? 'selected' : ''}>${String(m.userData.pickName || 'trajectory ' + (i + 1)).replace(/</g,'&lt;')}</option>`).join('')}</select>
                <span style="flex:1;"></span>
                ${wbtPf.wells.map(w => `<span style="white-space:nowrap;"><span style="display:inline-block;width:10px;height:3px;background:${w.color};vertical-align:middle;margin-right:3px;"></span>${(w.name || '').replace(/</g,'&lt;')}</span>`).join(' ')}
                <button type="button" class="wbt-btn" data-pfclose style="padding:0 7px;" title="Close">&times;</button></div>
                <div data-pfchart style="position:relative;"></div>
                <div data-pfread style="font-family:var(--wbt-mono,monospace);min-height:15px;color:var(--wbt-text-dim,#8aa);">Hover the chart · Shift+click another trajectory to overlay (max 4)</div>`;
            el.querySelectorAll('[data-pftab]').forEach(b => b.addEventListener('click', () => { wbtPf.tab = b.dataset.pftab; wbtPfRender(); }));
            el.querySelector('[data-pfclose]').addEventListener('click', wbtPfClose);
            el.querySelector('[data-pfsel]').addEventListener('change', e => {   // 2026-11-02 (John): pick the trajectory from a list
                const m = wbtPf.pickList[+e.target.value]; if(!m) return; let info = null; try { info = m.userData.pick(); } catch(err){ return; }
                if(!info || !info.rows || info.rows.length < 2) return; info.color = wbtPfColor(info.color); info.mesh = m; wbtPf.sepCache = null;
                wbtPf.wells = [info].concat(wbtPf.wells.slice(1).filter(w => w.name !== info.name)); wbtPfRender(); });
            if(wbtPf.tab === 'sep') wbtPfSep(el.querySelector('[data-pfchart]'), el.querySelector('[data-pfread]'));
            else wbtPfChart(el.querySelector('[data-pfchart]'), el.querySelector('[data-pfread]'));
        }
        function wbtPfChart(box, read){
            const W = box.clientWidth || 540, H = 230, L = 44, R = 10, T = 8, B = 26, tab = wbtPf.tab;
            const series = wbtPf.wells.map(w => {
                const rows = w.rows.filter(r => isFinite(r.md)).slice().sort((a, b) => a.md - b.md);
                let prev = null, off = 0;
                const ys = rows.map(r => {
                    if(tab === 'inc') return r.inc;
                    if(tab === 'dls') return isFinite(r.dls) ? r.dls : 0;
                    let a = r.az; if(prev != null){ let d = a + off - prev; if(d > 180) off -= 360; else if(d < -180) off += 360; } a += off; prev = a; return a;
                });
                return { w, rows, ys };
            });
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            series.forEach(sr => sr.rows.forEach((r, i) => { x0 = Math.min(x0, r.md); x1 = Math.max(x1, r.md); if(isFinite(sr.ys[i])){ y0 = Math.min(y0, sr.ys[i]); y1 = Math.max(y1, sr.ys[i]); } }));
            if(!isFinite(x0) || x1 <= x0){ box.innerHTML = ''; return; }
            if(tab === 'inc'){ y0 = 0; y1 = Math.max(100, Math.ceil((y1 + 1) / 10) * 10); }   // headroom so 90 deg is not on the frame
            else if(tab === 'dls'){ y0 = 0; y1 = Math.max(1, Math.ceil(y1 + 0.5)); }
            else { const pad = Math.max(5, (y1 - y0) * 0.08); y0 = Math.floor((y0 - pad) / 10) * 10; y1 = Math.ceil((y1 + pad) / 10) * 10; }
            const sx = v => L + (v - x0) / (x1 - x0) * (W - L - R), sy = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
            const nice = (a, b, n) => { const raw = (b - a) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw) || raw; const out = []; for(let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(6)); return out; };
            const xt = nice(x0, x1, 6), yt = tab === 'inc' ? nice(y0, y1, 6) : nice(y0, y1, 5);
            const grid = 'var(--wbt-border,#1e2d3d)', txt = 'var(--wbt-text-dim,#8aa)';
            let svg = `<svg width="${W}" height="${H}" style="display:block;">`;
            xt.forEach(v => { svg += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" stroke="${grid}" stroke-width="1"/><text x="${sx(v)}" y="${H - B + 13}" fill="${txt}" font-size="10" text-anchor="middle">${v}</text>`; });
            yt.forEach(v => { const lab = tab === 'az' ? (((v % 360) + 360) % 360) : v; svg += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="${grid}" stroke-width="1"/><text x="${L - 4}" y="${sy(v) + 3}" fill="${txt}" font-size="10" text-anchor="end">${lab}</text>`; });
            svg += `<text x="${(L + W - R) / 2}" y="${H - 2}" fill="${txt}" font-size="10" text-anchor="middle">MD (m)</text>`;
            svg += `<text x="10" y="${(T + H - B) / 2}" fill="${txt}" font-size="10" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">${tab === 'inc' ? 'Inc (°)' : tab === 'az' ? 'Azimuth (°)' : 'DLS (°/30 m)'}</text>`;
            series.forEach(sr => {
                if(tab === 'dls'){   // DLS is per interval -> steps
                    let d = ''; sr.rows.forEach((r, i) => { if(!i){ d += `M${sx(r.md)},${sy(sr.ys[i])}`; return; } d += `H${sx(r.md)}V${sy(sr.ys[i])}`; });
                    svg += `<path d="${d}" fill="none" stroke="${sr.w.color}" stroke-width="1.6"/>`;
                } else svg += `<polyline points="${sr.rows.map((r, i) => sx(r.md) + ',' + sy(sr.ys[i])).join(' ')}" fill="none" stroke="${sr.w.color}" stroke-width="1.8"/>`;
                sr.rows.forEach((r, i) => { if(!r.comment) return; const k = String(r.comment).split(';')[0].trim().toUpperCase(); const c = WBT_PF_MK[k] || '#ffffff';
                    svg += `<circle cx="${sx(r.md)}" cy="${sy(sr.ys[i])}" r="3.5" fill="${c}" stroke="#000" stroke-width="0.6"><title>${String(r.comment).replace(/</g,'&lt;')} @ MD ${r.md.toFixed(1)}</title></circle>`; });
            });
            svg += `<line data-pfx x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#ffffff" stroke-opacity="0.5" stroke-dasharray="3 3" style="display:none;"/></svg>`;
            box.innerHTML = svg;
            const sv = box.querySelector('svg'), vl = box.querySelector('[data-pfx]');
            sv.addEventListener('mousemove', e => {
                const rb = sv.getBoundingClientRect(), x = e.clientX - rb.left; if(x < L || x > W - R){ vl.style.display = 'none'; return; }
                const md = x0 + (x - L) / (W - L - R) * (x1 - x0); vl.setAttribute('x1', x); vl.setAttribute('x2', x); vl.style.display = '';
                const parts = series.map(sr => { let bi = 0, bd = Infinity; sr.rows.forEach((r, i) => { const d = Math.abs(r.md - md); if(d < bd){ bd = d; bi = i; } }); return { sr, r: sr.rows[bi] }; });
                const f2 = (v, d) => (v == null || !isFinite(v)) ? '-' : (+v).toFixed(d);
                read.innerHTML = parts.map(p => `<span style="color:${p.sr.w.color};">●</span> MD ${f2(p.r.md,1)} · Inc ${f2(p.r.inc,2)}° · Az ${f2(p.r.az,2)}° · TVD ${f2(p.r.tvd,1)} · SS ${f2(p.r.ss,1)} · DLS ${f2(p.r.dls,2)}${p.r.comment ? ' · <b>' + String(p.r.comment).replace(/</g,'&lt;') + '</b>' : ''}`).join('<br>');
                wbtPfSphere(parts[0].r, parts[0].sr.w.color);
            });
            sv.addEventListener('mouseleave', () => { vl.style.display = 'none'; wbtPfSphere(null); });
            // 2026-11-09: double-click -> new target at the MD under the cursor (first well in the panel; changeable in the dialog)
            sv.style.cursor = 'crosshair';
            sv.insertAdjacentHTML('afterbegin', '<title>Double-click: create a target at this MD</title>');
            sv.addEventListener('dblclick', e => {
                const rb = sv.getBoundingClientRect(), x = e.clientX - rb.left; if(x < L || x > W - R) return;
                const md = x0 + (x - L) / (W - L - R) * (x1 - x0);
                wbtTgOpen(wbtPf.wells, 0, md);
            });
        }

        // ---------- Separation vs MD (ADDED 2026-11-01, John) ----------
        // Reference = the FIRST well in the panel. C2C (geometric, centre to centre, 3D, Sub-Sea datum) from each of
        // its stations to every other trajectory in the scene (all tubes with a pick provider: planned, offset,
        // scenarios, iPad previews), straight segments between stations. Shown: "Nearest" (min over all wells,
        // white) + the 3 wells that come closest, in their colours. Lines: build clearance (iPad Tunnel input,
        // default 10 m) and lateral clearance (iPad lateral input, default 15 m).
        // "SF" view: ISCWSA separation factor vs those 3 wells via window.acpPadApi.pairProfile — the Anti-collision
        // module's own computeC2CProfile / covariance / Confidence K (nothing re-derived here). Lines SF 1.0 / 1.25.
        function wbtPfSepData(){
            if(wbtPf.sepCache) return wbtPf.sepCache;
            const ref = wbtPf.wells[0], rows = ref.rows.filter(r => isFinite(r.md) && isFinite(r.n)).slice().sort((a, b) => a.md - b.md);
            const others = []; group.traverse(o => { if(o.isMesh && o.visible && o !== ref.mesh && o.userData && typeof o.userData.pick === 'function') others.push(o); });
            const bb = rows.reduce((b, r) => [Math.min(b[0], r.n), Math.max(b[1], r.n), Math.min(b[2], r.e), Math.max(b[3], r.e)], [Infinity, -Infinity, Infinity, -Infinity]), pad = 300;
            const cand = [];
            others.forEach(m => { let info; try { info = m.userData.pick(); } catch(e){ return; } if(!info || !info.rows || info.rows.length < 2 || info.name === ref.name) return;
                // 2026-11-04 (John, SD9 "[01]ETS 140030_L01 0.0 m"): a trajectory starting within 3 m of the reference's
                // surface is another version of the same well (e.g. the planned well an iPad preview redesigns) — skipped.
                const r0 = info.rows.slice().sort((a, b) => a.md - b.md)[0]; if(r0 && rows[0] && Math.hypot(r0.n - rows[0].n, r0.e - rows[0].e) < 3) return;
                const P = info.rows.filter(r => isFinite(r.n) && isFinite(r.e) && isFinite(r.ss) && r.n > bb[0] - pad && r.n < bb[1] + pad && r.e > bb[2] - pad && r.e < bb[3] + pad).sort((a, b) => a.md - b.md);
                if(P.length < 2) return;
                const d = rows.map(r => { let best = Infinity;
                    for(let i = 1; i < P.length; i++){ const a = P[i-1], c = P[i], vx = c.n - a.n, vy = c.e - a.e, vz = c.ss - a.ss, wx = r.n - a.n, wy = r.e - a.e, wz = r.ss - a.ss, L2 = vx*vx + vy*vy + vz*vz;
                        let t = L2 > 0 ? (wx*vx + wy*vy + wz*vz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const dd = Math.hypot(wx - t*vx, wy - t*vy, wz - t*vz); if(dd < best) best = dd; }
                    return best; });
                cand.push({ name: info.name, color: wbtPfColor(info.color), d, min: Math.min(...d), ac: info.ac, rowsOther: info.rows });
            });
            cand.sort((a, b) => a.min - b.min);
            const near = rows.map((r, i) => { let m = Infinity, who = ''; cand.forEach(c => { if(c.d[i] < m){ m = c.d[i]; who = c.name; } }); return { d: m, who }; });
            const g = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) : NaN; };
            wbtPf.sepCache = { rows, top: cand.slice(0, 3), near, clrB: isFinite(g('ipdTunR')) ? g('ipdTunR') : 10, clrL: isFinite(g('ipdLatClr')) ? g('ipdLatClr') : 15, view: 'c2c', sf: null };
            return wbtPf.sepCache;
        }
        async function wbtPfRunSf(){
            const S = wbtPf.sepCache, A = window.acpPadApi, ref = wbtPf.wells[0];
            if(!A){ S.sfErr = 'Anti-collision module not available on this page.'; return; }
            const refW = ref.ac ? ref.ac() : null; if(!refW){ S.sfErr = 'No AC data (toolcode / survey) for ' + ref.name + '.'; return; }
            await A.ready();
            S.sf = S.top.map(c => { const offW = c.ac ? c.ac() : null; if(!offW) return { c, err: 'no AC data' };
                const r = A.pairProfile(refW, offW); return r ? { c, prof: r.prof, real: r.real } : { c, err: 'not computable' }; });
            A.forget('__pf__');
        }
        function wbtPfSep(box, read){
            if(!wbtPf.wells.length) return;
            const S = wbtPfSepData(), W = box.clientWidth || 540, H = 230, L = 44, R = 10, T = 8, B = 26;
            const head = `<div style="margin-bottom:3px;">Ref: <b>${String(wbtPf.wells[0].name).replace(/</g,'&lt;')}</b> ·
                <button type="button" class="wbt-btn" data-pfsv="c2c" style="padding:1px 7px;${S.view === 'c2c' ? 'border-color:#00c8ff;color:#00c8ff;' : ''}">C2C (m)</button>
                <button type="button" class="wbt-btn" data-pfsv="sf" style="padding:1px 7px;${S.view === 'sf' ? 'border-color:#00c8ff;color:#00c8ff;' : ''}">SF (ISCWSA)</button>
                <span style="color:var(--wbt-text-dim,#8aa);">${S.top.length ? 'closest: ' + S.top.map(c => `<span style="color:${c.color};">${String(c.name).replace(/</g,'&lt;')} ${c.min.toFixed(1)} m</span>`).join(', ') : 'no other trajectory nearby'}</span></div>`;
            const mdMin = S.rows[0].md, mdMax = S.rows[S.rows.length - 1].md;
            let series = [], lines = [], y1;
            if(S.view === 'c2c'){
                series = [{ color: '#ffffff', w: 2, pts: S.rows.map((r, i) => [r.md, S.near[i].d]), name: 'Nearest' }].concat(S.top.map(c => ({ color: c.color, w: 1.2, dash: '4 3', pts: S.rows.map((r, i) => [r.md, c.d[i]]), name: c.name })));
                lines = [[S.clrB, '#ff9f1c', 'build ' + S.clrB + ' m'], [S.clrL, '#ff4c4c', 'lateral ' + S.clrL + ' m']];
                const mx = Math.max(...S.near.map(x => x.d).filter(isFinite), S.clrL); y1 = Math.min(Math.max(30, Math.ceil(mx / 10) * 10), Math.max(60, S.clrL * 4));
            } else {
                if(!S.sf){ box.innerHTML = head + `<div style="padding:20px 0;">${S.sfErr ? '<span style="color:#ff4c4c;">' + S.sfErr + '</span>' : '<button type="button" class="wbt-btn" data-pfsfrun>&#9888; Compute SF vs the 3 closest wells</button> <span style="color:var(--wbt-text-dim,#8aa);">(ISCWSA, same as the Anti-collision Plots — may take a few seconds)</span>'}</div>`;
                    box.querySelectorAll('[data-pfsv]').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.pfsv; wbtPfSep(box, read); }));
                    const rb = box.querySelector('[data-pfsfrun]'); if(rb) rb.addEventListener('click', async () => { rb.disabled = true; rb.textContent = 'Computing…'; await new Promise(r => setTimeout(r, 20)); try { await wbtPfRunSf(); } catch(err){ S.sfErr = err.message; } wbtPfSep(box, read); });
                    return; }
                series = S.sf.filter(x => x.prof).map(x => ({ color: x.c.color, w: 1.6, pts: x.prof.filter(p => p.sf != null && isFinite(p.sf)).map(p => [p.md, Math.min(p.sf, 20)]), name: x.c.name + (x.real ? '' : ' (simplified)') }));
                lines = [[1.0, '#ff4c4c', 'SF 1.0'], [1.25, '#ff9f1c', 'SF 1.25']];
                const mx = Math.max(2, ...series.map(sr => Math.min(...sr.pts.map(p => p[1])))); y1 = Math.min(20, Math.max(5, Math.ceil(mx * 3)));
            }
            const x0 = mdMin, x1 = mdMax > mdMin ? mdMax : mdMin + 1, y0 = 0;
            const sx = v => L + (v - x0) / (x1 - x0) * (W - L - R), sy = v => T + (1 - (Math.min(v, y1) - y0) / (y1 - y0)) * (H - T - B);
            const nice = (a, b, k) => { const raw = (b - a) / k, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(q => q * mag).find(q => q >= raw) || raw; const o = []; for(let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) o.push(+v.toFixed(6)); return o; };
            const grid = 'var(--wbt-border,#1e2d3d)', txt = 'var(--wbt-text-dim,#8aa)';
            let svg = `<svg width="${W}" height="${H}" style="display:block;">`;
            nice(x0, x1, 6).forEach(v => { svg += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" stroke="${grid}"/><text x="${sx(v)}" y="${H - B + 13}" fill="${txt}" font-size="10" text-anchor="middle">${v}</text>`; });
            nice(y0, y1, 5).forEach(v => { svg += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="${grid}"/><text x="${L - 4}" y="${sy(v) + 3}" fill="${txt}" font-size="10" text-anchor="end">${v}</text>`; });
            lines.forEach(([v, c, lab]) => { if(v <= y1) svg += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="${c}" stroke-dasharray="6 3"/><text x="${W - R - 2}" y="${sy(v) - 3}" fill="${c}" font-size="9" text-anchor="end">${lab}</text>`; });
            svg += `<text x="${(L + W - R) / 2}" y="${H - 2}" fill="${txt}" font-size="10" text-anchor="middle">MD (m) — ${String(wbtPf.wells[0].name).replace(/</g,'&lt;')}</text><text x="10" y="${(T + H - B) / 2}" fill="${txt}" font-size="10" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">${S.view === 'c2c' ? 'C2C (m)' : 'SF'}</text>`;
            series.forEach(sr => { const pts = sr.pts.filter(p => isFinite(p[1])); if(pts.length > 1) svg += `<polyline points="${pts.map(p => sx(p[0]) + ',' + sy(p[1])).join(' ')}" fill="none" stroke="${sr.color}" stroke-width="${sr.w}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''}/>`; });
            svg += `<line data-pfx x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#ffffff" stroke-opacity="0.5" stroke-dasharray="3 3" style="display:none;"/></svg>`;
            box.innerHTML = head + svg;
            box.querySelectorAll('[data-pfsv]').forEach(b => b.addEventListener('click', () => { S.view = b.dataset.pfsv; wbtPfSep(box, read); }));
            const sv = box.querySelector('svg'), vl = box.querySelector('[data-pfx]');
            sv.addEventListener('mousemove', e => {
                const rb = sv.getBoundingClientRect(), x = e.clientX - rb.left; if(x < L || x > W - R){ vl.style.display = 'none'; return; }
                const md = x0 + (x - L) / (W - L - R) * (x1 - x0); vl.setAttribute('x1', x); vl.setAttribute('x2', x); vl.style.display = '';
                let bi = 0, bd = Infinity; S.rows.forEach((r, i) => { const d = Math.abs(r.md - md); if(d < bd){ bd = d; bi = i; } });
                const r = S.rows[bi];
                if(S.view === 'c2c') read.innerHTML = `MD ${r.md.toFixed(1)} · nearest <b>${String(S.near[bi].who).replace(/</g,'&lt;')}</b> ${isFinite(S.near[bi].d) ? S.near[bi].d.toFixed(2) + ' m' : '—'}` + S.top.map(c => ` · <span style="color:${c.color};">${String(c.name).replace(/</g,'&lt;')} ${isFinite(c.d[bi]) ? c.d[bi].toFixed(1) : '—'}</span>`).join('');
                else read.innerHTML = `MD ${r.md.toFixed(1)}` + (S.sf || []).map(x => { if(!x.prof) return ` · ${String(x.c.name).replace(/</g,'&lt;')}: ${x.err}`; let pb = null, pd = Infinity; x.prof.forEach(p => { const d = Math.abs(p.md - md); if(d < pd){ pd = d; pb = p; } });
                    return ` · <span style="color:${x.c.color};">${String(x.c.name).replace(/</g,'&lt;')}</span> SF <b>${pb && pb.sf != null ? (+pb.sf).toFixed(2) : '—'}</b> (C2C ${pb ? (+pb.c2c).toFixed(1) : '—'} m)`; }).join('');
                wbtPfSphere(r, wbtPf.wells[0].color);
            });
            sv.addEventListener('mouseleave', () => { vl.style.display = 'none'; wbtPfSphere(null); });
        }
        // planned / offset survey rows -> profile rows
        function wbtPfRowsFromSurvey(survey){ return (survey || []).map(r => ({ md: num(r.md), inc: num(r.incl), az: num(r.azim), tvd: num(r.tvd), ss: wbtYOf(r), dls: num(r.dogleg), n: num(r.northing), e: num(r.easting), comment: r.comments || '' })); }
        function wbtInitTooltip(){
            wbtTooltipEl = document.createElement('div');
            Object.assign(wbtTooltipEl.style, {
                position: 'fixed',
                background: 'rgba(10,14,20,0.95)',
                border: '1px solid #1e2d3d',
                borderRadius: '4px',
                padding: '8px 10px',
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: '11px',
                color: '#c8d8e8',
                pointerEvents: 'none',
                display: 'none',
                zIndex: '9999',
                maxWidth: '240px',
                lineHeight: '1.6',
                backdropFilter: 'blur(4px)',
            });
            document.body.appendChild(wbtTooltipEl);

            wbtRaycaster = new THREE.Raycaster();
            wbtRaycaster.params.Line = { threshold: 2 };

            const canvas = document.getElementById('wbtViewer');
            canvas.addEventListener('mousemove', wbtOnMouseMove);
            canvas.addEventListener('mouseleave', () => { wbtTooltipEl.style.display = 'none'; });
        }

        function wbtShowTooltip(html, clientX, clientY){
            wbtTooltipEl.innerHTML = html;
            wbtTooltipEl.style.display = 'block';
            const tw = wbtTooltipEl.offsetWidth, th = wbtTooltipEl.offsetHeight;
            let x = clientX + 14, y = clientY - 10;
            if(x + tw > window.innerWidth)  x = clientX - tw - 14;
            if(y + th > window.innerHeight) y = clientY - th - 10;
            wbtTooltipEl.style.left = x + 'px';
            wbtTooltipEl.style.top  = y + 'px';
        }

        function wbtFmtN(v, d){ return (v===null||v===undefined||isNaN(v)) ? '-' : Number(v).toFixed(d!==undefined?d:2); }

        function wbtFindClosestStation(survey, worldPos){
            // Find survey station whose 3D world position is closest to worldPos
            let best = null, bestDist = Infinity;
            survey.forEach(row => {
                const east  = num(row.easting  || row.localE || 0);
                const tvd   = num(row.tvd || 0);
                const north = num(row.northing || row.localN || 0);
                const wx = east, wy = wbtYOf(row), wz = -north;   // 2026-10-21: Sub-Sea
                const dx = wx - worldPos.x, dy = wy - worldPos.y, dz = wz - worldPos.z;
                const d = dx*dx + dy*dy + dz*dz;
                if(d < bestDist){ bestDist = d; best = row; }
            });
            return best;
        }

        function wbtOnMouseMove(e){
            const canvas = document.getElementById('wbtViewer');
            const rect = canvas.getBoundingClientRect();
            wbtMouseVec.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
            wbtMouseVec.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

            wbtRaycaster.setFromCamera(wbtMouseVec, camera);

            // 1. Check marker spheres first (highest priority)
            const markerMeshes = wbtMarkerData.map(m => m.mesh);
            if(markerMeshes.length > 0){
                const mHits = wbtRaycaster.intersectObjects(markerMeshes);
                if(mHits.length > 0){
                    const hit = mHits[0].object;
                    wbtShowTooltip(
                        `<span style="color:#ffd060;font-family:var(--wbt-cond,sans-serif);letter-spacing:1px;text-transform:uppercase">${hit.userData.label}</span><br>` +
                        `MD: <b>${wbtFmtN(hit.userData.md,2)} m</b><br>` +
                        `TVD: <b>${wbtFmtN(hit.userData.tvd,2)} m</b><br>` +
                        (hit.userData.subSea ? `TVDss: <b>${wbtFmtN(hit.userData.subSea,2)} m</b>` : ''),
                        e.clientX, e.clientY
                    );
                    return;
                }
            }

            // 2. Check tube meshes
            const tubeMeshes = wbtTubeMeshData.map(t => t.mesh);
            if(tubeMeshes.length > 0){
                const hits = wbtRaycaster.intersectObjects(tubeMeshes);
                if(hits.length > 0){
                    const hitMesh = hits[0].object;
                    const hitPoint = hits[0].point;
                    const td = wbtTubeMeshData.find(t => t.mesh === hitMesh);
                    if(td && td.survey){
                        const st = wbtFindClosestStation(td.survey, hitPoint);
                        if(st){
                            wbtShowTooltip(
                                `<span style="color:${td.colorHex || '#00c8ff'};font-family:var(--wbt-cond,sans-serif);font-size:10px;letter-spacing:1px;text-transform:uppercase">${td.name}</span><br>` +
                                `MD: <b>${wbtFmtN(st.md,2)} m</b><br>` +
                                `Incl: <b>${wbtFmtN(st.incl,2)}°</b> &nbsp; Azim: <b>${wbtFmtN(st.azim,2)}°</b><br>` +
                                `TVD: <b>${wbtFmtN(st.tvd,2)} m</b> &nbsp; TVDss: <b>${wbtFmtN(st.subSea,2)} m</b><br>` +
                                `DLS: <b>${wbtFmtN(st.dogleg,3)}</b><br>` +
                                `N: <b>${wbtFmtN(st.northing,2)}</b> &nbsp; E: <b>${wbtFmtN(st.easting,2)}</b>`,
                                e.clientX, e.clientY
                            );
                            return;
                        }
                    }
                }
            }

            // 3. Check formation invisible planes
            if(wbtFormPlaneData.length > 0){
                const planeMeshes = wbtFormPlaneData.map(p => p.mesh);
                const pHits = wbtRaycaster.intersectObjects(planeMeshes);
                if(pHits.length > 0){
                    const pd = wbtFormPlaneData.find(p => p.mesh === pHits[0].object);
                    if(pd && pd.visible){
                        wbtShowTooltip(
                            `<span style="color:#39ff14;font-family:var(--wbt-cond,sans-serif);letter-spacing:1px;text-transform:uppercase">Formation</span><br>` +
                            `<b>${pd.name}</b><br>` +
                            `TVD: <b>${wbtFmtN(pd.tvd,2)} m</b><br>` +
                            `TVDss: <b>${wbtFmtN(pd.subSea,2)} m</b>`,
                            e.clientX, e.clientY
                        );
                        return;
                    }
                }
            }

            wbtTooltipEl.style.display = 'none';
        }

        // ================================================================
        // INVISIBLE PLANES FOR FORMATION RAYCASTING
        // ================================================================
        // A large transparent PlaneGeometry at each formation's Y level.
        // Only responds to raycasting when the formation mesh is visible.

        function wbtBuildInvisiblePlane(tvd, bbox, formationEntry){
            const cx = (bbox.min.x + bbox.max.x) / 2;
            const cz = (bbox.min.z + bbox.max.z) / 2;
            const sx = (bbox.max.x - bbox.min.x) * 1.2 || 200;
            const sz = (bbox.max.z - bbox.min.z) * 1.2 || 200;

            const geo = new THREE.PlaneGeometry(sx, sz);
            const mat = new THREE.MeshBasicMaterial({
                visible: false,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(cx, tvd, cz);   // 2026-10-21: caller now passes the Sub-Sea elevation (Y) here
            group.add(mesh);

            // Compute TVDss: use subSea of closest survey station in first wellbore
            // We store it on wbtFormPlaneData at build time
            return mesh;
        }

        // ================================================================
        // GEOLOGICAL FORMATIONS
        // ================================================================
        // Formations are detected from the Comments column of the FIRST
        // wellbore in the loaded list (UI order). Any comment that does NOT
        // contain one of the reserved keywords below is treated as a
        // geological formation name. All non-empty comments are included in
        // the show/hide list so the user can optionally reveal any entry.
        //
        // Reserved keywords (case-insensitive, substring match):
        const WBT_RESERVED_KEYWORDS = ['SURFACECASING','KICKOFF','INTERMEDIATECASING','LANDING','STK','START TANG','END TANG'];
        // TD is the last point - no comment needed; any unique remaining
        // comments that survive keyword filtering are classified as formations.
        //
        // Each formation mesh is a horizontal flat grid at Y = -TVD,
        // spanning the overall pad bounding box (same as curtain extents),
        // rendered as thin LineSegments in neon-green (#39ff14) at low opacity.

        let wbtFormationGroup = new THREE.Group(); // parent for all formation meshes
        let wbtFormations = [];  // [{name, tvd, mesh, visible}]
        let wbtPadBBox = null;   // THREE.Box3 of all well points — set in loadWellbores/loadFiles

        function wbtIsReservedComment(comment){
            const upper = (comment || '').toUpperCase().trim();
            if(!upper) return true; // empty → skip
            return WBT_RESERVED_KEYWORDS.some(k => upper.includes(k));
        }

        // Build a flat horizontal grid mesh at world Y = -tvd,
        // spanning xMin→xMax (Easting) and zMin→zMax (-Northing).
        // Returns a THREE.LineSegments object.
        // Formation grid-mesh density (lines per axis), driven by the
        // "Mesh Density" slider. Rebuilding the meshes is cheap (they're
        // just line segments), so the slider regenerates them live.
        var wbtFormationDensity = 60; // matches the slider's default (max density)

        function wbtBuildFormationMesh(tvd, bbox){
            const xMin = bbox.min.x, xMax = bbox.max.x;
            const zMin = bbox.min.z, zMax = bbox.max.z;
            const y    = tvd;   // 2026-10-21: caller now passes the Sub-Sea elevation (Y)

            const xRange = xMax - xMin || 100;
            const zRange = zMax - zMin || 100;

            const LINES = wbtFormationDensity;
            const xStep = xRange / LINES;
            const zStep = zRange / LINES;

            const positions = [];

            // Lines parallel to Z axis (varying X)
            for(let i = 0; i <= LINES; i++){
                const x = xMin + i * xStep;
                positions.push(x, y, zMin,  x, y, zMax);
            }
            // Lines parallel to X axis (varying Z)
            for(let j = 0; j <= LINES; j++){
                const z = zMin + j * zStep;
                positions.push(xMin, y, z,  xMax, y, z);
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

            const mat = new THREE.LineBasicMaterial({
                color: 0x39ff14,
                transparent: true,
                opacity: 0.18,
            });

            return new THREE.LineSegments(geo, mat);
        }

        // Extract formations from the first wellbore's survey comments.
        // survey: array of {comments, tvd} (raw CSV rows or db-keyed objects).
        // commentKey / tvdKey: field names (differ between edit-note raw CSV and job DB rows)
        function wbtExtractFormations(survey, commentKey, tvdKey){
            const seen = {};
            const result = [];
            (survey || []).forEach(row => {
                const raw = (row[commentKey] || '').trim();
                if(!raw) return;
                // Normalise: strip trailing " - <repeat>" e.g. "sKOP - sKOP" → "sKOP"
                let name = raw.replace(/\s*-\s*\S*$/, '').trim() || raw;
                // Deduplicate by normalised name
                const key = name.toUpperCase();
                if(seen[key]) return;
                seen[key] = true;
                const tvd = parseFloat(row[tvdKey]) || 0;
                const isFormation = !wbtIsReservedComment(name);
                result.push({ name, tvd, y: wbtYOf(row), isFormation });   // 2026-10-21: y = Sub-Sea elevation for placement
            });
            return result;
        }

        // Build/rebuild all formation meshes from the allComments list.
        // allComments: [{name, tvd, isFormation}]
        // Only entries where isFormation===true get a horizontal mesh,
        // but ALL entries appear in the show/hide panel (user decides).
        function wbtBuildFormations(allComments, bbox, firstSurvey){
            // Remove old meshes and invisible planes
            wbtFormations.forEach(f => {
                if(f.mesh) wbtFormationGroup.remove(f.mesh);
                if(f.planeMesh) group.remove(f.planeMesh);
            });
            wbtFormations = [];
            wbtFormPlaneData = [];

            // allComments is walked in MD order (shallow -> deep), so the
            // LAST isFormation:true entry is the deepest formation — shown
            // by default since it's usually the one people want to check
            // first (e.g. the target/landing formation).
            let lastFormationIdx = -1;
            allComments.forEach((entry, i) => { if(entry.isFormation) lastFormationIdx = i; });

            allComments.forEach((entry, i) => {
                let mesh = null, planeMesh = null;
                const defaultVisible = (i === lastFormationIdx);

                // Compute TVDss: find closest survey station by TVD
                let subSea = 0;
                if(firstSurvey && firstSurvey.length > 0){
                    // subSea from the station matching this comment, or closest TVD
                    const matchRow = firstSurvey.find(r => {
                        const raw = (r.comments || r.Comments || '').trim();
                        const name = raw.replace(/\s*-\s*\S*$/, '').trim() || raw;
                        return name.toUpperCase() === entry.name.toUpperCase();
                    });
                    if(matchRow) subSea = num(matchRow.subSea || matchRow['Sub-Sea'] || 0);
                }

                if(entry.isFormation && bbox){
                    mesh = wbtBuildFormationMesh(entry.y, bbox);
                    mesh.visible = defaultVisible;
                    wbtFormationGroup.add(mesh);

                    // Invisible plane for raycasting tooltip
                    planeMesh = wbtBuildInvisiblePlane(entry.y, bbox, entry);
                    wbtFormPlaneData.push({
                        mesh: planeMesh, name: entry.name, tvd: entry.tvd, subSea,
                        get visible(){ return mesh.visible; }
                    });
                }
                wbtFormations.push({ ...entry, mesh, planeMesh, visible: defaultVisible, subSea });
            });

            wbtBuildFormationListUI();
        }

        function wbtBuildFormationListUI(){
            const container = document.getElementById('wbtFormationList');
            if(!container) return;
            container.innerHTML = '';

            if(wbtFormations.length === 0){
                container.innerHTML = '<div style="color:var(--wbt-text-dim);font-family:var(--wbt-mono);font-size:10px">No formations detected</div>';
                return;
            }

            wbtFormations.forEach((f, idx) => {
                const item = document.createElement('div');
                item.className = 'wbt-fm-item';

                const label = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = f.visible; // last (deepest) formation on by default, rest off
                cb.addEventListener('change', () => {
                    wbtFormations[idx].visible = cb.checked;
                    if(f.mesh) f.mesh.visible = cb.checked;
                });

                const dot = document.createElement('span');
                dot.className = 'wbt-fm-dot';
                // Non-formation comments get a grey dot
                if(!f.isFormation) dot.style.background = '#5a7080';

                label.appendChild(cb);
                label.appendChild(dot);
                label.appendChild(document.createTextNode(
                    f.name + (f.isFormation ? '' : '') +
                    ' (' + (f.tvd || 0).toFixed(1) + 'm)'
                ));
                item.appendChild(label);
                container.appendChild(item);
            });
        }

        // ADDED 2026-10-10: minimal handle for the iPlan script (below) to draw
        // its green scenario tubes in this same scene, with the same tube
        // builder and line-thickness factor as the planned wells. iPlan never
        // touches wellsData/WELLBORES, so score cards and tables are unaffected.
        window.wbtSceneApi = {
            WELLBORES,
            getGroup: () => group,
            buildWellLine,
            // CHANGED 2026-10-11: scenario thickness = Scenarios slider, or that scenario's individual override
            getThickness: (scenarioId) => wbtThicknessForScenario(scenarioId)
        };

        initScene();

        window.addEventListener('mtxThemeChange', function(e){
            if(scene) scene.background = new THREE.Color(e.detail.light ? 0xffffff : 0x0a0e14);
        });
    })();
    
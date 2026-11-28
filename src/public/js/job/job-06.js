/* MTX Conveyor — job page script 6. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 8964) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

    (function(){
        const api = window.wbtSceneApi, head = document.getElementById('ilabHead'), body = document.getElementById('ilabBody');
        if(!api || !head || !body || !window.THREE) return;
        const num = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const f = (v, d) => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d);
        const MAX_CELLS = 80e6, MAX_SHOW = 150000;
        const KIND = { offset:{ bit:1, lbl:'Offset wells', col:0xff3030, def:true }, subject:{ bit:2, lbl:'Subject wells', col:0x3f8cff, def:true },
                       scenario:{ bit:4, lbl:'iPlan scenarios', col:0x00e676, def:false }, ipad:{ bit:8, lbl:'iPad previews', col:0xffd060, def:false } };
        const L = { cell:10, half:2000, clear:10, top:null, bot:null, center:null, ticks:{}, grid:null, mesh:null, frame:null, show:true, showTop:null, showBot:null };
        window.ILAB = L;

        // Subject/offset rule = the 3D viewer's (wellCategory tag, else the [NN]..._LNN name pattern).
        function isSubj(w){ const wn = (w.wellName || '').trim(); if(w.wellCategory === 'subject') return true; if(w.wellCategory === 'offset') return false; return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn); }
        // Every trajectory loaded in the job: {key, kind, name, pts:[{md,n,e,ss}]}, ss = Sub-Sea elevation (m, +up), as the 3D scene.
        function sources(){
            const out = [];
            (api.WELLBORES || []).forEach((w, i) => {
                const s = (w.survey || []).filter(r => isFinite(parseFloat(r.md))); if(s.length < 2) return;
                const pts = s.map(r => ({ md: num(r.md), n: num(r.northing), e: num(r.easting), ss: r._ss != null ? r._ss : -num(r.tvd) })), r0 = s[0];
                out.push({ key: 'w' + i, kind: isSubj(w) ? 'subject' : 'offset', name: w.wellName || ('well ' + (i + 1)), pts, wellId: w._id ? String(w._id) : null,
                    start: { md: num(r0.md), tvd: num(r0.tvd), n: num(r0.northing), e: num(r0.easting), inc: num(r0.incl), az: num(r0.azim), rkb: pts[0].ss + num(r0.tvd) } });
            });
            (window.IPLAN_SCENARIOS || []).forEach(sc => {
                const st = (sc._calc && !sc._calc.error && sc._calc.stations) || []; if(st.length < 2) return;
                out.push({ key: 's' + sc.id, kind: 'scenario', name: sc.name || 'Scenario', pts: st.map(s => ({ md: s.md, n: s.n, e: s.e, ss: s.subSea })), wellId: sc.wellId || null,
                    start: { md: st[0].md, tvd: st[0].tvd, n: st[0].n, e: st[0].e, inc: st[0].inc, az: st[0].az, rkb: st[0].subSea + st[0].tvd } });
            });
            const seen = {};
            api.getGroup().traverse(o => {
                const nm = o.userData && o.userData.pickName || '';
                if(!/\(iPad preview\)$/.test(nm) || typeof o.userData.pick !== 'function' || seen[nm]) return;
                let p = null; try { p = o.userData.pick(); } catch(e){ return; }
                if(!p || !p.rows || p.rows.length < 2) return; seen[nm] = 1;
                out.push({ key: 'p' + nm, kind: 'ipad', name: nm.replace(/ \(iPad preview\)$/, ''), pts: p.rows.map(r => ({ md: r.md, n: r.n, e: r.e, ss: r.ss })) });
            });
            return out;
        }
        function centerList(src){ return src.filter(s => s.kind === 'scenario').concat(src.filter(s => s.kind === 'subject')); }

        function render(){
            const src = sources(), cl = centerList(src);
            if(!L.center || !cl.some(s => s.key === L.center)){
                const sel = window.IPLAN_SELECTED_ID ? window.IPLAN_SELECTED_ID() : null;
                L.center = (cl.find(s => s.key === 's' + sel) || cl[0] || {}).key || null;
            }
            src.forEach(s => { if(!(s.key in L.ticks)) L.ticks[s.key] = KIND[s.kind].def; });
            const cols = Object.keys(KIND).map(k => {
                const items = src.filter(s => s.kind === k);
                return `<div style="min-width:180px;flex:1;"><div style="font-weight:700;margin-bottom:3px;"><span style="display:inline-block;width:10px;height:10px;background:#${KIND[k].col.toString(16).padStart(6,'0')};margin-right:4px;"></span>${KIND[k].lbl} (${items.length})
                    <a href="#" data-all="${k}" style="font-weight:400;margin-left:6px;">all</a> <a href="#" data-none="${k}" style="font-weight:400;">none</a></div>
                    <div style="max-height:150px;overflow:auto;">${items.map(s => `<label style="display:block;white-space:nowrap;${s.key === L.center ? 'opacity:.45;' : ''}"><input type="checkbox" data-tk="${esc(s.key)}" ${L.ticks[s.key] ? 'checked' : ''} ${s.key === L.center ? 'disabled title="Subject well of the grid (never an obstacle)"' : ''}> ${esc(s.name)}</label>`).join('') || '<span style="color:var(--wbt-text-dim);">none loaded</span>'}</div></div>`;
            }).join('');
            const g = L.grid;
            body.innerHTML = `<div style="font-size:11px;color:#ffb74d;margin-bottom:6px;">EXPERIMENTAL (admin only). Phase 1: occupancy grid. Nothing here is saved or changes other modules.</div>
                <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;font-size:12px;">
                    <label>Subject (grid centre = its surface)<br><select data-k="center" style="max-width:260px;">${cl.map(s => `<option value="${esc(s.key)}" ${s.key === L.center ? 'selected' : ''}>${esc(s.name)}${s.kind === 'scenario' ? ' (scenario)' : ''}</option>`).join('')}</select></label>
                    <label>Cube side (m)<br><input type="number" data-k="cell" value="${L.cell}" min="1" step="any" style="width:70px;"></label>
                    <label>Half-width ± (m)<br><input type="number" data-k="half" value="${L.half}" min="1" step="any" style="width:80px;"></label>
                    <label title="A cube is occupied when its centre is within this distance of a ticked trajectory">Clearance (m)<br><input type="number" data-k="clear" value="${L.clear}" min="0" step="any" style="width:70px;"></label>
                    <label title="Blank = surface of the subject">Top Sub-Sea (m)<br><input type="number" data-k="top" value="${L.top == null ? '' : L.top}" placeholder="auto" step="any" style="width:80px;"></label>
                    <label title="Blank = deepest Sub-Sea of the subject and ticked trajectories inside the area">Bottom Sub-Sea (m)<br><input type="number" data-k="bot" value="${L.bot == null ? '' : L.bot}" placeholder="auto" step="any" style="width:80px;"></label>
                    <button type="button" class="wbt-btn" data-build>Build grid</button>
                    <button type="button" class="wbt-btn" data-clear>Clear</button>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px;">${cols}</div>
                <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px;font-size:12px;">
                    <label><input type="checkbox" data-show ${L.show ? 'checked' : ''}> Show occupied cubes in 3D</label>
                    <label>Show Sub-Sea from<br><input type="number" data-k="showTop" value="${L.showTop == null ? '' : L.showTop}" placeholder="top" step="any" style="width:80px;"></label>
                    <label>to<br><input type="number" data-k="showBot" value="${L.showBot == null ? '' : L.showBot}" placeholder="bottom" step="any" style="width:80px;"></label>
                    <button type="button" class="wbt-btn" data-redraw>Redraw</button>
                </div>
                <div data-out style="font-family:var(--wbt-mono,monospace);font-size:11px;margin-top:8px;white-space:pre-wrap;">${g ? esc(g.info) : 'No grid yet.'}</div>
                ${renderPaths()}`;
            const numOrNull = v => (String(v).trim() === '' || !isFinite(parseFloat(v))) ? null : parseFloat(v);
            body.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
                const k = el.dataset.k;
                if(k === 'center'){ L.center = el.value; render(); return; }
                if(k === 'top' || k === 'bot' || k === 'showTop' || k === 'showBot') L[k] = numOrNull(el.value);
                else { const v = parseFloat(el.value); if(isFinite(v) && v > (k === 'clear' ? -1e-9 : 0)) L[k] = v; else el.value = L[k]; }
            }));
            body.querySelectorAll('[data-tk]').forEach(el => el.addEventListener('change', () => { L.ticks[el.dataset.tk] = el.checked; }));
            body.querySelectorAll('[data-all],[data-none]').forEach(a => a.addEventListener('click', e => {
                e.preventDefault(); const k = a.dataset.all || a.dataset.none, on = !!a.dataset.all;
                src.filter(s => s.kind === k).forEach(s => { L.ticks[s.key] = on; }); render(); }));
            body.querySelector('[data-build]').addEventListener('click', () => { build(); render(); });
            body.querySelector('[data-clear]').addEventListener('click', () => { clear3D(); L.grid = null; render(); });
            body.querySelector('[data-show]').addEventListener('change', e => { L.show = e.target.checked; draw(); });
            body.querySelector('[data-redraw]').addEventListener('click', () => { draw(); render(); });
            wirePaths();
        }

        // ---------- grid ----------
        // Cell (i, j, k): i along Easting, j along Northing, k down from the top. Index = (k*ny + j)*nx + i.
        // Centre: E = x0 + (i+0.5)c, N = y0 + (j+0.5)c, SS = top - (k+0.5)c. occ[idx] = OR of KIND bits of the
        // trajectories within the clearance (so the cube colour shows what blocks it).
        // Distance from the point a + t*(dx,dy,dz), t in [0,1], to an axis-aligned box: the point-to-box distance is
        // convex and t -> point is affine, so the composition is convex in t -> golden-section search finds its minimum.
        function segBoxDist(a, dx, dy, dz, xa, xb, ya, yb, za, zb){
            const D = t => { const x = a.e + t * dx, y = a.n + t * dy, z = a.ss + t * dz;
                const ex = x < xa ? xa - x : x > xb ? x - xb : 0, ey = y < ya ? ya - y : y > yb ? y - yb : 0, ez = z < za ? za - z : z > zb ? z - zb : 0;
                return Math.sqrt(ex * ex + ey * ey + ez * ez); };
            const G = 0.6180339887498949; let lo = 0, hi = 1, m1 = hi - G * (hi - lo), m2 = lo + G * (hi - lo), f1 = D(m1), f2 = D(m2);
            for(let it = 0; it < 40; it++){ if(f1 <= f2){ hi = m2; m2 = m1; f2 = f1; m1 = hi - G * (hi - lo); f1 = D(m1); } else { lo = m1; m1 = m2; f1 = f2; m2 = lo + G * (hi - lo); f2 = D(m2); } }
            return Math.min(f1, f2, D(0), D(1));
        }
        // Spatial hash of the obstacle segments (cell H >= query radius) -> nearest distance per trajectory near a point.
        function segIndex(list, H){
            const M = new Map(), K = (a, b, c) => a + ',' + b + ',' + c, fl = Math.floor;
            list.forEach(sg => { const a = sg.a, b = sg.b;
                for(let x = fl(Math.min(a.e, b.e) / H); x <= fl(Math.max(a.e, b.e) / H); x++) for(let y = fl(Math.min(a.n, b.n) / H); y <= fl(Math.max(a.n, b.n) / H); y++)
                    for(let z = fl(Math.min(a.ss, b.ss) / H); z <= fl(Math.max(a.ss, b.ss) / H); z++){ const k = K(x, y, z); if(!M.has(k)) M.set(k, []); M.get(k).push(sg); } });
            // returns Map(trajectory index -> distance) for trajectories within H of (n, e, ss)
            const near = (n, e, ss) => { const cx = fl(e / H), cy = fl(n / H), cz = fl(ss / H), out = new Map();
                for(let x = cx - 1; x <= cx + 1; x++) for(let y = cy - 1; y <= cy + 1; y++) for(let z = cz - 1; z <= cz + 1; z++){ const L2 = M.get(K(x, y, z)); if(!L2) continue;
                    for(const sg of L2){ const a = sg.a, b = sg.b, dx = b.e - a.e, dy = b.n - a.n, dz = b.ss - a.ss, LL = dx * dx + dy * dy + dz * dz;
                        let t = LL > 0 ? ((e - a.e) * dx + (n - a.n) * dy + (ss - a.ss) * dz) / LL : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
                        const d = Math.hypot(a.e + t * dx - e, a.n + t * dy - n, a.ss + t * dz - ss);
                        if(d <= H && (!out.has(sg.oi) || d < out.get(sg.oi))) out.set(sg.oi, d); } }
                return out; };
            return { H, near };
        }
        function build(){
            const src = sources(), cs = src.find(s => s.key === L.center), out = m => { L.grid = { info: m }; };
            clear3D();
            if(!cs){ out('Pick a subject (an iPlan scenario or a subject well).'); return; }
            const c = L.cell, h = L.half, cE = cs.pts[0].e, cN = cs.pts[0].n;
            const nx = Math.ceil(2 * h / c), ny = nx, x0 = cE - nx * c / 2, y0 = cN - ny * c / 2;
            const obst = src.filter(s => s.key !== L.center && L.ticks[s.key]);
            const inArea = p => p.e >= x0 && p.e <= x0 + nx * c && p.n >= y0 && p.n <= y0 + ny * c;
            const top = L.top != null ? L.top : cs.pts[0].ss;
            let deep = Math.min.apply(null, cs.pts.map(p => p.ss));
            obst.forEach(s => s.pts.forEach(p => { if(inArea(p) && p.ss < deep) deep = p.ss; }));
            const bot = L.bot != null ? L.bot : deep;
            if(!(top > bot)){ out('Top Sub-Sea must be above Bottom Sub-Sea.'); return; }
            const nz = Math.ceil((top - bot) / c), total = nx * ny * nz;
            if(total > MAX_CELLS){ out(`Too many cubes: ${nx} x ${ny} x ${nz} = ${(total / 1e6).toFixed(1)} million (limit ${MAX_CELLS / 1e6} million). Increase the cube side or reduce the half-width / depth.`); return; }
            const t0 = performance.now(), occ = new Uint8Array(total), r = L.clear, r2 = r * r, hd = c * Math.sqrt(3) / 2, segList = [];
            let segs = 0;
            obst.forEach(s => {
                const bit = KIND[s.kind].bit;
                for(let q = 1; q < s.pts.length; q++){
                    const a = s.pts[q - 1], b = s.pts[q];
                    if(![a.e, a.n, a.ss, b.e, b.n, b.ss].every(isFinite)) continue;
                    // CHANGED 2026-11-09 (phase 3, John): a cube is occupied when ANY PART of it is within r of the segment
                    // (was: its CENTRE within r - then a path through a free cube was only guaranteed r - c*sqrt(3)/2 away,
                    // 1.3 m for 10 m cubes / 10 m clearance). Now any point in a free cube is > r from every ticked trajectory.
                    // Candidates: cells whose box meets the segment's bounding box grown by r.
                    const i0 = Math.max(0, Math.floor((Math.min(a.e, b.e) - r - x0) / c)), i1 = Math.min(nx - 1, Math.floor((Math.max(a.e, b.e) + r - x0) / c));
                    const j0 = Math.max(0, Math.floor((Math.min(a.n, b.n) - r - y0) / c)), j1 = Math.min(ny - 1, Math.floor((Math.max(a.n, b.n) + r - y0) / c));
                    const k0 = Math.max(0, Math.floor((top - Math.max(a.ss, b.ss) - r) / c)), k1 = Math.min(nz - 1, Math.floor((top - Math.min(a.ss, b.ss) + r) / c));
                    segList.push({ a, b, oi: obst.indexOf(s) });
                    if(i0 > i1 || j0 > j1 || k0 > k1) continue;
                    segs++;
                    const dx = b.e - a.e, dy = b.n - a.n, dz = b.ss - a.ss, LL = dx * dx + dy * dy + dz * dz;
                    for(let k = k0; k <= k1; k++){ const z = top - (k + 0.5) * c;
                        for(let j = j0; j <= j1; j++){ const y = y0 + (j + 0.5) * c, row = (k * ny + j) * nx;
                            for(let i = i0; i <= i1; i++){ const x = x0 + (i + 0.5) * c;
                                if(occ[row + i] & bit) continue;
                                // distance from the cube centre to segment a-b (closest point, parameter clamped to [0,1])
                                let t = LL > 0 ? ((x - a.e) * dx + (y - a.n) * dy + (z - a.ss) * dz) / LL : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
                                const ex = a.e + t * dx - x, ey = a.n + t * dy - y, ez = a.ss + t * dz - z, dc2 = ex * ex + ey * ey + ez * ez;
                                if(dc2 <= r2){ occ[row + i] |= bit; continue; }          // centre within r -> occupied
                                if(Math.sqrt(dc2) > r + hd) continue;                    // even the farthest corner is > r away -> free
                                // in between: exact distance segment-to-box (convex in t -> golden-section search)
                                if(segBoxDist(a, dx, dy, dz, x - c / 2, x + c / 2, y - c / 2, y + c / 2, z - c / 2, z + c / 2) <= r) occ[row + i] |= bit;
                            } } }
                }
            });
            let nOcc = 0; for(let q = 0; q < total; q++) if(occ[q]) nOcc++;
            const ms = performance.now() - t0;
            L.grid = { c, nx, ny, nz, x0, y0, top, bot: top - nz * c, occ, centerKey: L.center, centerName: cs.name, obstacles: obst.map(s => s.name), clear: r,
                segIdx: segIndex(segList, Math.max(10, r + 10)),
                info: `Subject: ${cs.name} · centre E ${f(cE, 2)} N ${f(cN, 2)} · surface SS ${f(cs.pts[0].ss, 2)}
Grid: ${nx} x ${ny} x ${nz} = ${total.toLocaleString()} cubes of ${c} m · E ${f(x0, 1)}..${f(x0 + nx * c, 1)} · N ${f(y0, 1)}..${f(y0 + ny * c, 1)} · SS ${f(top, 1)}..${f(top - nz * c, 1)}
Obstacles: ${obst.length} trajectories (${segs.toLocaleString()} segments in the area), clearance ${r} m (any part of a cube within it = occupied)
Occupied: ${nOcc.toLocaleString()} cubes (${f(100 * nOcc / total, 2)} %) · free ${(total - nOcc).toLocaleString()} · built in ${f(ms, 0)} ms` };
            draw();
        }

        // =================== PHASE 2: PATHS FROM SURFACE TO THE ICP (ADDED 2026-11-09) ===================
        // Hard rules (John 2026-11-09): (1) never touch an occupied cube (the path may not leave the grid either);
        // (2) DLS <= max DLS everywhere; (3) end ON the ICP with the dictated Inc and Az (the most important rule).
        // NO new drilling formulas - only existing IPlanCore functions:
        //  - computeStations: every station (minimum curvature, Bourgoyne ADE Eqs. 8.33-8.37; DLS+toolface Eqs. 8.41-8.49);
        //  - curve-hold-curve (chcNewton + chcCurveCL, the solver behind planCurveHoldCurve / Optimum Align 'chc' 'dls',
        //    both curves at the given DLS) = the connector to the ICP: same end position AND attitude by construction;
        //  - the tree = kinodynamic RRT (LaValle, "Rapidly-exploring random trees", lavalle.pl/rrt), as iPad Deep search
        //    (padDeepSearch): grows by 30 m 'dlstf' sections, DLS in [0, max], random toolface, best of 8 toward a sample;
        //  - shortcut smoothing (standard RRT post-processing, as padDeepSmooth): nodes i..j replaced by ONE curve-hold-curve
        //    (chc below) to node j's position AND attitude when it stays free.
        // Path = subject's first station -> hold (its attitude) to KOP MD -> tree -> connector.
        // Every option is RE-CHECKED independently before it is shown (stations every cube side / 10 m): every station in
        // a free cube inside the grid, every station DLS <= max + 0.001, end within 0.01 m of the ICP, end Inc and Az
        // within 0.01 deg. A path failing any check is dropped. (Between two stations 1 m apart a line can still clip the
        // corner of a cube by a few cm - the check is on the stations.)
        // HARD rule 4 (John): Inc <= ICP Inc on every station (no diving below and climbing back to the ICP).
        // Search heuristics, NOT drilling rules: samples between KOP and ICP depth, 10 %
        // at the ICP; options = paths whose max separation (sampled every 30 m) is > 3 cubes, shortest MD first.
        const C = window.IPlanCore;
        // ADDED 2026-11-09 (phase 3, John): two zones where occupied cubes are allowed, each with its own condition:
        //  - ESCAPE zone = start -> KOP + esc (m MD): may be inside the clearance of a trajectory but must never get CLOSER
        //    to it (distance to every trajectory closer than the clearance may never drop more than escTol below the largest
        //    distance reached so far to it - cumulative, not per station);
        //    starts at the surface because on a pad the slot itself is inside the neighbours' clearance.
        //  - ICP zone = the last icpZ m MD before the ICP: cubes ignored, but every station must be >= icpMin from every
        //    ticked trajectory (SAGD twin ~5 m over the last ~100 m).
        //  Distances = exact point-to-segment distances to the ticked trajectories (grid.segIdx), not cubes.
        // 2026-11-09 (John): ICP-zone min distance default 5 m (was 3); escape-zone tolerance = input escTol (default 0.05 m per
        // below the largest distance so far, was a fixed 1 mm per station) so a neighbour survey wandering a few mm toward a parallel hold does not fail the path.
        // ICP-zone min is compared with a 1 mm tolerance (a twin exactly 5.000 m away passes). Tree Inc <= ICP Inc stays
        // (John: a path may NOT come up from below to land under the twin).
        const P = { tgt: null, inc: null, az: null, kop: 150, dls: 6, nOpt: 6, secs: 20, esc: 100, escTol: 0.05, icpZ: 100, icpMin: 5, res: null, sel: 0, running: false, stop: false, msg: '', objs: [] };
        L.paths = P;   // debugging / tests: window.ILAB.paths.res
        function tgtList(){
            const out = [];
            (window.IPLAN_SCENARIOS || []).forEach(sc => (sc.targets || []).forEach((t, i) => out.push({ key: sc.id + '|' + i, name: (t.name || ('Target ' + (i + 1))) + ' — ' + (sc.name || 'Scenario'), t })));
            return out;
        }
        function renderPaths(){
            const tl = tgtList();
            if(!P.tgt || !tl.some(x => x.key === P.tgt)){ P.tgt = tl[0] ? tl[0].key : null; P.inc = P.az = null; }
            const tt = (tl.find(x => x.key === P.tgt) || {}).t;
            if(tt){ if(P.inc == null && isFinite(parseFloat(tt.inc))) P.inc = +tt.inc; if(P.az == null && isFinite(parseFloat(tt.az))) P.az = +tt.az; }
            const R = P.res;
            const rows = R && R.opts && R.opts.length ? R.opts.map((o, i) => `<tr data-opt="${i}" style="cursor:pointer;${i === P.sel ? 'background:rgba(0,229,255,.18);' : ''}">
                <td><input type="radio" name="ilabOpt" ${i === P.sel ? 'checked' : ''}></td><td>${i + 1}</td><td>${f(o.md, 1)}</td><td>${f(o.maxDls, 2)}</td><td>${o.dOut == null ? '&gt; ' + f(R.H, 0) : f(o.dOut, 1)}</td><td>${o.dEsc == null ? '&gt; ' + f(R.H, 0) : f(o.dEsc, 1)}</td><td>${o.dIcp == null ? '&gt; ' + f(R.H, 0) : f(o.dIcp, 1)}</td>
                <td>${o.secs.length}</td><td>${f(o.miss * 1000, 1)}</td><td>${f(o.endInc, 2)} / ${f(o.endAz, 2)}</td></tr>`).join('') : '';
            return `<div style="border-top:1px solid var(--wbt-border,#2a313c);margin-top:12px;padding-top:8px;">
                <div style="font-weight:700;color:#ffb74d;margin-bottom:4px;">Phase 2 — Paths from surface to ICP</div>
                <div style="font-size:11px;color:var(--wbt-text-dim);margin-bottom:6px;">Rules: Inc never above the ICP Inc · never enter an occupied cube (except: escape zone = surface → KOP + MD, never getting closer to any well; ICP zone = last MD before the ICP, never nearer than the min distance) · DLS ≤ max on every station · end exactly on the ICP with the Inc / Az below. Uses the grid built above (start = its subject; rebuild the grid after changing ticks).</div>
                <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;font-size:12px;">
                    <label>ICP (iPlan target)<br><select data-p="tgt" style="max-width:280px;">${tl.map(x => `<option value="${esc(x.key)}" ${x.key === P.tgt ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">no iPlan targets</option>'}</select></label>
                    <label>ICP Inc (°)<br><input type="number" data-p="inc" value="${P.inc == null ? '' : P.inc}" step="any" style="width:70px;"></label>
                    <label>ICP Az (°)<br><input type="number" data-p="az" value="${P.az == null ? '' : P.az}" step="any" style="width:70px;"></label>
                    <label>KOP MD (m)<br><input type="number" data-p="kop" value="${P.kop}" step="any" min="0" style="width:70px;"></label>
                    <label>Max DLS (°/30 m)<br><input type="number" data-p="dls" value="${P.dls}" step="any" min="0.1" style="width:70px;"></label>
                    <label title="From the start to KOP + this MD the path may be inside the clearance, but may never get closer to any trajectory">Escape zone: MD after KOP (m)<br><input type="number" data-p="esc" value="${P.esc}" step="any" min="0" style="width:80px;"></label>
                    <label title="In the escape zone the distance to a trajectory may never drop more than this below the largest distance reached so far">Escape tolerance (m)<br><input type="number" data-p="escTol" value="${P.escTol}" step="any" min="0" style="width:65px;"></label>
                    <label title="Over the last MD before the ICP cubes are ignored; every station must stay at least the min distance from every ticked trajectory">ICP zone: MD before ICP (m)<br><input type="number" data-p="icpZ" value="${P.icpZ}" step="any" min="0" style="width:80px;"></label>
                    <label>Min distance in ICP zone (m)<br><input type="number" data-p="icpMin" value="${P.icpMin}" step="any" min="0" style="width:70px;"></label>
                    <label>Options<br><input type="number" data-p="nOpt" value="${P.nOpt}" step="1" min="1" max="20" style="width:55px;"></label>
                    <label>Search time (s)<br><input type="number" data-p="secs" value="${P.secs}" step="1" min="2" max="300" style="width:60px;"></label>
                    <button type="button" class="wbt-btn" data-find ${P.running ? 'disabled' : ''}>${P.running ? 'Searching…' : 'Find paths'}</button>
                    ${P.running ? '<button type="button" class="wbt-btn" data-stop>Stop</button>' : ''}
                    <button type="button" class="wbt-btn" data-pclear>Clear paths</button>
                </div>
                ${tt ? `<div style="font-size:11px;margin-top:4px;color:var(--wbt-text-dim);">ICP: N ${f(+tt.n, 2)} · E ${f(+tt.e, 2)} · Sub-Sea ${f(+tt.ss, 2)}</div>` : ''}
                <div data-pmsg style="font-family:var(--wbt-mono,monospace);font-size:11px;margin-top:6px;white-space:pre-wrap;">${esc(P.msg)}</div>
                ${rows ? `<table style="font-size:12px;margin-top:6px;border-collapse:collapse;"><thead><tr><th></th><th>#</th><th>MD at ICP (m)</th><th>Max DLS</th><th title="Outside the two zones (always ≥ clearance)">Min dist to wells (m)</th><th>Min in escape zone</th><th>Min in ICP zone</th><th>Sections</th><th>Miss (mm)</th><th>End Inc / Az</th></tr></thead><tbody>${rows}</tbody></table>
                <div style="margin-top:6px;display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;"><label>Name <input type="text" data-pname value="iLab path ${P.sel + 1}" style="width:180px;"></label>
                    <button type="button" class="wbt-btn" data-create>Create iPlan scenario from #${P.sel + 1}</button><span data-cmsg></span></div>` : ''}
            </div>`;
        }
        function wirePaths(){
            body.querySelectorAll('[data-p]').forEach(el => el.addEventListener('change', () => {
                const k = el.dataset.p;
                if(k === 'tgt'){ P.tgt = el.value; P.inc = P.az = null; render(); return; }
                const v = parseFloat(el.value);
                if(k === 'inc' || k === 'az'){ P[k] = isFinite(v) ? v : null; return; }
                if(isFinite(v) && v >= ((k === 'kop' || k === 'esc' || k === 'escTol' || k === 'icpZ' || k === 'icpMin') ? 0 : 0.1)) P[k] = (k === 'nOpt' || k === 'secs') ? Math.round(v) : v; else el.value = P[k];
            }));
            const q = sel => body.querySelector(sel);
            if(q('[data-find]')) q('[data-find]').addEventListener('click', () => { if(!P.running) pathSearch(); });
            if(q('[data-stop]')) q('[data-stop]').addEventListener('click', () => { P.stop = true; });
            q('[data-pclear]').addEventListener('click', () => { P.res = null; P.msg = ''; clearPaths3D(); render(); });
            body.querySelectorAll('tr[data-opt]').forEach(tr => tr.addEventListener('click', () => { P.sel = +tr.dataset.opt; drawPaths(); render(); }));
            if(q('[data-create]')) q('[data-create]').addEventListener('click', async () => {
                const o = P.res && P.res.opts[P.sel], m = q('[data-cmsg]'); if(!o) return;
                if(typeof window.IPLAN_CREATE_SCENARIO !== 'function'){ m.textContent = 'iPlan is not available.'; return; }
                try {
                    const t = P.res.tgt;
                    await window.IPLAN_CREATE_SCENARIO({ name: q('[data-pname]').value || ('iLab path ' + (P.sel + 1)), wellId: P.res.wellId, start: P.res.start, sections: o.secs,
                        targets: [{ name: t.name || 'ICP', n: +t.n, e: +t.e, ss: +t.ss, r: +t.r || 15, inc: P.res.incT, az: P.res.azT }] });
                    m.innerHTML = '<span style="color:#00e676;">Created ✓ (shown in iPlan, green)</span>';
                } catch(err){ m.innerHTML = '<span style="color:#ff4c4c;">Could not create: ' + esc(err.message) + '</span>'; }
            });
        }
        function cellIdx(g, n, e, ss){
            const i = Math.floor((e - g.x0) / g.c), j = Math.floor((n - g.y0) / g.c), k = Math.floor((g.top - ss) / g.c);
            return (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) ? -1 : (k * g.ny + j) * g.nx + i;
        }
        // Rule 1 on stations st (zones Z = {escTo, icpFrom, icpMin}). prev = distances Map at the station before (escape
        // zone) or null; cont = st[0] is the end of an already-checked piece (skip it). Returns {bad, last} (last = Map at
        // the last station while still in the escape zone, else null).
        function checkSt(g, st, rkb, Z, prev, cont){
            let pm = prev; const nm = oi => g.obstacles[oi] || ('trajectory ' + (oi + 1));
            for(let q = cont ? 1 : 0; q < st.length; q++){
                const p = st[q], ss = rkb - p.tvd, qc = cellIdx(g, p.n, p.e, ss), bad = why => ({ bad: { md: p.md, why }, last: null });
                if(qc < 0) return bad('leaves the grid');
                // FIXED 2026-11-10 (John's screenshot: paths dived below the ICP and climbed back up): Inc <= ICP Inc is a HARD
                // rule on every station. Before it was only a tree heuristic, so the curve-hold-curve connector and the
                // shortcut smoothing could exceed it.
                if(p.inc > Z.incMax + 0.01) return bad('Inc ' + f(p.inc, 2) + ' above the ICP Inc');
                if(p.md <= Z.escTo + 1e-9){
                    // pm = per trajectory the LARGEST distance reached so far in the zone. A per-station tolerance was tried
                    // first (2026-11-09) and was WRONG: 0.05 m x 1 m stations accumulated (a path crept from 5 m to 3.7 m).
                    const dm = g.segIdx.near(p.n, p.e, ss), nx2 = new Map();
                    for(const [oi, d] of dm){
                        const m0 = pm ? pm.get(oi) : undefined;
                        if(pm && d < g.clear - 1e-9 && (m0 === undefined || d < m0 - Z.escTol)) return bad('gets closer to ' + nm(oi) + ' (' + f(d, 2) + ' m) in the escape zone');
                        nx2.set(oi, m0 === undefined ? d : Math.max(m0, d));
                    }
                    pm = nx2;
                } else if(p.md >= Z.icpFrom - 1e-9){
                    for(const [oi, d] of g.segIdx.near(p.n, p.e, ss)) if(d < Z.icpMin - 1e-3) return bad('is ' + f(d, 2) + ' m from ' + nm(oi) + ' in the ICP zone (min ' + Z.icpMin + ' m)');
                    pm = null;
                } else {
                    if(g.occ[qc]) return bad('enters an occupied cube');
                    pm = null;
                }
            }
            return { bad: null, last: pm };
        }
        function walk(g, A, secs, rkb, step, Z, prev, cont){
            const st = C.computeStations({ md: A.md, tvd: A.tvd, n: A.n, e: A.e, inc: A.inc, az: A.az }, secs, step).stations;
            return Object.assign({ st }, checkSt(g, st, rkb, Z, prev, cont));
        }
        // Curve-hold-curve (both curves at DLS d) from state A to point T arriving with (incT, azT): IPlanCore.chcNewton,
        // the same solver planCurveHoldCurve / Optimum Align use, then the same sections planCurveHoldCurve builds.
        // Only a few starting guesses (bearing to T) instead of solveCurveHoldCurve's 144 - a failed full sweep cost
        // ~150-200 ms, too slow inside the search (measured 2026-11-09). Result is re-verified by verify() anyway.
        function chc(A, T, incT, azT, d){
            const tg = { N: T.n - A.n, E: T.e - A.e, TVD: T.tvd - A.tvd }, brg = ((Math.atan2(tg.E, tg.N) * 180 / Math.PI) + 360) % 360, dist = Math.hypot(tg.N, tg.E, tg.TVD);
            for(const g0 of [[Math.max(1, (A.inc + incT) / 2), brg, dist / 2], [Math.max(1, Math.min(179, incT - 20)), brg, dist / 3], [60, brg, dist / 2]]){
                let x = null; try { x = C.chcNewton(A.inc, A.az, incT, azT, d, d, tg, g0); } catch(e){ x = null; }
                if(!x) continue;
                const cl1 = C.chcCurveCL(A.inc, A.az, x[0], x[1], d), cl2 = C.chcCurveCL(x[0], x[1], incT, azT, d), out = [];
                if(!isFinite(cl1) || !isFinite(cl2) || x[2] < 0) continue;
                if(cl1 > 1e-6) out.push({ kind: 'direct', inc: x[0], az: x[1], cl: cl1 });
                if(x[2] > 1e-6) out.push({ kind: 'hold', cl: x[2] });
                if(cl2 > 1e-6) out.push({ kind: 'direct', inc: incT, az: azT, cl: cl2 });
                if(out.length) return out;
            }
            return null;
        }
        async function pathSearch(){
            const g = L.grid; P.msg = ''; P.res = null; P.sel = 0; clearPaths3D();
            const fail = m => { P.msg = m; P.running = false; render(); };
            if(!g || !g.occ) return fail('Build the grid first.');
            if(!C || typeof C.chcNewton !== 'function' || typeof C.chcCurveCL !== 'function') return fail('IPlanCore is not loaded.');
            const cs = sources().find(s => s.key === g.centerKey);
            if(!cs || !cs.start) return fail('The grid subject is no longer loaded - rebuild the grid.');
            const tg = (tgtList().find(x => x.key === P.tgt) || {}).t;
            if(!tg) return fail('Pick an ICP (an iPlan target).');
            if(P.inc == null || P.az == null) return fail('Enter the ICP Inc and Az.');
            const S0 = cs.start, rkb = S0.rkb, D = P.dls, incT = P.inc, azT = ((P.az % 360) + 360) % 360, step = g.c / 10;
            const T = { n: +tg.n, e: +tg.e, tvd: rkb - (+tg.ss) };
            const qT = cellIdx(g, T.n, T.e, +tg.ss);
            if(qT < 0) return fail('The ICP is outside the grid - increase the half-width, or set Bottom Sub-Sea below ' + f(+tg.ss, 1) + ', and rebuild.');
            if(!g.segIdx) return fail('Rebuild the grid (it was built by an older iLab version).');
            if(g.occ[qT] && !(P.icpZ > 0)) return fail('The ICP itself is in an occupied cube and the ICP zone is 0 m, so no path can keep rule 1. Set an ICP zone, untick that trajectory or reduce the clearance.');
            for(const [oi, d] of g.segIdx.near(T.n, T.e, +tg.ss)) if(d < P.icpMin - 1e-3) return fail('The ICP is ' + f(d, 2) + ' m from ' + g.obstacles[oi] + ' - less than the ICP-zone min distance (' + P.icpMin + ' m).');
            const q0 = cellIdx(g, S0.n, S0.e, rkb - S0.tvd);
            if(q0 < 0) return fail('The start (surface) is outside the grid.');
            const pre = P.kop > S0.md + 1e-6 ? [{ kind: 'hold', cl: P.kop - S0.md }] : [];
            const ZT = { escTo: P.kop + P.esc, icpFrom: Infinity, icpMin: P.icpMin, escTol: P.escTol, incMax: incT };   // tree / shortcut checks (ICP MD not known yet)
            const w0 = pre.length ? walk(g, S0, pre, rkb, step, ZT, null, false) : Object.assign({ st: [S0] }, checkSt(g, [S0], rkb, ZT, null, false));
            if(w0.bad) return fail('The hold from the start to KOP ' + w0.bad.why + ' at MD ' + f(w0.bad.md, 1) + '. Try another KOP, a longer escape zone or a smaller clearance.');
            const K = w0.st[w0.st.length - 1], Ks = { md: K.md, tvd: K.tvd, n: K.n, e: K.e, inc: K.inc, az: K.az }, Kpm = w0.last;
            // independent re-check of the three rules on the WHOLE path (start -> ICP)
            const verify = secs => {
                const all = pre.concat(secs), st = C.computeStations({ md: S0.md, tvd: S0.tvd, n: S0.n, e: S0.e, inc: S0.inc, az: S0.az }, all, step).stations, E = st[st.length - 1];
                const Zf = { escTo: P.kop + P.esc, icpFrom: E.md - P.icpZ, icpMin: P.icpMin, escTol: P.escTol, incMax: incT };
                if(checkSt(g, st, rkb, Zf, null, false).bad) return null;
                const maxDls = st.reduce((m, p) => Math.max(m, isFinite(p.dls30) ? p.dls30 : 0), 0);
                if(maxDls > D + 1e-3) return null;
                const miss = Math.hypot(E.n - T.n, E.e - T.e, E.tvd - T.tvd), dAz = Math.abs(((E.az - azT + 540) % 360) - 180);
                if(miss > 0.01 || Math.abs(E.inc - incT) > 0.01 || (incT > 0.01 && dAz > 0.01)) return null;
                return { secs: all, st, md: E.md, maxDls, miss, endInc: E.inc, endAz: E.az, Zf, smp: st.filter((p, k) => k % 30 === 0 || k === st.length - 1) };
            };
            const sep = (a, b) => { const h = (A, B) => { let mx = 0; for(const p of A){ let mn = Infinity; for(const r of B){ const d = Math.hypot(p.n - r.n, p.e - r.e, p.tvd - r.tvd); if(d < mn) mn = d; } if(mn > mx) mx = mn; } return mx; };
                return Math.max(h(a.smp, b.smp), h(b.smp, a.smp)); };
            const DIV = 3 * g.c;
            const addDistinct = (list, v, cap) => {
                const k = list.findIndex(o => sep(o, v) < DIV);
                if(k >= 0){ if(v.md < list[k].md) list[k] = v; else return; } else list.push(v);
                list.sort((a, b) => a.md - b.md); if(list.length > cap) list.length = cap;
            };
            let nodes = [{ s: Ks, parent: null, sec: null, pm: Kpm }], trees = 1;
            const cands = [];
            const pathOf = nd => { const a = []; for(let x = nd; x && x.sec; x = x.parent) a.unshift(x); return a; };
            const tryConnect = nd => {
                for(const d of [D, 0.75 * D, 0.5 * D]){
                    const cs2 = chc(nd.s, T, incT, azT, d); if(!cs2) continue;
                    const tree = pathOf(nd), v = verify(tree.map(x => x.sec).concat(cs2));
                    if(v){ v.nodes = [Ks].concat(tree.map(x => x.s)); v.nodePm = [Kpm].concat(tree.map(x => x.pm)); v.treeSecs = tree.map(x => x.sec); v.conn = cs2; addDistinct(cands, v, 60); return true; }
                }
                return false;
            };
            let seed = 12345; const TREE_MS = 5000; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
            const gN1 = g.y0 + g.ny * g.c, gE1 = g.x0 + g.nx * g.c;
            const lo = { n: Math.max(g.y0, Math.min(K.n, T.n) - 300), e: Math.max(g.x0, Math.min(K.e, T.e) - 300) };
            const hi = { n: Math.min(gN1, Math.max(K.n, T.n) + 300), e: Math.min(gE1, Math.max(K.e, T.e) + 300) };
            const incMax = incT;   // 2026-11-10: = the hard rule (was max(incT, 10) as a heuristic)
            P.running = true; P.stop = false; render();
            const T0 = Date.now(), until = T0 + P.secs * 1000; let iters = 0, conns = 1;
            tryConnect(nodes[0]);   // plain curve-hold-curve from KOP (no tree)
            const say = () => { const m = body.querySelector('[data-pmsg]'); if(m) m.textContent = P.msg; };
            let treeEnd = T0 + TREE_MS;
            while(Date.now() < until && !P.stop){
                // a new tree (new seed) every TREE_MS: one tree tends to stay in one corridor; restarts give distinct options
                if(Date.now() > treeEnd && until - Date.now() > 1500){ trees++; nodes = [{ s: Ks, parent: null, sec: null, pm: Kpm }]; seed = (12345 + trees * 104729) % 2147483647 || 1; treeEnd = Date.now() + TREE_MS; }
                const tEnd = Date.now() + 80;
                while(Date.now() < tEnd){
                    iters++;
                    const qs = rnd() < 0.1 ? { n: T.n, e: T.e, tvd: T.tvd } : { n: lo.n + rnd() * (hi.n - lo.n), e: lo.e + rnd() * (hi.e - lo.e), tvd: K.tvd + rnd() * (T.tvd - K.tvd) };
                    let nb = null, bd = Infinity;
                    for(const nd of nodes){ const d = (nd.s.n - qs.n) ** 2 + (nd.s.e - qs.e) ** 2 + (nd.s.tvd - qs.tvd) ** 2; if(d < bd){ bd = d; nb = nd; } }
                    let be = null;
                    for(let k = 0; k < 8; k++){
                        const sec = { kind: 'dlstf', dls: rnd() < 0.3 ? 0 : rnd() * D, tf: rnd() * 360, cl: 30 };
                        const w = walk(g, nb.s, [sec], rkb, step, ZT, nb.pm, true); if(w.bad) continue;
                        const e = w.st[w.st.length - 1]; if(e.inc > incMax) continue;
                        const d = (e.n - qs.n) ** 2 + (e.e - qs.e) ** 2 + (e.tvd - qs.tvd) ** 2; if(!be || d < be.d) be = { d, sec, e, pm: w.last };
                    }
                    if(!be) continue;
                    const nd = { s: { md: be.e.md, tvd: be.e.tvd, n: be.e.n, e: be.e.e, inc: be.e.inc, az: be.e.az }, parent: nb, sec: be.sec, pm: be.pm };
                    nodes.push(nd);
                    if(rnd() < 0.15){ conns++; tryConnect(nd); }
                }
                P.msg = `Searching… ${f((Date.now() - T0) / 1000, 0)} s · tree ${trees}: ${nodes.length} nodes · ${cands.length} distinct valid path(s)`; say();
                await new Promise(r => setTimeout(r, 0));
            }
            P.msg = `Smoothing ${Math.min(cands.length, 3 * P.nOpt)} path(s)…`; say(); await new Promise(r => setTimeout(r, 0));
            // shortcut smoothing, then the whole path is verified again (rules 1-3)
            const smooth = v => {
                const N = v.nodes; if(N.length < 3) return v;
                const out = []; let i = 0;
                while(i < N.length - 1){
                    let done = false;
                    for(let j = N.length - 1; j > i + 1 && !done; j--){
                        for(const d of [0.5 * D, 0.75 * D, D]){
                            const s2 = chc(N[i], { n: N[j].n, e: N[j].e, tvd: N[j].tvd }, N[j].inc, N[j].az, d); if(!s2) continue;
                            if(walk(g, N[i], s2, rkb, step, ZT, v.nodePm[i], true).bad) continue;
                            out.push(...s2); i = j; done = true; break;
                        }
                    }
                    if(!done){ out.push(v.treeSecs[i]); i++; }
                }
                const v2 = verify(out.concat(v.conn));
                return (v2 && v2.md <= v.md + 1e-6) ? v2 : v;
            };
            const fin = [];
            cands.slice(0, 3 * P.nOpt).forEach(v => addDistinct(fin, smooth(v), P.nOpt));
            // min distance to the ticked trajectories per part of the path (exact, within the index radius H)
            fin.forEach(o => { let dO = Infinity, dE = Infinity, dI = Infinity;
                o.st.forEach(p => { let m = Infinity; for(const d of g.segIdx.near(p.n, p.e, rkb - p.tvd).values()) if(d < m) m = d;
                    if(p.md <= o.Zf.escTo + 1e-9) dE = Math.min(dE, m); else if(p.md >= o.Zf.icpFrom - 1e-9) dI = Math.min(dI, m); else dO = Math.min(dO, m); });
                const v = x => isFinite(x) ? x : null; o.dOut = v(dO); o.dEsc = v(dE); o.dIcp = v(dI); });
            P.running = false;
            P.res = { opts: fin, c: g.c, H: g.segIdx.H, tgt: tg, incT, azT, start: Object.assign({}, S0), wellId: cs.wellId };
            P.msg = fin.length
                ? `${fin.length} option(s), all re-checked: free cubes (escape zone to MD ${f(P.kop + P.esc, 0)}: never closer (tol ${P.escTol} m); last ${P.icpZ} m: ≥ ${P.icpMin} m) · DLS ≤ ${D} · on the ICP (Inc ${incT}, Az ${f(azT, 2)}) · Inc never above ${incT}. ${f((Date.now() - T0) / 1000, 1)} s, ${iters.toLocaleString()} iterations, ${trees} tree(s), ${conns} connection tries, ${cands.length} distinct valid path(s) before smoothing.${P.stop ? ' (stopped)' : ''}`
                : `No path found that keeps all three rules (${iters.toLocaleString()} iterations, ${trees} tree(s)). Try: more search time, a higher max DLS, another KOP, a smaller clearance, or a larger half-width.`;
            render(); drawPaths();
        }
        function clearPaths3D(){
            const grp = api.getGroup();
            P.objs.forEach(m => { grp.remove(m); if(m.geometry) m.geometry.dispose(); if(m.material) m.material.dispose(); });
            P.objs = [];
        }
        function drawPaths(){
            clearPaths3D(); const R = P.res; if(!R || !R.opts || !R.opts.length) return;
            const grp = api.getGroup(), rkb = R.start.rkb;
            R.opts.forEach((o, i) => {
                const pts = o.st.filter((p, k) => k % 5 === 0 || k === o.st.length - 1).map(p => new THREE.Vector3(p.e, rkb - p.tvd, -p.n));
                const m = (i === P.sel && typeof api.buildWellLine === 'function') ? api.buildWellLine(pts, 0x00e5ff)
                    : new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: i === P.sel ? 0x00e5ff : 0xb0bec5 }));
                m.raycast = () => {}; grp.add(m); P.objs.push(m);
            });
            const sp = new THREE.Mesh(new THREE.SphereGeometry(Math.max(2, R.c / 2), 16, 12), new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6 }));
            sp.position.set(+R.tgt.e, +R.tgt.ss, -(+R.tgt.n)); sp.raycast = () => {}; grp.add(sp); P.objs.push(sp);
        }

        // ---------- 3D ----------
        function clear3D(){
            const grp = api.getGroup();
            [L.mesh, L.frame].forEach(m => { if(m){ grp.remove(m); m.geometry.dispose(); m.material.dispose(); } });
            L.mesh = L.frame = null;
        }
        function draw(){
            clear3D(); const g = L.grid; if(!g || !g.occ) return;
            const grp = api.getGroup(), c = g.c;
            // area frame (yellow), scene axes: x = E, y = SS, z = -N
            const bg = new THREE.BoxGeometry(g.nx * c, g.nz * c, g.ny * c);
            L.frame = new THREE.LineSegments(new THREE.EdgesGeometry(bg), new THREE.LineBasicMaterial({ color: 0xffd400 })); bg.dispose();
            L.frame.position.set(g.x0 + g.nx * c / 2, g.top - g.nz * c / 2, -(g.y0 + g.ny * c / 2)); L.frame.raycast = () => {}; grp.add(L.frame);
            if(!L.show) return;
            const kTop = L.showTop == null ? 0 : Math.max(0, Math.floor((g.top - L.showTop) / c));
            const kBot = L.showBot == null ? g.nz - 1 : Math.min(g.nz - 1, Math.floor((g.top - L.showBot) / c));
            const list = [];
            for(let k = kTop; k <= kBot; k++) for(let j = 0; j < g.ny; j++){ const row = (k * g.ny + j) * g.nx; for(let i = 0; i < g.nx; i++) if(g.occ[row + i]) list.push(row + i); }
            let step = 1; if(list.length > MAX_SHOW) step = Math.ceil(list.length / MAX_SHOW);
            const shown = Math.ceil(list.length / step);
            const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(c * 0.92, c * 0.92, c * 0.92), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }), Math.max(1, shown));
            const M = new THREE.Matrix4(), col = new THREE.Color(); let q = 0;
            for(let s = 0; s < list.length; s += step){
                const idx = list[s], i = idx % g.nx, j = Math.floor(idx / g.nx) % g.ny, k = Math.floor(idx / (g.nx * g.ny)), v = g.occ[idx];
                M.makeTranslation(g.x0 + (i + 0.5) * c, g.top - (k + 0.5) * c, -(g.y0 + (j + 0.5) * c)); mesh.setMatrixAt(q, M);
                const kind = Object.keys(KIND).find(kk => v & KIND[kk].bit); col.setHex(KIND[kind].col); mesh.setColorAt(q, col); q++;
            }
            mesh.count = q; mesh.instanceMatrix.needsUpdate = true; if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.raycast = () => {};   // never picked by the 3D tooltip / double-click target tools
            L.mesh = mesh; grp.add(mesh);
            if(step > 1) g.info = g.info.replace(/\nShown:.*$/, '') + `\nShown: every ${step}th of ${list.length.toLocaleString()} occupied cubes in the Sub-Sea range (limit ${MAX_SHOW.toLocaleString()}) - narrow the range to see all.`;
            else g.info = g.info.replace(/\nShown:.*$/, '') + `\nShown: ${list.length.toLocaleString()} occupied cubes.`;
        }

        head.addEventListener('click', () => {
            const open = body.style.display === 'none';
            body.style.display = open ? 'flex' : 'none';
            if(open) render();
        });
    })();
    
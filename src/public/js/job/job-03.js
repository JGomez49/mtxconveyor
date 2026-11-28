/* MTX Conveyor — job page script 3. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 1527) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

                // 2026-11-15 (John) phase 2: edit wells / wellbores / runs; the Run owns its BHA (saved -> pushed into the
                // linked T&D plan run; T&D saves sync back). Editing works on the SAVED structure only (build it first).
                (function(){
                    var NOTE_ID = window.MTX_JOB.noteId, MTX_ID = window.MTX_JOB.mtxJobId, DATA = null, loaded = false, IN = 0.0254, OPEN = {};
                    function $(id){ return document.getElementById(id); }
                    function esc(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
                    function f(v, d){ return (v == null || v === '' || !isFinite(v)) ? '—' : (+v).toFixed(d); }
                    function iv(v, d){ return (v == null || v === '' || !isFinite(v)) ? '' : (+v).toFixed(d).replace(/\.?0+$/, ''); }
                    function dt(d){ return d ? new Date(d).toISOString().slice(0, 10) : ''; }
                    function edit(){ return DATA && DATA.saved && DATA.canEdit; }
                    function btn(act, id, label, title){ return '<button type="button" class="wbt-btn ws-b" data-act="' + act + '" data-id="' + esc(id || '') + '" title="' + esc(title || '') + '">' + label + '</button>'; }
                    function sec(title, body, key){ return '<details class="ws-sec" data-k="' + key + '"' + (OPEN[key] ? ' open' : '') + '><summary>' + title + '</summary><div class="ws-in">' + body + '</div></details>'; }
                    function bhaRows(list){
                        return (list || []).map(function(c){ return '<tr><td><input class="ws-i" data-f="name" value="' + esc(c.name) + '" style="width:170px"></td><td><input class="ws-i" data-f="od" type="number" step="any" value="' + iv(c.od_m / IN, 3) + '" style="width:80px"></td>' +
                            '<td><input class="ws-i" data-f="id" type="number" step="any" value="' + iv(c.id_m / IN, 3) + '" style="width:80px"></td><td><input class="ws-i" data-f="len" type="number" step="any" value="' + iv(c.len, 2) + '" style="width:80px"></td>' +
                            '<td><input class="ws-i" data-f="wt" type="number" step="any" value="' + iv(c.wt, 2) + '" placeholder="auto" style="width:80px"></td><td><select class="ws-i" data-f="mat"><option' + (c.material === 'Non-mag' ? '' : ' selected') + '>Steel</option><option' + (c.material === 'Non-mag' ? ' selected' : '') + '>Non-mag</option></select></td>' +
                            '<td><button type="button" class="wbt-btn ws-b" data-act="rowUp" title="Move up">↑</button><button type="button" class="wbt-btn ws-b" data-act="rowDel" title="Remove">✕</button></td></tr>'; }).join('');
                    }
                    function runHtml(r, it){
                        var tr = (it.td.runs || []).find(function(x){ return x.id === r.tdRunId; }) || null;
                        var own = DATA.saved && r.bha && r.bha.length, list = own ? r.bha : (tr ? tr.bha : []), sens = own ? r.sensor : tr && tr.sensor, bd = own ? r.bendDeg : tr && tr.bendDeg, bl = own ? r.bendDist : tr && tr.bendDist;
                        var link = r.tdMissing ? '<span class="ws-tag warn" title="The linked T&amp;D plan run was removed in T&amp;D. The BHA is kept here.">not in T&amp;D plan</span>' : r.tdRunId ? '<span class="ws-tag" title="Mirrored into the T&amp;D plan run">T&amp;D ' + esc(r.tdScenario || 'active') + '</span>' : (DATA.saved ? '<span class="ws-tag warn" title="Not in the T&amp;D plan yet (well has no plan) — Save again once it has one">Wells only</span>' : '');
                        var bha;
                        if(edit()){
                            bha = '<div class="ws-bar"><label>Run <input class="ws-i" data-f="rname" value="' + esc(r.name) + '" style="width:120px"></label><label>MD from (m) <input class="ws-i" data-f="from" type="number" step="any" value="' + iv(r.mdFrom, 2) + '" style="width:90px"></label><label>MD to (m) <input class="ws-i" data-f="to" type="number" step="any" value="' + iv(r.mdTo, 2) + '" style="width:90px"></label>' +
                                '<label>MWD sensor from bit (m) <input class="ws-i" data-f="sensor" type="number" step="any" value="' + iv(sens, 2) + '" style="width:80px"></label><label>Bend (°) <input class="ws-i" data-f="bdeg" type="number" step="any" value="' + iv(bd, 2) + '" style="width:70px"></label><label>Bend to bit (m) <input class="ws-i" data-f="bdist" type="number" step="any" value="' + iv(bl, 2) + '" style="width:80px"></label></div>' +
                                '<div class="wbt-table-wrap" style="max-height:360px"><table class="wbt-table ws-bha"><thead><tr><th>Component (bit first)</th><th>OD (in)</th><th>ID (in)</th><th>Length (m)</th><th title="Blank = plain steel tube 7850·π/4·(OD²−ID²), geometry only">Weight (kg/m)</th><th>Material</th><th></th></tr></thead><tbody>' + bhaRows(list) + '</tbody></table></div>' +
                                '<div class="ws-bar" style="margin-top:6px">' + btn('rowAdd', r.id, '+ Component') + btn('runSave', r.id, '💾 Save run (and push to T&amp;D)') + btn('runDel', r.id, '🗑 Delete run') + '<span class="ws-dim ws-msg"></span></div>' +
                                '<div class="ws-dim">The Run owns this BHA. Saving writes it into the linked T&amp;D plan run (T&amp;D results are not recalculated — recalculate in T&amp;D). Saving in T&amp;D updates it here.' + (r.bhaUpdatedAt ? ' Last BHA change ' + dt(r.bhaUpdatedAt) + '.' : '') + '</div>';
                        } else bha = list.length ? '<div class="wbt-table-wrap" style="max-height:320px"><table class="wbt-table"><thead><tr><th>#</th><th>Component (bit first)</th><th>OD (in)</th><th>ID (in)</th><th>Length (m)</th><th>Weight (kg/m)</th><th>Material</th></tr></thead><tbody>' +
                            list.map(function(c, i){ return '<tr><td>' + (i + 1) + '</td><td>' + esc(c.name) + '</td><td>' + f(c.od_m / IN, 3) + '</td><td>' + f(c.id_m / IN, 3) + '</td><td>' + f(c.len, 2) + '</td><td>' + f(c.wt, 1) + '</td><td>' + esc(c.material || '—') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
                            '<div class="ws-dim">MWD sensor from bit: ' + f(sens, 2) + ' m · bend ' + f(bd, 2) + '° at ' + f(bl, 2) + ' m' + (DATA.saved ? '' : ' · from the T&amp;D plan') + '</div>' : '<div class="ws-dim">No BHA yet.</div>';
                        var sv = it.survey, n = sv ? sv.mds.filter(function(m){ return m >= r.mdFrom && m <= r.mdTo; }).length : 0;
                        var surv = sv ? '<ul class="ws-list"><li><b>Original</b> — ' + esc(sv.name) + ': <b>' + n + '</b> stations in ' + f(r.mdFrom, 1) + '–' + f(r.mdTo, 1) + ' m' + (sv.toolcode ? ' · toolcode ' + esc(sv.toolcode) : '') + '</li>' +
                            (it.versions.length ? it.versions.map(function(v){ return '<li><b>Corrected</b> — ' + esc(v.name) + ' <span class="ws-tag">' + esc(v.chain.length ? v.chain.join(' → ') : v.source) + '</span> <span class="ws-dim">' + dt(v.date) + ' · whole wellbore</span></li>'; }).join('') : '<li class="ws-dim">No corrected versions.</li>') + '</ul>'
                            : '<div class="ws-dim">No survey.</div>';
                        // 2026-11-15: survey stations of this run (MD from–to), original or a corrected version
                        if(sv && r.id) surv += '<div class="ws-bar" style="margin-top:6px"><label>Survey shown <select class="ws-i ws-svsel" data-run="' + esc(r.id) + '"><option value="' + esc(sv.id) + '">Original — ' + esc(sv.name) + '</option>' +
                            it.versions.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc((v.chain && v.chain.length ? 'MWD+' + v.chain.map(function(c){ return { STRETCH: 'PS', SC: 'SCC' }[c] || c; }).join('+') : v.source) + ' — ' + v.name) + '</option>'; }).join('') + '</select></label></div>' +
                            '<div class="ws-lazy ws-scroll" data-lazy="stations" data-run="' + esc(r.id) + '" data-from="' + esc(r.mdFrom) + '" data-to="' + esc(r.mdTo) + '"></div>';
                        var sl = []; it.slideSheets.forEach(function(s){ var a = s.slides.filter(function(x){ return x.from < r.mdTo && x.to > r.mdFrom; }); if(a.length) sl.push('<li>Slide Sheet <b>' + esc(s.name) + '</b>: ' + a.length + ' slides, ' + f(a.reduce(function(t, x){ return t + (+x.len || 0); }, 0), 1) + ' m slid in this run · <a href="/notes/slideSheet?mtxJobId=' + encodeURIComponent(MTX_ID) + '&id=' + s.id + '" target="_blank">open</a></li>'); });
                        var eng = '<ul class="ws-list">' + (tr ? '<li>Torque &amp; Drag — plan run “' + esc(tr.name) + '”' + (r.tdScenario ? ' in scenario “' + esc(r.tdScenario) + '”' : '') + '</li>' : '') + sl.join('') +
                            (it.hydraulics ? '<li>Hydraulics <span class="ws-dim">(whole wellbore, ' + dt(it.hydraulics.updatedAt) + ')</span></li>' : '') + (it.casing ? '<li>Casing Design <span class="ws-dim">(whole wellbore, ' + dt(it.casing.updatedAt) + ')</span></li>' : '') +
                            it.sag.map(function(c){ return '<li>SAG case <b>' + esc(c.name) + '</b> <span class="ws-dim">' + dt(c.updatedAt) + '</span></li>'; }).join('') + it.stretch.map(function(c){ return '<li>Pipe Stretch case <b>' + esc(c.name) + '</b> <span class="ws-dim">' + dt(c.updatedAt) + '</span></li>'; }).join('') + '</ul>';
                        var k = 'r' + (r.id || r.tdRunId || r.name);
                        return '<details class="ws-run" data-run="' + esc(r.id || '') + '" data-k="' + esc(k) + '"' + (OPEN[k] ? ' open' : '') + '><summary>' + esc(r.name) + ' <span class="ws-dim">· ' + f(r.mdFrom, 1) + '–' + f(r.mdTo, 1) + ' m · ' + list.length + ' BHA components</span> ' + link + '</summary><div class="ws-in">' +
                            // 2026-11-15: BHA schematic after the BHA table; per-run T&D (live) inside "Engineering" (was "Engineering cases")
                            sec('🔧 BHA', bha + (r.id ? '<div class="ws-lazy ws-scroll" data-lazy="bha" data-run="' + esc(r.id) + '" data-wk="' + esc(r.wellKey || '') + '"></div>' : ''), k + 'b') + sec('📐 Surveys', surv, k + 's') +
                            sec('🧮 Engineering', eng + (r.id ? sec('🔧 Torque &amp; Drag <span class="ws-dim">· this run, calculated live</span>', '<div class="ws-lazy" data-lazy="td" data-run="' + esc(r.id) + '"><span class="ws-dim">Open to calculate…</span></div>', k + 't') : '<div class="ws-dim">Build the well structure to see the T&amp;D of this run.</div>'), k + 'e') + '</div></details>';
                    }
                    // ---- 2026-11-15 (B): uploaded trajectories (Plan / Actual) linked to wellbores + "Unassigned" tray ----
                    function tagOf(t){ return t.designation === 'plan' ? '<span class="ws-tag">Plan' + (t.planVersion ? ' ' + esc(t.planVersion) : '') + '</span>' : t.designation === 'actual' ? '<span class="ws-tag ok">Actual</span>' : '<span class="ws-tag warn">type not set</span>'; }
                    function typeSel(t){ return '<select class="ws-i" data-ty="' + esc(t.id) + '"><option value=""' + (!t.designation ? ' selected' : '') + '>— type —</option><option value="plan"' + (t.designation === 'plan' ? ' selected' : '') + '>Plan</option><option value="actual"' + (t.designation === 'actual' ? ' selected' : '') + '>Actual (drilled)</option></select>'; }
                    function pvNum(t){ var m = /(\d+)/.exec(t.planVersion || ''); return m ? +m[1] : -1; }
                    function wbSurveys(b){
                        var ts = (DATA.trajs || []).filter(function(t){ return String(t.wellboreId) === String(b.id) || t.name === b.wellKey; });
                        if(!ts.length) return '<div class="ws-dim">No survey linked.</div>';
                        var plans = ts.filter(function(t){ return t.designation === 'plan'; }).sort(function(a, c){ return pvNum(c) - pvNum(a); }), cur = plans[0];
                        var row = function(t){
                            var eng = t.name === b.wellKey;
                            return '<li data-traj="' + esc(t.id) + '">' + tagOf(t) + (t === cur && plans.length > 1 ? ' <span class="ws-tag">current</span>' : '') + (eng ? ' <span class="ws-tag" title="T&amp;D, Hydraulics, Casing, Slide Sheet and survey corrections of this wellbore use this survey">engineering</span>' : '') +
                                ' <b>' + esc(t.name) + '</b> <span class="ws-dim">· ' + t.count + ' stations, ' + f(t.mdMin, 1) + '–' + f(t.mdMax, 1) + ' m' + (t.toolcode ? ' · ' + esc(t.toolcode) : '') + (t.pad ? ' · ' + esc(t.pad) : '') + ' · ' + dt(t.date) + '</span>' +
                                (t.versions.length ? '<ul class="ws-list">' + t.versions.map(function(v){ return '<li><span class="ws-tag ok">' + esc(v.label) + '</span> ' + esc(v.name) + ' <span class="ws-dim">· ' + (v.count || '') + ' stations · ' + dt(v.date) + '</span></li>'; }).join('') + '</ul>' : '') +
                                (edit() ? '<div class="ws-bar" style="margin:4px 0 8px">' + typeSel(t) + (t.designation === 'plan' ? '<input class="ws-i" data-pv="' + esc(t.id) + '" value="' + esc(t.planVersion) + '" placeholder="P5" style="width:70px" title="Plan version">' : '') +
                                    btn('trajType', t.id, 'Set type') + (eng ? '' : btn('trajEng', t.id, 'Use for engineering', 'Make this the survey T&amp;D / Hydraulics / Casing / corrections of this wellbore use')) + (eng ? '' : btn('trajUn', t.id, 'Unassign')) + '</div>' : '') + '</li>';
                        };
                        var act = ts.filter(function(t){ return t.designation === 'actual'; }), un = ts.filter(function(t){ return !t.designation; });
                        var pva = act.length && cur ? planVsActual(act[0], cur) : '';
                        return pva + (act.length ? '<div class="ws-sub2">Actual (drilled)</div><ul class="ws-list">' + act.map(row).join('') + '</ul>' : '<div class="ws-dim">No actual survey yet.</div>') +
                            (plans.length ? '<div class="ws-sub2">Plans</div><ul class="ws-list">' + plans.map(row).join('') + '</ul>' : '<div class="ws-dim">No plan.</div>') +
                            (un.length ? '<div class="ws-sub2">Type not set</div><ul class="ws-list">' + un.map(row).join('') + '</ul>' : '');
                    }
                    // 2026-11-15 (phase 3): plan vs actual — at each actual station, the plan position at the same MD (LINEAR
                    // interpolation between plan stations by MD: an approximation of the arc, small for normal station spacing).
                    // Distance = 3D centre-to-centre at equal MD (not the closest-approach distance of anti-collision).
                    function planVsActual(a, p){
                        if(!a.pts.length || p.pts.length < 2) return '';
                        if(a.grid !== p.grid) return '<div class="ws-note">Plan vs actual not compared: one survey has grid Northing / Easting and the other only local N / E.</div>';
                        var P = p.pts, best = null, last = null, n = 0;
                        a.pts.forEach(function(x){ var md = x[0]; if(md < P[0][0] || md > P[P.length - 1][0]) return;
                            var k = 1; while(k < P.length - 1 && P[k][0] < md) k++; var q0 = P[k - 1], q1 = P[k], u = q1[0] > q0[0] ? (md - q0[0]) / (q1[0] - q0[0]) : 0;
                            var pn = q0[1] + u * (q1[1] - q0[1]), pe = q0[2] + u * (q1[2] - q0[2]), pt = q0[3] + u * (q1[3] - q0[3]);
                            var d = Math.sqrt(Math.pow(x[1] - pn, 2) + Math.pow(x[2] - pe, 2) + Math.pow(x[3] - pt, 2)), o = { md: md, d: d, dTvd: x[3] - pt, dLat: Math.sqrt(Math.pow(x[1] - pn, 2) + Math.pow(x[2] - pe, 2)) };
                            n++; last = o; if(!best || d > best.d) best = o; });
                        if(!n) return '<div class="ws-note">Plan vs actual: no common MD range.</div>';
                        return '<div class="ws-pva"><b>Plan vs actual</b> <span class="ws-dim">(' + esc(a.name) + ' vs plan ' + esc(p.planVersion || p.name) + ', same MD, ' + n + ' stations)</span><br>' +
                            'At the last actual station (MD ' + f(last.md, 1) + ' m): <b>' + f(last.d, 2) + ' m</b> 3D · ΔTVD ' + (last.dTvd >= 0 ? '+' : '') + f(last.dTvd, 2) + ' m (+ = deeper than plan) · horizontal ' + f(last.dLat, 2) + ' m' +
                            '<br>Largest 3D distance: <b>' + f(best.d, 2) + ' m</b> at MD ' + f(best.md, 1) + ' m <span class="ws-dim">· plan interpolated linearly by MD between its stations</span></div>';
                    }
                    function wbList(){ var o = []; (DATA.saved || []).forEach(function(w){ w.wellbores.forEach(function(b){ o.push({ w: w, b: b }); }); }); return o; }
                    function suggest(t){   // [NN] prefix of a well / its surveys, else a shared 6+ digit token (UWI / licence)
                        var L = wbList(), bm = /^\s*(\[\d+[A-Za-z]*\])/.exec(t.name), lm = /_L(\d+)$/i.exec(t.name), leg = lm ? 'L' + lm[1].padStart(2, '0') : 'L01';
                        var names = function(x){ return [x.w.name, x.w.uwi || '', x.b.wellKey].concat((DATA.trajs || []).filter(function(q){ return String(q.wellboreId) === String(x.b.id); }).map(function(q){ return q.name; })).join(' '); };
                        if(bm){ var c = L.filter(function(x){ return names(x).indexOf(bm[1]) >= 0; }); var c2 = c.filter(function(x){ return x.b.name === leg; }); if(c2.length) return c2[0]; if(c.length) return { w: c[0].w, b: null }; }
                        var tok = (t.name.match(/\d{6,}/g) || []); for(var i = 0; i < L.length; i++){ var n = names(L[i]); if(tok.some(function(k){ return n.indexOf(k) >= 0; })) return L[i]; }
                        return null;
                    }
                    function trayHtml(){
                        var un = (DATA.trajs || []).filter(function(t){ return !t.wellboreId; }); if(!un.length || !edit()) return '';
                        var L = wbList();
                        return '<details class="ws-well ws-tray" data-k="tray" open><summary>📥 Unassigned trajectories <span class="ws-dim">· ' + un.length + ' — give each one a type and a wellbore</span></summary><div class="ws-in">' +
                            '<div class="wbt-table-wrap" style="max-height:none"><table class="wbt-table"><thead><tr><th>Trajectory</th><th>Stations / MD</th><th>Type</th><th>Plan ver.</th><th>Assign to</th><th></th></tr></thead><tbody>' +
                            un.map(function(t){ var sg = suggest(t), des = t.designation || (/\[\s*P\d+\s*[-\]]/i.test(t.pad) ? 'plan' : '');
                                var opts = '<option value="">— pick —</option>' + L.map(function(x){ return '<option value="wb:' + esc(x.b.id) + '"' + (sg && sg.b && String(sg.b.id) === String(x.b.id) ? ' selected' : '') + '>' + esc(x.w.name + ' › ' + x.b.name) + '</option>'; }).join('') +
                                    (DATA.saved || []).map(function(w){ return '<option value="nw:' + esc(w.id) + '"' + (sg && !sg.b && String(sg.w.id) === String(w.id) ? ' selected' : '') + '>' + esc(w.name) + ' › + new wellbore</option>'; }).join('') + '<option value="new"' + (!sg ? ' selected' : '') + '>+ New well</option>';
                                return '<tr data-traj="' + esc(t.id) + '"><td><b>' + esc(t.name) + '</b>' + (t.pad ? '<div class="ws-dim">' + esc(t.pad) + '</div>' : '') + '</td><td>' + t.count + ' · ' + f(t.mdMin, 0) + '–' + f(t.mdMax, 0) + ' m</td>' +
                                    '<td>' + typeSel({ id: t.id, designation: des }) + '</td><td><input class="ws-i" data-pv="' + esc(t.id) + '" value="' + esc(t.planVersion || ((/\[\s*(P\d+)\s*[-\]]/i.exec(t.pad) || [])[1] || '')) + '" placeholder="P5" style="width:70px"></td>' +
                                    '<td><select class="ws-i" data-to="' + esc(t.id) + '">' + opts + '</select></td><td>' + btn('trajAssign', t.id, 'Assign') + '</td></tr>'; }).join('') +
                            '</tbody></table></div><div class="ws-dim">Suggestions: same “[NN]” prefix (then same _L leg), or a shared 6+ digit number (UWI / licence). Assigning only links the trajectory — its survey is not changed.</div></div></details>';
                    }
                    function wbHtml(b){
                        var it = DATA.items[b.wellKey] || { td: { runs: [], scenarios: [] }, versions: [], slideSheets: [], sag: [], stretch: [] };
                        var head = (b.id ? '<div class="ws-lazy" data-lazy="sections" data-wk="' + esc(b.wellKey) + '"></div><div class="ws-lazy ws-scroll" data-lazy="geom" data-wk="' + esc(b.wellKey) + '"></div>' : '') +   // 2026-11-15: hole sections & BHA runs, then wellbore geometry
                            '<div class="ws-dim" style="margin-bottom:6px">Survey well: ' + esc(b.wellKey) + (it.survey ? ' · ' + it.survey.count + ' stations, ' + f(it.survey.mdMin, 1) + '–' + f(it.survey.mdMax, 1) + ' m' : ' · no survey') + ' · ' + it.versions.length + ' corrected version(s)' + (it.td.scenarios.length ? ' · T&amp;D scenarios: ' + esc(it.td.scenarios.join(', ')) : ' · no T&amp;D') + '</div>' +
                            (edit() ? '<div class="ws-bar">' + btn('runAdd', b.id, '+ Run') + btn('wbEdit', b.id, '✏️ Edit wellbore') + btn('wbDel', b.id, '🗑 Delete wellbore') + '</div>' : '');
                        if(!DATA.saved && b.why) head += '<div class="ws-dim" style="margin-bottom:6px">Grouped by: ' + esc(b.why) + ' · engineering survey: ' + esc(b.wellKey) + (b.desig ? ' (' + esc(b.desig) + ')' : '') + '</div>';   // 2026-11-15 (C)
                        head += DATA.saved ? sec('📐 Surveys of this wellbore (plans / actual / corrections)', wbSurveys(b), 'sv' + b.id) : '';
                        var runs = b.runs.length ? b.runs.map(function(r){ return runHtml(r, it); }).join('') : '<div class="ws-dim">No runs' + (edit() ? ' — add one with “+ Run”, or add BHA runs in the T&amp;D modeler (they appear here when T&amp;D saves).' : ' — add BHA runs to this well in the T&amp;D modeler, then build.') + '</div>';
                        var k = 'b' + b.wellKey;
                        return '<details class="ws-wb" data-k="' + esc(k) + '"' + (OPEN[k] ? ' open' : '') + '><summary>Wellbore ' + esc(b.name) + ' <span class="ws-dim">· ' + b.runs.length + ' run(s)</span></summary><div class="ws-in">' + head + runs + '</div></details>';
                    }
                    function render(){
                        setTimeout(loadVisible, 0);   // 2026-11-15: lazy content of sections already open
                        var src = DATA.saved || DATA.proposal, saved = !!DATA.saved;
                        $('wsStatus').innerHTML = saved ? '<span class="ws-tag">saved</span> Well structure of this job' + (DATA.canEdit ? ' — editable' : '') : '<span class="ws-tag warn">proposal</span> Not built yet — showing what would be created from the job data';
                        var b = $('wsBuildBtn'); if(b){ b.style.display = ''; b.textContent = saved ? 'Rebuild from job data' : 'Build well structure'; }
                        var a = $('wsAddWell'); if(a) a.style.display = edit() ? '' : 'none';
                        $('wsTree').innerHTML = trayHtml() + (src.length ? src.map(function(w){ var k = 'w' + (w.id || w.name);
                            return '<details class="ws-well" data-k="' + esc(k) + '"' + (OPEN[k] || src.length === 1 ? ' open' : '') + '><summary>🛢️ ' + esc(w.label || w.name) + (w.uwi ? ' <span class="ws-dim">· UWI ' + esc(w.uwi) + '</span>' : '') + ' <span class="ws-dim">· ' + w.wellbores.length + ' wellbore(s)</span></summary><div class="ws-in">' +
                                (edit() ? '<div class="ws-bar">' + btn('wbAdd', w.id, '+ Wellbore') + btn('wellEdit', w.id, '✏️ Edit well') + btn('wellDel', w.id, '🗑 Delete well') + '</div>' : '') + w.wellbores.map(wbHtml).join('') + '</div></details>'; }).join('')
                            : '<div class="ws-dim">No subject wells with surveys in this job.</div>');
                    }
                    // ---- 2026-11-15 (John): lazy content — wellbore geometry, run BHA schematic, run T&D (live, one chart per row) ----
                    var WBTD = {}, RUNTD = {}, CHARTS = {};
                    function wbTD(wk){ if(!WBTD[wk]) WBTD[wk] = fetch('/notes/wellStructure/' + NOTE_ID + '/wbTD?wellKey=' + encodeURIComponent(wk)).then(function(r){ return r.json(); }).catch(function(e){ return { ok: false, error: e.message }; }); return WBTD[wk]; }
                    function findRunById(id){ var o = null; (DATA.saved || []).forEach(function(w){ w.wellbores.forEach(function(b){ b.runs.forEach(function(r){ if(String(r.id) === String(id)) o = { b: b, r: r }; }); }); }); return o; }
                    function schematic(el, o){
                        if(typeof window.MTX_TD_SCHEMATIC !== 'function'){ el.innerHTML = '<span class="ws-dim">Schematic not available (no T&amp;D model on this job).</span>'; return; }
                        el.innerHTML = '<div class="ws-sch-in"></div>'; var inner = el.firstChild;
                        o.inner = inner; o.wrap = el; window.MTX_TD_SCHEMATIC(o);
                    }
                    async function lazyGeom(el){
                        var d = await wbTD(el.getAttribute('data-wk')); if(!d.ok){ el.innerHTML = '<span class="ws-dim">Wellbore geometry: ' + esc(d.error) + '</span>'; el.style.display = ''; return; }
                        schematic(el, { part: 'well', casings: d.casings, bha: [], params: d.params, results: d.inc, wellKey: el.getAttribute('data-wk') });
                    }
                    async function lazyBha(el){
                        var o = findRunById(el.getAttribute('data-run')); if(!o){ return; }
                        var d = await wbTD(o.b.wellKey), it = DATA.items[o.b.wellKey] || { td: { runs: [] } }, tr = (it.td.runs || []).find(function(x){ return x.id === o.r.tdRunId; });
                        var bha = (o.r.bha && o.r.bha.length) ? o.r.bha : (tr ? tr.bha : []);
                        if(!bha.length){ el.innerHTML = ''; return; }
                        schematic(el, { part: 'bha', casings: d.ok ? d.casings : [], bha: bha, params: Object.assign({}, d.ok ? d.params : {}, { td: o.r.mdTo }), results: d.ok ? d.inc : null, wellKey: o.b.wellKey });
                    }
                    var LIGHT = function(){ return document.body.classList.contains('light-mode'); };
                    function chartOpts(xT, yT, yMin){
                        var tx = LIGHT() ? '#000' : '#fff', gr = LIGHT() ? 'rgba(0,0,0,.15)' : 'rgba(30,45,61,.6)', ft = { family: 'Share Tech Mono', size: 12 };
                        return { responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
                            plugins: { legend: { labels: { color: tx, font: ft, boxWidth: 12, padding: 8 } }, tooltip: { mode: 'nearest', intersect: false },
                                zoom: { pan: { enabled: true, mode: 'xy' }, zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode: 'xy' } } },
                            scales: { x: { type: 'linear', title: { display: true, text: xT, color: tx, font: ft }, ticks: { color: tx, font: ft, maxTicksLimit: 8 }, grid: { color: gr } },
                                      y: { min: yMin, title: { display: true, text: yT, color: tx, font: ft }, ticks: { color: tx, font: ft }, grid: { color: gr } } } };
                    }
                    function ln(lbl, ys, xs, c, dash, fill){ return { label: lbl, data: (xs || []).map(function(x, i){ return { x: x, y: ys ? ys[i] : null }; }), borderColor: c, backgroundColor: fill ? c + '26' : undefined, borderWidth: 1.8, pointRadius: 0, fill: fill ? 'origin' : false, tension: 0.3, borderDash: dash || [] }; }
                    function drawRunTD(el, d){
                        var r = d.results, id = el.getAttribute('data-run');
                        (CHARTS[id] || []).forEach(function(c){ try{ c.destroy(); }catch(e){} }); CHARTS[id] = [];
                        var plots = [
                            ['Effective Tension vs Measured Depth', 'Measured Depth (m)', 'Effective Tension (kDaN)', null, [ln('Tripping In', r.etTI, r.mds, '#ff4060'), ln('Tripping Out', r.etTO, r.mds, '#39ff14'), ln('Rotating OB', r.etROB, r.mds, '#00c8ff'), ln('Slide Drilling', r.etSLD, r.mds, '#ff6b35', [4, 3]), ln('Rotating Off', r.etROff, r.mds, '#c084fc', [2, 4])]],
                            ['Hook Load vs Bit Depth (this run)', 'Bit Depth (m)', 'Surface Hook Load (kDaN)', null, [ln('Tripping In', r.hlTI, r.hlMDs, '#ff5e7a'), ln('Tripping Out', r.hlTO, r.hlMDs, '#39ff14'), ln('Rotating OB', r.hlROB, r.hlMDs, '#00c8ff'), ln('Slide Drilling', r.hlSLD, r.hlMDs, '#ff6b35', [4, 3]), ln('Rotating Off', r.hlROff, r.hlMDs, '#c084fc', [2, 4])]],
                            ['Side Force vs Measured Depth', 'Measured Depth (m)', 'Side Force (kgf/' + r.normLen + ' m)', 0, [ln('Tripping In', r.sfTI, r.mds, '#ff4060'), ln('Tripping Out', r.sfTO, r.mds, '#39ff14'), ln('Rotating OB', r.sfROB, r.mds, '#00c8ff'), ln('Slide Drilling', r.sfSLD, r.mds, '#ff6b35', [4, 3]), ln('Rotating Off', r.sfROff, r.mds, '#c084fc', [2, 4])]],
                            ['Surface Torque vs Measured Depth', 'MD (m)', 'Torque (N.m)', null, [ln('Rotating OB', r.tqROB, r.mds, '#ff6b35', [], true), ln('Rotating Off', r.tqROff, r.mds, '#c084fc', [2, 3]), ln('Slide Drilling', r.tqSLD, r.mds, '#ffd060', [4, 3]), ln('Tripping In', r.tqTI, r.mds, '#ff5e7a'), ln('Tripping Out', r.tqTO, r.mds, '#39ff14', [6, 3])].concat(isFinite(r.torqLimDisp) ? [ln('Limit', r.mds.map(function(){ return r.torqLimDisp; }), r.mds, '#ff4060', [4, 3])] : [])],
                            ['Inclination vs Measured Depth', 'MD (m)', 'Inclination (deg)', 0, [ln('Inclination (deg)', r.incArr, r.mds, '#39ff14', [], true)]],
                            ['DLS vs Measured Depth', 'MD (m)', 'DLS (deg/30m)', 0, [ln('DLS (deg/30m)', r.dlsArr, r.mds, '#ffd060', [], true)]] ];
                        var ru = d.run, sn = d.snapshot || {}, sc = d.section || {};
                        el.innerHTML = '<div class="ws-dim" style="margin-bottom:6px">Scenario “' + esc(d.scenario) + '” · ' + esc(ru.name) + ' ' + f(ru.from, 1) + '–' + f(ru.to, 1) + ' m · ' + ru.bhaParts + ' BHA parts · snapshot with the bit at ' + f(sn.md, 1) + ' m' +
                            ' · WOB rot / slide ' + f(ru.wobRot / 1000, 1) + ' / ' + f(ru.wobSlid / 1000, 1) + ' kN · torque at bit ' + f(ru.torqBit, 0) + ' N.m' + (sc.name ? ' · section ' + esc(sc.name) + ' (hole ' + f(sc.hole_m * 1000, 0) + ' mm, mud ' + f(sc.mudDens, 0) + ' kg/m³, OH FF ' + f(sc.ffOH, 2) + ')' : '') +
                            ' · cased FF ' + f(d.ff.ff1, 2) + ' / ' + f(d.ff.ff2, 2) + ' · calculated ' + new Date(d.calculatedAt).toLocaleString() + '</div>' +
                            '<div class="ws-bar">' + btn('tdRecalc', id, '↻ Recalculate') + (MTX_ID ? '<a class="wbt-btn ws-b" href="/notes/uploadTorqueAndDrag?mtxJobId=' + encodeURIComponent(MTX_ID) + '" target="_blank">Open T&amp;D modeler</a>' : '') + '</div>' +
                            '<div class="ws-dim" style="margin-bottom:6px">Shared T&amp;D engine (public/js/tdModel.js) with the inputs saved in the T&amp;D modeler for this well; this run’s BHA; not saved. Hook load covers the bit depths this run drills (the run-end depth belongs to the next run).</div>' +
                            plots.map(function(p, i){ return '<div class="ws-chart"><div class="ws-ct">' + p[0] + '</div><div class="ws-cbox"><canvas data-i="' + i + '"></canvas></div></div>'; }).join('');
                        if(!window.Chart) return;
                        plots.forEach(function(p, i){ var cv = el.querySelector('canvas[data-i="' + i + '"]'), ds = p[4].filter(function(x){ return x.data.length && x.data.some(function(q){ return q.y != null && isFinite(q.y); }); });
                            if(!ds.length){ cv.parentNode.innerHTML = '<span class="ws-dim">No data.</span>'; return; }
                            // 2026-11-15 (John): snapshot charts (along the string) end at the bit depth (Chart.js padded the axis to 5000 m); hook load keeps its own range
                            var op = chartOpts(p[1], p[2], p[3]), bitMd = (d.snapshot && isFinite(d.snapshot.md)) ? d.snapshot.md : (r.mds.length ? r.mds[r.mds.length - 1] : null);
                            if(i !== 1 && bitMd != null){ op.scales.x.min = 0; op.scales.x.max = bitMd; }
                            CHARTS[id].push(new Chart(cv.getContext('2d'), { type: 'line', data: { datasets: ds }, options: op })); });
                    }
                    async function lazyTD(el, force){
                        var id = el.getAttribute('data-run'); el.innerHTML = '<span class="ws-dim">Calculating T&amp;D for this run…</span>';
                        try{ if(force || !RUNTD[id]) RUNTD[id] = await (await fetch('/notes/wellStructure/' + NOTE_ID + '/runTD/' + id)).json(); var d = RUNTD[id];
                            if(!d.ok){ el.innerHTML = '<span class="ws-note">' + esc(d.error) + '</span>'; return; } drawRunTD(el, d); }
                        catch(err){ el.innerHTML = '<span class="ws-note">' + esc(err.message) + '</span>'; }
                    }
                    // 2026-11-15: hole sections & BHA runs of the wellbore (T&D plan of the active scenario), same idea as the T&D page bar
                    async function lazySections(el){
                        var d = await wbTD(el.getAttribute('data-wk'));
                        if(!d.ok || (!d.sections.length && !d.runs.length)){ el.innerHTML = '<div class="ws-dim" style="margin-bottom:6px">Hole sections &amp; BHA runs: ' + esc(d.ok ? 'none in the T&D plan yet' : d.error) + '</div>'; return; }
                        var td = Math.max(+d.params.td || 0, d.sections.concat(d.runs).reduce(function(m, x){ return Math.max(m, x.to || 0); }, 0)) || 1, pc = function(v){ return (100 * Math.max(0, Math.min(v, td)) / td).toFixed(3) + '%'; };
                        var SC = ['#2a5bd7', '#0e8077', '#6d3fd0', '#b5651d', '#2e7d32', '#a8326b'], step = td > 4000 ? 1000 : td > 1500 ? 500 : 250, ticks = '';
                        for(var t = 0; t < td; t += step) ticks += '<span class="ws-tk" style="left:' + pc(t) + '">' + t + '</span>';
                        var bar = function(items, color, label){ return items.map(function(x, i){ return '<div class="ws-seg" title="' + esc(label(x) + ' · ' + f(x.from, 1) + '–' + f(x.to, 1) + ' m') + '" style="left:' + pc(x.from) + ';width:calc(' + pc(x.to) + ' - ' + pc(x.from) + ');background:' + color(x, i) + '">' + esc(label(x)) + '</div>'; }).join(''); };
                        var used = d.runs.filter(function(x){ return x.use; }).sort(function(a, b){ return a.from - b.from; }), gaps = [], pos = 0;
                        used.forEach(function(x){ if(x.from > pos + 0.5) gaps.push({ from: pos, to: x.from }); pos = Math.max(pos, x.to); }); if(pos < td - 0.5) gaps.push({ from: pos, to: td });
                        el.innerHTML = '<div class="ws-sub2">Hole sections &amp; BHA runs <span class="ws-dim">· T&amp;D plan, scenario “' + esc(d.scenario) + '”</span></div><div class="ws-hs">' +
                            '<div class="ws-ticks">' + ticks + '<span class="ws-tk" style="left:auto;right:0">TD ' + f(td, 0) + ' m</span></div>' +
                            '<div class="ws-lane">' + bar(d.sections, function(x, i){ return SC[i % SC.length]; }, function(x){ return (x.name || 'Section') + (x.hole_m ? ' · ' + f(x.hole_m * 1000, 0) + ' mm' : ''); }) + '</div>' +
                            '<div class="ws-lane">' + gaps.map(function(g){ return '<div class="ws-seg ws-gap" title="No T&amp;D run ' + f(g.from, 0) + '–' + f(g.to, 0) + ' m" style="left:' + pc(g.from) + ';width:calc(' + pc(g.to) + ' - ' + pc(g.from) + ')"></div>'; }).join('') +
                                bar(d.runs, function(x){ return x.use ? '#00c8ff' : '#5a7080'; }, function(x){ return (x.name || 'Run') + (x.use ? '' : ' (not used)'); }) + '</div></div>' +
                            '<div class="wbt-table-wrap" style="max-height:220px;margin:6px 0 10px"><table class="wbt-table"><thead><tr><th>Item</th><th>From (m)</th><th>To (m)</th><th>Detail</th></tr></thead><tbody>' +
                            d.sections.map(function(x){ return '<tr><td>Section ' + esc(x.name || '') + '</td><td>' + f(x.from, 1) + '</td><td>' + f(x.to, 1) + '</td><td>hole ' + f(x.hole_m * 1000, 0) + ' mm · mud ' + f(x.mudDens, 0) + ' kg/m³ · OH FF ' + f(x.ffOH, 2) + '</td></tr>'; }).join('') +
                            d.runs.map(function(x){ return '<tr><td>' + esc(x.name || 'Run') + '</td><td>' + f(x.from, 1) + '</td><td>' + f(x.to, 1) + '</td><td>' + x.bhaParts + ' BHA parts' + (x.use ? '' : ' · not used in T&amp;D') + '</td></tr>'; }).join('') +
                            gaps.map(function(g){ return '<tr><td class="ws-note">No T&amp;D run</td><td>' + f(g.from, 1) + '</td><td>' + f(g.to, 1) + '</td><td class="ws-note">hook load uses the nearest run there</td></tr>'; }).join('') + '</tbody></table></div>';
                    }
                    // 2026-11-15: survey stations of the run (MD from–to) — same columns as the Trajectories table
                    async function lazyStations(el){
                        var sel = el.parentNode.querySelector('.ws-svsel[data-run="' + el.getAttribute('data-run') + '"]'); if(!sel) return;
                        el.innerHTML = '<span class="ws-dim">Loading stations…</span>';
                        try{
                            var d = await (await fetch('/notes/wellStructure/' + NOTE_ID + '/stations?id=' + encodeURIComponent(sel.value) + '&from=' + el.getAttribute('data-from') + '&to=' + el.getAttribute('data-to'))).json();
                            if(!d.ok) throw new Error(d.error);
                            var C = [['md', 'MD', 2], ['incl', 'Incl', 2], ['azim', 'Azim', 2], ['tvd', 'TVD', 2], ['subSea', 'Sub-Sea', 2], ['vertSec', 'Vert. Sec.', 2], ['localN', 'Local N', 2], ['localE', 'Local E', 2], ['dogleg', 'Dogleg', 2], ['northing', 'Northing', 2], ['easting', 'Easting', 2]];
                            el.innerHTML = '<div class="ws-dim" style="margin:4px 0">' + d.rows.length + ' stations · <span class="ws-tag ok">' + esc(d.label) + '</span> ' + esc(d.name) + '</div>' +
                                (d.rows.length ? '<div class="wbt-table-wrap" style="max-height:360px"><table class="wbt-table"><thead><tr>' + C.map(function(c){ return '<th>' + c[1] + '</th>'; }).join('') + '<th>Comments</th></tr></thead><tbody>' +
                                d.rows.map(function(x){ return '<tr' + (x.interp ? ' title="SSA fill-in station" style="opacity:.75"' : '') + '>' + C.map(function(c){ return '<td>' + f(x[c[0]], c[2]) + '</td>'; }).join('') + '<td style="text-align:left">' + esc(x.comments) + (x.interp ? ' (fill-in)' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<span class="ws-dim">No stations in this run’s MD range.</span>');
                        }catch(err){ el.innerHTML = '<span class="ws-note">' + esc(err.message) + '</span>'; }
                    }
                    function lazyLoad(el, force){ if(el.getAttribute('data-done') && !force) return; el.setAttribute('data-done', '1'); var t = el.getAttribute('data-lazy');
                        if(t === 'sections') lazySections(el); else if(t === 'stations') lazyStations(el); else
                        if(t === 'geom') lazyGeom(el); else if(t === 'bha') lazyBha(el); else if(t === 'td') lazyTD(el, force); }
                    function visible(el){ var d = el.parentNode; while(d && d !== document.body){ if(d.tagName === 'DETAILS' && !d.open) return false; d = d.parentNode; } return true; }
                    function loadVisible(){ document.querySelectorAll('#wsTree .ws-lazy').forEach(function(el){ if(visible(el)) lazyLoad(el); }); }
                    function remember(){ document.querySelectorAll('#wsTree details[data-k]').forEach(function(d){ OPEN[d.getAttribute('data-k')] = d.open; }); }
                    async function api(method, url, body){ var r = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), d = await r.json().catch(function(){ return {}; }); if(!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status)); return d; }
                    async function load(){
                        try{ var r = await fetch('/notes/wellStructure/' + NOTE_ID), d = await r.json(); if(!d.ok) throw new Error(d.error || r.status); remember(); DATA = d; render(); }
                        catch(err){ $('wsStatus').innerHTML = '<span style="color:#ff5c5c">' + esc(err.message) + '</span>'; }
                    }
                    async function build(){
                        var p = DATA ? DATA.proposal : [], nb = 0, nr = 0; p.forEach(function(w){ nb += w.wellbores.length; w.wellbores.forEach(function(b){ nr += b.runs.length; }); });
                        if(!confirm((DATA && DATA.saved ? 'REBUILD' : 'Build') + ' the well structure of this job from its current data?\n\n' + p.length + ' well(s), ' + nb + ' wellbore(s), ' + nr + ' run(s) (runs + BHAs from the T&D plans).' +
                            (DATA && DATA.saved ? '\n\nKept: surveys you assigned to a wellbore (same well / wellbore names), survey types and plan versions, BHAs already in the T&D plan.\nReplaced: well names / UWIs typed here and runs that exist only here (not in the T&D plan).' : '') + '\n\nNo survey, T&D, hydraulics or other data is changed.')) return;
                        try{ await api('POST', '/notes/wellStructure/' + NOTE_ID + '/build'); await load(); }catch(err){ alert('Build failed: ' + err.message); }
                    }
                    function findWell(id){ return (DATA.saved || []).find(function(w){ return String(w.id) === String(id); }); }
                    function findWb(id){ var o = null; (DATA.saved || []).forEach(function(w){ w.wellbores.forEach(function(b){ if(String(b.id) === String(id)) o = { w: w, b: b }; }); }); return o; }
                    function findRun(id){ var o = null; (DATA.saved || []).forEach(function(w){ w.wellbores.forEach(function(b){ b.runs.forEach(function(r){ if(String(r.id) === String(id)) o = { b: b, r: r }; }); }); }); return o; }
                    function freeKeys(cur){ var used = {}; (DATA.saved || []).forEach(function(w){ w.wellbores.forEach(function(b){ used[b.wellKey] = 1; }); }); return (DATA.wellKeys || []).filter(function(k){ return !used[k] || k === cur; }); }
                    function pickKey(cur){
                        var keys = freeKeys(cur); if(!keys.length){ alert('Every subject survey well of this job is already linked to a wellbore. Upload the survey first (wellbore = one survey well).'); return null; }
                        var s = prompt('Survey well for this wellbore — type the number:\n\n' + keys.map(function(k, i){ return (i + 1) + '. ' + k; }).join('\n'), cur ? String(keys.indexOf(cur) + 1) : '1');
                        if(s == null) return null; var k = keys[(+s || 0) - 1]; if(!k){ alert('Not in the list.'); return null; } return k;
                    }
                    function readRun(det){
                        var g = function(f){ var e = det.querySelector('[data-f="' + f + '"]'); return e ? e.value : ''; };
                        var bha = Array.prototype.map.call(det.querySelectorAll('.ws-bha tbody tr'), function(tr){ var q = function(f){ return tr.querySelector('[data-f="' + f + '"]').value; };
                            return { name: q('name'), od_m: q('od') === '' ? null : +q('od') * IN, id_m: q('id') === '' ? null : +q('id') * IN, len: +q('len') || 0, wt: q('wt') === '' ? null : +q('wt'), material: q('mat') }; });
                        return { name: g('rname'), mdFrom: g('from'), mdTo: g('to'), sensor: g('sensor'), bendDeg: g('bdeg'), bendDist: g('bdist'), bha: bha };
                    }
                    async function act(e){
                        var t = e.target.closest('[data-act]'), root = $('wsTree').parentNode; if(!t || !root.contains(t)) return; e.preventDefault(); e.stopPropagation();
                        var a = t.getAttribute('data-act'), id = t.getAttribute('data-id'), base = '/notes/wellStructure/' + NOTE_ID;
                        try{
                            if(a === 'rowAdd'){ var tb = t.closest('.ws-in').querySelector('.ws-bha tbody'); tb.insertAdjacentHTML('beforeend', bhaRows([{ name: '', material: 'Steel' }])); return; }
                            if(a === 'rowDel'){ t.closest('tr').remove(); return; }
                            if(a === 'rowUp'){ var row = t.closest('tr'); if(row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); return; }
                            if(a === 'tdRecalc'){ lazyLoad(t.closest('.ws-lazy'), true); return; }
                            remember();
                            if(a === 'wellEdit'){ var w = findWell(id), n = prompt('Well name:', w.name); if(n == null) return; var u = prompt('UWI / licence (optional):', w.uwi || ''); if(u == null) return; await api('POST', base + '/well', { id: id, name: n, uwi: u }); }
                            else if(a === 'wellDel'){ if(!confirm('Delete this well and its wellbores / runs from the structure?\n\nRuns that exist only here (and their BHAs) are lost. Surveys, T&D plans and other data are NOT deleted.')) return; await api('DELETE', base + '/well/' + id); }
                            else if(a === 'wbAdd'){ var k = pickKey(); if(!k) return; var nm = prompt('Wellbore name (L01 = main bore, L02…, ST1…):', (k.match(/_L(\d+)$/i) ? 'L' + k.match(/_L(\d+)$/i)[1].padStart(2, '0') : 'L01')); if(!nm) return; await api('POST', base + '/wellbore', { wellId: id, name: nm, wellKey: k }); }
                            else if(a === 'wbEdit'){ var o = findWb(id), nm2 = prompt('Wellbore name:', o.b.name); if(!nm2) return; var k2 = confirm('Change the survey well linked to this wellbore?\n\nNow: ' + o.b.wellKey) ? pickKey(o.b.wellKey) : o.b.wellKey; if(!k2) return; await api('POST', base + '/wellbore', { id: id, wellId: o.w.id, name: nm2, wellKey: k2 }); }
                            else if(a === 'wbDel'){ if(!confirm('Delete this wellbore and its runs from the structure?\n\nRuns that exist only here (and their BHAs) are lost. Surveys, T&D plans and other data are NOT deleted.')) return; await api('DELETE', base + '/wellbore/' + id); }
                            else if(a === 'runAdd'){ var ob = findWb(id), last = ob.b.runs[ob.b.runs.length - 1], rn = prompt('Run name:', 'Run ' + (ob.b.runs.length + 1)); if(!rn) return;
                                var fr = prompt('MD from (m):', last ? iv(last.mdTo, 2) : '0'); if(fr == null) return; var to = prompt('MD to (m):', ''); if(to == null) return;
                                var d = await api('POST', base + '/run', { wellboreId: id, name: rn, mdFrom: fr, mdTo: to, bha: [] }); OPEN['r' + d.id] = true; OPEN['r' + d.id + 'b'] = true;
                                if(!d.td.pushed) alert('Run saved in Wells. Not added to the T&D plan: ' + d.td.reason + '.'); }
                            else if(a === 'runSave'){ var det = t.closest('.ws-run'), body = readRun(det); body.id = id; var msg = det.querySelector('.ws-msg'); msg.textContent = 'Saving…';
                                var d2 = await api('POST', base + '/run', body); msg.textContent = d2.td.pushed ? 'Saved · pushed to T&D (scenario “' + d2.td.scenario + '”)' : 'Saved in Wells · not in T&D: ' + d2.td.reason; }
                            else if(a === 'runDel'){ var or = findRun(id); if(!confirm('Delete run “' + or.r.name + '” and its BHA?')) return; var td = or.r.tdRunId && confirm('Also remove its run from the T&D plan?\n\nOK = remove from T&D too · Cancel = keep the T&D plan run (it will come back here when T&D saves).');
                                await api('DELETE', base + '/run/' + id + (td ? '?td=1' : '')); }
                            else if(a === 'trajAssign'){ var tr = t.closest('tr'), to = tr.querySelector('[data-to]').value, ty = tr.querySelector('[data-ty]').value, pv = tr.querySelector('[data-pv]').value, body2 = { trajId: id, designation: ty, planVersion: ty === 'plan' ? pv : '' };
                                if(!ty && !confirm('No type (Plan / Actual) chosen. Assign anyway?')) return;
                                if(!to){ alert('Pick where to assign it.'); return; }
                                if(to.indexOf('wb:') === 0) body2.wellboreId = to.slice(3);
                                else if(to.indexOf('nw:') === 0){ var nb2 = prompt('New wellbore name (L01 = main bore, L02…, ST1…):', (/_L(\d+)$/i.exec(tr.querySelector('b').textContent) ? 'L' + /_L(\d+)$/i.exec(tr.querySelector('b').textContent)[1].padStart(2, '0') : 'L01')); if(!nb2) return; body2.newWellbore = { wellId: to.slice(3), name: nb2 }; }
                                else { var bm2 = /^\s*(\[\d+[A-Za-z]*\])/.exec(tr.querySelector('b').textContent), nw2 = prompt('New well name:', bm2 ? tr.querySelector('b').textContent.replace(/_L\d+$/i, '') : tr.querySelector('b').textContent); if(!nw2) return; body2.newWell = { name: nw2, uwi: '' }; body2.newWellbore = { name: '' }; }
                                await api('POST', base + '/assign', body2); }
                            else if(a === 'trajType'){ var li = t.closest('li'), ty2 = li.querySelector('[data-ty]').value, pvi = li.querySelector('[data-pv]'); await api('POST', base + '/assign', { trajId: id, designation: ty2, planVersion: ty2 === 'plan' ? (pvi ? pvi.value : '') : '' }); }
                            else if(a === 'trajEng'){ var li2 = t.closest('[data-run], .ws-wb'), wbid = (DATA.trajs.find(function(q){ return String(q.id) === String(id); }) || {}).wellboreId;
                                if(!confirm('Use this survey for engineering in this wellbore?\n\nT&D, Hydraulics, Casing Design, Slide Sheets and survey corrections are saved per survey name, so this wellbore will show the engineering cases of THIS survey (the others are kept, not deleted).')) return;
                                await api('POST', base + '/assign', { trajId: id, wellboreId: wbid, useForEngineering: true }); }
                            else if(a === 'trajUn'){ if(!confirm('Unassign this survey from the wellbore? (It goes back to “Unassigned”; nothing is deleted.)')) return; await api('POST', base + '/assign', { trajId: id, wellboreId: null }); }
                            else if(a === 'addWell'){ var wn = prompt('Well name:'); if(!wn) return; var wu = prompt('UWI / licence (optional):', '') || ''; await api('POST', base + '/well', { name: wn, uwi: wu }); }
                            await load();
                        }catch(err){ alert(err.message); }
                    }
                    document.addEventListener('DOMContentLoaded', function(){
                        var c = $('collapseWells'); if(!c) return;
                        c.addEventListener('show.bs.collapse', function(){ if(!loaded){ loaded = true; load(); } });
                        var b = $('wsBuildBtn'); if(b) b.addEventListener('click', build);
                        $('wsTree').parentNode.addEventListener('click', act);   // tree + "+ Well" button
                        $('wsTree').addEventListener('toggle', function(e){ if(e.target.open) loadVisible(); }, true);   // 2026-11-15 lazy content
                        $('wsTree').addEventListener('change', function(e){ if(e.target.classList.contains('ws-svsel')){ var el = $('wsTree').querySelector('.ws-lazy[data-lazy="stations"][data-run="' + e.target.getAttribute('data-run') + '"]'); if(el) lazyLoad(el, true); } });
                    });
                })();
                
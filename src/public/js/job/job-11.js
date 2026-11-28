/* MTX Conveyor — job page script 11. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 13864) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const PASON_NOTE_ID = window.MTX_JOB.noteId;
    // The T&D accordion is now available to every role. This guard just
    // protects against the element genuinely being absent for any reason.
    if(!document.getElementById('tdWellSelect2')) return;
    const dataEl = document.getElementById('tdModelData');
    if(!dataEl){ console.log('[T&D] #tdModelData element not found on this page.'); return; }
    let tdDoc;
    try { tdDoc = JSON.parse(dataEl.textContent); } catch(e){ console.error('[T&D] Failed to parse tdModelData JSON:', e); tdDoc = null; }
    if(tdDoc && !tdDoc.resultsByWell) tdDoc.resultsByWell = {};
    console.log('[T&D] tdModel loaded:', tdDoc ? { wellsWithResults: Object.keys(tdDoc.resultsByWell || {}) } : null);

    // Same bracket-prefix + _LNN subject-well convention used everywhere else.
    function tdIsSubjectWell(well){
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
        return wbtArr.filter(function(w){ return w.survey && w.survey.length && tdIsSubjectWell(w); })
                      .map(function(w){ return w.wellName; })
                      .sort();
    }

    const isLight = document.body.classList.contains('light-mode');
    const tdTextColor = isLight ? '#000000' : '#ffffff';
    const tdTickColor = isLight ? '#495057' : '#ffffff';
    const tdGridColor = isLight ? 'rgba(0,0,0,.15)' : 'rgba(30,45,61,.6)';
    const tdTooltipBg = isLight ? '#ffffff' : '#161e28';
    const tdTooltipBorder = isLight ? '#c8d4de' : '#1e2d3d';
    const tdWrapEl = document.getElementById('tdChartsWrap');
    if(tdWrapEl) tdWrapEl.style.background = isLight ? '#ffffff' : '#1b1e21';

    const CO = {
        responsive: false,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
            legend: { labels: { color: tdTextColor, font: { family: 'Share Tech Mono', size: 13 }, boxWidth: 14, padding: 10 } },
            tooltip: {
                bodyFont: { family: 'Share Tech Mono', size: 13 }, titleFont: { family: 'Share Tech Mono', size: 13 },
                backgroundColor: tdTooltipBg, borderColor: tdTooltipBorder, borderWidth: 1, padding: 7,
                bodyColor: tdTextColor, titleColor: tdTextColor
            },
            zoom: { pan:{enabled:true, mode:'xy'}, zoom:{ wheel:{enabled:true, modifierKey:'ctrl'}, pinch:{enabled:true}, mode:'xy' } }
        },
        scales: {
            x: { type: 'linear', ticks: { color: tdTickColor, font: { family: 'Share Tech Mono', size: 12 }, maxTicksLimit: 8 }, grid: { color: tdGridColor } },
            y: { ticks: { color: tdTickColor, font: { family: 'Share Tech Mono', size: 12 } }, grid: { color: tdGridColor } }
        }
    };
    function axT(txt){ return { display:true, text:txt, color: tdTickColor, font:{family:'Share Tech Mono', size:13} }; }
    function hexToRgba(hex, alpha){
        var h = String(hex).replace('#','');
        if(h.length === 3) h = h.split('').map(c => c + c).join('');
        var r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function mkLine(lbl, data, xdata, color, dash, fillIt){
        return {
            label: lbl,
            data: xdata.map((x,i) => ({x, y: data[i]})),
            borderColor: color,
            backgroundColor: fillIt ? hexToRgba(color, 0.15) : undefined,
            borderWidth: 1.8, pointRadius: 0, fill: fillIt ? 'origin' : false,
            tension: 0.3, borderDash: dash || [], parsing: false, type: 'line'
        };
    }

    // Give a canvas an explicit pixel size (attribute + inline CSS, both
    // required) so Chart.js never needs to measure a possibly-hidden
    // ancestor's layout box.
    function sizeCanvas(canvas, w, h){
        canvas.width = w; canvas.height = h;
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }

    let tdChartInstances = [];
    function destroyTDCharts(){
        tdChartInstances.forEach(ch => { try{ ch.destroy(); }catch(e){} });
        tdChartInstances = [];
    }

    // =============================================================
    // WELLBORE GEOMETRY + BHA SCHEMATIC — ported from uploadTorqueAndDrag.ejs
    // (see that file for the fuller commentary on the design decisions:
    // bit-driven width ratio, min-max width stretch, equal-height BHA
    // rows, bit-only photo). Reads from currentCasings/currentBha/
    // currentParams (already loaded for the selected well/scenario, and
    // always metric — job.ejs never runs in imperial) instead of live
    // form inputs, since there's no editable T&D form on this page.
    // =============================================================
    // 2026-11-15 (John, well structure): optional `opt` so the Wells accordion can draw the same schematic for a
    // wellbore (part 'well') or a run's BHA (part 'bha', params.td = run end): { inner, wrap, casings, bha, params,
    // results: {mds, incArr}, wellKey, part }. Without opt it works exactly as before (T&D accordion).
    function renderTDSchematic(opt){
        opt = opt || {};
        var inner = opt.inner || document.getElementById('tdSchematicInner');
        var wrap = opt.wrap || document.getElementById('tdSchematicWrap');
        if(!inner || !wrap) return;
        var casings = opt.casings || currentCasings || [];
        var p = opt.params || currentParams || {};
        var td_m = p.td;
        var bhaSrc = opt.bha || currentBha || [];
        if(!casings.length && !bhaSrc.length || !td_m){ wrap.style.display = 'none'; return; }
        var ohDiam_mm = (p.ohDiam_m || 0) * 1000;
        var ohTop_m = p.ohTop || 0;
        var currentWellKey = opt.wellKey || (wellSelect ? wellSelect.value : null);

        // Display-only BHA: the modeled BHA's cumulative length rarely lands
        // exactly on this well's own TD (which can differ well-to-well).
        // Overshoot (BHA longer than TD, e.g. a full-string model run
        // against a shallower well) is handled by trimming meters off the
        // shallow end (never the bit, which is bha[0] — see the modeler's
        // bit-first ordering): the exceeding length is cut from the
        // shallowest element first; if that element isn't long enough to
        // absorb it, it's dropped entirely and the remainder carries over
        // to the next element in, stopping as soon as the excess reaches
        // zero. No real component's length is ever stretched to cover an
        // overshoot — only trimmed or dropped. A shortfall (BHA doesn't
        // reach surface) is filled by extending the shallowest surviving
        // element, since that's filler pipe rather than a real measured
        // joint. This never touches the saved BHA, only what's drawn.
        function getDisplayBha(bhaArr, tdVal){
            if(!bhaArr || !bhaArr.length) return [];
            var disp = bhaArr.map(function(c){ return Object.assign({}, c); });
            var MIN_LEN = 0.1;
            var total = disp.reduce(function(s, c){ return s + c.len; }, 0);
            if(total > tdVal){
                var excess = total - tdVal;
                while(excess > 0 && disp.length > 1){
                    var lastIdx = disp.length - 1;
                    var lastLen = disp[lastIdx].len;
                    if(excess >= lastLen){
                        disp.pop();
                        excess -= lastLen;
                    } else {
                        disp[lastIdx].len = lastLen - excess;
                        excess = 0;
                    }
                }
                if(excess > 0){
                    // Only the bit is left and it's still longer than TD on
                    // its own — a data problem elsewhere, not something to
                    // paper over further; just floor it so nothing breaks.
                    disp[0].len = Math.max(MIN_LEN, disp[0].len - excess);
                }
            } else if(total < tdVal){
                var delta = tdVal - total;
                disp[disp.length - 1].len += delta;
            }
            return disp;
        }
        var bha = getDisplayBha(bhaSrc, td_m);

        // Inclination-at-MD, interpolated from this well's own computed T&D
        // survey (currentResults.mds / .incArr) — already on hand from the
        // last calculation, so no extra lookup is needed.
        function inclAtMD(md){
            var r = opt.results || currentResults;
            if(!r || !r.mds || !r.mds.length || !r.incArr || !r.incArr.length) return null;
            var mds = r.mds, incs = r.incArr;
            if(md <= mds[0]) return incs[0];
            if(md >= mds[mds.length - 1]) return incs[incs.length - 1];
            for(var i = 1; i < mds.length; i++){
                if(md <= mds[i]){
                    var m0 = mds[i - 1], m1 = mds[i], i0 = incs[i - 1], i1 = incs[i];
                    if(m1 === m0) return i0;
                    return i0 + (i1 - i0) * (md - m0) / (m1 - m0);
                }
            }
            return incs[incs.length - 1];
        }
        function fmtDI(md){
            var inc = inclAtMD(md);
            return md.toFixed(0) + ' m' + (inc != null ? ', ' + inc.toFixed(1) + '\u00b0' : '');
        }

        var isLight = document.body.classList.contains('light-mode');
        var COL = {
            bg: isLight ? '#ffffff' : '#111820',
            border: isLight ? '#c8d4de' : '#1e2d3d',
            text: isLight ? '#000000' : '#c8d8e8',
            textDim: isLight ? '#495057' : '#5a7080',
            formation: isLight ? 'rgba(180,150,110,.30)' : 'rgba(180,150,110,.18)',
            casing: isLight ? '#9aa5b1' : '#6b7686',
            casingStroke: isLight ? '#5a6472' : '#3a4552',
            pipe: isLight ? '#7a8b9a' : '#5a7080',
            collarStroke: isLight ? '#5a6472' : '#4a5561',
            tick: isLight ? '#495057' : '#5a7080'
        };
        var TYPE_PALETTE = ['#8a95a1', '#5a7080', '#7d9e34', '#d6336c', '#16a085', '#9b59b6', '#e67e22', '#3498db'];
        function hashColor(name){
            var h = 0;
            for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
            return TYPE_PALETTE[h % TYPE_PALETTE.length];
        }
        function componentColor(name){
            var n = (name || '').toLowerCase();
            if (n.indexOf('bit') !== -1) return '#c0392b';
            if (/nmdc|non[-\s]?mag/.test(n)) return '#8e44ad';
            if (n.indexOf('stab') !== -1) return '#d4a017';
            if (n.indexOf('motor') !== -1) return '#16a085';
            if (n.indexOf('underream') !== -1) return '#7d9e34';
            if (n.indexOf('accelerat') !== -1) return '#d6336c';
            if (n.indexOf('heavy weight') !== -1 || n.indexOf('hwdp') !== -1) return '#e67e22';
            if (n.indexOf('collar') !== -1) return '#7a8590';
            if (n.indexOf('drill pipe') !== -1 || /^dp\b/.test(n)) return '#2e86c1';
            if (n.indexOf('sub') !== -1) return '#5a7080';
            return hashColor(n);
        }
        var BIT_ICON_URL = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1665762065/bit-pdc-2-removebg-preview_jqyvef.png';
        function isBit(name){ return /\bbit\b/i.test(name || ''); }
        function bitIconRect(x, y, w, h){
            var minH = Math.max(h, 40);
            var yy = y - (minH - h) / 2;
            return '<image href="' + BIT_ICON_URL + '" xlink:href="' + BIT_ICON_URL + '" x="' + x + '" y="' + yy +
              '" width="' + w + '" height="' + minH + '" preserveAspectRatio="xMidYMid slice"/>';
        }
        function esc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
        function fmtD(md){ return md.toFixed(0) + ' m'; }

        // ---------------- Panel A: full wellbore, true MD scale ----------------
        var pA_h = 620, pA_top = 20, pA_bot = pA_h - 20, pA_cx = 130, pA_maxHalfW = 55;
        var odsForScale = casings.map(function (c) { return c.od_m * 1000; }).concat([ohDiam_mm]).filter(function (v) { return v > 0; });
        var minOD_A = odsForScale.length ? Math.min.apply(null, odsForScale) : 1;
        var maxOD_A = odsForScale.length ? Math.max.apply(null, odsForScale) : 1;
        var A_MIN_FRAC = 0.45;
        function yA(md){ return pA_top + (md / td_m) * (pA_bot - pA_top); }
        function hwA(od_mm){
            if (maxOD_A <= minOD_A) return pA_maxHalfW;
            var frac = A_MIN_FRAC + (1 - A_MIN_FRAC) * (od_mm - minOD_A) / (maxOD_A - minOD_A);
            return Math.max(3, frac * pA_maxHalfW);
        }

        var svgA = '<svg viewBox="0 0 640 ' + pA_h + '" preserveAspectRatio="none" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background:' + COL.bg + ';display:block;">';
        var ohTopY = yA(Math.max(ohTop_m, 0)), ohBotY = yA(td_m), ohHw = hwA(ohDiam_mm);
        svgA += '<rect x="' + (pA_cx - ohHw) + '" y="' + ohTopY + '" width="' + (ohHw * 2) + '" height="' + (ohBotY - ohTopY) + '" fill="' + COL.formation + '" stroke="' + COL.tick + '" stroke-width="1" stroke-dasharray="2,3"/>';
        svgA += '<text x="' + (pA_cx + ohHw + 10) + '" y="' + ((ohTopY + ohBotY) / 2) + '" font-size="11" fill="' + COL.textDim + '" font-family="monospace">Open Hole, ' + ohDiam_mm.toFixed(2) + ' mm</text>';
        var cdMissLogged = false;
        casings.forEach(function (c) {
            var top = yA(c.top), bot = yA(c.shoe), hw = hwA(c.od_m * 1000);
            svgA += '<rect x="' + (pA_cx - hw) + '" y="' + top + '" width="' + (hw * 2) + '" height="' + (bot - top) + '" fill="' + COL.casing + '" stroke="' + COL.casingStroke + '" stroke-width="1.5"/>';
            svgA += '<text x="' + (pA_cx + hw + 10) + '" y="' + (bot - 33) + '" font-size="11" fill="' + COL.text + '" font-family="monospace" font-weight="bold">' + esc(c.name) + '</text>';
            svgA += '<text x="' + (pA_cx + hw + 10) + '" y="' + (bot - 20) + '" font-size="10" fill="' + COL.textDim + '" font-family="monospace">OD ' + (c.od_m * 1000).toFixed(2) + ' mm, ID ' + (c.id_m * 1000).toFixed(2) + ' mm</text>';
            // Grade / weight / thread — from the Casing Design module (the
            // source of truth for this info; the T&D casing table itself
            // only stores OD/ID/top/shoe). Only shown once loaded/matched.
            var cdInfo = casingDesignInfoFor(currentWellKey, c.name);
            if(cdInfo){
                var gwt = [
                    cdInfo.grade || null,
                    (cdInfo.weight_kgpm != null && !isNaN(cdInfo.weight_kgpm) ? Number(cdInfo.weight_kgpm).toFixed(1) + ' kg/m' : null),
                    cdInfo.thread || null
                ].filter(function (v) { return v; }).join(', ');
                if(gwt) svgA += '<text x="' + (pA_cx + hw + 10) + '" y="' + (bot - 7) + '" font-size="10" fill="' + COL.textDim + '" font-family="monospace">' + esc(gwt) + '</text>';
            } else if(!cdMissLogged){
                cdMissLogged = true;
                console.log('[T&D] No Casing Design match for well "' + currentWellKey + '" casing "' + c.name +
                    '" — check the Casing Design module has a string with that exact name saved for this well.');
            }
            [c.top, c.shoe].forEach(function (md) {
                var y = yA(md);
                svgA += '<line x1="8" y1="' + y + '" x2="' + (pA_cx - hw) + '" y2="' + y + '" stroke="' + COL.tick + '" stroke-width="1" stroke-dasharray="1,2"/>';
                svgA += '<text x="4" y="' + (y + 3) + '" font-size="9" fill="' + COL.textDim + '" font-family="monospace" text-anchor="start">' + fmtD(md) + '</text>';
            });
        });
        var bhaTop_m = td_m;
        bha.forEach(function (c) { bhaTop_m -= c.len; });
        if (bhaTop_m > 0) {
            var dpTopY = yA(0), dpBotY = yA(bhaTop_m);
            svgA += '<rect x="' + (pA_cx - 5) + '" y="' + dpTopY + '" width="10" height="' + (dpBotY - dpTopY) + '" fill="' + COL.pipe + '" stroke="' + COL.casingStroke + '" stroke-width="1"/>';
        }
        [0, td_m].forEach(function (md) {
            var y = yA(md);
            svgA += '<line x1="8" y1="' + y + '" x2="' + pA_cx + '" y2="' + y + '" stroke="' + COL.tick + '" stroke-width="1"/>';
            svgA += '<text x="4" y="' + (y + 3) + '" font-size="9" fill="' + COL.text + '" font-family="monospace" font-weight="bold">' + fmtD(md) + '</text>';
        });
        svgA += '</svg>';

        // ---------------- Panel B: BHA detail, equal-height rows ----------------
        var svgB = '';
        if (bha.length) {
            // pB_cx pushed right (was 50) to leave room for the tick labels,
            // which now carry "MD, inclination°" (longer than plain MD) —
            // at the old position that text ran directly into the component
            // boxes and was unreadable.
            var pB_top = 20, pB_cx = 120, pB_maxHalfW = 15;
            var OTHER_ROW_H = 50;
            var maxOD_B = bha.reduce(function (m, c) { return Math.max(m, c.od_m * 1000); }, 1);
            function hwB(od_mm){ return Math.max(4, (od_mm / maxOD_B) * pB_maxHalfW); }
            var bitEntry = bha.filter(function (c) { return isBit(c.name); })[0] || bha[0];
            var baseBitHw = hwB(bitEntry.od_m * 1000);
            var otherHw = baseBitHw * 0.75 * 0.8;
            var bitHw = baseBitHw * 1.2 * 1.2;
            var BIT_ROW_H = Math.max(40, bitHw * 1.9);

            var cursor = td_m;
            var withMD = bha.map(function (c) {
                var bot = cursor, top = cursor - c.len; cursor = top;
                return { c: c, top: top, bot: bot };
            });
            var bhaTopMD = cursor;
            var stack = withMD.slice().reverse();
            var pB_h = pB_top + stack.reduce(function (h, r) { return h + (isBit(r.c.name) ? BIT_ROW_H : OTHER_ROW_H); }, 0) + 20;

            svgB = '<svg viewBox="0 0 640 ' + pB_h + '" preserveAspectRatio="none" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="background:' + COL.bg + ';display:block;">';
            svgB += '<line x1="8" y1="' + pB_top + '" x2="' + pB_cx + '" y2="' + pB_top + '" stroke="' + COL.tick + '" stroke-width="1"/>';
            svgB += '<text x="4" y="' + (pB_top + 3) + '" font-size="9" fill="' + COL.text + '" font-family="monospace" font-weight="bold">' + fmtDI(bhaTopMD) + '</text>';

            var y = pB_top;
            stack.forEach(function (r) {
                var c = r.c, bit = isBit(c.name);
                var rowH = bit ? BIT_ROW_H : OTHER_ROW_H;
                var yTop = y, yBot = y + rowH;
                var hw = bit ? bitHw : otherHw;
                var fill = bit ? 'none' : componentColor(c.name);
                svgB += '<rect x="' + (pB_cx - hw) + '" y="' + yTop + '" width="' + (hw * 2) + '" height="' + rowH + '" fill="' + fill + '"' + (bit ? '' : ' stroke="' + COL.collarStroke + '" stroke-width="1"') + '/>';
                if (bit) svgB += bitIconRect(pB_cx - hw, yTop, hw * 2, rowH);
                svgB += '<text x="' + (pB_cx + hw + 10) + '" y="' + ((yTop + yBot) / 2 - 4) + '" font-size="11" fill="' + COL.text + '" font-family="monospace" font-weight="bold">' + esc(c.name) + '</text>';
                svgB += '<text x="' + (pB_cx + hw + 10) + '" y="' + ((yTop + yBot) / 2 + 9) + '" font-size="10" fill="' + COL.textDim + '" font-family="monospace">OD ' + (c.od_m * 1000).toFixed(2) + ' mm, ID ' + (c.id_m * 1000).toFixed(2) + ' mm, ' + c.wt.toFixed(2) + ' kg/m</text>';
                svgB += '<line x1="8" y1="' + yBot + '" x2="' + (pB_cx - hw) + '" y2="' + yBot + '" stroke="' + COL.tick + '" stroke-width="1" stroke-dasharray="1,2"/>';
                svgB += '<text x="4" y="' + (yBot + 3) + '" font-size="9" fill="' + COL.textDim + '" font-family="monospace">' + fmtDI(r.bot) + '</text>';
                y = yBot;
            });
            svgB += '</svg>';
        }

        // Both containers share the taller panel's height, with the shorter
        // SVG centered inside its own box — so a BHA with few components
        // (short SVG) doesn't look like it's floating at a different height
        // than the always-620px full wellbore panel next to it.
        var sharedH = Math.max(pA_h, svgB ? pB_h : 0);
        if(opt.part === 'well' || opt.part === 'bha'){   // 2026-11-15: one panel only, phone-friendly width
            var one = opt.part === 'well' ? svgA : svgB, oneH = opt.part === 'well' ? pA_h : (svgB ? pB_h : 0);
            inner.innerHTML = one ? '<div style="width:100%;max-width:640px;min-width:480px;"><div class="hint" style="margin-bottom:4px;font-weight:bold;color:' + COL.textDim + ';font-size:11px;">' + (opt.part === 'well' ? 'Full Wellbore (true scale)' : 'BHA Detail') + '</div><div style="width:100%;height:' + oneH + 'px;">' + one + '</div></div>' : '';
            wrap.style.display = one ? '' : 'none'; return;
        }
        inner.innerHTML =
            '<div style="width:640px;">' +
              '<div class="hint" style="margin-bottom:4px;font-weight:bold;color:' + COL.textDim + ';font-size:11px;">Full Wellbore (true scale)</div>' +
              '<div style="width:640px;height:' + sharedH + 'px;">' + svgA + '</div>' +
            '</div>' +
            (svgB ? '<div style="width:640px;">' +
              '<div class="hint" style="margin-bottom:4px;font-weight:bold;color:' + COL.textDim + ';font-size:11px;">BHA Detail</div>' +
              '<div style="width:640px;height:' + sharedH + 'px;">' + svgB + '</div>' +
            '</div>' : '');
        wrap.style.display = '';
    }

    window.MTX_TD_SCHEMATIC = renderTDSchematic;   // 2026-11-15: used by the Wells accordion (wellbore geometry, run BHA)
    function buildTDCharts(r){
        destroyTDCharts();

        const wrap = document.getElementById('tdChartsWrap');
        const panelEl = wrap ? wrap.querySelector('.td-chart-panel') : null;
        const chartW = Math.max(400, panelEl ? panelEl.clientWidth : (wrap ? wrap.clientWidth - 32 : 900));
        const chartH = 380;

        // ── 1. Effective Tension vs Measured Depth ──
        const etDS = [
            mkLine('Tripping In', r.etTI, r.mds, '#ff4060', []),
            mkLine('Tripping Out', r.etTO, r.mds, '#39ff14', []),
            mkLine('Rotating OB', r.etROB, r.mds, '#00c8ff', []),
            mkLine('Slide Drilling', r.etSLD, r.mds, '#ff6b35', [4,3]),
            mkLine('Rotating Off', r.etROff, r.mds, '#c084fc', [2,4]),
            { label:'Zero', data: r.mds.map(x => ({x, y:0})), borderColor:'rgba(255,255,255,.2)',
              borderWidth:1, borderDash:[2,5], pointRadius:0, fill:false, tension:0, parsing:false, type:'line' }
        ];
        const etCanvas = document.getElementById('td_c_et');
        sizeCanvas(etCanvas, chartW, chartH);
        tdChartInstances.push(new Chart(etCanvas.getContext('2d'), {
            type: 'line', data: { datasets: etDS },
            options: Object.assign({}, CO, {
                scales: {
                    x: Object.assign({}, CO.scales.x, { title: axT('Measured Depth (' + r.depU + ')') }),
                    y: Object.assign({}, CO.scales.y, { title: axT('Effective Tension (' + r.forU + ')') })
                }
            })
        }));

        // ── 2. Hook Load vs Bit Depth ──
        if(r.hlMDs && r.hlMDs.length){
            const hlMsgEl = document.getElementById('td_c_hl_msg');
            if(hlMsgEl) hlMsgEl.style.display = 'none';
            const hlDS = [
                mkLine('Tripping Out', r.hlTO, r.hlMDs, '#39ff14', []),
                mkLine('Rotating OB', r.hlROB, r.hlMDs, '#00c8ff', []),
                mkLine('Slide Drilling', r.hlSLD, r.hlMDs, '#ff6b35', [4,3]),
            ];
            // 5-case series (models saved after the velocity-resolved update)
            if(r.hlTI) hlDS.unshift(mkLine('Tripping In', r.hlTI, r.hlMDs, '#ff5e7a', []));
            if(r.hlROff) hlDS.push(mkLine('Rotating Off', r.hlROff, r.hlMDs, '#c084fc', [2,4]));
            const hlCanvas = document.getElementById('td_c_hl');
            hlCanvas.style.display = '';
            sizeCanvas(hlCanvas, chartW, chartH);
            tdChartInstances.push(new Chart(hlCanvas.getContext('2d'), {
                type: 'line', data: { datasets: hlDS },
                options: Object.assign({}, CO, {
                    scales: {
                        x: Object.assign({}, CO.scales.x, { title: axT('Bit Depth (' + r.depU + ')') }),
                        y: Object.assign({}, CO.scales.y, { title: axT('Surface Hook Load (' + r.forU + ')') })
                    }
                })
            }));
        } else {
            const hlCanvas = document.getElementById('td_c_hl');
            if(hlCanvas) hlCanvas.style.display = 'none';
            const hlMsg = document.getElementById('td_c_hl_msg');
            if(hlMsg) hlMsg.style.display = '';
        }

        // ── 3. Side Force vs Measured Depth ──
        // Values are already scaled to "kgf per Contact Force Normalization
        // Length" at save time (see uploadTorqueAndDrag.ejs) — WellPlan's
        // display convention, default 9.45 m (one Range 2 DP joint). Label
        // must reflect that; it is NOT kgf/m.
        const sfNL = (currentParams && currentParams.normLen) || 9.45;
        const sfDS = [
            mkLine('Tripping In', r.sfTI, r.mds, '#ff4060', []),
            mkLine('Tripping Out', r.sfTO, r.mds, '#39ff14', []),
            mkLine('Rotating OB', r.sfROB, r.mds, '#00c8ff', []),
            mkLine('Slide Drilling', r.sfSLD, r.mds, '#ff6b35', [4,3]),
            mkLine('Rotating Off', r.sfROff, r.mds, '#c084fc', [2,4]),
        ];
        const sfCanvas = document.getElementById('td_c_sf');
        sizeCanvas(sfCanvas, chartW, chartH);
        tdChartInstances.push(new Chart(sfCanvas.getContext('2d'), {
            type: 'line', data: { datasets: sfDS },
            options: Object.assign({}, CO, {
                scales: {
                    x: Object.assign({}, CO.scales.x, { title: axT('Measured Depth (' + r.depU + ')') }),
                    y: Object.assign({}, CO.scales.y, { min:0, title: axT('Side Force (kgf/' + sfNL + ' m)') })
                }
            })
        }));

        // ── 4. Surface Torque vs Measured Depth ──
        const tqDS = [
            mkLine('Rotating OB', r.tqROB, r.mds, '#ff6b35', [], true),
            mkLine('Rotating Off', r.tqROff, r.mds, '#c084fc', [2,3]),
        ];
        // 5-case series (models saved after the velocity-resolved update)
        if(r.tqSLD) tqDS.push(mkLine('Slide Drilling', r.tqSLD, r.mds, '#ffd060', [4,3]));
        if(r.tqTI) tqDS.push(mkLine('Tripping In', r.tqTI, r.mds, '#ff5e7a', []));
        if(r.tqTO) tqDS.push(mkLine('Tripping Out', r.tqTO, r.mds, '#39ff14', [6,3]));
        tqDS.push(
            { label:'Limit', data: r.mds.map(x => ({x, y: r.torqLimDisp})),
              borderColor:'#ff4060', borderWidth:1, borderDash:[4,3], pointRadius:0, fill:false, tension:0, parsing:false, type:'line' }
        );
        const tqCanvas = document.getElementById('td_c_tq');
        sizeCanvas(tqCanvas, chartW, chartH);
        tdChartInstances.push(new Chart(tqCanvas.getContext('2d'), {
            type: 'line', data: { datasets: tqDS },
            options: Object.assign({}, CO, {
                scales: {
                    x: Object.assign({}, CO.scales.x, { title: axT('MD (' + r.depU + ')') }),
                    y: Object.assign({}, CO.scales.y, { title: axT('Torque (' + r.tqU + ')') })
                }
            })
        }));

        // ── 5. Inclination vs Measured Depth ──
        const incCanvas = document.getElementById('td_c_inc');
        sizeCanvas(incCanvas, chartW, chartH);
        tdChartInstances.push(new Chart(incCanvas.getContext('2d'), {
            type: 'line',
            data: { datasets: [
                mkLine('Inclination (deg)', r.incArr, r.mds, '#39ff14', [], true),
            ]},
            options: Object.assign({}, CO, {
                scales: {
                    x: Object.assign({}, CO.scales.x, { title: axT('MD (' + r.depU + ')') }),
                    y: Object.assign({}, CO.scales.y, { min:0, title: axT('Inclination (deg)') })
                }
            })
        }));

        // ── 6. DLS vs Measured Depth ──
        const dlsCanvas = document.getElementById('td_c_dls');
        sizeCanvas(dlsCanvas, chartW, chartH);
        tdChartInstances.push(new Chart(dlsCanvas.getContext('2d'), {
            type: 'line',
            data: { datasets: [
                mkLine('DLS (deg/30m)', r.dlsArr, r.mds, '#ffd060', [], true),
            ]},
            options: Object.assign({}, CO, {
                scales: {
                    x: Object.assign({}, CO.scales.x, { title: axT('MD (' + r.depU + ')') }),
                    y: Object.assign({}, CO.scales.y, { min:0, title: axT('DLS (deg/30m)') })
                }
            })
        }));

        console.log('[T&D] Charts built (' + chartW + 'x' + chartH + ' each).');
    }

    // ── Well selection, status text, auto-recalculation ───────────────────
    const wellSelect = document.getElementById('tdWellSelect2');
    const scenarioSelect = document.getElementById('tdScenarioSelect2');
    const statusText = document.getElementById('tdStatusText');
    const emptyMsg = document.getElementById('tdEmptyMsg');
    const chartsWrap = document.getElementById('tdChartsWrap');

    // Scenarios are job-wide (shared names across every well) — see
    // models/TDModel.js. currentScenario starts as whichever scenario the
    // document says is active; picking a different one from the dropdown
    // just previews it (recalculating per well as needed) — it does NOT
    // change which scenario is "active" for the job. Use the modeler's
    // "Set as Active" button for that.
    let currentScenario = (tdDoc && tdDoc.activeScenario) || 'Default';

    function scenarioEntry(scenarioName, wellKey){
        const scen = tdDoc && tdDoc.scenarios && tdDoc.scenarios[scenarioName];
        if(scen && scen.resultsByWell && scen.resultsByWell[wellKey]) return scen.resultsByWell[wellKey];
        // Fall back to the top-level mirror (covers legacy documents saved
        // before scenarios existed, and the case where the active scenario
        // itself is selected).
        return tdDoc && tdDoc.resultsByWell ? tdDoc.resultsByWell[wellKey] : null;
    }

    function initScenarioSelect(){
        if(!tdDoc || !tdDoc.scenarios || !Object.keys(tdDoc.scenarios).length){
            scenarioSelect.style.display = 'none';
            return;
        }
        scenarioSelect.innerHTML = '';
        Object.keys(tdDoc.scenarios).forEach(function(name){
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + (name === tdDoc.activeScenario ? ' \u2b50 (active)' : '');
            scenarioSelect.appendChild(opt);
        });
        scenarioSelect.value = currentScenario;
        scenarioSelect.style.display = '';
        scenarioSelect.addEventListener('change', function(){
            currentScenario = scenarioSelect.value;
            const wellKey = wellSelect.value;
            if(!wellKey) return;
            const existing = scenarioEntry(currentScenario, wellKey);
            if(existing && existing.results){ showWellEntry(wellKey, existing); }
            else { recalcAndShow(wellKey); }
        });
    }

    // "Current settings" — whichever well's casings/bha/params were most
    // recently in play. Reused as-is when switching wells, so a well switch
    // is a true apples-to-apples comparison ("same settings, different well").
    let currentCasings = null, currentBha = null, currentParams = null, currentResults = null;

    // Grade / weight / thread for the schematic's casing labels come from
    // the Casing Design module — it's the source of truth for that info,
    // the T&D casing table only stores OD/ID/top/shoe. Already embedded
    // server-side (#casingDesignData, same pattern as #tdModelData) — no
    // extra fetch needed. Matched to the T&D casings by name.
    //
    // Looks in the active scenario first (top-level resultsByWell, same
    // mirror convention as TDModel/CasingDesign use everywhere else), then
    // falls back to ANY scenario that has a saved string for this well —
    // the T&D casing table isn't scenario-aware, so this is friendlier
    // than requiring an exact scenario match the person may not know about.
    let casingDesignDoc = null;
    (function loadCasingDesignData(){
        const dataEl = document.getElementById('casingDesignData');
        if(!dataEl) return;
        try {
            casingDesignDoc = JSON.parse(dataEl.textContent);
        } catch(err) {
            console.warn('[T&D] Failed to parse casingDesignData JSON:', err);
        }
        if(!casingDesignDoc) console.log('[T&D] No Casing Design saved for this job yet — Grade/Weight/Thread won\'t show on the schematic.');
    })();
    function casingDesignInfoFor(wellKey, casingName){
        if(!casingDesignDoc || !wellKey) return null;
        const norm = s => (s || '').trim().toLowerCase();
        function findIn(resultsByWell){
            if(!resultsByWell || !resultsByWell[wellKey]) return null;
            const strings = resultsByWell[wellKey].casingStrings || [];
            return strings.find(s => norm(s.name) === norm(casingName)) || null;
        }
        let match = findIn(casingDesignDoc.resultsByWell);
        if(match) return match;
        const scenarios = casingDesignDoc.scenarios || {};
        for(const name of Object.keys(scenarios)){
            match = findIn(scenarios[name] && scenarios[name].resultsByWell);
            if(match) return match;
        }
        return null;
    }

    function fmtWhen(iso){
        if(!iso) return '';
        return new Date(iso).toLocaleString();
    }

    function showWellEntry(wellKey, entry){
        if(!entry || !entry.results || !entry.results.mds || !entry.results.mds.length){
            if(chartsWrap) chartsWrap.style.display = 'none';
            var schematicWrap0 = document.getElementById('tdSchematicWrap');
            if(schematicWrap0) schematicWrap0.style.display = 'none';
            if(emptyMsg){
                emptyMsg.style.display = '';
                emptyMsg.textContent = 'No results yet for ' + wellKey + ' — select a well with results, or use "Recalculate" below.';
            }
            statusText.textContent = 'No results for ' + wellKey + '.';
            return;
        }
        currentCasings = entry.casings; currentBha = entry.bha; currentParams = entry.params;
        currentResults = entry.results;
        if(emptyMsg) emptyMsg.style.display = 'none';
        if(chartsWrap) chartsWrap.style.display = '';
        statusText.textContent = 'Last calculated: ' + fmtWhen(entry.calculatedAt) +
            (entry.calculatedByName ? ' by ' + entry.calculatedByName : '') +
            ' — Well/Leg: ' + wellKey;
        renderTDSchematic();
        buildTDCharts(entry.results);
    }

    // Reused settings ("apples-to-apples" casings/bha/params) get carried
    // over when the well changes, but casing tops/shoes and TD are specific
    // to each well's own trajectory — reusing them verbatim would show the
    // wrong schema for the newly-selected well (e.g. a shallower well
    // showing a negative-depth BHA top). This re-anchors the casing shoes
    // (surface = trajectory SC, deepest casing = trajectory ICP/Landing,
    // any strings in between scaled proportionally to their original
    // spacing) and TD to the SELECTED well's own score-card depths —
    // exactly the SC / ICP(LP) / TD values already computed for the
    // Wellbore Trajectory dashboard (window.mtxGetWellKeyDepths). OD/ID and
    // any other per-string settings are left untouched.
    function syncCasingsToWell(wellKey, casings, params){
        const depths = (typeof window.mtxGetWellKeyDepths === 'function') ? window.mtxGetWellKeyDepths(wellKey) : null;
        if(!depths || !casings || !casings.length) return { casings, params };
        const sorted = casings.slice().sort((a, b) => a.shoe - b.shoe);
        const out = sorted.map(c => Object.assign({}, c));
        const n = out.length;
        const origFirstShoe = sorted[0].shoe;
        const origLastShoe  = sorted[n - 1].shoe;
        const newFirstShoe  = depths.scMD  != null ? depths.scMD  : origFirstShoe;
        const newLastShoe   = depths.icpMD != null ? depths.icpMD : origLastShoe;
        out[0].top = 0;
        out[0].shoe = newFirstShoe;
        if(n > 1){
            const origSpan = origLastShoe - origFirstShoe;
            const newSpan  = newLastShoe - newFirstShoe;
            for(let i = 1; i < n; i++){
                if(i === n - 1){
                    out[i].shoe = newLastShoe;
                } else if(origSpan > 0){
                    const frac = (sorted[i].shoe - origFirstShoe) / origSpan;
                    out[i].shoe = newFirstShoe + frac * newSpan;
                } else {
                    out[i].shoe = newFirstShoe + (newSpan * i / (n - 1));
                }
                out[i].top = out[i - 1].shoe;
            }
        }
        const newParams = Object.assign({}, params);
        if(depths.tdMD != null) newParams.td = depths.tdMD;
        // Open hole conventionally starts where the deepest casing shoe is.
        newParams.ohTop = out[n - 1].shoe;
        // 2026-11-08 (T&D hole sections + BHA runs): params.plan holds section
        // limits and run From/To in MD. Stretch them with the SAME piecewise-
        // linear map used for the casing shoes (surface -> each shoe -> TD,
        // old well -> this well), so sections/runs stay tied to the shoes;
        // the deepest run is then forced to end exactly at this well's TD.
        if(params && params.plan){
            newParams.plan = remapTdPlan(params.plan,
                [0].concat(sorted.map(c => c.shoe)).concat([params.td]),
                [0].concat(out.map(c => c.shoe)).concat([newParams.td]),
                newParams.td);
        }
        return { casings: out, params: newParams };
    }

    // Piecewise-linear MD map between two ordered breakpoint lists (same length).
    function remapTdPlan(plan, oldB, newB, newTD){
        const pts = [];
        for(let i = 0; i < oldB.length; i++){
            if(!isFinite(oldB[i]) || !isFinite(newB[i])) continue;
            if(pts.length && oldB[i] <= pts[pts.length - 1][0]) continue; // keep strictly increasing
            pts.push([oldB[i], newB[i]]);
        }
        const map = function(md){
            if(!isFinite(md) || pts.length < 2) return md;
            if(md <= pts[0][0]) return md - pts[0][0] + pts[0][1];
            for(let i = 1; i < pts.length; i++){
                if(md <= pts[i][0]){
                    const a = pts[i - 1], b = pts[i];
                    return a[1] + (md - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
                }
            }
            const a = pts[pts.length - 2], b = pts[pts.length - 1];
            return b[1] + (md - b[0]) * ((b[1] - a[1]) / (b[0] - a[0]));
        };
        const p = JSON.parse(JSON.stringify(plan));
        (p.sections || []).forEach(s => { s.from = map(s.from); s.to = map(s.to); });
        (p.runs || []).forEach(r => { r.from = map(r.from); r.to = map(r.to); });
        if(p.snapMD != null) p.snapMD = map(p.snapMD);
        if(isFinite(newTD)){
            const used = (p.runs || []).filter(r => r.use !== false);
            const pool = used.length ? used : (p.runs || []);
            if(pool.length){ pool.reduce((a, b) => (b.to >= a.to ? b : a)).to = newTD; }
            const secs = (p.sections || []).slice().sort((a, b) => a.from - b.from);
            if(secs.length) secs[secs.length - 1].to = newTD;
        }
        return p;
    }

    async function recalcAndShow(wellKey){
        if(!currentCasings || !currentBha || !currentParams){
            statusText.textContent = 'No saved parameters to reuse yet — run the model for at least one well in the modeler first.';
            if(emptyMsg){ emptyMsg.style.display = ''; emptyMsg.textContent = 'No Torque & Drag parameters saved yet for this job.'; }
            if(chartsWrap) chartsWrap.style.display = 'none';
            return;
        }
        const synced = syncCasingsToWell(wellKey, currentCasings, currentParams);
        currentCasings = synced.casings;
        currentParams = synced.params;
        statusText.textContent = 'Recalculating for ' + wellKey + '…';
        try {
            const res = await fetch('/notes/tdModel/recalculate/' + PASON_NOTE_ID, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wellKey, casings: currentCasings, bha: currentBha, params: currentParams, scenario: currentScenario })
            });
            const data = await res.json();
            if(!res.ok){
                statusText.textContent = '❌ ' + (data.error || res.statusText);
                console.error('[T&D] recalculate failed:', data);
                return;
            }
            const entry = {
                casings: currentCasings, bha: currentBha, params: currentParams,
                results: data.results, calculatedAt: data.calculatedAt, calculatedByName: data.calculatedByName,
            };
            tdDoc.scenarios = tdDoc.scenarios || {};
            tdDoc.scenarios[currentScenario] = tdDoc.scenarios[currentScenario] || { resultsByWell: {} };
            tdDoc.scenarios[currentScenario].resultsByWell[wellKey] = entry;
            if(data.activeScenario === currentScenario){
                tdDoc.resultsByWell[wellKey] = entry;
            }
            console.log('[T&D] Recalculated and saved for', wellKey, 'scenario', currentScenario, 'at', data.calculatedAt, 'by', data.calculatedByName);
            showWellEntry(wellKey, entry);
        } catch(err) {
            statusText.textContent = '❌ Error: ' + err.message;
            console.error('[T&D] recalculate error:', err);
        }
    }

    function onWellChange(){
        const wellKey = wellSelect.value;
        if(!wellKey) return;
        const existing = scenarioEntry(currentScenario, wellKey);
        // Auto-recalculate using the currently-loaded settings every time the
        // well changes, so the comparison is always apples-to-apples — unless
        // this is the very first load and that well already has a saved run,
        // in which case just show it (avoids an unnecessary recalculation
        // the instant the page opens).
        if(existing && existing.results && !onWellChange._loaded){
            onWellChange._loaded = true;
            showWellEntry(wellKey, existing);
        } else {
            recalcAndShow(wellKey);
        }
    }

    function initTD(){
        if(!tdDoc){
            statusText.textContent = 'No Torque & Drag model saved yet for this job.';
            emptyMsg.style.display = '';
            return;
        }
        const subjectWells = getSubjectWellKeys();
        if(!subjectWells.length){
            statusText.textContent = 'No subject-well trajectories uploaded for this job yet.';
            emptyMsg.style.display = '';
            return;
        }
        wellSelect.innerHTML = '';
        subjectWells.forEach(function(wk){
            const opt = document.createElement('option');
            opt.value = wk; opt.textContent = wk;
            wellSelect.appendChild(opt);
        });
        wellSelect.style.display = '';
        wellSelect.addEventListener('change', onWellChange);
        initScenarioSelect();

        // Default: whichever well has the MOST RECENT calculatedAt, else the
        // first subject well alphabetically.
        let defaultWell = subjectWells[0];
        let latest = null;
        Object.keys(tdDoc.resultsByWell).forEach(function(wk){
            const entry = tdDoc.resultsByWell[wk];
            if(!entry || !entry.calculatedAt) return;
            if(!latest || new Date(entry.calculatedAt) > new Date(latest)){
                latest = entry.calculatedAt;
                if(subjectWells.indexOf(wk) !== -1) defaultWell = wk;
            }
        });
        wellSelect.value = defaultWell;
        onWellChange();
    }

    // Build the first time the accordion is actually opened — guarantees
    // #tdChartsWrap has real dimensions instead of the 0x0 it would report
    // while the accordion is still collapsed.
    let tdInitDone = false;
    function initTDOnce(){ if(tdInitDone) return; tdInitDone = true; initTD(); }
    const collapseEl = document.getElementById('collapseTD');
    if(collapseEl){
        collapseEl.addEventListener('shown.bs.collapse', initTDOnce);
        if(collapseEl.classList.contains('show')) initTDOnce();
    } else {
        initTDOnce();
    }
})();

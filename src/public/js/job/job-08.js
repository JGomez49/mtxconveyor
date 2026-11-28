/* MTX Conveyor — job page script 8. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 10333) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

(function(){
    const dataEl = document.getElementById('wbtData');
    const refSelect = document.getElementById('acpRefSelect');
    const statusEl = document.getElementById('acpStatus');
    const emptyEl = document.getElementById('acpEmpty');
    const chartWrap = document.getElementById('acpChartWrap');
    if(!dataEl || !refSelect) return;

    let WELLS = [];
    try { WELLS = JSON.parse(dataEl.textContent) || []; } catch(e){ WELLS = []; }
    // Only wellbores with actual survey data are usable.
    WELLS = WELLS.filter(function(w){ return w.survey && w.survey.length >= 2; });

    function num(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }

    // ── iPlan scenarios in Anti-collision (ADDED 2026-10-10, iPlan step 3) ──
    // Visible iPlan scenarios (window.IPLAN_SCENARIOS, built in the Wellbore
    // 3D accordion) are appended to WELLS as pseudo-wells, so they can be the
    // Reference well (dropdown) AND are included as offsets for any other
    // reference. Drawn green dotted. BASE_WELLS = the real planned wells only.
    //  - survey: for a TIE-ON scenario the parent well's stations ABOVE the
    //    tie-on MD are prepended, so the ISCWSA covariance accumulates along the
    //    parent's path first (as a real sidetrack's uncertainty does), instead
    //    of restarting from zero at the tie-on point. geomFromMd limits the
    //    C2C/TCV geometry to the scenario's own part (from the tie-on MD down),
    //    so the shared parent section doesn't show as a 0 m "collision".
    //  - toolcode: scenario override if set, else inherited from the parent
    //    planned well, else DEFAULT_TOOLCODE (same fallback as any well).
    //  - lat/long for the WMM magnetics: the parent well's surface station.
    //  - Sub-Sea: scenario stations carry subSea = RKB - TVD (iPlan), the same
    //    vertical basis this module already uses for every cross-well distance.
    var BASE_WELLS = WELLS.slice();
    var IPLAN_PREFIX = 'iPlan \u25B8 ';
    function buildScenarioWells(includeHidden){
        var list = (window.IPLAN_SCENARIOS || []).filter(function(sc){
            return (sc.visible || includeHidden) && sc._calc && !sc._calc.error && sc._calc.stations && sc._calc.stations.length >= 2;
        });
        var used = {};
        return list.map(function(sc){
            var parent = BASE_WELLS.find(function(w){ return String(w._id) === String(sc.wellId); }) || null;
            var pSurvey = parent ? parent.survey.slice().sort(function(a,b){ return num(a.md)-num(b.md); }) : [];
            var lat = pSurvey.length ? pSurvey[0].latitude : undefined, lon = pSurvey.length ? pSurvey[0].longitude : undefined;
            var st = sc._calc.stations;
            var startMd = st[0].md;
            var prefix = (sc.startMode === 'tieon') ? pSurvey.filter(function(r){ return num(r.md) < startMd - 1e-6; }) : [];
            var own = st.map(function(p){
                return { md: p.md, incl: p.inc, azim: p.az, tvd: p.tvd, northing: p.n, easting: p.e, subSea: p.subSea,
                         dogleg: p.dls30, latitude: lat, longitude: lon, comments: '' };
            });
            var name = IPLAN_PREFIX + (sc.name || sc.id);
            if(used[name]) name += ' (' + sc.id + ')';
            used[name] = true;
            return {
                wellName: name, isScenario: true, scenarioId: sc.id, geomFromMd: startMd,
                toolcode: sc.toolcode || (parent && parent.toolcode) || undefined,
                survey: prefix.concat(own)
            };
        });
    }
    function syncScenarioWells(){
        WELLS = BASE_WELLS.concat(buildScenarioWells());
        // scenario geometry/toolcode may have changed: drop their cached results
        if(typeof WELL_COVARIANCE !== 'undefined') Object.keys(WELL_COVARIANCE).forEach(function(k){ if(k.indexOf(IPLAN_PREFIX) === 0) delete WELL_COVARIANCE[k]; });
        if(typeof WELL_MAGNETICS !== 'undefined') Object.keys(WELL_MAGNETICS).forEach(function(k){ if(k.indexOf(IPLAN_PREFIX) === 0) delete WELL_MAGNETICS[k]; });
    }
    var IPLAN_GREEN = '#00e676';
    // ADDED 2026-10-11: color scheme selector (#acpColorMode).
    //  'standard': Subjects blue, Offsets red (same blues/red as the 3D viewer's
    //              Single mode: navy in light theme, electric blue in dark theme),
    //  'multi'   : one palette color per wellbore (the previous behavior).
    // iPlan scenarios are green dotted in both (scenarioStyle, applied after).
    // Subject/Offset rule = the 3D viewer's: wellCategory tag, else the [NN]..._LNN name pattern.
    function acpIsSubject(w){
        var wn = (w.wellName || '').trim();
        if(w.wellCategory === 'subject') return true;
        if(w.wellCategory === 'offset') return false;
        return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
    }
    function acpWellColor(w, i){
        var modeEl = document.getElementById('acpColorMode');
        if(modeEl && modeEl.value === 'multi') return palette[i % palette.length];
        if(acpIsSubject(w)) return document.body.classList.contains('light-mode') ? '#1a3fa0' : '#0066ff';
        return '#ff0000';
    }
    function scenarioStyle(w, ds){
        if(w && w.isScenario){ ds.borderColor = IPLAN_GREEN; ds.backgroundColor = IPLAN_GREEN; ds.borderDash = [6, 4]; ds.borderWidth = 2; }
        return ds;
    }

    // 3D points for a wellbore, in a consistent local frame (x=Easting,
    // y=Northing, z=-TVDss). Uses Sub-Sea (TVDss), NOT raw TVD, for the
    // vertical axis: TVD is referenced to each well's own RKB/KB elevation,
    // which can differ well-to-well (different rig, different survey
    // vintage, etc.), so comparing raw TVD across two different wells can
    // silently introduce a vertical error. Sub-Sea is referenced to a
    // common datum (MSL) and is the correct basis for any cross-well
    // spatial comparison — confirmed against this job's own data: two
    // wells 5 m apart in Sub-Sea read only ~0.5 m apart in raw TVD.
    function wellPoints(well){
        return (well.survey || []).filter(function(s){
            // iPlan tie-on scenarios: geometry starts at the tie-on MD (see BASE_WELLS note)
            return well.geomFromMd == null || num(s.md) >= well.geomFromMd - 1e-6;
        }).map(function(s){
            return { md: num(s.md), x: num(s.easting), y: num(s.northing), z: -num(s.subSea), tvd: num(s.tvd),
                     incl: num(s.incl), azim: num(s.azim) };
        }).sort(function(a,b){ return a.md - b.md; });
    }

    // True if a well's survey has no usable Sub-Sea data (missing column
    // on upload, or a legacy upload from before this field existed) — in
    // that case every station's subSea defaults to 0, which would make the
    // whole well read as perfectly flat at z=0 and silently produce
    // meaningless C2C values against it.
    function hasSubSea(well){
        return (well.survey || []).some(function(s){ return Math.abs(num(s.subSea)) > 0.01; });
    }

    // Flags likely data artifacts: duplicate/near-duplicate consecutive MD
    // values (zero-length or near-zero-length segments), and repeated
    // identical N/E/TVDss at different MDs (e.g. an appended/duplicated
    // tail block from a bad upload). Either can make closestOnSegment
    // "snap" to a bogus point and report an artificially tiny C2C that has
    // nothing to do with true separation. This is diagnostic only — it
    // doesn't change the computed values, just flags wells worth checking.
    function scanForDataIssues(well){
        var issues = [];
        if(!hasSubSea(well)) issues.push('no Sub-Sea (TVDss) data found — this well\'s vertical position may read as flat/incorrect; re-upload with a Sub-Sea column if C2C against this well looks wrong');
        var pts = wellPoints(well);
        var dupMdCount = 0, zeroLenSegCount = 0;
        var seenPos = {};
        var repeatedPosCount = 0;
        for(var i=0; i<pts.length; i++){
            if(i > 0 && Math.abs(pts[i].md - pts[i-1].md) < 0.01) dupMdCount++;
            if(i > 0){
                var dx=pts[i].x-pts[i-1].x, dy=pts[i].y-pts[i-1].y, dz=pts[i].z-pts[i-1].z;
                if(Math.sqrt(dx*dx+dy*dy+dz*dz) < 0.01 && Math.abs(pts[i].md-pts[i-1].md) > 0.01) zeroLenSegCount++;
            }
            var key = pts[i].x.toFixed(2) + ',' + pts[i].y.toFixed(2) + ',' + pts[i].z.toFixed(2);
            seenPos[key] = (seenPos[key] || 0) + 1;
        }
        Object.keys(seenPos).forEach(function(k){ if(seenPos[k] > 1) repeatedPosCount += seenPos[k]; });
        if(dupMdCount > 0) issues.push(dupMdCount + ' duplicate MD value(s)');
        if(zeroLenSegCount > 0) issues.push(zeroLenSegCount + ' zero-length segment(s) at different MDs (station stuck at same N/E/TVDss while MD changes)');
        if(repeatedPosCount > 2) issues.push(repeatedPosCount + ' stations sharing an identical N/E/TVDss position with another station');
        return issues;
    }

    // Closest point on segment A-B to point P, plus how far along the
    // segment (t, 0..1) — used to interpolate the offset well's own MD at
    // that point, so the tooltip can show exactly where on the offset
    // trajectory the closest approach is happening (diagnostic: lets you
    // tell a true parallel-lateral match apart from an unexpected nearby
    // crossing, e.g. near a shared surface slot).
    function closestOnSegment(P, A, B){
        var ABx=B.x-A.x, ABy=B.y-A.y, ABz=B.z-A.z;
        var APx=P.x-A.x, APy=P.y-A.y, APz=P.z-A.z;
        var ab2 = ABx*ABx+ABy*ABy+ABz*ABz;
        var t = ab2 === 0 ? 0 : (APx*ABx+APy*ABy+APz*ABz)/ab2;
        t = Math.max(0, Math.min(1, t));
        return { x: A.x+t*ABx, y: A.y+t*ABy, z: A.z+t*ABz, t: t };
    }

    // Minimum 3D distance from point P to the offset wellbore's polyline
    // (true closest-approach, not same-MD comparison) — also returns the
    // offset well's MD/incl/azim AND actual x/y/z position (all
    // interpolated) at that closest point, for the diagnostic panel and
    // the Separation Factor calc below (which needs the real coordinates
    // to compute the separation direction, not just MD/incl/azim).
    function closestApproachDistance(P, offsetPts){
        var minD = Infinity, offMd = null, offIncl = null, offAzim = null, offX = null, offY = null, offZ = null;
        for(var i=0; i<offsetPts.length-1; i++){
            var A = offsetPts[i], B = offsetPts[i+1];
            var Q = closestOnSegment(P, A, B);
            var dx=P.x-Q.x, dy=P.y-Q.y, dz=P.z-Q.z;
            var d = Math.sqrt(dx*dx+dy*dy+dz*dz);
            if(d < minD){
                minD = d; offMd = A.md + Q.t*(B.md - A.md);
                offIncl = A.incl + Q.t*(B.incl - A.incl);
                offAzim = A.azim + Q.t*(B.azim - A.azim);
                offX = Q.x; offY = Q.y; offZ = Q.z;
            }
        }
        return { dist: minD, offMd: offMd, offIncl: offIncl, offAzim: offAzim, offX: offX, offY: offY, offZ: offZ };
    }

    // ─────────────────────────────────────────────────────────────────
    // SEPARATION FACTOR (SF)
    //
    // SF = S / (UR_ref + UR_off) — each well's OWN position-uncertainty
    // ellipsoid, independently projected onto the line joining the two
    // points of interest (pedal-curve radius) and scaled by K, then the
    // two radii ADDED (no cross-well correlation). This is the default
    // per §1.2/§1.3 of the ISCWSA "Collision Avoidance Calculations —
    // Current Common Practice" (2010) doc, AND confirmed as Compass's
    // own actual default behavior via its own help text (from the
    // person, verbatim): correlation-based cancellation of shared
    // Global/declination error between two wells is an ADVANCED,
    // opt-in-per-report checkbox ("Reduce Global Lateral Errors" —
    // "You must check this box each time you want to use it"), NOT the
    // default. So the default report both they and we need to match
    // does NOT apply Eq 35 cross-well correlation.
    //
    // (This function briefly used ISCWSAModel.relativeCovariance — Eq 35
    // — as the DEFAULT combination instead, on the theory that Compass
    // must be doing something correlation-aware given the size of an
    // observed gap at a high-inclination, shared-toolcode station. That
    // was wrong: per Compass's own documentation above, correlation
    // cancellation is opt-in and off by default, so it should NOT be
    // the default here either. It's kept available below as a clearly
    // labeled secondary DIAGNOSTIC number only — useful if reconciling
    // against a specific report where that checkbox WAS used, but not
    // what drives the primary SF.)
    // ─────────────────────────────────────────────────────────────────
    // K_SF: sigma_sep multiplier scaling the projected 1-sigma separation
    // uncertainty up to a reporting confidence level. Default changed
    // 2026-08-20 from 2.7955 (sqrt(chi2(0.95,3)), the dimensionally-
    // correct 3-DOF 95% chi-square value for this genuine 3D projection)
    // to a flat 2 — Compass's own .xls AC reports for this project state
    // "Output errors are at 2.00 sigma" (a flat multiple, not a multi-DOF
    // confidence level), and matching that convention by default is what
    // lets MTX's SF be compared apples-to-apples against a default Compass
    // report without the person needing to know to change this box first.
    // Before that, this was hardcoded to 2.447, mislabeled "ISCWSA 95%
    // confidence factor" — that's actually the 2-DOF (2D ellipse) 95%
    // value (sqrt(chi2(0.95,2)) = 2.4477), wrong for a 3D projection.
    // "The" correct K still depends on which confidence level/convention
    // the tool being compared against uses — some companies configure a
    // custom K as policy rather than any strict statistical confidence
    // level — so this stays a live control (Confidence K (sigma), next to
    // Toolcode) rather than re-hardcoded, so it can be dialed in directly
    // (e.g. back to 2.7955) against another tool's reported SF instead of
    // guessing blind.
    var K_SF = 2;
    // Projects a full 3x3 covariance matrix onto an arbitrary separation
    // direction: sigma_sep^2 = u^T C u (standard result for the variance
    // of a linear combination of correlated random variables), returning
    // the K-scaled pedal-curve radius along that direction. Cxy/Cxz/Cyz
    // (off-diagonal / cross terms) are required whenever the underlying
    // covariance is correlated (which ISCWSA covariance always is: a
    // single systematic error source projects correlated amounts onto
    // N/E/V simultaneously).
    function projectedRadius(ux, uy, uz, Cxx, Cyy, Czz, Cxy, Cxz, Cyz){
        Cxy = Cxy || 0; Cxz = Cxz || 0; Cyz = Cyz || 0;
        var varAlong = ux*ux*Cxx + uy*uy*Cyy + uz*uz*Czz
                      + 2*ux*uy*Cxy + 2*ux*uz*Cxz + 2*uy*uz*Cyz;
        return K_SF * Math.sqrt(Math.max(varAlong, 0));
    }
    // SF = S / (UR_ref + UR_off) — see header comment above.
    // ── Error Surface (ADDED 2026-11-14, John) ─────────────────────────
    // WHAT WAS WRONG: MTX always used SF = S/(UR_ref + UR_off) — Compass's "Elliptical Conic" error surface
    // (and the ISCWSA 2010 Common Practice R-type rule). CNRL's Compass AC reports (16-34-026-18W4 [P1-2359],
    // wells [01] ETS 161582 / [02] ETS 161583) state "Error Surface: Combined Pedal Curve", and their
    // Minimum Separation = sqrt(UR_ref^2 + UR_off^2) (e.g. 25 m: sqrt(0.31^2 + 0.26^2) = 0.40 as printed).
    // SOURCE: COMPASS Training Manual 2003.5, ch.6 pp.225-227 — "Combined Covariance: combines the errors on the
    // reference and offset by covariance addition before any distance calculations are performed. The error
    // distance is then computed by the elliptical conic method on the resulting single ellipsoid." Projecting
    // C_ref + C_off on the centre-to-centre unit vector u gives K*sqrt(u'C_ref u + u'C_off u) = sqrt(UR_ref^2 + UR_off^2)
    // (no cross-well correlation, same as before). Circular Conic (same manual): major axis of each ellipsoid,
    // radii added.
    // CHECK (before the change, scripts in "MTX AC\Claude outputs\welleng comparison"): MTX covariances with the
    // combined form reproduce Compass's SF on 319 report rows (both directions, MD > 100 m) to a median of 0.0/-0.1 %;
    // the old sum gave a median of -29 %. This explains the old "near-parallel diverges, oblique matches" pattern
    // (equal radii -> sum/RSS = sqrt 2; one radius dominating -> sum ~ RSS). Residual shallow differences are the
    // surface tie-on gap in iscwsaModel.js, not this.
    // NOTE: Combined gives a HIGHER (less conservative) SF than Elliptical Conic — it is the default because it is
    // CNRL's standard error surface (John, 2026-11-14).
    var ERR_SURF = 'combined';
    try { var _es = localStorage.getItem('mtxAcErrSurf'); if(_es === 'combined' || _es === 'elliptical' || _es === 'circular') ERR_SURF = _es; } catch(e){}
    // largest eigenvalue of a symmetric 3x3 local covariance (power iteration) -> K * sqrt(lambda_max) = major semi-axis
    function majorRadius(c){
        if(!c) return null;
        var v = [1, 1, 1], lam = 0;
        for(var it = 0; it < 60; it++){
            var w = [c.xx*v[0] + (c.xy||0)*v[1] + (c.xz||0)*v[2], (c.xy||0)*v[0] + c.yy*v[1] + (c.yz||0)*v[2], (c.xz||0)*v[0] + (c.yz||0)*v[1] + c.zz*v[2]];
            var n = Math.sqrt(w[0]*w[0] + w[1]*w[1] + w[2]*w[2]); if(n < 1e-30) return 0;
            lam = n / Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); v = [w[0]/n, w[1]/n, w[2]/n];
        }
        return K_SF * Math.sqrt(Math.max(lam, 0));
    }
    // urComb = combined error radius used for SF and for "Between Ellipses" (= S - urComb).
    // majRef/majOff (optional): major-axis radii, only used by Circular Conic.
    function sfFromTwoRadii(dist, urRef, urOff, majRef, majOff){
        var denom;
        if(ERR_SURF === 'combined') denom = Math.sqrt(urRef*urRef + urOff*urOff);
        else if(ERR_SURF === 'circular' && majRef != null && majOff != null) denom = majRef + majOff;
        else denom = urRef + urOff;
        return { sf: denom > 1e-9 ? dist / denom : Infinity, urRef: urRef, urOff: urOff, urComb: denom, errSurf: ERR_SURF };
    }

    function rad(d){ return d * Math.PI / 180; }
    function simplifiedCovariance(md, inclDeg){
        var inc = rad(inclDeg);
        var sI = Math.sin(inc), cI = Math.cos(inc);
        var sigABXY_inc = rad(0.10) * md;
        var sigABXY_azi = rad(0.30) * md;
        var sigASXY     = 0.001 * md;
        var sigSAG      = rad(0.02) * md * sI;
        var sigmaMD     = 0.0005 * md;
        var sigDECR     = rad(0.36) * md * sI;
        var sigDBHG     = rad(0.12) * md * sI;
        var varH = Math.pow(sigABXY_inc*sI,2) + Math.pow(sigABXY_azi*sI,2) + Math.pow(sigASXY*sI,2) +
                   Math.pow(sigSAG*sI,2) + Math.pow(sigDECR,2) + Math.pow(sigDBHG,2);
        var varZ = Math.pow(sigABXY_inc*cI,2) + Math.pow(sigSAG*cI,2) + Math.pow(sigmaMD,2);
        return { xx: varH/2, yy: varH/2, zz: varZ };
    }
    function separationFactorSimplified(refPt, offPt, dist){
        if(dist < 1e-9) return { sf: 0, urRef: 0, urOff: 0, urComb: 0 };
        var dx=refPt.x-offPt.x, dy=refPt.y-offPt.y, dz=refPt.z-offPt.z;
        var ux=dx/dist, uy=dy/dist, uz=dz/dist;
        var cRef = simplifiedCovariance(refPt.md, refPt.incl);
        var cOff = simplifiedCovariance(offPt.md, offPt.incl);
        // No cross-terms here — this lumped fallback model was never a
        // rotated/directional error model (unlike the real ISCWSA path
        // below), it's an isotropic-in-H approximation with no basis for
        // computing genuine Cxy/Cxz/Cyz, so it stays diagonal-only. This
        // is the FALLBACK path (no toolcode / missing magnetics) — it's
        // not what's driving the Compass mismatch when a toolcode IS
        // selected and both wells have magnetics, which uses the real
        // path below instead.
        var urRef = projectedRadius(ux, uy, uz, cRef.xx, cRef.yy, cRef.zz);
        var urOff = projectedRadius(ux, uy, uz, cOff.xx, cOff.yy, cOff.zz);
        return sfFromTwoRadii(dist, urRef, urOff, majorRadius(cRef), majorRadius(cOff));
    }

    // REAL model: NEV covariance (N,E,V) needs rotating into our plot's
    // local x/y/z frame (x=Easting=E, y=Northing=N, z=-SubSea=-V, i.e.
    // V=-z) before projecting — done inline in nevToLocalCov below since
    // it's a simple axis relabel, not a true rotation (both frames share
    // the same vertical axis orientation convention already used
    // throughout this accordion). Cross terms ARE carried through now
    // (previously dropped — see projectedRadius's comment above for why
    // that mattered): Cov(x,y)=Cov(E,N)=NE unchanged by the relabel;
    // Cov(x,z)=Cov(E,-V)=-EV and Cov(y,z)=Cov(N,-V)=-NV pick up a sign
    // flip from the z=-V axis flip.
    function nevToLocalCov(cov){
        return { xx: cov.EE, yy: cov.NN, zz: cov.VV, xy: cov.NE, xz: -cov.EV, yz: -cov.NV };
    }
    function separationFactorReal(refPt, offPt, dist, refCovStation, offCovStation){
        if(!refCovStation || !offCovStation) return null;
        if(dist < 1e-9) return { sf: 0, urRef: 0, urOff: 0, urComb: 0 };
        var dx=refPt.x-offPt.x, dy=refPt.y-offPt.y, dz=refPt.z-offPt.z;
        var ux=dx/dist, uy=dy/dist, uz=dz/dist;
        var localRef = nevToLocalCov(refCovStation.cov);
        var localOff = nevToLocalCov(offCovStation.cov);
        var urRef = projectedRadius(ux, uy, uz, localRef.xx, localRef.yy, localRef.zz, localRef.xy, localRef.xz, localRef.yz);
        var urOff = projectedRadius(ux, uy, uz, localOff.xx, localOff.yy, localOff.zz, localOff.xy, localOff.xz, localOff.yz);
        var r = sfFromTwoRadii(dist, urRef, urOff, majorRadius(localRef), majorRadius(localOff));
        // SECONDARY diagnostic only (not used for the SF above): the
        // Eq-35 correlation-aware combined radius, for reconciling
        // against a specific Compass report that had "Reduce Global
        // Lateral Errors" checked for that run.
        var toolTermsRef = refCovStation._terms, toolTermsOff = offCovStation._terms;
        var Crel = ISCWSAModel.relativeCovariance(refCovStation, offCovStation, toolTermsRef, toolTermsOff);
        var localRel = nevToLocalCov(Crel);
        r.urCombinedCorrelated = projectedRadius(ux, uy, uz, localRel.xx, localRel.yy, localRel.zz, localRel.xy, localRel.xz, localRel.yz);
        return r;
    }

    // Full C2C-vs-MD profile: for every survey station on the reference
    // well, the closest-approach distance to the offset well's trajectory,
    // plus the offset well's own MD at that closest point, plus a
    // Separation Factor. refCov/offCov are the precomputed per-station
    // ISCWSA covariance arrays (from computeWellCov) when a real toolcode
    // is active for both wells; null falls back to the simplified model.
    function findNearestCovStation(covArray, targetMd){
        if(!covArray || !covArray.length || targetMd == null) return null;
        var best = null, bestDiff = Infinity;
        for(var i=0; i<covArray.length; i++){
            var diff = Math.abs(covArray[i].md - targetMd);
            if(diff < bestDiff){ bestDiff = diff; best = covArray[i]; }
        }
        return best;
    }
    function computeC2CProfile(refPts, offsetPts, refCov, offCov){
        return refPts.map(function(P){
            var r = closestApproachDistance(P, offsetPts);
            var offPt = { md: r.offMd, incl: r.offIncl, azim: r.offAzim, x: r.offX, y: r.offY, z: r.offZ };
            var sf;
            if(refCov && offCov){
                var refSt = findNearestCovStation(refCov, P.md);
                var offSt = findNearestCovStation(offCov, r.offMd);
                sf = separationFactorReal(P, offPt, r.dist, refSt, offSt);
                if(sf == null) sf = separationFactorSimplified(P, offPt, r.dist);
            } else {
                sf = separationFactorSimplified(P, offPt, r.dist);
            }
            return { md: P.md, c2c: r.dist, offMd: r.offMd, sf: sf.sf, urRef: sf.urRef, urOff: sf.urOff, urCombinedCorrelated: sf.urCombinedCorrelated };
        });
    }

    // Linear interpolation of a wellPoints()-style point (x,y,z,incl,azim)
    // at an arbitrary MD along `pts` — used by the manual "Evaluate at Ref
    // MD" box so a user can cross-check a specific report row from another
    // program (e.g. Compass) even when that MD doesn't land exactly on one
    // of this well's own survey stations. Returns null if md is outside
    // the well's surveyed range (extrapolation isn't meaningful here).
    function interpAtMd(pts, md){
        if(!pts || pts.length < 2) return null;
        if(md < pts[0].md || md > pts[pts.length-1].md) return null;
        for(var i=0; i<pts.length-1; i++){
            var A = pts[i], B = pts[i+1];
            if(md >= A.md && md <= B.md){
                var span = B.md - A.md;
                var t = span > 1e-9 ? (md - A.md) / span : 0;
                return {
                    md: md,
                    x: A.x + t*(B.x-A.x), y: A.y + t*(B.y-A.y), z: A.z + t*(B.z-A.z),
                    incl: A.incl + t*(B.incl-A.incl), azim: A.azim + t*(B.azim-A.azim)
                };
            }
        }
        return null;
    }

    // Evaluates C2C/SF at a user-specified reference-well MD against every
    // offset well currently plotted — mirrors a multi-offset "closest
    // approach at station X" report row (e.g. Compass's own panel) so
    // results can be checked point-for-point instead of relying on
    // MTX's own (independently-chosen) scan MD landing on the same depth.
    function evaluateAtMd(){
        var panel = document.getElementById('acpEvalMdPanel');
        var mdInput = document.getElementById('acpEvalMd');
        var md = parseFloat(mdInput && mdInput.value);
        if(isNaN(md)){ panel.style.display='none'; return; }

        var refName = refSelect.value;
        var refWell = WELLS.find(function(w){ return w.wellName === refName; });
        if(!refWell){ panel.style.display='none'; return; }
        var refPts = wellPoints(refWell);
        var P = interpAtMd(refPts, md);
        if(!P){
            panel.innerHTML = '<b style="color:#39ff14;">MD ' + md.toFixed(2) + '</b> is outside ' + refName +
                '\'s surveyed range (' + refPts[0].md.toFixed(0) + ' – ' + refPts[refPts.length-1].md.toFixed(0) + ' m).';
            panel.style.display = 'block';
            return;
        }

        // Read K fresh (same pattern as renderPlot) so this reflects the
        // Confidence K box even if it was changed without re-rendering.
        var kInput = document.getElementById('acpKSF');
        var kVal = kInput ? parseFloat(kInput.value) : NaN;
        K_SF = (!isNaN(kVal) && kVal > 0) ? kVal : 2;

        var refCov = computeWellCov(refWell, wellToolcode(refWell));
        var others = WELLS.filter(function(w){ return w.wellName !== refName; });
        var rows = others.map(function(w){
            var offPts = wellPoints(w);
            var offCov = computeWellCov(w, wellToolcode(w));
            var profile = computeC2CProfile([P], offPts, refCov, offCov); // reuse the same per-point logic as the swept chart, for exactly one ref point
            var r = profile[0];
            return { name: w.wellName, c2c: r.c2c, offMd: r.offMd, sf: r.sf, urRef: r.urRef, urOff: r.urOff, urCombinedCorrelated: r.urCombinedCorrelated, offCov: offCov };
        }).sort(function(a,b){ return a.c2c - b.c2c; });

        var html = '<b style="color:#39ff14;">Evaluate at Ref MD ' + md.toFixed(2) + '</b> — ' + refName +
            ' at N=' + P.y.toFixed(2) + ' E=' + P.x.toFixed(2) + ' TVDss=' + (-P.z).toFixed(2) +
            ' Inc=' + P.incl.toFixed(2) + '° (K=' + K_SF.toFixed(4) + ', each well uses its own saved toolcode, default = no cross-well correlation per Compass default behavior)<br>' +
            '<table style="width:100%;margin-top:6px;border-collapse:collapse;"><tr style="color:var(--an-text-dim,#5a7080);text-align:left;">' +
            '<th style="padding:2px 8px 2px 0;">Offset Well</th><th style="padding:2px 8px;">Offset MD (m)</th>' +
            '<th style="padding:2px 8px;">C2C / "Between Centres" (m)</th>' +
            '<th style="padding:2px 8px;">UR_ref (m)</th><th style="padding:2px 8px;">UR_off (m)</th>' +
            '<th style="padding:2px 8px;">SF (' + ({combined:'Combined Pedal Curve', elliptical:'Elliptical Conic', circular:'Circular Conic'}[ERR_SURF]) + ', no correlation)</th>' +
            '<th style="padding:2px 8px;color:var(--an-text-dim,#5a7080);">for comparison: correlation-aware combined radius (Eq35, "Reduce Global Lateral Errors" equivalent) (m)</th></tr>' +
            rows.map(function(r){
                return '<tr><td style="padding:2px 8px 2px 0;">' + r.name + '</td>' +
                    '<td style="padding:2px 8px;">' + (r.offMd!=null ? r.offMd.toFixed(2) : '—') + '</td>' +
                    '<td style="padding:2px 8px;">' + r.c2c.toFixed(2) + '</td>' +
                    '<td style="padding:2px 8px;">' + (r.urRef!=null ? r.urRef.toFixed(2) : '—') + '</td>' +
                    '<td style="padding:2px 8px;">' + (r.urOff!=null ? r.urOff.toFixed(2) : '—') + '</td>' +
                    '<td style="padding:2px 8px;">' + (isFinite(r.sf) ? r.sf.toFixed(3) : '∞') + '</td>' +
                    '<td style="padding:2px 8px;color:var(--an-text-dim,#5a7080);">' + (r.urCombinedCorrelated!=null ? r.urCombinedCorrelated.toFixed(2) : '—') + '</td></tr>';
            }).join('') + '</table>';

        // Term-by-term breakdown for the CLOSEST offset well only (rows[0]
        // after the sort above) — shows which individual ISCWSA error
        // term(s) dominate each well's own contribution at this exact
        // point, so an unexpectedly large UR_ref/UR_off can be traced to
        // a specific term rather than treated as an opaque total.
        var closest = rows[0];
        if(closest && closest.urRef != null){
            var offPts2 = wellPoints(WELLS.find(function(w){ return w.wellName === closest.name; }));
            var offP = interpAtMd(offPts2, closest.offMd) || offPts2[0];
            var dx2=P.x-offP.x, dy2=P.y-offP.y, dz2=P.z-offP.z;
            var dist2 = Math.sqrt(dx2*dx2+dy2*dy2+dz2*dz2) || 1;
            var ux2=dx2/dist2, uy2=dy2/dist2, uz2=dz2/dist2;
            var refStForBreak = findNearestCovStation(refCov, P.md);
            var offStForBreak = findNearestCovStation(closest.offCov, closest.offMd);
            var refTerms = termBreakdown(refStForBreak, ux2, uy2, uz2, 6);
            var offTerms = termBreakdown(offStForBreak, ux2, uy2, uz2, 6);
            function termTable(label, terms){
                return '<div style="margin-top:4px;"><u>' + label + '</u> — top contributing ISCWSA terms (raw 1σ along line-of-centers, before K scaling):<br>' +
                    terms.map(function(t){
                        return '&nbsp;&nbsp;' + t.code + ': ' + t.sigma1.toFixed(3) + ' m (' + t.pct.toFixed(1) + '% of variance)';
                    }).join('<br>') + '</div>';
            }
            html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #2a3a4a;font-size:10px;color:var(--an-text,#c8d8e8);">' +
                '<b style="color:#39ff14;">Term breakdown for closest offset (' + closest.name + '):</b>' +
                termTable(refName + ' (ref)', refTerms) + termTable(closest.name + ' (offset)', offTerms) +
                '</div>';
        }
        panel.innerHTML = html;
        panel.style.display = 'block';
    }

    // Per-term diagnostic: decomposes ONE station's covariance (as stored
    // in byTerm by computeWellCovariance — one 3x3 per ISCWSA error term)
    // into each term's own 1-sigma contribution along a given direction.
    // Variance is additive across terms (each is an independent random
    // source, so their covariances just sum) — this projects each term's
    // covariance individually the same way projectedRadius does for the
    // combined one, WITHOUT the K_SF scaling (raw 1-sigma, in metres),
    // so terms can be ranked and compared directly against a known-
    // reasonable magnitude rather than an already-scaled radius. Note:
    // combined 1-sigma = sqrt(sum of these values squared), NOT their
    // sum — quoted alongside each term as "% of variance" instead, which
    // *is* directly additive (sum of squares of orthogonal contributions
    // = total variance).
    function termBreakdown(stCov, ux, uy, uz, topN){
        if(!stCov || !stCov.byTerm) return [];
        var rows = Object.keys(stCov.byTerm).map(function(code){
            var local = nevToLocalCov(stCov.byTerm[code]);
            var varAlong = ux*ux*local.xx + uy*uy*local.yy + uz*uz*local.zz
                          + 2*ux*uy*local.xy + 2*ux*uz*local.xz + 2*uy*uz*local.yz;
            return { code: code, sigma1: Math.sqrt(Math.max(varAlong,0)), varAlong: Math.max(varAlong,0) };
        });
        var totalVar = rows.reduce(function(s,r){ return s+r.varAlong; }, 0);
        rows.forEach(function(r){ r.pct = totalVar > 1e-12 ? 100*r.varAlong/totalVar : 0; });
        rows.sort(function(a,b){ return b.varAlong - a.varAlong; });
        return rows.slice(0, topN || 6);
    }

    // ─────────────────────────────────────────────────────────────────
    // ERROR ELLIPSE COMPARISON (Compass PDF vs MTX) — debugging aid
    //
    // Lets a person upload Compass's "Error Ellipse Survey" PDF report for
    // the current reference well and see it side-by-side against MTX's own
    // computed per-station uncertainty ellipse, so a real gap can be
    // isolated station-by-station instead of guessed at.
    //
    // STATUS (2026-08-21): MTX's own Semi-major/Semi-minor computation
    // below (ellipseHighsideLateral) is NOT yet validated. Checked against
    // this well's own Compass report at MD=840/870/990/1200: magnitudes
    // come out ~1.5-2x too small (not a constant ratio, so not a simple
    // missing K-scale) and the reported ellipse Azimuth doesn't match at
    // all. Adding the MWD+HRGM SAG term (see iscwsaToolcodes.json) barely
    // moved the numbers, ruling that out as the cause. Current suspicion
    // is a bug in the Highside/Lateral axis convention itself (sign/axis
    // definition below), not a missing ISCWSA term - unconfirmed. This
    // table exists specifically so that suspicion can be checked row by
    // row against real Compass numbers rather than continuing to guess.
    // DO NOT treat the "MTX" columns below as validated until this note
    // is updated.
    //
    // Highside(H)/Lateral(L)/Along-hole(T) frame at inc I, true azimuth A
    // (standard borehole coordinate frame; T = wellbore tangent, H = the
    // component of "up" perpendicular to T in the vertical plane
    // containing the wellbore, L completes a right-handed set):
    //   T = ( sinI cosA,  sinI sinA,  cosI )   [N, E, V]
    //   H = (-cosI cosA, -cosI sinA,  sinI )
    //   L = ( sinA,      -cosA,       0    )
    // Orthonormality (H.T=0, L.T=0, H.L=0) verified algebraically.
    // Semi-major/minor = eigenvalues of the 2x2 [[HH,HL],[HL,LL]]
    // sub-covariance (H^T*Cov*H etc., bilinear form on the full NEV
    // covariance) - this part (the general "project a 3x3 covariance onto
    // two given directions, then eigen-decompose" step) is standard linear
    // algebra, not itself in question; what's unvalidated is whether H/L
    // as defined above actually match Compass's own Highside/Lateral
    // convention.
    function ellipseHighsideLateral(covNEV, incRad, azTRad, K){
        var cI = Math.cos(incRad), sI = Math.sin(incRad), cA = Math.cos(azTRad), sA = Math.sin(azTRad);
        var H = [-cI*cA, -cI*sA, sI], L = [sA, -cA, 0];
        function biform(u, v){
            return u[0]*v[0]*covNEV.NN + u[1]*v[1]*covNEV.EE + u[2]*v[2]*covNEV.VV
                 + (u[0]*v[1]+u[1]*v[0])*covNEV.NE + (u[0]*v[2]+u[2]*v[0])*covNEV.NV + (u[1]*v[2]+u[2]*v[1])*covNEV.EV;
        }
        var HH = biform(H,H), LL = biform(L,L), HL = biform(H,L);
        var mean = (HH+LL)/2, diff = (HH-LL)/2, rad = Math.sqrt(diff*diff + HL*HL);
        var l1 = mean+rad, l2 = mean-rad;
        var angle = 0.5 * Math.atan2(2*HL, HH-LL) * 180/Math.PI;
        return {
            highside: K*Math.sqrt(Math.max(HH,0)), lateral: K*Math.sqrt(Math.max(LL,0)),
            semiMajor: K*Math.sqrt(Math.max(l1,0)), semiMinor: K*Math.sqrt(Math.max(l2,0)), angle: angle
        };
    }

    // Groups a PDF.js text-content result into visual lines (by rounded Y
    // position) and returns each line's text left-to-right — pdf.js gives
    // individual text fragments with no inherent line breaks, so this
    // reconstruction is necessary before any row-pattern regex can work.
    function pdfPageToLines(textContent){
        var byY = {};
        textContent.items.forEach(function(item){
            var y = Math.round(item.transform[5] * 2) / 2; // 0.5pt bucket
            if(!byY[y]) byY[y] = [];
            byY[y].push({ x: item.transform[4], str: item.str });
        });
        var ys = Object.keys(byY).map(Number).sort(function(a,b){ return b-a; }); // top to bottom
        return ys.map(function(y){
            return byY[y].sort(function(a,b){ return a.x-b.x; }).map(function(it){ return it.str; }).join(' ').replace(/\s+/g,' ').trim();
        }).filter(function(l){ return l.length; });
    }

    // Matches one "Error Ellipse Survey" data row, e.g.:
    // "840.00 3.34 117.46 839.98 3.54 0.00 3.54 0.00 1.22 0.00 0.00 3.55 3.53 57.51 MWD+HRGM (1)"
    // Columns: MD, Inc, Az, TVD, HighsideErr, HighsideBias, LateralErr,
    // LateralBias, VerticalErr, VerticalBias, MagOfBias, SemiMajor,
    // SemiMinor, Azimuth, ToolName.
    var ERR_ELLIPSE_ROW_RE = /^([\d,]+\.\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d,]+\.\d{2})\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/;
    function parseErrorEllipsePdfText(lines){
        var rows = [], seen = {};
        lines.forEach(function(line){
            var m = ERR_ELLIPSE_ROW_RE.exec(line);
            if(!m) return;
            var md = parseFloat(m[1].replace(/,/g,''));
            var key = md.toFixed(2);
            if(seen[key]) return; // dedupe (page-break repeats the last row of the previous page)
            seen[key] = true;
            rows.push({
                md: md, inc: parseFloat(m[2]), az: parseFloat(m[3]),
                semiMajor: parseFloat(m[12]), semiMinor: parseFloat(m[13]), azimuth: parseFloat(m[14])
            });
        });
        rows.sort(function(a,b){ return a.md-b.md; });
        return rows;
    }

    // Matches one "Anticollision" per-offset-well data row, e.g.:
    // "25.00 25.00 24.60 24.60 0.31 0.26 175.85 -9.97 0.72 9.99 9.59 0.40 24.700"
    // Columns: RefMD, RefTVD, OffMD, OffTVD, SemiMajorRef, SemiMajorOff,
    // HighsideToolface, +N/-S, +E/-W, BetweenCentres, [BetweenEllipses,
    // MinimumSeparation, SeparationFactor] (last 3 absent at MD=0, where
    // C2C/SF aren't yet meaningful).
    var ANTICOLL_ROW_RE = /^([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,.]+))?\s*$/;

    // Extracts the digit-run "core token" from a well name (e.g. "161583"
    // out of "[02] ETS 161583_L01") — used to locate the matching
    // "Offset Design: ..." section in an Anticollision PDF, since MTX's
    // and Compass's own well-name formatting/spacing don't line up
    // character-for-character.
    function wellNameCoreToken(name){
        var m = /(\d{4,})/.exec(name || '');
        return m ? m[1] : null;
    }
    function parseAnticollisionPdfText(lines, offsetWellName){
        var token = wellNameCoreToken(offsetWellName);
        if(!token) return [];
        var rows = [], inSection = false, seen = {};
        // The "Offset Design:" marker and the site/well-name text that
        // names which offset it introduces can land on the SAME line
        // (seen from some PDF text extractors, e.g. server-side pdfplumber
        // during earlier validation) or on the line immediately BEFORE it
        // (seen from pdf.js's own text-position-based line reconstruction,
        // used here in the browser - the two pieces of text sit at
        // slightly different y-coordinates in the PDF itself). Check both
        // so this works regardless of extractor behavior.
        var prevLine = '';
        lines.forEach(function(line){
            if(/^Offset Design:/.test(line)){
                inSection = line.indexOf(token) !== -1 || prevLine.indexOf(token) !== -1;
                prevLine = line;
                return;
            }
            prevLine = line;
            if(!inSection) return;
            var m = ANTICOLL_ROW_RE.exec(line);
            if(!m) return;
            var mdRef = parseFloat(m[1].replace(/,/g,''));
            var key = mdRef.toFixed(2);
            if(seen[key]) return; // dedupe (page-break repeats)
            seen[key] = true;
            rows.push({
                mdRef: mdRef, mdOff: parseFloat(m[3].replace(/,/g,'')),
                betweenCentres: parseFloat(m[10].replace(/,/g,'')),
                sf: m[13] != null ? parseFloat(m[13].replace(/,/g,'')) : null
            });
        });
        rows.sort(function(a,b){ return a.mdRef-b.mdRef; });
        return rows;
    }
    function findNearestAcRow(acRows, targetMd, tolerance){
        if(!acRows || !acRows.length) return null;
        var best = null, bd = Infinity;
        acRows.forEach(function(r){ var d = Math.abs(r.mdRef-targetMd); if(d<bd){ bd=d; best=r; } });
        return (best && bd <= (tolerance||5)) ? best : null;
    }

    var LAST_ERR_ELLIPSE_ROWS = null; // re-render target when either upload changes
    var LAST_ANTICOLL_ROWS = null;

    function renderErrEllipseCompare(){
        var compassRows = LAST_ERR_ELLIPSE_ROWS;
        if(!compassRows) return;
        var panel = document.getElementById('acpErrEllipsePanel');
        var statusEl = document.getElementById('acpErrEllipseStatus');
        var refWell = WELLS.find(function(w){ return w.wellName === refSelect.value; });
        if(!refWell){ statusEl.textContent = 'No reference well selected.'; return; }
        var toolcodeName = wellToolcode(refWell);
        var refCov = computeWellCov(refWell, toolcodeName);
        var refPts = wellPoints(refWell);
        var kInput = document.getElementById('acpKSF');
        var kVal = kInput ? parseFloat(kInput.value) : NaN;
        var K = (!isNaN(kVal) && kVal > 0) ? kVal : 2;

        var offSelect = document.getElementById('acpErrEllipseOffsetWell');
        var offWell = offSelect ? WELLS.find(function(w){ return w.wellName === offSelect.value; }) : null;
        var offCov = offWell ? computeWellCov(offWell, wellToolcode(offWell)) : null;
        var offPts = offWell ? wellPoints(offWell) : null;
        var acRows = (offWell && LAST_ANTICOLL_ROWS && LAST_ANTICOLL_ROWS.forWell === offWell.wellName) ? LAST_ANTICOLL_ROWS.rows : null;

        var html = '<b style="color:#ffb020;">Error Ellipse comparison — Compass PDF vs MTX (' + refWell.wellName + ', toolcode ' + (toolcodeName||'—') + ', K=' + K.toFixed(4) + ')</b>' +
            '<div style="color:var(--an-text-dim,#5a7080);margin:2px 0 6px;">MWD+HRGM\'s missing SAG/XYM3/XYM4 terms were found and added 2026-08-21 — Semi-major/Semi-minor now typically agree with Compass within ~2-9% (was ~2x low before). C2C/SF columns need both an offset well selected above and its matching Anticollision PDF uploaded.</div>' +
            '<table style="width:100%;border-collapse:collapse;"><tr style="color:var(--an-text-dim,#5a7080);text-align:left;">' +
            '<th style="padding:2px 8px 2px 0;">MD (m)</th><th style="padding:2px 8px;">Inc (°)</th><th style="padding:2px 8px;">Az (°)</th>' +
            '<th style="padding:2px 8px;color:#ffb020;">Compass Semi-Maj (m)</th><th style="padding:2px 8px;color:#ffb020;">Compass Semi-Min (m)</th>' +
            '<th style="padding:2px 8px;color:#79c0ff;">MTX Semi-Maj (m)</th><th style="padding:2px 8px;color:#79c0ff;">MTX Semi-Min (m)</th>' +
            '<th style="padding:2px 8px;">Δ Semi-Maj</th><th style="padding:2px 8px;">Δ Semi-Min</th>' +
            '<th style="padding:2px 8px;color:#ffb020;border-left:1px solid #2a3a4a;">Compass C2C (m)</th><th style="padding:2px 8px;color:#ffb020;">Compass SF</th>' +
            '<th style="padding:2px 8px;color:#79c0ff;">MTX C2C (m)</th><th style="padding:2px 8px;color:#79c0ff;">MTX SF</th></tr>' +
            compassRows.map(function(r){
                var P = interpAtMd(refPts, r.md);
                var st = refCov ? findNearestCovStation(refCov, r.md) : null;
                var mtx = (P && st) ? ellipseHighsideLateral(st.cov, P.incl*Math.PI/180, P.azim*Math.PI/180, K) : null;
                var dMaj = mtx ? (100*(mtx.semiMajor - r.semiMajor)/(r.semiMajor||1e-9)) : null;
                var dMin = mtx ? (100*(mtx.semiMinor - r.semiMinor)/(r.semiMinor||1e-9)) : null;

                var compassAc = acRows ? findNearestAcRow(acRows, r.md) : null;
                var mtxAc = null;
                if(offWell && offPts && P){
                    var closest = closestApproachDistance(P, offPts);
                    var offPt = { md: closest.offMd, incl: closest.offIncl, azim: closest.offAzim, x: closest.offX, y: closest.offY, z: closest.offZ };
                    var offSt = offCov ? findNearestCovStation(offCov, closest.offMd) : null;
                    var sfResult = (st && offSt) ? separationFactorReal(P, offPt, closest.dist, st, offSt) : null;
                    if(!sfResult) sfResult = separationFactorSimplified(P, offPt, closest.dist);
                    mtxAc = { c2c: closest.dist, sf: sfResult.sf };
                }
                return '<tr><td style="padding:2px 8px 2px 0;">' + r.md.toFixed(2) + '</td>' +
                    '<td style="padding:2px 8px;">' + r.inc.toFixed(2) + '</td>' +
                    '<td style="padding:2px 8px;">' + r.az.toFixed(2) + '</td>' +
                    '<td style="padding:2px 8px;color:#ffb020;">' + r.semiMajor.toFixed(3) + '</td>' +
                    '<td style="padding:2px 8px;color:#ffb020;">' + r.semiMinor.toFixed(3) + '</td>' +
                    '<td style="padding:2px 8px;color:#79c0ff;">' + (mtx ? mtx.semiMajor.toFixed(3) : '—') + '</td>' +
                    '<td style="padding:2px 8px;color:#79c0ff;">' + (mtx ? mtx.semiMinor.toFixed(3) : '—') + '</td>' +
                    '<td style="padding:2px 8px;">' + (dMaj!=null ? dMaj.toFixed(1)+'%' : '—') + '</td>' +
                    '<td style="padding:2px 8px;">' + (dMin!=null ? dMin.toFixed(1)+'%' : '—') + '</td>' +
                    '<td style="padding:2px 8px;color:#ffb020;border-left:1px solid #2a3a4a;">' + (compassAc ? compassAc.betweenCentres.toFixed(2) : '—') + '</td>' +
                    '<td style="padding:2px 8px;color:#ffb020;">' + (compassAc && compassAc.sf!=null ? compassAc.sf.toFixed(3) : '—') + '</td>' +
                    '<td style="padding:2px 8px;color:#79c0ff;">' + (mtxAc ? mtxAc.c2c.toFixed(2) : '—') + '</td>' +
                    '<td style="padding:2px 8px;color:#79c0ff;">' + (mtxAc && isFinite(mtxAc.sf) ? mtxAc.sf.toFixed(3) : (mtxAc ? '∞' : '—')) + '</td></tr>';
            }).join('') + '</table>';
        panel.innerHTML = html;
        panel.style.display = 'block';
        var acNote = offWell ? (acRows ? (acRows.length + ' Anticollision row(s) matched for ' + offWell.wellName + '.') : ('No Anticollision PDF uploaded yet for ' + offWell.wellName + ' — C2C/SF (Compass) will show as "—".')) : 'Select an offset well to enable C2C/SF columns.';
        statusEl.textContent = compassRows.length + ' station(s) parsed from Error Ellipse PDF. ' + acNote;
    }

    (function setupErrEllipseUpload(){
        var fileInput = document.getElementById('acpErrEllipseFile');
        var statusEl = document.getElementById('acpErrEllipseStatus');
        if(!fileInput) return;
        fileInput.addEventListener('change', function(){
            var file = fileInput.files && fileInput.files[0];
            if(!file) return;
            if(typeof pdfjsLib === 'undefined'){ statusEl.textContent = 'PDF library failed to load.'; return; }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            statusEl.textContent = 'Parsing PDF…';
            var reader = new FileReader();
            reader.onload = function(){
                pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise.then(function(pdf){
                    var pagePromises = [];
                    for(var p = 1; p <= pdf.numPages; p++){
                        pagePromises.push(pdf.getPage(p).then(function(page){ return page.getTextContent(); }).then(pdfPageToLines));
                    }
                    return Promise.all(pagePromises);
                }).then(function(pagesOfLines){
                    var allLines = [].concat.apply([], pagesOfLines);
                    var rows = parseErrorEllipsePdfText(allLines);
                    if(!rows.length){
                        statusEl.textContent = 'No Error Ellipse rows recognized in this PDF — is it a Compass "Error Ellipse Survey" report?';
                        return;
                    }
                    LAST_ERR_ELLIPSE_ROWS = rows;
                    renderErrEllipseCompare();
                }).catch(function(err){
                    console.error('[AC Plots] Error Ellipse PDF parse failed', err);
                    statusEl.textContent = 'Failed to parse PDF: ' + err.message;
                });
            };
            reader.readAsArrayBuffer(file);
        });
    })();

    (function setupAnticollUpload(){
        var fileInput = document.getElementById('acpAntiCollFile');
        var statusEl = document.getElementById('acpAntiCollStatus');
        var offSelect = document.getElementById('acpErrEllipseOffsetWell');
        if(!fileInput) return;
        fileInput.addEventListener('change', function(){
            var file = fileInput.files && fileInput.files[0];
            if(!file) return;
            var offWellName = offSelect ? offSelect.value : null;
            if(!offWellName){ statusEl.textContent = 'Select an offset well first.'; return; }
            if(typeof pdfjsLib === 'undefined'){ statusEl.textContent = 'PDF library failed to load.'; return; }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            statusEl.textContent = 'Parsing PDF…';
            var reader = new FileReader();
            reader.onload = function(){
                pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise.then(function(pdf){
                    var pagePromises = [];
                    for(var p = 1; p <= pdf.numPages; p++){
                        pagePromises.push(pdf.getPage(p).then(function(page){ return page.getTextContent(); }).then(pdfPageToLines));
                    }
                    return Promise.all(pagePromises);
                }).then(function(pagesOfLines){
                    var allLines = [].concat.apply([], pagesOfLines);
                    var rows = parseAnticollisionPdfText(allLines, offWellName);
                    if(!rows.length){
                        statusEl.textContent = 'No matching "Offset Design" section found for ' + offWellName + ' in this PDF — check the offset well selection and that this is the right Anticollision report.';
                        return;
                    }
                    LAST_ANTICOLL_ROWS = { forWell: offWellName, rows: rows };
                    renderErrEllipseCompare();
                }).catch(function(err){
                    console.error('[AC Plots] Anticollision PDF parse failed', err);
                    statusEl.textContent = 'Failed to parse PDF: ' + err.message;
                });
            };
            reader.readAsArrayBuffer(file);
        });
        if(offSelect) offSelect.addEventListener('change', function(){ renderErrEllipseCompare(); });
    })();

    // ─────────────────────────────────────────────────────────────────
    // MTX AC REPORT
    //
    // A station-by-station anticollision report, computed entirely by
    // MTX's own ISCWSA engine, for the selected Reference Well against
    // EVERY offset well currently plotted (per person's explicit choice:
    // "All offset wells currently plotted" for report scope). Laid out
    // to match Compass's own "Anticollision with Risk" report (see the
    // person's attached screenshot, [01] ETS 161582 ... Anticollision
    // with Risk.PDF): Reference (MD,VD), Offset (MD,VD), Semi Major Axis
    // (Ref, Off), Between Centres, Wall-Wall Distance, Between Ellipses,
    // Minimum Separation, Separation Factor, Probability of Collision,
    // Warning.
    //
    // Column definitions and what they reuse from ALREADY-VALIDATED code
    // in this same panel (not new/guessed math):
    //   - Reference MD/VD, Offset MD/VD: wellPoints()/closestApproachDistance()
    //     (same functions the C2C/SF charts above already use). VD here
    //     is TVDss = -z, same convention as evaluateAtMd().
    //   - Semi Major Axis (Ref/Off): UR_ref/UR_off from separationFactorReal()
    //     — the K-scaled pedal-curve radius of each well's OWN uncertainty
    //     ellipsoid projected onto the line joining the two wells. This is
    //     the same quantity already labeled "UR_ref (m)"/"UR_off (m)" in
    //     the Evaluate-at-MD panel above, which was cross-checked against
    //     this well's real Compass Anticollision report.
    //   - Between Centres: closestApproachDistance()'s dist (= C2C).
    //   - Wall-Wall Distance: set equal to Between Centres for now, per
    //     the person's explicit direction (2026-08-22) — MTX does not yet
    //     model a per-well wellbore/casing wall radius (TBR) subtracted
    //     from Between Centres, so there is nothing else to report here.
    //   - Between Ellipses / Minimum Separation: Between Centres minus
    //     (Semi Major Axis Ref + Semi Major Axis Off) — the same pedal-
    //     curve subtraction that sfFromTwoRadii() uses internally to get
    //     SF; since 2026-11-14 it is S - urComb, the combined radius of the selected Error Surface; reported as its own column here so it can
    //     be read directly like Compass's own "Between Ellipses" column.
    //     Minimum Separation is set equal to Between Ellipses (no TBR
    //     term available to distinguish the two — see Wall-Wall Distance
    //     note above; if TBR is added later, Minimum Separation should
    //     become Between Ellipses - TBR while Between Ellipses stays as-is).
    //   - Separation Factor: separationFactorReal()/sfFromTwoRadii() — the
    //     exact same SF already plotted/validated elsewhere in this panel.
    //   - Probability of Collision: NOT IMPLEMENTED. Two candidate source
    //     documents (SPE-184644, Jon Bang/Gyrodata 2017; OWSG sub-committee
    //     Dec-2023 meeting slides) were read in full on 2026-08-22 and
    //     neither contains a complete, implementable, validated POC
    //     formula — SPE-184644's slide deck shows only a partial Taylor-
    //     expansion approximation (Slide 8: Pj ≈ fX fY fZ (pi R1 R2 L) + ...)
    //     with fX/fY/fZ and the segment angle beta_j left undefined (those
    //     live only in the full OnePetro paper, not in the slide deck we
    //     have); the OWSG deck's POC section is literally a discussion
    //     agenda asking operators "Is there an agreement in the industry
    //     on a specific model to calculate Probability of Collision?" and
    //     "what is the calculation method used in Compass?" — i.e. even
    //     ISCWSA's own sub-committee did not have Compass's formula as of
    //     Dec 2023. Per the hard project rule against inventing/guessing
    //     drilling-engineering formulas, this column reports a fixed
    //     placeholder until a validated source (e.g. the full SPE-184644-MS
    //     OnePetro paper, or Compass's documented method) is obtained.
    //   - Warning: classified from Separation Factor using the SAME
    //     thresholds already used elsewhere in this file's Anti-Collision
    //     tooling (see classForSF/classForC2C in the PAD AC SCRIPT block
    //     above: SF < 1.0 = red/collision risk, SF < 1.25 = amber/caution)
    //     — reused here for consistency, not a newly invented threshold.
    // ─────────────────────────────────────────────────────────────────
    var LAST_MTX_AC_REPORT = null; // { refName, rows: [...] }

    function mtxAcWarningFor(sf){
        if(sf == null || !isFinite(sf)) return '';
        if(sf < 1.0) return 'COLLISION RISK (SF<1.0)';
        if(sf < 1.25) return 'CAUTION (SF<1.25)';
        return '';
    }

    function buildMtxAcReport(){
        var refName = refSelect.value;
        var refWell = WELLS.find(function(w){ return w.wellName === refName; });
        if(!refWell) return null;

        var kInput = document.getElementById('acpKSF');
        var kVal = kInput ? parseFloat(kInput.value) : NaN;
        K_SF = (!isNaN(kVal) && kVal > 0) ? kVal : 2;

        var refPts = wellPoints(refWell);
        var refCov = computeWellCov(refWell, wellToolcode(refWell));
        var offsetWells = WELLS.filter(function(w){ return w.wellName !== refName; });

        var rows = [];
        offsetWells.forEach(function(offWell){
            var offPts = wellPoints(offWell);
            var offCov = computeWellCov(offWell, wellToolcode(offWell));
            refPts.forEach(function(P){
                var ca = closestApproachDistance(P, offPts);
                var offPt = { md: ca.offMd, incl: ca.offIncl, azim: ca.offAzim, x: ca.offX, y: ca.offY, z: ca.offZ };
                var sf;
                if(refCov && offCov){
                    var refSt = findNearestCovStation(refCov, P.md);
                    var offSt = findNearestCovStation(offCov, ca.offMd);
                    sf = separationFactorReal(P, offPt, ca.dist, refSt, offSt);
                    if(sf == null) sf = separationFactorSimplified(P, offPt, ca.dist);
                } else {
                    sf = separationFactorSimplified(P, offPt, ca.dist);
                }
                var betweenEllipses = ca.dist - (sf.urComb != null ? sf.urComb : (sf.urRef + sf.urOff));   // 2026-11-14: combined radius of the selected Error Surface

                // Raw (unscaled, no Confidence-K) local-frame covariance for
                // each well at this pair of points — reuses the SAME
                // nevToLocalCov() conversion separationFactorReal() already
                // uses above, just without the K-scaled/directional
                // projection, since Monte Carlo needs the full 3x3 (not a
                // single projected radius). Falls back to the same diagonal
                // simplifiedCovariance() the SF fallback path uses when no
                // real per-station ISCWSA covariance is available.
                var refStForMc = (refCov ? findNearestCovStation(refCov, P.md) : null);
                var offStForMc = (offCov ? findNearestCovStation(offCov, ca.offMd) : null);
                var refLocalCov, offLocalCov;
                if(refStForMc && offStForMc){
                    refLocalCov = nevToLocalCov(refStForMc.cov);
                    offLocalCov = nevToLocalCov(offStForMc.cov);
                } else {
                    var cRefSimp = simplifiedCovariance(P.md, P.incl);
                    var cOffSimp = simplifiedCovariance(offPt.md, offPt.incl);
                    refLocalCov = { xx: cRefSimp.xx, yy: cRefSimp.yy, zz: cRefSimp.zz, xy: 0, xz: 0, yz: 0 };
                    offLocalCov = { xx: cOffSimp.xx, yy: cOffSimp.yy, zz: cOffSimp.zz, xy: 0, xz: 0, yz: 0 };
                }
                // Independent combination (no cross-well correlation) — Sc =
                // S1 + S2, the "most common assumption" default per Jon Bang
                // SPE-184644 slide 24, matching the same no-correlation
                // default already documented/used for SF above.
                var covComb = {
                    xx: refLocalCov.xx + offLocalCov.xx, yy: refLocalCov.yy + offLocalCov.yy, zz: refLocalCov.zz + offLocalCov.zz,
                    xy: refLocalCov.xy + offLocalCov.xy, xz: refLocalCov.xz + offLocalCov.xz, yz: refLocalCov.yz + offLocalCov.yz
                };

                rows.push({
                    offsetName: offWell.wellName,
                    refMd: P.md, refVd: -P.z,
                    offMd: ca.offMd, offVd: (ca.offZ != null ? -ca.offZ : null),
                    semiMajorRef: sf.urRef, semiMajorOff: sf.urOff,
                    betweenCentres: ca.dist,
                    wallWallDistance: ca.dist, // = Between Centres for now, per person's direction (no TBR modeled yet)
                    betweenEllipses: betweenEllipses,
                    minimumSeparation: betweenEllipses, // = Between Ellipses for now (no TBR to distinguish them — see comment above)
                    sf: sf.sf,
                    poc: null, // filled in by runMonteCarloPoc() when the person runs it — see that function's comment
                    warning: mtxAcWarningFor(sf.sf),
                    _dx: P.x - offPt.x, _dy: P.y - offPt.y, _dz: P.z - offPt.z, // relative position vector, same local x/y/z frame as everything else in this panel
                    _covComb: covComb
                });
            });
        });
        rows.sort(function(a,b){
            if(a.offsetName !== b.offsetName) return a.offsetName < b.offsetName ? -1 : 1;
            return a.refMd - b.refMd;
        });
        return { refName: refName, rows: rows };
    }

    function fmt(v, dec){ return (v == null || !isFinite(v)) ? '—' : v.toFixed(dec); }

    // Formats a Monte Carlo hit count as odds, "1 / X (P%)" — matching the
    // "1 in X" convention Compass itself uses for this same column (see the
    // real Compass "Introducing probability of collision" report screenshot
    // reviewed 2026-08-22, e.g. "1 in 481", "1 in 35,428"), rather than the
    // raw "hits/trials" fraction. Normalizes hits to a numerator of 1 by
    // dividing trials by hits — undefined when hits=0, so that case is
    // reported as "0 hits" with the trial count instead of a false "1 / ∞".
    function pocOddsLabel(poc){
        if(!poc) return 'Not run';
        var pct = (poc.phat * 100).toFixed(poc.phat > 0 && poc.phat < 0.005 ? 4 : 2);
        if(poc.hits <= 0) return '0 hits / ' + poc.trials + ' (< ' + (100/poc.trials).toFixed(4) + '%)';
        var oneInX = poc.trials / poc.hits;
        return '1 / ' + oneInX.toFixed(oneInX >= 100 ? 0 : 1) + ' (' + pct + '%)';
    }

    function renderMtxAcReport(){
        var panel = document.getElementById('acpMtxAcReportPanel');
        var xlsBtn = document.getElementById('acpMtxAcReportXlsBtn');
        var statusEl = document.getElementById('acpMtxAcReportStatus');
        var report = buildMtxAcReport();
        if(!report || !report.rows.length){
            panel.style.display = 'none';
            xlsBtn.style.display = 'none';
            if(statusEl) statusEl.textContent = 'Need a Reference Well and at least one other well plotted.';
            return;
        }
        LAST_MTX_AC_REPORT = report;
        if(statusEl) statusEl.textContent = report.rows.length + ' rows (' + report.refName + ' vs ' +
            (WELLS.length - 1) + ' offset well' + (WELLS.length - 1 === 1 ? '' : 's') + ', K=' + K_SF.toFixed(4) + ')';
        renderMtxAcReportTable();
        xlsBtn.style.display = 'inline-block';
    }

    // Re-renders LAST_MTX_AC_REPORT without rebuilding it — used both right
    // after buildMtxAcReport() and after runMonteCarloPoc() fills in each
    // row's .poc, so a Monte Carlo run doesn't discard itself by re-sweeping
    // the geometry.
    function renderMtxAcReportTable(){
        var panel = document.getElementById('acpMtxAcReportPanel');
        var report = LAST_MTX_AC_REPORT;
        if(!report || !report.rows.length) return;

        var pocNote = report.rows.length && report.rows[0].poc
            ? ('Probability of Collision = Monte Carlo estimate, ' + report.mcTrials + ' trials/row, Combined Hit Radius = ' + report.hitRadius + ' m — see 🎲 button tooltip for exactly what is/isn\'t validated here.')
            : 'Probability of Collision: no analytic formula could be validated from available sources (see code comment above buildMtxAcReport()) — click 🎲 Run Monte Carlo POC for a numerical estimate instead.';

        var html = '<b style="color:#79c0ff;">MTX AC Report</b> — Reference: ' + report.refName +
            ' (computed by MTX\'s own ISCWSA engine — see code comment above buildMtxAcReport() for exactly which already-validated functions each column reuses). ' + pocNote + '<br>' +
            '<table style="width:100%;margin-top:6px;border-collapse:collapse;"><tr style="color:var(--an-text-dim,#5a7080);text-align:left;">' +
            '<th style="padding:2px 8px 2px 0;">Offset Well</th>' +
            '<th style="padding:2px 8px;">Ref MD (m)</th><th style="padding:2px 8px;">Ref VD (m)</th>' +
            '<th style="padding:2px 8px;">Off MD (m)</th><th style="padding:2px 8px;">Off VD (m)</th>' +
            '<th style="padding:2px 8px;">Semi Major Axis Ref (m)</th><th style="padding:2px 8px;">Semi Major Axis Off (m)</th>' +
            '<th style="padding:2px 8px;">Between Centres (m)</th><th style="padding:2px 8px;">Wall-Wall Distance (m)</th>' +
            '<th style="padding:2px 8px;">Between Ellipses (m)</th><th style="padding:2px 8px;">Minimum Separation (m)</th>' +
            '<th style="padding:2px 8px;">Separation Factor</th><th style="padding:2px 8px;">Probability of Collision (Monte Carlo)</th>' +
            '<th style="padding:2px 8px;">Warning</th></tr>' +
            report.rows.map(function(r){
                var warnColor = r.warning.indexOf('COLLISION') === 0 ? '#ff4060' : (r.warning ? '#ffb020' : '#5a7080');
                var pocCell = pocOddsLabel(r.poc);
                var pocColor = r.poc && r.poc.hits > 0 ? '#ff4060' : '#5a7080';
                return '<tr><td style="padding:2px 8px 2px 0;">' + r.offsetName + '</td>' +
                    '<td style="padding:2px 8px;">' + fmt(r.refMd,2) + '</td><td style="padding:2px 8px;">' + fmt(r.refVd,2) + '</td>' +
                    '<td style="padding:2px 8px;">' + fmt(r.offMd,2) + '</td><td style="padding:2px 8px;">' + fmt(r.offVd,2) + '</td>' +
                    '<td style="padding:2px 8px;">' + fmt(r.semiMajorRef,3) + '</td><td style="padding:2px 8px;">' + fmt(r.semiMajorOff,3) + '</td>' +
                    '<td style="padding:2px 8px;">' + fmt(r.betweenCentres,3) + '</td><td style="padding:2px 8px;">' + fmt(r.wallWallDistance,3) + '</td>' +
                    '<td style="padding:2px 8px;">' + fmt(r.betweenEllipses,3) + '</td><td style="padding:2px 8px;">' + fmt(r.minimumSeparation,3) + '</td>' +
                    '<td style="padding:2px 8px;">' + (isFinite(r.sf) ? r.sf.toFixed(3) : '∞') + '</td>' +
                    '<td style="padding:2px 8px;color:' + pocColor + ';">' + pocCell + '</td>' +
                    '<td style="padding:2px 8px;color:' + warnColor + ';">' + (r.warning || '') + '</td></tr>';
            }).join('') + '</table>';
        panel.innerHTML = html;
        panel.style.display = 'block';
    }

    // ─────────────────────────────────────────────────────────────────
    // MONTE CARLO PROBABILITY OF COLLISION (DIRECT HIT)
    //
    // Numerically evaluates the exact same probability definition given
    // conceptually in both POC sources read on 2026-08-22:
    //   - SPE-184644 (Jon Bang/Gyrodata, 2017), Slide 15: "Probability =
    //     integral of pdf over specific volume."
    //   - The person's own notes: relative position modeled as Gaussian
    //     (mean = relative position, covariance = Σcomb from both wells),
    //     collision = relative distance ≤ Rref+Roff, POC = the 3D Gaussian
    //     integral of that pdf over the sphere of radius Rref+Roff.
    // Rather than deriving/guessing a closed-form formula for that
    // integral (SPE-184644's own closed-form approximation was found to
    // be incomplete/unreproducible from the slide deck alone — see the
    // comment above buildMtxAcReport()), this evaluates it directly by
    // Monte Carlo sampling: draw N samples from N(meanVec, Σcomb) using a
    // standard Cholesky-decomposition sampler (generic linear algebra,
    // not a drilling-specific formula), count what fraction land within
    // the Combined Hit Radius of the reference centerline. This is a
    // standard, textbook numerical-integration technique — no ISCWSA/SPE
    // formula is invented; the only domain-specific inputs are Σcomb
    // (the ALREADY-VALIDATED ISCWSA relative covariance, RAW/unscaled —
    // no Confidence-K applied, since K is a reporting confidence multiplier
    // for SF, not part of the physical uncertainty distribution itself)
    // and meanVec (the actual surveyed relative position, both already
    // computed in buildMtxAcReport()).
    //
    // Numerically validated 2026-08-22 (standalone Node script, not
    // committed): for an isotropic N(0,sigma^2*I) covariance, Monte Carlo
    // hit rate vs. the closed-form Maxwell/chi(3) CDF P(|v|<=R) =
    // erf(R/(sigma*sqrt2)) - sqrt(2/pi)*(R/sigma)*exp(-R^2/(2*sigma^2))
    // matched to within ~0.03% at 2,000,000 trials across R/sigma =
    // 0.5..2; and cholesky3x3()'s sampler reproduced an arbitrary
    // correlated 3x3 target covariance (incl. nonzero cross terms) to
    // within ~0.1% over 3,000,000 draws — confirming both the sampler and
    // the hit-counting logic are correct generic implementations before
    // being wired into this report.
    //
    // Σcomb combination = independent sum (no cross-well correlation),
    // matching Jon Bang slide 24's "Independent (most common assumption):
    // r12=0, σc²=σ1²+σ2²" — i.e. the SAME default already used for this
    // tool's Separation Factor (see comment above K_SF/separationFactorReal).
    //
    // CAVEATS a person reading these numbers must know:
    //   1. Combined Hit Radius is a REQUIRED user input — MTX does not
    //      model per-well borehole/casing radius (TBR) anywhere else in
    //      this tool, so this is not a validated drilling-engineering
    //      default, it is whatever the person typed into the box.
    //   2. This is a random estimate, not a deterministic value — with
    //      1000 trials, results will vary run to run (a further reason to
    //      raise the trial count if a specific station's hit rate matters).
    //   3. This only computes the DIRECT HIT probability (relative
    //      position lands inside the hit sphere at ANY sampled instant at
    //      each station individually) — NOT the "unintentional crossing"
    //      (UC) probability along a wellpath segment, which per SPE-184644
    //      needs a materially different method (segment/volume integral,
    //      not a per-station point estimate) that is not implemented here.
    // ─────────────────────────────────────────────────────────────────
    function randStdNormal(){
        var u1 = 0;
        while(u1 === 0) u1 = Math.random();
        var u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // Cholesky decomposition of a symmetric 3x3 (cov = {xx,yy,zz,xy,xz,yz})
    // into lower-triangular L such that L*L^T ≈ cov, clipped to remain
    // real/PSD the same way this file's eigenvalue code elsewhere clips
    // negative variances (Math.max(...,0)) — generic linear algebra, not
    // drilling-specific.
    function cholesky3x3(cov){
        var L11 = Math.sqrt(Math.max(cov.xx, 0));
        var L21 = L11 > 1e-12 ? cov.xy / L11 : 0;
        var L31 = L11 > 1e-12 ? cov.xz / L11 : 0;
        var L22 = Math.sqrt(Math.max(cov.yy - L21*L21, 0));
        var L32 = L22 > 1e-12 ? (cov.yz - L31*L21) / L22 : 0;
        var L33 = Math.sqrt(Math.max(cov.zz - L31*L31 - L32*L32, 0));
        return { L11: L11, L21: L21, L31: L31, L22: L22, L32: L32, L33: L33 };
    }

    function monteCarloHitCount(meanVec, cov, hitRadius, trials){
        var L = cholesky3x3(cov);
        var hits = 0;
        for(var i = 0; i < trials; i++){
            var z1 = randStdNormal(), z2 = randStdNormal(), z3 = randStdNormal();
            var vx = meanVec[0] + L.L11*z1;
            var vy = meanVec[1] + L.L21*z1 + L.L22*z2;
            var vz = meanVec[2] + L.L31*z1 + L.L32*z2 + L.L33*z3;
            var d = Math.sqrt(vx*vx + vy*vy + vz*vz);
            if(d <= hitRadius) hits++;
        }
        return hits;
    }

    function runMonteCarloPoc(){
        var statusEl = document.getElementById('acpMtxAcReportStatus');
        if(!LAST_MTX_AC_REPORT || !LAST_MTX_AC_REPORT.rows.length){
            if(statusEl) statusEl.textContent = 'Build the MTX AC Report first.';
            return;
        }
        var radiusInput = document.getElementById('acpHitRadius');
        var trialsInput = document.getElementById('acpMcTrials');
        var hitRadius = parseFloat(radiusInput && radiusInput.value);
        var trials = parseInt(trialsInput && trialsInput.value, 10);
        if(isNaN(hitRadius) || hitRadius < 0){
            if(statusEl) statusEl.textContent = 'Enter a valid Combined Hit Radius (Rref+Roff, metres) first — MTX does not model borehole/casing radius (TBR), so you must supply it.';
            return;
        }
        if(!trials || trials < 1) trials = 1000;

        if(statusEl) statusEl.textContent = 'Running Monte Carlo (' + trials + ' trials/row × ' + LAST_MTX_AC_REPORT.rows.length + ' rows)…';
        // setTimeout(...,10) lets the "Running…" status paint before the
        // (synchronous, potentially multi-second) sampling loop blocks the
        // main thread.
        setTimeout(function(){
            var t0 = Date.now();
            LAST_MTX_AC_REPORT.rows.forEach(function(r){
                var hits = monteCarloHitCount([r._dx, r._dy, r._dz], r._covComb, hitRadius, trials);
                r.poc = { hits: hits, trials: trials, phat: hits / trials };
            });
            LAST_MTX_AC_REPORT.hitRadius = hitRadius;
            LAST_MTX_AC_REPORT.mcTrials = trials;
            var ms = Date.now() - t0;
            renderMtxAcReportTable();
            if(statusEl) statusEl.textContent = 'Monte Carlo done in ' + ms + ' ms (' + trials + ' trials/row, Combined Hit Radius=' + hitRadius + ' m).';
        }, 10);
    }

    function downloadMtxAcReportXlsx(){
        if(!LAST_MTX_AC_REPORT || !LAST_MTX_AC_REPORT.rows.length) return;
        var hasPoc = !!LAST_MTX_AC_REPORT.rows[0].poc;
        var headers = ['Offset Well','Ref MD (m)','Ref VD (m)','Off MD (m)','Off VD (m)',
            'Semi Major Axis Ref (m)','Semi Major Axis Off (m)','Between Centres (m)','Wall-Wall Distance (m)',
            'Between Ellipses (m)','Minimum Separation (m)','Separation Factor',
            hasPoc ? ('POC, "1 in X" (Monte Carlo, ' + LAST_MTX_AC_REPORT.mcTrials + ' trials)') : 'Probability of Collision',
            hasPoc ? 'POC (%)' : null,
            'Warning'].filter(function(h){ return h !== null; });
        var aoa = [headers].concat(LAST_MTX_AC_REPORT.rows.map(function(r){
            var row = [r.offsetName, r.refMd, r.refVd, r.offMd, r.offVd,
                r.semiMajorRef, r.semiMajorOff, r.betweenCentres, r.wallWallDistance,
                r.betweenEllipses, r.minimumSeparation, r.sf];
            if(hasPoc){ row.push(pocOddsLabel(r.poc)); row.push(r.poc.phat*100); }
            else { row.push('Not implemented — see MTX AC Report panel notes'); }
            row.push(r.warning || '');
            return row;
        }));
        if(hasPoc){
            aoa.push([]);
            aoa.push(['Monte Carlo Combined Hit Radius (Rref+Roff, m):', LAST_MTX_AC_REPORT.hitRadius]);
            aoa.push(['Monte Carlo trials per row:', LAST_MTX_AC_REPORT.mcTrials]);
            aoa.push(['NOTE: Monte Carlo Direct-Hit estimate only — not the Unintentional-Crossing probability along a segment; see code comment above runMonteCarloPoc() in job.ejs.']);
        }
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'MTX AC Report');
        var fname = 'MTX_AC_Report_' + LAST_MTX_AC_REPORT.refName.replace(/[^a-z0-9]+/gi,'_') + '.xlsx';
        XLSX.writeFile(wb, fname);
    }

    // Build + immediately run Monte Carlo POC in one click, per person's
    // direction (2026-08-22: "run it when push the Build Mtx AC report
    // button please") — renderMtxAcReport() rebuilds LAST_MTX_AC_REPORT
    // fresh (clearing any prior .poc), so runMonteCarloPoc() is chained
    // right after rather than run independently, using whatever Combined
    // Hit Radius / MC Trials values are currently in the two boxes above
    // (defaulted to 0.17 m / 25000 trials per the person's own values,
    // but still editable before clicking Build if a different run is wanted).
    function buildAndRunMtxAcReport(){
        renderMtxAcReport();
        if(LAST_MTX_AC_REPORT && LAST_MTX_AC_REPORT.rows.length) runMonteCarloPoc();
    }

    (function setupMtxAcReportButtons(){
        var buildBtn = document.getElementById('acpMtxAcReportBtn');
        var xlsBtn = document.getElementById('acpMtxAcReportXlsBtn');
        var mcBtn = document.getElementById('acpMcPocBtn');
        if(buildBtn) buildBtn.addEventListener('click', buildAndRunMtxAcReport);
        if(xlsBtn) xlsBtn.addEventListener('click', downloadMtxAcReportXlsx);
        if(mcBtn) mcBtn.addEventListener('click', runMonteCarloPoc);
    })();

    var palette = ['#ff6b35', '#39ff14', '#ffd060', '#c084fc', '#2dd4bf', '#ff4060', '#79c0ff', '#e879f9'];
    var acpChart = null;
    var acpChartSF = null;
    var acpChartTCV = null;

    // ==========================================================================
    // Traveling Cylinder Plot
    // ==========================================================================
    // Construction per Thorogood & Sawaryn, "The Traveling Cylinder: A
    // Practical Tool for Collision Avoidance," SPE/IADC 19989 (1991) — the
    // paper that introduced the TCP — cross-checked against a detailed
    // practitioner writeup (Hawkeye3D). Key point, quoting the source
    // directly: "The center of the plot represents all the points along
    // the reference well... the natural plane on which to measure
    // distances is the normal plane, the plane which is perpendicular to
    // the direction of the reference point AT ANY GIVEN DEPTH." That means
    // the frame is rebuilt at EVERY reference-well station swept (not one
    // frame frozen at a single depth), and what's plotted at each swept
    // reference MD is where each offset well CROSSES that station's normal
    // plane — not the offset well's own stations. The reference well
    // always sits exactly at the origin by construction and is never
    // itself plotted (matches the source: "the reference well in the
    // center stays unmarked").
    //
    // Standard directional-drilling "High Side / Right" toolface reference
    // frame at a station of inclination I, azimuth A. Derived here (not
    // already in iscwsaModel.js, which works in inclination/azimuth error
    // space directly rather than needing an explicit Cartesian frame) from
    // first principles in NED (North/East/Down) and verified against known
    // special cases before converting to this file's (Easting, Northing,
    // z=-TVDss, z-up) convention used by wellPoints() below:
    //   Ahead (tangent)   = (sinI sinA,  sinI cosA, -cosI)
    //   High Side         = (cosI sinA,  cosI cosA,  sinI)   — projection of
    //                        "up" perpendicular to Ahead; undefined at I=0
    //                        (no defined toolface at exactly vertical, a
    //                        real, well-known directional-drilling fact —
    //                        the frame falls back to true North/East there).
    //   Right             = Ahead × High Side = (cosA, -sinA, 0) — always
    //                        horizontal, at azimuth A+90°, matching the
    //                        standard "right" toolface reference used
    //                        throughout directional drilling/MWD practice.
    // Checked at I=90°,A=0° (horizontal, heading North): High Side lands on
    // pure "up" and Right lands on pure East, as expected for a driller
    // facing North with high side up.
    function tcvFrame(inclDeg, azimDeg){
        var I = inclDeg * Math.PI / 180, A = azimDeg * Math.PI / 180;
        var sI = Math.sin(I), cI = Math.cos(I), sA = Math.sin(A), cA = Math.cos(A);
        var ahead = { x: sI*sA, y: sI*cA, z: -cI };
        if(sI < 1e-6){
            // At/near vertical, High Side/Right are undefined by inclination
            // alone — fall back to true North/East so the frame degrades
            // gracefully instead of dividing by ~0.
            return { ahead: ahead, high: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 } };
        }
        return {
            ahead: ahead,
            high:  { x: cI * sA, y: cI * cA, z: sI },
            right: { x: cA,      y: -sA,     z: 0 }
        };
    }
    function dot3(a,b){ return a.x*b.x + a.y*b.y + a.z*b.z; }

    // Linear interpolation of a wellbore's x/y/z/incl/azim at an arbitrary
    // MD between two adjacent survey stations — same simple polyline
    // treatment already used by closestOnSegment()/closestApproachDistance()
    // above for C2C, so this introduces no new interpolation methodology.
    function interpAtMD(pts, md){
        if(!pts.length) return null;
        if(md <= pts[0].md) return pts[0];
        if(md >= pts[pts.length-1].md) return pts[pts.length-1];
        for(var i=1;i<pts.length;i++){
            if(md <= pts[i].md){
                var A = pts[i-1], B = pts[i];
                var t = (B.md===A.md) ? 0 : (md - A.md)/(B.md - A.md);
                return {
                    md: md,
                    x: A.x + t*(B.x-A.x), y: A.y + t*(B.y-A.y), z: A.z + t*(B.z-A.z),
                    incl: A.incl + t*(B.incl-A.incl), azim: A.azim + t*(B.azim-A.azim)
                };
            }
        }
        return pts[pts.length-1];
    }

    // "Nice" ring step (1/2/5 x 10^n) so radius rings land on round numbers
    // rather than whatever the max radius happens to be — standard chart-
    // axis rounding approach.
    function niceRingStep(maxR, targetRings){
        if(!(maxR > 0)) return 1;
        var raw = maxR / (targetRings || 4);
        var mag = Math.pow(10, Math.floor(Math.log10(raw)));
        var norm = raw / mag;
        var step = (norm < 1.5) ? 1 : (norm < 3.5) ? 2 : (norm < 7.5) ? 5 : 10;
        return step * mag;
    }

    // Custom polar grid: concentric rings, a High Side/Right/Low Side/Left
    // cross, ring distance labels, and title — drawn under the data
    // (Chart.js scatter datasets on ordinary linear x/y scales, where
    // x=Right and y=High Side, so the projected points ARE already the
    // polar coordinates in Cartesian disguise; this plugin just supplies
    // the polar-looking grid on top of that Cartesian chart area).
    var tcvGridPlugin = {
        id: 'tcvGrid',
        beforeDraw: function(chart){
            var opts = (chart.options.plugins && chart.options.plugins.tcvGrid) || {};
            var ringStep = opts.ringStep;
            if(!ringStep) return;
            var ctx = chart.ctx;
            var xScale = chart.scales.x, yScale = chart.scales.y;
            var cx = xScale.getPixelForValue(0), cy = yScale.getPixelForValue(0);
            var maxVal = Math.max(xScale.max, yScale.max, -xScale.min, -yScale.min);
            var nRings = Math.ceil(maxVal / ringStep);
            // Ring/spoke/label colors picked per theme (2026-08-26 fix —
            // these were hardcoded to a light rgba(200,216,232,*) that
            // reads fine on the dark background but is nearly invisible
            // against light-mode's white chart background).
            var isLight = document.body.classList.contains('light-mode');
            var ringStroke = isLight ? 'rgba(44,62,80,0.35)' : 'rgba(200,216,232,0.25)';
            var ringLabelFill = isLight ? 'rgba(44,62,80,0.75)' : 'rgba(200,216,232,0.55)';
            ctx.save();
            ctx.strokeStyle = ringStroke;
            ctx.fillStyle = ringLabelFill;
            ctx.font = '10px monospace';
            ctx.lineWidth = 1;
            for(var i=1;i<=nRings;i++){
                var r = i * ringStep;
                var rPx = Math.abs(xScale.getPixelForValue(r) - cx);
                ctx.beginPath();
                ctx.arc(cx, cy, rPx, 0, Math.PI*2);
                ctx.stroke();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(r.toFixed(0)+' m', cx+4, cy-rPx+2);
            }
            // Cross spokes (High Side / Right / Low Side / Left)
            var edge = nRings*ringStep;
            var topPx = yScale.getPixelForValue(edge), botPx = yScale.getPixelForValue(-edge);
            var rightPx = xScale.getPixelForValue(edge), leftPx = xScale.getPixelForValue(-edge);
            ctx.beginPath();
            ctx.moveTo(cx, topPx); ctx.lineTo(cx, botPx);
            ctx.moveTo(leftPx, cy); ctx.lineTo(rightPx, cy);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillStyle = isLight ? 'rgba(44,62,80,0.9)' : 'rgba(200,216,232,0.85)';
            ctx.font = 'bold 11px monospace';
            ctx.textBaseline = 'bottom';
            ctx.fillText('HIGH SIDE', cx, topPx-6);
            ctx.textBaseline = 'top';
            ctx.fillText('LOW SIDE', cx, botPx+6);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText('RIGHT', rightPx+4, cy);
            ctx.textAlign = 'right';
            ctx.fillText('LEFT', leftPx-4, cy);
            // Origin marker (the reference station itself)
            ctx.fillStyle = isLight ? '#111820' : '#e8f4ff';
            ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        }
    };

    // MD labels along each trace, drawn after the datasets so they sit on
    // top of the lines/points. Default OFF (toggled via #acpTcvShowLabels)
    // — with several offset wells in view the numbers overlap heavily.
    var tcvLabelPlugin = {
        id: 'tcvLabels',
        afterDatasetsDraw: function(chart){
            var opts = (chart.options.plugins && chart.options.plugins.tcvLabels) || {};
            if(!opts.show) return;
            var ctx = chart.ctx;
            // Fallback only (each dataset normally sets its own borderColor)
            // — themed per 2026-08-26 light-mode fix, see tcvGridPlugin above.
            var fallbackColor = document.body.classList.contains('light-mode') ? '#2c3e50' : '#c8d8e8';
            ctx.save();
            ctx.font = '9px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            chart.data.datasets.forEach(function(ds, dsIdx){
                if(!ds.data || !ds.showLine) return;
                var meta = chart.getDatasetMeta(dsIdx);
                ds.data.forEach(function(pt, i){
                    if(!pt || pt.md == null) return;
                    var el = meta.data[i];
                    if(!el) return;
                    ctx.fillStyle = ds.borderColor || fallbackColor;
                    ctx.fillText(pt.md.toFixed(0), el.x+4, el.y-4);
                });
            });
            ctx.restore();
        }
    };

    // Finds where an offset well's polyline crosses the plane through
    // refPos perpendicular to `ahead` (the reference well's tangent at
    // that station) — i.e. a sign change in the offset points' signed
    // distance along `ahead` from refPos. If the offset well crosses more
    // than once, returns the crossing closest to refPos (closest approach
    // among the crossings), matching the source paper's own definition of
    // what a TCP point represents. Returns null if it never crosses.
    function findPlaneCrossing(offPts, refPos, ahead){
        var best = null, bestDist = Infinity;
        for(var i=0;i<offPts.length-1;i++){
            var A = offPts[i], B = offPts[i+1];
            var sA = (A.x-refPos.x)*ahead.x + (A.y-refPos.y)*ahead.y + (A.z-refPos.z)*ahead.z;
            var sB = (B.x-refPos.x)*ahead.x + (B.y-refPos.y)*ahead.y + (B.z-refPos.z)*ahead.z;
            if(sA === 0 || sB === 0 || (sA < 0) !== (sB < 0)){
                var t = (sA === sB) ? 0 : sA/(sA-sB);
                t = Math.max(0, Math.min(1, t));
                var P = { x: A.x+t*(B.x-A.x), y: A.y+t*(B.y-A.y), z: A.z+t*(B.z-A.z), md: A.md+t*(B.md-A.md) };
                var dx=P.x-refPos.x, dy=P.y-refPos.y, dz=P.z-refPos.z;
                var d = Math.sqrt(dx*dx+dy*dy+dz*dz);
                if(d < bestDist){ bestDist = d; best = P; }
            }
        }
        return best;
    }

    var tcvViewRadius = null; // current zoom half-width (symmetric about origin); null until first render

    // Rescales the TCV chart to a new symmetric ±radius view WITHOUT
    // rebuilding the underlying crossing data — used by wheel-zoom and the
    // reset button, so zooming stays cheap and (critically) always keeps
    // the reference well's origin exactly centered, since both axes are
    // always set to the same [-radius, +radius] range. Also recomputes the
    // ring step so the scale lines make sense at the new zoom level
    // ("scale lines change to see the scale").
    function tcvRescale(radius){
        if(!acpChartTCV) return;
        tcvViewRadius = radius;
        var ringStep = niceRingStep(radius, 4);
        acpChartTCV.options.scales.x.min = -radius;
        acpChartTCV.options.scales.x.max = radius;
        acpChartTCV.options.scales.y.min = -radius;
        acpChartTCV.options.scales.y.max = radius;
        acpChartTCV.options.plugins.tcvGrid.ringStep = ringStep;
        acpChartTCV.update('none');
    }
    function tcvResetView(){
        if(!acpChartTCV || acpChartTCV.$tcvFitRadius == null) return;
        tcvRescale(acpChartTCV.$tcvFitRadius);
    }

    function renderTravelingCylinder(){
        var canvas = document.getElementById('acpChartTCV');
        if(!canvas) return;
        var refName = refSelect.value;
        var refWell = WELLS.find(function(w){ return w.wellName === refName; });
        if(!refWell) return;
        var refPts = wellPoints(refWell);
        if(!refPts.length) return;

        var mdInput = document.getElementById('acpTcvRefMd');
        var windowInput = document.getElementById('acpTcvWindow');
        var intervalInput = document.getElementById('acpTcvInterval');
        var maxRadiusInput = document.getElementById('acpTcvMaxRadius');
        var refMDCenter = parseFloat(mdInput.value);
        if(isNaN(refMDCenter)) refMDCenter = refPts[refPts.length-1].md;
        var windowM = parseFloat(windowInput.value);
        if(isNaN(windowM) || windowM <= 0) windowM = 500;
        var interval = parseFloat(intervalInput.value);
        if(isNaN(interval) || interval <= 0) interval = 60;
        var maxRadius = parseFloat(maxRadiusInput.value);
        if(isNaN(maxRadius) || maxRadius <= 0) maxRadius = 100;

        var mdMin = Math.max(refPts[0].md, refMDCenter - windowM);
        var mdMax = Math.min(refPts[refPts.length-1].md, refMDCenter + windowM);

        var offsetWells = WELLS.filter(function(w){ return w.wellName !== refName; })
            .map(function(w){ return { well: w, pts: wellPoints(w) }; })
            .filter(function(e){ return e.pts.length >= 2; });

        // BUGFIX (2026-08-22): this used to push a single dataset per well
        // containing raw `null` entries to create gaps (no crossing at that
        // reference station / outside Max Scan Radius), relying on
        // spanGaps:false to break the line visually. That's the documented
        // pattern for Chart.js's category/value line charts, but this is a
        // 'scatter' chart with object-form {x,y} points, where a bare
        // `null` array entry doesn't parse the same way — Chart.js's own
        // interaction/tooltip code (getElementsAtEventForMode, its default
        // hover handling) would try to read e.g. `.x` off that null point
        // whenever the mouse passed near it while dragging the depth
        // slider, throwing "Cannot read properties of null (reading 'x')"
        // from INSIDE chart.js. That uncaught exception happened mid-frame
        // inside Chart.js's own internals, which could leave the chart
        // instance partially torn down — so the NEXT renderTravelingCylinder()
        // call's `acpChartTCV.destroy()` wouldn't fully release the
        // canvas's Chart.js registration, causing the cascading "Canvas is
        // already in use" and "Cannot read properties of undefined
        // (reading 'hitRadius')" (an internal Chart.js point-element
        // config field, unrelated to this file's own MC hitRadius) errors
        // seen in the console. Root fix: never put `null` in a scatter
        // dataset's data array — split each well's crossings into separate
        // no-null segment datasets instead (one dataset per contiguous run
        // of real points), which draws identically (each segment still
        // shows as its own connected line) but gives Chart.js nothing to
        // choke on.
        var datasets = [];
        var maxR = 0;
        offsetWells.forEach(function(entry, i){
            var segments = [[]];
            for(var rmd = mdMin; rmd <= mdMax; rmd += interval){
                var refStation = interpAtMD(refPts, rmd);
                var frame = tcvFrame(refStation.incl, refStation.azim);
                var refPos = { x: refStation.x, y: refStation.y, z: refStation.z };
                var crossing = findPlaneCrossing(entry.pts, refPos, frame.ahead);
                var pt = null;
                if(crossing){
                    var v = { x: crossing.x-refPos.x, y: crossing.y-refPos.y, z: crossing.z-refPos.z };
                    var px = dot3(v, frame.right), py = dot3(v, frame.high);
                    var r = Math.sqrt(px*px+py*py);
                    if(r <= maxRadius){
                        pt = { x: px, y: py, md: rmd, offMd: crossing.md };
                        maxR = Math.max(maxR, r);
                    }
                    // else: outside Max Scan Radius -> not computed/shown (gap)
                }
                // else: no crossing at this reference station (gap)
                if(pt){
                    segments[segments.length-1].push(pt);
                } else if(segments[segments.length-1].length){
                    segments.push([]); // start a fresh segment after a gap
                }
            }
            segments = segments.filter(function(seg){ return seg.length > 0; });
            if(!segments.length) return; // never crosses any swept plane within radius -> no trace for this well

            segments.forEach(function(seg, segIdx){
                datasets.push(scenarioStyle(entry.well, {
                    label: entry.well.wellName,
                    data: seg,
                    showLine: true,
                    borderColor: acpWellColor(entry.well, i),
                    backgroundColor: acpWellColor(entry.well, i),
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    _tcvIsExtraSegment: segIdx > 0 // dedupe legend below — same well, later segment
                }));
            });
        });

        // Auto-fit view radius: fits the actual data, but never exceeds
        // Max Scan Radius (no point showing empty space beyond what was
        // even computed). If nothing is currently in range, show the full
        // configured scan radius as empty rings rather than a degenerate
        // near-zero axis.
        var fitR = maxR > 0 ? Math.min(maxR, maxRadius) : maxRadius;
        var ringStep = niceRingStep(fitR || 1, 4);
        var nRings = Math.ceil((fitR || ringStep) / ringStep);
        var axisMax = Math.min(nRings * ringStep * 1.08, maxRadius * 1.08); // small margin, capped at the scan radius

        // Robust teardown: don't rely solely on our own `acpChartTCV`
        // variable to know what's registered on this canvas — if a prior
        // render left Chart.js in a half-torn-down state (see bugfix note
        // above), our variable and Chart.js's own canvas registry can
        // disagree. Chart.getChart() asks Chart.js directly what chart (if
        // any) currently owns this canvas element, and destroying THAT is
        // what actually clears the "Canvas is already in use" registration
        // — wrapped in try/catch so a chart that's already broken doesn't
        // stop us from proceeding to build a fresh one.
        try {
            var zombie = (typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : acpChartTCV;
            if(zombie) zombie.destroy();
        } catch(destroyErr){
            console.warn('[TCV] existing chart destroy failed (continuing to rebuild)', destroyErr);
        }
        acpChartTCV = null;

        acpChartTCV = new Chart(canvas.getContext('2d'), {
            type: 'scatter',
            data: { datasets: datasets },
            plugins: [tcvGridPlugin, tcvLabelPlugin],
            options: {
                responsive: true, maintainAspectRatio: false,
                aspectRatio: 1,
                animation: false, // chart rebuilds on every slider drag frame — animating each rebuild is what made it feel laggy/distracting
                plugins: {
                    legend: {
                        display: document.getElementById('acpShowLegend').checked,
                        labels: {
                            // Themed per 2026-08-26 light-mode fix (see tcvGridPlugin above).
                            color: document.body.classList.contains('light-mode') ? '#2c3e50' : '#c8d8e8',
                            boxWidth: 12, font: { size: 10 },
                            // Skip the extra per-segment datasets (see bugfix note
                            // above — a well with multiple crossing segments now
                            // has one dataset per segment) so each well still
                            // shows exactly one legend entry.
                            filter: function(item, data){ return !(data.datasets[item.datasetIndex] || {})._tcvIsExtraSegment; }
                        }
                    },
                    tcvGrid: { ringStep: ringStep },
                    tcvLabels: { show: document.getElementById('acpTcvShowLabels').checked },
                    tooltip: { callbacks: { label: function(ctx){
                        var d = ctx.raw;
                        if(!d) return ''; // defensive only — data no longer contains null points, see bugfix note above
                        return ctx.dataset.label + ': ref MD ' + d.md.toFixed(1) + ' m (offset MD ' + d.offMd.toFixed(1) +
                            ' m), Right ' + d.x.toFixed(1) + ' m, High Side ' + d.y.toFixed(1) + ' m';
                    } } }
                },
                scales: {
                    x: { min: -axisMax, max: axisMax, grid: { display: false }, ticks: { display: false }, title: { display: false } },
                    y: { min: -axisMax, max: axisMax, grid: { display: false }, ticks: { display: false }, title: { display: false } }
                }
            }
        });
        acpChartTCV.$tcvFitRadius = axisMax;
        tcvViewRadius = axisMax;
        tcvSyncSlider(refMDCenter, refPts[0].md, refPts[refPts.length-1].md);
    }

    // ---- Depth slider (vertical: top = 0/shallow, bottom = TD/deep) -------
    // Drag the thumb, click the track, or scroll the wheel over it to move
    // the Reference MD — "traveling down the hole" reads top-to-bottom, so
    // scrolling/dragging DOWN increases MD, matching that intuition.
    var tcvSliderBounds = { minMD: 0, maxMD: 1 };
    var tcvSliderRaf = null;
    function tcvSliderTrackMetrics(){
        var wrap = document.getElementById('acpTcvSliderWrap');
        if(!wrap) return null;
        var h = wrap.clientHeight;
        return { top: 14, height: Math.max(1, h - 28) }; // matches track's top:14px/bottom:14px CSS
    }
    function tcvSyncSlider(md, minMD, maxMD){
        tcvSliderBounds = { minMD: minMD, maxMD: maxMD };
        var thumb = document.getElementById('acpTcvSliderThumb');
        var valLbl = document.getElementById('acpTcvSliderVal');
        var topLbl = document.getElementById('acpTcvSliderTopLbl');
        var botLbl = document.getElementById('acpTcvSliderBotLbl');
        var tm = tcvSliderTrackMetrics();
        if(!thumb || !tm) return;
        var frac = (maxMD > minMD) ? (md - minMD) / (maxMD - minMD) : 0;
        frac = Math.max(0, Math.min(1, frac));
        var y = tm.top + frac * tm.height;
        thumb.style.top = y + 'px';
        if(valLbl){ valLbl.style.top = (y - 8) + 'px'; valLbl.textContent = md.toFixed(0) + ' m'; }
        if(topLbl) topLbl.textContent = minMD.toFixed(0) + ' m';
        if(botLbl) botLbl.textContent = maxMD.toFixed(0) + ' m';
    }
    function tcvSliderYToMD(y){
        var tm = tcvSliderTrackMetrics();
        if(!tm) return tcvSliderBounds.minMD;
        var frac = (y - tm.top) / tm.height;
        frac = Math.max(0, Math.min(1, frac));
        return tcvSliderBounds.minMD + frac * (tcvSliderBounds.maxMD - tcvSliderBounds.minMD);
    }
    function tcvSliderSetMD(md, commit){
        var mdInput = document.getElementById('acpTcvRefMd');
        if(mdInput) mdInput.value = md.toFixed(1);
        // Live thumb feedback without waiting for the (throttled) full
        // recompute, so dragging feels responsive.
        tcvSyncSlider(md, tcvSliderBounds.minMD, tcvSliderBounds.maxMD);
        if(commit){
            renderTravelingCylinder();
        } else if(!tcvSliderRaf){
            tcvSliderRaf = requestAnimationFrame(function(){
                tcvSliderRaf = null;
                renderTravelingCylinder();
            });
        }
    }
    (function initTcvSlider(){
        var wrap = document.getElementById('acpTcvSliderWrap');
        var track = document.getElementById('acpTcvSliderTrack');
        var thumb = document.getElementById('acpTcvSliderThumb');
        if(!wrap || !track || !thumb) return;
        var dragging = false;
        function relY(e){
            var rect = wrap.getBoundingClientRect();
            var clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
            return clientY - rect.top;
        }
        function onDown(e){
            dragging = true;
            thumb.style.cursor = 'grabbing';
            tcvSliderSetMD(tcvSliderYToMD(relY(e)), false);
            e.preventDefault();
        }
        function onMove(e){
            if(!dragging) return;
            tcvSliderSetMD(tcvSliderYToMD(relY(e)), false);
        }
        function onUp(e){
            if(!dragging) return;
            dragging = false;
            thumb.style.cursor = 'grab';
            tcvSliderSetMD(tcvSliderYToMD(relY(e)), true);
        }
        thumb.addEventListener('mousedown', onDown);
        track.addEventListener('mousedown', onDown);
        thumb.addEventListener('touchstart', onDown, { passive: false });
        track.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        // Scroll-wheel over the slider nudges depth by one MD Interval step
        // per tick — down/away scrolls deeper, matching drag direction.
        wrap.addEventListener('wheel', function(e){
            e.preventDefault();
            var intervalInput = document.getElementById('acpTcvInterval');
            var step = parseFloat(intervalInput && intervalInput.value) || 60;
            var mdInput = document.getElementById('acpTcvRefMd');
            var cur = parseFloat(mdInput && mdInput.value);
            if(isNaN(cur)) cur = tcvSliderBounds.minMD;
            var next = cur + (e.deltaY > 0 ? step : -step);
            next = Math.max(tcvSliderBounds.minMD, Math.min(tcvSliderBounds.maxMD, next));
            tcvSliderSetMD(next, true);
        }, { passive: false });
    })();

    // Custom origin-centered zoom: standard chartjs-plugin-zoom wheel-zoom
    // anchors on the cursor position, which drifts the reference well away
    // from the plot's center — wrong for this plot, where the center IS
    // the reference well by construction. This instead only ever changes
    // a single symmetric radius, applied equally to both axes, so the
    // origin never moves. Attached once (not per-render) since the canvas
    // element persists across chart rebuilds.
    (function initTcvWheelZoom(){
        var tcvCanvas = document.getElementById('acpChartTCV');
        if(!tcvCanvas) return;
        tcvCanvas.addEventListener('wheel', function(e){
            if(!acpChartTCV) return;
            e.preventDefault();
            var factor = e.deltaY > 0 ? 1.12 : (1/1.12);
            var base = tcvViewRadius || acpChartTCV.$tcvFitRadius || 100;
            tcvRescale(Math.max(1, base * factor));
        }, { passive: false });
    })();

    function fmtN(v){ return (v==null||isNaN(v)) ? '—' : v.toFixed(2); }

    function showDetailPanel(refWell, refPt, offWell, offPt, c2c, sf){
        var panel = document.getElementById('acpDetailPanel');
        panel.style.display = 'block';
        var sfStr = (sf == null) ? '—' : (isFinite(sf) ? sf.toFixed(2) : '∞ (essentially zero uncertainty here, e.g. right at a known-exact point)');
        panel.innerHTML =
            '<b style="color:#00c8ff;">Closest-point detail</b> (click another point to update)<br>' +
            '<table style="margin-top:6px;border-collapse:collapse;">' +
            '<tr><td style="padding:2px 12px 2px 0;color:var(--an-text-dim,#5a7080);">Well</td><td style="padding:2px 12px;">MD (m)</td><td style="padding:2px 12px;">Northing</td><td style="padding:2px 12px;">Easting</td><td style="padding:2px 12px;">TVDss (used)</td><td style="padding:2px 12px;color:var(--an-text-dim,#5a7080);">TVD (RKB, ref only)</td></tr>' +
            '<tr><td style="padding:2px 12px 2px 0;color:var(--an-text,#c8d8e8);">' + refWell + ' (ref)</td><td style="padding:2px 12px;">' + fmtN(refPt.md) + '</td><td style="padding:2px 12px;">' + fmtN(refPt.y) + '</td><td style="padding:2px 12px;">' + fmtN(refPt.x) + '</td><td style="padding:2px 12px;">' + fmtN(-refPt.z) + '</td><td style="padding:2px 12px;color:var(--an-text-dim,#5a7080);">' + fmtN(refPt.tvd) + '</td></tr>' +
            '<tr><td style="padding:2px 12px 2px 0;color:var(--an-text,#c8d8e8);">' + offWell + ' (offset)</td><td style="padding:2px 12px;">' + fmtN(offPt.md) + '</td><td style="padding:2px 12px;">' + fmtN(offPt.y) + '</td><td style="padding:2px 12px;">' + fmtN(offPt.x) + '</td><td style="padding:2px 12px;">' + fmtN(-offPt.z) + '</td><td style="padding:2px 12px;color:var(--an-text-dim,#5a7080);">' + fmtN(offPt.tvd) + '</td></tr>' +
            '</table>' +
            '<div style="margin-top:6px;color:var(--an-text-dim,#5a7080);">3D distance (using TVDss): <b style="color:var(--an-text-bright,#e8f4ff);">' + fmtN(c2c) + ' m</b> ' +
            '(ΔN=' + fmtN(refPt.y-offPt.y) + ', ΔE=' + fmtN(refPt.x-offPt.x) + ', ΔTVDss=' + fmtN(-refPt.z-(-offPt.z)) + '). ' +
            'Separation Factor at this point: <b style="color:var(--an-text-bright,#e8f4ff);">' + sfStr + '</b>. ' +
            'The dimmed TVD (RKB) column is shown for reference only and is NOT used in the distance — TVD is per-well-referenced and not safe to compare across wells; if it disagrees sharply with TVDss here, that well\'s RKB/KB elevation differs from the others.</div>';
    }

    function renderDataWarnings(refWell, others){
        var warnEl = document.getElementById('acpDataWarnings');
        var allIssues = [];
        [refWell].concat(others).forEach(function(w){
            var issues = scanForDataIssues(w);
            if(issues.length) allIssues.push(w.wellName + ': ' + issues.join('; '));
        });
        if(!allIssues.length){ warnEl.innerHTML = ''; return; }
        warnEl.innerHTML = '<div style="border:1px solid #ffd060;background:rgba(255,208,96,.08);color:#ffd060;border-radius:4px;padding:6px 10px;font-size:11px;font-family:monospace;">' +
            '⚠ Possible survey data issues detected (can cause artificially small C2C values):<br>' +
            allIssues.map(function(s){ return '&nbsp;&nbsp;• ' + s; }).join('<br>') + '</div>';
    }

    function renderPlot(){
        var refName = refSelect.value;
        var refWell = WELLS.find(function(w){ return w.wellName === refName; });
        if(!refWell){ return; }
        renderMagCards();
        // Chart.js needs resolved color strings (CSS var() refs aren't
        // understood by its canvas drawing code), so the axis/legend/grid
        // colors below are picked per theme here rather than left as the
        // dark-mode hex values they used to be hardcoded to (2026-08-26 —
        // that's what made this chart unreadable in light mode: near-white
        // ticks/legend text and a near-invisible grid on a white
        // background). Matches the isLight/textColor/tickColor/gridColor
        // pattern already used for the Pason plot chart (renderPasonChart).
        var isLight = document.body.classList.contains('light-mode');
        var acpTickColor = isLight ? '#2c3e50' : '#c8d8e8';
        var acpAxisTitleColor = isLight ? '#607080' : '#5a7080';
        var acpGridColor = isLight ? 'rgba(0,0,0,0.12)' : '#1e2d3d';
        syncToolcodeSelectToRefWell();
        var refPts = wellPoints(refWell);
        var others = WELLS.filter(function(w){ return w.wellName !== refName; });
        document.getElementById('acpDetailPanel').style.display = 'none';
        renderDataWarnings(refWell, others);

        // Live-adjustable confidence multiplier (see K_SF's own comment) —
        // read fresh each render so the "Confidence K" box takes effect
        // immediately without a page reload.
        var kInput = document.getElementById('acpKSF');
        var kVal = kInput ? parseFloat(kInput.value) : NaN;
        K_SF = (!isNaN(kVal) && kVal > 0) ? kVal : 2;

        var showLegend = document.getElementById('acpShowLegend').checked;

        // Each well uses its OWN saved toolcode (persisted per wellbore —
        // see wellToolcode()/saveWellToolcode()), not one global selection.
        // refCov is this well's own covariance; each offset well below
        // computes its own using ITS OWN toolcode.
        var refCov = computeWellCov(refWell, wellToolcode(refWell));
        var usedRealModelCount = 0, missingMagCount = 0;

        // Keep the full point arrays around (keyed by dataset index) so the
        // click handler can look up the exact matched stations, not just
        // the MD values already on the chart data.
        var offPtsByIdx = [];

        var c2cDatasets = others.map(function(w, i){
            var offPts = wellPoints(w);
            offPtsByIdx.push({ name: w.wellName, pts: offPts });
            var offCov = computeWellCov(w, wellToolcode(w));
            if(refCov && offCov) usedRealModelCount++; else missingMagCount++;
            var profile = computeC2CProfile(refPts, offPts, refCov, offCov);
            return scenarioStyle(w, {
                label: w.wellName,
                data: profile.map(function(p){ return { x: p.md, y: p.c2c, offMd: p.offMd, sf: p.sf }; }),
                borderColor: acpWellColor(w, i),
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                pointRadius: 0,
                pointHoverRadius: 5,
                showLine: true
            });
        });

        // SF datasets, same colors/well mapping, own chart. SF values are
        // capped (see SF_CAP) rather than left as raw Infinity — a single
        // infinite point (typical right at MD=0, where position is known
        // exactly) breaks Chart.js's connected-line rendering for the
        // WHOLE dataset, not just that one point. c2c is carried through
        // too (not just sfRaw) so the click-to-inspect panel shows the
        // correct distance regardless of which chart was clicked — points
        // on THIS chart previously had no c2c value at all, so clicking
        // here showed the SF number mislabeled as the 3D distance.
        var sfDatasets = c2cDatasets.map(function(ds, i){
            return {
                label: ds.label,
                data: ds.data.map(function(p){ return { x: p.x, y: Math.min(p.sf, SF_CAP), offMd: p.offMd, sfRaw: p.sf, c2c: p.y }; }),
                borderColor: ds.borderColor,            // 2026-10-10: same as the C2C dataset (keeps iPlan green)
                borderDash: ds.borderDash,              // iPlan scenarios: dotted
                backgroundColor: 'transparent',
                borderWidth: ds.borderWidth,
                pointRadius: 0,
                pointHoverRadius: 5,
                showLine: true
            };
        });

        function makeClickHandler(chartRef, datasets){
            return function(evt){
                var points = chartRef.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
                if(!points.length) return;
                var el = points[0];
                var ds = datasets[el.datasetIndex];
                var raw = ds.data[el.index];
                var refPt = refPts.reduce(function(best, p){ return (!best || Math.abs(p.md-raw.x) < Math.abs(best.md-raw.x)) ? p : best; }, null);
                var offInfo = offPtsByIdx[el.datasetIndex];
                var offPt = offInfo.pts.reduce(function(best, p){ return (!best || Math.abs(p.md-raw.offMd) < Math.abs(best.md-raw.offMd)) ? p : best; }, null);
                var c2cVal = raw.c2c != null ? raw.c2c : raw.y;       // C2C chart points: y IS c2c. SF chart points: c2c carried separately.
                var sfVal  = raw.sfRaw != null ? raw.sfRaw : raw.sf;  // SF chart points: sfRaw is the uncapped true value. C2C chart points: sf.
                showDetailPanel(refName, refPt, offInfo.name, offPt, c2cVal, sfVal);
            };
        }

        // Reads a from/to textbox pair; blank means "use the given default"
        // (min defaults are real numbers so the axis always starts at a
        // known point rather than whatever Chart.js's auto-scale picks;
        // max left blank stays auto-scaled to the data unless the user
        // types one in).
        function readAxisRange(minId, maxId, defaultMin, defaultMax){
            var minEl = document.getElementById(minId), maxEl = document.getElementById(maxId);
            var minVal = minEl && minEl.value !== '' ? parseFloat(minEl.value) : defaultMin;
            var maxVal = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : defaultMax;
            return { min: isNaN(minVal) ? defaultMin : minVal, max: isNaN(maxVal) ? defaultMax : maxVal };
        }

        if(acpChart) acpChart.destroy();
        var c2cXRange = readAxisRange('acpC2cXMin', 'acpC2cXMax', 0, undefined);
        var c2cYRange = readAxisRange('acpC2cYMin', 'acpC2cYMax', 0, 20);
        acpChart = new Chart(document.getElementById('acpChart').getContext('2d'), {
            type: 'scatter',
            data: { datasets: c2cDatasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: showLegend, labels: { color: acpTickColor } },
                    tooltip: { callbacks: { label: function(ctx){
                        var offMdStr = (ctx.raw.offMd != null) ? (', at offset MD=' + ctx.raw.offMd.toFixed(0) + ' m') : '';
                        return ctx.dataset.label + ': ref MD=' + ctx.raw.x.toFixed(0) + ' m, C2C=' + ctx.raw.y.toFixed(2) + ' m' + offMdStr + ' (click to inspect)';
                    } } },
                    zoom: {
                        pan: { enabled: true, mode: 'xy' },
                        zoom: { wheel: { enabled: true, speed: 0.08 }, pinch: { enabled: true }, mode: 'xy' }
                    }
                },
                scales: {
                    x: { min: c2cXRange.min, max: c2cXRange.max, title: { display: true, text: 'MD (m)', color: acpAxisTitleColor }, grid: { color: acpGridColor }, ticks: { color: acpTickColor } },
                    y: { min: c2cYRange.min, max: c2cYRange.max, title: { display: true, text: 'C2C (m)', color: acpAxisTitleColor }, grid: { color: acpGridColor }, ticks: { color: acpTickColor } }
                }
            }
        });
        // onClick set after creation (getElementsAtEventForMode needs the
        // real chart instance, which isn't assigned yet while the
        // constructor's own options object is being built).
        acpChart.options.onClick = makeClickHandler(acpChart, c2cDatasets);

        if(acpChartSF) acpChartSF.destroy();
        var sfXRange = readAxisRange('acpSfXMin', 'acpSfXMax', 0, undefined);
        var sfYRange = readAxisRange('acpSfYMin', 'acpSfYMax', 0, 2);
        acpChartSF = new Chart(document.getElementById('acpChartSF').getContext('2d'), {
            type: 'scatter',
            data: { datasets: sfDatasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: showLegend, labels: { color: acpTickColor } },
                    tooltip: { callbacks: { label: function(ctx){
                        var raw = isFinite(ctx.raw.sfRaw) ? ctx.raw.sfRaw.toFixed(2) : ('>' + SF_CAP);
                        return ctx.dataset.label + ': ref MD=' + ctx.raw.x.toFixed(0) + ' m, SF≈' + raw + ' (click to inspect)';
                    } } },
                    zoom: {
                        pan: { enabled: true, mode: 'xy' },
                        zoom: { wheel: { enabled: true, speed: 0.08 }, pinch: { enabled: true }, mode: 'xy' }
                    }
                },
                scales: {
                    x: { min: sfXRange.min, max: sfXRange.max, title: { display: true, text: 'MD (m)', color: acpAxisTitleColor }, grid: { color: acpGridColor }, ticks: { color: acpTickColor } },
                    y: { min: sfYRange.min, max: sfYRange.max, title: { display: true, text: 'SF', color: acpAxisTitleColor }, grid: { color: acpGridColor }, ticks: { color: acpTickColor } }
                }
            }
        });
        acpChartSF.options.onClick = makeClickHandler(acpChartSF, sfDatasets);

        // Diagnostic summary: where does the overall minimum fall? If it's
        // near MD=0 (surface/conductor) rather than in a lateral section,
        // that's the "global closest point isn't the parallel pair" case
        // rather than a units bug — this line makes that visible at a
        // glance instead of requiring a tooltip hover.
        var overallMin = null;
        c2cDatasets.forEach(function(ds){
            ds.data.forEach(function(p){
                if(!overallMin || p.y < overallMin.c2c){
                    overallMin = { c2c: p.y, refMd: p.x, offMd: p.offMd, well: ds.label };
                }
            });
        });
        var minStr = overallMin
            ? (' Closest approach: ' + overallMin.c2c.toFixed(2) + ' m to ' + overallMin.well +
               ' (ref MD=' + overallMin.refMd.toFixed(0) + ' m, offset MD=' + (overallMin.offMd!=null?overallMin.offMd.toFixed(0):'—') + ' m). Click that point on the chart to see the raw survey rows.')
            : '';
        var sfModelStr = ' SF: ' + usedRealModelCount + ' well(s) via real ISCWSA model' +
            (missingMagCount ? ', ' + missingMagCount + ' via simplified fallback (no magnetics/survey inc-azim).' : '.');
        statusEl.textContent = others.length + ' offset well' + (others.length===1?'':'s') + ' plotted against ' + refName + '.' + minStr + sfModelStr;
        renderTravelingCylinder();
    }

    // Per-well surface magnetics (Total Field, Declination, Dip), computed
    // once via the WMM2025 module from each well's surface (MD~0) station
    // lat/long, cached here so the ISCWSA error-model calc (real SF) can
    // reuse the same numbers rather than recomputing.
    var WELL_MAGNETICS = {};
    function computeWellMagnetics(well){
        if(WELL_MAGNETICS[well.wellName]) return WELL_MAGNETICS[well.wellName];
        if(typeof WMMModel === 'undefined' || !well.survey || !well.survey.length) return null;
        var surf = well.survey.slice().sort(function(a,b){ return num(a.md)-num(b.md); })[0];
        var lat = num(surf.latitude), lon = num(surf.longitude);
        if(!lat && !lon) return null; // no usable location data for this well
        var now = new Date();
        var decimalYear = now.getFullYear() + (now - new Date(now.getFullYear(),0,1)) / (365.25*24*3600*1000);
        var r = WMMModel.computeField(lat, lon, 0, decimalYear);
        WELL_MAGNETICS[well.wellName] = r;
        return r;
    }
    // Real ISCWSA toolcode data (public/data/iscwsaToolcodes.json), loaded
    // once. MWD-only toolcodes are offered (GYRO-* excluded — iscwsaModel.js
    // doesn't implement the gyro stationary/continuous-mode propagation).
    var TOOLCODES = null;
    var toolcodeSelect = document.getElementById('acpToolcode');
    // Fallback for any well (reference OR offset) that's never had a
    // toolcode explicitly saved for it — confirmed against Compass's own
    // survey tool designation for this pad ("MWD+IGRF" maps to LRGM in the
    // ISCWSA Rev5 library MTX uses; there's no literal "IGRF" entry).
    var DEFAULT_TOOLCODE = 'MWD+LRGM';
    var SF_CAP = 20; // display ceiling for SF — see renderPlot's note on why raw Infinity breaks Chart.js

    // Each well remembers its OWN toolcode (WellboreTrajectory.toolcode,
    // persisted server-side — see saveWellToolcode below). Falls back to
    // DEFAULT_TOOLCODE if the well has never had one explicitly set.
    function wellToolcode(well){
        return (well && well.toolcode) ? well.toolcode : DEFAULT_TOOLCODE;
    }
    // Keeps the Toolcode dropdown showing/editing the CURRENTLY SELECTED
    // reference well's own toolcode (not a single global setting).
    function syncToolcodeSelectToRefWell(){
        if(!toolcodeSelect || !TOOLCODES) return;
        var refWell = WELLS.find(function(w){ return w.wellName === refSelect.value; });
        toolcodeSelect.value = wellToolcode(refWell);
    }
    // Persists the reference well's toolcode choice server-side and
    // updates the in-memory copy so other charts referencing this well
    // (as an offset well elsewhere) immediately see the new value too.
    async function saveWellToolcode(well, toolcodeName){
        well.toolcode = toolcodeName;
        WELL_COVARIANCE = {}; // invalidate cache — this well's covariance is now stale
        if(well.isScenario){
            // 2026-10-10: iPlan scenario — store the override on the scenario
            // itself (no server call; scenarios are not WellboreTrajectory docs).
            var sc = (window.IPLAN_SCENARIOS || []).find(function(x){ return x.id === well.scenarioId; });
            if(sc){ sc.toolcode = toolcodeName; window.dispatchEvent(new CustomEvent('iplanToolcodeChangedFromAC', { detail: { id: sc.id } })); }
            return;
        }
        if(!well._id) return;
        try {
            await fetch('/notes/wellboreTrajectory/' + well._id + '/toolcode', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ toolcode: toolcodeName })
            });
        } catch(err){ console.error('[AC Plots] Failed to save toolcode for', well.wellName, err); }
    }

    // 2026-11-14 (John): Compass .ipm tools (stored raw on the server, converted here by IPMImport —
    // see public/js/ipmImport.js for the format source and the conversion rules). IPM_META[name] keeps the
    // tool's own XCL tortuosity and the rows that could not be used.
    var IPM_META = {};
    function addIpmTool(name, text, fileName){
        if(typeof IPMImport === 'undefined') return null;
        var c = IPMImport.convert(text, { fileName: fileName });
        if(name) c.name = name;
        TOOLCODES[c.name] = c.terms;
        IPM_META[c.name] = { xclTortuosity: c.xclTortuosity, skipped: c.skipped, description: c.description, fileName: fileName };
        return c;
    }
    function fillToolcodeSelect(){
        var names = Object.keys(TOOLCODES).filter(function(n){
            return (n.indexOf('MWD') === 0 || n.indexOf('EMS') === 0 || n.indexOf('DIPMETER') === 0) && n.indexOf('GYRO') === -1;
        }).sort();
        var ipm = Object.keys(IPM_META).sort();
        toolcodeSelect.innerHTML = (ipm.length ? '<optgroup label="Compass .ipm (imported)">' + ipm.map(function(n){ return '<option value="' + n.replace(/"/g, '&quot;') + '">' + n.replace(/</g, '&lt;') + '</option>'; }).join('') + '</optgroup><optgroup label="ISCWSA / OWSG toolcodes">' : '') +
            names.map(function(n){ return '<option value="' + n + '">' + n + '</option>'; }).join('') + (ipm.length ? '</optgroup>' : '');
        syncToolcodeSelectToRefWell();
    }
    function loadToolcodes(){
        if(!toolcodeSelect || typeof ISCWSAModel === 'undefined') return Promise.resolve(null);
        return fetch('/data/iscwsaToolcodes.json').then(function(r){ return r.json(); }).then(function(data){
            TOOLCODES = data;
            return fetch('/notes/ipmToolcodes').then(function(r){ return r.json(); }).then(function(d){
                Object.keys((d && d.tools) || {}).forEach(function(n){ try { addIpmTool(n, d.tools[n].text, d.tools[n].fileName); } catch(e){ console.error('[AC Plots] .ipm', n, e); } });
            }).catch(function(){ /* no stored .ipm tools */ }).then(function(){ fillToolcodeSelect(); return data; });
        }).catch(function(err){ console.error('[AC Plots] Failed to load ISCWSA toolcodes:', err); return null; });
    }
    function importIpmFile(file){
        if(!file) return;
        var rd = new FileReader();
        rd.onload = async function(){
            var c;
            try { c = IPMImport.convert(String(rd.result), { fileName: file.name }); } catch(e){ alert('Could not read that .ipm file: ' + e.message); return; }
            if(!c.terms.length){ alert('No usable error terms in ' + file.name + '.'); return; }
            var msg = 'Import "' + c.name + '" (' + c.terms.length + ' error terms' + (c.xclTortuosity != null ? ', XCL tortuosity ' + c.xclTortuosity : '') + ')?' +
                (c.skipped.length ? '\n\nLeft out (not supported, nothing is guessed):\n' + c.skipped.map(function(x){ return '  ' + x.name + ' ' + x.vector + '/' + x.tie + ' ' + x.value + ' — ' + x.why; }).join('\n') : '') +
                (TOOLCODES[c.name] ? '\n\nA tool with this name exists and will be replaced for everyone.' : '');
            if(!confirm(msg)) return;
            try {
                var r = await fetch('/notes/ipmToolcodes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: c.name, text: String(rd.result), fileName: file.name }) });
                var d = await r.json(); if(!r.ok || !d.ok) throw new Error(d.error || ('HTTP ' + r.status));
            } catch(e){ alert('Could not save the tool: ' + e.message); return; }
            addIpmTool(c.name, String(rd.result), file.name);
            WELL_COVARIANCE = {};
            fillToolcodeSelect();
            var st = document.getElementById('acpStatus'); if(st) st.textContent = 'Imported ' + c.name + (c.skipped.length ? ' (' + c.skipped.length + ' row(s) left out)' : '');
        };
        rd.readAsText(file);
    }

    // Per-well, per-toolcode ISCWSA covariance, computed once via
    // ISCWSAModel.computeWellCovariance() using this well's own survey and
    // its WMM-derived magnetics (Dip, Total Field, Declination — see
    // WELL_MAGNETICS above). Returns null (falls back to the simplified
    // model) if the toolcode data isn't loaded yet, the well lacks survey
    // inc/azim data, or magnetics aren't available for this well.
    var WELL_COVARIANCE = {};
    function computeWellCov(well, toolcodeName){
        if(!toolcodeName || !TOOLCODES || !TOOLCODES[toolcodeName]) return null;
        var cacheKey = well.wellName + '::' + toolcodeName;
        if(WELL_COVARIANCE[cacheKey] !== undefined) return WELL_COVARIANCE[cacheKey];
        var mag = computeWellMagnetics(well);
        if(!mag || !well.survey || !well.survey.length){ WELL_COVARIANCE[cacheKey] = null; return null; }
        var survey = well.survey.slice().sort(function(a,b){ return num(a.md)-num(b.md); }).map(function(s){
            return { md: num(s.md), inc: num(s.incl) * Math.PI/180, azT: num(s.azim) * Math.PI/180, tvd: num(s.tvd) };
        });
        var terms = TOOLCODES[toolcodeName];
        var wellParams = {
            dip: mag.inclination_deg * Math.PI/180,
            bField: mag.totalIntensity_nT,
            declination: mag.declination_deg * Math.PI/180,
            gField: 9.80665
        };
        // 2026-11-14: an imported Compass tool carries its own XCL tortuosity ("tort" row of the .ipm)
        if(IPM_META[toolcodeName] && IPM_META[toolcodeName].xclTortuosity != null) wellParams.xclTortuosity = IPM_META[toolcodeName].xclTortuosity;
        // 2026-11-14: latitude (deg) is needed by stationary-gyro terms (Earth-rate x cos(latitude)); from the
        // well's surface location, same source as the WMM magnetics. Was not passed before (MWD terms don't use it).
        (function(){ var s0 = well.survey.slice().sort(function(a,b){ return num(a.md)-num(b.md); })[0]; var la = num(s0.latitude); if(la) wellParams.latitude = la; })();
        var result;
        try {
            result = ISCWSAModel.computeWellCovariance(survey, terms, wellParams);
            result.forEach(function(st){ st._terms = terms; });
        } catch(err){
            console.error('[AC Plots] ISCWSA covariance failed for', well.wellName, err);
            result = null;
        }
        WELL_COVARIANCE[cacheKey] = result;
        return result;
    }

    function renderMagCards(){
        var cardsEl = document.getElementById('acpMagCards');
        if(!cardsEl) return;
        cardsEl.innerHTML = '';
        if(typeof WMMModel === 'undefined'){
            cardsEl.innerHTML = '<div style="font-size:10px;color:var(--an-text-dim,#5a7080);">WMM module not loaded — magnetics unavailable.</div>';
            return;
        }
        var refWell = WELLS.find(function(w){ return w.wellName === refSelect.value; });
        var m = refWell ? computeWellMagnetics(refWell) : null;
        var metrics = [
            ['Total Field (B)', m ? m.totalIntensity_nT.toFixed(0) + ' nT' : '—'],
            ['Dip', m ? m.inclination_deg.toFixed(1) + '\u00B0' : '—'],
            ['Declination', m ? m.declination_deg.toFixed(1) + '\u00B0' : '—']
        ];
        metrics.forEach(function(pair){
            var card = document.createElement('div');
            card.style.cssText = 'background:var(--an-panel2,#161e28);border:1px solid var(--an-border);border-radius:4px;padding:6px 10px;';
            // Label/value colors use the theme CSS vars, not hardcoded dark-
            // mode hex (2026-08-26 fix — the old hardcoded '#e8f4ff' value
            // color is near-white and was invisible on the light-mode white
            // background; '#5a7080' label color was likewise low-contrast).
            card.innerHTML = '<div style="font-size:10px;color:var(--an-text-dim,#5a7080);text-transform:uppercase;letter-spacing:.5px;">' + pair[0] + '</div>' +
                '<div style="font-size:16px;font-family:monospace;color:var(--an-text-bright,#e8f4ff);">' + pair[1] + '</div>';
            cardsEl.appendChild(card);
        });
        if(refWell && !m){
            var warnCard = document.createElement('div');
            warnCard.style.cssText = 'grid-column:1/-1;font-size:10px;color:var(--an-text-dim,#5a7080);padding:4px 2px;';
            warnCard.textContent = 'No surface lat/long for ' + refWell.wellName + ' — magnetics unavailable for this well.';
            cardsEl.appendChild(warnCard);
        }
    }

    function init(){
        if(WELLS.length < 2){
            emptyEl.style.display = 'block';
            chartWrap.style.display = 'none';
            return;
        }
        emptyEl.style.display = 'none';
        chartWrap.style.display = 'flex';
        function fillRefOptions(){
            var prev = refSelect.value;
            refSelect.innerHTML = '';
            WELLS.forEach(function(w){
                var opt = document.createElement('option');
                opt.value = w.wellName; opt.textContent = w.wellName;
                if(w.isScenario) opt.style.color = IPLAN_GREEN;
                refSelect.appendChild(opt);
            });
            if(prev && WELLS.some(function(w){ return w.wellName === prev; })) refSelect.value = prev;
        }
        fillRefOptions();
        function populateErrEllipseOffsetSelect(){
            var sel = document.getElementById('acpErrEllipseOffsetWell');
            if(!sel) return;
            var prev = sel.value;
            sel.innerHTML = '';
            WELLS.filter(function(w){ return w.wellName !== refSelect.value; }).forEach(function(w){
                var opt = document.createElement('option');
                opt.value = w.wellName; opt.textContent = w.wellName;
                sel.appendChild(opt);
            });
            if(prev && Array.prototype.some.call(sel.options, function(o){ return o.value === prev; })) sel.value = prev;
        }
        populateErrEllipseOffsetSelect();
        function resetTcvRefMd(){
            var refWell = WELLS.find(function(w){ return w.wellName === refSelect.value; });
            var pts = refWell ? wellPoints(refWell) : [];
            var mdInput = document.getElementById('acpTcvRefMd');
            if(mdInput && pts.length) mdInput.value = pts[pts.length-1].md.toFixed(1);
        }
        refSelect.addEventListener('change', function(){ resetTcvRefMd(); renderPlot(); populateErrEllipseOffsetSelect(); document.getElementById('acpEvalMdPanel').style.display='none'; document.getElementById('acpErrEllipsePanel').style.display='none'; document.getElementById('acpMtxAcReportPanel').style.display='none'; document.getElementById('acpMtxAcReportXlsBtn').style.display='none'; LAST_MTX_AC_REPORT = null; });
        var resetBtn = document.getElementById('acpResetZoomBtn');
        if(resetBtn) resetBtn.addEventListener('click', function(){ if(acpChart) acpChart.resetZoom(); if(acpChartSF) acpChartSF.resetZoom(); tcvResetView(); });
        var tcvResetMdBtn = document.getElementById('acpTcvResetMdBtn');
        if(tcvResetMdBtn) tcvResetMdBtn.addEventListener('click', function(){ resetTcvRefMd(); renderTravelingCylinder(); });
        document.getElementById('acpShowLegend').addEventListener('change', renderPlot);
        var colorModeEl = document.getElementById('acpColorMode');
        if(colorModeEl) colorModeEl.addEventListener('change', renderPlot);
        var kInputEl = document.getElementById('acpKSF');
        if(kInputEl) kInputEl.addEventListener('change', function(){ renderPlot(); evaluateAtMd(); });
        // 2026-11-14: Error Surface selector (see ERR_SURF above); remembered per browser
        var errSurfEl = document.getElementById('acpErrSurf');
        if(errSurfEl){ errSurfEl.value = ERR_SURF;
            errSurfEl.addEventListener('change', function(){ ERR_SURF = errSurfEl.value; try { localStorage.setItem('mtxAcErrSurf', ERR_SURF); } catch(e){}
                renderPlot(); evaluateAtMd(); if(typeof renderTravelingCylinder === 'function') renderTravelingCylinder(); }); }
        ['acpC2cXMin','acpC2cXMax','acpC2cYMin','acpC2cYMax','acpSfXMin','acpSfXMax','acpSfYMin','acpSfYMax'].forEach(function(id){
            var el = document.getElementById(id);
            if(el) el.addEventListener('change', renderPlot);
        });
        ['acpTcvRefMd','acpTcvWindow','acpTcvInterval','acpTcvMaxRadius'].forEach(function(id){
            var el = document.getElementById(id);
            if(el) el.addEventListener('change', renderTravelingCylinder);
        });
        var tcvShowLabels = document.getElementById('acpTcvShowLabels');
        if(tcvShowLabels) tcvShowLabels.addEventListener('change', function(){
            if(!acpChartTCV) return;
            acpChartTCV.options.plugins.tcvLabels = { show: tcvShowLabels.checked };
            acpChartTCV.update('none');
        });
        // 2026-11-14: Compass .ipm import
        var ipmBtn = document.getElementById('acpIpmBtn'), ipmFile = document.getElementById('acpIpmFile');
        if(ipmBtn && ipmFile){ ipmBtn.addEventListener('click', function(){ ipmFile.value = ''; ipmFile.click(); });
            ipmFile.addEventListener('change', function(){ importIpmFile(ipmFile.files[0]); }); }
        if(toolcodeSelect) toolcodeSelect.addEventListener('change', function(){
            var refWell = WELLS.find(function(w){ return w.wellName === refSelect.value; });
            if(refWell) saveWellToolcode(refWell, toolcodeSelect.value);
            renderPlot();
            evaluateAtMd(); // keep the manual MD panel (if open) in sync with the new toolcode
        });
        var evalMdBtn = document.getElementById('acpEvalMdBtn');
        var evalMdInput = document.getElementById('acpEvalMd');
        if(evalMdBtn) evalMdBtn.addEventListener('click', evaluateAtMd);
        if(evalMdInput) evalMdInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') evaluateAtMd(); });
        resetTcvRefMd();
        renderPlot();
        loadToolcodes().then(function(){ renderPlot(); }); // re-render once real toolcode list/data is in (async)

        // 2026-10-10: iPlan scenarios changed -> rebuild pseudo-wells, refresh
        // the dropdowns and re-plot (debounced: iPlan fires on every keystroke).
        acpOnScenariosChanged = function(){
            var prevRef = refSelect.value;
            fillRefOptions();
            populateErrEllipseOffsetSelect();
            if(refSelect.value !== prevRef) resetTcvRefMd();
            renderPlot();
        };
    }
    var acpOnScenariosChanged = null, acpScnTimer = null;
    window.addEventListener('iplanScenariosChanged', function(){
        clearTimeout(acpScnTimer);
        acpScnTimer = setTimeout(function(){
            syncScenarioWells();
            if(acpOnScenariosChanged) acpOnScenariosChanged();
        }, 500);
    });

    // ── iPad pad separation check API (ADDED 2026-10-12, iPad phase 2) ──
    // Lets the iPad planner compute min SF / C2C between wells with EXACTLY
    // this module's own code path (wellPoints -> computeWellCov(ISCWSA, per
    // well toolcode) -> computeC2CProfile -> separationFactorReal / simplified
    // fallback; same Confidence K from #acpKSF). No new formulas; the matrix
    // and these plots therefore give the same SF for the same pair.
    window.acpPadApi = {
        ready: function(){ return TOOLCODES ? Promise.resolve(true) : loadToolcodes().then(function(d){ return !!d; }); },
        // existing planned wells, tagged as 'planned' (subject, blue) or 'offset' (red) — same rule as Standard colors
        baseWells: function(){ return BASE_WELLS.map(function(w){ return { well: w, cat: acpIsSubject(w) ? 'planned' : 'offset' }; }); },
        scenarioWells: function(){ return buildScenarioWells(true); },
        surfaceLatLon: function(wellId){
            var w = BASE_WELLS.find(function(x){ return String(x._id) === String(wellId); }) || BASE_WELLS[0];
            if(!w) return { lat: undefined, lon: undefined, toolcode: undefined };
            var s0 = w.survey.slice().sort(function(a,b){ return num(a.md)-num(b.md); })[0];
            return { lat: s0.latitude, lon: s0.longitude, toolcode: w.toolcode };
        },
        // Min SF of refWell (stations with md <= refMaxMd) against offWell (full).
        pairMinSF: function(refWell, offWell, refMaxMd){
            var kInput = document.getElementById('acpKSF');
            var kVal = kInput ? parseFloat(kInput.value) : NaN;
            K_SF = (!isNaN(kVal) && kVal > 0) ? kVal : 2;
            var refPts = wellPoints(refWell).filter(function(p){ return p.md <= refMaxMd + 1e-6; });
            var offPts = wellPoints(offWell);
            if(refPts.length < 1 || offPts.length < 2) return null;
            var refCov = computeWellCov(refWell, wellToolcode(refWell));
            var offCov = computeWellCov(offWell, wellToolcode(offWell));
            var prof = computeC2CProfile(refPts, offPts, refCov, offCov);
            var best = null;
            prof.forEach(function(p){ if(p.sf != null && isFinite(p.sf) && (!best || p.sf < best.sf)) best = p; });
            if(!best) prof.forEach(function(p){ if(!best || p.c2c < best.c2c) best = p; });
            return best ? { sf: best.sf, c2c: best.c2c, refMd: best.md, offMd: best.offMd, real: !!(refCov && offCov) } : null;
        },
        // ADDED 2026-11-01 (John: profile panel "Separation vs MD" tab): the whole C2C / SF profile of refWell
        // (each of its stations) against offWell — same computeC2CProfile / ISCWSA covariance / K as pairMinSF.
        pairProfile: function(refWell, offWell){
            var kInput = document.getElementById('acpKSF');
            var kVal = kInput ? parseFloat(kInput.value) : NaN;
            K_SF = (!isNaN(kVal) && kVal > 0) ? kVal : 2;
            var refPts = wellPoints(refWell), offPts = wellPoints(offWell);
            if(refPts.length < 1 || offPts.length < 2) return null;
            var refCov = computeWellCov(refWell, wellToolcode(refWell)), offCov = computeWellCov(offWell, wellToolcode(offWell));
            return { real: !!(refCov && offCov), prof: computeC2CProfile(refPts, offPts, refCov, offCov).map(function(p){ return { md: p.md, c2c: p.c2c, sf: p.sf, offMd: p.offMd }; }) };
        },
        // drop cached covariance/magnetics for temporary preview wells
        forget: function(prefix){
            Object.keys(WELL_COVARIANCE).forEach(function(k){ if(k.indexOf(prefix) === 0) delete WELL_COVARIANCE[k]; });
            Object.keys(WELL_MAGNETICS).forEach(function(k){ if(k.indexOf(prefix) === 0) delete WELL_MAGNETICS[k]; });
        }
    };

    let acpInitDone = false;
    function initOnce(){ if(acpInitDone) return; acpInitDone = true; syncScenarioWells(); init(); }
    const collapseEl = document.getElementById('collapseAcPlots');
    if(collapseEl){
        collapseEl.addEventListener('shown.bs.collapse', initOnce);
        if(collapseEl.classList.contains('show')) initOnce();
    } else {
        initOnce();
    }
})();

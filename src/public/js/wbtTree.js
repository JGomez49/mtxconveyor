// wbtTree.js — shared grouped tree (Category > Pad > Version) for wellbore
// trajectory lists. Used by both edit-note.ejs (manage: show/hide + delete)
// and job.ejs (viewer: show/hide only). Relies on the --wbt-* CSS variables
// already defined by both pages, so no extra stylesheet is required.

(function () {

    function groupTrajectories(trajectories) {
        const tree = {};
        trajectories.forEach(t => {
            const cat = t.wellCategory === 'offset' ? 'Offset Wells'
                      : t.wellCategory === 'subject' ? 'Subject Wells'
                      : 'Uncategorized';
            const pad = (t.pad && String(t.pad).trim()) || 'Unassigned Pad';
            const src = (t.source && String(t.source).trim()) || 'Unlabeled';
            tree[cat] = tree[cat] || {};
            tree[cat][pad] = tree[cat][pad] || {};
            tree[cat][pad][src] = tree[cat][pad][src] || [];
            tree[cat][pad][src].push(t);
        });
        return tree;
    }

    const CAT_ORDER = ['Subject Wells', 'Offset Wells', 'Uncategorized'];

    // options:
    //   noteId           - required if allowDelete is true
    //   allowDelete      - bool, show Delete buttons at well/version/pad level
    //   getVisible(id)    - fn returning current visibility bool for a well id (checkbox init state); defaults to true
    //   onToggleWell(id, visible) - called whenever a leaf well's checkbox changes (including via a parent group toggle)
    //   onChanged()       - called after a successful delete, so the caller can refresh its own list/scene
    window.wbtBuildTree = function (container, trajectories, options) {
        options = options || {};
        container.innerHTML = '';

        if (!trajectories || trajectories.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:var(--wbt-text-dim);font-size:11px;padding:8px;';
            empty.textContent = 'No wellbore trajectories saved for this job yet.';
            container.appendChild(empty);
            return;
        }

        const tree = groupTrajectories(trajectories);
        const cats = Object.keys(tree).sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b));

        async function doDelete(url, label, wellCount) {
            if (!confirm('Delete ' + label + ' (' + wellCount + ' well' + (wellCount === 1 ? '' : 's') + ')? This cannot be undone.\n\nClick Cancel to keep it.')) return;
            try {
                const res = await fetch(url, { method: 'DELETE' });
                const result = await res.json();
                if (!res.ok) throw new Error(result.error || res.statusText);
                if (options.onChanged) options.onChanged();
            } catch (err) {
                alert('Error deleting: ' + err.message);
            }
        }

        cats.forEach(cat => {
            const catWrap = document.createElement('details');
            // Subject wells open by default (the ones actually being
            // designed/analyzed); Offset wells collapsed — usually a much
            // longer list of nearby wells only needed for reference.
            catWrap.open = (cat !== 'Offset Wells');
            catWrap.style.marginBottom = '4px';

            const catSummary = document.createElement('summary');
            catSummary.style.cssText = 'cursor:pointer;font-weight:700;font-size:12px;color:var(--wbt-text-bright);padding:4px 0;';
            catSummary.textContent = cat;
            catWrap.appendChild(catSummary);

            const pads = tree[cat];
            Object.keys(pads).sort().forEach(padName => {
                const versions = pads[padName];
                const padWells = Object.values(versions).flat();

                const padWrap = document.createElement('details');
                padWrap.open = true;
                padWrap.style.cssText = 'margin-left:12px;border-left:1px solid var(--wbt-border);padding-left:8px;margin-bottom:2px;';

                const padSummary = document.createElement('summary');
                padSummary.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--wbt-text);padding:3px 0;';

                const padCb = document.createElement('input');
                padCb.type = 'checkbox';
                padCb.checked = padWells.every(w => options.getVisible ? options.getVisible(w._id) : true);
                padCb.addEventListener('click', e => e.stopPropagation());
                padCb.addEventListener('change', () => {
                    padWells.forEach(w => { if (options.onToggleWell) options.onToggleWell(String(w._id), padCb.checked); });
                    padWrap.querySelectorAll('input[type=checkbox]').forEach(cb => { if (cb !== padCb) cb.checked = padCb.checked; });
                });

                const padLabel = document.createElement('span');
                padLabel.textContent = padName + ' (' + padWells.length + ' wells)';
                padLabel.style.flex = '1';

                padSummary.appendChild(padCb);
                padSummary.appendChild(padLabel);

                // Bulk-set the ISCWSA toolcode (Anti-collision Plots
                // accordion) for every well in this pad at once — the
                // primary way to set toolcodes in practice, since a whole
                // pad is normally drilled with the same MWD/BHA program.
                // Editable context only (edit-note.ejs); job.ejs's
                // read-only viewer never passes toolcodeNames.
                if (options.allowDelete && options.toolcodeNames && options.toolcodeNames.length) {
                    const padTcSelect = document.createElement('select');
                    padTcSelect.className = 'form-select form-select-sm';
                    padTcSelect.style.cssText = 'width:auto;max-width:180px;font-size:9px;padding:1px 20px 1px 6px;';
                    padTcSelect.title = 'Set toolcode for all ' + padWells.length + ' wells in this pad';
                    padTcSelect.innerHTML = '<option value="">Set pad toolcode…</option>' +
                        options.toolcodeNames.map(n => '<option value="' + n + '">' + n + '</option>').join('');
                    padTcSelect.addEventListener('click', e => e.stopPropagation());
                    padTcSelect.addEventListener('change', async () => {
                        const tc = padTcSelect.value;
                        if (!tc) return;
                        if (!confirm('Set toolcode "' + tc + '" for all ' + padWells.length + ' wells in pad "' + padName + '"?')) {
                            padTcSelect.value = '';
                            return;
                        }
                        try {
                            const res = await fetch('/notes/wellboreTrajectory/pad/' + options.noteId + '/' + encodeURIComponent(padName) + '/toolcode', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ toolcode: tc })
                            });
                            if (!res.ok) throw new Error((await res.json()).error || res.statusText);
                            padWells.forEach(w => { w.toolcode = tc; });
                            if (options.onChanged) options.onChanged();
                        } catch (err) {
                            alert('Error setting pad toolcode: ' + err.message);
                        } finally {
                            padTcSelect.value = '';
                        }
                    });
                    padSummary.appendChild(padTcSelect);
                }

                if (options.allowDelete) {
                    const delPadBtn = document.createElement('button');
                    delPadBtn.type = 'button';
                    delPadBtn.className = 'wbt-btn wbt-btn-del';
                    delPadBtn.style.cssText = 'padding:2px 8px;font-size:9px;';
                    delPadBtn.textContent = 'Delete Pad';
                    delPadBtn.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        doDelete(
                            '/notes/wellboreTrajectory/pad/' + options.noteId + '/' + encodeURIComponent(padName),
                            'pad "' + padName + '" and ALL its versions',
                            padWells.length
                        );
                    });
                    padSummary.appendChild(delPadBtn);
                }

                padWrap.appendChild(padSummary);

                const versionNames = Object.keys(versions).sort();
                const multiVersion = versionNames.length > 1;

                versionNames.forEach(versionName => {
                    const wells = versions[versionName];

                    // Skip the extra "version" nesting level when there's only
                    // one version under this pad — go straight to the well list.
                    let wellsHost = padWrap;

                    if (multiVersion) {
                        const verWrap = document.createElement('details');
                        verWrap.open = true;
                        verWrap.style.cssText = 'margin-left:12px;border-left:1px solid var(--wbt-border);padding-left:8px;margin:2px 0;';

                        const verSummary = document.createElement('summary');
                        verSummary.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--wbt-text-dim);padding:2px 0;';

                        const verCb = document.createElement('input');
                        verCb.type = 'checkbox';
                        verCb.checked = wells.every(w => options.getVisible ? options.getVisible(w._id) : true);
                        verCb.addEventListener('click', e => e.stopPropagation());
                        verCb.addEventListener('change', () => {
                            wells.forEach(w => { if (options.onToggleWell) options.onToggleWell(String(w._id), verCb.checked); });
                            verWrap.querySelectorAll('input[type=checkbox]').forEach(cb => { if (cb !== verCb) cb.checked = verCb.checked; });
                        });

                        const verLabel = document.createElement('span');
                        verLabel.textContent = versionName + ' (' + wells.length + ')';
                        verLabel.style.flex = '1';

                        verSummary.appendChild(verCb);
                        verSummary.appendChild(verLabel);

                        if (options.allowDelete) {
                            const delVerBtn = document.createElement('button');
                            delVerBtn.type = 'button';
                            delVerBtn.className = 'wbt-btn wbt-btn-del';
                            delVerBtn.style.cssText = 'padding:2px 8px;font-size:9px;';
                            delVerBtn.textContent = 'Delete';
                            delVerBtn.addEventListener('click', (e) => {
                                e.preventDefault(); e.stopPropagation();
                                doDelete(
                                    '/notes/wellboreTrajectory/group/' + options.noteId + '/' + encodeURIComponent(padName) + '/' + encodeURIComponent(versionName),
                                    'version "' + versionName + '" of pad "' + padName + '"',
                                    wells.length
                                );
                            });
                            verSummary.appendChild(delVerBtn);
                        }

                        verWrap.appendChild(verSummary);
                        padWrap.appendChild(verWrap);
                        wellsHost = verWrap;
                    }

                    wells.forEach(w => {
                        const row = document.createElement('label');
                        row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--wbt-text);padding:2px 0 2px 12px;cursor:pointer;';

                        const cb = document.createElement('input');
                        cb.type = 'checkbox';
                        cb.checked = options.getVisible ? options.getVisible(w._id) : true;
                        cb.addEventListener('change', () => { if (options.onToggleWell) options.onToggleWell(String(w._id), cb.checked); });

                        const sw = document.createElement('span');
                        sw.style.cssText = 'width:9px;height:9px;border-radius:2px;display:inline-block;background:' + (w.colorHex || '#00c8ff') + ';flex-shrink:0;';

                        const nameSpan = document.createElement('span');
                        nameSpan.style.flex = '1';
                        nameSpan.textContent = w.wellName + (w.surveyCount ? ' (' + w.surveyCount + ' pts)' : '');

                        row.appendChild(cb);
                        row.appendChild(sw);
                        row.appendChild(nameSpan);

                        // Per-well toolcode override — the exception path;
                        // the pad-level control above is the normal way to
                        // set this. Defaults to MWD+HRGM if never set.
                        if (options.allowDelete && options.toolcodeNames && options.toolcodeNames.length) {
                            const wellTcSelect = document.createElement('select');
                            wellTcSelect.className = 'form-select form-select-sm';
                            wellTcSelect.style.cssText = 'width:auto;max-width:150px;font-size:9px;padding:1px 20px 1px 6px;';
                            wellTcSelect.title = 'ISCWSA toolcode for this well (Anti-collision Plots)';
                            wellTcSelect.innerHTML = options.toolcodeNames.map(n =>
                                '<option value="' + n + '"' + ((w.toolcode || 'MWD+HRGM') === n ? ' selected' : '') + '>' + n + '</option>'
                            ).join('');
                            wellTcSelect.addEventListener('click', e => e.stopPropagation());
                            wellTcSelect.addEventListener('change', async (e) => {
                                e.stopPropagation();
                                const tc = wellTcSelect.value;
                                try {
                                    const res = await fetch('/notes/wellboreTrajectory/' + w._id + '/toolcode', {
                                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ toolcode: tc })
                                    });
                                    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
                                    w.toolcode = tc;
                                } catch (err) {
                                    alert('Error setting toolcode for "' + w.wellName + '": ' + err.message);
                                }
                            });
                            row.appendChild(wellTcSelect);
                        }

                        if (options.allowDelete) {
                            const delBtn = document.createElement('button');
                            delBtn.type = 'button';
                            delBtn.className = 'wbt-btn wbt-btn-del';
                            delBtn.style.cssText = 'padding:1px 6px;font-size:9px;';
                            delBtn.textContent = '✕';
                            delBtn.addEventListener('click', (e) => {
                                e.preventDefault(); e.stopPropagation();
                                doDelete('/notes/wellboreTrajectory/' + w._id, 'well "' + w.wellName + '"', 1);
                            });
                            row.appendChild(delBtn);
                        }

                        wellsHost.appendChild(row);
                    });
                });

                catWrap.appendChild(padWrap);
            });

            container.appendChild(catWrap);
        });
    };

})();

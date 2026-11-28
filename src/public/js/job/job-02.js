/* MTX Conveyor — job page script 2. 2026-11-28 (John): MOVED out of views/job.ejs (was the inline <script> at line 1030) so the
   browser can cache it (phase 1 of the job-page speed work). Server values come from window.MTX_JOB (set in job.ejs). Edit THIS file. */

                    (function(){
                        function init(){
                            var root = document.getElementById('wbtRoot'), outer = root && root.querySelector('.wbt-viewer-outer');
                            if(!outer || outer.dataset.tb) return; outer.dataset.tb = '1';
                            var left = outer.querySelector('.wbt-sidebar:not(.wbt-sidebar-right)'), right = outer.querySelector('.wbt-sidebar-right');
                            var wrap = document.createElement('div'); wrap.className = 'wbt-tb-wrap';
                            outer.parentNode.insertBefore(wrap, outer);
                            var bar = document.createElement('div'); bar.className = 'wbt-tb';
                            var sum = document.createElement('div'); sum.className = 'wbt-tb-sum';
                            wrap.appendChild(bar); wrap.appendChild(sum); wrap.appendChild(outer);
                            function el(tag, cls, html, title){ var e = document.createElement(tag); e.type = 'button'; e.className = cls; e.innerHTML = html; if(title) e.title = title; return e; }
                            function modal(title, panel){
                                var m = document.createElement('div'); m.className = 'wbt-fpm';
                                m.innerHTML = '<div class="wbt-fpm-win" role="dialog" aria-modal="true"><div class="wbt-fpm-hdr"><h5></h5><button type="button" class="wbt-fpm-x" aria-label="Close">&times;</button></div><div class="wbt-fpm-body"></div></div>';
                                m.querySelector('h5').textContent = title; m.querySelector('.wbt-fpm-body').appendChild(panel);
                                wrap.appendChild(m);   // inside the wrap so it also shows in full screen
                                var close = function(){ m.classList.remove('open'); refresh(); };
                                m.querySelector('.wbt-fpm-x').addEventListener('click', close);
                                m.addEventListener('click', function(e){ if(e.target === m) close(); });
                                document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && m.classList.contains('open')) close(); });
                                return m;
                            }
                            var mDisp = left ? modal('3D display', left) : null, mWells = right ? modal('Wellbores', right) : null;
                            var bDisp = el('button', 'wbt-btn', '&#9776; Display', 'Visibility, colours, formations, rotation, line thickness, markers');
                            var bWells = el('button', 'wbt-btn', '&#9638; Wellbores', 'Show / hide individual wellbores');
                            if(mDisp) bDisp.addEventListener('click', function(){ mDisp.classList.add('open'); });
                            if(mWells) bWells.addEventListener('click', function(){ mWells.classList.add('open'); });
                            bar.appendChild(bDisp); bar.appendChild(bWells); bar.appendChild(el('span', 'wbt-sep', ''));
                            // Axes / Grid / Legend chips -> the original checkboxes (their change listeners do the work)
                            var chips = [];
                            [['wbtToggleAxes', 'Axes'], ['wbtToggleGrid', 'Grid'], ['wbtToggleLegend', 'Legend']].forEach(function(t){
                                var cb = document.getElementById(t[0]); if(!cb) return;
                                var c = el('button', 'wbt-chip', t[1]);
                                c.addEventListener('click', function(){ cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); refresh(); });
                                chips.push({ c: c, on: function(){ return cb.checked; } }); bar.appendChild(c);
                            });
                            bar.appendChild(el('span', 'wbt-sep', ''));
                            // Subject / Offset chips -> tick / untick every pad checkbox of that category in the tree (wbtTree.js)
                            function catWrap(name){ var list = document.getElementById('wbtWellList'); if(!list) return null;
                                return Array.prototype.find.call(list.querySelectorAll(':scope > details'), function(d){ var s = d.querySelector(':scope > summary'); return s && s.textContent.trim() === name; }) || null; }
                            function leafs(d){ return d ? Array.prototype.filter.call(d.querySelectorAll('input[type=checkbox]'), function(cb){ return cb.parentElement.tagName !== 'SUMMARY'; }) : []; }
                            [['Subject Wells', 'Subject'], ['Offset Wells', 'Offset']].forEach(function(t){
                                var c = el('button', 'wbt-chip', t[1], 'Show / hide all ' + t[0].toLowerCase());
                                c.addEventListener('click', function(){
                                    var d = catWrap(t[0]); if(!d) return;
                                    var v = !leafs(d).some(function(cb){ return cb.checked; });
                                    d.querySelectorAll(':scope > details > summary > input[type=checkbox]').forEach(function(cb){ cb.checked = v; cb.dispatchEvent(new Event('change')); });
                                    refresh();
                                });
                                chips.push({ c: c, on: function(){ return leafs(catWrap(t[0])).some(function(cb){ return cb.checked; }); }, hide: function(){ return !catWrap(t[0]); } });
                                bar.appendChild(c);
                            });
                            bar.appendChild(el('span', 'wbt-sep', ''));
                            var bReset = el('button', 'wbt-btn', '&#10227; Reset view');
                            bReset.addEventListener('click', function(){ var b = document.getElementById('wbtResetView'); if(b) b.click(); });
                            var bFull = el('button', 'wbt-btn', '&#x26F6; Full screen');
                            bFull.addEventListener('click', function(){
                                if(document.fullscreenElement) document.exitFullscreen();
                                else if(wrap.requestFullscreen) wrap.requestFullscreen(); else if(wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
                            });
                            if(!(wrap.requestFullscreen || wrap.webkitRequestFullscreen)) bFull.style.display = 'none';   // e.g. iPhone Safari
                            document.addEventListener('fullscreenchange', function(){
                                bFull.innerHTML = document.fullscreenElement ? '&#10005; Exit full screen' : '&#x26F6; Full screen';
                                setTimeout(function(){ window.dispatchEvent(new Event('resize')); }, 80);
                            });
                            bar.appendChild(bReset); bar.appendChild(bFull);
                            var last = null;
                            function refresh(){
                                chips.forEach(function(x){ x.c.classList.toggle('on', !!x.on()); x.c.style.display = (x.hide && x.hide()) ? 'none' : ''; });
                                var list = document.getElementById('wbtWellList'), all = list ? leafs(list) : [], off = all.filter(function(cb){ return !cb.checked; }).length;
                                var key = off + '/' + all.length; if(key === last) return; last = key;
                                bWells.innerHTML = '&#9638; Wellbores' + (off ? ' (' + off + ' hidden)' : '');
                                bWells.style.borderColor = off ? 'var(--wbt-accent)' : ''; bWells.style.color = off ? 'var(--wbt-accent)' : '';
                                sum.innerHTML = !all.length ? '' : off ? 'Showing <b>' + (all.length - off) + ' of ' + all.length + '</b> wellbores' : 'Showing all ' + all.length + ' wellbores';
                            }
                            right && right.addEventListener('change', function(){ setTimeout(refresh, 0); });
                            setInterval(refresh, 1000);   // the tree is (re)built asynchronously
                            refresh();
                            setTimeout(function(){ window.dispatchEvent(new Event('resize')); }, 60);   // canvas gets the freed width
                        }
                        if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
                    })();
                    
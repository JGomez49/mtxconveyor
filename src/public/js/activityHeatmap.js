// Shared GitHub-style contribution heatmap renderer. Used by both the full
// admin Usage Dashboard (views/activity.ejs) and the embedded "Activity
// Heatmap" section on the main jobs dashboard (views/all-notes.ejs) — kept
// here once so the two don't drift out of sync with each other.
//
// Usage:
//   ActivityHeatmap.render(svgEl, dayMinutesMap, heatmapDays)
//     svgEl:          an <svg> element to draw into (cleared each call)
//     dayMinutesMap:  { 'YYYY-MM-DD': minutes, ... } for ONE user
//     heatmapDays:    how many days back the map should cover (e.g. 371)
(function(global){
    var CELL = 11, GAP = 3, LEFT_PAD = 24, TOP_PAD = 16;

    function colorFor(minutes){
        if(!minutes) return '#161e28';
        if(minutes < 15) return 'rgba(0,200,255,.25)';
        if(minutes < 60) return 'rgba(0,200,255,.5)';
        if(minutes < 180) return 'rgba(0,200,255,.75)';
        return '#00c8ff';
    }

    function render(svg, dayMinutesMap, heatmapDays){
        var hm = dayMinutesMap || {};
        var days = heatmapDays || 371;
        var end = new Date(); end.setUTCHours(0,0,0,0);
        var start = new Date(end.getTime() - (days-1)*86400000);
        // Align start back to the previous Sunday so weeks line up in columns, GitHub-style.
        start = new Date(start.getTime() - start.getUTCDay()*86400000);
        var totalDays = Math.round((end - start)/86400000) + 1;
        var weeks = Math.ceil(totalDays / 7);

        var width = LEFT_PAD + weeks*(CELL+GAP);
        var height = TOP_PAD + 7*(CELL+GAP);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.innerHTML = '';

        var dowLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
        dowLabels.forEach(function(lbl, row){
            if(!lbl) return;
            var t = document.createElementNS('http://www.w3.org/2000/svg','text');
            t.setAttribute('x', 0); t.setAttribute('y', TOP_PAD + row*(CELL+GAP) + CELL - 1);
            t.setAttribute('font-size', '8'); t.setAttribute('fill', '#5a7080'); t.setAttribute('font-family', 'monospace');
            t.textContent = lbl;
            svg.appendChild(t);
        });

        var lastMonth = -1;
        for(var w = 0; w < weeks; w++){
            for(var dow = 0; dow < 7; dow++){
                var dayIdx = w*7 + dow;
                var date = new Date(start.getTime() + dayIdx*86400000);
                if(date > end) continue;
                var key = date.toISOString().slice(0,10);
                var minutes = hm[key] || 0;
                var x = LEFT_PAD + w*(CELL+GAP);
                var y = TOP_PAD + dow*(CELL+GAP);

                if(dow === 0 && date.getUTCMonth() !== lastMonth){
                    lastMonth = date.getUTCMonth();
                    var mt = document.createElementNS('http://www.w3.org/2000/svg','text');
                    mt.setAttribute('x', x); mt.setAttribute('y', TOP_PAD - 5);
                    mt.setAttribute('font-size', '8'); mt.setAttribute('fill', '#5a7080'); mt.setAttribute('font-family', 'monospace');
                    mt.textContent = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
                    svg.appendChild(mt);
                }

                var rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
                rect.setAttribute('x', x); rect.setAttribute('y', y);
                rect.setAttribute('width', CELL); rect.setAttribute('height', CELL);
                rect.setAttribute('rx', 2);
                rect.setAttribute('fill', colorFor(minutes));
                var title = document.createElementNS('http://www.w3.org/2000/svg','title');
                title.textContent = key + ': ' + (minutes ? Math.round(minutes) + ' min' : 'no activity');
                rect.appendChild(title);
                svg.appendChild(rect);
            }
        }
    }

    global.ActivityHeatmap = { render: render, colorFor: colorFor };
})(window);

// ADDED 2026-10-29 (John): "Supporting Documents Checklist" of the Directional
// Planning Handover e-mail (mimics John's Excel handover sheet).
// Shared by the server (notes.controller.js -> edit-note.ejs) and the browser
// (all-notes.ejs, Handover .eml builder). Items and providers are copied from
// the Excel sheet. Each job stores its choices in Note.handoverChecklist
// [{key, inFolder, status, responsible}] (EDIT page). "Responsible" is filled
// automatically from the pad's Pad Distribution List roles (VP Areas page)
// unless the job has a manual value:
//   Directional Plan      -> "PlanIT & " + the job's D.E (or DRILLING ENGINEER role)
//   Hard Boundaries       -> GEOLOGY
//   Land Survey / Geo Prognosis -> GEOLOGY & GEO TECH
//   Well License/WA       -> DRILLING TECH
//   Wellbore ID Table     -> "BetterDataFaster & " GEO TECH
// The role -> item mapping is John's direction (2026-10-29) inferred from his
// Excel example; edit ITEMS below if a role name changes in ETS.
(function(root){
    var ITEMS = [
        { key: 'dirPlan',        item: 'Directional Plan',                 provider: 'PlanIT & DE',   fixed: 'PlanIT', useDE: true, roles: ['DRILLING ENGINEER'] },
        { key: 'dpGuidelines',   item: 'DP guidelines',                    provider: 'PlanIT',        fixed: 'PlanIT', roles: [] },
        { key: 'hardBoundaries', item: 'Hard Boundaries and/or waypoints', provider: 'Geology',       roles: ['GEOLOGY'] },
        { key: 'landSurvey',     item: 'Land Survey',                      provider: 'Geology',       roles: ['GEOLOGY', 'GEO TECH'] },
        { key: 'geoProg',        item: 'Geological Prognosis',             provider: 'Geology',       roles: ['GEOLOGY', 'GEO TECH'] },
        { key: 'license',        item: 'Well License/WA Document',         provider: 'Drill Tech',    roles: ['DRILLING TECH'] },
        { key: 'wbid',           item: 'Wellbore ID Table',                provider: 'BDF & Geology', fixed: 'BetterDataFaster', roles: ['GEO TECH'] },
    ];
    var IN_FOLDER = { '': 'Pending', included: 'Included', incomplete: 'Incomplete', noinfo: 'No info' };
    var STATUS    = { '': 'Pending', ok: 'Approved / Complete', confirm: 'To confirm / Incomplete', revise: 'Revision needed / No info' };
    var norm = function(s){ return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); };
    // people: [{role, name}] from the Pad Distribution List; de: job D.E name
    function autoResponsible(def, people, de){
        var out = def.fixed ? [def.fixed] : [];
        if(def.useDE && de) out.push(de);
        else (def.roles || []).forEach(function(r){
            (people || []).filter(function(p){ return norm(p.role) === r; }).forEach(function(p){ if(p.name && out.indexOf(p.name) < 0) out.push(p.name); });
        });
        return out.join(' & ');
    }
    // saved: job's handoverChecklist array -> rows with resolved responsible
    function resolve(saved, people, de){
        var byKey = {}; (saved || []).forEach(function(s){ if(s && s.key) byKey[s.key] = s; });
        return ITEMS.map(function(def){
            var s = byKey[def.key] || {}, auto = autoResponsible(def, people, de);
            return { key: def.key, item: def.item, provider: def.provider, inFolder: s.inFolder || '', status: s.status || '',
                     responsible: (s.responsible && String(s.responsible).trim()) || auto, auto: auto, manual: !!(s.responsible && String(s.responsible).trim()) };
        });
    }
    // ADDED 2026-10-30 (John): "Distribution List: DPs & Final Directional Surveys" table at the end of the
    // Handover e-mail (copied from John's Excel sheet). who: roles (Pad Distribution List), 'opsgeo'
    // (Ops. Geo. Distribution List), 'de' (job D.E if no DRILLING ENGINEER role) or a fixed address.
    var DIST = [
        { role: 'OPS GEO',                    who: 'opsgeo',                                   dp: true,  ds: false },
        { role: 'GEOLOGY (Approver)',         roles: ['GEOLOGY'],                              dp: true,  ds: true },
        { role: 'DRILLING ENGINEER (Approver)', roles: ['DRILLING ENGINEER'], de: true,         dp: true,  ds: true },
        { role: 'DRILLING TECH',              roles: ['DRILLING TECH'],                        dp: true,  ds: true },
        { role: 'DRILLING SUPERVISOR',        roles: ['DRILLING SUPERVISOR'],                  dp: true,  ds: false },
        { role: 'GEO TECH',                   roles: ['GEO TECH'],                             dp: true,  ds: true },
        { role: 'PLANIT',                     fixed: 'PrelimDirectionalPlanning@cnrl.com',     dp: true,  ds: true },
        { role: 'FINAL DIRECTIONAL SURVEYS',  fixed: 'FinalDirectionalSurvey@cnrl.com',        dp: false, ds: true },
        { role: 'BETTER DATA FASTER',         fixed: 'betterdatafaster@cnrl.com',              dp: false, ds: true },
    ];
    // -> [{role, who:[names/addresses], dp, ds}]
    function distRows(people, de, opsGeos){
        return DIST.map(function(d){
            var who = [];
            if(d.fixed) who = [d.fixed];
            else if(d.who === 'opsgeo') who = (opsGeos || []).slice();
            else { (people || []).forEach(function(p){ if((d.roles || []).indexOf(norm(p.role)) >= 0 && p.name && who.indexOf(p.name) < 0) who.push(p.name); });
                   if(!who.length && d.de && de) who = [de]; }
            return { role: d.role, who: who, dp: d.dp, ds: d.ds };
        });
    }
    var api = { DIST: DIST, distRows: distRows, ITEMS: ITEMS, IN_FOLDER: IN_FOLDER, STATUS: STATUS, autoResponsible: autoResponsible, resolve: resolve };
    if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.HandoverChecklist = api;
})(this);

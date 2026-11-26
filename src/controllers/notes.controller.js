// Al igual que index.controller.js, en este archivo se definen las funciones
// que despues seran llamadas desde notes.routes.js

const notesCrtl = {};
const Note = require('../models/NoteConveyor');
const User = require('../models/User');
const Job = require('../models/MTXjobNumber');
const Log = require('../models/LogConveyor');
// 2026-10-27: models/ImageMirelleDog.js renamed to models/JobImage.js (same Mongo model/collection "ImageMirelleDog").
const JobImage = require('../models/JobImage');
const NewSchedule = require("../models/NewSchedule");
const DPStats = require("../models/DPStats");
const WellboreTrajectory = require("../models/WellboreTrajectory");
const Polyline = require("../models/Polyline");
const TDModel = require("../models/TDModel");
const TDModelCore = require("../public/js/tdModel.js");
const HydraulicsModel = require("../models/HydraulicsModel");
const HydraulicsModelCore = require("../public/js/hydraulicsModel.js");
const CasingDesign = require("../models/CasingDesign");
const CasingLoadCasesCore = require("../public/js/casingLoadCases.js");
const PasonPlots = require("../models/PasonPlots");
const MotorYieldCore = require("../public/js/motorYield.js");   // 2026-11-14 Motor Yield per slide (Slide Sheet)
const PadAC       = require("../models/PadAC");
const SixAxisCase = require("../models/SixAxisCase");
const { buildActivityReport } = require("../helpers/activityStats");
const SiteConfig    = require("../models/SiteConfig");
// ADDED 2026-09-14: VP -> Main Area mapping, backing renderVPAreas/saveVPAreas
// below and the vpAreaList fed into all-notes.ejs's Snapshot section.
const VPArea        = require("../models/VPArea");
// ADDED 2026-10-27: Pad Distribution List (handover e-mail recipients per pad).
const PadDistList   = require("../models/PadDistList");
// ADDED 2026-10-27: Vendor Distribution List (Handover e-mail To:).
const VendorDistList = require("../models/VendorDistList");
// ADDED 2026-10-27: BV Rigs reference table (VP Areas page).
const BvRig          = require("../models/BvRig");
// ADDED 2026-10-28: Design Codes (trajectory design guidelines, /notes/designCodes).
const DesignCode     = require("../models/DesignCode");
// ADDED 2026-10-28: Ops. Geo. Distribution List (Exp. Manager -> Ops Geo, Handover CC).
const OpsGeoDistList = require("../models/OpsGeoDistList");
// ADDED 2026-10-10: iPlan scenario trajectories (job-level, see model comment)
const IPlanScenario = require("../models/IPlanScenario");
// 2026-10-24: SAGcorrection module (SurQC sag-solver port) — saved cases + shared math.
const SagCorrectionCase = require("../models/SagCorrectionCase");
const SagModelCore = require("../public/js/sagModel.js");
const SlideSheet = require("../models/SlideSheet");   // 2026-11-13 slide sheets from the EDR
const SagMaterial = require("../models/SagMaterial");
// 2026-10-25: PipeStretch module (drill-pipe stretch MD correction) — saved cases.
const PipeStretchCase = require("../models/PipeStretchCase");




const path = require('path');
const {unlink} = require('fs-extra');
const cloudinary = require('cloudinary');
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

let nodemailer = require('nodemailer');





// 2026-11-15 (John): names for the Responsible / "done by" lists = every user with role user, leader or admin,
// alphabetical (case-insensitive). Viewers are not listed. Read on every page load, so the list follows /users/manage.
async function mtxPeople(){
    try{ const us = await User.find({ role: { $in: ['user', 'leader', 'admin'] } }).select('name').lean();
        return Array.from(new Set(us.map(u => String(u.name || '').trim()).filter(n => n && n.toLowerCase() !== 'orphan'))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }catch(err){ console.error('[people] list failed', err); return []; }
}
notesCrtl.renderNoteForm = async(req,res)=>{
    // res.send('Add a note...');
    let user = await User.findById(req.session.passport.user);
    const job = await Job.find().sort({createdAt: 'desc'});
    let jn = Number(job[0].jobNumber);
    let jnID = job[0]._id;
    if(jn){
        jn = jn + 1
    }else{
        jn = 100;
    };
    jn = String(jn)
    res.render('new-note.ejs', {jn, jnID, user, people: await mtxPeople()});
}





notesCrtl.createNewNote = async(req,res)=>{
    // console.log(req.body);
    //const{title, description}=req.body;
    // const result = await cloudinary.v2.uploader.upload(req.file.path);
    // console.log('>> result:')
    // console.log(result)
    let mtxjob = Number(req.body.mtxJobId);
    let batch = req.body.batch;
        for (let i = 0; i < batch; i++) {
            mtxjob = mtxjob + i;
            let newNote = new Note({
                title: req.body.title,
                description: req.body.description,
                mtxJobId: mtxjob,
                responsible: req.body.responsible,
                customer: req.body.customer,
                customerJobNumber: req.body.customerJobNumber,
                operator: req.body.operator,
                priority: req.body.priority,
                invoice: req.body.invoice,
                user: req.user.id,
                created: req.body.created,
                dueDate: req.body.dueDate,
                status: req.body.status,
                rig: req.body.rig,
                project: req.body.project,
                poc: req.body.poc,
                geologist: req.body.geologist,
                wells: req.body.wells,
                area: req.body.area,
                budget: req.body.budget,
                checkInitialInfo: req.body.checkInitialInfo,
                checkFoldersSetup: req.body.checkFoldersSetup,
                checkOffsetWellsInfo: req.body.checkOffsetWellsInfo,
                checkCompassOffsets: req.body.checkCompassOffsets,
                checkCompassSubject: req.body.checkCompassSubject,
                checkPlanning: req.body.checkPlanning,
                checkReports: req.body.checkReports,
                checkSent: req.body.checkSent,

                path: "",
                imageID: "",
                noteImageID: "",
                // filename: req.file.filename,
                // path: result.url,
                // public_id: result.public_id,
                // originalname: req.file.originalname,
                // mimetype: req.file.mimetype,
                // size: req.file.size,

            });
            // document.getElementById('imageURL').value = path;
            newNote.user = req.user.id;
            // if (req.file.path){await unlink(req.file.path)};
            await newNote.save();
            let job = await Job.find().sort({createdAt: 'desc'});
            let jnID = job[0]._id;
            await Job.findByIdAndUpdate(jnID, {jobNumber: mtxjob});
        }
        req.flash('success_msg','Note added successfully');
        res.redirect('/notes');
};







notesCrtl.renderNotes = async (req,res)=>{
    let user = {}
    user.id = req.params.guest
    if(user.id != null){
        user.name = 'Guest'
    }else{
        user.id = req.session.passport.user
        console.log('>>user:' + user.id)
        let usuario = await User.findById(user.id);
        user.name = usuario.name
        user.email = usuario.email
        user.role = usuario.role
        user.list = usuario.list
        user.rank = usuario.rank
    }
    let count_InProgress = 0;
    let count_NotStarted = 0;
    let count_NotStarted_setup = 0;

    // ── Run all DB queries in parallel ───────────────────────────────────
    // Select only the fields rendered in all-notes.ejs — avoids transferring
    // large unused fields like description, imageID, wellbore data, etc.
    const NOTE_FIELDS = '_id mtxJobId title customerJobNumber project area wells poc geologist rig group dueDate status responsible customer budget created updatedAt trajWells trajAvgDDI trajAvgSteerIndex batchDays path designCode notesToVendor folderUrl handoverChecklist'; // 2026-10-28: + designCode notesToVendor (Handover e-mail); + path (job picture URL) so the Handover window knows which pads have a picture

    const [notes, dpStats, newSchedule] = await Promise.all([
        Note.find().sort({ dueDate: 'asc' }).select(NOTE_FIELDS).lean(),
        DPStats.find().lean(),
        NewSchedule.findOne().populate('user','name').lean(),
    ]);

    // Embedded "Users" + "Activity Heatmap" section, shown under the DP
    // Wellbore Backlog plot to admins and a specific set of ranks. Unlike
    // /users/activity (all users, admin-only), this is scoped to users
    // with list === 'CNRL' — the full org-wide view stays behind the
    // Manage Users / Usage Dashboard admin pages, reachable from the navbar.
    const ACTIVITY_VISIBLE_RANKS = ['WP1', 'WP2', 'WP3', 'DM', 'GeoM'];
    const canSeeActivity = (user.role === 'admin') || ACTIVITY_VISIBLE_RANKS.includes(user.rank);
    let activityReport = null;
    if(canSeeActivity){
        try {
            const cnrlUsers = await User.find({ list: 'CNRL' }).select('name email role').lean();
            activityReport = await buildActivityReport(cnrlUsers);
        } catch (err) {
            console.error('[all-notes activity embed] error:', err);
            activityReport = null;
        }
    }

    // ADDED 2026-09-14: fetch the VP->Main Area mapping and pass it through
    // as vpAreaList so all-notes.ejs's Snapshot section can group jobs by
    // Main Area (East/Central/West/Thermal) derived from siteObj.vp. Only
    // this one fetch + pass-through was added to this function — nothing
    // else here was changed. See VPArea model + renderVPAreas/saveVPAreas
    // below for the admin-managed source of this mapping.
    const vpAreaList = await VPArea.find().select('vpName mainArea -_id').lean();
    // ADDED 2026-10-27: padKey -> [ETS User names] for the Gantt "Handover"
    // e-mail To: field (see models/PadDistList.js).
    const padDistMap = (await PadDistList.find().select('pad padKey mtxJobId recipients outlookTo -_id').lean())
        .reduce((m, p) => { m[p.padKey] = { pad: p.pad, mtx: p.mtxJobId || '', outlook: p.outlookTo || '' /* 2026-11-11 Outlook-pasted recipients */, names: (p.recipients || []).map(r => r.etsUser).filter(Boolean),
            people: (p.recipients || []).map(r => ({ role: r.role || '', name: r.etsUser || '' })) /* 2026-10-29: roles for the Handover checklist */ }; return m; }, {});

    // ADDED 2026-10-27: vendor lists for the Handover e-mail To: (VendorDistList).
    const vendorList = await VendorDistList.find().sort({ name: 1 }).select('name emails -_id').lean();
    // ADDED 2026-10-27 (John): rig -> Directional Vendor (BV Rigs) — the
    // Handover window preselects the pad's vendor from its rig first.
    const bvRigVendorMap = (await BvRig.find().select('rig vendor -_id').lean())
        .reduce((m, r) => { if(r.vendor) m[String(r.rig).trim().toUpperCase().replace(/\s+/g, ' ')] = r.vendor; return m; }, {});

    // ADDED 2026-10-28 (John): Exp. Manager -> Ops Geo (OpsGeoDistList) for Handover CC.
    const opsGeoList = await OpsGeoDistList.find().select('expManager opsGeos -_id').lean();
    // ADDED 2026-10-28 (John): Design Code tables for the Handover e-mail body (text only, no pictures).
    const designCodeMap = (await DesignCode.find({ code: { $ne: 'GENERAL' } }).select('code area formations updatedDate sections -_id').lean())
        .reduce((m, d) => { m[d.code] = d; return m; }, {});

    res.render('all-notes.ejs', {
        notes, user, dpStats, newSchedule, count_InProgress, count_NotStarted, count_NotStarted_setup,
        canSeeActivity, activityReport, vpAreaList, padDistMap, vendorList, bvRigVendorMap, opsGeoList, designCodeMap,
    });
};






notesCrtl.renderQueryNotes = async (req,res)=>{
    let user = {}
    user.id = req.params.guest
    let donde = req.query.where
    let buscar = req.query.search
    if(user.id != null){
        user.name = 'Guest'
    }else{
        user.id = req.session.passport.user
        // console.log('>>Query user:' + user.id)
        let usuario = await User.findById(user.id);
        user.name = usuario.name
        user.email = usuario.email
        user.role = usuario.role
        user.rank = usuario.rank
    }
    // const notes = await Note.find({}).sort({createdAt: 'desc'});
    const notes = await Note.find().sort({dueDate: 'asc'});
    res.render('query.ejs', {notes, user, donde, buscar});
};






// ADDED 2026-10-09: escape regex metacharacters in user-typed search text.
// Bug: searching "Pad)))" sent an invalid regex to MongoDB ("unmatched closing
// parenthesis", code 51091); the rejected await had no try/catch, so the
// unhandled error crashed the whole Node process. Now the text is matched
// literally (same as the user expects from a search box) and errors are caught.
function escapeRegex(str){
    return String(str == null ? '' : str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

notesCrtl.renderQueryNotesPartial = async (req,res)=>{
  try {
    let user = {}
    user.id = req.params.guest
    let donde = req.query.where
    let buscar = req.query.search
    const buscarSafe = escapeRegex(buscar); // 2026-10-09: literal match, see escapeRegex()
    user.id = req.session.passport.user
    let usuario = await User.findById(user.id);
        user.name = usuario.name
        user.email = usuario.email
        user.role = usuario.role
        user.rank = usuario.rank
        user.list = usuario.list

    console.log("Partial...");

    const notes = await Note.find({ "$or": [
        { "title": { $regex: buscarSafe, $options: "i" } },
        { "description": { $regex: buscarSafe, $options: "i" } },
        { "mtxJobId": { $regex: buscarSafe, $options: "i" } },
        { "responsible": { $regex: buscarSafe, $options: "i" } },
        { "customer": { $regex: buscarSafe, $options: "i" } },
        { "customerJobNumber": { $regex: buscarSafe, $options: "i" } },
        { "operator": { $regex: buscarSafe, $options: "i" } },
        { "priority": { $regex: buscarSafe, $options: "i" } },
        { "invoice": { $regex: buscarSafe, $options: "i" } },
        { "user": { $regex: buscarSafe, $options: "i" } },
        { "status": { $regex: buscarSafe, $options: "i" } },
        { "dueDate": { $regex: buscarSafe, $options: "i" } },
        { "rig": { $regex: buscarSafe, $options: "i" } },
        { "project": { $regex: buscarSafe, $options: "i" } },
        { "poc": { $regex: buscarSafe, $options: "i" } },
        { "geologist": { $regex: buscarSafe, $options: "i" } },
        { "wells": { $regex: buscarSafe, $options: "i" } },
        { "area": { $regex: buscarSafe, $options: "i" } },
        { "budget": { $regex: buscarSafe, $options: "i" } },
        { "created": { $regex: buscarSafe, $options: "i" } },
    ]});
    console.log(notes);
    res.render('queryPartial.ejs', {notes, user, donde, buscar});
  } catch (e) {
    // 2026-10-09: never let a bad search take the server down.
    console.error('renderQueryNotesPartial:', e);
    res.status(500).send('Search failed: ' + e.message);
  }
};







notesCrtl.renderEditForm = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    const wellboreTrajectories = await WellboreTrajectory.find({noteId: note._id}).select('-survey').sort({wellName: 1});
    // 2026-10-28 (John): Design Code dropdown on the EDIT page (list from the Design Codes page).
    let designCodeList = [];
    try{ await seedDesignCodes(); designCodeList = await DesignCode.find({ code: { $ne: 'GENERAL' } }).select('code area group -_id').sort({ code: 1 }).lean(); }catch(err){ console.error('[DesignCode] list for edit page failed', err); }
    // 2026-10-29 (John): Handover checklist rows (auto Responsible from the pad's Pad Distribution List roles).
    let hcRows = [];
    try{ hcRows = HandoverChecklist.resolve(note.handoverChecklist, await padPeopleOf(note.project), note.poc); }catch(err){ console.error('[HandoverChecklist] edit page', err); }
    // 2026-11-11 (John): Pad Distribution List moved from VP Areas to the job EDIT page (below Work Flow).
    let padDist = null;
    try{ const k = PadDistList.keyOf(String(note.project || '').trim()); if(k) padDist = await PadDistList.findOne({ padKey: k }).lean(); }catch(err){ console.error('[PadDistList] edit page', err); }
    res.render('edit-note.ejs', {people: await mtxPeople(), note, user, wellboreTrajectories, designCodeList, hcRows, hcLabels: { inFolder: HandoverChecklist.IN_FOLDER, status: HandoverChecklist.STATUS }, padDist});
}





// ADDED 2026-10-29 (John): Handover checklist from the EDIT form (fields hc[i][key|inFolder|status|responsible]).
const HandoverChecklist = require('../public/js/handoverChecklist.js');
function hcFromBody(body){
    const src = Array.isArray(body.hc) ? body.hc : (body.hc && typeof body.hc === 'object' ? Object.values(body.hc) : null);
    if(!src) return undefined; // form without the checklist -> leave the saved value untouched
    const keys = HandoverChecklist.ITEMS.map(i => i.key), okF = Object.keys(HandoverChecklist.IN_FOLDER), okS = Object.keys(HandoverChecklist.STATUS);
    return src.filter(r => r && keys.includes(r.key)).map(r => ({ key: r.key,
        inFolder: okF.includes(r.inFolder) ? r.inFolder : '', status: okS.includes(r.status) ? r.status : '',
        responsible: String(r.responsible || '').trim().slice(0, 300) }));
}
// Pad Distribution List people [{role, name}] for a site (padKey = first 14 chars, see PadDistList.keyOf)
async function padPeopleOf(project){
    const key = PadDistList.keyOf(String(project || '').trim()); if(!key) return [];
    const p = await PadDistList.findOne({ padKey: key }).select('recipients').lean();
    return p ? (p.recipients || []).map(r => ({ role: r.role || '', name: r.etsUser || '' })) : [];
}
notesCrtl.updateNote = async (req,res)=>{
    // res.send('Update note...');
    // console.log(req.body);
    // const result = await cloudinary.v2.uploader.upload(req.file.path);
    // console.log('>> result:');
    // console.log(result);
    let cambios = "";
    if(req.body.title_cambio != ""){cambios = cambios + "Title changed. "};
    if(req.body.responsible_cambio != ""){cambios = cambios + "Responsible changed. "};
    if(req.body.customer_cambio != ""){cambios = cambios + "Customer changed. "};
    if(req.body.customerJobNumber_cambio != ""){cambios = cambios + "Customer Job Number changed. "};
    if(req.body.operator_cambio != ""){cambios = cambios + "Operator changed. "};
    if(req.body.rig_cambio != ""){cambios = cambios + "Rig changed. "};
    if(req.body.project_cambio != ""){cambios = cambios + "Project changed. "};
    if(req.body.poc_cambio != ""){cambios = cambios + "Point of Contact changed. "};
    if(req.body.priority_cambio != ""){cambios = cambios + "Priority changed. "};
    if(req.body.dueDate_cambio != ""){cambios = cambios + "Due Date changed. "};
    if(req.body.invoice_cambio != ""){cambios = cambios + "Invoice changed. "};
    if(req.body.status_cambio != ""){cambios = cambios + "Status changed. "};
    if(cambios != ""){
        let noteid = req.params.id;
        let userid = req.user.id;
        let user = await User.findById(userid);
        let newLog = new Log({
            log: cambios,
            noteid: noteid,
            user: user.name,
        });
        await newLog.save();
    }
    const {
        title, description, priority, status, responsible, dueDate, invoice, 
        customer, customerJobNumber, operator, rig, project, area, wells, budget, 
        poc, geologist, checkInitialInfo, checkFoldersSetup, checkOffsetWellsInfo, 
        checkCompassOffsets, checkCompassSubject,checkPlanning, checkReports, 
        checkSent, initialInfoDoneBy, initialInfoDoneAt, foldersDoneBy, 
        foldersDoneAt, offsetsInfoDoneBy, offsetsInfoDoneAt, compassOffsetsDoneBy, 
        compassOffsetsDoneAt, compassSubjectDoneBy, compassSubjectDoneAt, planningDoneBy, 
        planningDoneAt, reportsDoneBy, reportsDoneAt, sentBy, sentAt, checkETSUpdate , 
        ETSUpdateBy, ETSUpdateAt, created, imageURL,
        designCode, folderUrl, notesToVendor, // 2026-10-28: Handover e-mail fields
    } = req.body;
    await Note.findByIdAndUpdate(req.params.id, {
        title, description, priority, status, responsible, dueDate, invoice, 
        customer, customerJobNumber, operator, rig, project, area, wells, budget, 
        poc, geologist, checkInitialInfo,checkFoldersSetup, checkOffsetWellsInfo, 
        checkCompassOffsets, checkCompassSubject, checkPlanning, checkReports, 
        checkSent, initialInfoDoneBy, initialInfoDoneAt, foldersDoneBy, 
        foldersDoneAt, offsetsInfoDoneBy, offsetsInfoDoneAt, compassOffsetsDoneBy, 
        compassOffsetsDoneAt, compassSubjectDoneBy, compassSubjectDoneAt, planningDoneBy, 
        planningDoneAt, reportsDoneBy, reportsDoneAt, sentBy, sentAt, checkETSUpdate, 
        ETSUpdateBy, ETSUpdateAt, created, imageURL,
        designCode, folderUrl, notesToVendor, // 2026-10-28
        handoverChecklist: hcFromBody(req.body), // 2026-10-29
    });
    req.flash('success_msg','Note updated successfully');
    res.redirect('/notes');
}







notesCrtl.deleteNote = async (req,res)=>{
    // FIX 2026-09-13: added a server-side admin check. This route previously
    // only required isAuthenticated (see notes.routes.js) — the "Delete"
    // control in job.ejs was gated to user.role=='admin' client-side only,
    // and the new per-row Delete button in the all-notes.ejs "Archived" table
    // is the same. Since a permanent MongoDB delete is irreversible and the
    // client-side gate is not real access control (same class of gap fixed
    // for Frac Planes/Polylines this session), enforce admin here too.
    const requester = await User.findById(req.session.passport.user);
    if(!requester || requester.role !== 'admin'){
        req.flash('error_msg','Only admin accounts can delete a job.');
        return res.redirect('/notes');
    }
    let id = req.params.id
    const note = await Note.findById(id)
    if(note.imageID){
        await cloudinary.v2.uploader.destroy(note.imageID)
        await JobImage.findByIdAndDelete(note.noteImageID);
    };
    await Note.findByIdAndDelete(req.params.id);
    req.flash('success_msg','Note deleted successfully');
    res.redirect('/notes');
}

// Added 2026-09-14: bulk version of deleteNote for the "select many, delete
// at once" checkbox column in the all-notes.ejs Archived table. Same
// server-side admin enforcement as the single-delete route above — the
// checkbox column/button are also hidden client-side unless
// user.role=='admin', but that alone is not real access control.
// ids arrives as req.body.ids (an array of Note _id strings, sent by the
// page's bulk-delete form as repeated ids[] fields, or as JSON from fetch).
notesCrtl.deleteNotesBulk = async (req,res)=>{
    const requester = await User.findById(req.session.passport.user);
    if(!requester || requester.role !== 'admin'){
        req.flash('error_msg','Only admin accounts can delete jobs.');
        return res.redirect('/notes');
    }
    let ids = req.body.ids || [];
    if(!Array.isArray(ids)) ids = [ids]; // a single checkbox posts as a bare string, not an array
    ids = ids.filter(Boolean);
    if(ids.length === 0){
        req.flash('error_msg','No jobs were selected to delete.');
        return res.redirect('/notes');
    }
    // Clean up Cloudinary images the same way the single-delete route does,
    // before removing the DB documents themselves.
    const notesToDelete = await Note.find({ _id: { $in: ids } });
    for(const note of notesToDelete){
        if(note.imageID){
            try{
                await cloudinary.v2.uploader.destroy(note.imageID);
                await JobImage.findByIdAndDelete(note.noteImageID);
            } catch(err){
                console.error('[deleteNotesBulk] image cleanup failed for note', note._id, err);
            }
        }
    }
    const result = await Note.deleteMany({ _id: { $in: ids } });
    req.flash('success_msg', `${result.deletedCount} job(s) deleted successfully`);
    res.redirect('/notes');
}

// ADDED 2026-09-14: admin-only "VP Areas" management page. Backs the new
// Snapshot section in all-notes.ejs, which groups New Schedule jobs by
// Main Area (East/Central/West/Thermal) derived from siteObj.vp via the
// VPArea collection. Same server-side admin check pattern as
// deleteNote/deleteNotesBulk above (User.findById(req.session.passport.user),
// requester.role !== 'admin').
notesCrtl.renderVPAreas = async (req,res)=>{
    const requester = await User.findById(req.session.passport.user);
    if(!requester || !['admin','leader','user'].includes(requester.role)){   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        req.flash('error_msg','Only admin accounts can manage VP Areas.');
        return res.redirect('/notes');
    }

    // Seed the 4 default mappings the first time this page is used and the
    // collection is empty. Upsert-style (per vpName) so re-running this on
    // every page load never duplicates docs even if a doc already exists
    // for one of the four defaults.
    const existingCount = await VPArea.countDocuments();
    if(existingCount === 0){
        const defaults = [
            { vpName: 'Gillian Lefebure', mainArea: 'East' },
            { vpName: 'Richard Coates',   mainArea: 'Central' },
            { vpName: 'Shawn Bond',       mainArea: 'West' },
            { vpName: 'Steven Aspden',    mainArea: 'Thermal' },
        ];
        for(const d of defaults){
            await VPArea.updateOne({ vpName: d.vpName }, { $setOnInsert: d }, { upsert: true });
        }
    }

    const vpAreas = await VPArea.find().sort({ mainArea: 1, vpName: 1 }).lean();
    const padLists = await PadDistList.find().sort({ pad: 1 }).lean(); // 2026-10-27: Pad Distribution List table
    // 2026-10-27: Vendor Distribution List — seeded once with John's list
    // (as given 2026-10-27) when the collection is empty; editable afterwards.
    if(await VendorDistList.countDocuments() === 0){
        const seed = [
            { name: 'Altitude',    emails: 'amelanson@altitude-ep.com; gwilkinson@altitude-ep.com; mwiddifield@altitude-ep.com; sluger@altitude-ep.com; Jacob Pustanyk <jpustanyk@altitude-ep.com>' },
            { name: 'Halliburton', emails: 'sean.hinke@halliburton.com;John.Person@Halliburton.com;Ignacio.Garda@halliburton.com; Emran.Mojumdar@halliburton.com; Paula.Besas@halliburton.com; Carlos.Guardia@halliburton.com;  Benjamin Hand <Benjamin.Hand@halliburton.com>;calgary.wellplanning@halliburton.com' },
            { name: 'Mostar',      emails: 'wellplanning@mostardirectional.com; scott@mostardirectional.com;' },
            { name: 'Pacesetter',  emails: 'rwilliams@pacesetterdirectional.ca;amatheson@pacesetterdirectional.ca; wellplanners@pacesetterdirectional.ca;Dustin Deschamps <dustind@pacesetterdirectional.ca>' },
            { name: 'Phoenix',     emails: 'dblanchard@phxtech.com; Wellplanningcdn@phxtech.com;blowes@phxtech.com; ' },
            { name: 'SLB',         emails: 'ColinOKeefe@slb.com; FMedina8@slb.com;  MSchaaf@slb.com;CNRL.RealTimeOPS@cnrl.com; Alexis Marin <amanzanillo@slb.com>' },
            { name: 'Weatherford', emails: 'Jason.Blanken@weatherford.com ;valerie.dominiuk1@Weatherford.com ;Brandon.Kubinec@weatherford.com;Jason.Blanken@weatherford.com; Gabriel.Stefan@weatherford.com;Gilberto.Concha@weatherford.com;Castro, Gustavo <Gustavo.Castro@weatherford.com>; andy.hill@Weatherford.com' },
            { name: 'CNRL DDs',    emails: 'CNRL.RealTimeOPS@cnrl.com;' },
        ];
        for(const v of seed) await VendorDistList.updateOne({ name: v.name }, { $setOnInsert: v }, { upsert: true });
    }
    const vendors = await VendorDistList.find().sort({ name: 1 }).lean();
    // 2026-10-28: Ops. Geo. Distribution List — seeded once with John's list
    // (as given 2026-10-28) when the collection is empty; editable afterwards.
    if(await OpsGeoDistList.countDocuments() === 0){
        const seedOg = [
            ['Amar Nagra', 'Angela.Galipeault@cnrl.com;'], ['Barbara Wingate', "Jason.D'Aoust@cnrl.com;"],
            ['Camille Naqvi', 'Kallum.McIvor@cnrl.com;'], ['Jordan Jonasson', 'Ryan.Henkelman@cnrl.com;'],
            ['Josh Lau', 'Ryan.Henkelman@cnrl.com;'], ['Leanne Colborne', 'Rod.Day@cnrl.com;'],
            ['Scott Donaldson', 'Marielle.Hopf@cnrl.com;'], ['Sean Kleiner', 'Corey.Fitzgerald@cnrl.com;'],
            ['Tiffany Power', 'Kelvin.Humphrey-Kugbega@cnrl.com;'],
        ];
        for(const [expManager, opsGeos] of seedOg) await OpsGeoDistList.updateOne({ expManager }, { $setOnInsert: { expManager, opsGeos } }, { upsert: true });
    }
    const opsGeos = await OpsGeoDistList.find().sort({ expManager: 1 }).lean();
    // 2026-10-27: BV Rigs — seeded once with John's table (as given
    // 2026-10-27, trailing spaces trimmed) when the collection is empty.
    if(await BvRig.countDocuments() === 0){
        const seedRigs = [
            { rig: 'AKITA 28', airgap: '5.15m', drillingSup: 'Chris Sereda', vendor: 'SLB', notes: '' },
            { rig: 'AKITA 31', airgap: '5.8m', drillingSup: 'Don Grant', vendor: 'Altitude', notes: '' },
            { rig: 'BONANZA 6', airgap: '4.3m', drillingSup: 'Stacey Petersen', vendor: 'Phoenix', notes: '' },
            { rig: 'ENSIGN 218', airgap: '4.8m', drillingSup: 'Andy Hofer', vendor: 'Altitude', notes: 'Strat program' },
            { rig: 'ENSIGN 37', airgap: '7.95m', drillingSup: 'Levi Foster', vendor: 'Pacesetter', notes: '' },
            { rig: 'ENSIGN 39', airgap: '8.2m', drillingSup: 'Tyrell Drake', vendor: 'SLB', notes: '' },
            { rig: 'ENSIGN 44', airgap: '6.0m', drillingSup: 'Tyrell Drake', vendor: 'Pacesetter', notes: '' },
            { rig: 'ENSIGN 531', airgap: '4.5m', drillingSup: 'Andy Hofer', vendor: 'Altitude', notes: '' },
            { rig: 'ENSIGN 770', airgap: '8.6m', drillingSup: 'Tyrell Drake', vendor: 'SLB', notes: '' },
            { rig: 'EXCALIBUR 10', airgap: '4.57m', drillingSup: 'Chris McLeod', vendor: 'Altitude', notes: '' },
            { rig: 'HORIZON 19', airgap: '5.7m', drillingSup: 'Andy Hofer', vendor: 'Altitude', notes: '' },
            { rig: 'PRECISION 153', airgap: '4.3m', drillingSup: 'Chris McLeod', vendor: 'Altitude', notes: 'Strat program' },
            { rig: 'PRECISION 182', airgap: '4.3m', drillingSup: 'Stacey Petersen', vendor: 'Altitude', notes: '' },
            { rig: 'PRECISION 183', airgap: '4.55m', drillingSup: 'Chris Sereda', vendor: 'Halliburton', notes: '' },
            { rig: 'PRECISION 185', airgap: '4.3m', drillingSup: 'Chris McLeod', vendor: 'Altitude', notes: '' },
            { rig: 'PRECISION 190', airgap: '4.6m', drillingSup: 'Don Grant', vendor: 'Altitude', notes: '' },
            { rig: 'PRECISION 239', airgap: '4.3m', drillingSup: 'Stacey Petersen', vendor: 'Pacesetter', notes: '' },
            { rig: 'PRECISION 300', airgap: '4.3m', drillingSup: 'Andy Hofer', vendor: 'Altitude', notes: 'Strat program' },
            { rig: 'PRECISION 541', airgap: '5.3m', drillingSup: 'Chris Sereda', vendor: 'Halliburton', notes: '' },
            { rig: 'SAVANNA 651', airgap: '6.1m', drillingSup: 'Levi Foster', vendor: 'Pacesetter', notes: '' },
            { rig: 'SAVANNA 803', airgap: '6.85m', drillingSup: 'Levi Foster', vendor: 'Pacesetter', notes: '' },
            { rig: 'SAVANNA 804', airgap: '6.0m', drillingSup: 'Don Grant', vendor: 'Altitude', notes: '' },
            { rig: 'SAVANNA 805', airgap: '6.0m', drillingSup: 'Don Grant', vendor: 'Altitude', notes: '' }
        ];
        for(const r of seedRigs) await BvRig.updateOne({ rig: r.rig }, { $setOnInsert: r }, { upsert: true });
    }
    // 2026-10-27 (John): spelling fixed to match the Gantt ("EXCALLIBUR 10" in
    // the original table -> "EXCALIBUR 10"); also corrects an already-seeded row.
    if(!(await BvRig.exists({ rig: 'EXCALIBUR 10' }))) await BvRig.updateOne({ rig: 'EXCALLIBUR 10' }, { $set: { rig: 'EXCALIBUR 10' } });
    const bvRigs = await BvRig.find().sort({ rig: 1 }).lean();
    const user = await User.findById(req.session.passport.user);
    res.render('vpAreas.ejs', { user, vpAreas, padLists, vendors, bvRigs, opsGeos });
};

// ADDED 2026-09-14: saves the admin's edits from vpAreas.ejs. Accepts
// parallel arrays vpName[]/mainArea[] (existing rows) plus an optional
// single newVpName/newMainArea pair (the "Add VP" row) and upserts each
// into VPArea by vpName. Same admin check as renderVPAreas above.
notesCrtl.saveVPAreas = async (req,res)=>{
    const requester = await User.findById(req.session.passport.user);
    if(!requester || !['admin','leader','user'].includes(requester.role)){   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        req.flash('error_msg','Only admin accounts can manage VP Areas.');
        return res.redirect('/notes');
    }

    let vpNames   = req.body.vpName || [];
    let mainAreas = req.body.mainArea || [];
    if(!Array.isArray(vpNames))   vpNames   = [vpNames];
    if(!Array.isArray(mainAreas)) mainAreas = [mainAreas];

    const pairs = vpNames.map((vpName, i) => ({ vpName: String(vpName || '').trim(), mainArea: mainAreas[i] }))
        .filter(p => p.vpName && ['East','Central','West','Thermal'].includes(p.mainArea));

    const newVpName  = String(req.body.newVpName || '').trim();
    const newMainArea = req.body.newMainArea;
    if(newVpName && ['East','Central','West','Thermal'].includes(newMainArea)){
        pairs.push({ vpName: newVpName, mainArea: newMainArea });
    }

    for(const p of pairs){
        await VPArea.updateOne(
            { vpName: p.vpName },
            { $set: { mainArea: p.mainArea } },
            { upsert: true }
        );
    }

    req.flash('success_msg','VP Areas saved successfully');
    res.redirect('/notes/vpAreas');
}

// ADDED 2026-10-27 (John): Pad Distribution List — save (REPLACE) one pad's
// recipients from an imported ETS distribution-list file (parsed in the
// browser on vpAreas.ejs; body {pad, recipients:[{role, etsUser}], sourceFile}).
// Admin only, same check as the VP Areas page.
notesCrtl.savePadDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        // CHANGED 2026-11-11 (John): admin, leader and user can save (was admin only); the list now lives on the job EDIT page.
        if(!requester || !['admin', 'leader', 'user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage the Pad Distribution List.'});
        // 2026-10-27 (John): the list is linked through the MTX ID — the pad is
        // that job's project (site), as in findJobByMtxId (first match).
        // 2026-11-11: the EDIT page sends noteId instead (works for jobs without an MTX ID).
        let notesForId, mtxJobId = String(req.body.mtxJobId || '').trim();
        if(req.body.noteId){ const n = await Note.findById(req.body.noteId).select('project title mtxJobId').lean(); notesForId = n ? [n] : []; if(n) mtxJobId = String(n.mtxJobId || '').trim(); }
        else { if(!mtxJobId) return res.status(400).json({ok:false, error:'Enter the MTX ID.'}); notesForId = await Note.find({ mtxJobId }).select('project title').lean(); }
        if(!notesForId.length) return res.status(404).json({ok:false, error:'No job found' + (mtxJobId ? ' with MTX ID ' + mtxJobId : '') + '.'});
        const pad = String(notesForId[0].project || '').trim();
        const padKey = PadDistList.keyOf(pad);
        if(!padKey) return res.status(400).json({ok:false, error:'MTX ID ' + mtxJobId + ' has no site (project) set, so it cannot be matched to the Gantt.'});
        const seen = new Set();
        const recipients = (Array.isArray(req.body.recipients) ? req.body.recipients : [])
            .map(r => ({ role: String((r && r.role) || '').trim().slice(0, 100), etsUser: String((r && r.etsUser) || '').trim().slice(0, 200) }))
            .filter(r => r.etsUser && !seen.has(r.etsUser.toLowerCase()) && seen.add(r.etsUser.toLowerCase()));
        const outlookTo = String(req.body.outlookTo || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 10000);   // 2026-11-11 Outlook-pasted recipients
        if(!recipients.length && !outlookTo) return res.status(400).json({ok:false, error:'The list is empty: add names (Role | ETS User) or paste the Outlook recipients.'});
        const doc = await PadDistList.findOneAndUpdate({ padKey },
            { $set: { pad, padKey, mtxJobId, recipients, outlookTo, sourceFile: String(req.body.sourceFile || '').slice(0, 200), user: requester._id } },
            { upsert: true, new: true });
        res.json({ok:true, id: doc._id, pad: doc.pad, padKey, mtxJobId, count: recipients.length,
            warning: notesForId.length > 1 ? notesForId.length + ' jobs share MTX ID ' + mtxJobId + '; the first one (' + pad + ') was used.' : null});
    }catch(err){ console.error('[PadDistList] save failed', err); res.status(500).json({ok:false, error:'Failed to save the distribution list.'}); }
};
// ADDED 2026-10-27 (John): Vendor Distribution List — create / edit / delete
// (admin only). Body {id?, name, emails}; emails stored as typed.
notesCrtl.saveVendorDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage distribution lists.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const name = String(req.body.name || '').trim().slice(0, 100), emails = String(req.body.emails || '').trim().slice(0, 5000);
        if(!name) return res.status(400).json({ok:false, error:'Enter the vendor name.'});
        const clash = await VendorDistList.findOne({ name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).lean();
        if(clash && String(clash._id) !== String(req.body.id || '')) return res.status(400).json({ok:false, error:'A vendor called "' + clash.name + '" already exists.'});
        const doc = req.body.id
            ? await VendorDistList.findByIdAndUpdate(req.body.id, { $set: { name, emails, user: requester._id } }, { new: true })
            : await VendorDistList.create({ name, emails, user: requester._id });
        if(!doc) return res.status(404).json({ok:false, error:'Vendor not found.'});
        res.json({ok:true, id: doc._id, name: doc.name});
    }catch(err){ console.error('[VendorDistList] save failed', err); res.status(500).json({ok:false, error:'Failed to save the vendor.'}); }
};
// ADDED 2026-10-28 (John): Ops. Geo. Distribution List — create / edit /
// delete (admin only, same rule as the Pad Distribution List).
// Body {id?, expManager, opsGeos}; opsGeos stored as typed.
notesCrtl.saveOpsGeoDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage distribution lists.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const expManager = String(req.body.expManager || '').trim().slice(0, 100), opsGeos = String(req.body.opsGeos || '').trim().slice(0, 2000);
        if(!expManager) return res.status(400).json({ok:false, error:'Enter the Exp. Manager name.'});
        const clash = await OpsGeoDistList.findOne({ expManager: new RegExp('^' + expManager.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).lean();
        if(clash && String(clash._id) !== String(req.body.id || '')) return res.status(400).json({ok:false, error:'"' + clash.expManager + '" is already in the list.'});
        const set = { expManager, opsGeos, user: requester._id };
        const doc = req.body.id ? await OpsGeoDistList.findByIdAndUpdate(req.body.id, { $set: set }, { new: true }) : await OpsGeoDistList.create(set);
        if(!doc) return res.status(404).json({ok:false, error:'Row not found.'});
        res.json({ok:true, id: doc._id});
    }catch(err){ console.error('[OpsGeoDistList] save failed', err); res.status(500).json({ok:false, error:'Failed to save the row.'}); }
};
notesCrtl.deleteOpsGeoDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage distribution lists.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const r = await OpsGeoDistList.deleteOne({ _id: req.params.id });
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Row not found.'});
        res.json({ok:true});
    }catch(err){ console.error('[OpsGeoDistList] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete the row.'}); }
};
// ADDED 2026-10-28 (John): job picture for the Handover .eml e-mail. The
// browser cannot reliably download the Cloudinary image itself (note.path is
// stored as an http:// URL -> blocked as mixed content on https, and CORS is
// not guaranteed), so the server fetches it over https and streams it back.
// Only res.cloudinary.com URLs are fetched (no open proxy).
notesCrtl.handoverImage = async (req,res)=>{
    try{
        const note = await Note.findById(req.params.id).select('path').lean();
        if(!note || !note.path) return res.status(404).send('No picture for this job.');
        const url = new URL(String(note.path).replace(/^http:/i, 'https:'));
        if(url.hostname !== 'res.cloudinary.com') return res.status(400).send('Picture host not allowed.');
        // ADDED 2026-11-08 (John): ?thumb=1 -> small version for the Gantt tooltip, made by Cloudinary
        // (URL transformation w_320,c_limit,q_auto inserted after /image/upload/). Without ?thumb the
        // original picture is streamed exactly as before (Handover e-mail etc.).
        if(req.query.thumb && url.pathname.indexOf('/image/upload/') >= 0 && url.pathname.indexOf('/image/upload/w_320') < 0){
            url.pathname = url.pathname.replace('/image/upload/', '/image/upload/w_320,c_limit,q_auto/');
        }
        require('https').get(url, r => {
            if(r.statusCode !== 200){ r.resume(); return res.status(502).send('Picture download failed (' + r.statusCode + ').'); }
            res.set('Content-Type', r.headers['content-type'] || 'application/octet-stream');
            res.set('Cache-Control', 'private, max-age=300');
            r.pipe(res);
        }).on('error', err => { console.error('[handoverImage]', err); if(!res.headersSent) res.status(502).send('Picture download failed.'); });
    }catch(err){ console.error('[handoverImage]', err); res.status(500).send('Picture download failed.'); }
};
// ─────────────────────────────────────────────────────────────────────────────
// ADDED 2026-10-28 (John): Design Codes (trajectory design guidelines).
// Page /notes/designCodes — every logged-in user can read; only admin edits.
// Seed: when the DesignCode collection is empty, it is filled ONCE from
// src/data/designCodes/seed.json (parsed from CNRL_Design_Codes.xlsx) and the
// sheet pictures in src/data/designCodes/img are uploaded to Cloudinary
// (folder "mtx-design-codes"; identical pictures uploaded once and shared).
// A picture that fails to upload is skipped (logged) — the text still seeds.
// ─────────────────────────────────────────────────────────────────────────────
let designCodeSeeding = null;
async function seedDesignCodes(){
    if(await DesignCode.countDocuments() > 0) return;
    if(designCodeSeeding) return designCodeSeeding;
    designCodeSeeding = (async () => {
        const path = require('path'), fs = require('fs');
        const dir = path.join(__dirname, '..', 'data', 'designCodes');
        const seed = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8')).codes || [];
        const uploaded = {}; // hash part of file name -> {url, public_id}
        for(const c of seed){
            const images = [];
            for(const im of (c.images || [])){
                const key = String(im.file).replace(/^.*_/, '');
                try{
                    if(!uploaded[key]){
                        const r = await cloudinary.v2.uploader.upload(path.join(dir, 'img', im.file), { folder: 'mtx-design-codes' });
                        uploaded[key] = { url: r.secure_url, public_id: r.public_id };
                    }
                    images.push(Object.assign({ section: im.section || '', caption: '' }, uploaded[key]));
                }catch(err){ console.error('[DesignCode seed] picture upload failed', im.file, err.message || err); }
            }
            await DesignCode.updateOne({ code: c.code }, { $setOnInsert: {
                code: c.code, group: c.group || '', area: c.area || '', formations: c.formations || '', updatedDate: c.updatedDate || '',
                sections: c.sections || [], images, log: [{ user: 'import', at: new Date(), what: 'Imported from CNRL_Design_Codes.xlsx (' + (c.sheet || '') + ')' }],
            } }, { upsert: true });
        }
        console.log('[DesignCode] seeded', seed.length, 'codes,', Object.keys(uploaded).length, 'pictures');
    })();
    try{ await designCodeSeeding; } finally { designCodeSeeding = null; }
}
const dcIsAdmin = async req => { const u = await User.findById(req.session.passport.user); return (u && u.role === 'admin') ? u : null; };
// Delete a Cloudinary picture only when no other code still uses it (seeded pictures are shared).
async function dcDestroyIfUnused(public_id){
    if(!public_id) return;
    if(await DesignCode.countDocuments({ 'images.public_id': public_id }) > 0) return;
    try{ await cloudinary.v2.uploader.destroy(public_id); }catch(e){ console.error('[DesignCode] destroy failed', public_id, e.message || e); }
}
const dcToday = () => new Date().toISOString().slice(0, 10);
const dcCodeOrder = c => ({ Thermal: 0, East: 1, Central: 2, West: 3 }[c.group] ?? 9);

notesCrtl.renderDesignCodes = async (req,res)=>{
    const user = await User.findById(req.session.passport.user);
    try{ await seedDesignCodes(); }catch(err){ console.error('[DesignCode] seed failed', err); }
    const codes = (await DesignCode.find().lean()).sort((a, b) => (a.code === 'GENERAL' ? -1 : b.code === 'GENERAL' ? 1 : dcCodeOrder(a) - dcCodeOrder(b) || a.code.localeCompare(b.code)));
    res.render('designCodes.ejs', { user, codes, isAdmin: !!(user && user.role === 'admin') });
};
// Body {id?, code, group, area, formations, sections:[{title, rows:[{param,value,note}]}], images:[{_id, section, caption}]}
notesCrtl.saveDesignCode = async (req,res)=>{
    try{
        const admin = await dcIsAdmin(req); if(!admin) return res.status(403).json({ok:false, error:'Only admin accounts can edit Design Codes.'});
        const t = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
        const code = t(req.body.code, 40).toUpperCase(); if(!code) return res.status(400).json({ok:false, error:'Enter the code (e.g. T-007).'});
        const clash = await DesignCode.findOne({ code }).lean();
        if(clash && String(clash._id) !== String(req.body.id || '')) return res.status(400).json({ok:false, error:'Code ' + code + ' already exists.'});
        const sections = (Array.isArray(req.body.sections) ? req.body.sections : []).slice(0, 60).map(s => ({
            title: t(s.title, 200),
            rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 200).map(r => ({ param: t(r.param, 500), value: t(r.value, 5000), note: t(r.note, 2000) })).filter(r => r.param || r.value || r.note),
        })).filter(s => s.title || s.rows.length);
        const set = { code, group: t(req.body.group, 40), area: t(req.body.area, 200), formations: t(req.body.formations, 500), sections, updatedDate: dcToday() };
        let doc;
        if(req.body.id){
            doc = await DesignCode.findById(req.body.id); if(!doc) return res.status(404).json({ok:false, error:'Design Code not found.'});
            if(doc.code === 'GENERAL') set.code = 'GENERAL';
            Object.assign(doc, set);
            const meta = {}; (Array.isArray(req.body.images) ? req.body.images : []).forEach(i => { meta[String(i._id)] = i; });
            doc.images.forEach(im => { const m = meta[String(im._id)]; if(m){ im.section = t(m.section, 200); im.caption = t(m.caption, 300); } });
            doc.log.push({ user: admin.name, at: new Date(), what: 'Edited' });
            await doc.save();
        } else {
            doc = await DesignCode.create(Object.assign(set, { log: [{ user: admin.name, at: new Date(), what: 'Created' }] }));
        }
        res.json({ok:true, id: doc._id, code: doc.code});
    }catch(err){ console.error('[DesignCode] save failed', err); res.status(500).json({ok:false, error:'Failed to save the Design Code.'}); }
};
notesCrtl.deleteDesignCode = async (req,res)=>{
    try{
        const admin = await dcIsAdmin(req); if(!admin) return res.status(403).json({ok:false, error:'Only admin accounts can edit Design Codes.'});
        const doc = await DesignCode.findById(req.params.id); if(!doc) return res.status(404).json({ok:false, error:'Design Code not found.'});
        if(doc.code === 'GENERAL') return res.status(400).json({ok:false, error:'The general block cannot be deleted.'});
        const ids = doc.images.map(i => i.public_id);
        await DesignCode.deleteOne({ _id: doc._id });
        for(const p of ids) await dcDestroyIfUnused(p);
        res.json({ok:true});
    }catch(err){ console.error('[DesignCode] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete the Design Code.'}); }
};
// multipart: field "image" (global multer in server.js) + section, caption
notesCrtl.uploadDesignCodeImage = async (req,res)=>{
    try{
        const admin = await dcIsAdmin(req); if(!admin) return res.status(403).json({ok:false, error:'Only admin accounts can edit Design Codes.'});
        if(!req.file) return res.status(400).json({ok:false, error:'No picture received.'});
        if(!/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ok:false, error:'The file must be a picture (PNG, JPG...).'});
        const doc = await DesignCode.findById(req.params.id); if(!doc) return res.status(404).json({ok:false, error:'Design Code not found.'});
        const r = await cloudinary.v2.uploader.upload(req.file.path, { folder: 'mtx-design-codes' });
        doc.images.push({ url: r.secure_url, public_id: r.public_id, section: String(req.body.section || '').slice(0, 200), caption: String(req.body.caption || '').slice(0, 300) });
        doc.updatedDate = dcToday(); doc.log.push({ user: admin.name, at: new Date(), what: 'Picture added' });
        await doc.save();
        res.json({ok:true});
    }catch(err){ console.error('[DesignCode] picture upload failed', err); res.status(500).json({ok:false, error:'Failed to upload the picture.'}); }
    finally{ if(req.file) try{ await unlink(req.file.path); }catch(_){} }
};
notesCrtl.deleteDesignCodeImage = async (req,res)=>{
    try{
        const admin = await dcIsAdmin(req); if(!admin) return res.status(403).json({ok:false, error:'Only admin accounts can edit Design Codes.'});
        const doc = await DesignCode.findById(req.params.id); if(!doc) return res.status(404).json({ok:false, error:'Design Code not found.'});
        const im = doc.images.id(req.params.imgId); if(!im) return res.status(404).json({ok:false, error:'Picture not found.'});
        const pid = im.public_id; doc.images.pull(im._id);
        doc.updatedDate = dcToday(); doc.log.push({ user: admin.name, at: new Date(), what: 'Picture removed' });
        await doc.save(); await dcDestroyIfUnused(pid);
        res.json({ok:true});
    }catch(err){ console.error('[DesignCode] picture delete failed', err); res.status(500).json({ok:false, error:'Failed to remove the picture.'}); }
};
// ADDED 2026-10-29 (John): CNRL logo for the Handover e-mail (John's Cloudinary link), fetched by the
// server for the same reason as handoverImage (browser download of Cloudinary is not reliable).
const HANDOVER_LOGO_URL = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1711167914/Canadian_Natural_logo_ygbbox.png';
notesCrtl.handoverLogo = (req,res)=>{
    require('https').get(HANDOVER_LOGO_URL, r => {
        if(r.statusCode !== 200){ r.resume(); return res.status(502).send('Logo download failed (' + r.statusCode + ').'); }
        res.set('Content-Type', r.headers['content-type'] || 'image/png'); res.set('Cache-Control', 'private, max-age=3600'); r.pipe(res);
    }).on('error', err => { console.error('[handoverLogo]', err); if(!res.headersSent) res.status(502).send('Logo download failed.'); });
};
// ADDED 2026-10-27 (John): BV Rigs — create / edit / delete (admin only).
notesCrtl.saveBvRig = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage BV Rigs.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const f = k => String(req.body[k] || '').trim().slice(0, 300);
        const rig = f('rig'); if(!rig) return res.status(400).json({ok:false, error:'Enter the rig name.'});
        const clash = await BvRig.findOne({ rig: new RegExp('^' + rig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).lean();
        if(clash && String(clash._id) !== String(req.body.id || '')) return res.status(400).json({ok:false, error:'Rig "' + clash.rig + '" already exists.'});
        const set = { rig, airgap: f('airgap'), drillingSup: f('drillingSup'), vendor: f('vendor'), notes: f('notes'), user: requester._id };
        const doc = req.body.id ? await BvRig.findByIdAndUpdate(req.body.id, { $set: set }, { new: true }) : await BvRig.create(set);
        if(!doc) return res.status(404).json({ok:false, error:'Rig not found.'});
        res.json({ok:true, id: doc._id});
    }catch(err){ console.error('[BvRig] save failed', err); res.status(500).json({ok:false, error:'Failed to save the rig.'}); }
};
notesCrtl.deleteBvRig = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage BV Rigs.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const r = await BvRig.deleteOne({ _id: req.params.id });
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Rig not found.'});
        res.json({ok:true});
    }catch(err){ console.error('[BvRig] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete the rig.'}); }
};
notesCrtl.deleteVendorDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || !['admin','leader','user'].includes(requester.role)) return res.status(403).json({ok:false, error:'Only admin, leader and user accounts can manage distribution lists.'});   // 2026-11-13 (John): VP Areas page open to admin/leader/user (was admin-only)
        const r = await VendorDistList.deleteOne({ _id: req.params.id });
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Vendor not found.'});
        res.json({ok:true});
    }catch(err){ console.error('[VendorDistList] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete the vendor.'}); }
};
notesCrtl.deletePadDistList = async (req,res)=>{
    try{
        const requester = await User.findById(req.session.passport.user);
        if(!requester || requester.role !== 'admin') return res.status(403).json({ok:false, error:'Only admin accounts can manage distribution lists.'});
        const r = await PadDistList.deleteOne({ _id: req.params.id });
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'List not found.'});
        res.json({ok:true});
    }catch(err){ console.error('[PadDistList] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete the list.'}); }
};








notesCrtl.renderJob = async (req,res)=>{
    let user = {}
    user.id = req.session.passport.user;
    // console.log('>>Render Job user:' + user.id)
    let usuario = await User.findById(user.id);
    user.role = usuario.role;
    user.rank = usuario.rank;
    user.name = usuario.name;
    let noteid = req.params.id;
    let note = await Note.findById(noteid);
    let log = await Log.find({noteid}).sort({createdAt: 'desc'});
    let wellboreTrajectories = await WellboreTrajectory.find({noteId: noteid});
    let pasonPlots = await PasonPlots.findOne({noteId: noteid}).lean();
    let tdModel = await TDModel.findOne({noteId: noteid}).lean();
    let hydraulicsModel = await HydraulicsModel.findOne({noteId: noteid}).lean();
    let casingDesign = await CasingDesign.findOne({noteId: noteid}).lean();
    // 2026-11-11 (John): show the pad's Pad Distribution List (saved on the EDIT page) on the job page, read-only.
    let padDist = null;
    try{ const k = PadDistList.keyOf(String((note && note.project) || '').trim()); if(k) padDist = await PadDistList.findOne({ padKey: k }).lean(); }catch(err){ console.error('[PadDistList] job page', err); }
    // 2026-11-13 (John): Slide Sheet accordion (after Hydraulics) — only shown when the job has saved slide sheets.
    let slideSheets = [];
    try{ slideSheets = await SlideSheet.find({ noteId: noteid }).select('-segments -settings -roles').populate('user', 'name').sort({ wellKey: 1, updatedAt: -1 }).lean(); }catch(err){ console.error('[SlideSheet] job page', err); }
    // 2026-11-14 (John): Motor Yield per slide (public/js/motorYield.js: MY = interval DLS x CL / slid, deg/30 m) from the
    // well's ORIGINAL uploaded survey (wellName === slide sheet wellKey, not a correction version). Stored on each
    // interval as i.my (null when the slide is not bracketed by two surveys). Display only; nothing is saved.
    try{
        slideSheets.forEach(function(x){
            const t = (wellboreTrajectories || []).find(w => w.wellName === x.wellKey && CORR_SOURCES.indexOf(w.source) < 0);
            if(!t || !t.survey || !t.survey.length){ x.myNote = 'no survey for ' + x.wellKey; return; }
            const sv = t.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim, interp: !!s.interp }));
            // 2026-11-14: + rotation correction (MTX choice, motorYield.js analyse()) and per-run averages (x.myRuns)
            const iv = x.intervals || [], mainIv = iv.filter(i => !i.leg || i.leg === 'Main');
            const runOf = md => { const c = mainIv.filter(i => i.from <= md && md <= i.to); return c.length ? (c[c.length - 1].run || '') : ''; };
            const r = MotorYieldCore.analyse(sv, iv, runOf, { minRotLen: 30 });
            iv.forEach(function(i, k){ const q = r.slides[k]; i.my = q ? q.my : null; i.myCorr = q ? q.myCorr : null; i.myFlag = q ? [q.reason, q.flag].filter(Boolean).join(' · ') : ''; i.myStatus = q ? q.status : null; i.myNoisy = q ? !!q.noisy : false; });   // 2026-11-14: quality rules, defaults 3 m / 20 %
            x.myRuns = Object.keys(r.runs).map(k => r.runs[k]).filter(q => q.myAvg != null);
        });
    }catch(err){ console.error('[SlideSheet] motor yield', err); }
    res.render('job.ejs', {note, user, log, wellboreTrajectories, pasonPlots, tdModel, hydraulicsModel, casingDesign, padDist, slideSheets})
}




notesCrtl.createNewLog = async(req,res)=>{
    //console.log(req.body);
    //const{title, description}=req.body;
    let noteid = req.params.id;
    let userid = req.user.id;
    let user = await User.findById(userid);
    let newLog = new Log({
        log: req.body.newlog,
        noteid: noteid,
        user: user.name,
    });
    await newLog.save();
    req.flash('success_msg','Log added successfully');
    res.redirect(`/notes/job/${noteid}`);
};






notesCrtl.renderUploadImage = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('upload.ejs', {note, user});
}





notesCrtl.uploadImage = async(req, res) => {
    // Borrar la imagen anterior si existe
    try{
        const note = await Note.findById(req.params.id);
        if (note && (note.path || note.imageID)) {
            await cloudinary.v2.uploader.destroy(note.imageID);
            await JobImage.findByIdAndDelete(note.noteImageID);
            await Note.findByIdAndUpdate(note._id, {
                path: "",
                imageID: "",
                noteImageID: "",
            });
        }   
        // Subir la nueva imagen
        const image = new JobImage();
        const result = await cloudinary.v2.uploader.upload(req.file.path);
            image.filename = req.file.filename;
            image.path = result.url;
            image.public_id = result.public_id;
            image.originalname = req.file.originalname;
            image.mimetype = req.file.mimetype;
            image.size = req.file.size;
            image.noteId = req.body.noteId;
        await unlink(req.file.path);
        await image.save();
        let noteWhereImageIsSaved = await JobImage.findOne({'public_id': image.public_id});
        await Note.findByIdAndUpdate(image.noteId, {
            path: image.path,
            imageID: image.public_id,
            noteImageID: noteWhereImageIsSaved._id,
        });
        console.log("<<<< imageURL updated >>>>");
        req.flash('success_msg','Image uploaded successfully');
        res.redirect('/notes/job/' + req.params.id);
    } catch (error) {
        console.error("Error uploading image:", error);
        req.flash('error_msg','Error uploading image');
        res.redirect('/notes/job/' + req.params.id);
  }
};





//Remove Image
notesCrtl.removeImage = async(req,res)=>{
    try{
        const note = await Note.findById(req.params.id);
        await cloudinary.v2.uploader.destroy(note.imageID);
        await JobImage.findByIdAndDelete(note.noteImageID);
        await Note.findByIdAndUpdate(note._id, {
            path: "",
            imageID: "",
            noteImageID: "",
        });
        req.flash('success_msg','Image removed successfully');
        res.redirect('/notes/job/' + req.params.id);
    } catch (error) {
        console.error("Error removing image:", error);
        req.flash('error_msg','Error removing image');
        res.redirect('/notes/job/' + req.params.id);
    }
};








notesCrtl.findSite = async (req, res) => {
  try {
    const site = req.params.site;
    console.log("Searching for site (prefix):", site);

    if (!site) return res.status(400).json({ error: "Site is required" });

    // 🔎 Match any project that STARTS WITH the given site
    const project = await Note.findOne({
      project: { $regex: `^${escapeRegex(site)}`, $options: "i" } // 2026-10-09: escaped, same crash risk as search
    });

    if (!project) {
      console.log(`No project found for site: ${site}`);
      return res.status(404).render("siteNotFound.ejs", { site });
    }

    console.log(`Found project: ${project._id} for site: ${site}`);

    // Get user info
    const userId = req.session.passport?.user;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const usuario = await User.findById(userId);
    if (!usuario) return res.status(404).json({ error: "User not found" });

    const user = {
      id: usuario._id,
      role: usuario.role,
      rank: usuario.rank,
      name: usuario.name,
    };

    // Fetch logs for this note
    const log = await Log.find({ noteid: project._id }).sort({ createdAt: "desc" });

    // Fetch wellbore trajectories for this note
    const wellboreTrajectories = await WellboreTrajectory.find({noteId: project._id});
    const pasonPlots = await PasonPlots.findOne({noteId: project._id}).lean();
    const tdModel = await TDModel.findOne({noteId: project._id}).lean();

    // Render job page with the single note
    res.render("job.ejs", { note: project, user, log, wellboreTrajectories, pasonPlots, tdModel });

  } catch (err) {
    console.error("Error in findSite:", err);
    res.status(500).json({ error: "Server error" });
  }
};








// Header→field mapping for the RAW New Schedule columns — matched by
// substring, same robust technique used for the New Schedule Gantt chart.
// This is resilient to the uploaded file's exact column order/format
// changing, unlike the old hardcoded-index approach.
const SYNC_HEADER_MAP = [
    [ 'Site Name', 'site'  ],
    [ 'Est. Start Date', 'start' ],
    [ 'Rig Duration', 'duration' ], // must be checked before 'Rig' below
    [ 'Rig', 'rig' ],
    [ 'Expl. Cust. Group', 'group' ],
    [ 'Primary Zone', 'primaryZone' ],   // 2026-11-25
    [ 'Exploration Mgr', 'explMgr' ],    // 2026-11-25
    // 2026-11-26 (John): new schedule format — "Responsible - <role> - ETS" columns (old names kept above / below still work)
    [ 'Exploration Manager', 'explMgr' ],
    [ 'Drilling Engineer', 'respDrillEng' ],
    [ 'Responsible - Geology', 'respGeology' ], [ 'Responsible Geology', 'respGeology' ],
    [ 'Drilling Supervisor', 'respDrillSup' ],
    [ 'Drilling Tech', 'respDrillTech' ],
    [ 'Exploitation', 'respExploit' ],
    [ 'Geo Tech', 'respGeoTech' ],
    [ 'Geophysics', 'respGeophys' ],
    [ 'Responsible - Production', 'respProd' ],
];
// 2026-11-25 (John): Note.primaryZone from the New Schedule. Pads matched like syncDueDates (first 14 characters of
// 'Site Name' = Note.project). A pad's wells can target different zones -> distinct zones, most frequent first, joined ', '.
// Only notes whose value actually changes are written. Returns the number of notes updated.
async function syncPrimaryZones(ns){
    if(!ns || !Array.isArray(ns.headers) || !Array.isArray(ns.rows)) return 0;
    const colMap = buildSyncColMap(ns.headers);
    // 2026-11-25: also Note.explMgr ('Exploration Mgr'), same rule (distinct values per pad, most frequent first)
    const FIELDS = ['primaryZone', 'explMgr', 'respDrillEng', 'respGeology', 'respDrillSup', 'respDrillTech', 'respExploit', 'respGeoTech', 'respGeophys', 'respProd'].filter(f => colMap[f] !== undefined);   // 2026-11-26: + people
    if(colMap.site === undefined || !FIELDS.length) return 0;
    const byPad = {};
    ns.rows.forEach(row => {
        const site = row[colMap.site]; if(!site) return;
        const key = String(site).slice(0, 14), p = byPad[key] || (byPad[key] = {});
        FIELDS.forEach(f => { const v = String(row[colMap[f]] ?? '').trim(); if(!v) return; const c = p[f] || (p[f] = {}); c[v] = (c[v] || 0) + 1; });
    });
    const notes = await Note.find({}, { project: 1, primaryZone: 1, explMgr: 1, respDrillEng: 1, respGeology: 1, respDrillSup: 1, respDrillTech: 1, respExploit: 1, respGeoTech: 1, respGeophys: 1, respProd: 1 }).lean();
    let n = 0;
    for(const note of notes){
        const key = note.project ? String(note.project).slice(0, 14) : null, p = key && byPad[key];
        if(!p) continue;
        const set = {};
        FIELDS.forEach(f => { const c = p[f]; if(!c) return; const v = Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)).join(', '); if(v !== (note[f] || '')) set[f] = v; });
        if(Object.keys(set).length){ await Note.updateOne({ _id: note._id }, { $set: set }); n++; }
    }
    return n;
}
function buildSyncColMap(headers) {
    const colMap = {};
    headers.forEach((h, i) => {
        const hStr = String(h || '').trim();
        if (!hStr) return;
        for (const [substr, field] of SYNC_HEADER_MAP) {
            if (colMap[field] !== undefined) continue;
            if (hStr.toLowerCase().includes(substr.toLowerCase())) {
                if (field === 'rig' && hStr.toLowerCase().includes('duration')) continue;
                colMap[field] = i;
            }
        }
    });
    return colMap;
}

// GET /notes/syncDueDates — sync Note.dueDate/rig/group from New Schedule
notesCrtl.syncDueDates = async (req, res) => {
  try {
    console.log("🔄 Syncing Notes.dueDate and Notes.rig with New Schedule...");

    // Load Notes and the single New Schedule document
    const notes = await Note.find().lean();
    const ns = await NewSchedule.findOne().lean();

    if (!ns || !ns.headers || !ns.headers.length || !ns.rows || !ns.rows.length) {
      return res.json({ message: "No New Schedule data to sync from", updated: 0 });
    }

    const colMap = buildSyncColMap(ns.headers);
    if (colMap.site === undefined || colMap.start === undefined) {
      return res.status(400).json({
        error: "Could not find 'Site Name' and/or 'Est. Start Date' columns in the New Schedule file. No changes made.",
      });
    }
    const get = (row, field) => (colMap[field] !== undefined) ? row[colMap[field]] : undefined;

    // Build a map of schedule sites → { start (earliest), rig, group }
    // A pad has multiple wells with different start dates — we want the
    // earliest start date so the table shows when the pad first spuds.
    const scheduleMap = {};
    ns.rows.forEach(row => {
      const site  = get(row, 'site');
      const start = get(row, 'start');
      if (!site || !start) return;

      const key     = String(site).slice(0, 14);
      const schDate = new Date(start);
      if (isNaN(schDate)) return;

      const rig   = get(row, 'rig')   || null;
      const group = get(row, 'group') || null;

      if (!scheduleMap[key]) {
        scheduleMap[key] = { start: schDate, rig, group };
      } else if (schDate < scheduleMap[key].start) {
        scheduleMap[key].start = schDate;
        scheduleMap[key].rig   = rig   || scheduleMap[key].rig;
        scheduleMap[key].group = group || scheduleMap[key].group;
      }
    });

    // Convert Date objects to YYYY-MM-DD strings
    Object.values(scheduleMap).forEach(entry => {
      entry.start = entry.start.toISOString().split("T")[0];
    });

    // Loop through notes and update dueDate + rig + group
    let updatedCount = 0;
    for (let note of notes) {
      const key = note.project?.slice(0, 14);
      if (key && scheduleMap[key]) {
        const updateFields = {
          dueDate: scheduleMap[key].start,
        };
        if (scheduleMap[key].rig) {
          updateFields.rig = scheduleMap[key].rig;
        }
        if (scheduleMap[key].group) {
          updateFields.group = scheduleMap[key].group;
        }

        await Note.findByIdAndUpdate(note._id, updateFields);
        updatedCount++;
        console.log(
          `✅ Updated Note ${note._id} → dueDate = ${updateFields.dueDate}, rig = ${updateFields.rig || "unchanged"}, group = ${updateFields.group || "unchanged"}`
        );
      }
    }

    let zonesUpdated = 0; try { zonesUpdated = await syncPrimaryZones(ns); } catch(e){ console.error('syncPrimaryZones:', e); }   // 2026-11-25
    res.json({ message: "Sync complete", updated: updatedCount, zonesUpdated });

  } catch (err) {
    console.error("❌ Error in syncDueDates:", err);
    res.status(500).json({ error: "Server error" });
  }
};







notesCrtl.renderUploadDPStats = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadDPStats.ejs', {note, user});
};



notesCrtl.uploadDPStats = async (req, res) => {
  try {
    // Clear the entire collection before saving new data
    await DPStats.deleteMany({});   // safer than drop(), won't throw if collection doesn't exist
    console.log("Cleared existing DPStats data.");

    const { data } = req.body; // <-- JSON payload from frontend

    if (!data || !Array.isArray(data) || data.length <= 1) {
      return res.status(400).json({ error: "No DPStats data received" });
    }

    // remove header row — data rows start at index 1
    const rows = data.slice(1);

    // Row layout (28 columns): [0]=DP Version, [1]=DP Days, then 26 raw source columns
    // in the same order as SRC_COLS in uploadDPStats.ejs.
    const toNum  = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
    const toDate = (v) => (v === "" || v === null || v === undefined) ? null : new Date(v);
    const toStr  = (v) => (v === null || v === undefined) ? "" : String(v);

    const DPStatsDocs = rows.map((row) => {
      return {
        dpVersion: row[0] || "P0",
        dpDays: Number(row[1]) || 0,

        etsId:                                toNum(row[2]),
        bhLocation:                           toStr(row[3]),
        prospectName:                         toStr(row[4]),
        explorCoreArea:                       toStr(row[5]),
        fieldName:                            toStr(row[6]),
        wellType:                             toStr(row[7]),
        opNonOp:                              toStr(row[8]),
        afeTimingYear:                        toStr(row[9]),
        playType:                             toStr(row[10]),
        province:                             toStr(row[11]),
        dpProposedWellboresAllPlans:          toNum(row[12]),
        dpProposedTotalDrilledMetersAllPlans: toNum(row[13]),
        dpProposedTotalLateralLengthAllPlans: toNum(row[14]),
        dpReceivedDateAllPlans:               toDate(row[15]),
        dpRequestDateAllPlans:                toDate(row[16]),
        dpRevisedSurveyNoAllPlans:            toStr(row[17]),
        dpTypeAllPlans:                       toStr(row[18]),
        dpCompanyNameAllPlans:                toStr(row[19]),
        dpCurrentPlanAllPlans:                toStr(row[20]),
        dpDesignPlanNoAllPlans:               toStr(row[21]),
        dpDrillApprovedAllPlans:              toDate(row[22]),
        dpGeolApprovedAllPlans:               toDate(row[23]),
        dpJustificationAllPlans:              toStr(row[24]),
        dpProposedWellbores:                  toNum(row[25]),
        dpProposedTotalDrilledMeters:         toNum(row[26]),
        dpProposedTotalLateralLength:         toNum(row[27]),

        // New columns (32-column format) — gracefully empty/null for older uploads
        rig:                                  toStr(row[28]),
        rigDuration:                          toNum(row[29]),
        scheduled:                            toStr(row[30]),
        siteName:                             toStr(row[31]),
        spudDate:                             toDate(row[32]),
        rigReleaseDate:                       toDate(row[33]),
        estStartDate:                         toDate(row[34]),

        user: req.user ? req.user._id : null,
        noteId: req.params.id || null,
      };
    });

    // Bulk insert
    await DPStats.insertMany(DPStatsDocs);

    console.log("<<<< DPStats uploaded >>>>");
    req.flash("success_msg", "DPStats uploaded successfully");
    res.redirect("/notes");
  } catch (error) {
    console.error("Error uploading DPStats:", error);
    req.flash("error_msg", "Error uploading DPStats");
    res.redirect("/notes");
  }
};






notesCrtl.renderUploadDPI = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadDPI.ejs', {note, user});
};




notesCrtl.renderUploadPason = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadPason.ejs', {note, user});
};




notesCrtl.renderUploadPadAC = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadPadAC.ejs', {note, user});
};


notesCrtl.renderUploadFracPlanes = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadFracPlanes.ejs', {note, user});
};


// Help — static in-app help page (added 2026-08-27 per the person's
// request for a Help link in the account menu). No job/DB coupling, same
// "available to every authenticated role" pattern as Quick Plan/6-axis
// Data below. Content lives entirely in help.ejs; this just renders it.
notesCrtl.renderHelp = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('help.ejs', {user});
};

// Quick Plan — standalone directional-plan sanity checker. No note/job/DB
// coupling at all (unlike T&D/Hydraulics, which at least accept an optional
// ?mtxJobId=... to preload a job): this is a pure client-side calculator
// (minimum curvature only) for a drilling engineer to rough out a well path
// and check target/DLS feasibility before doing anything in a real job.
// Available to every authenticated role — no canUseModelers gate.
notesCrtl.renderQuickPlan = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('quickPlan.ejs', {user});
};

// 6-axis Data — MWD sensor axis-mapping/calibration diagnostic (brute-forces
// which accelerometer/magnetometer axis permutation+sign combination
// reproduces a known reference Inc/Az/Dip, and QCs a full multi-station run
// via Excel import). Ported 2026-08-22 from the person's own pre-existing
// standalone tool (left in the working folder as "MWD sensor mapping" —
// index.html/script.js/style.css); the math itself was NOT changed, only
// restyled to match MTX's theme and wired in here. Same "no bound
// note/job, no MongoDB" pattern as renderQuickPlan above, available to
// every authenticated role — no canUseModelers gate.
notesCrtl.renderSixAxisData = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('sixAxisData.ejs', {user});
};

// 6-axis Data — saved "cases" (2026-08-23, per the person's request to
// persist work between sessions; updated 2026-08-24 to be shared across
// all users with role-based CRUD instead of private-per-user). Each case
// stores the raw imported Excel rows + the Input Data panel state, and
// who created it + when. Role matrix (enforced here + at the route level
// via blockViewerFromSaving):
//   - admin:  full CRUD — can save, load, and delete ANY case.
//   - leader/user: can save (create) new cases and load ANY case, but can
//     only delete cases THEY created.
//   - viewer: read-only — can list/load cases, but the route-level guard
//     blocks save/delete entirely before either handler below even runs.
notesCrtl.saveSixAxisCase = async(req,res)=>{
    try{
        const {name, rawRows, inputData} = req.body;
        if(!name || !String(name).trim()){
            return res.status(400).json({ok:false, error:'A case name is required.'});
        }
        const doc = await SixAxisCase.create({
            user: req.session.passport.user,
            name: String(name).trim(),
            rawRows: Array.isArray(rawRows) ? rawRows : [],
            inputData: inputData || {},
            // 2026-10-25: Short Collar accordion settings (sixAxisData.ejs scCollectSettings)
            shortCollar: (req.body.shortCollar && typeof req.body.shortCollar === 'object') ? req.body.shortCollar : null,
        });
        res.json({ok:true, case:{_id:doc._id, name:doc.name, createdAt:doc.createdAt}});
    }catch(err){
        console.error('[SixAxisCase] save failed', err);
        res.status(500).json({ok:false, error:'Failed to save case.'});
    }
};

// Shared across all users (no longer filtered to req.session.passport.user)
// — every authenticated role can see every case. createdByUserId lets the
// page decide client-side whether to show a Delete button for a
// leader/user viewing their own case (the server still re-checks on the
// actual delete request, since this list alone isn't access control).
notesCrtl.listSixAxisCases = async(req,res)=>{
    try{
        const cases = await SixAxisCase.find({}, 'name createdAt user')
            .populate('user', 'name email')
            .sort({createdAt:-1})
            .lean();
        const shaped = cases.map(c => ({
            _id: c._id,
            name: c.name,
            createdAt: c.createdAt,
            createdByName: c.user ? (c.user.name || c.user.email || 'Unknown') : 'Unknown',
            createdByUserId: c.user ? String(c.user._id) : null,
        }));
        res.json({
            ok:true,
            cases: shaped,
            currentUserId: req.session.passport.user ? String(req.session.passport.user) : null,
            currentUserRole: req.user ? req.user.role : null,
        });
    }catch(err){
        console.error('[SixAxisCase] list failed', err);
        res.status(500).json({ok:false, error:'Failed to list cases.'});
    }
};

// Shared across all users — any authenticated role can load any case.
notesCrtl.getSixAxisCase = async(req,res)=>{
    try{
        const doc = await SixAxisCase.findById(req.params.id).populate('user', 'name email').lean();
        if(!doc){
            return res.status(404).json({ok:false, error:'Case not found.'});
        }
        res.json({ok:true, case:{
            _id: doc._id,
            name: doc.name,
            rawRows: doc.rawRows,
            inputData: doc.inputData,
            shortCollar: doc.shortCollar || null, // 2026-10-25: Short Collar accordion settings
            createdAt: doc.createdAt,
            createdByName: doc.user ? (doc.user.name || doc.user.email || 'Unknown') : 'Unknown',
            createdByUserId: doc.user ? String(doc.user._id) : null,
        }});
    }catch(err){
        console.error('[SixAxisCase] get failed', err);
        res.status(500).json({ok:false, error:'Failed to load case.'});
    }
};

// Admin can delete any case; leader/user can only delete cases they
// created themselves (viewer never reaches here — blocked at the route).
notesCrtl.deleteSixAxisCase = async(req,res)=>{
    try{
        const filter = {_id: req.params.id};
        if(!req.user || req.user.role !== 'admin'){
            filter.user = req.session.passport.user;
        }
        const result = await SixAxisCase.deleteOne(filter);
        if(!result.deletedCount){
            return res.status(404).json({ok:false, error:'Case not found, or you do not have permission to delete it.'});
        }
        res.json({ok:true});
    }catch(err){
        console.error('[SixAxisCase] delete failed', err);
        res.status(500).json({ok:false, error:'Failed to delete case.'});
    }
};

notesCrtl.renderUploadTorqueAndDrag = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadTorqueAndDrag.ejs', {note, user});
};

// Bit Hydraulics Program standalone editor — same "no bound note" pattern as
// renderUploadTorqueAndDrag: the page loads on its own, then resolves the
// job client-side via ?mtxJobId=... using the existing findJobByMtxId
// lookup (reused as-is; it already returns subject-well keys, which is all
// this tool needs the job lookup for).
notesCrtl.renderUploadHydraulics = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadHydraulics.ejs', {note, user});
};




// ── PAD AC ──────────────────────────────────────────────────────────────────
notesCrtl.savePadAC = async (req, res) => {
  try {
    const { noteId, headers, rows } = req.body;
    if(!noteId || !rows) return res.status(400).json({ error: 'Missing noteId or rows' });
    await PadAC.findOneAndUpdate(
      { noteId },
      { noteId, headers, rows, uploadedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, count: rows.length });
  } catch(err) {
    console.error('savePadAC error:', err);
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.getPadAC = async (req, res) => {
  try {
    const doc = await PadAC.findOne({ noteId: req.params.noteId }).lean();
    res.json(doc || null);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Pason EDR Plots (Avg/Max/Min curves, 1 sheet per plot uploaded as xlsx) ──
notesCrtl.savePasonPlots = async (req, res) => {
  try {
    const { noteId, plots } = req.body;
    if(!noteId || !plots || typeof plots !== 'object') {
      return res.status(400).json({ error: 'Missing noteId or plots' });
    }
    await PasonPlots.findOneAndUpdate(
      { noteId },
      { noteId, plots, user: req.user ? req.user._id : null, uploadedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, plotCount: Object.keys(plots).length });
  } catch(err) {
    console.error('savePasonPlots error:', err);
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.getPasonPlots = async (req, res) => {
  try {
    const doc = await PasonPlots.findOne({ noteId: req.params.noteId }).lean();
    res.json(doc || null);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Torque & Drag Modeler: connect uploadTorqueAndDrag.ejs to a job ──────
// Looks up a job by its MTX Job ID and returns its subject-well/leg
// trajectories (survey only — md/incl/azim, matching the modeler's survey
// table format) so the user can pick a well/leg without leaving the tool.
// Same subject-well rule used everywhere else: explicit wellCategory tag
// first, falling back to the [NN]..._LNN name pattern for legacy data.
notesCrtl.findJobByMtxId = async (req, res) => {
  try {
    const mtxJobId = (req.params.mtxJobId || '').trim();
    if(!mtxJobId) return res.status(400).json({ error: 'Missing MTX Job ID' });

    const allMatches = await Note.find({ mtxJobId }).select('_id title').lean();
    if(!allMatches.length) return res.status(404).json({ error: 'No job found with MTX ID ' + mtxJobId });
    if(allMatches.length > 1) {
      console.warn(`⚠ findJobByMtxId: MTX ID "${mtxJobId}" matches ${allMatches.length} jobs (mtxJobId is not unique): `,
        allMatches.map(n => `${n._id} (${n.title})`).join(', '));
    }
    const note = allMatches[0];
    console.log(`findJobByMtxId: MTX ID "${mtxJobId}" -> noteId ${note._id} ("${note.title}")`);

    const trajectories = await WellboreTrajectory.find({ noteId: note._id }).lean();

    const isSubjectWell = (well) => {
      const wn = (well.wellName || '').trim();
      if(well.wellCategory === 'subject') return true;
      if(well.wellCategory === 'offset') return false;
      return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn);
    };

    const subjectWells = trajectories
      .filter(isSubjectWell)
      .filter(t => t.survey && t.survey.length)
      .map(t => ({
        wellKey: t.wellName,
        survey: t.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim })),
        // ADDED 2026-11-12 (John, correction chain): correction versions (STRETCH/SAG/SC/MSA) copy the subject tag of
        // their well, so they appeared as extra "wells" — and had no T&D model of their own. Flag them + their base
        // well so SAG / PipeStretch list only real wells and take BHAs / runs / sections from the base well.
        isVersion: CORR_SOURCES.indexOf(t.source) >= 0,
        baseWellName: t.baseWellName || (CORR_SOURCES.indexOf(t.source) >= 0 ? '' : t.wellName),
      }));

    res.json({
      noteId: note._id,
      title: note.title,
      mtxJobId,
      duplicateWarning: allMatches.length > 1
        ? `Warning: ${allMatches.length} jobs share MTX ID "${mtxJobId}" — resolved to "${note.title}" (${note._id}). If this isn't the job you expect, its mtxJobId needs to be made unique.`
        : null,
      subjectWells,
    });
  } catch(err) {
    console.error('findJobByMtxId error:', err);
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.getTDModel = async (req, res) => {
  try {
    const doc = await TDModel.findOne({ noteId: req.params.noteId }).lean();
    if(!doc) return res.json(null);
    // Backward-compat: older documents (before the per-well migration) only
    // have the flat wellKey/casings/bha/params/results fields. Synthesize a
    // resultsByWell entry from them so callers can rely on resultsByWell alone.
    if((!doc.resultsByWell || !Object.keys(doc.resultsByWell).length) && doc.wellKey && doc.results){
      doc.resultsByWell = { [doc.wellKey]: {
        casings: doc.casings, bha: doc.bha, params: doc.params, results: doc.results,
        calculatedAt: doc.calculatedAt, calculatedByName: null, calculatedByUserId: doc.user,
      }};
    }
    // Backward-compat: documents saved before scenarios existed only have a
    // top-level resultsByWell and no scenarios/activeScenario yet.
    // Synthesize a single "Default" scenario from it so every reader can
    // treat scenarios as always present.
    if(!doc.scenarios || !Object.keys(doc.scenarios).length){
      doc.scenarios = { Default: { resultsByWell: doc.resultsByWell || {} } };
      doc.activeScenario = 'Default';
    }
    if(!doc.activeScenario || !doc.scenarios[doc.activeScenario]){
      doc.activeScenario = Object.keys(doc.scenarios)[0];
    }
    res.json(doc);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.saveTDModel = async (req, res) => {
  try {
    const { noteId, wellKey, casings, bha, params, results, scenario } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });

    const hasResults = !!(results && results.mds && results.mds.length);
    console.log(`saveTDModel: noteId=${noteId}, wellKey="${wellKey}", casings=${(casings||[]).length}, bha=${(bha||[]).length}, results=${hasResults ? results.mds.length + ' MD points' : 'NONE (results was null/empty — the model likely was not successfully run before saving)'}`);

    // Fetch-modify-save (rather than dot-notation $set) so we never risk a
    // MongoDB key-path issue with well names containing brackets/spaces,
    // and so other wells' saved runs are never touched.
    let doc = await TDModel.findOne({ noteId });
    if(!doc) doc = new TDModel({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });

    // Scenarios are job-wide (shared names across every well). If no
    // scenario is specified, save into whichever is currently active (or
    // "Default" the very first time this job saves anything).
    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});

    // Preserve the previously saved run when this save carries no results
    // (parameter auto-saves POST casings/bha/params continuously; wiping
    // the last computed charts on every keystroke would be wrong). The
    // calculated-at/by stamps stay tied to the run, not the param edit.
    const prev = scenarioResultsByWell[wellKey] || {};
    // 2026-11-15 (John, well structure phase 3): stale T&D page guard — a T&D page opened BEFORE a BHA was edited in the
    // job page Wells accordion would save the old BHA back. A plan run whose BHA / sensor / bend equal the Run's
    // previous values (Run.bhaPrev) is stale: the Run's current values are kept. A BHA changed in T&D itself (different
    // from both) is accepted as a new edit. Never blocks the save.
    let wsKept = [];
    try{ wsKept = await notesCrtl.wsGuardStale(noteId, scenarioName, doc.activeScenario || scenarioName, wellKey, params && params.plan); }catch(e){ console.error('[wellStructure] stale guard', e); }
    scenarioResultsByWell[wellKey] = {
      casings: casings || [],
      bha: bha || [],
      params: params || {},
      results: hasResults ? results : (prev.results || null),
      calculatedAt: hasResults ? new Date() : (prev.calculatedAt || null),
      calculatedByName: hasResults
        ? (req.user ? (req.user.name || req.user.username || '') : '')
        : (prev.calculatedByName || ''),
      calculatedByUserId: hasResults
        ? (req.user ? req.user._id : null)
        : (prev.calculatedByUserId || null),
      paramsSavedAt: new Date(),
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    // Top-level resultsByWell always mirrors the ACTIVE scenario — saving
    // into a non-active scenario updates that scenario without disturbing
    // what job.ejs's accordion currently shows.
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();
    // 2026-11-15 (John): well structure phase 2 — the Run owns the BHA; copy this well's plan runs back to the Runs
    // linked to this scenario (never blocks the T&D save).
    try{ await notesCrtl.wsAfterTDSave(noteId, scenarioName, doc.activeScenario, wellKey, params && params.plan); }catch(e){ console.error('[wellStructure] T&D sync failed', e); }

    res.json({
      success: true, savedResults: hasResults, wellKey, scenario: scenarioName, wsKeptRuns: wsKept,
      activeScenario: doc.activeScenario, calculatedAt: scenarioResultsByWell[wellKey].calculatedAt,
    });
  } catch(err) {
    console.error('saveTDModel error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Recalculates the T&D model for a specific well using the shared
// soft-string calculation module (src/public/js/tdModel.js) — the SAME
// module the browser uses, so results are guaranteed identical to running
// it manually in the modeler. Pulls that well's survey from
// WellboreTrajectory, keeps whatever casings/bha/params are passed in
// (typically "whatever is currently loaded" from job.ejs), computes fresh
// results, and auto-saves them (with who/when) before returning.
notesCrtl.recalculateTDModel = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { wellKey, casings, bha, params, scenario } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });
    if(!casings || !bha || !params) return res.status(400).json({ error: 'Missing casings/bha/params' });

    const traj = await WellboreTrajectory.findOne({ noteId, wellName: wellKey }).lean();
    if(!traj || !traj.survey || !traj.survey.length){
      return res.status(404).json({ error: 'No trajectory survey found for well ' + wellKey + ' on this job.' });
    }

    let surv = traj.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim }))
      .filter(r => !isNaN(r.md) && r.md >= 0)
      .sort((a,b) => a.md - b.md);
    if(surv.length < 2) return res.status(400).json({ error: 'Well ' + wellKey + ' has fewer than 2 survey stations — cannot compute.' });

    // Extend survey to TD if needed, exactly matching runModel()'s behaviour.
    if(surv[surv.length-1].md < params.td){
      const last = surv[surv.length-1];
      surv = surv.concat([{ md: params.td, inc: last.inc, az: last.az }]);
    }

    const res_ = TDModelCore.computeModel(surv, casings, bha, params);
    const traj3d = TDModelCore.minCurvature(surv);
    const hlRes = TDModelCore.computeHookload(surv, casings, bha, params);

    // Metric display units (matching runModel()'s metric branch — this
    // endpoint always computes in metric, same as the CNRL defaults).
    // Force values (Effective Tension, Hook Load) are converted from the
    // raw kN the shared module returns to kDaN (1 kN = 0.1 kDaN), matching
    // the WellPlan-style convention used elsewhere in this app. Side force
    // (kgf/m) and torque (N.m) are unaffected — they're different units.
    const mds = res_.map(r => r.md);
    const results = {
      mds,
      etTI: res_.map(r => r.etTripIn * 0.1), etTO: res_.map(r => r.etTripOut * 0.1),
      etROB: res_.map(r => r.etRotOB * 0.1), etSLD: res_.map(r => r.etSlide * 0.1), etROff: res_.map(r => r.etRotOff * 0.1),
      tqROB: res_.map(r => r.torqRotOB), tqROff: res_.map(r => r.torqRotOff),
      sfROB: res_.map(r => r.sfRotOB), sfSLD: res_.map(r => r.sfSlide), sfROff: res_.map(r => r.sfRotOff),
      sfTO: res_.map(r => r.sfTripOut), sfTI: res_.map(r => r.sfTripIn),
      incArr: res_.map(r => r.inc), dlsArr: res_.map(r => r.dls),
      torqLimDisp: params.torqLim, depU: 'm', forU: 'kDaN', tqU: 'N.m',
      hlMDs: hlRes.map(r => r.md), hlTO: hlRes.map(r => r.hl_tripOut * 0.1),
      hlROB: hlRes.map(r => r.hl_rotOB * 0.1), hlSLD: hlRes.map(r => r.hl_slide * 0.1),
    };

    let doc = await TDModel.findOne({ noteId });
    if(!doc) doc = new TDModel({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });
    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});
    const calculatedAt = new Date();
    scenarioResultsByWell[wellKey] = {
      casings, bha, params, results,
      calculatedAt,
      calculatedByName: req.user ? (req.user.name || req.user.username || '') : '',
      calculatedByUserId: req.user ? req.user._id : null,
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();

    console.log(`recalculateTDModel: noteId=${noteId}, wellKey="${wellKey}", scenario="${scenarioName}" -> ${mds.length} MD points, saved by ${req.user ? req.user.name : 'unknown'} at ${calculatedAt.toISOString()}`);

    res.json({
      success: true, wellKey, results, calculatedAt, scenario: scenarioName, activeScenario: doc.activeScenario,
      calculatedByName: scenarioResultsByWell[wellKey].calculatedByName,
    });
  } catch(err) {
    console.error('recalculateTDModel error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /notes/tdModel/:noteId/scenario/setActive — switch which job-wide
// scenario is "current". Just repoints the top-level resultsByWell mirror
// to that scenario's data; every well's saved run under it becomes what
// job.ejs's accordion and a freshly-opened modeler will show, with no
// re-entry or re-run required.
notesCrtl.setActiveScenario = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { scenario } = req.body;
    if(!scenario) return res.status(400).json({ error: 'Missing scenario name' });
    const doc = await TDModel.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No T&D model found for this job' });
    if(!doc.scenarios || !doc.scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    doc.activeScenario = scenario;
    doc.resultsByWell = doc.scenarios[scenario].resultsByWell || {};
    doc.markModified('resultsByWell');
    await doc.save();
    res.json({ success: true, activeScenario: scenario });
  } catch(err) {
    console.error('setActiveScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /notes/tdModel/:noteId/scenario/:scenario
notesCrtl.deleteScenario = async (req, res) => {
  try {
    const { noteId, scenario } = req.params;
    const doc = await TDModel.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No T&D model found for this job' });
    const scenarios = Object.assign({}, doc.scenarios || {});
    if(!scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    const names = Object.keys(scenarios);
    if(names.length <= 1) return res.status(400).json({ error: 'Cannot delete the only remaining scenario.' });
    delete scenarios[scenario];
    doc.scenarios = scenarios;
    if(doc.activeScenario === scenario){
      doc.activeScenario = Object.keys(scenarios)[0];
      doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell || {};
      doc.markModified('resultsByWell');
    }
    doc.markModified('scenarios');
    await doc.save();
    res.json({ success: true, activeScenario: doc.activeScenario, remaining: Object.keys(scenarios) });
  } catch(err) {
    console.error('deleteScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================================================
// BIT HYDRAULICS PROGRAM — ported from the legacy Hydraulics.xls VBA macro.
// Follows the exact same per-well/per-scenario save pattern as the T&D
// Model above (see notes there); physics lives in the ONE shared module
// src/public/js/hydraulicsModel.js (Bourgoyne 1986 — cited in that file's
// header), used by both this controller and the browser.
// ============================================================================

notesCrtl.getHydraulicsModel = async (req, res) => {
  try {
    const doc = await HydraulicsModel.findOne({ noteId: req.params.noteId }).lean();
    if(!doc) return res.json(null);
    if(!doc.scenarios || !Object.keys(doc.scenarios).length){
      doc.scenarios = { Default: { resultsByWell: doc.resultsByWell || {} } };
      doc.activeScenario = 'Default';
    }
    if(!doc.activeScenario || !doc.scenarios[doc.activeScenario]){
      doc.activeScenario = Object.keys(doc.scenarios)[0];
    }
    res.json(doc);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.saveHydraulicsModel = async (req, res) => {
  try {
    const { noteId, wellKey, drillString, annulusGeom, params, results, scenario } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });

    const hasResults = !!(results && results.pressureLoss_kPa);
    console.log(`saveHydraulicsModel: noteId=${noteId}, wellKey="${wellKey}", drillString=${(drillString||[]).length}, annulusGeom=${(annulusGeom||[]).length}, results=${hasResults ? 'present' : 'NONE (params-only auto-save)'}`);

    // Fetch-modify-save, same reasoning as saveTDModel: avoids dot-notation
    // key-path issues with well names, never disturbs other wells' runs.
    let doc = await HydraulicsModel.findOne({ noteId });
    if(!doc) doc = new HydraulicsModel({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });

    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});

    // Preserve the previously computed results when this save carries none
    // (params auto-save continuously as the operator edits the form).
    const prev = scenarioResultsByWell[wellKey] || {};
    scenarioResultsByWell[wellKey] = {
      drillString: drillString || [],
      annulusGeom: annulusGeom || [],
      params: params || {},
      results: hasResults ? results : (prev.results || null),
      calculatedAt: hasResults ? new Date() : (prev.calculatedAt || null),
      calculatedByName: hasResults
        ? (req.user ? (req.user.name || req.user.username || '') : '')
        : (prev.calculatedByName || ''),
      calculatedByUserId: hasResults
        ? (req.user ? req.user._id : null)
        : (prev.calculatedByUserId || null),
      paramsSavedAt: new Date(),
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();

    res.json({
      success: true, savedResults: hasResults, wellKey, scenario: scenarioName,
      activeScenario: doc.activeScenario, calculatedAt: scenarioResultsByWell[wellKey].calculatedAt,
    });
  } catch(err) {
    console.error('saveHydraulicsModel error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Recomputes the hydraulics model for a specific well using the shared
// calculation module (src/public/js/hydraulicsModel.js) — the SAME module
// the browser uses, so results match a manual run exactly. Keeps whatever
// drillString/annulusGeom/params are passed in and auto-saves the fresh
// results (with who/when) before returning, mirroring recalculateTDModel.
notesCrtl.recalculateHydraulicsModel = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { wellKey, drillString, annulusGeom, params, scenario } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });
    if(!drillString || !annulusGeom || !params) return res.status(400).json({ error: 'Missing drillString/annulusGeom/params' });

    const results = HydraulicsModelCore.computeHydraulics(drillString, annulusGeom, params);

    let doc = await HydraulicsModel.findOne({ noteId });
    if(!doc) doc = new HydraulicsModel({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });
    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});
    const calculatedAt = new Date();
    scenarioResultsByWell[wellKey] = {
      drillString, annulusGeom, params, results,
      calculatedAt,
      calculatedByName: req.user ? (req.user.name || req.user.username || '') : '',
      calculatedByUserId: req.user ? req.user._id : null,
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();

    console.log(`recalculateHydraulicsModel: noteId=${noteId}, wellKey="${wellKey}", scenario="${scenarioName}", warnings=${(results.warnings||[]).length}, saved by ${req.user ? req.user.name : 'unknown'} at ${calculatedAt.toISOString()}`);

    res.json({
      success: true, wellKey, results, calculatedAt, scenario: scenarioName, activeScenario: doc.activeScenario,
      calculatedByName: scenarioResultsByWell[wellKey].calculatedByName,
    });
  } catch(err) {
    console.error('recalculateHydraulicsModel error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /notes/hydraulicsModel/:noteId/scenario/setActive
notesCrtl.setActiveHydraulicsScenario = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { scenario } = req.body;
    if(!scenario) return res.status(400).json({ error: 'Missing scenario name' });
    const doc = await HydraulicsModel.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No Hydraulics model found for this job' });
    if(!doc.scenarios || !doc.scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    doc.activeScenario = scenario;
    doc.resultsByWell = doc.scenarios[scenario].resultsByWell || {};
    doc.markModified('resultsByWell');
    await doc.save();
    res.json({ success: true, activeScenario: scenario });
  } catch(err) {
    console.error('setActiveHydraulicsScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /notes/hydraulicsModel/:noteId/scenario/:scenario
notesCrtl.deleteHydraulicsScenario = async (req, res) => {
  try {
    const { noteId, scenario } = req.params;
    const doc = await HydraulicsModel.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No Hydraulics model found for this job' });
    const scenarios = Object.assign({}, doc.scenarios || {});
    if(!scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    const names = Object.keys(scenarios);
    if(names.length <= 1) return res.status(400).json({ error: 'Cannot delete the only remaining scenario.' });
    delete scenarios[scenario];
    doc.scenarios = scenarios;
    if(doc.activeScenario === scenario){
      doc.activeScenario = Object.keys(scenarios)[0];
      doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell || {};
      doc.markModified('resultsByWell');
    }
    doc.markModified('scenarios');
    await doc.save();
    res.json({ success: true, activeScenario: doc.activeScenario, remaining: Object.keys(scenarios) });
  } catch(err) {
    console.error('deleteHydraulicsScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};


// ============================================================================
// CASING DESIGN MODULE — Simple Method load cases + triaxial (VME) check.
// Follows the exact same per-well/per-scenario save pattern as the T&D
// Model and Bit Hydraulics Program above; physics lives in the shared
// modules src/public/js/casingModel.js (pipe capacity ratings + triaxial)
// and src/public/js/casingLoadCases.js (Simple Method load-case builder,
// sourced from this well's "Casing Design Foundation" doc), used by both
// this controller and the browser.
// ============================================================================

notesCrtl.renderUploadCasingDesign = async(req,res)=>{
    let user = {};
    if(req.session && req.session.passport){
        user.id = req.session.passport.user;
        let usuario = await User.findById(user.id);
        user.role = usuario.role; user.rank = usuario.rank; user.name = usuario.name;
    }
    const mtxJobId = req.query.mtxJobId || '';
    let note = null;
    if(mtxJobId) note = await Note.findOne({ mtxJobId });
    res.render('uploadCasingDesign.ejs', {note, user});
};

notesCrtl.getCasingDesign = async (req, res) => {
  try {
    const doc = await CasingDesign.findOne({ noteId: req.params.noteId }).lean();
    if(!doc) return res.json(null);
    if(!doc.scenarios || !Object.keys(doc.scenarios).length){
      doc.scenarios = { Default: { resultsByWell: doc.resultsByWell || {} } };
      doc.activeScenario = 'Default';
    }
    if(!doc.activeScenario || !doc.scenarios[doc.activeScenario]){
      doc.activeScenario = Object.keys(doc.scenarios)[0];
    }
    res.json(doc);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

notesCrtl.saveCasingDesign = async (req, res) => {
  try {
    const { noteId, wellKey, casingStrings, loadParams, results, scenario } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });

    const hasResults = !!(results && results.byString);
    console.log(`saveCasingDesign: noteId=${noteId}, wellKey="${wellKey}", casingStrings=${(casingStrings||[]).length}, results=${hasResults ? 'present' : 'NONE (params-only auto-save)'}`);

    let doc = await CasingDesign.findOne({ noteId });
    if(!doc) doc = new CasingDesign({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });

    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});

    const prev = scenarioResultsByWell[wellKey] || {};
    scenarioResultsByWell[wellKey] = {
      casingStrings: casingStrings || [],
      loadParams: loadParams || {},
      results: hasResults ? results : (prev.results || null),
      calculatedAt: hasResults ? new Date() : (prev.calculatedAt || null),
      calculatedByName: hasResults
        ? (req.user ? (req.user.name || req.user.username || '') : '')
        : (prev.calculatedByName || ''),
      calculatedByUserId: hasResults
        ? (req.user ? req.user._id : null)
        : (prev.calculatedByUserId || null),
      paramsSavedAt: new Date(),
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();

    res.json({
      success: true, savedResults: hasResults, wellKey, scenario: scenarioName,
      activeScenario: doc.activeScenario, calculatedAt: scenarioResultsByWell[wellKey].calculatedAt,
    });
  } catch(err) {
    console.error('saveCasingDesign error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Recomputes the casing design for a specific well using the shared
// calculation modules (casingModel.js + casingLoadCases.js) — the SAME
// modules the browser uses, so results match a manual run exactly.
notesCrtl.recalculateCasingDesign = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { wellKey, casingStrings, loadParams, scenario, dfOverride } = req.body;
    if(!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if(!wellKey) return res.status(400).json({ error: 'Missing wellKey' });
    if(!casingStrings || !casingStrings.length) return res.status(400).json({ error: 'Missing casingStrings' });

    const results = CasingLoadCasesCore.computeCasingDesign(casingStrings, loadParams || {}, { dfOverride });

    let doc = await CasingDesign.findOne({ noteId });
    if(!doc) doc = new CasingDesign({ noteId, resultsByWell: {}, scenarios: {}, activeScenario: '' });
    const scenarios = doc.scenarios ? Object.assign({}, doc.scenarios) : {};
    const scenarioName = scenario || doc.activeScenario || 'Default';
    const scenarioResultsByWell = Object.assign({}, (scenarios[scenarioName] && scenarios[scenarioName].resultsByWell) || {});
    const calculatedAt = new Date();
    scenarioResultsByWell[wellKey] = {
      casingStrings, loadParams: loadParams || {}, dfOverride: dfOverride || null, results,
      calculatedAt,
      calculatedByName: req.user ? (req.user.name || req.user.username || '') : '',
      calculatedByUserId: req.user ? req.user._id : null,
    };
    scenarios[scenarioName] = { resultsByWell: scenarioResultsByWell };
    doc.scenarios = scenarios;
    if(!doc.activeScenario || !scenarios[doc.activeScenario]) doc.activeScenario = scenarioName;
    doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell;
    doc.markModified('scenarios');
    doc.markModified('resultsByWell');
    await doc.save();

    console.log(`recalculateCasingDesign: noteId=${noteId}, wellKey="${wellKey}", scenario="${scenarioName}", strings=${casingStrings.length}, saved by ${req.user ? req.user.name : 'unknown'} at ${calculatedAt.toISOString()}`);

    res.json({
      success: true, wellKey, results, calculatedAt, scenario: scenarioName, activeScenario: doc.activeScenario,
      calculatedByName: scenarioResultsByWell[wellKey].calculatedByName,
    });
  } catch(err) {
    console.error('recalculateCasingDesign error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /notes/casingDesign/:noteId/scenario/setActive
notesCrtl.setActiveCasingDesignScenario = async (req, res) => {
  try {
    const noteId = req.params.noteId;
    const { scenario } = req.body;
    if(!scenario) return res.status(400).json({ error: 'Missing scenario name' });
    const doc = await CasingDesign.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No Casing Design model found for this job' });
    if(!doc.scenarios || !doc.scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    doc.activeScenario = scenario;
    doc.resultsByWell = doc.scenarios[scenario].resultsByWell || {};
    doc.markModified('resultsByWell');
    await doc.save();
    res.json({ success: true, activeScenario: scenario });
  } catch(err) {
    console.error('setActiveCasingDesignScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /notes/casingDesign/:noteId/scenario/:scenario
notesCrtl.deleteCasingDesignScenario = async (req, res) => {
  try {
    const { noteId, scenario } = req.params;
    const doc = await CasingDesign.findOne({ noteId });
    if(!doc) return res.status(404).json({ error: 'No Casing Design model found for this job' });
    const scenarios = Object.assign({}, doc.scenarios || {});
    if(!scenarios[scenario]) return res.status(404).json({ error: 'Scenario "' + scenario + '" not found' });
    const names = Object.keys(scenarios);
    if(names.length <= 1) return res.status(400).json({ error: 'Cannot delete the only remaining scenario.' });
    delete scenarios[scenario];
    doc.scenarios = scenarios;
    if(doc.activeScenario === scenario){
      doc.activeScenario = Object.keys(scenarios)[0];
      doc.resultsByWell = scenarios[doc.activeScenario].resultsByWell || {};
      doc.markModified('resultsByWell');
    }
    doc.markModified('scenarios');
    await doc.save();
    res.json({ success: true, activeScenario: doc.activeScenario, remaining: Object.keys(scenarios) });
  } catch(err) {
    console.error('deleteCasingDesignScenario error:', err);
    res.status(500).json({ error: err.message });
  }
};


// ── Banner ──────────────────────────────────────────────────────────────────
notesCrtl.renderBanner = async (req, res) => {
    try {
        const cfg = await SiteConfig.findOne({ key: 'bannerUrl' }).lean();
        res.render('banner.ejs', {
            user: req.user,
            bannerUrl: cfg ? cfg.value : '',
        });
    } catch(e) {
        console.error('renderBanner:', e);
        res.status(500).send(e.message);
    }
};

notesCrtl.saveBanner = async (req, res) => {
    // Manual-URL path (kept as a fallback). CHANGED 2026-10-06: if the previous
    // banner was one we uploaded to Cloudinary (bannerPublicId set), delete it
    // there and clear bannerPublicId, so Cloudinary doesn't collect orphans.
    try {
        const { bannerUrl } = req.body;
        await destroyStoredBannerImage();
        await setSiteConfig('bannerPublicId', '', req.user._id);
        await setSiteConfig('bannerUrl', bannerUrl || '', req.user._id);
        res.json({ success: true });
    } catch(e) {
        console.error('saveBanner:', e);
        res.status(500).json({ error: e.message });
    }
};

// ADDED 2026-10-06: one-button banner upload. Before this, the user had to
// upload the picture to Cloudinary by hand and paste its URL here. Now the
// browser POSTs the file (multipart field "image", picked up by the global
// multer middleware in server.js, same as job.ejs uploadImage), the backend
// uploads it to Cloudinary, stores URL + public_id in SiteConfig (MongoDB),
// deletes the previous uploaded banner from Cloudinary, and removes the temp
// file from public/img/uploads.
async function setSiteConfig(key, value, userId) {
    return SiteConfig.findOneAndUpdate(
        { key },
        { key, value: value || '', updatedBy: userId, updatedAt: new Date() },
        { upsert: true, new: true }
    );
}
async function destroyStoredBannerImage() {
    const cfg = await SiteConfig.findOne({ key: 'bannerPublicId' }).lean();
    if (cfg && cfg.value) {
        try { await cloudinary.v2.uploader.destroy(cfg.value); }
        catch (e) { console.error('destroyStoredBannerImage (non-fatal):', e.message); }
    }
}

notesCrtl.uploadBanner = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file received.' });
    try {
        if (!/^image\//.test(req.file.mimetype || '')) {
            return res.status(400).json({ error: 'File must be an image (PNG, JPG, GIF, WEBP...).' });
        }
        const result = await cloudinary.v2.uploader.upload(req.file.path, { folder: 'mtx-banner' });
        // Only remove the old banner after the new one uploaded successfully.
        await destroyStoredBannerImage();
        await setSiteConfig('bannerUrl', result.secure_url, req.user._id);
        await setSiteConfig('bannerPublicId', result.public_id, req.user._id);
        res.json({ success: true, bannerUrl: result.secure_url });
    } catch (e) {
        console.error('uploadBanner:', e);
        res.status(500).json({ error: e.message });
    } finally {
        try { await unlink(req.file.path); } catch (_) { /* temp file already gone */ }
    }
};


// ── Delete Log Entry ─────────────────────────────────────────────────────────
notesCrtl.deleteLogEntry = async (req, res) => {
    try {
        const Log = require('../models/LogConveyor');
        await Log.findByIdAndDelete(req.params.logId);
        res.json({ success: true });
    } catch(e) {
        console.error('deleteLogEntry:', e);
        res.status(500).json({ error: e.message });
    }
};


// ── Batch Days (Gantt stretch) ────────────────────────────────────────────────
notesCrtl.saveBatchDays = async (req, res) => {
    try {
        const { batchDays } = req.body;
        const days = Number(batchDays);
        if (isNaN(days) || days < 0) {
            return res.status(400).json({ error: 'batchDays must be a non-negative number' });
        }
        await Note.findByIdAndUpdate(req.params.noteId, { batchDays: days });
        res.json({ success: true, batchDays: days });
    } catch(e) {
        console.error('saveBatchDays:', e);
        res.status(500).json({ error: e.message });
    }
};


// ── New Schedule (single-document raw passthrough) ──────────────────────────
notesCrtl.renderUploadNewSchedule = async (req, res) => {
    res.render('uploadNewSchedule.ejs', { user: req.user });
};

notesCrtl.uploadNewSchedule = async (req, res) => {
    try {
        const { headers, rows } = req.body;
        if (!Array.isArray(headers) || !headers.length) {
            return res.status(400).json({ error: "No headers received" });
        }
        if (!Array.isArray(rows) || !rows.length) {
            return res.status(400).json({ error: "No data rows received" });
        }

        // Single document — always replace whatever was there before.
        // No batch IDs, no per-row documents, nothing to go stale or drift.
        await NewSchedule.deleteMany({});
        await NewSchedule.create({
            headers,
            rows,
            user: req.user ? req.user._id : null,
            uploadedAt: new Date(),
        });

        console.log(`uploadNewSchedule: saved 1 document with ${rows.length} rows, ${headers.length} columns`);
        // 2026-11-25 (John): refresh every job's Primary Zone from the new schedule (only changed values are written)
        let zonesUpdated = 0; try { zonesUpdated = await syncPrimaryZones({ headers, rows }); } catch(e){ console.error('syncPrimaryZones:', e); }
        res.json({ success: true, rows: rows.length, columns: headers.length, zonesUpdated });
    } catch (e) {
        console.error("uploadNewSchedule error:", e);
        res.status(500).json({ error: e.message });
    }
};

module.exports = notesCrtl;


// ---------------------------------------------------------------------
// Wellbore 3D Trajectories (per job/note)
// ---------------------------------------------------------------------

// POST /notes/wellboreTrajectory/upload/:id  (id = noteId)
notesCrtl.uploadWellboreTrajectory = async (req, res) => {
  try{
    const noteId = req.params.id;
    const { data, wellCategory, toolcode, designation } = req.body;

    if(!noteId){
      return res.status(400).json({ error: "Missing note id" });
    }
    if(!data || !Array.isArray(data) || data.length === 0){
      return res.status(400).json({ error: "No wellbore trajectory data received" });
    }

    const note = await Note.findById(noteId);
    if(!note){
      return res.status(404).json({ error: "Job not found" });
    }

    // wellCategory comes from the "Subject Wells / Offset Wells" toggle next
    // to the folder picker — applies to the whole batch being uploaded,
    // unless an individual well object explicitly overrides it.
    const batchCategory = (wellCategory === 'subject' || wellCategory === 'offset') ? wellCategory : '';
    // Default ISCWSA toolcode for this upload batch (Anti-collision Plots
    // accordion). Applied via $setOnInsert below — only takes effect for
    // brand-new wells, never overwrites a toolcode someone already set
    // individually via the tree UI or the AC Plots dropdown when
    // re-uploading updated survey data for an existing well.
    const batchToolcode = (typeof toolcode === 'string') ? toolcode : '';

    // 2026-11-15 (John, well structure A): Plan / Actual chosen at upload (subject wells only; offset wells stay '').
    // planVersion: "[P5-2188]" in the pad text -> "P5"; else a version label like "P5" / "Plan 5" -> "P5".
    const batchDesig = designation === 'actual' ? 'actual' : designation === 'plan' ? 'plan' : '';
    const planVer = (pad, label) => { const m = /\[\s*(P\d+)\s*[-\]]/i.exec(pad || '') || /^\s*P(?:lan)?\s*(\d+)\s*$/i.exec(label || '');
        return m ? (m[1].toUpperCase().startsWith('P') ? m[1].toUpperCase() : 'P' + m[1]) : ''; };
    const docs = data.map(well => ({
      noteId: noteId,
      wellName: well.wellName || "",
      source: well.source || "",
      pad: well.pad || "",
      colorHex: well.colorHex || "",
      wellCategory: (well.wellCategory === 'subject' || well.wellCategory === 'offset') ? well.wellCategory : batchCategory,
      designation: ((well.wellCategory || batchCategory) === 'offset') ? '' : batchDesig,
      planVersion: ((well.wellCategory || batchCategory) !== 'offset' && batchDesig === 'plan') ? planVer(well.pad, well.source) : '',
      surveyCount: well.surveyCount || (well.survey ? well.survey.length : 0),
      survey: well.survey || [],
      user: req.user ? req.user._id : null,
      uploadedDate: new Date(),
    }));

    // Upsert by noteId + wellName + source so re-uploading the same wells updates them
    const ops = docs.map(doc => ({
      updateOne: {
        filter: { noteId: doc.noteId, wellName: doc.wellName, source: doc.source },
        update: { $set: doc, $setOnInsert: { toolcode: batchToolcode } },
        upsert: true,
      }
    }));

    const result = await WellboreTrajectory.bulkWrite(ops);

    console.log("<<<< WellboreTrajectory uploaded for note " + noteId + " >>>>");
    res.json({ success: true, count: docs.length, result });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// DELETE /notes/wellboreTrajectory/:id  (id = WellboreTrajectory document _id)
notesCrtl.deleteWellboreTrajectory = async (req, res) => {
  try{
    const trajectoryId = req.params.id;
    const deleted = await WellboreTrajectory.findByIdAndDelete(trajectoryId);
    if(!deleted){
      return res.status(404).json({ error: "Trajectory not found" });
    }
    res.json({ success: true });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// POST /notes/wellboreTrajectory/:id/toolcode — persist the ISCWSA MWD
// Rev5 toolcode selected for this well in the Anti-collision Plots
// accordion, so it's remembered next time this job's trajectories load.
notesCrtl.setWellboreTrajectoryToolcode = async (req, res) => {
  try{
    const trajectoryId = req.params.id;
    const { toolcode } = req.body;
    const updated = await WellboreTrajectory.findByIdAndUpdate(
      trajectoryId, { toolcode: toolcode || '' }, { new: true }
    ).select('wellName toolcode');
    if(!updated){
      return res.status(404).json({ error: "Trajectory not found" });
    }
    res.json({ success: true, wellName: updated.wellName, toolcode: updated.toolcode });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// POST /notes/wellboreTrajectory/pad/:noteId/:pad/toolcode — bulk-apply an
// ISCWSA toolcode to every well in one pad at once (mirrors the pad-scoped
// delete route). This is the primary way to set toolcodes in practice,
// since a whole pad is normally drilled with the same MWD/BHA program;
// setWellboreTrajectoryToolcode above remains available for one-off
// per-well overrides.
notesCrtl.setWellboreTrajectoryPadToolcode = async (req, res) => {
  try{
    const { noteId, pad } = req.params;
    const { toolcode } = req.body;
    const result = await WellboreTrajectory.updateMany(
      { noteId, pad },
      { $set: { toolcode: toolcode || '' } }
    );
    res.json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// DELETE /notes/wellboreTrajectory/all/:noteId — delete every trajectory for a job
notesCrtl.deleteAllWellboreTrajectories = async (req, res) => {
  try{
    const noteId = req.params.noteId;
    const result = await WellboreTrajectory.deleteMany({ noteId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// DELETE /notes/wellboreTrajectory/pad/:noteId/:pad — delete every well/version under one pad
notesCrtl.deleteWellboreTrajectoryPad = async (req, res) => {
  try{
    const { noteId, pad } = req.params;
    const result = await WellboreTrajectory.deleteMany({ noteId, pad });
    res.json({ success: true, deleted: result.deletedCount });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// DELETE /notes/wellboreTrajectory/group/:noteId/:pad/:source — delete one
// version (upload batch) of a pad, leaving other versions/pads untouched.
notesCrtl.deleteWellboreTrajectoryGroup = async (req, res) => {
  try{
    const { noteId, pad, source } = req.params;
    const result = await WellboreTrajectory.deleteMany({ noteId, pad, source });
    res.json({ success: true, deleted: result.deletedCount });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// GET /notes/wellboreTrajectory/list/:id  (id = noteId) - metadata only (no survey points)
notesCrtl.listWellboreTrajectories = async (req, res) => {
  try{
    const noteId = req.params.id;
    const trajectories = await WellboreTrajectory.find({noteId}).select('-survey').sort({wellName: 1});
    res.json({ success: true, trajectories });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// ---------------------------------------------------------------------
// FracPlane CRUD  (fracPlanes sub-array inside WellboreTrajectory)
// ---------------------------------------------------------------------

// Linear interpolation of position AND tangent at a given MD.
// Position: interpolated Northing/Easting/TVD → viewer world coords.
// Tangent: interpolated incl/azim → direction cosines in viewer frame.
//   tx =  sin(incl)*sin(azim)   (Easting / +X)
//   ty = -cos(incl)              (-TVD   / +Y going down)
//   tz = -sin(incl)*cos(azim)   (-North / +Z)
// Source: standard wellbore direction cosine convention (SPE/ISCWSA).
function interpolateSurveyAtMD(survey, targetMD){
  const D2R = Math.PI / 180;
  if(!survey || survey.length === 0) return { center:{x:0,y:0,z:0}, tangent:{x:0,y:-1,z:0} };

  function toResult(s){
    const incl = (s.incl || 0) * D2R, azim = (s.azim || 0) * D2R;
    return {
      // 2026-10-21: 3D vertical axis is now Sub-Sea elevation (job.ejs also recomputes on render)
      center: { x: s.easting, y: (s.subSea != null && s.subSea !== '') ? Number(s.subSea) : -s.tvd, z: -s.northing },
      tangent: {
        x:  Math.sin(incl) * Math.sin(azim),
        y: -Math.cos(incl),
        z: -Math.sin(incl) * Math.cos(azim),
      },
    };
  }

  const n = Number(targetMD);
  if(n <= survey[0].md) return toResult(survey[0]);
  if(n >= survey[survey.length-1].md) return toResult(survey[survey.length-1]);

  for(let i = 1; i < survey.length; i++){
    const s0 = survey[i-1], s1 = survey[i];
    if(n >= s0.md && n <= s1.md){
      const dMD = s1.md - s0.md;
      const t = dMD === 0 ? 0 : (n - s0.md) / dMD;
      const east   = s0.easting  + t * (s1.easting  - s0.easting);
      const tvd    = s0.tvd      + t * (s1.tvd      - s0.tvd);
      const north  = s0.northing + t * (s1.northing - s0.northing);
      const incl   = ((s0.incl || 0) + t * ((s1.incl || 0) - (s0.incl || 0))) * D2R;
      const azim   = ((s0.azim || 0) + t * ((s1.azim || 0) - (s0.azim || 0))) * D2R;
      return {
        // 2026-10-21: Sub-Sea elevation when both stations carry it (job.ejs recomputes on render anyway)
        center: { x: east, y: (s0.subSea != null && s1.subSea != null && s0.subSea !== '' && s1.subSea !== '') ? (Number(s0.subSea) + t * (Number(s1.subSea) - Number(s0.subSea))) : -tvd, z: -north },
        tangent: {
          x:  Math.sin(incl) * Math.sin(azim),
          y: -Math.cos(incl),
          z: -Math.sin(incl) * Math.cos(azim),
        },
      };
    }
  }
  return toResult(survey[survey.length-1]);
}

// POST /notes/fracPlane/:trajectoryId  — add a new fracPlane
notesCrtl.addFracPlane = async (req, res) => {
  try{
    const { trajectoryId } = req.params;
    const { label, geometry, md, dx, dy, dz, ax, ay, az, radius, distance } = req.body;

    const traj = await WellboreTrajectory.findById(trajectoryId);
    if(!traj) return res.status(404).json({ error: "Trajectory not found" });

    const { center, tangent } = interpolateSurveyAtMD(traj.survey, Number(md));

    const newFP = {
      label: label || "", geometry: geometry || 'box',
      md: Number(md),
      dx: Number(dx)||10, dy: Number(dy)||10, dz: Number(dz)||10,
      ax: Number(ax)||0,  ay: Number(ay)||0,  az: Number(az)||0,
      radius: Number(radius)||10, distance: Number(distance)||30,
      center, tangent, createdAt: new Date(),
    };

    traj.fracPlanes.push(newFP);
    await traj.save();

    const saved = traj.fracPlanes[traj.fracPlanes.length - 1];
    console.log(`<<<< FracPlane added to ${traj.wellName} >>>>`);
    res.json({ success: true, fracPlane: saved });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /notes/fracPlane/:trajectoryId/:fracPlaneId  — update a fracPlane
notesCrtl.updateFracPlane = async (req, res) => {
  try{
    const { trajectoryId, fracPlaneId } = req.params;
    const { label, geometry, md, dx, dy, dz, ax, ay, az, radius, distance } = req.body;

    const traj = await WellboreTrajectory.findById(trajectoryId);
    if(!traj) return res.status(404).json({ error: "Trajectory not found" });

    const fp = traj.fracPlanes.id(fracPlaneId);
    if(!fp) return res.status(404).json({ error: "FracPlane not found" });

    const { center, tangent } = interpolateSurveyAtMD(traj.survey, Number(md));

    fp.label    = label !== undefined ? label : fp.label;
    fp.geometry = geometry || fp.geometry;
    fp.md       = Number(md);
    fp.dx = Number(dx)||10; fp.dy = Number(dy)||10; fp.dz = Number(dz)||10;
    fp.ax = Number(ax)||0;  fp.ay = Number(ay)||0;  fp.az = Number(az)||0;
    fp.radius   = Number(radius)||10;
    fp.distance = Number(distance)||30;
    fp.center   = center;
    fp.tangent  = tangent;

    await traj.save();
    console.log(`<<<< FracPlane updated in ${traj.wellName} >>>>`);
    res.json({ success: true, fracPlane: fp });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /notes/fracPlane/:trajectoryId/:fracPlaneId  — delete a fracPlane
notesCrtl.deleteFracPlane = async (req, res) => {
  try{
    const { trajectoryId, fracPlaneId } = req.params;

    const traj = await WellboreTrajectory.findById(trajectoryId);
    if(!traj) return res.status(404).json({ error: "Trajectory not found" });

    traj.fracPlanes.pull({ _id: fracPlaneId });
    await traj.save();

    console.log(`<<<< FracPlane deleted from ${traj.wellName} >>>>`);
    res.json({ success: true });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
// ---------------------------------------------------------------------
// Polyline CRUD (2026-08-25) — closed map-view outlines (Northing/Easting,
// e.g. an imported channel/geobody extent), extruded between two TVDss
// depths into a solid volume in the Wellbore 3D Trajectory viewer. Kept in
// their own top-level collection (not a WellboreTrajectory sub-array like
// fracPlanes) since a Polyline isn't tied to any one wellbore — it's a
// job-level geographic feature, keyed only by noteId.
// ---------------------------------------------------------------------

// If the uploaded points aren't already a closed loop (first point ==
// last point), close it by appending a copy of the first point — per the
// person's direction (2026-08-25), rather than rejecting the upload.
function closePolylineLoop(points){
  if(!Array.isArray(points) || points.length < 3) return points || [];
  const first = points[0], last = points[points.length - 1];
  const alreadyClosed = Math.abs(first.northing - last.northing) < 1e-9
                     && Math.abs(first.easting  - last.easting)  < 1e-9;
  return alreadyClosed ? points : [...points, { northing: first.northing, easting: first.easting }];
}

// GET /notes/polyline/list/:noteId
notesCrtl.listPolylines = async (req, res) => {
  try{
    const noteId = req.params.noteId;
    const polylines = await Polyline.find({noteId}).sort({createdAt: 1});
    res.json({ success: true, polylines });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// POST /notes/polyline/:noteId — add a new Polyline
notesCrtl.addPolyline = async (req, res) => {
  try{
    const { noteId } = req.params;
    const { name, points, tvdFrom, tvdTo, colorHex, displayStyle } = req.body;

    if(!Array.isArray(points) || points.length < 3){
      return res.status(400).json({ error: "A polyline needs at least 3 points." });
    }
    const from = Number(tvdFrom), to = Number(tvdTo);
    if(!Number.isFinite(from) || !Number.isFinite(to)){
      return res.status(400).json({ error: "TVDss From/To must be numbers." });
    }
    const validStyles = ['solid', 'wireframe', 'lines'];

    const doc = await Polyline.create({
      noteId,
      name: name || "",
      points: closePolylineLoop(points),
      tvdFrom: Math.min(from, to),
      tvdTo:   Math.max(from, to),
      colorHex: colorHex || "#ff0000",
      displayStyle: validStyles.includes(displayStyle) ? displayStyle : 'solid',
      user: req.session.passport.user,
      createdAt: new Date(),
    });

    console.log(`<<<< Polyline added to note ${noteId} >>>>`);
    res.json({ success: true, polyline: doc });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// PUT /notes/polyline/:polylineId — update a Polyline
notesCrtl.updatePolyline = async (req, res) => {
  try{
    const { polylineId } = req.params;
    const { name, points, tvdFrom, tvdTo, colorHex, displayStyle } = req.body;

    const doc = await Polyline.findById(polylineId);
    if(!doc) return res.status(404).json({ error: "Polyline not found" });

    if(name !== undefined) doc.name = name;
    if(Array.isArray(points) && points.length >= 3) doc.points = closePolylineLoop(points);
    if(tvdFrom !== undefined && tvdTo !== undefined){
      const from = Number(tvdFrom), to = Number(tvdTo);
      if(Number.isFinite(from) && Number.isFinite(to)){
        doc.tvdFrom = Math.min(from, to);
        doc.tvdTo   = Math.max(from, to);
      }
    }
    if(colorHex) doc.colorHex = colorHex;
    if(['solid', 'wireframe', 'lines'].includes(displayStyle)) doc.displayStyle = displayStyle;

    await doc.save();
    console.log(`<<<< Polyline updated (${polylineId}) >>>>`);
    res.json({ success: true, polyline: doc });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /notes/polyline/:polylineId — delete a Polyline
notesCrtl.deletePolyline = async (req, res) => {
  try{
    const { polylineId } = req.params;
    const result = await Polyline.deleteOne({_id: polylineId});
    if(!result.deletedCount) return res.status(404).json({ error: "Polyline not found" });
    console.log(`<<<< Polyline deleted (${polylineId}) >>>>`);
    res.json({ success: true });
  } catch(error){
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

// ── iPlan scenarios (ADDED 2026-10-10, iPlan step 4) ─────────────────────────
// Job-level CRUD, same pattern as the Polyline routes above. Any signed-in
// user can read/create/edit/delete (scenarios are shared on the job, like
// Polylines). Only whitelisted design fields are accepted from the client.
const IPLAN_FIELDS = ['name', 'startMode', 'wellId', 'tieMd', 'start', 'sections', 'targets', 'toolcode', 'group']; // 'group' added 2026-10-12 (iPad)
function iplanPick(body){
  const out = {};
  IPLAN_FIELDS.forEach(k => { if(body && body[k] !== undefined) out[k] = body[k]; });
  if(out.sections && !Array.isArray(out.sections)) delete out.sections;
  if(out.targets && !Array.isArray(out.targets)) delete out.targets;
  return out;
}
function iplanUserName(req){ return (req.user && (req.user.name || req.user.email)) || ''; }

notesCrtl.listIPlanScenarios = async (req, res) => {
  try {
    const list = await IPlanScenario.find({ noteId: req.params.noteId }).sort({ createdAt: 1 }).lean();
    res.json(list);
  } catch(error){ console.error('listIPlanScenarios:', error); res.status(500).json({ error: error.message }); }
};

notesCrtl.addIPlanScenario = async (req, res) => {
  try {
    const doc = await IPlanScenario.create(Object.assign(iplanPick(req.body), {
      noteId: req.params.noteId,
      createdBy: req.user && req.user._id, createdByName: iplanUserName(req),
      updatedBy: req.user && req.user._id, updatedByName: iplanUserName(req),
    }));
    res.json(doc);
  } catch(error){ console.error('addIPlanScenario:', error); res.status(500).json({ error: error.message }); }
};

// ADDED 2026-10-12 (iPad): create many scenarios in one request (pad planner).
notesCrtl.addIPlanScenariosBatch = async (req, res) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if(!items.length) return res.status(400).json({ error: 'No scenarios to create' });
    if(items.length > 200) return res.status(400).json({ error: 'Too many scenarios in one batch (max 200)' });
    const who = { createdBy: req.user && req.user._id, createdByName: iplanUserName(req), updatedBy: req.user && req.user._id, updatedByName: iplanUserName(req) };
    const docs = await IPlanScenario.insertMany(items.map(it => Object.assign(iplanPick(it), { noteId: req.params.noteId }, who)));
    res.json(docs);
  } catch(error){ console.error('addIPlanScenariosBatch:', error); res.status(500).json({ error: error.message }); }
};

notesCrtl.updateIPlanScenario = async (req, res) => {
  try {
    const doc = await IPlanScenario.findByIdAndUpdate(req.params.scenarioId,
      Object.assign(iplanPick(req.body), { updatedBy: req.user && req.user._id, updatedByName: iplanUserName(req) }),
      { new: true });
    if(!doc) return res.status(404).json({ error: 'Scenario not found' });
    res.json(doc);
  } catch(error){ console.error('updateIPlanScenario:', error); res.status(500).json({ error: error.message }); }
};

notesCrtl.deleteIPlanScenario = async (req, res) => {
  try {
    const r = await IPlanScenario.deleteOne({ _id: req.params.scenarioId });
    if(!r.deletedCount) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ success: true });
  } catch(error){ console.error('deleteIPlanScenario:', error); res.status(500).json({ error: error.message }); }
};

// PATCH /notes/padStats/:id — save trajectory pad summary stats to the note
notesCrtl.savePadStats = async (req, res) => {
    try {
        const { trajWells, trajAvgDDI, trajAvgSteerIndex } = req.body;
        await Note.findByIdAndUpdate(req.params.id, {
            trajWells:         trajWells         ?? null,
            trajAvgDDI:        trajAvgDDI        ?? null,
            trajAvgSteerIndex: trajAvgSteerIndex ?? null,
        });
        res.json({ success: true });
    } catch(error){
        console.error('savePadStats error:', error);
        res.status(500).json({ error: error.message });
    }
};

// PATCH /notes/wbtColorMode/:id — Wellbore 3D Trajectory viewer coloring
// mode (2026-08-25). 'single' = Subject wells navy blue, Offset wells red;
// 'multi' = a distinct color per well (the original behavior). Saved on
// the job itself so every viewer sees the same choice.
notesCrtl.saveWbtColorMode = async (req, res) => {
    try {
        const { wbtColorMode } = req.body;
        if(!['single', 'multi'].includes(wbtColorMode)){
            return res.status(400).json({ error: "wbtColorMode must be 'single' or 'multi'." });
        }
        await Note.findByIdAndUpdate(req.params.id, { wbtColorMode });
        res.json({ success: true });
    } catch(error){
        console.error('saveWbtColorMode error:', error);
        res.status(500).json({ error: error.message });
    }
};


// =====================================================================
// SAGcorrection (added 2026-10-24) — standalone tool, port of SurQC's BHA
// sag solver (public/js/sagModel.js; validated against the original C#,
// see that file's header). Same standalone/no-bound-job pattern as
// 6-axis Data; route-guarded with canUseModelers (Geo/GeoM blocked).
// =====================================================================
notesCrtl.renderSagCorrection = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('sagCorrection.ejs', {user});
};

// Saved cases — identical role matrix to the SixAxisCase handlers above.
notesCrtl.saveSagCase = async(req,res)=>{
    try{
        const {name, inputData, survey} = req.body;
        if(!name || !String(name).trim()) return res.status(400).json({ok:false, error:'A case name is required.'});
        const doc = await SagCorrectionCase.create({
            user: req.session.passport.user, name: String(name).trim(),
            inputData: inputData || {}, survey: Array.isArray(survey) ? survey : [],
        });
        res.json({ok:true, case:{_id:doc._id, name:doc.name, createdAt:doc.createdAt}});
    }catch(err){ console.error('[SagCorrectionCase] save failed', err); res.status(500).json({ok:false, error:'Failed to save case.'}); }
};
notesCrtl.listSagCases = async(req,res)=>{
    try{
        const cases = await SagCorrectionCase.find({}, 'name createdAt user').populate('user','name email').sort({createdAt:-1}).lean();
        res.json({ok:true, cases: cases.map(c => ({
            _id:c._id, name:c.name, createdAt:c.createdAt,
            createdByName: c.user ? (c.user.name || c.user.email || 'Unknown') : 'Unknown',
            createdByUserId: c.user ? String(c.user._id) : null })),
            currentUserId: req.session.passport.user ? String(req.session.passport.user) : null,
            currentUserRole: req.user ? req.user.role : null });
    }catch(err){ console.error('[SagCorrectionCase] list failed', err); res.status(500).json({ok:false, error:'Failed to list cases.'}); }
};
notesCrtl.getSagCase = async(req,res)=>{
    try{
        const doc = await SagCorrectionCase.findById(req.params.id).lean();
        if(!doc) return res.status(404).json({ok:false, error:'Case not found.'});
        res.json({ok:true, case:doc});
    }catch(err){ console.error('[SagCorrectionCase] get failed', err); res.status(500).json({ok:false, error:'Failed to load case.'}); }
};
notesCrtl.deleteSagCase = async(req,res)=>{
    try{
        const filter = {_id:req.params.id};
        if(!req.user || req.user.role !== 'admin') filter.user = req.session.passport.user;
        const r = await SagCorrectionCase.deleteOne(filter);
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Case not found, or you do not have permission to delete it.'});
        res.json({ok:true});
    }catch(err){ console.error('[SagCorrectionCase] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete case.'}); }
};

// "Save as new version": writes the sag-corrected survey as a NEW
// WellboreTrajectory document next to the original (source
// "SAGcorrection", wellName "<original> SAG <yyyy-mm-dd>"). The original
// document is only READ, never modified. MD and Az are copied; Inc is the
// corrected value sent by the page; TVD/N/E are recomputed server-side by
// minimum curvature (Bourgoyne Ch.8, SagModelCore.minimumCurvature) from
// the original tie station; the corrected-minus-original MC deltas are
// added to the stored TVD/localN/localE (station 0 unchanged).
// subSea/northing/easting/position are shifted by the same deltas, using
// the conventions documented on WellboreTrajectory/FracPlane
// (subSea = elevation, X = Easting, Y = -TVD, Z = -Northing).
notesCrtl.saveSagVersion = async(req,res)=>{
    // CHANGED 2026-11-12 (John, correction chain phase 3): may start from ANY version (req.body.versionId, e.g. a
    // PipeStretch one) and stores the correction history via saveCorrectedVersion(); name "<well> [prev+]SAG <date>".
    // MD and Az are those of the starting version; Inc = corrected value from the page; same position maths as before
    // (MC deltas from the source's stored values). Before: only the uploaded original, name "<well> SAG <date>".
    try{
        const {noteId, wellKey, corrections, versionId} = req.body;
        // 2026-10-24: sag model used (Beam | Kinetic), recorded in each station comment.
        const model = req.body.model === 'Kinetic' ? 'Kinetic' : 'Beam';
        if(!noteId || !wellKey || !Array.isArray(corrections) || !corrections.length)
            return res.status(400).json({ok:false, error:'noteId, wellKey and corrections are required.'});
        const src = await corrSourceVersion(noteId, wellKey, versionId);
        if(!src || !src.survey || !src.survey.length) return res.status(404).json({ok:false, error:'Source well survey not found.'});
        if(corrections.length !== src.survey.length)
            return res.status(400).json({ok:false, error:'Station count does not match the source survey ('+src.survey.length+'). Reload the well and re-run.'});
        for(let i = 0; i < src.survey.length; i++){
            if(Math.abs((+corrections[i].md) - src.survey[i].md) > 1e-6)
                return res.status(400).json({ok:false, error:'MD mismatch at station '+(i+1)+'. Reload the well and re-run.'});
            if(!isFinite(+corrections[i].inc)) return res.status(400).json({ok:false, error:'Invalid inclination at station '+(i+1)+'.'});
        }
        // 2026-10-24 (improvement #10): ISCWSA toolcode for the new version,
        // chosen by the user at save time (page suggests the '+SAG'
        // counterpart and warns if it differs in non-sag terms). Must be a
        // key of public/data/iscwsaToolcodes.json; otherwise keep original's.
        let toolcode = src.toolcode || '';
        if (typeof req.body.toolcode === 'string' && req.body.toolcode) {
            const codes = require('../public/data/iscwsaToolcodes.json');
            if (!Object.prototype.hasOwnProperty.call(codes, req.body.toolcode))
                return res.status(400).json({ok:false, error:'Unknown toolcode "' + req.body.toolcode + '".'});
            toolcode = req.body.toolcode;
        }
        const doc = await saveCorrectedVersion(req, src, { type: 'sag', tag: 'SAG', source: 'SAGcorrection', model, wellKey, toolcode,
            label: String(req.body.label || '').slice(0, 300), inputs: req.body.inputs || {},
            stations: src.survey.map((s, i) => ({ md: s.md, inc: +corrections[i].inc, az: s.azim })),
            comment: i => 'SAG corr (' + model + ') ' + (+corrections[i].inc - src.survey[i].incl).toFixed(3) + ' deg' });
        res.json({ok:true, wellName: doc.wellName, id: doc._id, toolcode});
    }catch(err){ console.error('[SAGcorrection] save version failed', err); res.status(err.status || 500).json({ok:false, error:err.message}); }
};

// SAGcorrection materials (2026-10-24, improvement #5) — see models/SagMaterial.js.
notesCrtl.listSagMaterials = async(req,res)=>{
    try{
        const mats = await SagMaterial.find({}).populate('user','name email').sort({name:1}).lean();
        res.json({ok:true, currentUserId: String(req.session.passport.user || ''), currentUserRole: req.user ? req.user.role : null,
            materials: mats.map(m => ({_id:m._id, name:m.name, density:m.density, youngs:m.youngs, notes:m.notes,
                createdByName: m.user ? (m.user.name || m.user.email) : 'Unknown', createdByUserId: m.user ? String(m.user._id) : null}))});
    }catch(err){ console.error('[SagMaterial] list failed', err); res.status(500).json({ok:false, error:'Failed to list materials.'}); }
};
notesCrtl.saveSagMaterial = async(req,res)=>{
    try{
        const name = String(req.body.name || '').trim(), density = +req.body.density, youngs = +req.body.youngs;
        // Names reserved by the page's built-in reference materials (sagCorrection.ejs BUILTIN).
        const RESERVED = ['steel','nmdc 15-15lc mod (non-mag)','monel k-500','aluminium 2014-t6','titanium ti-6al-4v (annealed)'];
        if(!name || RESERVED.includes(name.toLowerCase())) return res.status(400).json({ok:false, error:'Enter a material name (that name is a built-in material).'});
        if(!(density > 0 && density < 30000)) return res.status(400).json({ok:false, error:'Density must be in kg/m3 (0-30000).'});
        if(!(youngs > 1e9 && youngs < 1e12)) return res.status(400).json({ok:false, error:"Young's modulus must be in Pa (1e9-1e12)."});
        const doc = await SagMaterial.create({user:req.session.passport.user, name, density, youngs, notes:String(req.body.notes || '')});
        res.json({ok:true, material:{_id:doc._id, name, density, youngs, notes:doc.notes}});
    }catch(err){ console.error('[SagMaterial] save failed', err); res.status(500).json({ok:false, error:'Failed to save material.'}); }
};
notesCrtl.deleteSagMaterial = async(req,res)=>{
    try{
        const filter = {_id:req.params.id};
        if(!req.user || req.user.role !== 'admin') filter.user = req.session.passport.user;
        const r = await SagMaterial.deleteOne(filter);
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Material not found, or you do not have permission to delete it.'});
        res.json({ok:true});
    }catch(err){ console.error('[SagMaterial] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete material.'}); }
};


// =====================================================================
// PipeStretch (added 2026-10-25) — standalone drill-pipe stretch (mechanical
// + thermal) MD-correction tool; engine public/js/stretchModel.js. Same
// standalone pattern and role matrix as SAGcorrection.
// =====================================================================
// DSI — Drill String Interference (added 2026-10-25, John). Standalone page,
// engine public/js/dsiModel.js; no server-side data of its own (it reads the
// existing job lookup / T&D endpoints). Same role guard as PipeStretch/SAG.
// ADDED 2026-11-13 (John): Slide Sheet — slides / rotations from the rig EDR (Pason LAS, 1 s). Standalone page,
// engine public/js/slideSheetModel.js; reads only the existing job lookup / T&D endpoints. Same guard as PipeStretch.
notesCrtl.renderSlideSheet = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('slideSheet.ejs', {user});
};
// 2026-11-13 (John): Slide Sheet save / list / get / delete (models/SlideSheet.js). Save REPLACES a sheet with the
// same job + well + name. Delete: owner or admin (same rule as the saved cases of the other modules).
notesCrtl.saveSlideSheet = async(req,res)=>{
    try{
        const b = req.body || {};
        const name = String(b.name || '').trim().slice(0, 120), wellKey = String(b.wellKey || '').trim();
        if(!b.noteId || !wellKey || !name) return res.status(400).json({ok:false, error:'Job, well and a name are required.'});
        if(!Array.isArray(b.intervals) || !b.intervals.length) return res.status(400).json({ok:false, error:'Nothing to save — build the slide sheet first.'});
        if(b.intervals.length > 20000) return res.status(400).json({ok:false, error:'Too many intervals.'});
        const note = await Note.findById(b.noteId).select('_id mtxJobId').lean();
        if(!note) return res.status(404).json({ok:false, error:'Job not found.'});
        const num = v => (v == null || !isFinite(+v)) ? null : +v;
        const intervals = b.intervals.map(x => ({ leg: String(x.leg || 'Main').slice(0, 20), run: String(x.run || '').slice(0, 80), mode: x.mode === 'slide' ? 'slide' : 'rotate',
            from: num(x.from), to: num(x.to), len: num(x.len), tf: num(x.tf), tfRef: String(x.tfRef || '').slice(0, 4), tfSd: num(x.tfSd), rop: num(x.rop), wob: num(x.wob),
            difp: num(x.difp), rpm: num(x.rpm), incStart: num(x.incStart), incEnd: num(x.incEnd), azStart: num(x.azStart), azEnd: num(x.azEnd), tStart: num(x.tStart), tEnd: num(x.tEnd) }));
        const doc = await SlideSheet.findOneAndUpdate({ noteId: note._id, wellKey, name },
            { $set: { mtxJobId: note.mtxJobId || '', tdScenario: String(b.tdScenario || '').slice(0, 100), las: b.las || {}, settings: b.settings || {},
                roles: Array.isArray(b.roles) ? b.roles.map(String) : [], segments: Array.isArray(b.segments) ? b.segments.slice(0, 200) : [],
                intervals, summary: b.summary || {}, user: req.user ? req.user._id : null } }, { upsert: true, new: true });
        res.json({ok:true, id: doc._id, name: doc.name});
    }catch(err){ console.error('[SlideSheet] save failed', err); res.status(500).json({ok:false, error:'Failed to save the slide sheet.'}); }
};
notesCrtl.listSlideSheets = async(req,res)=>{
    try{
        const docs = await SlideSheet.find({ noteId: req.params.noteId }).select('wellKey name tdScenario las summary updatedAt user').populate('user', 'name').sort({ wellKey: 1, updatedAt: -1 }).lean();
        res.json({ok:true, sheets: docs.map(d => ({ id: d._id, wellKey: d.wellKey, name: d.name, tdScenario: d.tdScenario, las: d.las, summary: d.summary, updatedAt: d.updatedAt, by: d.user ? d.user.name : '' }))});
    }catch(err){ console.error('[SlideSheet] list failed', err); res.status(500).json({ok:false, error:'Failed to list slide sheets.'}); }
};
notesCrtl.getSlideSheet = async(req,res)=>{
    try{ const d = await SlideSheet.findById(req.params.id).lean(); if(!d) return res.status(404).json({ok:false, error:'Slide sheet not found.'}); res.json({ok:true, sheet: d}); }
    catch(err){ console.error('[SlideSheet] get failed', err); res.status(500).json({ok:false, error:'Failed to load the slide sheet.'}); }
};
notesCrtl.deleteSlideSheet = async(req,res)=>{
    try{
        const filter = { _id: req.params.id };
        if(!req.user || req.user.role !== 'admin') filter.user = req.session.passport.user;
        const r = await SlideSheet.deleteOne(filter);
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Not found, or you do not have permission to delete it.'});
        res.json({ok:true});
    }catch(err){ console.error('[SlideSheet] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete.'}); }
};
// 2026-11-14 (John): DSI defaults saved by an admin ("Save this setup as default") in SiteConfig
// key 'dsiDefaults' (JSON of input id -> value). Applied when the page opens; built-in defaults otherwise.
const DSI_DEFAULT_KEYS = ['method','pUsel','pU','pLsel','pL','bitDip','muR','bands','allow','c3d','perRun','unitSel'];
notesCrtl.renderDsi = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    let dsiDefaults = null;
    try { const cfg = await SiteConfig.findOne({ key: 'dsiDefaults' }).lean(); if (cfg && cfg.value) dsiDefaults = JSON.parse(cfg.value); } catch (e) { dsiDefaults = null; }
    res.render('dsi.ejs', {user, dsiDefaults});
};
// 2026-11-14 (John): generic "Save this setup as default" for other modules (public/js/mtxDefaults.js).
// Values are the page's own setting inputs (metric display units), keyed by input id. Admin-only save.
const MODULE_DEFAULTS = ['sag', 'pipeStretch', 'slideSheet', 'hydraulics', 'casingDesign', 'torqueAndDrag'];
notesCrtl.getModuleDefaults = async(req,res)=>{
    try {
        const mod = req.params.module; if (!MODULE_DEFAULTS.includes(mod)) return res.status(404).json({ error: 'unknown module' });
        const u = await User.findById(req.session.passport.user);
        let values = null; const cfg = await SiteConfig.findOne({ key: 'defaults:' + mod }).lean();
        if (cfg && cfg.value) { try { values = JSON.parse(cfg.value); } catch (e) { values = null; } }
        res.json({ values, isAdmin: !!(u && u.role === 'admin') });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
notesCrtl.saveModuleDefaults = async(req,res)=>{
    try {
        const mod = req.params.module; if (!MODULE_DEFAULTS.includes(mod)) return res.status(404).json({ ok:false, error: 'unknown module' });
        const u = await User.findById(req.session.passport.user);
        if (!u || u.role !== 'admin') return res.status(403).json({ ok:false, error: 'Only admin accounts can change page defaults.' });
        const body = req.body || {};
        if (body.reset) { await SiteConfig.deleteOne({ key: 'defaults:' + mod }); return res.json({ ok:true, reset:true }); }
        const v = {}; let n = 0;
        Object.keys(body.values || {}).forEach(k => { if (n < 80 && /^[A-Za-z0-9_-]{1,40}$/.test(k)) { v[k] = String(body.values[k]).slice(0, 80); n++; } });
        await SiteConfig.findOneAndUpdate({ key: 'defaults:' + mod }, { value: JSON.stringify(v), updatedBy: u._id, updatedAt: new Date() }, { upsert: true });
        res.json({ ok:true, saved: v });
    } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
};
// 2026-11-14 (John): Compass survey-tool files (.ipm) imported in the AC module. Stored RAW (the text of the
// file) in SiteConfig key 'ipmToolcodes' as {name: {text, fileName, by, at}}, shared by every user; the browser
// converts them with public/js/ipmImport.js, so a converter fix applies to files already stored.
notesCrtl.getIpmToolcodes = async(req,res)=>{
    try { const cfg = await SiteConfig.findOne({ key: 'ipmToolcodes' }).lean(); let v = {}; if (cfg && cfg.value) { try { v = JSON.parse(cfg.value); } catch (e) { v = {}; } } res.json({ ok:true, tools: v }); }
    catch (err) { res.status(500).json({ ok:false, error: err.message }); }
};
notesCrtl.saveIpmToolcode = async(req,res)=>{
    try {
        const u = await User.findById(req.session.passport.user);
        if (!u || !['admin','leader','user'].includes(u.role)) return res.status(403).json({ ok:false, error:'Only admin, leader and user accounts can import survey tools.' });
        const { name, text, fileName, remove } = req.body || {};
        if (!name || !/^IPM: [\w+\-. ()]{1,60}$/.test(name)) return res.status(400).json({ ok:false, error:'Invalid tool name.' });
        const cfg = await SiteConfig.findOne({ key: 'ipmToolcodes' }).lean(); let v = {}; if (cfg && cfg.value) { try { v = JSON.parse(cfg.value); } catch (e) { v = {}; } }
        if (remove) delete v[name];
        else { if (!text || String(text).length > 100000) return res.status(400).json({ ok:false, error:'Missing or too large .ipm text.' });
            v[name] = { text: String(text), fileName: String(fileName || '').slice(0, 120), by: u.name || u.username || '', at: new Date() }; }
        await SiteConfig.findOneAndUpdate({ key: 'ipmToolcodes' }, { value: JSON.stringify(v), updatedBy: u._id, updatedAt: new Date() }, { upsert: true });
        res.json({ ok:true });
    } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
};
// 2026-11-14 (John): per-user display preferences, stored on the user (User.uiPrefs, key -> short string).
notesCrtl.getUserPrefs = async(req,res)=>{
    try { const u = await User.findById(req.session.passport.user).lean(); res.json({ ok:true, prefs: (u && u.uiPrefs) || {} }); }
    catch (err) { res.status(500).json({ ok:false, error: err.message }); }
};
notesCrtl.saveUserPref = async(req,res)=>{
    try {
        const { key, value } = req.body || {};
        if (!key || !/^[A-Za-z0-9_]{1,40}$/.test(key)) return res.status(400).json({ ok:false, error:'Invalid preference key.' });
        await User.updateOne({ _id: req.session.passport.user }, { $set: { ['uiPrefs.' + key]: String(value == null ? '' : value).slice(0, 200) } });
        res.json({ ok:true });
    } catch (err) { res.status(500).json({ ok:false, error: err.message }); }
};
notesCrtl.saveDsiDefaults = async(req,res)=>{
    try {
        const requester = await User.findById(req.session.passport.user);
        if (!requester || requester.role !== 'admin') return res.status(403).json({ ok:false, error:'Only admin accounts can change the DSI defaults.' });
        const body = req.body || {};
        if (body.reset) { await SiteConfig.deleteOne({ key: 'dsiDefaults' }); return res.json({ ok:true, reset:true }); }
        const v = {};
        DSI_DEFAULT_KEYS.forEach(k => { if (body.values && body.values[k] !== undefined) v[k] = String(body.values[k]).slice(0, 40); });
        await SiteConfig.findOneAndUpdate({ key: 'dsiDefaults' }, { value: JSON.stringify(v), updatedBy: requester._id, updatedAt: new Date() }, { upsert: true });
        res.json({ ok:true, saved: v });
    } catch (err) { console.error('saveDsiDefaults', err); res.status(500).json({ ok:false, error: err.message }); }
};
notesCrtl.renderPipeStretch = async(req,res)=>{
    let user = await User.findById(req.session.passport.user);
    res.render('pipeStretch.ejs', {user});
};
notesCrtl.savePipeStretchCase = async(req,res)=>{
    try{
        const {name, inputData, survey} = req.body;
        if(!name || !String(name).trim()) return res.status(400).json({ok:false, error:'A case name is required.'});
        const doc = await PipeStretchCase.create({ user: req.session.passport.user, name: String(name).trim(),
            inputData: inputData || {}, survey: Array.isArray(survey) ? survey : [] });
        res.json({ok:true, case:{_id:doc._id, name:doc.name, createdAt:doc.createdAt}});
    }catch(err){ console.error('[PipeStretchCase] save failed', err); res.status(500).json({ok:false, error:'Failed to save case.'}); }
};
notesCrtl.listPipeStretchCases = async(req,res)=>{
    try{
        const cases = await PipeStretchCase.find({}, 'name createdAt user').populate('user','name email').sort({createdAt:-1}).lean();
        res.json({ok:true, cases: cases.map(c => ({ _id:c._id, name:c.name, createdAt:c.createdAt,
            createdByName: c.user ? (c.user.name || c.user.email || 'Unknown') : 'Unknown', createdByUserId: c.user ? String(c.user._id) : null })),
            currentUserId: req.session.passport.user ? String(req.session.passport.user) : null, currentUserRole: req.user ? req.user.role : null });
    }catch(err){ console.error('[PipeStretchCase] list failed', err); res.status(500).json({ok:false, error:'Failed to list cases.'}); }
};
notesCrtl.getPipeStretchCase = async(req,res)=>{
    try{
        const doc = await PipeStretchCase.findById(req.params.id).lean();
        if(!doc) return res.status(404).json({ok:false, error:'Case not found.'});
        res.json({ok:true, case:doc});
    }catch(err){ console.error('[PipeStretchCase] get failed', err); res.status(500).json({ok:false, error:'Failed to load case.'}); }
};
notesCrtl.deletePipeStretchCase = async(req,res)=>{
    try{
        const filter = {_id:req.params.id};
        if(!req.user || req.user.role !== 'admin') filter.user = req.session.passport.user;
        const r = await PipeStretchCase.deleteOne(filter);
        if(!r.deletedCount) return res.status(404).json({ok:false, error:'Case not found, or you do not have permission to delete it.'});
        res.json({ok:true});
    }catch(err){ console.error('[PipeStretchCase] delete failed', err); res.status(500).json({ok:false, error:'Failed to delete case.'}); }
};

// =====================================================================
// CORRECTION CHAIN (ADDED 2026-11-12, John) — survey corrections can be
// applied one after another (e.g. PipeStretch -> SAG -> MSA) through saved
// versions. Decisions (John 2026-11-12, see project doc
// claude/correction-chain-plan.md):
//   - each saved version stores its correctionChain (type, model, inputs,
//     per-station dMd/dInc/dAz) and baseWellName; the next module may start
//     from ANY version of the well;
//   - the same correction type cannot be applied twice (SC and MSA are both
//     azimuth corrections from the raw sensors -> only one of them);
//   - BHA runs are assigned by the ORIGINAL (tally) MD: stations keep
//     origMd/origIncl/origAzim;
//   - positions: deltas MC(new md/inc/az) - MC(source md/inc/az) from the same
//     tie (SagModelCore.minimumCurvature, Bourgoyne Ch.8), added to the STORED
//     TVD/N/E of the source version — the convention already used by
//     saveSagVersion / savePipeStretchVersion since 2026-10-24/25, so a zero
//     correction moves nothing.
// =====================================================================
const CORR_SOURCES = ['SAGcorrection', 'PipeStretch', 'ShortCollar', 'MSA', 'SSA'];   // 2026-11-13: + SSA
const CORR_CONFLICT = { shortcollar: ['shortcollar', 'msa'], msa: ['shortcollar', 'msa'] };
// Source version for a save: req.body.versionId if given (any version of this job), else the uploaded original
// (legacy behaviour: {noteId, wellName: wellKey, source not a correction}).
async function corrSourceVersion(noteId, wellKey, versionId){
    if(versionId) return WellboreTrajectory.findOne({ _id: versionId, noteId }).lean();
    return WellboreTrajectory.findOne({ noteId, wellName: wellKey, source: { $nin: CORR_SOURCES } }).lean();
}
// stations: [{md, inc, az}] corrected values, same length/order as src.survey.
async function saveCorrectedVersion(req, src, o){
    let chain = Array.isArray(src.correctionChain) ? src.correctionChain : [];
    // 2026-11-13: SSA adds fill-in stations, so the station-by-station corrections cannot follow it — SSA must be last.
    if(chain.some(c => c.type === 'ssa')) { const e = new Error('This version already has a Slide Sheet Analysis (SSA) correction, which adds fill-in stations — SSA must be the last correction. Start from the version before SSA.'); e.status = 400; throw e; }
    // versions saved before 2026-11-12 have no chain: their source tells which correction they carry
    const LEGACY = { SAGcorrection: ['sag', 'SAG'], PipeStretch: ['stretch', 'PS'], ShortCollar: ['shortcollar', 'SCC'], /* 2026-11-15: tags PS / SCC (John; were STRETCH / SC) */ MSA: ['msa', 'MSA'] };
    if(!chain.length && LEGACY[src.source]) chain = [{ type: LEGACY[src.source][0], tag: LEGACY[src.source][1], label: 'saved before 2026-11-12 (no per-station history)', sourceName: src.wellName }];
    const block = CORR_CONFLICT[o.type] || [o.type];
    const dup = chain.find(c => block.indexOf(c.type) >= 0);
    if(dup) { const e = new Error('This version already has a ' + (dup.tag || dup.type) + ' correction — it cannot be applied twice. Start from an earlier version.'); e.status = 400; throw e; }
    const s0 = src.survey[0], tie = { tvd: s0.tvd, n: s0.localN, e: s0.localE };
    const mc0 = SagModelCore.minimumCurvature(src.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim })), tie);
    const mc  = SagModelCore.minimumCurvature(o.stations, tie);
    const survey = src.survey.map((s, i) => {
        const dT = mc[i].tvd - mc0[i].tvd, dN = mc[i].n - mc0[i].n, dE = mc[i].e - mc0[i].e, pos = s.position || { x: 0, y: 0, z: 0 };
        return Object.assign({}, s, {
            md: o.stations[i].md, incl: mc[i].inc, azim: o.stations[i].az,
            origMd: s.origMd != null ? s.origMd : s.md, origIncl: s.origIncl != null ? s.origIncl : s.incl, origAzim: s.origAzim != null ? s.origAzim : s.azim,
            tvd: s.tvd + dT, localN: s.localN + dN, localE: s.localE + dE, dogleg: mc[i].dls,
            subSea: s.subSea - dT, northing: s.northing + dN, easting: s.easting + dE, position: { x: pos.x + dE, y: pos.y - dT, z: pos.z - dN },
            comments: (s.comments ? s.comments + ' | ' : '') + o.comment(i),
        });
    });
    let azd = (a, b) => { let d = a - b; while(d > 180) d -= 360; while(d < -180) d += 360; return d; };
    const step = { type: o.type, tag: o.tag, model: o.model || '', label: o.label || '', inputs: o.inputs || {},
        sourceId: src._id, sourceName: src.wellName, userName: req.user ? (req.user.name || req.user.email || '') : '', date: new Date(),
        dMd: survey.map((s, i) => +(s.md - src.survey[i].md).toFixed(6)),
        dInc: survey.map((s, i) => +(s.incl - src.survey[i].incl).toFixed(6)),
        dAz: survey.map((s, i) => +azd(s.azim, src.survey[i].azim).toFixed(6)) };
    const newChain = chain.concat([step]);
    const base = src.baseWellName || (CORR_SOURCES.indexOf(src.source) < 0 ? src.wellName : (o.wellKey || src.wellName));
    const date = new Date().toISOString().slice(0, 10);
    return WellboreTrajectory.create({
        noteId: src.noteId, wellName: base + ' ' + newChain.map(c => c.tag).join('+') + ' ' + date, source: o.source,
        baseWellName: base, correctionChain: newChain,
        wellCategory: src.wellCategory || '', pad: src.pad || '', colorHex: '', toolcode: o.toolcode != null ? o.toolcode : (src.toolcode || ''),
        surveyCount: survey.length, survey, user: req.user ? req.user._id : null, uploadedDate: new Date(),
    });
}

// ADDED 2026-11-13 (John): save a Slide Sheet Analysis (SSA) version — the measured stations of the starting version
// are kept unchanged and fill-in stations (computed in the browser by public/js/ssaModel.js per ISCWSA eBook pp. 57-58)
// are inserted; minimum curvature (SagModelCore, Bourgoyne Ch.8) is run through all stations from the original tie.
// Measured stations get the MC position change added to their stored values (same convention as saveCorrectedVersion);
// a fill-in takes the stored position of the measured station before it + the MC difference between the two.
// Latitude / longitude of fill-ins are left at 0 (no projection in MTX to convert N/E). SSA must be the last correction.
notesCrtl.saveSsaVersion = async (req, res) => {
    try{
        const { noteId, wellKey, versionId, fillIns } = req.body;
        if(!noteId || !wellKey || !Array.isArray(fillIns) || !fillIns.length) return res.status(400).json({ ok: false, error: 'noteId, wellKey and fill-in stations are required.' });
        const src = await corrSourceVersion(noteId, wellKey, versionId);
        if(!src || !src.survey || src.survey.length < 2) return res.status(404).json({ ok: false, error: 'Source well survey not found.' });
        const chain = Array.isArray(src.correctionChain) ? src.correctionChain : [];
        if(chain.some(c => c.type === 'ssa') || src.survey.some(s => s.interp)) return res.status(400).json({ ok: false, error: 'This version already has an SSA correction.' });
        const mdMin = src.survey[0].md, mdMax = src.survey[src.survey.length - 1].md;
        for(const f of fillIns) if(!isFinite(+f.md) || !isFinite(+f.inc) || !isFinite(+f.az) || +f.md <= mdMin || +f.md >= mdMax || +f.inc < 0 || +f.inc > 180)
            return res.status(400).json({ ok: false, error: 'Invalid fill-in station.' });
        const merged = src.survey.map((s, i) => ({ real: true, i, md: s.md, inc: s.incl, az: s.azim }))
            .concat(fillIns.map(f => ({ real: false, md: +f.md, inc: +f.inc, az: ((+f.az % 360) + 360) % 360, f })))
            .sort((a, b) => a.md - b.md || (a.real ? -1 : 1));
        const s0 = src.survey[0], tie = { tvd: s0.tvd, n: s0.localN, e: s0.localE };
        const mc0 = SagModelCore.minimumCurvature(src.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim })), tie);
        const mc = SagModelCore.minimumCurvature(merged.map(m => ({ md: m.md, inc: m.inc, az: m.az })), tie);
        const survey = []; let lastReal = null;
        merged.forEach((m, j) => {
            if(m.real){
                const s = src.survey[m.i], dT = mc[j].tvd - mc0[m.i].tvd, dN = mc[j].n - mc0[m.i].n, dE = mc[j].e - mc0[m.i].e, pos = s.position || { x: 0, y: 0, z: 0 };
                const o = Object.assign({}, s, { origMd: s.origMd != null ? s.origMd : s.md, origIncl: s.origIncl != null ? s.origIncl : s.incl, origAzim: s.origAzim != null ? s.origAzim : s.azim,
                    tvd: s.tvd + dT, localN: s.localN + dN, localE: s.localE + dE, dogleg: mc[j].dls, subSea: s.subSea - dT, northing: s.northing + dN, easting: s.easting + dE,
                    position: { x: pos.x + dE, y: pos.y - dT, z: pos.z - dN }, interp: false });
                survey.push(o); lastReal = { o, j };
            } else {
                const b = lastReal.o, k = lastReal.j, dT = mc[j].tvd - mc[k].tvd, dN = mc[j].n - mc[k].n, dE = mc[j].e - mc[k].e, f = m.f, sl = f.slide || {};
                survey.push({ well: b.well, md: m.md, incl: mc[j].inc, azim: m.az, origMd: m.md, origIncl: m.inc, origAzim: m.az, interp: true,
                    tvd: b.tvd + dT, subSea: b.subSea - dT, vertSec: 0, localN: b.localN + dN, localE: b.localE + dE, dogleg: mc[j].dls, northing: b.northing + dN, easting: b.easting + dE,
                    latitude: 0, longitude: 0, position: { x: b.position.x + dE, y: b.position.y - dT, z: b.position.z - dN },
                    comments: 'SSA fill-in (' + (f.at || '') + ' of slide ' + (+sl.from).toFixed(1) + '-' + (+sl.to).toFixed(1) + ' m, TF ' + (+sl.tf).toFixed(0) + '°' + (sl.run ? ', ' + String(sl.run).slice(0, 40) : '') + ')' });
            }
        });
        const realIdx = survey.map((s, i) => s.interp ? -1 : i).filter(i => i >= 0);
        const step = { type: 'ssa', tag: 'SSA', model: 'ISCWSA eBook pp.57-58', label: String(req.body.label || '').slice(0, 300), inputs: req.body.inputs || {},
            sourceId: src._id, sourceName: src.wellName, userName: req.user ? (req.user.name || req.user.email || '') : '', date: new Date(),
            // per MEASURED station (same order/length as the source survey): MD and angles unchanged by SSA
            dMd: realIdx.map(() => 0), dInc: realIdx.map(() => 0), dAz: realIdx.map(() => 0) };
        const base = src.baseWellName || (CORR_SOURCES.indexOf(src.source) < 0 ? src.wellName : wellKey);
        const newChain = chain.concat([step]), date = new Date().toISOString().slice(0, 10);
        const doc = await WellboreTrajectory.create({ noteId: src.noteId, wellName: base + ' ' + newChain.map(c => c.tag).join('+') + ' ' + date, source: 'SSA',
            baseWellName: base, correctionChain: newChain, wellCategory: src.wellCategory || '', pad: src.pad || '', colorHex: '', toolcode: src.toolcode || '',
            surveyCount: survey.length, survey, user: req.user ? req.user._id : null, uploadedDate: new Date() });
        res.json({ ok: true, wellName: doc.wellName, id: doc._id, fillIns: fillIns.length });
    }catch(err){ console.error('[SSA] save version failed', err); res.status(err.status || 500).json({ ok: false, error: err.message }); }
};
// GET /notes/surveyVersions?noteId=&wellKey=  -> the uploaded well + every correction version derived from it
// (new versions by baseWellName; versions saved before 2026-11-12 by name prefix "<well> ").
notesCrtl.listSurveyVersions = async (req, res) => {
    try{
        const { noteId, wellKey } = req.query;
        if(!noteId || !wellKey) return res.status(400).json({ ok: false, error: 'noteId and wellKey are required.' });
        const esc = String(wellKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const docs = await WellboreTrajectory.find({ noteId, $or: [
            { wellName: wellKey, source: { $nin: CORR_SOURCES } },
            { baseWellName: wellKey },
            { wellName: new RegExp('^' + esc + ' '), source: { $in: CORR_SOURCES } } ] })
            .select('wellName source baseWellName correctionChain.type correctionChain.tag correctionChain.model correctionChain.label correctionChain.date correctionChain.userName correctionChain.sourceName surveyCount uploadedDate toolcode')
            .sort({ uploadedDate: 1 }).lean();
        res.json({ ok: true, versions: docs.map(d => ({ id: d._id, wellName: d.wellName, source: d.source, original: CORR_SOURCES.indexOf(d.source) < 0,
            legacy: CORR_SOURCES.indexOf(d.source) >= 0 && !(d.correctionChain || []).length, chain: d.correctionChain || [],
            surveyCount: d.surveyCount, date: d.uploadedDate, toolcode: d.toolcode || '' })) });
    }catch(err){ console.error('[surveyVersions] list failed', err); res.status(500).json({ ok: false, error: err.message }); }
};
// GET /notes/surveyVersion/:id -> survey (md/inc/az + original tally values) and the full chain of one version
notesCrtl.getSurveyVersion = async (req, res) => {
    try{
        const d = await WellboreTrajectory.findById(req.params.id).select('noteId wellName source baseWellName correctionChain survey toolcode').lean();
        if(!d) return res.status(404).json({ ok: false, error: 'Version not found.' });
        res.json({ ok: true, version: { id: d._id, noteId: d.noteId, wellName: d.wellName, source: d.source, baseWellName: d.baseWellName || '', toolcode: d.toolcode || '',
            chain: d.correctionChain || [], survey: (d.survey || []).map(s => ({ md: s.md, inc: s.incl, az: s.azim, tvd: s.tvd, n: s.localN, e: s.localE,
                origMd: s.origMd != null ? s.origMd : s.md, origInc: s.origIncl != null ? s.origIncl : s.incl, origAz: s.origAzim != null ? s.origAzim : s.azim, interp: !!s.interp })) } });
    }catch(err){ console.error('[surveyVersions] get failed', err); res.status(500).json({ ok: false, error: err.message }); }
};

// "Save as new version": new WellboreTrajectory "<well> STRETCH <yyyy-mm-dd>"
// (source "PipeStretch") with MD += total stretch at each station; Inc/Az
// copied. Positions: deltas MC(corrected MDs) - MC(original MDs) (same tie,
// SagModelCore.minimumCurvature = Bourgoyne Ch.8) added to the STORED
// TVD/N/E, so a zero correction moves nothing. Original only read.
notesCrtl.savePipeStretchVersion = async(req,res)=>{
    // CHANGED 2026-11-12 (John, correction chain): may start from ANY version (req.body.versionId), stores the
    // correction history via saveCorrectedVersion(); name "<well> [prev+]STRETCH <date>". Before: only the uploaded
    // original, name "<well> STRETCH <date>", same MD/position maths (kept unchanged).
    try{
        const {noteId, wellKey, corrections, versionId} = req.body;
        const model = req.body.model === 'TD' ? 'T&D' : 'SurQC';
        if(!noteId || !wellKey || !Array.isArray(corrections) || !corrections.length)
            return res.status(400).json({ok:false, error:'noteId, wellKey and corrections are required.'});
        const src = await corrSourceVersion(noteId, wellKey, versionId);
        if(!src || !src.survey || !src.survey.length) return res.status(404).json({ok:false, error:'Source well survey not found.'});
        if(corrections.length !== src.survey.length)
            return res.status(400).json({ok:false, error:'Station count does not match the source survey ('+src.survey.length+'). Reload the well and re-run.'});
        for(let i = 0; i < src.survey.length; i++){
            if(Math.abs((+corrections[i].md) - src.survey[i].md) > 1e-6) return res.status(400).json({ok:false, error:'MD mismatch at station '+(i+1)+'. Reload the well and re-run.'});
            if(!isFinite(+corrections[i].dMd)) return res.status(400).json({ok:false, error:'Invalid correction at station '+(i+1)+'.'});
        }
        const doc = await saveCorrectedVersion(req, src, { type: 'stretch', tag: 'PS', source: 'PipeStretch', model, wellKey,   // 2026-11-15: tag PS (was STRETCH)
            label: String(req.body.label || req.body.loadCase || '').slice(0, 300), inputs: req.body.inputs || {},
            stations: src.survey.map((s, i) => ({ md: s.md + (+corrections[i].dMd), inc: s.incl, az: s.azim })),
            comment: i => 'PS (' + model + ') ' + ((+corrections[i].dMd) >= 0 ? '+' : '') + (+corrections[i].dMd).toFixed(3) + ' m MD' });
        res.json({ok:true, wellName: doc.wellName, id: doc._id});
    }catch(err){ console.error('[PipeStretch] save version failed', err); res.status(err.status || 500).json({ok:false, error:err.message}); }
};

// =====================================================================
// Short Collar (added 2026-10-25) — "Save as new version" from the Short
// Collar accordion of the 6-axis Data page (views/sixAxisData.ejs, engine
// public/js/shortCollarModel.js = SurQC port). Writes a NEW
// WellboreTrajectory "<well> SC <yyyy-mm-dd>" (source "ShortCollar"); the
// original is only read. The raw 6-axis stations need not coincide with the
// job's survey stations, so each original station takes the dAz (SurQC
// corrected - measured azimuth) of the nearest corrected station within
// mdTol (m); unmatched stations are copied unchanged. Applying dAz (rather
// than the page's absolute azimuth) keeps the job's own azimuth reference
// (true/grid, declination). Positions: deltas MC(corrected Az) - MC(original
// Az) from the same tie (SagModelCore.minimumCurvature, Bourgoyne Ch.8)
// added to the STORED TVD/N/E — same convention as saveSagVersion.
// Toolcode: user-chosen at save time (page suggests the "+AX" counterpart,
// ISCWSA Rev5.13 §6.2.1); must be a key of public/data/iscwsaToolcodes.json.
// =====================================================================
notesCrtl.saveShortCollarVersion = async(req,res)=>{
    try{
        const {noteId, wellKey, corrections} = req.body;
        const mdTol = +req.body.mdTol;
        // 2026-10-25: same endpoint also saves the MSA model (6-axis page accordion, public/js/msaModel.js).
        const isMsa = req.body.model === 'msa';
        const apply = isMsa ? 'MSA' : (req.body.apply === 'average' ? 'avg Z-bias' : 'station Z-bias');
        const tag = isMsa ? 'MSA' : 'SCC';   // 2026-11-15 (John): Short Collar Correction tag "SCC" (was "SC", which is also Surface Casing)
        if(!noteId || !wellKey || !Array.isArray(corrections) || !corrections.length)
            return res.status(400).json({ok:false, error:'noteId, wellKey and corrections are required.'});
        if(!(mdTol >= 0 && mdTol <= 30)) return res.status(400).json({ok:false, error:'MD match tolerance must be 0-30 m.'});
        for(const c of corrections) if(!isFinite(+c.md) || !isFinite(+c.dAz) || Math.abs(+c.dAz) > 180)
            return res.status(400).json({ok:false, error:'Invalid correction values.'});
        const orig = await WellboreTrajectory.findOne({noteId, wellName: wellKey, source: {$nin: ['SAGcorrection', 'PipeStretch', 'ShortCollar', 'MSA']}}).lean();
        if(!orig || !orig.survey || !orig.survey.length) return res.status(404).json({ok:false, error:'Original well survey not found.'});
        // 2026-10-25 (John): optional skipExcluded — a station whose nearest raw
        // station is flagged excluded (from the average, auto or manual) is
        // copied unchanged and its comment says so. Default off = SurQC
        // behaviour (every station gets its own correction).
        const skipExcluded = req.body.skipExcluded === true;
        let matched = 0, skipped = 0;
        const skipFlag = [];
        const dAz = orig.survey.map((s, i) => {
            let best = null;
            corrections.forEach(c => { const d = Math.abs(+c.md - s.md); if(d <= mdTol && (!best || d < best.d)) best = {d, v:+c.dAz, ex: c.excluded === true}; });
            if(best && skipExcluded && best.ex){ skipped++; skipFlag[i] = true; return null; }
            if(best) matched++;
            return best ? best.v : null;
        });
        if(!matched) return res.status(400).json({ok:false, error:'No station of this well would be corrected (none within ' + mdTol + ' m MD of a corrected, non-skipped station).'});
        const norm = a => ((a % 360) + 360) % 360;
        const s0 = orig.survey[0], tie = {tvd:s0.tvd, n:s0.localN, e:s0.localE};
        const mc0 = SagModelCore.minimumCurvature(orig.survey.map(s => ({md:s.md, inc:s.incl, az:s.azim})), tie);
        const mc = SagModelCore.minimumCurvature(orig.survey.map((s, i) => ({md:s.md, inc:s.incl, az: dAz[i] == null ? s.azim : norm(s.azim + dAz[i])})), tie);
        const survey = orig.survey.map((s, i) => {
            const dT = mc[i].tvd - mc0[i].tvd, dN = mc[i].n - mc0[i].n, dE = mc[i].e - mc0[i].e, pos = s.position || {x:0,y:0,z:0};
            return Object.assign({}, s, { azim: dAz[i] == null ? s.azim : norm(s.azim + dAz[i]),
                tvd: s.tvd + dT, localN: s.localN + dN, localE: s.localE + dE, dogleg: mc[i].dls,
                subSea: s.subSea - dT, northing: s.northing + dN, easting: s.easting + dE, position: {x: pos.x + dE, y: pos.y - dT, z: pos.z - dN},
                comments: (s.comments ? s.comments + ' | ' : '') + (skipFlag[i] ? tag + ': skipped (excluded station)' : dAz[i] == null ? tag + ': no raw station within ' + mdTol + ' m' : tag + ' corr (' + apply + ') ' + dAz[i].toFixed(3) + ' deg Az') });
        });
        let toolcode = orig.toolcode || '';
        if (typeof req.body.toolcode === 'string' && req.body.toolcode) {
            const codes = require('../public/data/iscwsaToolcodes.json');
            if (!Object.prototype.hasOwnProperty.call(codes, req.body.toolcode))
                return res.status(400).json({ok:false, error:'Unknown toolcode "' + req.body.toolcode + '".'});
            toolcode = req.body.toolcode;
        }
        const date = new Date().toISOString().slice(0,10);
        const doc = await WellboreTrajectory.create({ noteId, wellName: wellKey + ' ' + tag + ' ' + date, source: isMsa ? 'MSA' : 'ShortCollar',
            wellCategory: orig.wellCategory || '', pad: orig.pad || '', colorHex: '', toolcode,
            surveyCount: survey.length, survey, user: req.user ? req.user._id : null, uploadedDate: new Date() });
        res.json({ok:true, wellName: doc.wellName, id: doc._id, toolcode, matched, skipped});
    }catch(err){ console.error('[ShortCollar] save version failed', err); res.status(500).json({ok:false, error:err.message}); }
};

// 2026-10-25 (John): Multi-corrections (Therm/Mech/SAG/MSA) endpoints removed the
// same day they were added — the corrections stay separate modules for now.

// ================= WELL STRUCTURE (ADDED 2026-11-15, John) — Job -> Well -> Wellbore -> Run =================
// Phase 1: read-only index over existing data (models/WellStructure.js). GET builds a PROPOSAL from the job's
// current data and returns the saved structure (if any) with everything linked to each wellbore / run, looked up
// live. POST /build saves the proposal (replaces this job's structure only; never touches the linked data).
// Proposal rules (stated choices, editable in phase 2):
//   - wells = subject wells (same rule as findJobByMtxId), correction versions excluded;
//   - wellbores: names ending in _L<NN> with the same prefix are legs of ONE well (wellbore "L<NN>"), else "Main";
//   - runs = active runs of the T&D plan (TDModelCore.planActiveRuns) of the active scenario, else the first
//     scenario that has runs for that well; none -> the wellbore has no runs (items still shown at wellbore level).
const { Well: WSWell, Wellbore: WSWellbore, Run: WSRun } = require('../models/WellStructure');
// 2026-11-15: correction tags shown as John's names (versions saved before keep STRETCH / SC in their stored name)
const WS_TAG = { STRETCH: 'PS', SC: 'SCC' };
function wsChainLabel(t, chain){ const base = /^GY/i.test(t.toolcode || '') ? 'GYRO' : 'MWD'; return [base].concat((chain || []).map(c => WS_TAG[c.tag] || c.tag || c.type)).join('+'); }
function wsIsSubject(t){ const wn = (t.wellName || '').trim(); if(t.wellCategory === 'subject') return true; if(t.wellCategory === 'offset') return false; return /^\[\d+\]/.test(wn) && /_L\d+$/i.test(wn); }
function wsTdPlan(td, wellKey){
    if(!td) return null; const sc = td.scenarios || {}, names = Object.keys(sc);
    const pick = n => { const e = sc[n] && sc[n].resultsByWell && sc[n].resultsByWell[wellKey]; return e && e.params && e.params.plan && (e.params.plan.runs || []).length ? { scenario: n, plan: e.params.plan } : null; };
    if(td.activeScenario && pick(td.activeScenario)) return pick(td.activeScenario);
    for(const n of names){ const p = pick(n); if(p) return p; }
    const e = td.resultsByWell && td.resultsByWell[wellKey];   // legacy single-scenario layout
    return e && e.params && e.params.plan && (e.params.plan.runs || []).length ? { scenario: '', plan: e.params.plan } : null;
}
async function wsGather(noteId){
    const note = await Note.findById(noteId).select('_id title mtxJobId').lean(); if(!note) throw Object.assign(new Error('Job not found.'), { status: 404 });
    const [trajs, td, hyd, cas, sheets] = await Promise.all([
        WellboreTrajectory.find({ noteId }).select('wellName wellCategory source baseWellName correctionChain surveyCount uploadedDate toolcode pad designation planVersion wsWellboreId survey.md survey.tvd survey.northing survey.easting survey.localN survey.localE').lean(),
        TDModel.findOne({ noteId }).lean(), HydraulicsModel.findOne({ noteId }).select('resultsByWell updatedAt').lean(),
        CasingDesign.findOne({ noteId }).select('resultsByWell updatedAt').lean(),
        SlideSheet.find({ noteId }).select('wellKey name summary updatedAt intervals.mode intervals.from intervals.to intervals.len intervals.run').lean() ]);
    let sag = [], ps = [];
    if(note.mtxJobId){ try{ [sag, ps] = await Promise.all([
        SagCorrectionCase.find({ 'inputData.source.mtxJobId': note.mtxJobId }).select('name inputData.source updatedAt').lean(),
        PipeStretchCase.find({ 'inputData.source.mtxJobId': note.mtxJobId }).select('name inputData.source updatedAt').lean() ]); }catch(e){} }
    return { note, trajs, td, hyd, cas, sheets, sag, ps };
}
function wsRunsOf(g, k){
    const p = wsTdPlan(g.td, k);
    return p ? TDModelCore.planActiveRuns(p.plan).map((r, i) => ({ name: r.name || ('Run ' + (i + 1)), mdFrom: r.from, mdTo: r.to, tdScenario: p.scenario, tdRunId: String(r.id != null ? r.id : i),
            bha: r.bha || [], sensor: r.sensor != null && r.sensor !== '' ? +r.sensor : null, bendDeg: r.bendDeg != null && r.bendDeg !== '' ? +r.bendDeg : null, bendDist: r.bendDist != null && r.bendDist !== '' ? +r.bendDist : null })) : [];
}
// 2026-11-15 (C, John): Build / Rebuild uses the trajectory TYPE and PLAN VERSION, the widened "[NN]" rule and the
// assignments already made by hand. Order of rules for each uploaded (non-offset, non-correction) trajectory:
//   1. already assigned to a wellbore (Wells accordion) -> same well name + wellbore name (kept by Rebuild);
//   2. "[NN]" / "[NNx]" name prefix -> well (e.g. [01I], [01P] = SAGD injector / producer, separate wells), same rule
//      as the Legs Summary; wellbore = "_L<NN>" suffix (L01 = main bore);
//   3. no prefix (e.g. a drilled survey named differently from its plan): a 6+ digit number shared with a well
//      found by 1-2 (UWI / licence) -> that well, wellbore from "_L<NN>" or L01; else its own well (name without _L<NN>).
// Inside a wellbore the engineering survey (wellKey) is: the ACTUAL (latest uploaded) > the PLAN with the highest
// version (P5 > P4) > the first one. Runs: T&D plan runs of that survey, else of another survey of the wellbore.
function wsProposal(g, prev){
    prev = prev || {};
    const subj = g.trajs.filter(t => t.wellCategory !== 'offset' && CORR_SOURCES.indexOf(t.source) < 0 && (t.survey || []).length);
    const wells = [], byName = {};
    const legOf = k => { const lm = /_L(\d+)$/i.exec(k); return lm ? 'L' + lm[1].padStart(2, '0') : 'L01'; };
    const add = (t, wellName, wbName, why) => {
        let w = byName[wellName]; if(!w){ w = byName[wellName] = { name: wellName, wellbores: [], tokens: {} }; wells.push(w); }
        (t.wellName.match(/\d{6,}/g) || []).forEach(x => { w.tokens[x] = 1; });
        let b = w.wellbores.find(x => x.name === wbName); if(!b){ b = { name: wbName, trajs: [], members: [] }; w.wellbores.push(b); }
        b.trajs.push(t._id); b.members.push({ t, why });
    };
    const rest = [];
    subj.forEach(t => {
        const p = prev[String(t._id)];
        if(p) return add(t, p.well, p.wb, 'kept assignment');
        const bm = /^(\[\d+[A-Za-z]*\])/.exec(t.wellName.trim());
        if(bm) return add(t, bm[1], legOf(t.wellName), '[NN] prefix');
        rest.push(t);
    });
    rest.forEach(t => {
        const tok = t.wellName.match(/\d{6,}/g) || [], w = wells.find(x => tok.some(k => x.tokens[k]));
        if(w) return add(t, w.name, legOf(t.wellName), 'shared number ' + tok.find(k => w.tokens[k]));
        const lm = /_L(\d+)$/i.exec(t.wellName); add(t, lm ? t.wellName.slice(0, lm.index) : t.wellName, legOf(t.wellName), 'own name');
    });
    const pv = t => { const m = /(\d+)/.exec(t.planVersion || ''); return m ? +m[1] : -1; };
    wells.forEach(w => {
        w.wellbores.forEach(b => {
            const ms = b.members.map(m => m.t), act = ms.filter(t => t.designation === 'actual').sort((a, c) => new Date(c.uploadedDate || 0) - new Date(a.uploadedDate || 0));
            const plans = ms.filter(t => t.designation === 'plan').sort((a, c) => pv(c) - pv(a));
            const eng = act[0] || plans[0] || ms[0];
            b.wellKey = eng.wellName; b.desig = eng.designation || '';
            b.runs = wsRunsOf(g, eng.wellName);
            if(!b.runs.length){ const o = ms.find(t => t !== eng && wsRunsOf(g, t.wellName).length); if(o) b.runs = wsRunsOf(g, o.wellName); }
            b.names = ms.map(t => t.wellName);
            b.why = b.members.map(m => m.t.wellName + ': ' + m.why + (m.t.designation ? ' · ' + m.t.designation + (m.t.planVersion ? ' ' + m.t.planVersion : '') : ' · type not set')).join(' | ');
            delete b.members;
        });
        w.wellbores.sort((a, b) => a.name.localeCompare(b.name));
        // shown name: the "[NN] …" survey name of the main bore without _L<NN> (not a differently named drilled survey)
        const full = [].concat.apply([], w.wellbores.map(x => x.names)).find(n => n.trim().indexOf(w.name) === 0);
        if(/^\[\d+[A-Za-z]*\]$/.test(w.name) && full) w.label = full.trim().replace(/_L\d+$/i, '');
        w.wellbores.forEach(x => { delete x.names; }); delete w.tokens;
    });
    return wells;
}
// previous assignments (trajectory id -> well / wellbore names) so Rebuild keeps what was sorted by hand
async function wsPrevAssign(noteId, trajs){
    const [wells, wbs] = await Promise.all([ WSWell.find({ noteId }).lean(), WSWellbore.find({ noteId }).lean() ]), o = {};
    if(!wbs.length) return o;
    const wById = {}, bById = {}, bByKey = {}; wells.forEach(w => { wById[String(w._id)] = w; }); wbs.forEach(b => { bById[String(b._id)] = b; bByKey[b.wellKey] = b; });
    trajs.forEach(t => { const b = (t.wsWellboreId && bById[String(t.wsWellboreId)]) || bByKey[t.wellName]; const w = b && wById[String(b.wellId)];
        if(b && w) o[String(t._id)] = { well: w.name, wb: b.name }; });
    return o;
}
function wsItems(g, wellKey){   // everything linked to one wellbore, looked up live
    const base = g.trajs.find(t => t.wellName === wellKey && CORR_SOURCES.indexOf(t.source) < 0);
    const esc = wellKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp('^' + esc + ' ');
    const versions = g.trajs.filter(t => t !== base && CORR_SOURCES.indexOf(t.source) >= 0 && (t.baseWellName === wellKey || re.test(t.wellName)))
        .map(t => ({ id: t._id, name: t.wellName, source: t.source, chain: (t.correctionChain || []).map(c => c.tag || c.type), count: t.surveyCount || (t.survey || []).length, date: t.uploadedDate }));
    const mds = base ? (base.survey || []).map(s => s.md).filter(isFinite) : [];
    const p = wsTdPlan(g.td, wellKey), runs = p ? TDModelCore.planActiveRuns(p.plan) : [];
    const hasRes = d => !!(d && d.resultsByWell && d.resultsByWell[wellKey]);
    const tdScen = g.td ? Object.keys(g.td.scenarios || {}).filter(n => { const e = g.td.scenarios[n].resultsByWell && g.td.scenarios[n].resultsByWell[wellKey]; return !!e; }) : [];
    return {
        survey: base ? { id: base._id, name: base.wellName, count: base.surveyCount || mds.length, mdMin: mds.length ? Math.min.apply(null, mds) : null, mdMax: mds.length ? Math.max.apply(null, mds) : null, mds: mds, toolcode: base.toolcode || '', date: base.uploadedDate } : null,
        versions,
        td: { scenarios: tdScen, active: g.td ? g.td.activeScenario || '' : '', planScenario: p ? p.scenario : null,
              runs: runs.map((r, i) => ({ id: String(r.id != null ? r.id : i), name: r.name || ('Run ' + (i + 1)), from: r.from, to: r.to, sensor: r.sensor, bendDeg: r.bendDeg, bendDist: r.bendDist,
                  bha: (r.bha || []).map(c => ({ name: c.name, od_m: c.od_m, id_m: c.id_m, len: c.len, material: c.material || '' })) })) },
        hydraulics: hasRes(g.hyd) ? { updatedAt: g.hyd.updatedAt } : null,
        casing: hasRes(g.cas) ? { updatedAt: g.cas.updatedAt } : null,
        slideSheets: g.sheets.filter(s => s.wellKey === wellKey).map(s => ({ id: s._id, name: s.name, updatedAt: s.updatedAt, summary: s.summary || {},
            slides: (s.intervals || []).filter(i => i.mode === 'slide').map(i => ({ from: i.from, to: i.to, len: i.len, run: i.run || '' })) })),
        sag: g.sag.filter(c => c.inputData && c.inputData.source && c.inputData.source.wellKey === wellKey).map(c => ({ id: c._id, name: c.name, updatedAt: c.updatedAt })),
        stretch: g.ps.filter(c => c.inputData && c.inputData.source && c.inputData.source.wellKey === wellKey).map(c => ({ id: c._id, name: c.name, updatedAt: c.updatedAt })),
    };
}
// GET /notes/wellStructure/:noteId
notesCrtl.getWellStructure = async (req, res) => {
    try{
        const noteId = req.params.noteId, g = await wsGather(noteId);
        const [wells, wbs, runs] = await Promise.all([ WSWell.find({ noteId }).sort({ order: 1 }).lean(), WSWellbore.find({ noteId }).sort({ order: 1 }).lean(), WSRun.find({ noteId }).sort({ order: 1 }).lean() ]);
        const saved = wells.length ? wells.map(w => ({ id: w._id, name: w.name, uwi: w.uwi,
            wellbores: wbs.filter(b => String(b.wellId) === String(w._id)).map(b => ({ id: b._id, name: b.name, wellKey: b.wellKey,
                runs: runs.filter(r => String(r.wellboreId) === String(b._id)).map(r => ({ id: r._id, name: r.name, mdFrom: r.mdFrom, mdTo: r.mdTo, tdScenario: r.tdScenario, tdRunId: r.tdRunId, source: r.source,
                    bha: r.bha || [], sensor: r.sensor, bendDeg: r.bendDeg, bendDist: r.bendDist, bhaUpdatedAt: r.bhaUpdatedAt, tdMissing: !!r.tdMissing })) })) })) : null;
        const proposal = wsProposal(g, await wsPrevAssign(noteId, g.trajs)), keys = {};   // 2026-11-15 (C)
        (saved || []).concat(proposal).forEach(w => w.wellbores.forEach(b => { keys[b.wellKey] = 1; }));
        const items = {}; Object.keys(keys).forEach(k => { items[k] = wsItems(g, k); });
        const wellKeys = g.trajs.filter(t => t.wellCategory !== 'offset' && CORR_SOURCES.indexOf(t.source) < 0).map(t => t.wellName).sort();
        // 2026-11-15 (B): every uploaded (non-offset) trajectory with its type, plan version, assignment and correction versions
        const wbByKey = {}; wbs.forEach(b => { wbByKey[b.wellKey] = String(b._id); });
        const trajList = g.trajs.filter(t => t.wellCategory !== 'offset' && CORR_SOURCES.indexOf(t.source) < 0).map(t => {
            const mds = (t.survey || []).map(x => x.md).filter(isFinite), esc = t.wellName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp('^' + esc + ' ');
            return { id: t._id, name: t.wellName, designation: t.designation || '', planVersion: t.planVersion || '', pad: t.pad || '', toolcode: t.toolcode || '', date: t.uploadedDate,
                wellboreId: t.wsWellboreId ? String(t.wsWellboreId) : (wbByKey[t.wellName] || null), count: t.surveyCount || mds.length,
                mdMin: mds.length ? Math.min.apply(null, mds) : null, mdMax: mds.length ? Math.max.apply(null, mds) : null,
                // 2026-11-15 (phase 3, plan vs actual): [md, N, E, TVD] — grid northing / easting when the file had them, else local N / E
                grid: (t.survey || []).some(x => +x.northing || +x.easting),
                pts: (gr => (t.survey || []).map(x => [+(+x.md).toFixed(2), +(+(gr ? x.northing : x.localN) || 0).toFixed(3), +(+(gr ? x.easting : x.localE) || 0).toFixed(3), +(+x.tvd || 0).toFixed(3)]))((t.survey || []).some(y => +y.northing || +y.easting)),
                versions: g.trajs.filter(v => CORR_SOURCES.indexOf(v.source) >= 0 && (v.baseWellName === t.wellName || (!v.baseWellName && re.test(v.wellName))))
                    .map(v => ({ id: v._id, name: v.wellName, label: wsChainLabel(t, (v.correctionChain && v.correctionChain.length) ? v.correctionChain : [{ tag: { SAGcorrection: 'SAG', PipeStretch: 'PS', ShortCollar: 'SCC', MSA: 'MSA', SSA: 'SSA' }[v.source] || v.source }]), date: v.uploadedDate, count: v.surveyCount })) };
        });
        res.json({ ok: true, job: { id: g.note._id, title: g.note.title, mtxJobId: g.note.mtxJobId || '' }, saved, proposal, items, wellKeys, trajs: trajList,
            canEdit: !!(req.user && req.user.role !== 'viewer') });
    }catch(err){ console.error('[wellStructure] get failed', err); res.status(err.status || 500).json({ ok: false, error: err.message }); }
};
// POST /notes/wellStructure/:noteId/build  -> save the current proposal (replaces this job's structure only)
notesCrtl.buildWellStructure = async (req, res) => {
    try{
        const noteId = req.params.noteId, g = await wsGather(noteId), prop = wsProposal(g, await wsPrevAssign(noteId, g.trajs));   // 2026-11-15 (C): keeps hand assignments
        if(!prop.length) return res.status(400).json({ ok: false, error: 'No subject wells with surveys in this job.' });
        await Promise.all([ WSRun.deleteMany({ noteId }), WSWellbore.deleteMany({ noteId }), WSWell.deleteMany({ noteId }),
            WellboreTrajectory.updateMany({ noteId }, { $set: { wsWellboreId: null } }) ]);   // 2026-11-15 B: assignments rebuilt below
        let nw = 0, nb = 0, nr = 0;
        for(let i = 0; i < prop.length; i++){
            const w = await WSWell.create({ noteId, name: prop[i].label || prop[i].name, order: i, user: req.user ? req.user._id : null }); nw++;
            for(let j = 0; j < prop[i].wellbores.length; j++){ const pb = prop[i].wellbores[j];
                const b = await WSWellbore.create({ noteId, wellId: w._id, name: pb.name, wellKey: pb.wellKey, order: j }); nb++;
                if((pb.trajs || []).length) await WellboreTrajectory.updateMany({ _id: { $in: pb.trajs } }, { $set: { wsWellboreId: b._id } });
                if(pb.runs.length){ await WSRun.insertMany(pb.runs.map((r, k) => ({ noteId, wellboreId: b._id, wellKey: pb.wellKey, name: r.name, order: k, mdFrom: r.mdFrom, mdTo: r.mdTo, tdScenario: r.tdScenario, tdRunId: r.tdRunId, source: 'td',
                    bha: r.bha, sensor: r.sensor, bendDeg: r.bendDeg, bendDist: r.bendDist, bhaUpdatedAt: new Date() }))); nr += pb.runs.length; }
            }
        }
        res.json({ ok: true, wells: nw, wellbores: nb, runs: nr });
    }catch(err){ console.error('[wellStructure] build failed', err); res.status(err.status || 500).json({ ok: false, error: err.message }); }
};

// ================= WELL STRUCTURE — PHASE 2 (ADDED 2026-11-15, John): edit + Run owns the BHA =================
// Ownership rule: the Run is the master of its BHA (bha, sensor, bend). The linked T&D plan run (Run.tdScenario
// || active scenario, Run.tdRunId) holds a mirrored copy because the T&D engine calculates from params.plan:
//   - Wells edits -> wsPushRunToTD() writes name / MD range / BHA / sensor / bend into that plan run (T&D results
//     of that well are NOT recalculated: recalculate in T&D);
//   - every T&D save -> wsSyncFromTD() copies the plan runs of the saved scenario back into the Runs linked to that
//     scenario (new plan runs in the ACTIVE scenario create Runs); a Run whose plan run disappeared is kept with
//     tdMissing = true (its BHA is not lost).
// A Run created by hand when its well has no T&D plan yet stays Wells-only; saving it again once a plan exists
// appends it to the plan, copying WOB / torque at bit from the last plan run (stated choice) or leaving them empty.
function wsPlanOf(doc, scenario, wellKey){
    const sc = doc.scenarios && doc.scenarios[scenario], e = sc && sc.resultsByWell && sc.resultsByWell[wellKey];
    return e && e.params && e.params.plan ? e.params.plan : null;
}
async function wsPushRunToTD(noteId, run){
    const doc = await TDModel.findOne({ noteId }); if(!doc) return { pushed: false, reason: 'no T&D model in this job' };
    if(!doc.scenarios || !Object.keys(doc.scenarios).length) return { pushed: false, reason: 'no T&D scenario' };
    const scenario = run.tdScenario && doc.scenarios[run.tdScenario] ? run.tdScenario : (doc.activeScenario || Object.keys(doc.scenarios)[0]);
    const plan = wsPlanOf(doc, scenario, run.wellKey); if(!plan) return { pushed: false, reason: 'this well has no T&D plan in scenario "' + scenario + '" yet' };
    plan.runs = plan.runs || [];
    let pr = run.tdRunId ? plan.runs.find(x => String(x.id) === String(run.tdRunId)) : null;
    if(!pr){
        const nums = plan.runs.map(x => +x.id).filter(isFinite), last = plan.runs[plan.runs.length - 1] || {};
        pr = { id: nums.length ? Math.max.apply(null, nums) + 1 : Date.now(), use: true, dp: [], wobRot: last.wobRot, wobSlid: last.wobSlid, torqBit: last.torqBit };
        plan.runs.push(pr);
    }
    Object.assign(pr, { name: run.name, from: run.mdFrom, to: run.mdTo, bha: run.bha || [], sensor: run.sensor, bendDeg: run.bendDeg, bendDist: run.bendDist });
    if(scenario === doc.activeScenario) doc.resultsByWell = doc.scenarios[scenario].resultsByWell;   // top level mirrors the active scenario
    doc.markModified('scenarios'); doc.markModified('resultsByWell'); await doc.save();
    return { pushed: true, scenario, tdRunId: String(pr.id) };
}
async function wsSyncFromTD(noteId, scenario, activeScenario, wellKey, plan){
    const wb = await WSWellbore.findOne({ noteId, wellKey }); if(!wb || !plan) return;
    const runs = await WSRun.find({ wellboreId: wb._id }), pruns = plan.runs || [], seen = {};
    const linked = r => r.tdRunId && ((r.tdScenario || activeScenario) === scenario);
    for(let i = 0; i < pruns.length; i++){ const p = pruns[i], id = String(p.id != null ? p.id : i); seen[id] = 1;
        const r = runs.find(x => linked(x) && String(x.tdRunId) === id);
        const upd = { name: p.name || ('Run ' + (i + 1)), mdFrom: p.from, mdTo: p.to, bha: p.bha || [], sensor: p.sensor != null && p.sensor !== '' ? +p.sensor : null,
            bendDeg: p.bendDeg != null && p.bendDeg !== '' ? +p.bendDeg : null, bendDist: p.bendDist != null && p.bendDist !== '' ? +p.bendDist : null, tdMissing: false };
        if(r){ const changed = JSON.stringify(r.bha) !== JSON.stringify(upd.bha); Object.assign(r, upd); if(changed) r.bhaUpdatedAt = new Date(); r.markModified('bha'); await r.save(); }
        else if(scenario === activeScenario && p.use !== false && p.to > p.from){ await WSRun.create(Object.assign({ noteId, wellboreId: wb._id, wellKey, order: runs.length + i, tdScenario: scenario, tdRunId: id, source: 'td', bhaUpdatedAt: new Date() }, upd)); }
    }
    for(const r of runs) if(linked(r) && !seen[String(r.tdRunId)] && !r.tdMissing){ r.tdMissing = true; await r.save(); }
}
notesCrtl.wsAfterTDSave = wsSyncFromTD;   // used by saveTDModel
function wsCleanBha(rows){
    return (Array.isArray(rows) ? rows : []).map(c => {
        const od = +c.od_m, id = +c.id_m, len = +c.len; let wt = +c.wt;
        // weight not given -> plain steel tube mass per metre: 7850 kg/m3 x pi/4 x (OD^2 - ID^2) (geometry only, ignores
        // tool joints / upsets; stated default — enter the real weight for real tools)
        if(!(wt > 0) && od > 0 && id >= 0 && od > id) wt = 7850 * Math.PI / 4 * (od * od - id * id);
        return { name: String(c.name || '').slice(0, 80), od_m: isFinite(od) ? od : null, id_m: isFinite(id) ? id : null, len: isFinite(len) ? len : 0, wt: isFinite(wt) ? +wt.toFixed(3) : null, material: String(c.material || '').slice(0, 40) };
    }).filter(c => c.name || c.len > 0);
}
notesCrtl.wsSaveWell = async (req, res) => {
    try{ const noteId = req.params.noteId, b = req.body || {}; if(!String(b.name || '').trim()) return res.status(400).json({ ok: false, error: 'Name is required.' });
        let w = b.id ? await WSWell.findOne({ _id: b.id, noteId }) : null;
        if(w){ w.name = b.name.trim(); w.uwi = String(b.uwi || '').trim(); await w.save(); }
        else w = await WSWell.create({ noteId, name: b.name.trim(), uwi: String(b.uwi || '').trim(), order: await WSWell.countDocuments({ noteId }), user: req.user ? req.user._id : null });
        res.json({ ok: true, id: w._id });
    }catch(err){ console.error('[wellStructure] save well', err); res.status(500).json({ ok: false, error: err.message }); }
};
notesCrtl.wsDeleteWell = async (req, res) => {   // index only: its wellbores + runs (no survey / T&D data)
    try{ const noteId = req.params.noteId, id = req.params.id, wbs = await WSWellbore.find({ noteId, wellId: id }).select('_id').lean();
        await WellboreTrajectory.updateMany({ noteId, wsWellboreId: { $in: wbs.map(b => b._id) } }, { $set: { wsWellboreId: null } });   // back to "unassigned"
        await WSRun.deleteMany({ noteId, wellboreId: { $in: wbs.map(b => b._id) } }); await WSWellbore.deleteMany({ noteId, wellId: id }); await WSWell.deleteOne({ _id: id, noteId });
        res.json({ ok: true });
    }catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};
notesCrtl.wsSaveWellbore = async (req, res) => {
    try{ const noteId = req.params.noteId, b = req.body || {};
        if(!String(b.name || '').trim() || !String(b.wellKey || '').trim() || !b.wellId) return res.status(400).json({ ok: false, error: 'Well, name and survey well are required.' });
        const dup = await WSWellbore.findOne({ noteId, wellKey: b.wellKey }); if(dup && String(dup._id) !== String(b.id || '')) return res.status(400).json({ ok: false, error: 'That survey well is already used by wellbore "' + dup.name + '".' });
        let wb = b.id ? await WSWellbore.findOne({ _id: b.id, noteId }) : null;
        if(wb){ const keyChanged = wb.wellKey !== b.wellKey; wb.name = b.name.trim(); wb.wellKey = b.wellKey; wb.wellId = b.wellId; await wb.save(); if(keyChanged) await WSRun.updateMany({ wellboreId: wb._id }, { $set: { wellKey: b.wellKey } }); }
        else wb = await WSWellbore.create({ noteId, wellId: b.wellId, name: b.name.trim(), wellKey: b.wellKey, order: await WSWellbore.countDocuments({ noteId, wellId: b.wellId }) });
        res.json({ ok: true, id: wb._id });
    }catch(err){ console.error('[wellStructure] save wellbore', err); res.status(500).json({ ok: false, error: err.message }); }
};
notesCrtl.wsDeleteWellbore = async (req, res) => {
    try{ await WellboreTrajectory.updateMany({ noteId: req.params.noteId, wsWellboreId: req.params.id }, { $set: { wsWellboreId: null } });
        await WSRun.deleteMany({ noteId: req.params.noteId, wellboreId: req.params.id }); await WSWellbore.deleteOne({ _id: req.params.id, noteId: req.params.noteId }); res.json({ ok: true }); }
    catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};
notesCrtl.wsSaveRun = async (req, res) => {
    try{ const noteId = req.params.noteId, b = req.body || {}, from = +b.mdFrom, to = +b.mdTo;
        if(!String(b.name || '').trim()) return res.status(400).json({ ok: false, error: 'Run name is required.' });
        if(!(isFinite(from) && isFinite(to) && to > from)) return res.status(400).json({ ok: false, error: 'MD to must be greater than MD from.' });
        let r = b.id ? await WSRun.findOne({ _id: b.id, noteId }) : null;
        const wb = await WSWellbore.findOne({ _id: r ? r.wellboreId : b.wellboreId, noteId }); if(!wb) return res.status(404).json({ ok: false, error: 'Wellbore not found.' });
        const num = v => v === '' || v == null || !isFinite(+v) ? null : +v;
        const upd = { name: b.name.trim(), mdFrom: from, mdTo: to, bha: wsCleanBha(b.bha), sensor: num(b.sensor), bendDeg: num(b.bendDeg), bendDist: num(b.bendDist), bhaUpdatedAt: new Date() };
        if(r){ r.bhaPrev = { bha: r.bha || [], sensor: r.sensor, bendDeg: r.bendDeg, bendDist: r.bendDist }; r.markModified('bhaPrev'); Object.assign(r, upd); r.markModified('bha'); } else r = new WSRun(Object.assign({ noteId, wellboreId: wb._id, wellKey: wb.wellKey, source: 'manual', order: await WSRun.countDocuments({ wellboreId: wb._id }) }, upd));
        let td = { pushed: false, reason: 'not requested' };
        if(b.pushToTD !== false){ try{ td = await wsPushRunToTD(noteId, r); if(td.pushed){ r.tdScenario = td.scenario; r.tdRunId = td.tdRunId; r.tdMissing = false; } }catch(e){ td = { pushed: false, reason: e.message }; } }
        await r.save();
        res.json({ ok: true, id: r._id, td });
    }catch(err){ console.error('[wellStructure] save run', err); res.status(500).json({ ok: false, error: err.message }); }
};
notesCrtl.wsDeleteRun = async (req, res) => {   // ?td=1 also removes the linked plan run from the T&D plan
    try{ const noteId = req.params.noteId, r = await WSRun.findOne({ _id: req.params.id, noteId }); if(!r) return res.json({ ok: true });
        let tdRemoved = false;
        if(req.query.td === '1' && r.tdRunId){ const doc = await TDModel.findOne({ noteId });
            if(doc && doc.scenarios){ const sc = r.tdScenario && doc.scenarios[r.tdScenario] ? r.tdScenario : doc.activeScenario, plan = wsPlanOf(doc, sc, r.wellKey);
                if(plan && plan.runs){ const n = plan.runs.length; plan.runs = plan.runs.filter(x => String(x.id) !== String(r.tdRunId)); tdRemoved = plan.runs.length < n;
                    if(tdRemoved){ if(sc === doc.activeScenario) doc.resultsByWell = doc.scenarios[sc].resultsByWell; doc.markModified('scenarios'); doc.markModified('resultsByWell'); await doc.save(); } } } }
        await WSRun.deleteOne({ _id: r._id });
        res.json({ ok: true, tdRemoved });
    }catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};

// ================= WELL STRUCTURE — B (ADDED 2026-11-15, John): assign uploaded trajectories to wellbores =================
// POST /notes/wellStructure/:noteId/assign { trajId, designation: 'plan'|'actual'|'', planVersion?,
//   wellboreId | null (unassign) | newWell: { name, uwi } and/or newWellbore: { wellId?, name } (created with this
//   trajectory as its engineering survey, i.e. Wellbore.wellKey = trajectory name) , useForEngineering? }
// Only the link / type fields of the trajectory change — never its survey.
notesCrtl.wsAssignTraj = async (req, res) => {
    try{
        const noteId = req.params.noteId, b = req.body || {};
        const t = await WellboreTrajectory.findOne({ _id: b.trajId, noteId }).select('wellName pad source wellCategory designation planVersion wsWellboreId');
        if(!t) return res.status(404).json({ ok: false, error: 'Trajectory not found.' });
        if(CORR_SOURCES.indexOf(t.source) >= 0) return res.status(400).json({ ok: false, error: 'Correction versions follow their base survey.' });
        if(b.designation != null) t.designation = ['plan', 'actual'].indexOf(b.designation) >= 0 ? b.designation : '';
        if(b.planVersion != null) t.planVersion = String(b.planVersion).trim().toUpperCase().slice(0, 12);
        else if(t.designation === 'plan' && !t.planVersion){ const m = /\[\s*(P\d+)\s*[-\]]/i.exec(t.pad || ''); if(m) t.planVersion = m[1].toUpperCase(); }
        let wb = null;
        if(b.newWell || b.newWellbore){
            if(await WSWellbore.findOne({ noteId, wellKey: t.wellName })) return res.status(400).json({ ok: false, error: 'This survey is already the engineering survey of a wellbore.' });
            let wellId = b.newWellbore && b.newWellbore.wellId;
            if(b.newWell){ const nm = String(b.newWell.name || '').trim(); if(!nm) return res.status(400).json({ ok: false, error: 'Well name is required.' });
                const w = await WSWell.create({ noteId, name: nm, uwi: String(b.newWell.uwi || '').trim(), order: await WSWell.countDocuments({ noteId }), user: req.user ? req.user._id : null }); wellId = w._id; }
            if(!wellId) return res.status(400).json({ ok: false, error: 'Pick a well.' });
            const lm = /_L(\d+)$/i.exec(t.wellName), nm2 = String((b.newWellbore && b.newWellbore.name) || (lm ? 'L' + lm[1].padStart(2, '0') : 'L01')).trim();
            wb = await WSWellbore.create({ noteId, wellId, name: nm2, wellKey: t.wellName, order: await WSWellbore.countDocuments({ noteId, wellId }) });
        } else if(b.wellboreId){
            wb = await WSWellbore.findOne({ _id: b.wellboreId, noteId }); if(!wb) return res.status(404).json({ ok: false, error: 'Wellbore not found.' });
        }
        if(!wb && b.wellboreId === null){   // unassign
            const own = await WSWellbore.findOne({ noteId, wellKey: t.wellName });
            if(own) return res.status(400).json({ ok: false, error: 'This survey is the engineering survey of wellbore "' + own.name + '". Pick another survey for engineering first.' });
            t.wsWellboreId = null;
        } else if(wb) t.wsWellboreId = wb._id;
        await t.save();
        // "use for engineering": the wellbore's link to T&D / Hydraulics / Casing / Slide Sheet / corrections (wellKey)
        if(wb && b.useForEngineering && wb.wellKey !== t.wellName){
            const other = await WSWellbore.findOne({ noteId, wellKey: t.wellName });
            if(other && String(other._id) !== String(wb._id)) return res.status(400).json({ ok: false, error: 'That survey is the engineering survey of wellbore "' + other.name + '".' });
            wb.wellKey = t.wellName; await wb.save(); await WSRun.updateMany({ wellboreId: wb._id }, { $set: { wellKey: t.wellName } });
        }
        res.json({ ok: true, wellboreId: wb ? wb._id : null });
    }catch(err){ console.error('[wellStructure] assign', err); res.status(500).json({ ok: false, error: err.message }); }
};

// 2026-11-15 (phase 3): see saveTDModel — keep the Run's BHA when the incoming plan run still carries Run.bhaPrev
notesCrtl.wsGuardStale = async function(noteId, scenario, activeScenario, wellKey, plan){
    if(!plan || !(plan.runs || []).length) return [];
    const wb = await WSWellbore.findOne({ noteId, wellKey }); if(!wb) return [];
    const runs = await WSRun.find({ wellboreId: wb._id, bhaPrev: { $ne: null } }).lean(), kept = [];
    const sig = o => JSON.stringify({ b: (o.bha || []).map(c => [c.name, +c.od_m || 0, +c.id_m || 0, +c.len || 0]), s: o.sensor == null || o.sensor === '' ? null : +o.sensor, d: o.bendDeg == null || o.bendDeg === '' ? null : +o.bendDeg, l: o.bendDist == null || o.bendDist === '' ? null : +o.bendDist });
    plan.runs.forEach(p => {
        const r = runs.find(x => x.tdRunId && String(x.tdRunId) === String(p.id) && (x.tdScenario || activeScenario) === scenario); if(!r) return;
        if(sig(p) === sig(r.bhaPrev) && sig(p) !== sig(r)){ p.bha = r.bha; p.sensor = r.sensor; p.bendDeg = r.bendDeg; p.bendDist = r.bendDist; kept.push(p.name || String(p.id)); }
    });
    return kept;
};

// ================= WELL STRUCTURE — per-run Torque & Drag, LIVE (ADDED 2026-11-15, John) =================
// GET /notes/wellStructure/:noteId/runTD/:runId -> T&D of ONE run, computed on request with the shared engine
// (public/js/tdModel.js, same module as the T&D page and recalculateTDModel), never saved:
//   - inputs = the T&D entry saved for the run's well in the run's scenario (casings, params, plan); the plan run's
//     BHA / sensor / bend are taken from the Run (it owns them; they are mirrored in the plan anyway);
//   - snapshot (Effective Tension, Side Force, Torque) with the bit at the END of the run (plan.snapMode 'auto',
//     snapRunId = the run) — engine rule tdPlanSnapshot;
//   - Hook Load vs Bit Depth only for the bit depths this run drills (rows of tdComputeHookloadPlan with runId = run).
// Units as the job page T&D accordion: kDaN (kN x 0.1), N.m; side force engine kgf/m x normLen -> kgf per
// normalization length (params.normLen, default 9.45 m), the convention the T&D charts are labelled with.
function wsTdEntry(doc, scenario, wellKey){
    if(!doc) return null;
    const sc = doc.scenarios && doc.scenarios[scenario], e = sc && sc.resultsByWell && sc.resultsByWell[wellKey];
    return e || (doc.resultsByWell && doc.resultsByWell[wellKey]) || null;
}
async function wsSurvey(noteId, wellKey, td){
    const traj = await WellboreTrajectory.findOne({ noteId, wellName: wellKey }).select('survey.md survey.incl survey.azim').lean();
    let surv = traj && traj.survey ? traj.survey.map(s => ({ md: s.md, inc: s.incl, az: s.azim })).filter(r => isFinite(r.md) && r.md >= 0).sort((a, b) => a.md - b.md) : [];
    if(surv.length >= 2 && td && surv[surv.length - 1].md < td){ const l = surv[surv.length - 1]; surv = surv.concat([{ md: td, inc: l.inc, az: l.az }]); }   // same as recalculateTDModel
    return surv;
}
notesCrtl.wsRunTD = async (req, res) => {
    try{
        const noteId = req.params.noteId, run = await WSRun.findOne({ _id: req.params.runId, noteId }).lean();
        if(!run) return res.status(404).json({ ok: false, error: 'Run not found.' });
        const doc = await TDModel.findOne({ noteId }).lean(); if(!doc) return res.json({ ok: false, error: 'No T&D model in this job yet.' });
        const scenario = run.tdScenario || doc.activeScenario || 'Default', e = wsTdEntry(doc, scenario, run.wellKey);
        if(!e || !e.params || !e.params.plan) return res.json({ ok: false, error: 'No T&D plan for this well in scenario "' + scenario + '". Open the T&D modeler, add the runs and save.' });
        const plan = JSON.parse(JSON.stringify(e.params.plan)), pr = (plan.runs || []).find(x => String(x.id) === String(run.tdRunId));
        if(!pr) return res.json({ ok: false, error: 'This run is not in the T&D plan (scenario "' + scenario + '"). Save it from the Wells accordion to add it.' });
        if((run.bha || []).length){ pr.bha = run.bha; pr.sensor = run.sensor; pr.bendDeg = run.bendDeg; pr.bendDist = run.bendDist; }
        pr.use = true;
        if(!((pr.bha || []).length || (pr.dp || []).length)) return res.json({ ok: false, error: 'This run has no BHA yet.' });
        plan.snapMode = 'auto'; plan.snapRunId = pr.id;
        const params = Object.assign({}, e.params, { plan }), casings = e.casings || [];
        const surv = await wsSurvey(noteId, run.wellKey, params.td);
        if(surv.length < 2) return res.json({ ok: false, error: 'The well has fewer than 2 survey stations.' });
        const r_ = TDModelCore.computeModel(surv, casings, e.bha || [], params);
        const hl = TDModelCore.computeHookload(surv, casings, e.bha || [], params).filter(x => String(x.runId) === String(pr.id));
        const nl = +params.normLen || 9.45, k = 0.1;
        const results = {
            mds: r_.map(x => x.md),
            etTI: r_.map(x => x.etTripIn * k), etTO: r_.map(x => x.etTripOut * k), etROB: r_.map(x => x.etRotOB * k), etSLD: r_.map(x => x.etSlide * k), etROff: r_.map(x => x.etRotOff * k),
            tqROB: r_.map(x => x.torqRotOB), tqROff: r_.map(x => x.torqRotOff), tqSLD: r_.map(x => x.torqSlide), tqTI: r_.map(x => x.torqTripIn), tqTO: r_.map(x => x.torqTripOut),
            sfROB: r_.map(x => x.sfRotOB * nl), sfSLD: r_.map(x => x.sfSlide * nl), sfROff: r_.map(x => x.sfRotOff * nl), sfTO: r_.map(x => x.sfTripOut * nl), sfTI: r_.map(x => x.sfTripIn * nl),
            incArr: r_.map(x => x.inc), dlsArr: r_.map(x => x.dls),
            hlMDs: hl.map(x => x.md), hlTI: hl.map(x => x.hl_tripIn * k), hlTO: hl.map(x => x.hl_tripOut * k), hlROB: hl.map(x => x.hl_rotOB * k), hlSLD: hl.map(x => x.hl_slide * k), hlROff: hl.map(x => x.hl_rotOff * k),
            torqLimDisp: params.torqLim, depU: 'm', forU: 'kDaN', tqU: 'N.m', normLen: nl,
        };
        const sec = TDModelCore.planSectionAt(plan, (pr.from + pr.to) / 2) || {};
        res.json({ ok: true, scenario, wellKey: run.wellKey, run: { name: pr.name, from: pr.from, to: pr.to, wobRot: pr.wobRot, wobSlid: pr.wobSlid, torqBit: pr.torqBit, bhaParts: (pr.bha || []).length },
            snapshot: r_.snapshot || null, section: { name: sec.name, hole_m: sec.hole_m, mudDens: sec.mudDens, ffOH: sec.ffOH }, ff: { ff1: params.ff1, ff2: params.ff2, ffOH: params.ffOH },
            casings, params: { td: params.td, ohDiam_m: params.ohDiam_m, ohTop: params.ohTop, normLen: nl }, results, calculatedAt: new Date() });
    }catch(err){ console.error('[wellStructure] run T&D', err); res.status(500).json({ ok: false, error: err.message }); }
};
// GET /notes/wellStructure/:noteId/wbTD?wellKey= -> casings + hole params + inclination (for the wellbore geometry schematic)
notesCrtl.wsWellboreTD = async (req, res) => {
    try{
        const noteId = req.params.noteId, wellKey = String(req.query.wellKey || ''), scenarioQ = String(req.query.scenario || '');
        const doc = await TDModel.findOne({ noteId }).lean(); if(!doc) return res.json({ ok: false, error: 'No T&D model in this job yet.' });
        const scenario = scenarioQ || doc.activeScenario || 'Default', e = wsTdEntry(doc, scenario, wellKey);
        if(!e || !e.params) return res.json({ ok: false, error: 'No T&D inputs (casings / hole) for this well in scenario "' + scenario + '".' });
        const surv = await wsSurvey(noteId, wellKey, null);
        const plan = e.params.plan || {};   // 2026-11-15: hole sections + BHA runs bar of the wellbore (same data as the T&D page "Hole sections & BHA runs")
        res.json({ ok: true, scenario, casings: e.casings || [], params: { td: e.params.td, ohDiam_m: e.params.ohDiam_m, ohTop: e.params.ohTop }, inc: { mds: surv.map(s => s.md), incArr: surv.map(s => s.inc) },
            sections: (plan.sections || []).map(x => ({ name: x.name, from: +x.from, to: +x.to, hole_m: x.hole_m, mudDens: x.mudDens, ffOH: x.ffOH })),
            runs: (plan.runs || []).map(x => ({ id: x.id, name: x.name, from: +x.from, to: +x.to, use: x.use !== false, bhaParts: (x.bha || []).length })) });
    }catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};

// 2026-11-15 (John): survey stations of one trajectory (original or a corrected version) between two MDs, for the
// run "Surveys" table in the Wells accordion. GET /notes/wellStructure/:noteId/stations?id=&from=&to= (read-only).
notesCrtl.wsStations = async (req, res) => {
    try{
        const noteId = req.params.noteId, from = req.query.from === '' || req.query.from == null ? -Infinity : +req.query.from, to = req.query.to === '' || req.query.to == null ? Infinity : +req.query.to;
        const t = await WellboreTrajectory.findOne({ _id: req.query.id, noteId }).select('wellName source correctionChain toolcode survey').lean();
        if(!t) return res.status(404).json({ ok: false, error: 'Trajectory not found.' });
        const rows = (t.survey || []).filter(s => s.md >= from - 1e-6 && s.md <= to + 1e-6).sort((a, b) => a.md - b.md)
            .map(s => ({ md: s.md, incl: s.incl, azim: s.azim, tvd: s.tvd, subSea: s.subSea, vertSec: s.vertSec, localN: s.localN, localE: s.localE, dogleg: s.dogleg, northing: s.northing, easting: s.easting, comments: s.comments || '', interp: !!s.interp }));
        res.json({ ok: true, name: t.wellName, label: wsChainLabel(t, t.correctionChain), rows });
    }catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};

// ================= DRILLING MECHANICS — ROP vs OFFSETS (ADDED 2026-11-20, John) =================
// GET /notes/pasonOffsets/:noteId?ids=2188,2214  -> for each offset job: its Pason ROP rows ([md, avg, max, min]) and the
// SC / IC / TD milestones of its first subject well (same survey comment keywords as the job page score cards /
// Time vs Depth: "SURFACECASING" (spaces ignored), "ICP" / "IntermediateCasing", last station = TD). Offsets = the MTX IDs
// given, else up to 15 other jobs of the SAME AREA that have Pason plots. The client computes the section ROP with the
// same curve (Min / Avg / Max) and length-weighted mean as for this job. Read-only.
notesCrtl.getPasonOffsets = async (req, res) => {
    try{
        const me = await Note.findById(req.params.noteId).select('area mtxJobId').lean(); if(!me) return res.status(404).json({ ok: false, error: 'Job not found.' });
        const ids = String(req.query.ids || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 30);
        let notes;
        if(ids.length) notes = await Note.find({ mtxJobId: { $in: ids }, _id: { $ne: me._id } }).select('_id mtxJobId title area project').lean();
        else{
            if(!me.area) return res.json({ ok: true, mode: 'area', area: '', offsets: [], note: 'This job has no Area — enter offset MTX IDs.' });
            const withPason = await PasonPlots.find({ 'plots.rop': { $exists: true } }).select('noteId').lean(), set = withPason.map(p => p.noteId);
            notes = await Note.find({ _id: { $in: set, $ne: me._id }, area: me.area }).select('_id mtxJobId title area project').sort({ updatedAt: -1 }).limit(15).lean();
        }
        const out = [];
        for(const n of notes){
            const pp = await PasonPlots.findOne({ noteId: n._id }).select('plots.rop').lean();
            const rop = pp && pp.plots && pp.plots.rop; if(!rop || !(rop.rows || []).length) continue;
            const trajs = await WellboreTrajectory.find({ noteId: n._id, wellCategory: { $ne: 'offset' }, source: { $nin: CORR_SOURCES } }).select('wellName survey.md survey.comments').lean();
            const t = trajs.filter(x => (x.survey || []).length).sort((a, b) => (/_L0?1$/i.test(b.wellName) - /_L0?1$/i.test(a.wellName)) || a.wellName.localeCompare(b.wellName))[0];
            let sc = null, ic = null, td = null;
            if(t){ t.survey.forEach(p => { const c = String(p.comments || '').trim(); if(sc == null && /^SURFACECASING/i.test(c.replace(/\s+/g, ''))) sc = +p.md; if(ic == null && /^(ICP|IntermediateCasing)/i.test(c)) ic = +p.md; }); td = +t.survey[t.survey.length - 1].md; }
            out.push({ noteId: n._id, mtxJobId: n.mtxJobId || '', title: n.title || '', project: n.project || '', wellName: t ? t.wellName : '', sc, ic, td, rows: rop.rows });
        }
        res.json({ ok: true, mode: ids.length ? 'ids' : 'area', area: me.area || '', offsets: out });
    }catch(err){ console.error('[pasonOffsets]', err); res.status(500).json({ ok: false, error: err.message }); }
};

// ================= SLIDE / ROTATE TIME MODEL (ADDED 2026-11-20, John) — Time vs Depth for PLANNED wells =================
// GET /notes/slideOffsets/:noteId?ids=  -> saved Slide Sheets (models/SlideSheet.js) of offset jobs: the MTX IDs given, else
// up to 20 other jobs of the same Area. Main-leg intervals only (mode, from, to, len, rop) + the SC / IC / TD milestones of the
// sheet's well (survey comments, same keywords as the score cards) so each source is split into its OWN sections.
notesCrtl.getSlideOffsets = async (req, res) => {
    try{
        const me = await Note.findById(req.params.noteId).select('area').lean(); if(!me) return res.status(404).json({ ok: false, error: 'Job not found.' });
        const ids = String(req.query.ids || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 30);
        let notes;
        if(ids.length) notes = await Note.find({ mtxJobId: { $in: ids }, _id: { $ne: me._id } }).select('_id mtxJobId title').lean();
        else{
            if(!me.area) return res.json({ ok: true, sources: [], note: 'This job has no Area — enter offset MTX IDs.' });
            const withSS = await SlideSheet.distinct('noteId');
            notes = await Note.find({ _id: { $in: withSS, $ne: me._id }, area: me.area }).select('_id mtxJobId title').sort({ updatedAt: -1 }).limit(20).lean();
        }
        const out = [];
        for(const n of notes){
            const sheets = await SlideSheet.find({ noteId: n._id }).select('wellKey name intervals.mode intervals.leg intervals.from intervals.to intervals.len intervals.rop').lean();
            for(const sh of sheets){
                const t = await WellboreTrajectory.findOne({ noteId: n._id, wellName: sh.wellKey }).select('survey.md survey.comments').lean();
                let sc = null, ic = null, td = null;
                if(t && (t.survey || []).length){ t.survey.forEach(p => { const c = String(p.comments || '').trim(); if(sc == null && /^SURFACECASING/i.test(c.replace(/\s+/g, ''))) sc = +p.md; if(ic == null && /^(ICP|IntermediateCasing)/i.test(c)) ic = +p.md; }); td = +t.survey[t.survey.length - 1].md; }
                out.push({ type: 'Slide Sheet', name: (n.mtxJobId ? n.mtxJobId + ' · ' : '') + sh.name, mtxJobId: n.mtxJobId || '', wellKey: sh.wellKey, sc, ic, td,
                    intervals: (sh.intervals || []).filter(i => !i.leg || i.leg === 'Main').map(i => ({ mode: i.mode, from: i.from, to: i.to, len: i.len, rop: i.rop })) });
            }
        }
        res.json({ ok: true, sources: out });
    }catch(err){ console.error('[slideOffsets]', err); res.status(500).json({ ok: false, error: err.message }); }
};
// POST /notes/pasonSlideModel/:noteId { model } -> saved on this job's PasonPlots document (created if missing). Not viewer.
notesCrtl.savePasonSlideModel = async (req, res) => {
    try{
        const m = req.body && req.body.model; if(m !== null && (typeof m !== 'object' || !Array.isArray(m.sources))) return res.status(400).json({ ok: false, error: 'Invalid model.' });
        if(m && JSON.stringify(m).length > 2e6) return res.status(400).json({ ok: false, error: 'Model too large.' });
        if(m){ m.savedAt = new Date(); m.savedBy = req.user ? (req.user.name || '') : ''; }
        await PasonPlots.findOneAndUpdate({ noteId: req.params.noteId }, { $set: { slideRotModel: m }, $setOnInsert: { plots: {} } }, { upsert: true });
        res.json({ ok: true });
    }catch(err){ res.status(500).json({ ok: false, error: err.message }); }
};

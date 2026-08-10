// Al igual que index.controller.js, en este archivo se definen las funciones
// que despues seran llamadas desde notes.routes.js

const notesCrtl = {};
const Note = require('../models/NoteConveyor');
const User = require('../models/User');
const Job = require('../models/MTXjobNumber');
const Log = require('../models/LogConveyor');
const ImageMirelleDog = require('../models/ImageMirelleDog');
const NewSchedule = require("../models/NewSchedule");
const DPStats = require("../models/DPStats");
const WellboreTrajectory = require("../models/WellboreTrajectory");
const TDModel = require("../models/TDModel");
const TDModelCore = require("../public/js/tdModel.js");
const HydraulicsModel = require("../models/HydraulicsModel");
const HydraulicsModelCore = require("../public/js/hydraulicsModel.js");
const CasingDesign = require("../models/CasingDesign");
const CasingLoadCasesCore = require("../public/js/casingLoadCases.js");
const PasonPlots = require("../models/PasonPlots");
const PadAC       = require("../models/PadAC");
const SiteConfig    = require("../models/SiteConfig");




const path = require('path');
const {unlink} = require('fs-extra');
const cloudinary = require('cloudinary');
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

let nodemailer = require('nodemailer');





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
    res.render('new-note.ejs', {jn, jnID, user});
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
    const NOTE_FIELDS = '_id mtxJobId title customerJobNumber project area wells poc geologist rig group dueDate status responsible customer budget created updatedAt trajWells trajAvgDDI trajAvgSteerIndex batchDays';

    const [notes, dpStats, newSchedule] = await Promise.all([
        Note.find().sort({ dueDate: 'asc' }).select(NOTE_FIELDS).lean(),
        DPStats.find().lean(),
        NewSchedule.findOne().populate('user','name').lean(),
    ]);
    res.render('all-notes.ejs', {notes, user, dpStats, newSchedule, count_InProgress, count_NotStarted, count_NotStarted_setup});
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






notesCrtl.renderQueryNotesPartial = async (req,res)=>{
    let user = {}
    user.id = req.params.guest
    let donde = req.query.where
    let buscar = req.query.search
    user.id = req.session.passport.user
    let usuario = await User.findById(user.id);
        user.name = usuario.name
        user.email = usuario.email
        user.role = usuario.role
        user.rank = usuario.rank
        user.list = usuario.list

    console.log("Partial...");

    const notes = await Note.find({ "$or": [
        { "title": { $regex: buscar, $options: "i" } },
        { "description": { $regex: buscar, $options: "i" } },
        { "mtxJobId": { $regex: buscar, $options: "i" } },
        { "responsible": { $regex: buscar, $options: "i" } },
        { "customer": { $regex: buscar, $options: "i" } },
        { "customerJobNumber": { $regex: buscar, $options: "i" } },
        { "operator": { $regex: buscar, $options: "i" } },
        { "priority": { $regex: buscar, $options: "i" } },
        { "invoice": { $regex: buscar, $options: "i" } },
        { "user": { $regex: buscar, $options: "i" } },
        { "status": { $regex: buscar, $options: "i" } },
        { "dueDate": { $regex: buscar, $options: "i" } },
        { "rig": { $regex: buscar, $options: "i" } },
        { "project": { $regex: buscar, $options: "i" } },
        { "poc": { $regex: buscar, $options: "i" } },
        { "geologist": { $regex: buscar, $options: "i" } },
        { "wells": { $regex: buscar, $options: "i" } },
        { "area": { $regex: buscar, $options: "i" } },
        { "budget": { $regex: buscar, $options: "i" } },
        { "created": { $regex: buscar, $options: "i" } },
    ]});
    console.log(notes);
    res.render('queryPartial.ejs', {notes, user, donde, buscar});
};







notesCrtl.renderEditForm = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    const wellboreTrajectories = await WellboreTrajectory.find({noteId: note._id}).select('-survey').sort({wellName: 1});
    res.render('edit-note.ejs', {note, user, wellboreTrajectories});
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
    });
    req.flash('success_msg','Note updated successfully');
    res.redirect('/notes');
}







notesCrtl.deleteNote = async (req,res)=>{
    let id = req.params.id
    const note = await Note.findById(id)    
    if(note.imageID){
        await cloudinary.v2.uploader.destroy(note.imageID)
        await ImageMirelleDog.findByIdAndDelete(note.noteImageID);
    };
    await Note.findByIdAndDelete(req.params.id); 
    req.flash('success_msg','Note deleted successfully');
    res.redirect('/notes');
}








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
    res.render('job.ejs', {note, user, log, wellboreTrajectories, pasonPlots, tdModel, hydraulicsModel, casingDesign})
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
            await ImageMirelleDog.findByIdAndDelete(note.noteImageID);
            await Note.findByIdAndUpdate(note._id, {
                path: "",
                imageID: "",
                noteImageID: "",
            });
        }   
        // Subir la nueva imagen
        const image = new ImageMirelleDog();
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
        let noteWhereImageIsSaved = await ImageMirelleDog.findOne({'public_id': image.public_id});
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
        await ImageMirelleDog.findByIdAndDelete(note.noteImageID);
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
      project: { $regex: `^${site}`, $options: "i" }
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
];
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

    res.json({ message: "Sync complete", updated: updatedCount });

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

    res.json({
      success: true, savedResults: hasResults, wellKey, scenario: scenarioName,
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
    try {
        const { bannerUrl } = req.body;
        await SiteConfig.findOneAndUpdate(
            { key: 'bannerUrl' },
            { key: 'bannerUrl', value: bannerUrl || '', updatedBy: req.user._id, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch(e) {
        console.error('saveBanner:', e);
        res.status(500).json({ error: e.message });
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
        res.json({ success: true, rows: rows.length, columns: headers.length });
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
    const { data, wellCategory, toolcode } = req.body;

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

    const docs = data.map(well => ({
      noteId: noteId,
      wellName: well.wellName || "",
      source: well.source || "",
      pad: well.pad || "",
      colorHex: well.colorHex || "",
      wellCategory: (well.wellCategory === 'subject' || well.wellCategory === 'offset') ? well.wellCategory : batchCategory,
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
      center: { x: s.easting, y: -s.tvd, z: -s.northing },
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
        center: { x: east, y: -tvd, z: -north },
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

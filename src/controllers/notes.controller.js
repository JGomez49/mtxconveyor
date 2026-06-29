// Al igual que index.controller.js, en este archivo se definen las funciones
// que despues seran llamadas desde notes.routes.js

const notesCrtl = {};
const Note = require('../models/NoteConveyor');
const User = require('../models/User');
const Job = require('../models/MTXjobNumber');
const Log = require('../models/LogConveyor');
const ImageMirelleDog = require('../models/ImageMirelleDog');
const Schedule = require("../models/Schedule");
const DPStats = require("../models/DPStats");
const WellboreTrajectory = require("../models/WellboreTrajectory");
const PadAC       = require("../models/PadAC");

//const ScheduleETS = require("../models/ScheduleETS");



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
    const NOTE_FIELDS = '_id mtxJobId title customerJobNumber project area wells poc geologist rig group dueDate status responsible customer budget created updatedAt trajWells trajAvgDDI trajAvgSteerIndex';

    const [notes, schedule, dpStats] = await Promise.all([
        Note.find().sort({ dueDate: 'asc' }).select(NOTE_FIELDS).lean(),
        Schedule.find().populate('user','name').lean(),
        DPStats.find().lean(),
    ]);
    res.render('all-notes.ejs', {notes, user, schedule, dpStats, count_InProgress, count_NotStarted, count_NotStarted_setup});
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
    res.render('job.ejs', {note, user, log, wellboreTrajectories})
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








notesCrtl.renderUploadSchedule = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadSchedule.ejs', {note, user});
}






notesCrtl.uploadSchedule = async (req, res) => {
  try {
    await Schedule.deleteMany({});
    console.log("Cleared existing schedule data.");

    const { data } = req.body;

    if (!data || !Array.isArray(data) || data.length <= 1) {
      return res.status(400).json({ error: "No schedule data received" });
    }

    console.log(`uploadSchedule: received ${data.length} rows (including header)`);
    if (data[1]) {
      console.log(`uploadSchedule: row[1] sample: rig=${data[1][0]}, primaryZone=${data[1][16]}, tvd=${data[1][17]}, target=${data[1][18]}`);
    }

    // Remove header row — data rows start at index 1
    const rows = data.slice(1);

    // FIELD_ORDER from uploadSchedule.ejs:
    // [0]=rig [1]=drillok [2]=geook [3]=duration [4]=dp [5]=type
    // [6]=vp [7]=start [8]=site [9]=well [10]=dpCompany [11]=ETS
    // [12]=group [13]=dpReq [14]=geo [15]=version
    // [16]=dpReceivedDate [17]=primaryZone [18]=tvd [19]=target
    // [20]=province [21]=playType [22]=afeYear [23]=prospectName
    // [24]=bhLocation [25]=surfLocation [26]=license [27]=drillingSuper
    // [28]=geolApprovalDate [29]=surfaceLat [30]=surfaceLon
    const scheduleDocs = rows.map((row) => ({
      rig:              row[0]  || "",
      drillok:          row[1]  || "",
      geook:            row[2]  || "",
      duration:         Number(row[3]) || 0,
      dp:               row[4]  || "",
      type:             row[5]  || "",
      vp:               row[6]  || "",
      start:            row[7]  ? new Date(row[7]) : null,
      site:             row[8]  || "",
      well:             row[9]  || "",
      dpCompany:        row[10] || "",
      ETS:              row[11] || "",
      group:            row[12] || "",
      dpReq:            row[13] || "",
      geo:              row[14] || "",
      version:          row[15] || "",
      dpReceivedDate:   row[16] || "",
      primaryZone:      row[17] || "",
      tvd:              row[18] ? Number(row[18]) : null,
      target:           row[19] || "",
      province:         row[20] || "",
      playType:         row[21] || "",
      afeYear:          row[22] || "",
      prospectName:     row[23] || "",
      bhLocation:       row[24] || "",
      surfLocation:     row[25] || "",
      license:          row[26] || "",
      drillingSuper:    row[27] || "",
      geolApprovalDate: row[28] ? new Date(row[28]) : null,
      surfaceLat:       row[29] ? Number(row[29]) : null,
      surfaceLon:       row[30] ? Number(row[30]) : null,
      user: req.user ? req.user._id : null,
    }));

    await Schedule.insertMany(scheduleDocs);
    console.log(`uploadSchedule: saved ${scheduleDocs.length} documents`);
    console.log(`uploadSchedule: sample doc primaryZone=${scheduleDocs[0]?.primaryZone}, tvd=${scheduleDocs[0]?.tvd}`);

    req.flash("success_msg", "Schedule uploaded successfully");
    res.redirect("/notes");
  } catch (error) {
    console.error("Error uploading schedule:", error);
    req.flash("error_msg", "Error uploading schedule");
    res.redirect("/notes");
  }
};







// GET /notes/findSite/:site
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

    // Render job page with the single note
    res.render("job.ejs", { note: project, user, log, wellboreTrajectories });

  } catch (err) {
    console.error("Error in findSite:", err);
    res.status(500).json({ error: "Server error" });
  }
};








// GET /notes/getScheduleAndNotes
notesCrtl.getScheduleAndNotes = async (req, res) => {
  try {
    // Fetch everything
    const schedule = await Schedule.find({}).lean();
    const notes = await Note.find({}).lean();

    res.json({ schedule, notes });
  } catch (err) {
    console.error("Error in getScheduleAndNotes:", err);
    res.status(500).json({ error: "Server error" });
  }
};






// Sync dueDate and rig from Schedule → Notes
notesCrtl.syncDueDates = async (req, res) => {
  try {
    console.log("🔄 Syncing Notes.dueDate and Notes.rig with Schedule...");

    // Load Notes and Schedule
    const notes = await Note.find().lean();
    const schedule = await Schedule.find().lean();

    // Build a map of schedule sites → { start (earliest), rig, group }
    // A pad has multiple wells with different start dates — we want the
    // earliest start date so the table shows when the pad first spuds.
    const scheduleMap = {};
    schedule.forEach(sch => {
      if (sch.site && sch.start) {
        const key     = sch.site.slice(0, 14);
        const schDate = new Date(sch.start);
        if (isNaN(schDate)) return;

        if (!scheduleMap[key]) {
          // First row for this key — initialise
          scheduleMap[key] = {
            start: schDate,
            rig:   sch.rig   || null,
            group: sch.group || null,
          };
        } else {
          // Subsequent rows — keep the earliest start date AND its rig + group
          if (schDate < scheduleMap[key].start) {
            scheduleMap[key].start = schDate;
            scheduleMap[key].rig   = sch.rig   || scheduleMap[key].rig;
            scheduleMap[key].group = sch.group || scheduleMap[key].group;
          }
        }
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







notesCrtl.renderUploadScheduleETS = async(req,res)=>{
    // res.send('Edit note...');
    let user = await User.findById(req.session.passport.user);
    const note = await Note.findById(req.params.id);
    res.render('uploadScheduleETS.ejs', {note, user});
}







// POST /notes/uploadScheduleETS
notesCrtl.uploadScheduleETS = async (req, res) => {
  try {
    // Clear the entire collection before saving new data
    // await ScheduleETS.deleteMany({});   // safer than drop(), won't throw if collection doesn't exist
    await Schedule.deleteMany({});   // safer than drop(), won't throw if collection doesn't exist
    console.log("Cleared existing schedule data.");

    const { data } = req.body; // <-- JSON payload from frontend

    console.log("Data preview:");
    console.log(data[2]);
    console.log(data[2][27]); // group

    if (!data || !Array.isArray(data) || data.length <= 1) {
      return res.status(400).json({ error: "No schedule data received" });
    }
    
    // remove header row
    const rows = data.slice(1);

    // Map rows into objects
    const scheduleDocs = rows.map((row) => {
      return {
        rig: row[24] || "",
        drillok: row[13] || "",
        geook: row[14] || "",
        duration: Number(row[25]) || 0,
        dp: row[16] || "",
        type: row[15] || "",
        vp: row[19] || "",
        start: row[9] ? new Date(row[9]) : null,
        site: row[1] || "",
        well: row[4] || "",
        dpCompany: row[10] || "",
        ETS: row[0] || "",
        dpReq: row[17] || "",
        //dpReqDate: row[17] ? new Date(row[17]) : null,
        group: row[27] || "",

        geo: row[23] || "Geo Unknown",
        version: row[12] || "",

        user: req.user ? req.user._id : null,
        noteId: req.params.id || null, // if uploaded from job context
      };
    });

    // Bulk insert
    //await ScheduleETS.insertMany(scheduleDocs);
    await Schedule.insertMany(scheduleDocs);

    console.log("<<<< Schedule ETS uploaded >>>>");
    req.flash("success_msg", "Schedule uploaded successfully");
    res.redirect("/notes");

  } catch (error) {

    console.error("Error uploading schedule:", error);
    req.flash("error_msg", "Error uploading schedule");
    res.redirect("/notes");
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

module.exports = notesCrtl;


// ---------------------------------------------------------------------
// Wellbore 3D Trajectories (per job/note)
// ---------------------------------------------------------------------

// POST /notes/wellboreTrajectory/upload/:id  (id = noteId)
notesCrtl.uploadWellboreTrajectory = async (req, res) => {
  try{
    const noteId = req.params.id;
    const { data } = req.body;

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

    const docs = data.map(well => ({
      noteId: noteId,
      wellName: well.wellName || "",
      source: well.source || "",
      pad: well.pad || "",
      colorHex: well.colorHex || "",
      surveyCount: well.surveyCount || (well.survey ? well.survey.length : 0),
      survey: well.survey || [],
      user: req.user ? req.user._id : null,
      uploadedDate: new Date(),
    }));

    // Upsert by noteId + wellName + source so re-uploading the same wells updates them
    const ops = docs.map(doc => ({
      updateOne: {
        filter: { noteId: doc.noteId, wellName: doc.wellName, source: doc.source },
        update: { $set: doc },
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

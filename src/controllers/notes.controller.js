// Al igual que index.controller.js, en este archivo se definen las funciones
// que despues seran llamadas desde notes.routes.js

const notesCrtl = {};

const Note = require('../models/NoteConveyor');
const User = require('../models/User');
const Job = require('../models/MTXjobNumber');
const Log = require('../models/LogConveyor');

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
                // filename: req.file.filename,
                // path: result.url,
                // public_id: result.public_id,
                // originalname: req.file.originalname,
                // mimetype: req.file.mimetype,
                // size: req.file.size,
            });
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
        // console.log(usuario)
        // console.log(user)
    }
    // const notes = await Note.find().sort({createdAt: 'desc'});
    const notes = await Note.find().sort({dueDate: 'asc'});
    res.render('all-notes.ejs', {notes, user});
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
    res.render('edit-note.ejs', {note, user});
}





notesCrtl.updateNote = async (req,res)=>{
    // res.send('Update note...');
    // console.log(req.body);
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
        customer, customerJobNumber, operator, rig, project, area, wells, budget, poc, geologist, checkInitialInfo,
        checkFoldersSetup, checkOffsetWellsInfo, checkCompassOffsets, checkCompassSubject,
        checkPlanning, checkReports, checkSent, initialInfoDoneBy, initialInfoDoneAt,
        foldersDoneBy, foldersDoneAt, offsetsInfoDoneBy, offsetsInfoDoneAt, compassOffsetsDoneBy, compassOffsetsDoneAt,
        compassSubjectDoneBy, compassSubjectDoneAt, planningDoneBy, planningDoneAt, reportsDoneBy,
        reportsDoneAt, sentBy, sentAt, checkETSUpdate , ETSUpdateBy, ETSUpdateAt, created

    } = req.body;
    await Note.findByIdAndUpdate(req.params.id, {
        title, description, priority, status, responsible, dueDate, invoice, 
        customer, customerJobNumber, operator, rig, project, area, wells, budget, poc, geologist, checkInitialInfo,
        checkFoldersSetup, checkOffsetWellsInfo, checkCompassOffsets, checkCompassSubject,
        checkPlanning, checkReports, checkSent, initialInfoDoneBy, initialInfoDoneAt,
        foldersDoneBy, foldersDoneAt, offsetsInfoDoneBy, offsetsInfoDoneAt, compassOffsetsDoneBy, compassOffsetsDoneAt,
        compassSubjectDoneBy, compassSubjectDoneAt, planningDoneBy, planningDoneAt, reportsDoneBy,
        reportsDoneAt, sentBy, sentAt, checkETSUpdate, ETSUpdateBy, ETSUpdateAt, created
    });
    req.flash('success_msg','Note updated successfully');
    res.redirect('/notes');
}




notesCrtl.deleteNote = async (req,res)=>{
    let id = req.params.id
    const note = await Note.findById(id)    
    if(note.public_id){await cloudinary.v2.uploader.destroy(note.public_id)};
    await Note.findByIdAndDelete(req.params.id); 
    req.flash('success_msg','Note deleted successfully');
    res.redirect('/notes');
}




notesCrtl.renderJob = async (req,res)=>{
    let user = {}
    user.id = req.session.passport.user;
    // console.log('>>Render Job user:' + user.id)
    let usuario = await User.findById(user.id);
    // console.log(usuario)
    user.role = usuario.role;
    user.rank = usuario.rank;
    user.name = usuario.name;
    let noteid = req.params.id;
    let note = await Note.findById(noteid);
    let log = await Log.find({noteid}).sort({createdAt: 'desc'});
    // let uzuario = await User.findById(user.id);
    // console.log(uzuario);
    res.render('job.ejs', {note, user, log})
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



module.exports = notesCrtl;
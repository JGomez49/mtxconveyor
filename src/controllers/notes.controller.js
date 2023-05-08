// Al igual que index.controller.js, en este archivo se definen las funciones
// que despues seran llamadas desde notes.routes.js

const notesCrtl = {};

const Note = require('../models/NoteConveyor');
const User = require('../models/User');
const Job = require('../models/MTXjobNumber');

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
    const job = await Job.find().sort({createdAt: 'desc'});
    let jn = Number(job[0].jobNumber);
    let jnID = job[0]._id;
    if(jn){
        jn = jn + 1
    }else{
        jn = 100;
    };
    jn = String(jn)
    res.render('new-note.ejs', {jn, jnID});
}





notesCrtl.createNewNote = async(req,res)=>{
    //console.log(req.body);
    //const{title, description}=req.body;
    // const result = await cloudinary.v2.uploader.upload(req.file.path);
    // console.log('>> result:')
    // console.log(result)
    let mtxjob = req.body.mtxJobId;
    const newNote = new Note({
        title: req.body.title,
        description: req.body.description,
        mtxJobId: mtxjob,
        responsible: req.body.responsible,
        priority: req.body.priority,
        invoice: req.body.invoice,
        user: req.user.id,
        dueDate: req.body.dueDate,
        status: req.body.status,
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
    const job = await Job.find().sort({createdAt: 'desc'});
    let jnID = job[0]._id;
    await Job.findByIdAndUpdate(jnID, {jobNumber: mtxjob});
    req.flash('success_msg','Note added successfully');
    res.redirect('/notes');
}





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
        // console.log(usuario)
        // console.log(user)
    }
    const notes = await Note.find().sort({createdAt: 'desc'});
    res.render('all-notes.ejs', {notes, user});
};





notesCrtl.renderEditForm = async(req,res)=>{
    // res.send('Edit note...');
    const note = await Note.findById(req.params.id);
    // if(note.user != req.user.id){
    //     req.flash('error_msg','Not authorized user for the URL');
    //     return res.redirect('/notes');
    // }
    res.render('edit-note.ejs', {note});
}





notesCrtl.updateNote = async (req,res)=>{
    // res.send('Update note...');
    // console.log(req.body);
    const {
        title, description, priority, status, responsible, dueDate, invoice
    } = req.body;
    await Note.findByIdAndUpdate(req.params.id, {
        title, description, priority, status, responsible, dueDate, invoice
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
    let id = req.params.id
    let note = await Note.findById(id);
    res.render('job.ejs', {note})
}


module.exports = notesCrtl;
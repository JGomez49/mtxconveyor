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





// Para el programa: Conveyor
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




// Para el programa: Conveyor
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
    if (req.file.path){await unlink(req.file.path)}; 
    await newNote.save();
    const job = await Job.find().sort({createdAt: 'desc'});
    let jnID = job[0]._id;
    await Job.findByIdAndUpdate(jnID, {jobNumber: mtxjob});
    req.flash('success_msg','Note added successfully');
    res.redirect('/notes');
}




// Para el programa: Conveyor
notesCrtl.renderNotes = async (req,res)=>{
    let user = {}
    user.id = req.params.guest
    if(user.id != null){
        user.name = 'Guest'
    }else{
        user.id = req.session.passport.user
        let usuario = await User.findById(user.id);
        user.name = usuario.name
        user.email = usuario.email
    }
    const notes = await Note.find().sort({createdAt: 'desc'});
    res.render('all-notes.ejs', {notes, user});
};




// Para el programa: Conveyor
notesCrtl.renderEditForm = async(req,res)=>{
    // res.send('Edit note...');
    const note = await Note.findById(req.params.id);
    // if(note.user != req.user.id){
    //     req.flash('error_msg','Not authorized user for the URL');
    //     return res.redirect('/notes');
    // }
    res.render('edit-note.ejs', {note});
}




// Para el programa: Conveyor
notesCrtl.updateNote = async (req,res)=>{
    // res.send('Update note...');
    // console.log(req.body);
    const {title, description, priority, status, responsible} = req.body;
    await Note.findByIdAndUpdate(req.params.id, {title, description, priority, status, responsible});
    req.flash('success_msg','Note updated successfully');
    res.redirect('/notes');
}




// Para el programa: Conveyor
notesCrtl.deleteNote = async (req,res)=>{
    let id = req.params.id
    const note = await Note.findById(id)    
    if(note.public_id){await cloudinary.v2.uploader.destroy(note.public_id)};
    await Note.findByIdAndDelete(req.params.id); 
    req.flash('success_msg','Note deleted successfully');
    res.redirect('/notes');
}



// notesCrtl.renderOrders = async (req,res)=>{
//     let user = {}
//         user.id = req.session.passport.user
//         let usuario = await User.findById(user.id);
//         console.log('>> obj usuario (orders):')
//         console.log(usuario)
//         user.name = usuario.name
//         user.email = usuario.email
//     const notes = await Note.find({title: 'Order'}).sort({createdAt: 'desc'});
//         console.log('>>> Notes (Orders):')
//         console.log(notes)
//     res.render('all-orders.ejs', {notes, user});
// };



// notesCrtl.renderOrder = async (req,res)=>{
//     let id = req.params.id
//     let user = await User.findById(id);
//     console.log('>>> user: ');
//     console.log(user);
//     res.render('order.ejs', {user})
// }






// Para el programa: Conveyor
notesCrtl.renderJob = async (req,res)=>{
    let id = req.params.id
    let note = await Note.findById(id);
    res.render('job.ejs', {note})
}






// notesCrtl.postOrder = async (req,res)=>{
//     let id = req.params.id
//     let user = await User.findById(id);
//     console.log('>>> Order from user:')
//     console.log(user)
//     console.log('>>> Order Text:')
//     console.log(req.body.ordertext)

//     const newNote = new Note({
//         title: req.body.title,
//         description: req.body.ordertext,
//         user: user,
//     });
//     await newNote.save();
//     req.flash('success_msg','Note (job) added successfully');
//     console.log('>> newNote (job):');
//     console.log(newNote);
//     res.redirect('/notes');
// }



module.exports = notesCrtl;
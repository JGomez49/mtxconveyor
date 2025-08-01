
const {Router} = require('express');

const router = Router();

const {
    renderNoteForm, 
    createNewNote, 
    renderNotes, 
    renderEditForm,
    updateNote,
    deleteNote,
    renderJob,
    renderQueryNotes,
    renderQueryNotesPartial,
    createNewLog,
    uploadImage,
    renderUploadImage,
    removeImage,
} = require('../controllers/notes.controller');

const {isAuthenticated} = require('../helpers/auth');

//Get note
router.get('/notes/add', isAuthenticated, renderNoteForm);

//New note
router.post('/notes/new-note', isAuthenticated, createNewNote);

//Get Job
router.get('/notes/job/:id', isAuthenticated, renderJob);

//Get all notes
router.get('/notes', isAuthenticated, renderNotes);

//Get query notes
router.get('/notes/query', isAuthenticated, renderQueryNotes);

//Get query partial notes
router.get('/notes/querypartial', isAuthenticated, renderQueryNotesPartial);

//Edit notes
    //Mostrar el formulario para editar
    router.get('/note/edit/:id', isAuthenticated, renderEditForm);

    //Actualizar lo que esta en el formulario
    router.put('/note/edit/:id', isAuthenticated, updateNote);

//Delete note
router.delete('/notes/delete/:id', isAuthenticated, deleteNote);

//New Log Entry
router.post('/notes/new-log/:id', isAuthenticated, createNewLog);






//Get Upload form
router.get('/note/upload/:id', isAuthenticated, renderUploadImage);

//Upload Image
router.post('/upload/:id', isAuthenticated, uploadImage);


//Remove Image
router.get('/image/remove/:id', isAuthenticated, removeImage);



module.exports = router;
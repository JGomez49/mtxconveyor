
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
// router.get('/notes/:guest', renderNotes);
// router.get('/orders', isAuthenticated, renderOrders);

//Edit notes
    //Mostrar el formulario para editar
    router.get('/note/edit/:id', isAuthenticated, renderEditForm);

    //Actualizar lo que esta en el formulario
    router.put('/note/edit/:id', isAuthenticated, updateNote);

//Delete note
router.delete('/notes/delete/:id', isAuthenticated, deleteNote);


// Send Order
// router.get('/notes/order/:id', isAuthenticated, renderOrder);
// router.post('/notes/order/:id', isAuthenticated, postOrder);


module.exports = router;
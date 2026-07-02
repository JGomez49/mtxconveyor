
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
    findSite,
    syncDueDates,
    renderUploadDPStats,
    uploadDPStats,
    renderUploadDPI,
    renderUploadPason,
    renderUploadPadAC,
    savePadAC,
    getPadAC,
    savePasonPlots,
    getPasonPlots,
    renderBanner,
    saveBanner,
    deleteLogEntry,
    saveBatchDays,
    renderUploadNewSchedule,
    uploadNewSchedule,
    renderUploadFracPlanes,
    renderUploadTorqueAndDrag,
    uploadWellboreTrajectory,
    deleteWellboreTrajectory,
    deleteAllWellboreTrajectories,
    listWellboreTrajectories,
    addFracPlane,
    updateFracPlane,
    deleteFracPlane,
    savePadStats,
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






//Get note with site (for chart)
router.get('/notes/findSite/:site', isAuthenticated, findSite);

router.get('/notes/syncDueDates', isAuthenticated, syncDueDates);



// ── RETIRED: legacy Schedule / ScheduleETS upload paths ──────────────────
// Both the old "Schedule" upload and the legacy "ScheduleETS" upload used
// stale/fragile column mappings and have been fully replaced by New
// Schedule (which stores every uploaded column verbatim and is immune to
// the file format changing). Any stale bookmark/link now redirects to the
// New Schedule upload page instead of running old, unmaintained handlers.
router.get('/notes/uploadSchedule', isAuthenticated, (req, res) => {
    req.flash('error_msg', 'This page has been retired — please use "New Schedule" instead.');
    res.redirect('/notes/uploadNewSchedule');
});
router.post('/notes/uploadSchedule', isAuthenticated, (req, res) => {
    req.flash('error_msg', 'This upload page has been retired and no longer accepts data — please use "New Schedule" instead.');
    res.redirect('/notes/uploadNewSchedule');
});
router.get('/notes/uploadScheduleETS', isAuthenticated, (req, res) => {
    req.flash('error_msg', 'This page has been retired — please use "New Schedule" instead.');
    res.redirect('/notes/uploadNewSchedule');
});
router.post('/notes/uploadScheduleETS', isAuthenticated, (req, res) => {
    req.flash('error_msg', 'This upload page has been retired and no longer accepts data — please use "New Schedule" instead.');
    res.redirect('/notes/uploadNewSchedule');
});






//Get Upload DPStats form
router.get('/notes/uploadDPStats', isAuthenticated, renderUploadDPStats);

//POST Upload DPStats
router.post('/notes/uploadDPStats', isAuthenticated, uploadDPStats);



//Get Upload DPI (Directional Plan Index) form
router.get('/notes/uploadDPI', isAuthenticated, renderUploadDPI);



//Get Upload Pason Data form
router.get('/notes/uploadPason', isAuthenticated, renderUploadPason);



//Get Upload AC with risk reports
router.get('/notes/uploadPadAC', isAuthenticated, renderUploadPadAC);
router.post('/notes/padAC/:noteId', isAuthenticated, savePadAC);
router.get('/notes/padAC/:noteId',  isAuthenticated, getPadAC);
router.post('/notes/pasonPlots/:noteId', isAuthenticated, savePasonPlots);
router.get('/notes/pasonPlots/:noteId',  isAuthenticated, getPasonPlots);
router.get('/notes/banner',             isAuthenticated, renderBanner);
router.delete('/notes/log/:logId',      isAuthenticated, deleteLogEntry);
router.post('/notes/batchDays/:noteId',  isAuthenticated, saveBatchDays);

router.get('/notes/uploadNewSchedule',  isAuthenticated, renderUploadNewSchedule);
router.post('/notes/uploadNewSchedule', isAuthenticated, uploadNewSchedule);
router.post('/notes/banner',            isAuthenticated, saveBanner);

//Wellbore 3D Trajectory (per job/note)
router.post('/notes/wellboreTrajectory/upload/:id', isAuthenticated, uploadWellboreTrajectory);
router.delete('/notes/wellboreTrajectory/all/:noteId', isAuthenticated, deleteAllWellboreTrajectories);
router.delete('/notes/wellboreTrajectory/:id', isAuthenticated, deleteWellboreTrajectory);
router.get('/notes/wellboreTrajectory/list/:id', isAuthenticated, listWellboreTrajectories);

//FracPlane CRUD (sub-documents inside WellboreTrajectory)
router.post('/notes/fracPlane/:trajectoryId', isAuthenticated, addFracPlane);
router.put('/notes/fracPlane/:trajectoryId/:fracPlaneId', isAuthenticated, updateFracPlane);
router.delete('/notes/fracPlane/:trajectoryId/:fracPlaneId', isAuthenticated, deleteFracPlane);
router.patch('/notes/padStats/:id', isAuthenticated, savePadStats);


//Get Upload Frac Planes form
router.get('/notes/uploadFracPlanes', isAuthenticated, renderUploadFracPlanes);


//Get Upload Torque and Drag form
router.get('/notes/uploadTorqueAndDrag', isAuthenticated, renderUploadTorqueAndDrag);



module.exports = router;
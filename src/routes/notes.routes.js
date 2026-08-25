
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
    findJobByMtxId,
    getTDModel,
    recalculateTDModel,
    setActiveScenario,
    deleteScenario,
    saveTDModel,
    getHydraulicsModel,
    saveHydraulicsModel,
    recalculateHydraulicsModel,
    setActiveHydraulicsScenario,
    deleteHydraulicsScenario,
    renderUploadHydraulics,
    getCasingDesign,
    saveCasingDesign,
    recalculateCasingDesign,
    setActiveCasingDesignScenario,
    deleteCasingDesignScenario,
    renderUploadCasingDesign,
    renderBanner,
    saveBanner,
    deleteLogEntry,
    saveBatchDays,
    renderUploadNewSchedule,
    uploadNewSchedule,
    renderUploadFracPlanes,
    renderUploadTorqueAndDrag,
    renderQuickPlan,
    renderSixAxisData,
    saveSixAxisCase,
    listSixAxisCases,
    getSixAxisCase,
    deleteSixAxisCase,
    uploadWellboreTrajectory,
    deleteWellboreTrajectory,
    setWellboreTrajectoryToolcode,
    setWellboreTrajectoryPadToolcode,
    deleteAllWellboreTrajectories,
    deleteWellboreTrajectoryPad,
    deleteWellboreTrajectoryGroup,
    listWellboreTrajectories,
    addFracPlane,
    updateFracPlane,
    deleteFracPlane,
    listPolylines,
    addPolyline,
    updatePolyline,
    deletePolyline,
    savePadStats,
    saveWbtColorMode,
} = require('../controllers/notes.controller');

const {isAuthenticated, canUseModelers} = require('../helpers/auth');

// Added 2026-08-24: route-level guard for 6-axis Data case writes (save +
// delete) — the 'viewer' role can load/see cases but never create or
// remove them, per the person's role matrix (Admin: full CRUD; Leader/User:
// create+save, no delete; Viewer: read-only). Requires isAuthenticated to
// have already run (req.user present).
function blockViewerFromSaving(req, res, next){
    if(req.user && req.user.role === 'viewer'){
        return res.status(403).json({ok:false, error:'Your role does not have permission to do this.'});
    }
    next();
}

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
router.get('/notes/tdModel/lookupByMtxId/:mtxJobId', isAuthenticated, findJobByMtxId);
router.get('/notes/tdModel/:noteId',  isAuthenticated, getTDModel);
router.post('/notes/tdModel/:noteId', isAuthenticated, saveTDModel);
router.post('/notes/tdModel/recalculate/:noteId', isAuthenticated, recalculateTDModel);
router.post('/notes/tdModel/:noteId/scenario/setActive', isAuthenticated, setActiveScenario);
router.delete('/notes/tdModel/:noteId/scenario/:scenario', isAuthenticated, deleteScenario);

router.get('/notes/hydraulicsModel/:noteId',  isAuthenticated, getHydraulicsModel);
router.post('/notes/hydraulicsModel/:noteId', isAuthenticated, saveHydraulicsModel);
router.post('/notes/hydraulicsModel/recalculate/:noteId', isAuthenticated, recalculateHydraulicsModel);
router.post('/notes/hydraulicsModel/:noteId/scenario/setActive', isAuthenticated, setActiveHydraulicsScenario);
router.delete('/notes/hydraulicsModel/:noteId/scenario/:scenario', isAuthenticated, deleteHydraulicsScenario);

router.get('/notes/casingDesign/:noteId',  isAuthenticated, getCasingDesign);
router.post('/notes/casingDesign/:noteId', isAuthenticated, saveCasingDesign);
router.post('/notes/casingDesign/recalculate/:noteId', isAuthenticated, recalculateCasingDesign);
router.post('/notes/casingDesign/:noteId/scenario/setActive', isAuthenticated, setActiveCasingDesignScenario);
router.delete('/notes/casingDesign/:noteId/scenario/:scenario', isAuthenticated, deleteCasingDesignScenario);
router.get('/notes/banner',             isAuthenticated, renderBanner);
router.delete('/notes/log/:logId',      isAuthenticated, deleteLogEntry);
router.post('/notes/batchDays/:noteId',  isAuthenticated, saveBatchDays);

router.get('/notes/uploadNewSchedule',  isAuthenticated, renderUploadNewSchedule);
router.post('/notes/uploadNewSchedule', isAuthenticated, uploadNewSchedule);
router.post('/notes/banner',            isAuthenticated, saveBanner);

//Wellbore 3D Trajectory (per job/note)
router.post('/notes/wellboreTrajectory/upload/:id', isAuthenticated, uploadWellboreTrajectory);
router.delete('/notes/wellboreTrajectory/all/:noteId', isAuthenticated, deleteAllWellboreTrajectories);
router.delete('/notes/wellboreTrajectory/pad/:noteId/:pad', isAuthenticated, deleteWellboreTrajectoryPad);
router.delete('/notes/wellboreTrajectory/group/:noteId/:pad/:source', isAuthenticated, deleteWellboreTrajectoryGroup);
router.delete('/notes/wellboreTrajectory/:id', isAuthenticated, deleteWellboreTrajectory);
router.post('/notes/wellboreTrajectory/:id/toolcode', isAuthenticated, setWellboreTrajectoryToolcode);
router.post('/notes/wellboreTrajectory/pad/:noteId/:pad/toolcode', isAuthenticated, setWellboreTrajectoryPadToolcode);
router.get('/notes/wellboreTrajectory/list/:id', isAuthenticated, listWellboreTrajectories);

//FracPlane CRUD (sub-documents inside WellboreTrajectory)
router.post('/notes/fracPlane/:trajectoryId', isAuthenticated, addFracPlane);
router.put('/notes/fracPlane/:trajectoryId/:fracPlaneId', isAuthenticated, updateFracPlane);
router.delete('/notes/fracPlane/:trajectoryId/:fracPlaneId', isAuthenticated, deleteFracPlane);

//Polyline CRUD (2026-08-25) — job-level (noteId-keyed), NOT tied to any
//one wellbore, unlike FracPlanes above.
router.get('/notes/polyline/list/:noteId', isAuthenticated, listPolylines);
router.post('/notes/polyline/:noteId', isAuthenticated, addPolyline);
router.put('/notes/polyline/:polylineId', isAuthenticated, updatePolyline);
router.delete('/notes/polyline/:polylineId', isAuthenticated, deletePolyline);
router.patch('/notes/padStats/:id', isAuthenticated, savePadStats);
router.patch('/notes/wbtColorMode/:id', isAuthenticated, saveWbtColorMode);


//Get Upload Frac Planes form
router.get('/notes/uploadFracPlanes', isAuthenticated, renderUploadFracPlanes);


//Get Upload Torque and Drag form
router.get('/notes/uploadTorqueAndDrag', isAuthenticated, canUseModelers, renderUploadTorqueAndDrag);
router.get('/notes/uploadHydraulics', isAuthenticated, canUseModelers, renderUploadHydraulics);
router.get('/notes/uploadCasingDesign', isAuthenticated, canUseModelers, renderUploadCasingDesign);


//Quick Plan — standalone directional-plan checker, open to every role
//(no canUseModelers gate, unlike the three modelers above).
router.get('/notes/quickPlan', isAuthenticated, renderQuickPlan);

//6-axis Data — standalone MWD sensor axis-mapping/calibration tool, same
//pattern as Quick Plan above (no bound note/job, open to every role).
router.get('/notes/sixAxisData', isAuthenticated, renderSixAxisData);

//6-axis Data — saved cases (2026-08-23, updated 2026-08-24 to be shared
//across all users with role-based CRUD): raw imported rows + Input Data
//panel state. Visible/loadable by every authenticated role. Create/save
//is blocked for 'viewer' (blockViewerFromSaving below); delete is further
//restricted inside deleteSixAxisCase itself (admin = any case, leader/user
//= only cases they created, viewer = none — the route-level guard here
//already blocks viewer, so the controller only needs to handle the
//admin-vs-owner distinction).
router.post('/notes/sixAxisData/case', isAuthenticated, blockViewerFromSaving, saveSixAxisCase);
router.get('/notes/sixAxisData/cases', isAuthenticated, listSixAxisCases);
router.get('/notes/sixAxisData/case/:id', isAuthenticated, getSixAxisCase);
router.delete('/notes/sixAxisData/case/:id', isAuthenticated, blockViewerFromSaving, deleteSixAxisCase);


module.exports = router;
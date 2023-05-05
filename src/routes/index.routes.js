
// En este archivo estan las rutas basicas (URLs)

const {Router} = require('express');
const router = Router();
const {
    renderIndex,
    renderAbout,
    renderSignIn,
} = require('../controllers/index.controller');

//views/partial/navigation para redireccionar la URL...
// router.get('/', renderIndex);
router.get('/', renderSignIn);

router.get('/about', renderAbout);

module.exports = router;
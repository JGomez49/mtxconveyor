

const {Router} = require('express');
const router = Router();

const { 
    renderSignUpForm, 
    renderSigninForm, 
    signin, 
    signup, 
    logout,
    renderEditUserForm,
    editUser,
} = require('../controllers/users.controller');

router.get('/users/signup', renderSignUpForm);
router.post('/users/signup', signup);

router.get('/users/signin', renderSigninForm);
router.post('/users/signin', signin);

router.get('/users/edit/:id', renderEditUserForm);
router.put('/users/edit/:id', editUser);

router.get('/users/logout', logout);


module.exports = router;


const {Router} = require('express');
const router = Router();
const { isAuthenticated, isAdmin } = require('../helpers/auth');

const { 
    renderSignUpForm, 
    renderSigninForm, 
    signin, 
    signup, 
    logout,
    renderEditUserForm,
    editUser,
    renderSetupSecurityQuestion,
    setupSecurityQuestion,
    renderForgotPassword,
    forgotPasswordLookup,
    forgotPasswordReset,
    renderChangePassword,
    changePassword,
    renderActivityDashboard,
} = require('../controllers/users.controller');

router.get('/users/signup', renderSignUpForm);
router.post('/users/signup', signup);

router.get('/users/signin', renderSigninForm);
router.post('/users/signin', signin);

router.get('/users/edit/:id', renderEditUserForm);
router.put('/users/edit/:id', editUser);

router.get('/users/logout', logout);

// Security question setup (shown once after login if not yet set)
router.get('/users/setup-security-question', isAuthenticated, renderSetupSecurityQuestion);
router.post('/users/setup-security-question', isAuthenticated, setupSecurityQuestion);

// Forgot password (logged out)
router.get('/users/forgot-password', renderForgotPassword);
router.post('/users/forgot-password/lookup', forgotPasswordLookup);
router.post('/users/forgot-password/reset', forgotPasswordReset);

// Change password (logged in)
router.get('/users/change-password', isAuthenticated, renderChangePassword);
router.post('/users/change-password', isAuthenticated, changePassword);

// Usage / activity dashboard (admin only)
router.get('/users/activity', isAuthenticated, isAdmin, renderActivityDashboard);


module.exports = router;
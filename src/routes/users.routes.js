

const {Router} = require('express');
const router = Router();
const { isAuthenticated, isAdmin } = require('../helpers/auth');

const { 
    renderSigninForm, 
    signin, 
    logout,
    renderSetupSecurityQuestion,
    setupSecurityQuestion,
    renderForgotPassword,
    forgotPasswordLookup,
    forgotPasswordReset,
    renderChangePassword,
    changePassword,
    renderActivityDashboard,
    renderManageUsers,
    createUser,
    updateUser,
    resetUserPassword,
    deleteUser,
    forceLogoutAll,
} = require('../controllers/users.controller');

// Self-registration is retired — all user creation now goes through the
// admin-only /users/manage page. Old bookmarks/links just land on signin.
router.get('/users/signup', (req, res) => res.redirect('/users/signin'));
router.post('/users/signup', (req, res) => res.redirect('/users/signin'));

router.get('/users/signin', renderSigninForm);
router.post('/users/signin', signin);

router.get('/users/logout', logout);

// Security question setup (shown once after login if not yet set)
router.get('/users/setup-security-question', isAuthenticated, renderSetupSecurityQuestion);
router.post('/users/setup-security-question', isAuthenticated, setupSecurityQuestion);

// Forgot password (logged out)
router.get('/users/forgot-password', renderForgotPassword);
router.post('/users/forgot-password/lookup', forgotPasswordLookup);
router.post('/users/forgot-password/reset', forgotPasswordReset);

// Change password (logged in) — how an admin edits THEIR OWN account/password
router.get('/users/change-password', isAuthenticated, renderChangePassword);
router.post('/users/change-password', isAuthenticated, changePassword);

// Usage / activity dashboard (admin only)
router.get('/users/activity', isAuthenticated, isAdmin, renderActivityDashboard);

// User management CRUD (admin only) — all AJAX, no page redirects
router.get('/users/manage', isAuthenticated, isAdmin, renderManageUsers);
router.post('/users/manage', isAuthenticated, isAdmin, createUser);
router.put('/users/manage/:id', isAuthenticated, isAdmin, updateUser);
router.post('/users/manage/:id/reset-password', isAuthenticated, isAdmin, resetUserPassword);
router.delete('/users/manage/:id', isAuthenticated, isAdmin, deleteUser);
router.post('/users/manage-force-logout-all', isAuthenticated, isAdmin, forceLogoutAll);


module.exports = router;
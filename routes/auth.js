const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { forwardAuthenticated } = require('../middleware/auth');

router.get('/login', forwardAuthenticated, authController.renderLogin);
router.post('/login', authController.handleLogin);
router.post('/logout', authController.handleLogout);

module.exports = router;

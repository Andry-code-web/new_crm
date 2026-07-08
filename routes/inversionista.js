const express = require('express');
const router = express.Router();
const inversionistaController = require('../controllers/inversionistaController');
const { ensureRole } = require('../middleware/auth');

router.use(ensureRole(['inversionista']));

router.get('/prestamo', inversionistaController.renderPrestamo);
router.get('/perfil', inversionistaController.renderPerfil);
router.post('/perfil', inversionistaController.actualizarPerfil);

module.exports = router;

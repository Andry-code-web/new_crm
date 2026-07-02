const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/clienteController');
const { ensureRole } = require('../middleware/auth');

router.use(ensureRole(['cliente']));

router.get('/prestamo', clienteController.renderPrestamo);
router.get('/perfil', clienteController.renderPerfil);
router.post('/perfil', clienteController.actualizarPerfil);

module.exports = router;

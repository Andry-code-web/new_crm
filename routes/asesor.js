const express = require('express');
const router = express.Router();
const asesorController = require('../controllers/asesorController');
const { ensureRole } = require('../middleware/auth');

router.use(ensureRole(['admin', 'asesor']));

router.get('/clientes', asesorController.listClientes);
router.get('/inversionistas', asesorController.listInversionistas);

module.exports = router;

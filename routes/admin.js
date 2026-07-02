const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { ensureRole } = require('../middleware/auth');

router.use(ensureRole(['admin']));

// Clientes
router.get('/clientes', adminController.listClientes);
router.post('/clientes/crear', adminController.crearCliente);
router.post('/clientes/:id/editar', adminController.editarCliente);
router.post('/clientes/:id/eliminar', adminController.eliminarCliente);

// Inversionistas
router.get('/inversionistas', adminController.listInversionistas);
router.post('/inversionistas/crear', adminController.crearInversionista);
router.post('/inversionistas/:id/editar', adminController.editarInversionista);
router.post('/inversionistas/:id/eliminar', adminController.eliminarInversionista);

// Asesores
router.get('/asesores', adminController.listAsesores);
router.post('/asesores/crear', adminController.crearAsesor);
router.post('/asesores/:id/editar', adminController.editarAsesor);
router.post('/asesores/:id/eliminar', adminController.eliminarAsesor);

// Pagos
router.get('/pagos/por-vencer', adminController.pagosPorVencer);
router.get('/pagos/vencidos', adminController.pagosVencidos);

module.exports = router;

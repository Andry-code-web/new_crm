const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const clienteController = require('../controllers/clienteController');
const inversionistaController = require('../controllers/inversionistaController');
const { ensureRole } = require('../middleware/auth');

// Dashboards
router.get('/admin',        ensureRole(['admin']),                  dashboardController.renderAdminDashboard);
router.get('/asesor',       ensureRole(['admin', 'asesor']),         dashboardController.renderAsesorDashboard);
router.get('/cliente',      ensureRole(['admin', 'asesor', 'cliente']), clienteController.renderDashboard);
router.get('/inversionista', ensureRole(['admin', 'inversionista']), inversionistaController.renderDashboard);

// Simulación
router.get('/simulacion', ensureRole(['admin', 'asesor']), dashboardController.renderSimulacion);
router.post('/simulacion/pdf', ensureRole(['admin', 'asesor']), dashboardController.generarSimulacionPdf);

// Préstamos
router.get('/prestamos',          ensureRole(['admin', 'asesor']), dashboardController.renderPrestamos);
router.post('/prestamos/registrar', ensureRole(['admin', 'asesor']), dashboardController.registrarPrestamo);
router.post('/prestamos/:id/activar', ensureRole(['admin']), dashboardController.activarPrestamo);
router.post('/prestamos/:id/cronograma', ensureRole(['admin', 'asesor']), dashboardController.registrarCronograma);
router.get('/prestamos/:id/cronograma', ensureRole(['admin', 'asesor']), dashboardController.renderCronograma);
router.post('/prestamos/:id/cuotas/:cuotaId/pagar', ensureRole(['admin', 'asesor']), dashboardController.registrarPago);
router.post('/prestamos/:id/fecha-inicio', ensureRole(['admin', 'asesor']), dashboardController.cambiarFechaInicio);

// Redirect /dashboard to the specific role
router.get('/', function(req, res) {
  if (!req.session.userId) return res.redirect('/login');
  res.redirect('/dashboard/' + (req.session.role || 'cliente'));
});

module.exports = router;

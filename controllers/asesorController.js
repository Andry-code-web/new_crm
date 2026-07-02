const pool = require('../config/db');
const { getCommonData } = require('../helpers/viewHelpers');

exports.listClientes = async (req, res) => {
  try {
    const [clientes] = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM prestamos p WHERE p.cliente_id = c.id) AS num_prestamos,
        (SELECT SUM(p.monto) FROM prestamos p WHERE p.cliente_id = c.id AND p.estado = 'activo') AS monto_activo
      FROM clientes c
      ORDER BY c.nombre ASC
    `);
    const [stats] = await pool.query(`
      SELECT COUNT(DISTINCT cliente_id) AS con_prestamo, COUNT(*) AS total_prestamos FROM prestamos
    `);

    res.render('asesor/clientes', {
      ...getCommonData(req),
      clientes,
      conPrestamo: stats[0]?.con_prestamo || 0,
      totalPrestamos: stats[0]?.total_prestamos || 0
    });
  } catch (err) {
    console.error('Error listando clientes (asesor):', err);
    res.render('asesor/clientes', {
      ...getCommonData(req),
      clientes: [],
      conPrestamo: 0,
      totalPrestamos: 0,
      error: 'Error al cargar clientes.'
    });
  }
};

exports.listInversionistas = async (req, res) => {
  try {
    const [inversionistas] = await pool.query(`
      SELECT i.*,
        (SELECT COUNT(*) FROM prestamos p WHERE p.inversor_id = i.id) AS num_prestamos,
        (SELECT SUM(p.monto) FROM prestamos p WHERE p.inversor_id = i.id) AS monto_invertido
      FROM inversionistas i
      ORDER BY i.nombre ASC
    `);
    const [stats] = await pool.query(`
      SELECT COUNT(DISTINCT inversor_id) AS activos, SUM(monto) AS monto_total FROM prestamos
    `);

    res.render('asesor/inversionistas', {
      ...getCommonData(req),
      inversionistas,
      activos: stats[0]?.activos || 0,
      montoTotal: Number(stats[0]?.monto_total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })
    });
  } catch (err) {
    console.error('Error listando inversionistas (asesor):', err);
    res.render('asesor/inversionistas', {
      ...getCommonData(req),
      inversionistas: [],
      activos: 0,
      montoTotal: '0.00',
      error: 'Error al cargar inversionistas.'
    });
  }
};

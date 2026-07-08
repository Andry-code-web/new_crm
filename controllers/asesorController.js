const pool = require('../config/db');
const { getCommonData } = require('../helpers/viewHelpers');

// Helper: obtiene el asesor_id del usuario en sesion
async function getAsesorId(userId) {
  const [rows] = await pool.query('SELECT id, nombre, apellidos, especialidad FROM asesores WHERE user_id = ?', [userId]);
  return rows.length > 0 ? rows[0] : null;
}

exports.listClientes = async (req, res) => {
  try {
    const asesor = await getAsesorId(req.session.userId);
    const asesorId = asesor ? asesor.id : null;

    // Solo clientes que tienen prestamos asignados a este asesor
    const [clientes] = await pool.query(`
      SELECT c.*,
        COUNT(p.id)          AS num_prestamos,
        SUM(CASE WHEN p.estado = 'activo' THEN p.monto ELSE 0 END) AS monto_activo,
        SUM(CASE WHEN p.estado = 'pendiente' THEN 1 ELSE 0 END)    AS prest_pendientes,
        SUM(CASE WHEN p.estado = 'vencido'   THEN 1 ELSE 0 END)    AS prest_vencidos
      FROM clientes c
      INNER JOIN prestamos p ON p.cliente_id = c.id AND p.asesor_id = ?
      GROUP BY c.id
      ORDER BY c.nombre ASC
    `, [asesorId]);

    const conPrestamo = clientes.filter(c => c.num_prestamos > 0).length;
    const totalPrestamos = clientes.reduce((s, c) => s + Number(c.num_prestamos), 0);

    res.render('asesor/clientes', {
      ...getCommonData(req),
      clientes,
      conPrestamo,
      totalPrestamos,
      asesorNombre: asesor ? `${asesor.nombre} ${asesor.apellidos}` : req.user?.name
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
    const asesor = await getAsesorId(req.session.userId);
    const asesorId = asesor ? asesor.id : null;

    // Solo inversionistas con prestamos de este asesor
    const [inversionistas] = await pool.query(`
      SELECT i.*,
        COUNT(p.id)       AS num_prestamos,
        SUM(p.monto)      AS monto_invertido,
        SUM(CASE WHEN p.estado = 'activo' THEN p.monto ELSE 0 END)  AS monto_activo,
        SUM(CASE WHEN p.estado = 'pagado' THEN p.monto ELSE 0 END)  AS monto_recuperado
      FROM inversionistas i
      INNER JOIN prestamos p ON p.inversor_id = i.id AND p.asesor_id = ?
      GROUP BY i.id
      ORDER BY i.nombre ASC
    `, [asesorId]);

    const montoTotal = inversionistas
      .reduce((s, i) => s + Number(i.monto_invertido || 0), 0)
      .toLocaleString('es-MX', { minimumFractionDigits: 2 });

    res.render('asesor/inversionistas', {
      ...getCommonData(req),
      inversionistas,
      activos: inversionistas.length,
      montoTotal
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

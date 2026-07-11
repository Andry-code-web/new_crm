const pool = require('../config/db');
const { getCommonData, getFlash } = require('../helpers/viewHelpers');

async function getInversionistaBySession(req) {
  if (req.session.inversionistaId) {
    const [rows] = await pool.query('SELECT * FROM inversionistas WHERE id = ?', [req.session.inversionistaId]);
    if (rows.length > 0) return rows[0];
  }
  if (req.session.userEmail) {
    const [rows] = await pool.query('SELECT * FROM inversionistas WHERE email = ?', [req.session.userEmail]);
    if (rows.length > 0) {
      req.session.inversionistaId = rows[0].id;
      return rows[0];
    }
  }
  return null;
}

exports.renderDashboard = async (req, res) => {
  try {
    const inversionista = await getInversionistaBySession(req);
    let prestamos = [];
    let kpi = {
      totalInvertido: 0,
      interesesCobrados: 0,
      interesesPendientes: 0,
      totalMoras: 0,
      prestamosActivos: 0,
      prestamosVencidos: 0,
      prestamosPagados: 0,
      proximoCobro: null
    };

    if (inversionista) {
      // 1. Get loans belonging to this investor
      const [rows] = await pool.query(`
        SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
               c.nombre_inversionista,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id) AS tiene_cronograma,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id) AS total_cuotas,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id AND estado = 'pagada') AS cuotas_pagadas,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id AND estado = 'vencida') AS cuotas_vencidas,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id AND estado = 'pendiente') AS cuotas_pendientes,
               (SELECT COALESCE(SUM(monto_pagado), 0) FROM cuotas WHERE prestamo_id = p.id) AS total_recuperado
        FROM prestamos p
        JOIN clientes c ON p.cliente_id = c.id
        WHERE p.inversor_id = ?
        ORDER BY p.id DESC
      `, [inversionista.id]);
      prestamos = rows;

      // 2. Get stats from prestamos agrupado por moneda
      const [prestStats] = await pool.query(`
        SELECT
          moneda,
          COALESCE(SUM(CASE WHEN estado IN ('activo', 'vencido') THEN monto ELSE 0 END), 0) AS totalInvertido,
          SUM(CASE WHEN estado = 'activo' THEN 1 ELSE 0 END) AS prestamosActivos,
          SUM(CASE WHEN estado = 'vencido' THEN 1 ELSE 0 END) AS prestamosVencidos,
          SUM(CASE WHEN estado = 'pagado' THEN 1 ELSE 0 END) AS prestamosPagados
        FROM prestamos
        WHERE inversor_id = ?
        GROUP BY moneda
      `, [inversionista.id]);

      // 3. Get stats from cuotas agrupado por moneda
      const [cuotaStats] = await pool.query(`
        SELECT
          p.moneda,
          COALESCE(SUM(CASE WHEN c.estado = 'pagada' THEN c.interes ELSE 0 END), 0) AS interesesCobrados,
          COALESCE(SUM(CASE WHEN c.estado != 'pagada' THEN c.interes ELSE 0 END), 0) AS interesesPendientes,
          COALESCE(SUM(c.mora), 0) AS totalMoras
        FROM cuotas c
        JOIN prestamos p ON c.prestamo_id = p.id
        WHERE p.inversor_id = ?
        GROUP BY p.moneda
      `, [inversionista.id]);
      // 4. Get next payment date and amount
      const [nextPayments] = await pool.query(`
        SELECT c.fecha_vencimiento, c.monto_cuota, cl.nombre AS cliente_nombre, p.id AS prestamo_id
        FROM cuotas c
        JOIN prestamos p ON c.prestamo_id = p.id
        JOIN clientes cl ON p.cliente_id = cl.id
        WHERE p.inversor_id = ? AND c.estado != 'pagada' AND c.fecha_vencimiento >= CURDATE()
        ORDER BY c.fecha_vencimiento ASC
        LIMIT 1
      `, [inversionista.id]);
      const solesPrest = prestStats.find(r => r.moneda === 'S/') || { totalInvertido: 0, prestamosActivos: 0, prestamosVencidos: 0, prestamosPagados: 0 };
      const dolaresPrest = prestStats.find(r => r.moneda === '$') || { totalInvertido: 0, prestamosActivos: 0, prestamosVencidos: 0, prestamosPagados: 0 };

      const solesCuota = cuotaStats.find(r => r.moneda === 'S/') || { interesesCobrados: 0, interesesPendientes: 0, totalMoras: 0 };
      const dolaresCuota = cuotaStats.find(r => r.moneda === '$') || { interesesCobrados: 0, interesesPendientes: 0, totalMoras: 0 };

      kpi = {
        soles: {
          totalInvertido: Number(solesPrest.totalInvertido),
          interesesCobrados: Number(solesCuota.interesesCobrados),
          interesesPendientes: Number(solesCuota.interesesPendientes),
          totalMoras: Number(solesCuota.totalMoras),
          prestamosActivos: Number(solesPrest.prestamosActivos || 0),
          prestamosVencidos: Number(solesPrest.prestamosVencidos || 0),
          prestamosPagados: Number(solesPrest.prestamosPagados || 0)
        },
        dolares: {
          totalInvertido: Number(dolaresPrest.totalInvertido),
          interesesCobrados: Number(dolaresCuota.interesesCobrados),
          interesesPendientes: Number(dolaresCuota.interesesPendientes),
          totalMoras: Number(dolaresCuota.totalMoras),
          prestamosActivos: Number(dolaresPrest.prestamosActivos || 0),
          prestamosVencidos: Number(dolaresPrest.prestamosVencidos || 0),
          prestamosPagados: Number(dolaresPrest.prestamosPagados || 0)
        },
        proximoCobro: nextPayments.length > 0 ? nextPayments[0] : null
      };
    }

    res.render('dashboards/inversionista', {
      ...getCommonData(req),
      inversionista,
      prestamos,
      kpi
    });
  } catch (err) {
    console.error('Error dashboard inversionista:', err);
    res.render('dashboards/inversionista', {
      ...getCommonData(req),
      inversionista: null,
      prestamos: [],
      kpi: {
        totalInvertido: 0,
        interesesCobrados: 0,
        interesesPendientes: 0,
        totalMoras: 0,
        prestamosActivos: 0,
        prestamosVencidos: 0,
        prestamosPagados: 0,
        proximoCobro: null
      }
    });
  }
};

exports.renderPrestamo = async (req, res) => {
  try {
    const inversionista = await getInversionistaBySession(req);
    if (!inversionista) {
      return res.render('inversionista/prestamo', {
        ...getCommonData(req),
        inversionista: null,
        prestamos: [],
        prestamo: null,
        cuotas: [],
        tablaAmortizacion: []
      });
    }

    const [prestamos] = await pool.query(`
      SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
             c.nombre_inversionista
      FROM prestamos p
      JOIN clientes c ON p.cliente_id = c.id
      WHERE p.inversor_id = ?
      ORDER BY p.id DESC
    `, [inversionista.id]);

    const prestamoId = req.query.id || (prestamos[0]?.id);
    const prestamo = prestamos.find(p => p.id == prestamoId) || null;
    
    let cuotas = [];
    if (prestamo) {
        const [rows] = await pool.query(`
            SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC
        `, [prestamo.id]);
        cuotas = rows;
    }

    const tablaAmortizacion = (prestamo && cuotas.length === 0) ? generarAmortizacion(prestamo) : [];

    res.render('inversionista/prestamo', {
      ...getCommonData(req),
      inversionista,
      prestamos,
      prestamo,
      cuotas,
      tablaAmortizacion
    });
  } catch (err) {
    console.error('Error préstamo inversionista:', err);
    res.render('inversionista/prestamo', {
      ...getCommonData(req),
      inversionista: null,
      prestamos: [],
      prestamo: null,
      cuotas: [],
      tablaAmortizacion: []
    });
  }
};

exports.renderPerfil = async (req, res) => {
  try {
    const inversionista = await getInversionistaBySession(req);
    res.render('inversionista/perfil', {
      ...getCommonData(req),
      ...getFlash(req),
      inversionista
    });
  } catch (err) {
    console.error('Error perfil inversionista:', err);
    res.render('inversionista/perfil', {
      ...getCommonData(req),
      inversionista: null,
      error: 'Error al cargar perfil.'
    });
  }
};

exports.actualizarPerfil = async (req, res) => {
  const { nombre, email, telefono, empresa, dni } = req.body;
  try {
    let inversionista = await getInversionistaBySession(req);
    if (!inversionista) {
      if (!nombre?.trim()) {
        return res.redirect('/inversionista/perfil?error=' + encodeURIComponent('El nombre es obligatorio.'));
      }
      const [result] = await pool.execute(
        'INSERT INTO inversionistas (nombre, email, telefono, empresa, dni, fecha_registro) VALUES (?, ?, ?, ?, ?, NOW())',
        [nombre.trim(), email || req.session.userEmail, telefono || null, empresa || null, dni || null]
      );
      req.session.inversionistaId = result.insertId;
      return res.redirect('/inversionista/perfil?success=' + encodeURIComponent('Perfil de inversionista creado correctamente.'));
    }
    await pool.execute(
      'UPDATE inversionistas SET nombre=?, email=?, telefono=?, empresa=?, dni=? WHERE id=?',
      [nombre?.trim() || inversionista.nombre, email || null, telefono || null, empresa || null, dni || null, inversionista.id]
    );
    if (email) req.session.userEmail = email;
    res.redirect('/inversionista/perfil?success=' + encodeURIComponent('Perfil de inversionista actualizado correctamente.'));
  } catch (err) {
    console.error('Error actualizando perfil inversionista:', err);
    res.redirect('/inversionista/perfil?error=' + encodeURIComponent('Error al actualizar el perfil.'));
  }
};

function generarAmortizacion(prestamo) {
  const monto = Number(prestamo.monto);
  const tasaAnual = Number(prestamo.interes) / 100;
  const plazo = Number(prestamo.plazo_meses);
  const cuota = Number(prestamo.cuota);
  const esQuincenal = prestamo.tipo_pago === 'quincenal';
  const numPagos = esQuincenal ? plazo * 2 : plazo;
  const tasaPeriodo = esQuincenal ? tasaAnual / 24 : tasaAnual / 12;

  const filas = [];
  let saldo = monto;
  const fechaBase = new Date(prestamo.fecha_registro || Date.now());

  for (let i = 1; i <= numPagos; i++) {
    const interesPago = saldo * tasaPeriodo;
    const capital = Math.min(cuota - interesPago, saldo);
    saldo = Math.max(0, saldo - capital);

    const fecha = new Date(fechaBase);
    if (esQuincenal) fecha.setDate(fecha.getDate() + i * 15);
    else fecha.setMonth(fecha.getMonth() + i);

    filas.push({
      num: i,
      fecha: fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
      cuota: cuota.toFixed(2),
      capital: capital.toFixed(2),
      interes: interesPago.toFixed(2),
      saldo: saldo.toFixed(2)
    });
  }
  return filas;
}

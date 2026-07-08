const pool = require('../config/db');
const { getCommonData, getFlash } = require('../helpers/viewHelpers');

async function getClienteBySession(req) {
  if (req.session.clienteId) {
    const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [req.session.clienteId]);
    if (rows.length > 0) return rows[0];
  }
  if (req.session.userEmail) {
    const [rows] = await pool.query('SELECT * FROM clientes WHERE email = ?', [req.session.userEmail]);
    if (rows.length > 0) {
      req.session.clienteId = rows[0].id;
      return rows[0];
    }
  }
  return null;
}

exports.renderDashboard = async (req, res) => {
  try {
    const cliente = await getClienteBySession(req);
    let prestamos = [];
    if (cliente) {
      const [rows] = await pool.query(`
        SELECT p.*, i.nombre AS inversor_nombre
        FROM prestamos p
        LEFT JOIN inversionistas i ON p.inversor_id = i.id
        WHERE p.cliente_id = ?
        ORDER BY p.fecha_registro DESC
      `, [cliente.id]);
      prestamos = rows;
    }

    const activo = prestamos.find(p => p.estado === 'activo') || prestamos[0] || null;

    res.render('dashboards/cliente', {
      ...getCommonData(req),
      cliente,
      prestamos,
      prestamoActivo: activo
    });
  } catch (err) {
    console.error('Error dashboard cliente:', err);
    res.render('dashboards/cliente', {
      ...getCommonData(req),
      cliente: null,
      prestamos: [],
      prestamoActivo: null
    });
  }
};

exports.renderPrestamo = async (req, res) => {
  try {
    const cliente = await getClienteBySession(req);
    if (!cliente) {
      return res.render('cliente/prestamo', {
        ...getCommonData(req),
        cliente: null,
        prestamos: [],
        prestamo: null,
        cuotas: [],
        tablaAmortizacion: []
      });
    }

    const [prestamos] = await pool.query(`
      SELECT p.*, i.nombre AS inversor_nombre
      FROM prestamos p
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE p.cliente_id = ?
      ORDER BY p.fecha_registro DESC
    `, [cliente.id]);

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

    res.render('cliente/prestamo', {
      ...getCommonData(req),
      cliente,
      prestamos,
      prestamo,
      cuotas,
      tablaAmortizacion
    });
  } catch (err) {
    console.error('Error préstamo cliente:', err);
    res.render('cliente/prestamo', {
      ...getCommonData(req),
      cliente: null,
      prestamos: [],
      prestamo: null,
      cuotas: [],
      tablaAmortizacion: []
    });
  }
};

exports.renderPerfil = async (req, res) => {
  try {
    const cliente = await getClienteBySession(req);
    res.render('cliente/perfil', {
      ...getCommonData(req),
      ...getFlash(req),
      cliente
    });
  } catch (err) {
    console.error('Error perfil cliente:', err);
    res.render('cliente/perfil', {
      ...getCommonData(req),
      cliente: null,
      error: 'Error al cargar perfil.'
    });
  }
};

exports.actualizarPerfil = async (req, res) => {
  const { nombre, email, telefono, direccion } = req.body;
  try {
    let cliente = await getClienteBySession(req);
    if (!cliente) {
      if (!nombre?.trim()) {
        return res.redirect('/cliente/perfil?error=' + encodeURIComponent('El nombre es obligatorio.'));
      }
      const [result] = await pool.execute(
        'INSERT INTO clientes (nombre, email, telefono, direccion, fecha_registro) VALUES (?, ?, ?, ?, NOW())',
        [nombre.trim(), email || req.session.userEmail, telefono || null, direccion || null]
      );
      req.session.clienteId = result.insertId;
      return res.redirect('/cliente/perfil?success=' + encodeURIComponent('Perfil creado correctamente.'));
    }
    await pool.execute(
      'UPDATE clientes SET nombre=?, email=?, telefono=?, direccion=? WHERE id=?',
      [nombre?.trim() || cliente.nombre, email || null, telefono || null, direccion || null, cliente.id]
    );
    if (email) req.session.userEmail = email;
    res.redirect('/cliente/perfil?success=' + encodeURIComponent('Perfil actualizado correctamente.'));
  } catch (err) {
    console.error('Error actualizando perfil:', err);
    res.redirect('/cliente/perfil?error=' + encodeURIComponent('Error al actualizar el perfil.'));
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
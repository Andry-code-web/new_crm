const pool = require('../config/db');
const { getCommonData, getFlash } = require('../helpers/viewHelpers');

// ─── CLIENTES ───────────────────────────────────────────────

exports.listClientes = async (req, res) => {
  try {
    const [clientes] = await pool.query('SELECT * FROM clientes ORDER BY nombre ASC');
    const [prestamos] = await pool.query('SELECT DISTINCT cliente_id FROM prestamos');
    const idsConPrestamo = new Set(prestamos.map(p => p.cliente_id));
    const ahora = new Date();
    const esMes = clientes.filter(c => {
      const f = new Date(c.fecha_registro || c.created_at);
      return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
    }).length;

    res.render('admin/clientes', {
      ...getCommonData(req),
      ...getFlash(req),
      clientes,
      conPrestamo: clientes.filter(c => idsConPrestamo.has(c.id)).length,
      esMes
    });
  } catch (err) {
    console.error('Error listando clientes:', err);
    res.render('admin/clientes', {
      ...getCommonData(req),
      ...getFlash(req),
      clientes: [],
      conPrestamo: 0,
      esMes: 0,
      error: 'Error al cargar clientes.'
    });
  }
};

exports.crearCliente = async (req, res) => {
  const { nombre, email, dni, telefono, direccion } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/clientes?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  try {
    await pool.execute(
      'INSERT INTO clientes (nombre, email, dni, telefono, direccion, fecha_registro) VALUES (?, ?, ?, ?, ?, NOW())',
      [nombre.trim(), email || null, dni || null, telefono || null, direccion || null]
    );
    res.redirect('/admin/clientes?success=' + encodeURIComponent('Cliente creado correctamente.'));
  } catch (err) {
    console.error('Error creando cliente:', err);
    res.redirect('/admin/clientes?error=' + encodeURIComponent('Error al crear el cliente.'));
  }
};

exports.editarCliente = async (req, res) => {
  const { nombre, email, dni, telefono, direccion } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/clientes?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  try {
    await pool.execute(
      'UPDATE clientes SET nombre=?, email=?, dni=?, telefono=?, direccion=? WHERE id=?',
      [nombre.trim(), email || null, dni || null, telefono || null, direccion || null, req.params.id]
    );
    res.redirect('/admin/clientes?success=' + encodeURIComponent('Cliente actualizado.'));
  } catch (err) {
    console.error('Error editando cliente:', err);
    res.redirect('/admin/clientes?error=' + encodeURIComponent('Error al actualizar el cliente.'));
  }
};

exports.eliminarCliente = async (req, res) => {
  try {
    const [prestamos] = await pool.query('SELECT id FROM prestamos WHERE cliente_id = ? LIMIT 1', [req.params.id]);
    if (prestamos.length > 0) {
      return res.redirect('/admin/clientes?error=' + encodeURIComponent('No se puede eliminar: tiene préstamos asociados.'));
    }
    await pool.execute('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.redirect('/admin/clientes?success=' + encodeURIComponent('Cliente eliminado.'));
  } catch (err) {
    console.error('Error eliminando cliente:', err);
    res.redirect('/admin/clientes?error=' + encodeURIComponent('Error al eliminar el cliente.'));
  }
};

// ─── INVERSIONISTAS ─────────────────────────────────────────

exports.listInversionistas = async (req, res) => {
  try {
    const [inversionistas] = await pool.query('SELECT * FROM inversionistas ORDER BY nombre ASC');
    const [prestamos] = await pool.query('SELECT inversor_id, monto FROM prestamos');
    const idsConPrestamo = new Set(prestamos.map(p => p.inversor_id));
    const montoTotal = prestamos.reduce((s, p) => s + Number(p.monto), 0);
    const ahora = new Date();
    const esMes = inversionistas.filter(i => {
      const f = new Date(i.fecha_registro || i.created_at);
      return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
    }).length;

    res.render('admin/inversionistas', {
      ...getCommonData(req),
      ...getFlash(req),
      inversionistas,
      conPrestamo: inversionistas.filter(i => idsConPrestamo.has(i.id)).length,
      montoTotal: montoTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 }),
      esMes
    });
  } catch (err) {
    console.error('Error listando inversionistas:', err);
    res.render('admin/inversionistas', {
      ...getCommonData(req),
      ...getFlash(req),
      inversionistas: [],
      conPrestamo: 0,
      montoTotal: '0.00',
      esMes: 0,
      error: 'Error al cargar inversionistas.'
    });
  }
};

exports.crearInversionista = async (req, res) => {
  const { nombre, email, dni, telefono, empresa } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/inversionistas?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  try {
    await pool.execute(
      'INSERT INTO inversionistas (nombre, email, dni, telefono, empresa, fecha_registro) VALUES (?, ?, ?, ?, ?, NOW())',
      [nombre.trim(), email || null, dni || null, telefono || null, empresa || null]
    );
    res.redirect('/admin/inversionistas?success=' + encodeURIComponent('Inversionista creado correctamente.'));
  } catch (err) {
    console.error('Error creando inversionista:', err);
    res.redirect('/admin/inversionistas?error=' + encodeURIComponent('Error al crear el inversionista.'));
  }
};

exports.editarInversionista = async (req, res) => {
  const { nombre, email, dni, telefono, empresa } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/inversionistas?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  try {
    await pool.execute(
      'UPDATE inversionistas SET nombre=?, email=?, dni=?, telefono=?, empresa=? WHERE id=?',
      [nombre.trim(), email || null, dni || null, telefono || null, empresa || null, req.params.id]
    );
    res.redirect('/admin/inversionistas?success=' + encodeURIComponent('Inversionista actualizado.'));
  } catch (err) {
    console.error('Error editando inversionista:', err);
    res.redirect('/admin/inversionistas?error=' + encodeURIComponent('Error al actualizar.'));
  }
};

exports.eliminarInversionista = async (req, res) => {
  try {
    const [prestamos] = await pool.query('SELECT id FROM prestamos WHERE inversor_id = ? LIMIT 1', [req.params.id]);
    if (prestamos.length > 0) {
      return res.redirect('/admin/inversionistas?error=' + encodeURIComponent('No se puede eliminar: tiene préstamos asociados.'));
    }
    await pool.execute('DELETE FROM inversionistas WHERE id = ?', [req.params.id]);
    res.redirect('/admin/inversionistas?success=' + encodeURIComponent('Inversionista eliminado.'));
  } catch (err) {
    console.error('Error eliminando inversionista:', err);
    res.redirect('/admin/inversionistas?error=' + encodeURIComponent('Error al eliminar.'));
  }
};

// ─── ASESORES ───────────────────────────────────────────────

exports.listAsesores = async (req, res) => {
  try {
    const [asesores] = await pool.query(`
      SELECT a.*, u.activo, u.email as user_email
      FROM asesores a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.nombre ASC
    `);
    const ahora = new Date();
    const esMes = asesores.filter(a => {
      const f = new Date(a.created_at);
      return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear();
    }).length;

    res.render('admin/asesores', {
      ...getCommonData(req),
      ...getFlash(req),
      asesores,
      activos: asesores.filter(a => a.activo !== 0).length,
      esMes
    });
  } catch (err) {
    console.error('Error listando asesores:', err);
    res.render('admin/asesores', {
      ...getCommonData(req),
      ...getFlash(req),
      asesores: [],
      activos: 0,
      esMes: 0,
      error: 'Error al cargar asesores.'
    });
  }
};

exports.crearAsesor = async (req, res) => {
  const { nombre, email, telefono, especialidad } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/asesores?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cleanEmail = email || `asesor${Date.now()}@coinest.com`;
    // Crear usuario
    const [userRes] = await conn.execute(
      'INSERT INTO users (email, password, role) VALUES (?, ?, "asesor")',
      [cleanEmail, 'asesor'] // Contraseña por defecto "asesor" para pruebas (debe hashearse en un sistema real)
    );
    const userId = userRes.insertId;

    const parts = nombre.trim().split(' ');
    const firstName = parts.shift();
    const lastName = parts.join(' ') || '-';

    // Crear asesor
    await conn.execute(
      'INSERT INTO asesores (user_id, nombre, apellidos, email, telefono, especialidad) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, firstName, lastName, cleanEmail, telefono || null, especialidad || null]
    );

    await conn.commit();
    res.redirect('/admin/asesores?success=' + encodeURIComponent('Asesor creado correctamente.'));
  } catch (err) {
    await conn.rollback();
    console.error('Error creando asesor:', err);
    const msg = err.code === 'ER_DUP_ENTRY' ? 'Ya existe un asesor con ese email.' : 'Error al crear el asesor.';
    res.redirect('/admin/asesores?error=' + encodeURIComponent(msg));
  } finally {
    conn.release();
  }
};

exports.editarAsesor = async (req, res) => {
  const { nombre, email, telefono, especialidad, activo } = req.body;
  if (!nombre?.trim()) {
    return res.redirect('/admin/asesores?error=' + encodeURIComponent('El nombre es obligatorio.'));
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const parts = nombre.trim().split(' ');
    const firstName = parts.shift();
    const lastName = parts.join(' ') || '-';

    await conn.execute(
      'UPDATE asesores SET nombre=?, apellidos=?, telefono=?, especialidad=? WHERE id=?',
      [firstName, lastName, telefono || null, especialidad || null, req.params.id]
    );

    const [asesorRows] = await conn.execute('SELECT user_id FROM asesores WHERE id = ?', [req.params.id]);
    if (asesorRows.length > 0) {
      await conn.execute(
        'UPDATE users SET activo=? WHERE id=?',
        [activo === '1' ? 1 : 0, asesorRows[0].user_id]
      );
    }
    
    await conn.commit();
    res.redirect('/admin/asesores?success=' + encodeURIComponent('Asesor actualizado.'));
  } catch (err) {
    await conn.rollback();
    console.error('Error editando asesor:', err);
    res.redirect('/admin/asesores?error=' + encodeURIComponent('Error al actualizar.'));
  } finally {
    conn.release();
  }
};

exports.eliminarAsesor = async (req, res) => {
  try {
    const [asesorRows] = await pool.execute('SELECT user_id FROM asesores WHERE id = ?', [req.params.id]);
    
    // Al eliminar el user, se elimina en cascada el asesor gracias al CONSTRAINT de la DB
    if (asesorRows.length > 0) {
      await pool.execute('DELETE FROM users WHERE id = ?', [asesorRows[0].user_id]);
    } else {
      await pool.execute('DELETE FROM asesores WHERE id = ?', [req.params.id]);
    }

    res.redirect('/admin/asesores?success=' + encodeURIComponent('Asesor eliminado.'));
  } catch (err) {
    console.error('Error eliminando asesor:', err);
    res.redirect('/admin/asesores?error=' + encodeURIComponent('Error al eliminar.'));
  }
};

// ─── PAGOS ──────────────────────────────────────────────────

exports.pagosPorVencer = (req, res) => {
  res.render('pagos/por_vencer', { ...getCommonData(req), ...getFlash(req) });
};

exports.pagosVencidos = (req, res) => {
  res.render('pagos/vencidos', { ...getCommonData(req), ...getFlash(req) });
};


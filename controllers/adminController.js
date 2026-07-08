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

    // Auto-create user account if email is provided
    if (email?.trim()) {
      const defaultPassword = dni?.trim() || 'cliente123';
      await pool.execute(
        'INSERT IGNORE INTO users (email, password, role) VALUES (?, ?, ?)',
        [email.trim(), defaultPassword, 'cliente']
      );
    }

    res.redirect('/admin/clientes?success=' + encodeURIComponent('Cliente creado correctamente y usuario habilitado.'));
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

    // Auto-create user account if email is provided
    if (email?.trim()) {
      const defaultPassword = dni?.trim() || 'inversor123';
      await pool.execute(
        'INSERT IGNORE INTO users (email, password, role) VALUES (?, ?, ?)',
        [email.trim(), defaultPassword, 'inversionista']
      );
    }

    res.redirect('/admin/inversionistas?success=' + encodeURIComponent('Inversionista creado correctamente y usuario habilitado.'));
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

exports.pagosPorVencer = async (req, res) => {
  try {
    // Cuotas que vencen en los próximos 5 días (no pagadas)
    const [cuotas] = await pool.query(`
      SELECT
        cu.id, cu.numero_cuota, cu.fecha_vencimiento, cu.monto_cuota, cu.saldo,
        DATEDIFF(cu.fecha_vencimiento, CURDATE()) AS dias_restantes,
        c.nombre  AS cliente_nombre,
        c.telefono AS cliente_telefono,
        i.nombre  AS inversor_nombre,
        p.id      AS prestamo_id,
        p.monto, p.cuota, p.interes
      FROM cuotas cu
      JOIN prestamos p ON cu.prestamo_id = p.id
      JOIN clientes  c ON p.cliente_id   = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE cu.estado IN ('pendiente', 'vencida')
        AND cu.fecha_vencimiento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 5 DAY)
      ORDER BY cu.fecha_vencimiento ASC
    `);

    const montoEnRiesgo = cuotas
      .reduce((sum, c) => sum + Number(c.monto_cuota), 0)
      .toLocaleString('es-MX', { minimumFractionDigits: 2 });

    const urgentes = cuotas.filter(c => Number(c.dias_restantes) <= 2).length;

    res.render('pagos/por_vencer', {
      ...getCommonData(req),
      ...getFlash(req),
      porVencer: cuotas,
      montoEnRiesgo,
      urgentes
    });
  } catch (err) {
    console.error('Error en pagosPorVencer:', err);
    res.render('pagos/por_vencer', {
      ...getCommonData(req),
      ...getFlash(req),
      porVencer: [],
      montoEnRiesgo: '0.00',
      urgentes: 0,
      error: 'Error al cargar los pagos por vencer.'
    });
  }
};

exports.pagosVencidos = async (req, res) => {
  try {
    // Leer mora configurada (tabla config simple)
    let moraPorDia = 0;
    try {
      const [cfg] = await pool.query("SELECT valor FROM config WHERE clave = 'mora_por_dia' LIMIT 1");
      if (cfg.length > 0) moraPorDia = Number(cfg[0].valor);
    } catch (e) { /* tabla config puede no existir aún */ }

    // Cuotas vencidas (fecha_vencimiento < HOY y no pagadas)
    const [cuotas] = await pool.query(`
      SELECT
        cu.id, cu.numero_cuota, cu.fecha_vencimiento, cu.monto_cuota, cu.saldo, cu.mora,
        DATEDIFF(CURDATE(), cu.fecha_vencimiento) AS dias_vencido,
        c.nombre   AS cliente_nombre,
        c.telefono AS cliente_telefono,
        i.nombre   AS inversor_nombre,
        p.id       AS prestamo_id,
        p.monto, p.cuota, p.interes
      FROM cuotas cu
      JOIN prestamos p ON cu.prestamo_id = p.id
      JOIN clientes  c ON p.cliente_id   = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE cu.estado IN ('pendiente', 'vencida')
        AND cu.fecha_vencimiento < CURDATE()
      ORDER BY dias_vencido DESC
    `);

    // Calcular mora acumulada por cuota según config
    const cuotasConMora = cuotas.map(c => ({
      ...c,
      mora_calculada: moraPorDia > 0
        ? (Number(c.dias_vencido) * moraPorDia).toFixed(2)
        : Number(c.mora || 0).toFixed(2),
      total_con_mora: (Number(c.monto_cuota) + (moraPorDia > 0
        ? Number(c.dias_vencido) * moraPorDia
        : Number(c.mora || 0))).toFixed(2)
    }));

    const montoVencido = cuotasConMora
      .reduce((sum, c) => sum + Number(c.total_con_mora), 0)
      .toLocaleString('es-MX', { minimumFractionDigits: 2 });

    const moraTotalAcumulada = cuotasConMora
      .reduce((sum, c) => sum + Number(c.mora_calculada), 0)
      .toLocaleString('es-MX', { minimumFractionDigits: 2 });

    res.render('pagos/vencidos', {
      ...getCommonData(req),
      ...getFlash(req),
      vencidos: cuotasConMora,
      montoVencido,
      moraTotalAcumulada,
      moraPorDia
    });
  } catch (err) {
    console.error('Error en pagosVencidos:', err);
    res.render('pagos/vencidos', {
      ...getCommonData(req),
      ...getFlash(req),
      vencidos: [],
      montoVencido: '0.00',
      moraTotalAcumulada: '0.00',
      moraPorDia: 0,
      error: 'Error al cargar los pagos vencidos.'
    });
  }
};

exports.guardarMora = async (req, res) => {
  try {
    const { mora_por_dia } = req.body;
    const valor = parseFloat(mora_por_dia);
    if (isNaN(valor) || valor < 0) {
      return res.status(400).json({ success: false, message: 'Valor de mora inválido.' });
    }

    // Crear tabla config si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        id    INT AUTO_INCREMENT PRIMARY KEY,
        clave VARCHAR(100) NOT NULL UNIQUE,
        valor VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(
      "INSERT INTO config (clave, valor) VALUES ('mora_por_dia', ?) ON DUPLICATE KEY UPDATE valor = ?",
      [valor.toString(), valor.toString()]
    );

    res.json({ success: true, message: `Mora actualizada a $${valor.toFixed(2)} por día.` });
  } catch (err) {
    console.error('Error guardando mora:', err);
    res.status(500).json({ success: false, message: 'Error al guardar la configuración de mora.' });
  }
};



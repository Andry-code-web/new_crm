const pool = require('../config/db');
const { getCommonData } = require('../helpers/viewHelpers');
const PDFDocument = require('pdfkit');

exports.renderAdminDashboard = async (req, res) => {
  try {
    const [[{ totalClientes }]] = await pool.query('SELECT COUNT(*) AS totalClientes FROM clientes');
    const [[{ totalInversionistas }]] = await pool.query('SELECT COUNT(*) AS totalInversionistas FROM inversionistas');
    const [[{ totalAsesores }]] = await pool.query('SELECT COUNT(*) AS totalAsesores FROM asesores');

    const [[prestStats]] = await pool.query(`
      SELECT
        COUNT(*)                          AS totalPrestamos,
        COALESCE(SUM(monto), 0)           AS montoTotal,
        COALESCE(SUM(total_intereses), 0) AS interesTotal,
        COALESCE(AVG(interes), 0)         AS interesPromedio,
        SUM(estado = 'activo')            AS prestamosActivos,
        SUM(estado = 'vencido')           AS prestamosVencidos,
        SUM(estado = 'pagado')            AS prestamosPagados
      FROM prestamos
    `);

    const [recentPrestamos] = await pool.query(`
      SELECT p.id, p.monto, p.interes, p.plazo_meses, p.tipo_pago,
             p.estado, p.fecha_registro,
             c.nombre AS cliente_nombre,
             i.nombre AS inversor_nombre
      FROM prestamos p
      LEFT JOIN clientes       c ON p.cliente_id  = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      ORDER BY p.fecha_registro DESC
      LIMIT 8
    `);

    const [[{ clientesMes }]] = await pool.query(`
      SELECT COUNT(*) AS clientesMes FROM clientes
      WHERE MONTH(fecha_registro) = MONTH(NOW())
        AND YEAR(fecha_registro)  = YEAR(NOW())
    `);

    const [chartData] = await pool.query(`
  SELECT
    DATE_FORMAT(fecha_registro, '%b %Y') AS mes,
    COUNT(*) AS cantidad,
    COALESCE(SUM(monto), 0) AS monto
  FROM prestamos
  WHERE fecha_registro >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
  GROUP BY DATE_FORMAT(fecha_registro, '%Y-%m'),
           DATE_FORMAT(fecha_registro, '%b %Y')
  ORDER BY MIN(fecha_registro) ASC
`);

    const fmt = (n) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    res.render('dashboards/admin', {
      ...getCommonData(req),
      kpi: {
        totalClientes,
        totalInversionistas,
        totalAsesores,
        totalPrestamos: prestStats.totalPrestamos || 0,
        montoTotal: fmt(prestStats.montoTotal),
        interesTotal: fmt(prestStats.interesTotal),
        interesPromedio: Number(prestStats.interesPromedio || 0).toFixed(2),
        prestamosActivos: prestStats.prestamosActivos || 0,
        prestamosVencidos: prestStats.prestamosVencidos || 0,
        prestamosPagados: prestStats.prestamosPagados || 0,
        clientesMes
      },
      recentPrestamos,
      chartData: JSON.stringify(chartData)
    });

  } catch (err) {
    console.error('Error cargando admin dashboard:', err);
    res.render('dashboards/admin', {
      ...getCommonData(req),
      kpi: {
        totalClientes: 0, totalInversionistas: 0, totalAsesores: 0,
        totalPrestamos: 0, montoTotal: '0.00', interesTotal: '0.00',
        interesPromedio: '0.00', prestamosActivos: 0, prestamosVencidos: 0,
        prestamosPagados: 0, clientesMes: 0
      },
      recentPrestamos: [],
      chartData: '[]'
    });
  }
};

exports.renderAsesorDashboard = async (req, res) => {
  try {
    let asesorId = null;
    const [asesorRows] = await pool.query('SELECT id FROM asesores WHERE user_id = ?', [req.session.userId]);
    if (asesorRows.length > 0) asesorId = asesorRows[0].id;

    let rows = [];
    if (asesorId) {
      [rows] = await pool.query(`
        SELECT
          COALESCE(SUM(monto), 0) AS total,
          SUM(estado = 'activo') AS activos,
          COUNT(DISTINCT cliente_id) AS clientes
        FROM prestamos
        WHERE asesor_id = ?
      `, [asesorId]);
    }
    const data = rows[0] || { total: 0, activos: 0, clientes: 0 };
    const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    res.render('dashboards/asesor', {
      ...getCommonData(req),
      balance: {
        total: fmt(data.total),
        currency: 'MXN',
        activos: data.activos || 0,
        clientes: data.clientes || 0
      }
    });
  } catch (err) {
    console.error('Error cargando asesor dashboard:', err);
    res.render('dashboards/asesor', {
      ...getCommonData(req),
      balance: { total: '0.00', currency: 'MXN', activos: 0, clientes: 0 }
    });
  }
};

exports.renderSimulacion = async (req, res) => {
  try {
    let clientes = [];
    let inversionistas = [];

    try {
      const [rowsClientes] = await pool.query('SELECT id, nombre FROM clientes ORDER BY nombre ASC');
      clientes = rowsClientes;
    } catch (e) {
      clientes = [
        { id: 1, nombre: 'Juan García López' },
        { id: 2, nombre: 'María Rodríguez Pérez' },
        { id: 3, nombre: 'Carlos Martínez Silva' }
      ];
    }

    try {
      const [rowsInv] = await pool.query('SELECT id, nombre FROM inversionistas ORDER BY nombre ASC');
      inversionistas = rowsInv;
    } catch (e) {
      inversionistas = [
        { id: 1, nombre: 'Inversiones del Norte S.A.' },
        { id: 2, nombre: 'Grupo Capital MX' },
        { id: 3, nombre: 'Fondo Hipotecario Premium' }
      ];
    }

    res.render('simulacion', {
      ...getCommonData(req),
      clientes,
      inversionistas,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error al cargar simulación:', err);
    res.render('simulacion', {
      ...getCommonData(req),
      clientes: [],
      inversionistas: [],
      success: null,
      error: 'Error al cargar los datos. Intenta de nuevo.'
    });
  }
};

exports.generarSimulacionPdf = (req, res) => {
  try {
    const {
      cliente_nombre, inversor_nombre, tasa_txt, plazo_txt,
      monto, cuota, total_pagar, total_intereses, tipo_pago, cronograma_json
    } = req.body;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-disposition', 'attachment; filename="Simulacion_Coinest.pdf"');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Colores Corporativos
    const colorNavy = '#0B162C';
    const colorGold = '#D4A843';
    const colorText = '#334155';
    const colorMuted = '#94A3B8';
    const colorBgRow = '#F8FAFC';

    // Encabezado
    doc.fillColor(colorNavy)
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('COINEST', { align: 'left' });

    doc.fillColor(colorGold)
      .fontSize(10)
      .text('SOLUCIONES FINANCIERAS', { align: 'left' });

    // Fecha en la esquina superior derecha alineada con el Header
    doc.page.fonts['Helvetica'] ? doc.font('Helvetica') : doc.font('Helvetica');
    doc.fillColor(colorMuted)
      .fontSize(10)
      .text(new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }), 50, 55, { align: 'right', width: 495 });

    doc.text('', 50, 110); // Resetear posición base después del header

    // Título Principal
    doc.fillColor(colorNavy)
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('Documento Informativo de Simulación Hipotecaria', { align: 'center' });

    doc.moveDown(1.5);

    // Función auxiliar optimizada para filas de información
    const drawRow = (label, value, isHighlight = false) => {
      const currentY = doc.y;

      doc.fillColor(isHighlight ? colorNavy : colorMuted)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(label, 50, currentY, { width: 200 });

      doc.fillColor(isHighlight ? colorNavy : colorText)
        .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
        .text(value, 250, currentY, { align: 'right', width: 295 });

      doc.moveDown(0.4);

      // Línea separadora
      doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(0.6);
    };

    // Sección: Información General
    doc.fillColor(colorNavy)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('INFORMACIÓN GENERAL', { underline: false });
    doc.moveDown(0.8);

    drawRow('CLIENTE:', cliente_nombre || 'N/A');
    drawRow('INVERSIONISTA:', inversor_nombre || 'N/A');
    drawRow('ASESOR ASIGNADO:', (req.session && req.session.name) ? req.session.name : 'N/A');

    doc.moveDown(1.5);

    // Sección: Detalles Financieros
    doc.fillColor(colorNavy)
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('DETALLES FINANCIEROS', { underline: false });
    doc.moveDown(0.8);

    const fmt = (n) => 'S/. ' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    drawRow('MONTO SOLICITADO:', fmt(monto), true);
    drawRow('TASA DE INTERÉS:', tasa_txt);
    drawRow('PLAZO:', plazo_txt);
    drawRow('TIPO DE PAGO:', (tipo_pago || '').toUpperCase());
    drawRow('TOTAL INTERESES:', fmt(total_intereses));
    drawRow('TOTAL A PAGAR:', fmt(total_pagar), true);

    doc.moveDown(1.5);

    // Cuadro de Cuota Destacada (Corregido posicionamiento absoluto y relativo)
    const boxY = doc.y;
    doc.rect(50, boxY, 495, 65).fill(colorNavy);

    doc.fillColor(colorGold)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('CUOTA ESTIMADA (' + (tipo_pago || '').toUpperCase() + ')', 70, boxY + 15);

    doc.fillColor('#FFFFFF')
      .fontSize(24)
      .font('Helvetica-Bold')
      .text(fmt(cuota), 70, boxY + 30, { align: 'right', width: 455 });

    doc.y = boxY + 85; // Forzar el puntero debajo del cuadro

    // Dibujar Tabla de Cronograma si existe
    if (cronograma_json) {
      try {
        const cronograma = JSON.parse(cronograma_json);
        if (Array.isArray(cronograma) && cronograma.length > 0) {
          doc.addPage();

          doc.fillColor(colorNavy)
            .fontSize(14)
            .font('Helvetica-Bold')
            .text('CRONOGRAMA DE AMORTIZACIÓN', { align: 'center' });

          doc.moveDown(1.5);

          const colX = [50, 85, 175, 265, 355, 455];
          const colWidths = [30, 85, 85, 85, 90, 90];

          // Función inline para pintar la cabecera de la tabla
          const drawTableHeader = () => {
            let headerY = doc.y;
            doc.fillColor(colorNavy).fontSize(9).font('Helvetica-Bold');

            doc.text('N°', colX[0], headerY, { width: colWidths[0], align: 'center' });
            doc.text('Saldo Inicial', colX[1], headerY, { width: colWidths[1], align: 'right' });
            doc.text('Capital', colX[2], headerY, { width: colWidths[2], align: 'right' });
            doc.text('Interés', colX[3], headerY, { width: colWidths[3], align: 'right' });
            doc.text('Cuota', colX[4], headerY, { width: colWidths[4], align: 'right' });
            doc.text('Saldo Final', colX[5], headerY, { width: colWidths[5], align: 'right' });

            doc.moveDown(0.4);
            doc.strokeColor(colorNavy).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(0.6);
          };

          drawTableHeader();

          let count = 0;

          cronograma.forEach(row => {
            // Control estricto del salto de página para evitar desbordes (A4 alto max ~842)
            if (doc.y > 740) {
              doc.addPage();
              drawTableHeader();
            }

            let rowY = doc.y;

            // Fondo intercalado para filas pares
            if (count % 2 !== 0) {
              doc.rect(50, rowY - 2, 495, 18).fill(colorBgRow);
            }

            // Fila de datos alineada por coordenadas exactas
            doc.fillColor(colorText).font('Helvetica').fontSize(9);
            doc.text(row.num, colX[0], rowY, { width: colWidths[0], align: 'center' });
            doc.text(fmt(row.saldoInicial), colX[1], rowY, { width: colWidths[1], align: 'right' });
            doc.text(fmt(row.capital), colX[2], rowY, { width: colWidths[2], align: 'right' });
            doc.text(fmt(row.interes), colX[3], rowY, { width: colWidths[3], align: 'right' });

            // Resaltamos la cuota
            doc.fillColor(colorNavy).font('Helvetica-Bold');
            doc.text(fmt(row.cuota), colX[4], rowY, { width: colWidths[4], align: 'right' });

            doc.fillColor(colorText).font('Helvetica');
            doc.text(fmt(row.saldoFinal), colX[5], rowY, { width: colWidths[5], align: 'right' });

            doc.moveDown(0.5);
            doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(0.5);

            count++;
          });
        }
      } catch (e) {
        console.error('Error parseando el cronograma', e);
      }
    }

    // Pie de página legal controlado (Evita solapamientos al final del stream)
    if (doc.y > 680) { doc.addPage(); } // Si falta espacio en la última hoja, se manda limpio a otra hoja

    doc.fontSize(7.5)
      .fillColor(colorMuted)
      .font('Helvetica')
      .text('AVISO LEGAL: El presente documento constituye una simulación meramente informativa y no representa una oferta vinculante ni un compromiso de otorgamiento de crédito por parte de Coinest. Las condiciones finales están sujetas a evaluación crediticia y aprobación final. Las tasas y montos pueden variar al momento de la formalización del contrato.',
        50,
        doc.y + 30, // Posicionamiento dinámico seguro relativo al final del contenido
        { align: 'justify', width: 495 }
      );

    doc.end();

  } catch (error) {
    console.error('Error generando PDF de simulación:', error);
    res.status(500).send('Error al generar el PDF de la simulación.');
  }
};

exports.registrarPrestamo = async (req, res) => {
  const {
    cliente_id, inversor_id, asesor_id: body_asesor_id, monto, interes,
    plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fecha_registro
  } = req.body;

  if (!cliente_id || !inversor_id || !monto || !interes || !plazo_meses || !tipo_pago) {
    return res.redirect('/dashboard/simulacion?error=' + encodeURIComponent('Faltan datos requeridos para registrar el préstamo.'));
  }

  try {
    let finalAsesorId = null;
    if (req.session.role === 'asesor') {
      const [asesorRows] = await pool.execute('SELECT id FROM asesores WHERE user_id = ?', [req.session.userId]);
      if (asesorRows.length > 0) finalAsesorId = asesorRows[0].id;
    } else {
      finalAsesorId = body_asesor_id || null;
    }

    // Usar la fecha ingresada o la fecha actual
    const fechaFinal = fecha_registro ? new Date(fecha_registro) : new Date();
    if (isNaN(fechaFinal.getTime())) {
      return res.redirect('/dashboard/simulacion?error=' + encodeURIComponent('La fecha de registro no es válida.'));
    }

    await pool.query(
      `INSERT INTO prestamos
        (cliente_id, inversor_id, asesor_id, monto, interes, plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fecha_registro)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cliente_id, inversor_id, finalAsesorId, monto, interes, plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fechaFinal]
    );
    res.redirect('/dashboard/prestamos?success=' + encodeURIComponent('\u00a1Préstamo registrado correctamente!'));
  } catch (err) {
    console.error('Error al registrar préstamo:', err);
    res.redirect('/dashboard/simulacion?error=' + encodeURIComponent('Error al guardar el préstamo: ' + err.message));
  }
};

exports.renderPrestamos = async (req, res) => {
  try {
    let prestamos = [];
    let stats = { total: 0, montoTotal: '0.00', interesPromedio: '0.00', clientesActivos: 0 };

    try {
      const [rows] = await pool.query(`
        SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, i.nombre AS inversor_nombre,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id) AS tiene_cronograma
        FROM prestamos p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        LEFT JOIN inversionistas i ON p.inversor_id = i.id
        ORDER BY p.fecha_registro DESC
      `);
      prestamos = rows;

      if (rows.length > 0) {
        const totalMonto = rows.reduce(function (sum, p) { return sum + Number(p.monto); }, 0);
        const interesSum = rows.reduce(function (sum, p) { return sum + Number(p.interes); }, 0);
        const clientesUnicos = new Set(rows.map(function (p) { return p.cliente_id; })).size;

        stats = {
          total: rows.length,
          montoTotal: totalMonto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          interesPromedio: (interesSum / rows.length).toFixed(2),
          clientesActivos: clientesUnicos
        };
      }
    } catch (e) {
      console.warn('Tabla prestamos no encontrada:', e.message);
    }

    res.render('prestamos', {
      ...getCommonData(req),
      prestamos,
      stats,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error al cargar préstamos:', err);
    res.render('prestamos', {
      ...getCommonData(req),
      prestamos: [],
      stats: { total: 0, montoTotal: '0.00', interesPromedio: '0.00', clientesActivos: 0 },
      success: null,
      error: 'Error al cargar los préstamos.'
    });
  }
};

exports.activarPrestamo = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("UPDATE prestamos SET estado = 'activo' WHERE id = ?", [id]);
    res.json({ success: true, message: 'Préstamo activado correctamente.' });
  } catch (error) {
    console.error('Error al activar préstamo:', error);
    res.status(500).json({ success: false, message: 'Error al activar el préstamo.' });
  }
};

exports.registrarCronograma = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si ya existe el cronograma
    const [existing] = await pool.execute('SELECT COUNT(*) as count FROM cuotas WHERE prestamo_id = ?', [id]);
    if (existing[0].count > 0) {
      return res.status(400).json({ success: false, message: 'El cronograma ya fue registrado para este préstamo.' });
    }

    // Obtener los datos del préstamo
    const [prestamos] = await pool.execute('SELECT monto, interes, plazo_meses, tipo_pago, cuota, fecha_registro, estado FROM prestamos WHERE id = ?', [id]);
    if (prestamos.length === 0) {
      return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    }

    if (prestamos[0].estado !== 'activo') {
      return res.status(400).json({ success: false, message: 'El préstamo debe estar activado para poder registrar su cronograma.' });
    }

    const p = prestamos[0];
    const monto = parseFloat(p.monto);
    const interes = parseFloat(p.interes);
    const plazo = parseInt(p.plazo_meses, 10);
    const tipoPago = p.tipo_pago;
    const cuotaMensual = parseFloat(p.cuota);

    // Replicar logica (Sistema Francés)
    const periodosPorAnio = tipoPago === 'mensual' ? 12 : 24;
    const tasaPeriodo = (interes / 100) / periodosPorAnio;
    const totalPeriodos = tipoPago === 'mensual' ? plazo : plazo * 2;

    let saldo = monto;
    
    // Calcular fechas a partir de fecha_registro
    let baseDate = new Date(p.fecha_registro);
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date(); // Fallback
    }

    const cuotasParaInsertar = [];

    for (let i = 1; i <= totalPeriodos; i++) {
      let intMes = saldo * tasaPeriodo;
      let cuotaCalc = cuotaMensual;
      
      // Manejar el caso de interes 0
      if (tasaPeriodo === 0) {
        cuotaCalc = monto / totalPeriodos;
      }
      
      let capMes = cuotaCalc - intMes;
      let saldoFin = saldo - capMes;
      
      // Ajuste de redondeo última cuota
      if (i === totalPeriodos) {
        capMes = saldo;
        cuotaCalc = capMes + intMes;
        saldoFin = 0;
      }

      // Calcular fecha de vencimiento
      let fechaVencimiento = new Date(baseDate.getTime());
      if (tipoPago === 'mensual') {
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);
      } else { // quincenal
        fechaVencimiento.setDate(fechaVencimiento.getDate() + (15 * i));
      }

      cuotasParaInsertar.push([
        id, 
        i, 
        fechaVencimiento, 
        cuotaCalc.toFixed(2), 
        capMes.toFixed(2), 
        intMes.toFixed(2), 
        saldoFin.toFixed(2), 
        'pendiente'
      ]);

      saldo = saldoFin;
    }

    // Insertar en la BD
    if (cuotasParaInsertar.length > 0) {
      const sql = 'INSERT INTO cuotas (prestamo_id, numero_cuota, fecha_vencimiento, monto_cuota, capital, interes, saldo, estado) VALUES ?';
      await pool.query(sql, [cuotasParaInsertar]);
    }

    res.json({ success: true, message: 'Cronograma registrado correctamente.' });
  } catch (error) {
    console.error('Error al registrar cronograma:', error);
    res.status(500).json({ success: false, message: 'Error interno al registrar el cronograma.' });
  }
};

exports.renderCronograma = async (req, res) => {
  try {
    const { id } = req.params;

    // Datos del préstamo + cliente
    const [prestamoRows] = await pool.execute(`
      SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono,
             i.nombre AS inversor_nombre
      FROM prestamos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE p.id = ?
    `, [id]);

    if (prestamoRows.length === 0) {
      return res.redirect('/dashboard/prestamos?error=' + encodeURIComponent('Préstamo no encontrado.'));
    }

    const prestamo = prestamoRows[0];

    // Cuotas del cronograma
    const [cuotas] = await pool.execute(`
      SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC
    `, [id]);

    if (cuotas.length === 0) {
      return res.redirect('/dashboard/prestamos?error=' + encodeURIComponent('Este préstamo no tiene cronograma registrado.'));
    }

    // Estadísticas del cronograma
    const totalCuotas = cuotas.length;
    const cuotasPagadas = cuotas.filter(c => c.estado === 'pagada').length;
    const cuotasPendientes = cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'vencida').length;
    const montoPagado = cuotas.reduce((sum, c) => sum + Number(c.monto_pagado || 0), 0);
    const montoPendiente = cuotas
      .filter(c => c.estado !== 'pagada')
      .reduce((sum, c) => sum + Number(c.monto_cuota), 0);

    res.render('cronograma', {
      ...getCommonData(req),
      prestamo,
      cuotas,
      stats: { totalCuotas, cuotasPagadas, cuotasPendientes, montoPagado, montoPendiente },
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error al renderizar cronograma:', error);
    res.redirect('/dashboard/prestamos?error=' + encodeURIComponent('Error al cargar el cronograma.'));
  }
};

exports.registrarPago = async (req, res) => {
  try {
    const { id, cuotaId } = req.params;
    const { observacion } = req.body;

    // Verificar que la cuota existe y pertenece al préstamo
    const [cuotaRows] = await pool.execute(
      'SELECT * FROM cuotas WHERE id = ? AND prestamo_id = ?',
      [cuotaId, id]
    );

    if (cuotaRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cuota no encontrada.' });
    }

    const cuota = cuotaRows[0];

    if (cuota.estado === 'pagada') {
      return res.status(400).json({ success: false, message: 'Esta cuota ya fue pagada.' });
    }

    // Marcar la cuota como pagada
    await pool.execute(
      `UPDATE cuotas SET estado = 'pagada', fecha_pago = NOW(), monto_pagado = monto_cuota, observacion = ? WHERE id = ?`,
      [observacion || null, cuotaId]
    );

    // Verificar si todas las cuotas del préstamo están pagadas para actualizar estado
    const [pendientes] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM cuotas WHERE prestamo_id = ? AND estado != 'pagada'`,
      [id]
    );
    if (pendientes[0].cnt === 0) {
      await pool.execute(`UPDATE prestamos SET estado = 'pagado' WHERE id = ?`, [id]);
    }

    res.json({ success: true, message: 'Pago registrado correctamente.' });
  } catch (error) {
    console.error('Error al registrar pago:', error);
    res.status(500).json({ success: false, message: 'Error interno al registrar el pago.' });
  }
};

exports.cambiarFechaInicio = async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha_inicio } = req.body;

    if (!fecha_inicio) {
      return res.status(400).json({ success: false, message: 'Debe indicar una fecha de inicio.' });
    }

    const nuevaFecha = new Date(fecha_inicio);
    if (isNaN(nuevaFecha.getTime())) {
      return res.status(400).json({ success: false, message: 'La fecha indicada no es válida.' });
    }

    // Verificar que el préstamo existe y tiene cronograma
    const [prestRows] = await pool.execute(
      'SELECT monto, interes, plazo_meses, tipo_pago, cuota FROM prestamos WHERE id = ?', [id]
    );
    if (prestRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    }

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM cuotas WHERE prestamo_id = ?', [id]
    );
    if (countRows[0].cnt === 0) {
      return res.status(400).json({ success: false, message: 'Este préstamo no tiene cronograma.' });
    }

    // Recalcular fechas de vencimiento de todas las cuotas según nueva fecha base
    const p = prestRows[0];
    const tipoPago = p.tipo_pago;
    const [cuotas] = await pool.execute(
      'SELECT id, numero_cuota FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]
    );

    for (const c of cuotas) {
      let nuevaFechaVenc = new Date(nuevaFecha.getTime());
      if (tipoPago === 'mensual') {
        nuevaFechaVenc.setMonth(nuevaFechaVenc.getMonth() + c.numero_cuota);
      } else {
        nuevaFechaVenc.setDate(nuevaFechaVenc.getDate() + (15 * c.numero_cuota));
      }
      await pool.execute(
        'UPDATE cuotas SET fecha_vencimiento = ? WHERE id = ?',
        [nuevaFechaVenc, c.id]
      );
    }

    // Actualizar también la fecha_registro del préstamo
    await pool.execute(
      'UPDATE prestamos SET fecha_registro = ? WHERE id = ?',
      [nuevaFecha, id]
    );

    res.json({ success: true, message: 'Fecha de inicio actualizada. Las fechas de vencimiento han sido recalculadas.' });
  } catch (error) {
    console.error('Error al cambiar fecha de inicio:', error);
    res.status(500).json({ success: false, message: 'Error interno al cambiar la fecha.' });
  }
};

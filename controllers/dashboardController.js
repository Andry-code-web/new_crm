const pool = require('../config/db');
const { getCommonData } = require('../helpers/viewHelpers');
const PDFDocument = require('pdfkit');
const path = require('path');

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
      ORDER BY p.id DESC
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
    const [asesorRows] = await pool.query(
      'SELECT id, nombre, apellidos, especialidad FROM asesores WHERE user_id = ?',
      [req.session.userId]
    );
    const asesor = asesorRows[0] || null;
    const asesorId = asesor ? asesor.id : null;

    const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let kpi = { total: 0, activos: 0, pendientes: 0, vencidos: 0, pagados: 0, montoTotal: '0.00', interesTotal: '0.00', clientes: 0, cuotasPorVencer: 0 };
    let recentPrestamos = [];
    let cuotasPorVencer = [];
    let chartData = [];

    if (asesorId) {
      // KPIs generales de la cartera del asesor
      const [[stats]] = await pool.query(`
        SELECT
          COUNT(*)                                AS total,
          SUM(estado = 'activo')                  AS activos,
          SUM(estado = 'pendiente')               AS pendientes,
          SUM(estado = 'vencido')                 AS vencidos,
          SUM(estado = 'pagado')                  AS pagados,
          COALESCE(SUM(monto), 0)                 AS montoTotal,
          COALESCE(SUM(total_intereses), 0)       AS interesTotal,
          COUNT(DISTINCT cliente_id)              AS clientes
        FROM prestamos WHERE asesor_id = ?
      `, [asesorId]);

      // Cuotas por vencer en 5 dias de los prestamos del asesor
      const [cpv] = await pool.query(`
        SELECT cu.id, cu.numero_cuota, cu.fecha_vencimiento, cu.monto_cuota,
               DATEDIFF(cu.fecha_vencimiento, CURDATE()) AS dias_restantes,
               c.nombre AS cliente_nombre
        FROM cuotas cu
        JOIN prestamos p ON cu.prestamo_id = p.id AND p.asesor_id = ?
        JOIN clientes c  ON p.cliente_id = c.id
        WHERE cu.estado IN ('pendiente','vencida')
          AND cu.fecha_vencimiento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 5 DAY)
        ORDER BY cu.fecha_vencimiento ASC
        LIMIT 5
      `, [asesorId]);

      // Prestamos recientes del asesor
      const [recent] = await pool.query(`
        SELECT p.id, p.monto, p.interes, p.plazo_meses, p.tipo_pago, p.estado, p.fecha_registro,
               c.nombre AS cliente_nombre, i.nombre AS inversor_nombre
        FROM prestamos p
        LEFT JOIN clientes       c ON p.cliente_id  = c.id
        LEFT JOIN inversionistas i ON p.inversor_id = i.id
        WHERE p.asesor_id = ?
        ORDER BY p.id DESC
        LIMIT 6
      `, [asesorId]);

      // Chart data: prestamos por mes (ultimos 6 meses)
      const [chart] = await pool.query(`
        SELECT DATE_FORMAT(fecha_registro, '%b %Y') AS mes,
               COUNT(*) AS cantidad,
               COALESCE(SUM(monto), 0) AS monto
        FROM prestamos
        WHERE asesor_id = ? AND fecha_registro >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY DATE_FORMAT(fecha_registro, '%Y-%m'), DATE_FORMAT(fecha_registro, '%b %Y')
        ORDER BY MIN(fecha_registro) ASC
      `, [asesorId]);

      kpi = {
        total: stats.total || 0,
        activos: stats.activos || 0,
        pendientes: stats.pendientes || 0,
        vencidos: stats.vencidos || 0,
        pagados: stats.pagados || 0,
        montoTotal: fmt(stats.montoTotal),
        interesTotal: fmt(stats.interesTotal),
        clientes: stats.clientes || 0,
        cuotasPorVencer: cpv.length
      };
      recentPrestamos = recent;
      cuotasPorVencer = cpv;
      chartData = chart;
    }

    res.render('dashboards/asesor', {
      ...getCommonData(req),
      asesor,
      kpi,
      recentPrestamos,
      cuotasPorVencer,
      chartData: JSON.stringify(chartData)
    });
  } catch (err) {
    console.error('Error cargando asesor dashboard:', err);
    res.render('dashboards/asesor', {
      ...getCommonData(req),
      asesor: null,
      kpi: { total: 0, activos: 0, pendientes: 0, vencidos: 0, pagados: 0, montoTotal: '0.00', interesTotal: '0.00', clientes: 0, cuotasPorVencer: 0 },
      recentPrestamos: [],
      cuotasPorVencer: [],
      chartData: '[]'
    });
  }
};

exports.renderSimulacion = async (req, res) => {
  try {
    const [clientes] = await pool.query('SELECT id, nombre FROM clientes ORDER BY nombre ASC');
    const [inversionistas] = await pool.query('SELECT id, nombre FROM inversionistas ORDER BY nombre ASC');

    res.render('simulacion', {
      ...getCommonData(req),
      clientes,
      inversionistas,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error al cargar simulaci\u00f3n:', err);
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
      monto, cuota, total_pagar, total_intereses, tipo_pago, cronograma_json, moneda,
      interes, tasa_mensual_txt, modalidad
    } = req.body;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    const safeMonto = monto ? Number(monto).toString().replace('.', '_') : 'prestamo';
    res.setHeader('Content-disposition', `attachment; filename="simulacion_${safeMonto}.pdf"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Colores Corporativos
    const colorNavy = '#0B162C';
    const colorGold = '#D4A843';
    const colorText = '#334155';
    const colorMuted = '#94A3B8';
    const colorBgRow = '#F8FAFC';

    // Función para dibujar la marca de agua
    const drawWatermark = () => {
      doc.save();
      doc.opacity(0.05);
      const wmSize = 350;
      doc.image(path.join(__dirname, '../public/img/logo_icon.png'), (doc.page.width - wmSize) / 2, (doc.page.height - wmSize) / 2, { width: wmSize });
      doc.restore();
    };

    doc.on('pageAdded', drawWatermark);
    drawWatermark();

    // Encabezado
    doc.image(path.join(__dirname, '../public/img/logo_horizontal.png'), 50, 40, { height: 40 });

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
        .fontSize(9.5)
        .text(label, 50, currentY, { width: 200 });

      doc.fillColor(isHighlight ? colorNavy : colorText)
        .font(isHighlight ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5)
        .text(value, 250, currentY, { align: 'right', width: 295 });

      doc.moveDown(0.35);

      // Línea separadora
      doc.strokeColor('#E2E8F0')
        .lineWidth(0.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(0.45);
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

    const simboloMoneda = (moneda && moneda.trim()) ? moneda.trim() : '$';
    const fmt = (n) => simboloMoneda + '\u00A0' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const tasaAnualNum = parseFloat(interes) || parseFloat(tasa_txt) || 0;
    const tasaMensualNum = tasaAnualNum > 0 ? (tasaAnualNum / 12) : 0;
    const tasaMensualCalculada = (tasaMensualNum % 1 === 0 ? tasaMensualNum.toFixed(0) : tasaMensualNum.toFixed(2)) + '% mensual';
    const tasaMensualFinal = tasa_mensual_txt || tasaMensualCalculada;

    drawRow('CAPITAL (MONTO SOLICITADO):', fmt(monto), true);
    drawRow('MONEDA:', simboloMoneda === '$' ? '$ Dólar' : 'S/ Sol Peruano');
    drawRow('MODALIDAD:', modalidad || 'Sistema Francés (Cuota Fija)');
    drawRow('TASA DE INTERÉS ANUAL:', tasa_txt || (tasaAnualNum + '% anual'));
    drawRow('TASA INTERÉS MENSUAL:', tasaMensualFinal);
    drawRow('PLAZO:', plazo_txt);
    drawRow('TIPO DE PAGO:', (tipo_pago || '').toUpperCase());
    drawRow('CUOTA ESTIMADA (' + (tipo_pago || 'MENSUAL').toUpperCase() + '):', fmt(cuota));
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

          const fmtPdfDate = (d) => {
            if (!d) return '—';
            const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
            if (isNaN(dt.getTime())) return String(d);
            const dd = String(dt.getDate()).padStart(2, '0');
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const yyyy = dt.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
          };

          const colX = [50, 75, 145, 225, 305, 380, 460];
          const colWidths = [25, 70, 80, 80, 75, 80, 85];

          // Función inline para pintar la cabecera de la tabla
          const drawTableHeader = () => {
            let headerY = doc.y;
            doc.fillColor(colorNavy).fontSize(8.5).font('Helvetica-Bold');

            doc.text('N°', colX[0], headerY, { width: colWidths[0], align: 'center' });
            doc.text('Vencimiento', colX[1], headerY, { width: colWidths[1], align: 'center' });
            doc.text('Saldo In.', colX[2], headerY, { width: colWidths[2], align: 'right' });
            doc.text('Capital', colX[3], headerY, { width: colWidths[3], align: 'right' });
            doc.text('Interés', colX[4], headerY, { width: colWidths[4], align: 'right' });
            doc.text('Cuota', colX[5], headerY, { width: colWidths[5], align: 'right' });
            doc.text('Saldo Fin.', colX[6], headerY, { width: colWidths[6], align: 'right' });

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
            doc.fillColor(colorText).font('Helvetica').fontSize(8.5);
            doc.text(row.num, colX[0], rowY, { width: colWidths[0], align: 'center' });
            doc.text(fmtPdfDate(row.fechaVencimiento), colX[1], rowY, { width: colWidths[1], align: 'center' });
            doc.text(fmt(row.saldoInicial), colX[2], rowY, { width: colWidths[2], align: 'right' });
            doc.text(fmt(row.capital), colX[3], rowY, { width: colWidths[3], align: 'right' });
            doc.text(fmt(row.interes), colX[4], rowY, { width: colWidths[4], align: 'right' });

            // Resaltamos la cuota
            doc.fillColor(colorNavy).font('Helvetica-Bold');
            doc.text(fmt(row.cuota), colX[5], rowY, { width: colWidths[5], align: 'right' });

            doc.fillColor(colorText).font('Helvetica');
            doc.text(fmt(row.saldoFinal), colX[6], rowY, { width: colWidths[6], align: 'right' });

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
      .text('AVISO LEGAL: El presente documento constituye una simulación meramente informativa y no representa una oferta vinculante ni un compromiso de otorgamiento de crédito por parte de Financiera Guzmán. Las condiciones finales están sujetas a evaluación crediticia y aprobación final. Las tasas y montos pueden variar al momento de la formalización del contrato.',
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
    plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fecha_registro, moneda,
    modalidad
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
        (cliente_id, inversor_id, asesor_id, monto, interes, plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fecha_registro, estado, moneda, modalidad)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [cliente_id, inversor_id, finalAsesorId, monto, interes, plazo_meses, tipo_pago, cuota, total_pagar, total_intereses, fechaFinal, moneda || '$', modalidad || 'frances']
    );
    res.redirect('/dashboard/prestamos?success=' + encodeURIComponent('¡Préstamo registrado correctamente!'));
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
      // Si es asesor, filtrar solo sus prestamos
      let whereClause = '';
      let params = [];
      if (req.session.role === 'asesor') {
        const [asesorRows] = await pool.query('SELECT id FROM asesores WHERE user_id = ?', [req.session.userId]);
        if (asesorRows.length > 0) {
          whereClause = 'WHERE p.asesor_id = ?';
          params = [asesorRows[0].id];
        }
      }

      const [rows] = await pool.query(`
        SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, i.nombre AS inversor_nombre,
               (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = p.id) AS tiene_cronograma
        FROM prestamos p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        LEFT JOIN inversionistas i ON p.inversor_id = i.id
        ${whereClause}
        ORDER BY p.id DESC
      `, params);
      prestamos = rows;

      if (rows.length > 0) {
        const totalMonto = rows.reduce((sum, p) => sum + Number(p.monto), 0);
        const interesSum = rows.reduce((sum, p) => sum + Number(p.interes), 0);
        const clientesUnicos = new Set(rows.map(p => p.cliente_id)).size;
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
    console.error('Error al cargar pr\u00e9stamos:', err);
    res.render('prestamos', {
      ...getCommonData(req),
      prestamos: [],
      stats: { total: 0, montoTotal: '0.00', interesPromedio: '0.00', clientesActivos: 0 },
      success: null,
      error: 'Error al cargar los pr\u00e9stamos.'
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
    const [prestamos] = await pool.execute('SELECT monto, interes, plazo_meses, tipo_pago, cuota, fecha_registro, estado, modalidad FROM prestamos WHERE id = ?', [id]);
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
    const modalidad = p.modalidad || 'frances';

    let periodosPorAnio = 12;
    let totalPeriodos = plazo;
    if (tipoPago === 'diario') {
      periodosPorAnio = 360;
      totalPeriodos = plazo * 30;
    } else if (tipoPago === 'semanal') {
      periodosPorAnio = 48;
      totalPeriodos = plazo * 4;
    } else if (tipoPago === 'quincenal') {
      periodosPorAnio = 24;
      totalPeriodos = plazo * 2;
    } else {
      periodosPorAnio = 12;
      totalPeriodos = plazo;
    }

    const tasaPeriodo = (interes / 100) / periodosPorAnio;
    const capFijoAleman = monto / totalPeriodos;

    let saldo = monto;

    // Calcular fechas a partir de fecha_registro
    let baseDate = new Date(p.fecha_registro);
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date(); // Fallback
    }

    const cuotasParaInsertar = [];

    for (let i = 1; i <= totalPeriodos; i++) {
      let intMes = saldo * tasaPeriodo;
      let capMes = 0;
      let cuotaCalc = 0;
      let saldoFin = 0;

      if (modalidad === 'interes_capital') {
        if (i === totalPeriodos) {
          capMes = saldo;
          cuotaCalc = capMes + intMes;
          saldoFin = 0;
        } else {
          capMes = 0;
          cuotaCalc = intMes;
          saldoFin = saldo;
        }
      } else if (modalidad === 'aleman') {
        capMes = (i === totalPeriodos) ? saldo : capFijoAleman;
        cuotaCalc = capMes + intMes;
        saldoFin = saldo - capMes;
      } else {
        // frances
        cuotaCalc = cuotaMensual;
        if (tasaPeriodo === 0) cuotaCalc = monto / totalPeriodos;
        capMes = cuotaCalc - intMes;
        saldoFin = saldo - capMes;
        if (i === totalPeriodos) {
          capMes = saldo;
          cuotaCalc = capMes + intMes;
          saldoFin = 0;
        }
      }

      // Calcular fecha de vencimiento
      let fechaVencimiento = new Date(baseDate.getTime());
      if (tipoPago === 'mensual') {
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);
      } else if (tipoPago === 'quincenal') {
        fechaVencimiento.setDate(fechaVencimiento.getDate() + (15 * i));
      } else if (tipoPago === 'semanal') {
        fechaVencimiento.setDate(fechaVencimiento.getDate() + (7 * i));
      } else if (tipoPago === 'diario') {
        fechaVencimiento.setDate(fechaVencimiento.getDate() + (1 * i));
      }

      cuotasParaInsertar.push([
        id,
        i,
        fechaVencimiento,
        cuotaCalc.toFixed(2),
        capMes.toFixed(2),
        intMes.toFixed(2),
        Math.max(0, saldoFin).toFixed(2),
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
             i.nombre AS inversor_nombre, i.telefono AS inversor_telefono, i.dni AS inversor_dni
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

    // Historial de amortizaciones
    const [amortizaciones] = await pool.execute(`
      SELECT * FROM amortizaciones WHERE prestamo_id = ? ORDER BY id DESC
    `, [id]);

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
      amortizaciones: amortizaciones || [],
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
      } else if (tipoPago === 'quincenal') {
        nuevaFechaVenc.setDate(nuevaFechaVenc.getDate() + (15 * c.numero_cuota));
      } else if (tipoPago === 'semanal') {
        nuevaFechaVenc.setDate(nuevaFechaVenc.getDate() + (7 * c.numero_cuota));
      } else if (tipoPago === 'diario') {
        nuevaFechaVenc.setDate(nuevaFechaVenc.getDate() + (1 * c.numero_cuota));
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

exports.registrarAmortizacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { monto, tipo_reduccion, fecha, observacion } = req.body;

    const abono = parseFloat(monto);
    if (isNaN(abono) || abono <= 0) {
      return res.status(400).json({ success: false, message: 'Ingrese un monto de amortización válido mayor a 0.' });
    }

    if (!tipo_reduccion || (tipo_reduccion !== 'cuota' && tipo_reduccion !== 'plazo')) {
      return res.status(400).json({ success: false, message: 'Seleccione un tipo de reducción válido (cuota o plazo).' });
    }

    // 1. Obtener préstamo
    const [prestRows] = await pool.execute('SELECT * FROM prestamos WHERE id = ?', [id]);
    if (prestRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    }
    const prestamo = prestRows[0];
    if (prestamo.estado !== 'activo') {
      return res.status(400).json({ success: false, message: 'Solo se pueden registrar amortizaciones en préstamos activos.' });
    }

    // 2. Obtener cuotas ordenadas
    const [cuotas] = await pool.execute(
      'SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC',
      [id]
    );

    if (cuotas.length === 0) {
      return res.status(400).json({ success: false, message: 'El préstamo no tiene cronograma registrado.' });
    }

    const cuotasPagadas = cuotas.filter(c => c.estado === 'pagada');
    const cuotasPendientes = cuotas.filter(c => c.estado !== 'pagada');

    if (cuotasPendientes.length === 0) {
      return res.status(400).json({ success: false, message: 'Todas las cuotas de este préstamo ya están pagadas.' });
    }

    // Saldo actual de capital pendiente
    let saldoActual = 0;
    if (cuotasPendientes.length > 0) {
      const sumCap = cuotasPendientes.reduce((sum, c) => sum + parseFloat(c.capital || 0), 0);
      const firstCuotaSaldoIn = parseFloat(cuotasPendientes[0].saldo || 0) + parseFloat(cuotasPendientes[0].capital || 0);
      saldoActual = Math.abs(sumCap - firstCuotaSaldoIn) < 0.1 ? firstCuotaSaldoIn : sumCap;
    }

    if (abono > saldoActual + 0.05) {
      return res.status(400).json({
        success: false,
        message: `El monto a amortizar (${abono.toFixed(2)}) no puede exceder el saldo pendiente (${saldoActual.toFixed(2)}).`
      });
    }

    const fechaAmort = fecha ? new Date(fecha) : new Date();
    const fechaAmortStr = !isNaN(fechaAmort.getTime()) ? fechaAmort.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    let periodosPorAnio = 12;
    if (prestamo.tipo_pago === 'diario') periodosPorAnio = 360;
    else if (prestamo.tipo_pago === 'semanal') periodosPorAnio = 48;
    else if (prestamo.tipo_pago === 'quincenal') periodosPorAnio = 24;
    const tasaPeriodo = (parseFloat(prestamo.interes) / 100) / periodosPorAnio;
    const modalidad = prestamo.modalidad || 'frances';
    const cuotaAnterior = parseFloat(cuotasPendientes[0].monto_cuota);
    const N_anterior = cuotasPendientes.length;

    // 3. Caso: Liquidación Total
    if (abono >= saldoActual - 0.05) {
      const primeraPend = cuotasPendientes[0];
      await pool.execute(
        `UPDATE cuotas SET 
          estado = 'pagada', 
          fecha_pago = ?, 
          monto_pagado = ?, 
          capital = ?, 
          interes = 0.00, 
          monto_cuota = ?, 
          saldo = 0.00, 
          observacion = ?
         WHERE id = ?`,
        [
          fechaAmortStr,
          saldoActual.toFixed(2),
          saldoActual.toFixed(2),
          saldoActual.toFixed(2),
          (observacion ? observacion + ' - ' : '') + 'Liquidación total anticipada de capital',
          primeraPend.id
        ]
      );

      // Eliminar cuotas pendientes adicionales
      if (cuotasPendientes.length > 1) {
        await pool.execute(
          'DELETE FROM cuotas WHERE prestamo_id = ? AND id != ? AND estado != ?',
          [id, primeraPend.id, 'pagada']
        );
      }

      // Marcar préstamo como pagado
      await pool.execute("UPDATE prestamos SET estado = 'pagado' WHERE id = ?", [id]);

      const [cuotasSnap] = await pool.query('SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]);

      // Registrar en amortizaciones
      await pool.execute(
        `INSERT INTO amortizaciones 
          (prestamo_id, monto, fecha, tipo_reduccion, saldo_anterior, saldo_nuevo, cuota_anterior, cuota_nueva, cuotas_restantes_anterior, cuotas_restantes_nueva, observacion, cronograma_snapshot)
         VALUES (?, ?, ?, ?, ?, 0.00, ?, 0.00, ?, 0, ?, ?)`,
        [
          id, abono.toFixed(2), fechaAmortStr, tipo_reduccion,
          saldoActual.toFixed(2), cuotaAnterior.toFixed(2),
          N_anterior, observacion || 'Liquidación total anticipada',
          JSON.stringify(cuotasSnap)
        ]
      );

      return res.json({
        success: true,
        message: '¡Préstamo liquidado totalmente! El capital restante ha sido cancelado con éxito.',
        data: {
          tipo: 'liquidacion_total',
          saldoNuevo: 0,
          cuotaNueva: 0,
          cuotasRestantes: 0
        }
      });
    }

    // 4. Caso: Amortización Parcial
    const saldoNuevo = saldoActual - abono;

    if (tipo_reduccion === 'cuota') {
      let cuotaNueva = 0;
      let sTemp = saldoNuevo;

      if (modalidad === 'interes_capital') {
        cuotaNueva = saldoNuevo * tasaPeriodo;
        for (let k = 0; k < N_anterior; k++) {
          const c = cuotasPendientes[k];
          const isLast = (k === N_anterior - 1);
          const cap = isLast ? saldoNuevo : 0;
          const int = cuotaNueva;
          const cMonto = isLast ? (cap + int) : int;
          const sFin = isLast ? 0 : saldoNuevo;
          const obsExtra = k === 0 ? ((observacion ? observacion + ' - ' : '') + `Abono capital ${prestamo.moneda || '$'} ${abono.toFixed(2)}`) : null;
          await pool.execute(
            `UPDATE cuotas SET capital = ?, interes = ?, monto_cuota = ?, saldo = ?, observacion = COALESCE(?, observacion) WHERE id = ?`,
            [cap.toFixed(2), int.toFixed(2), cMonto.toFixed(2), Math.max(0, sFin).toFixed(2), obsExtra, c.id]
          );
        }
      } else if (modalidad === 'aleman') {
        const capFijo = saldoNuevo / N_anterior;
        for (let k = 0; k < N_anterior; k++) {
          const c = cuotasPendientes[k];
          const isLast = (k === N_anterior - 1);
          const int = sTemp * tasaPeriodo;
          const cap = isLast ? sTemp : capFijo;
          const cMonto = cap + int;
          const sFin = isLast ? 0 : (sTemp - cap);
          if (k === 0) cuotaNueva = cMonto;
          const obsExtra = k === 0 ? ((observacion ? observacion + ' - ' : '') + `Abono capital ${prestamo.moneda || '$'} ${abono.toFixed(2)}`) : null;
          await pool.execute(
            `UPDATE cuotas SET capital = ?, interes = ?, monto_cuota = ?, saldo = ?, observacion = COALESCE(?, observacion) WHERE id = ?`,
            [cap.toFixed(2), int.toFixed(2), cMonto.toFixed(2), Math.max(0, sFin).toFixed(2), obsExtra, c.id]
          );
          sTemp = sFin;
        }
      } else {
        // frances
        if (tasaPeriodo === 0) {
          cuotaNueva = saldoNuevo / N_anterior;
        } else {
          cuotaNueva = saldoNuevo * (tasaPeriodo * Math.pow(1 + tasaPeriodo, N_anterior)) / (Math.pow(1 + tasaPeriodo, N_anterior) - 1);
        }
        for (let k = 0; k < N_anterior; k++) {
          const c = cuotasPendientes[k];
          const isLast = (k === N_anterior - 1);
          let int = sTemp * tasaPeriodo;
          let cap = cuotaNueva - int;
          let sFin = sTemp - cap;
          let cMonto = cuotaNueva;
          if (isLast) {
            cap = sTemp;
            cMonto = cap + int;
            sFin = 0;
          }
          const obsExtra = k === 0 ? ((observacion ? observacion + ' - ' : '') + `Abono capital ${prestamo.moneda || '$'} ${abono.toFixed(2)}`) : null;
          await pool.execute(
            `UPDATE cuotas SET capital = ?, interes = ?, monto_cuota = ?, saldo = ?, observacion = COALESCE(?, observacion) WHERE id = ?`,
            [cap.toFixed(2), int.toFixed(2), cMonto.toFixed(2), Math.max(0, sFin).toFixed(2), obsExtra, c.id]
          );
          sTemp = sFin;
        }
      }

      await pool.execute('UPDATE prestamos SET cuota = ? WHERE id = ?', [cuotaNueva.toFixed(2), id]);

      const [cuotasSnap] = await pool.query('SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]);

      await pool.execute(
        `INSERT INTO amortizaciones 
          (prestamo_id, monto, fecha, tipo_reduccion, saldo_anterior, saldo_nuevo, cuota_anterior, cuota_nueva, cuotas_restantes_anterior, cuotas_restantes_nueva, observacion, cronograma_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, abono.toFixed(2), fechaAmortStr, 'cuota',
          saldoActual.toFixed(2), saldoNuevo.toFixed(2),
          cuotaAnterior.toFixed(2), cuotaNueva.toFixed(2),
          N_anterior, N_anterior,
          observacion || 'Amortización con reducción de cuota',
          JSON.stringify(cuotasSnap)
        ]
      );

      return res.json({
        success: true,
        message: `Amortización registrada. La cuota se redujo a ${prestamo.moneda || '$'} ${cuotaNueva.toFixed(2)}.`,
        data: {
          tipo: 'reduccion_cuota',
          saldoNuevo: saldoNuevo.toFixed(2),
          cuotaAnterior: cuotaAnterior.toFixed(2),
          cuotaNueva: cuotaNueva.toFixed(2),
          cuotasRestantes: N_anterior
        }
      });

    } else {
      // Reducir plazo manteniendo la cuota mensual
      let newRows = [];
      let sTemp = saldoNuevo;

      if (modalidad === 'interes_capital') {
        const factorReduccion = abono / saldoActual;
        const mesesAReducir = Math.max(1, Math.round(N_anterior * factorReduccion));
        const newTotalCuotas = Math.max(1, N_anterior - mesesAReducir);
        const intMes = saldoNuevo * tasaPeriodo;

        for (let k = 0; k < newTotalCuotas; k++) {
          const isLast = (k === newTotalCuotas - 1);
          const cap = isLast ? saldoNuevo : 0;
          const int = intMes;
          const cMonto = isLast ? (cap + int) : int;
          const sFin = isLast ? 0 : saldoNuevo;
          newRows.push({ capital: cap, interes: int, cuota: cMonto, saldo: sFin });
        }
      } else if (modalidad === 'aleman') {
        const capFijo = parseFloat(cuotasPendientes[0].capital) || (saldoActual / N_anterior);
        while (sTemp > 0.01) {
          const int = sTemp * tasaPeriodo;
          const cap = Math.min(sTemp, capFijo);
          const sFin = sTemp - cap;
          newRows.push({ capital: cap, interes: int, cuota: cap + int, saldo: Math.max(0, sFin) });
          sTemp = sFin;
          if (newRows.length > 360) break;
        }
      } else {
        // frances: mantener cuota cuotaAnterior
        let cTarget = cuotaAnterior;
        while (sTemp > 0.01) {
          const int = sTemp * tasaPeriodo;
          let cap = cTarget - int;
          if (cap <= 0) cap = sTemp;
          if (cap >= sTemp) {
            cap = sTemp;
            const cMonto = cap + int;
            newRows.push({ capital: cap, interes: int, cuota: cMonto, saldo: 0 });
            sTemp = 0;
          } else {
            sTemp -= cap;
            newRows.push({ capital: cap, interes: int, cuota: cTarget, saldo: Math.max(0, sTemp) });
          }
          if (newRows.length > 360) break;
        }
      }

      // Actualizar las cuotas necesarias
      for (let k = 0; k < newRows.length; k++) {
        const c = cuotasPendientes[k];
        const row = newRows[k];
        const obsExtra = k === 0 ? ((observacion ? observacion + ' - ' : '') + `Abono capital ${prestamo.moneda || '$'} ${abono.toFixed(2)} (Reducción de plazo)`) : null;
        await pool.execute(
          `UPDATE cuotas SET capital = ?, interes = ?, monto_cuota = ?, saldo = ?, observacion = COALESCE(?, observacion) WHERE id = ?`,
          [row.capital.toFixed(2), row.interes.toFixed(2), row.cuota.toFixed(2), row.saldo.toFixed(2), obsExtra, c.id]
        );
      }

      // Eliminar cuotas sobrantes
      if (cuotasPendientes.length > newRows.length) {
        const cuotasAEliminar = cuotasPendientes.slice(newRows.length).map(c => c.id);
        if (cuotasAEliminar.length > 0) {
          await pool.query('DELETE FROM cuotas WHERE id IN (?)', [cuotasAEliminar]);
        }
      }

      // Actualizar plazo_meses del préstamo
      const totalCuotasRestantes = newRows.length;
      await pool.execute(
        'UPDATE prestamos SET plazo_meses = (SELECT COUNT(*) FROM cuotas WHERE prestamo_id = ?) WHERE id = ?',
        [id, id]
      );

      const [cuotasSnap] = await pool.query('SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]);

      // Registrar amortización
      await pool.execute(
        `INSERT INTO amortizaciones 
          (prestamo_id, monto, fecha, tipo_reduccion, saldo_anterior, saldo_nuevo, cuota_anterior, cuota_nueva, cuotas_restantes_anterior, cuotas_restantes_nueva, observacion, cronograma_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, abono.toFixed(2), fechaAmortStr, 'plazo',
          saldoActual.toFixed(2), saldoNuevo.toFixed(2),
          cuotaAnterior.toFixed(2), cuotaAnterior.toFixed(2),
          N_anterior, totalCuotasRestantes,
          observacion || 'Amortización con reducción de plazo',
          JSON.stringify(cuotasSnap)
        ]
      );

      return res.json({
        success: true,
        message: `Amortización registrada. Se redujo el plazo en ${N_anterior - totalCuotasRestantes} cuota(s). Quedan ${totalCuotasRestantes} cuota(s) pendiente(s).`,
        data: {
          tipo: 'reduccion_plazo',
          saldoNuevo: saldoNuevo.toFixed(2),
          cuotasRestantesAnterior: N_anterior,
          cuotasRestantesNueva: totalCuotasRestantes,
          cuotasAhorradas: N_anterior - totalCuotasRestantes
        }
      });
    }

  } catch (error) {
    console.error('Error al registrar amortización:', error);
    res.status(500).json({ success: false, message: 'Error interno al registrar la amortización: ' + error.message });
  }
};

exports.renderCalendario = async (req, res) => {
  try {
    let whereClause = '';
    let params = [];

    if (req.session.role === 'asesor') {
      const [asesorRows] = await pool.query('SELECT id FROM asesores WHERE user_id = ?', [req.session.userId]);
      if (asesorRows.length > 0) {
        whereClause = 'WHERE p.asesor_id = ?';
        params = [asesorRows[0].id];
      }
    }

    const [cuotas] = await pool.query(`
      SELECT 
        cu.id,
        cu.prestamo_id,
        cu.numero_cuota,
        DATE_FORMAT(cu.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento_str,
        DATE_FORMAT(cu.fecha_pago, '%Y-%m-%d') AS fecha_pago_str,
        cu.monto_cuota,
        cu.capital,
        cu.interes,
        cu.saldo,
        cu.mora,
        cu.monto_pagado,
        cu.estado,
        cu.observacion,
        c.id AS cliente_id,
        c.nombre AS cliente_nombre,
        c.telefono AS cliente_telefono,
        c.dni AS cliente_dni,
        i.id AS inversor_id,
        COALESCE(i.nombre, 'Sin inversor asignado') AS inversor_nombre,
        i.telefono AS inversor_telefono,
        i.dni AS inversor_dni,
        p.monto AS prestamo_monto,
        p.interes AS prestamo_interes,
        p.tipo_pago,
        p.plazo_meses,
        (SELECT COUNT(*) FROM cuotas c2 WHERE c2.prestamo_id = p.id) AS total_cuotas
      FROM cuotas cu
      JOIN prestamos p ON cu.prestamo_id = p.id
      JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      ${whereClause}
      ORDER BY cu.fecha_vencimiento ASC, cu.numero_cuota ASC
    `, params);

    const now = new Date();
    const hoyStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const cuotasFormateadas = cuotas.map(c => {
      let estadoUnificado = 'proximo';
      if (c.estado === 'pagada' || c.estado === 'pagado') {
        estadoUnificado = 'pagado';
      } else if (c.fecha_vencimiento_str < hoyStr) {
        estadoUnificado = 'vencido';
      } else {
        estadoUnificado = 'proximo';
      }

      return {
        id: c.id,
        prestamo_id: c.prestamo_id,
        numero_cuota: c.numero_cuota,
        total_cuotas: c.total_cuotas || c.numero_cuota,
        fecha_vencimiento: c.fecha_vencimiento_str,
        fecha_pago: c.fecha_pago_str,
        monto_cuota: Number(c.monto_cuota || 0),
        capital: Number(c.capital || 0),
        interes: Number(c.interes || 0),
        saldo: Number(c.saldo || 0),
        mora: Number(c.mora || 0),
        monto_pagado: Number(c.monto_pagado || 0),
        estado_original: c.estado,
        estado: estadoUnificado,
        observacion: c.observacion,
        cliente_id: c.cliente_id,
        cliente_nombre: c.cliente_nombre,
        cliente_telefono: c.cliente_telefono,
        cliente_dni: c.cliente_dni,
        inversor_id: c.inversor_id,
        inversor_nombre: c.inversor_nombre,
        inversor_telefono: c.inversor_telefono,
        inversor_dni: c.inversor_dni,
        prestamo_monto: Number(c.prestamo_monto || 0),
        tipo_pago: c.tipo_pago,
        plazo_meses: c.plazo_meses
      };
    });

    res.render('calendario', {
      ...getCommonData(req),
      cuotasJson: JSON.stringify(cuotasFormateadas),
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error al renderizar calendario:', error);
    res.render('calendario', {
      ...getCommonData(req),
      cuotasJson: '[]',
      success: null,
      error: 'Error al cargar los datos del calendario.'
    });
  }
};

// ==========================================
// PDF: SIMULACIÓN DE AMORTIZACIÓN EXTRAORDINARIA
// ==========================================
exports.generarAmortizacionSimulacionPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const { monto, tipo_reduccion, fecha, observacion } = req.body;

    const abono = parseFloat(monto);
    if (isNaN(abono) || abono <= 0) {
      return res.status(400).json({ success: false, message: 'Ingrese un monto de amortización válido.' });
    }

    const [prestRows] = await pool.query(`
      SELECT p.*,
             c.nombre AS cliente_nombre, c.dni AS cliente_dni, c.telefono AS cliente_telefono,
             i.nombre AS inversor_nombre, i.telefono AS inversor_telefono, i.dni AS inversor_dni
      FROM prestamos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE p.id = ?
    `, [id]);

    if (prestRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    }
    const prestamo = prestRows[0];

    const [cuotas] = await pool.query('SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]);
    if (cuotas.length === 0) {
      return res.status(400).json({ success: false, message: 'El préstamo no tiene cuotas registradas.' });
    }

    const cuotasPagadas = cuotas.filter(c => c.estado === 'pagada');
    const cuotasPendientes = cuotas.filter(c => c.estado !== 'pagada');

    if (cuotasPendientes.length === 0) {
      return res.status(400).json({ success: false, message: 'Todas las cuotas de este préstamo ya están pagadas.' });
    }

    let saldoActual = 0;
    if (cuotasPendientes.length > 0) {
      const sumCap = cuotasPendientes.reduce((sum, c) => sum + parseFloat(c.capital || 0), 0);
      const firstCuotaSaldoIn = parseFloat(cuotasPendientes[0].saldo || 0) + parseFloat(cuotasPendientes[0].capital || 0);
      saldoActual = Math.abs(sumCap - firstCuotaSaldoIn) < 0.1 ? firstCuotaSaldoIn : sumCap;
    }

    if (abono > saldoActual + 0.05) {
      return res.status(400).json({
        success: false,
        message: `El monto a amortizar no puede superar el saldo capital pendiente (${prestamo.moneda || '$'} ${saldoActual.toFixed(2)}).`
      });
    }

    let periodosPorAnio = 12;
    if (prestamo.tipo_pago === 'diario') periodosPorAnio = 360;
    else if (prestamo.tipo_pago === 'semanal') periodosPorAnio = 48;
    else if (prestamo.tipo_pago === 'quincenal') periodosPorAnio = 24;

    const tasaPeriodo = (parseFloat(prestamo.interes) / 100) / periodosPorAnio;
    const modalidad = prestamo.modalidad || 'frances';
    const cuotaAnterior = parseFloat(cuotasPendientes[0].monto_cuota);
    const N_anterior = cuotasPendientes.length;
    const isLiquidacion = (abono >= saldoActual - 0.05);

    let saldoNuevo = isLiquidacion ? 0 : (saldoActual - abono);
    let cuotaNueva = cuotaAnterior;
    let cuotasRestantesNueva = N_anterior;
    let newRows = [];

    if (isLiquidacion) {
      cuotaNueva = 0;
      cuotasRestantesNueva = 0;
      newRows.push({
        num: cuotasPendientes[0].numero_cuota,
        fechaVencimiento: cuotasPendientes[0].fecha_vencimiento,
        saldoInicial: saldoActual,
        capital: saldoActual,
        interes: 0,
        cuota: saldoActual,
        saldo: 0,
        estado: 'Liquidación Total'
      });
    } else if (tipo_reduccion === 'cuota') {
      if (modalidad === 'interes_capital') {
        cuotaNueva = saldoNuevo * tasaPeriodo;
      } else if (modalidad === 'aleman') {
        cuotaNueva = (saldoNuevo / N_anterior) + (saldoNuevo * tasaPeriodo);
      } else {
        cuotaNueva = tasaPeriodo === 0 ? (saldoNuevo / N_anterior) : saldoNuevo * (tasaPeriodo * Math.pow(1 + tasaPeriodo, N_anterior)) / (Math.pow(1 + tasaPeriodo, N_anterior) - 1);
      }

      let sTemp = saldoNuevo;
      for (let k = 0; k < N_anterior; k++) {
        const c = cuotasPendientes[k];
        const isLast = (k === N_anterior - 1);
        let int = sTemp * tasaPeriodo;
        let cap = 0;
        let cMonto = 0;
        let sFin = 0;

        if (modalidad === 'interes_capital') {
          cap = isLast ? saldoNuevo : 0;
          int = cuotaNueva;
          cMonto = isLast ? (cap + int) : int;
          sFin = isLast ? 0 : saldoNuevo;
        } else if (modalidad === 'aleman') {
          const capFijo = saldoNuevo / N_anterior;
          cap = isLast ? sTemp : capFijo;
          cMonto = cap + int;
          sFin = isLast ? 0 : (sTemp - cap);
        } else {
          cap = isLast ? sTemp : (cuotaNueva - int);
          cMonto = isLast ? (cap + int) : cuotaNueva;
          sFin = isLast ? 0 : Math.max(0, sTemp - cap);
        }

        newRows.push({
          num: c.numero_cuota,
          fechaVencimiento: c.fecha_vencimiento,
          saldoInicial: sTemp,
          capital: cap,
          interes: int,
          cuota: cMonto,
          saldo: sFin,
          estado: 'Proyectada'
        });
        sTemp = sFin;
      }
    } else {
      // Reducir plazo
      let sTemp = saldoNuevo;
      if (modalidad === 'interes_capital') {
        const factor = abono / saldoActual;
        const mesesMenos = Math.max(1, Math.round(N_anterior * factor));
        const newTotal = Math.max(1, N_anterior - mesesMenos);
        cuotasRestantesNueva = newTotal;
        const intMes = saldoNuevo * tasaPeriodo;
        for (let k = 0; k < newTotal; k++) {
          const isLast = (k === newTotal - 1);
          const cap = isLast ? saldoNuevo : 0;
          const int = intMes;
          const cMonto = isLast ? (cap + int) : int;
          const sFin = isLast ? 0 : saldoNuevo;
          newRows.push({
            num: (cuotasPagadas.length + k + 1),
            fechaVencimiento: cuotasPendientes[k] ? cuotasPendientes[k].fecha_vencimiento : null,
            saldoInicial: saldoNuevo,
            capital: cap,
            interes: int,
            cuota: cMonto,
            saldo: sFin,
            estado: 'Proyectada'
          });
        }
      } else if (modalidad === 'aleman') {
        const capFijo = parseFloat(cuotasPendientes[0].capital) || (saldoActual / N_anterior);
        let k = 0;
        while (sTemp > 0.01 && k < 360) {
          const int = sTemp * tasaPeriodo;
          const cap = Math.min(sTemp, capFijo);
          const sFin = Math.max(0, sTemp - cap);
          newRows.push({
            num: (cuotasPagadas.length + k + 1),
            fechaVencimiento: cuotasPendientes[k] ? cuotasPendientes[k].fecha_vencimiento : null,
            saldoInicial: sTemp,
            capital: cap,
            interes: int,
            cuota: cap + int,
            saldo: sFin,
            estado: 'Proyectada'
          });
          sTemp = sFin;
          k++;
        }
        cuotasRestantesNueva = newRows.length;
      } else {
        // Frances
        let k = 0;
        while (sTemp > 0.01 && k < 360) {
          const int = sTemp * tasaPeriodo;
          let cap = cuotaAnterior - int;
          if (cap <= 0) cap = sTemp;
          let sFin = 0;
          let cMonto = cuotaAnterior;
          if (cap >= sTemp) {
            cap = sTemp;
            cMonto = cap + int;
            sFin = 0;
          } else {
            sFin = Math.max(0, sTemp - cap);
          }
          newRows.push({
            num: (cuotasPagadas.length + k + 1),
            fechaVencimiento: cuotasPendientes[k] ? cuotasPendientes[k].fecha_vencimiento : null,
            saldoInicial: sTemp,
            capital: cap,
            interes: int,
            cuota: cMonto,
            saldo: sFin,
            estado: 'Proyectada'
          });
          sTemp = sFin;
          k++;
        }
        cuotasRestantesNueva = newRows.length;
      }
    }

    // Unir cronograma completo: Pagadas + Nuevas Proyectadas
    const cronogramaFinal = [
      ...cuotasPagadas.map(c => ({
        num: c.numero_cuota,
        fechaVencimiento: c.fecha_vencimiento,
        saldoInicial: (parseFloat(c.saldo) + parseFloat(c.capital)),
        capital: parseFloat(c.capital),
        interes: parseFloat(c.interes),
        cuota: parseFloat(c.monto_cuota),
        saldo: parseFloat(c.saldo),
        estado: 'Pagada'
      })),
      ...newRows
    ];

    // GENERAR PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-disposition', `attachment; filename="simulacion_amortizacion_prestamo_${id}.pdf"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    const mon = prestamo.moneda || '$';
    const fmt = (n) => mon + '\u00A0' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPdfDate = (d) => {
      if (!d) return '—';
      const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = dt.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const colorNavy = '#0B162C';
    const colorGold = '#D4A843';
    const colorText = '#334155';
    const colorMuted = '#94A3B8';
    const colorBgRow = '#F8FAFC';
    const colorSuccess = '#16A34A';

    const drawWatermark = () => {
      doc.save();
      doc.opacity(0.04);
      const wmSize = 350;
      doc.image(path.join(__dirname, '../public/img/logo_icon.png'), (doc.page.width - wmSize) / 2, (doc.page.height - wmSize) / 2, { width: wmSize });
      doc.restore();
    };

    doc.on('pageAdded', drawWatermark);
    drawWatermark();

    // Header Logo
    doc.image(path.join(__dirname, '../public/img/logo_horizontal.png'), 50, 40, { height: 38 });

    // Fecha Header
    doc.fillColor(colorMuted).fontSize(9).font('Helvetica')
      .text('Fecha: ' + new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }), 50, 48, { align: 'right', width: 495 });
    doc.fillColor(colorGold).fontSize(8.5).font('Helvetica-Bold')
      .text('DOCUMENTO INFORMATIVO (SIMULACIÓN)', 50, 62, { align: 'right', width: 495 });

    doc.text('', 50, 95);

    // Titulo
    doc.fillColor(colorNavy).fontSize(16).font('Helvetica-Bold')
      .text('Simulación de Amortización Extraordinaria de Capital', { align: 'center' });
    doc.fillColor(colorMuted).fontSize(10).font('Helvetica')
      .text(`Préstamo #${prestamo.id} · Recálculo Proyectado del Cronograma`, { align: 'center' });

    doc.moveDown(1.2);

    const drawRow = (label, value, isHighlight = false) => {
      const currentY = doc.y;
      doc.fillColor(isHighlight ? colorNavy : colorMuted).font('Helvetica-Bold').fontSize(9).text(label, 50, currentY, { width: 190 });
      doc.fillColor(isHighlight ? colorNavy : colorText).font(isHighlight ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(value, 240, currentY, { align: 'right', width: 305 });
      doc.moveDown(0.35);
      doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.4);
    };

    // Datos Préstamo & Cliente
    doc.fillColor(colorNavy).fontSize(11).font('Helvetica-Bold').text('INFORMACIÓN GENERAL', { underline: false });
    doc.moveDown(0.6);

    drawRow('CLIENTE:', prestamo.cliente_nombre ? `${prestamo.cliente_nombre} (DNI: ${prestamo.cliente_dni || '—'})` : 'N/A');
    drawRow('INVERSIONISTA:', prestamo.inversor_nombre || 'N/A');
    drawRow('ASESOR:', (req.session && req.session.name) ? req.session.name : 'N/A');
    drawRow('SISTEMA / MODALIDAD:', modalidad === 'frances' ? 'Sistema Francés (Cuota Fija)' : (modalidad === 'aleman' ? 'Sistema Alemán (Amortización Constante)' : 'Interés Simple Mensual y Capital al Vencimiento'));
    drawRow('TASA DE INTERÉS:', `${prestamo.interes}% anual`);
    drawRow('TIPO DE PAGO:', (prestamo.tipo_pago || 'mensual').toUpperCase());

    doc.moveDown(0.8);

    // Tarjeta Resumen Amortización
    const boxY = doc.y;
    doc.rect(50, boxY, 495, 80).fillAndStroke('#0B162C', '#0B162C');

    doc.fillColor('#D4A843').fontSize(9.5).font('Helvetica-Bold')
      .text('PROYECCIÓN DE LA AMORTIZACIÓN SIMULADA', 65, boxY + 10);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Monto a Amortizar:', 65, boxY + 28);
    doc.fillColor('#10B981').fontSize(12).font('Helvetica-Bold')
      .text(fmt(abono), 65, boxY + 40);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Modalidad de Reducción:', 225, boxY + 28);
    doc.fillColor('#FFFFFF').fontSize(10.5).font('Helvetica-Bold')
      .text(isLiquidacion ? 'Liquidación Total' : (tipo_reduccion === 'cuota' ? 'Reducción de Cuota' : 'Reducción de Plazo'), 225, boxY + 41);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Nuevo Saldo Capital:', 385, boxY + 28);
    doc.fillColor('#D4A843').fontSize(12).font('Helvetica-Bold')
      .text(fmt(saldoNuevo), 385, boxY + 40);

    // Línea inferior de beneficio
    let benefTxt = '';
    if (isLiquidacion) {
      benefTxt = '¡Liquidación total de la deuda! No se generarán cuotas posteriores.';
    } else if (tipo_reduccion === 'cuota') {
      benefTxt = `La cuota mensual se reduce de ${fmt(cuotaAnterior)} a ${fmt(cuotaNueva)} (Ahorro mensual: ${fmt(cuotaAnterior - cuotaNueva)}) manteniendo ${N_anterior} cuotas.`;
    } else {
      benefTxt = `El plazo se reduce en ${N_anterior - cuotasRestantesNueva} cuotas (de ${N_anterior} a ${cuotasRestantesNueva} cuotas) manteniendo cuota de ${fmt(cuotaAnterior)}.`;
    }

    doc.fillColor('#E2E8F0').fontSize(8.5).font('Helvetica-Bold')
      .text(benefTxt, 65, boxY + 62, { width: 465 });

    doc.y = boxY + 95;

    // Tabla de Cronograma Proyectado
    doc.fillColor(colorNavy).fontSize(11).font('Helvetica-Bold')
      .text('CRONOGRAMA DE PAGOS PROYECTADO', { underline: false });
    doc.moveDown(0.6);

    const colX = [50, 75, 140, 208, 273, 333, 400, 472];
    const colWidths = [25, 65, 68, 65, 60, 67, 72, 73];

    const drawTableHeader = () => {
      let headerY = doc.y;
      doc.rect(50, headerY - 2, 495, 18).fill('#0B162C');
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      doc.text('N°', colX[0], headerY + 3, { width: colWidths[0], align: 'center' });
      doc.text('Vencimiento', colX[1], headerY + 3, { width: colWidths[1], align: 'center' });
      doc.text('Saldo In.', colX[2], headerY + 3, { width: colWidths[2], align: 'right' });
      doc.text('Capital', colX[3], headerY + 3, { width: colWidths[3], align: 'right' });
      doc.text('Interés', colX[4], headerY + 3, { width: colWidths[4], align: 'right' });
      doc.text('Cuota', colX[5], headerY + 3, { width: colWidths[5], align: 'right' });
      doc.text('Saldo Fin.', colX[6], headerY + 3, { width: colWidths[6], align: 'right' });
      doc.text('Estado', colX[7], headerY + 3, { width: colWidths[7], align: 'center' });

      doc.y = headerY + 22;
    };

    drawTableHeader();

    let count = 0;
    cronogramaFinal.forEach(row => {
      if (doc.y > 730) {
        doc.addPage();
        drawTableHeader();
      }

      let rowY = doc.y;
      if (count % 2 !== 0) {
        doc.rect(50, rowY - 2, 495, 16).fill(colorBgRow);
      }

      const isPagada = row.estado === 'Pagada';
      const isLiq = row.estado === 'Liquidación Total';

      doc.fillColor(isPagada ? colorMuted : colorNavy).font(isPagada ? 'Helvetica' : 'Helvetica-Bold').fontSize(7.8);
      doc.text(String(row.num), colX[0], rowY, { width: colWidths[0], align: 'center' });
      doc.text(fmtPdfDate(row.fechaVencimiento), colX[1], rowY, { width: colWidths[1], align: 'center' });
      doc.text(fmt(row.saldoInicial), colX[2], rowY, { width: colWidths[2], align: 'right' });
      doc.text(fmt(row.capital), colX[3], rowY, { width: colWidths[3], align: 'right' });
      doc.text(fmt(row.interes), colX[4], rowY, { width: colWidths[4], align: 'right' });
      doc.text(fmt(row.cuota), colX[5], rowY, { width: colWidths[5], align: 'right' });
      doc.text(fmt(row.saldo), colX[6], rowY, { width: colWidths[6], align: 'right' });

      if (isPagada) {
        doc.fillColor(colorSuccess).font('Helvetica-Bold').text('PAGADA', colX[7], rowY, { width: colWidths[7], align: 'center' });
      } else if (isLiq) {
        doc.fillColor(colorGold).font('Helvetica-Bold').text('LIQUIDADA', colX[7], rowY, { width: colWidths[7], align: 'center' });
      } else {
        doc.fillColor('#2563EB').font('Helvetica').text('PROYECTADA', colX[7], rowY, { width: colWidths[7], align: 'center' });
      }

      doc.moveDown(0.7);
      count++;
    });

    // Disclaimer
    doc.moveDown(1.5);
    if (doc.y > 730) doc.addPage();
    doc.fillColor(colorMuted).fontSize(8).font('Helvetica-Oblique')
      .text('* Nota: Esta simulación es un documento de cálculo informativo previo. La amortización y nuevo cronograma serán vinculantes una vez registrados y confirmados formalmente en el sistema.', { align: 'center', width: 495 });

    doc.end();

  } catch (error) {
    console.error('Error generando PDF de simulación de amortización:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Error interno al generar el PDF de simulación: ' + error.message });
    }
  }
};

// ==========================================
// PDF: COMPROBANTE OFICIAL DE AMORTIZACIÓN Y CRONOGRAMA
// ==========================================
exports.generarAmortizacionComprobantePdf = async (req, res) => {
  try {
    const { id, amortizacionId } = req.params;

    const [amortRows] = await pool.query('SELECT * FROM amortizaciones WHERE id = ? AND prestamo_id = ?', [amortizacionId, id]);
    if (amortRows.length === 0) {
      return res.status(404).send('Amortización no encontrada.');
    }
    const amort = amortRows[0];

    const [prestRows] = await pool.query(`
      SELECT p.*,
             c.nombre AS cliente_nombre, c.dni AS cliente_dni, c.telefono AS cliente_telefono,
             i.nombre AS inversor_nombre, i.telefono AS inversor_telefono, i.dni AS inversor_dni
      FROM prestamos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      WHERE p.id = ?
    `, [id]);

    if (prestRows.length === 0) {
      return res.status(404).send('Préstamo no encontrado.');
    }
    const prestamo = prestRows[0];

    let cronograma = [];
    if (amort.cronograma_snapshot) {
      try {
        cronograma = JSON.parse(amort.cronograma_snapshot);
      } catch (e) {
        cronograma = [];
      }
    }
    if (!cronograma || cronograma.length === 0) {
      const [cuotasDb] = await pool.query('SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC', [id]);
      cronograma = cuotasDb;
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-disposition', `attachment; filename="amortizacion_${amort.id}_prestamo_${id}.pdf"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    const mon = prestamo.moneda || '$';
    const fmt = (n) => mon + '\u00A0' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPdfDate = (d) => {
      if (!d) return '—';
      const dt = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const yyyy = dt.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const colorNavy = '#0B162C';
    const colorGold = '#D4A843';
    const colorText = '#334155';
    const colorMuted = '#94A3B8';
    const colorBgRow = '#F8FAFC';
    const colorSuccess = '#16A34A';

    const drawWatermark = () => {
      doc.save();
      doc.opacity(0.04);
      const wmSize = 350;
      doc.image(path.join(__dirname, '../public/img/logo_icon.png'), (doc.page.width - wmSize) / 2, (doc.page.height - wmSize) / 2, { width: wmSize });
      doc.restore();
    };

    doc.on('pageAdded', drawWatermark);
    drawWatermark();

    // Header Logo
    doc.image(path.join(__dirname, '../public/img/logo_horizontal.png'), 50, 40, { height: 38 });

    // Folio & Fecha Header
    doc.fillColor(colorNavy).fontSize(9).font('Helvetica-Bold')
      .text(`CONSTANCIA OFICIAL: #AMORT-${String(amort.id).padStart(5, '0')}`, 50, 44, { align: 'right', width: 495 });
    doc.fillColor(colorMuted).fontSize(8.5).font('Helvetica')
      .text('Fecha Emisión: ' + fmtPdfDate(amort.fecha || amort.created_at), 50, 58, { align: 'right', width: 495 });

    doc.text('', 50, 95);

    // Titulo Principal
    doc.fillColor(colorNavy).fontSize(16).font('Helvetica-Bold')
      .text('Constancia de Amortización Extraordinaria de Capital', { align: 'center' });
    doc.fillColor(colorGold).fontSize(10).font('Helvetica-Bold')
      .text('NUEVO CRONOGRAMA OFICIAL DE PAGOS', { align: 'center' });

    doc.moveDown(1.2);

    const drawRow = (label, value, isHighlight = false) => {
      const currentY = doc.y;
      doc.fillColor(isHighlight ? colorNavy : colorMuted).font('Helvetica-Bold').fontSize(9).text(label, 50, currentY, { width: 190 });
      doc.fillColor(isHighlight ? colorNavy : colorText).font(isHighlight ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(value, 240, currentY, { align: 'right', width: 305 });
      doc.moveDown(0.35);
      doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.4);
    };

    // Sección Información General
    doc.fillColor(colorNavy).fontSize(11).font('Helvetica-Bold').text('INFORMACIÓN DE LA OPERACIÓN', { underline: false });
    doc.moveDown(0.6);

    drawRow('PRÉSTAMO N°:', `#${prestamo.id}`, true);
    drawRow('CLIENTE:', prestamo.cliente_nombre ? `${prestamo.cliente_nombre} (DNI: ${prestamo.cliente_dni || '—'})` : 'N/A');
    drawRow('INVERSIONISTA:', prestamo.inversor_nombre || 'N/A');
    drawRow('ASESOR:', (req.session && req.session.name) ? req.session.name : 'N/A');
    drawRow('TASA DE INTERÉS:', `${prestamo.interes}% anual`);
    drawRow('FRECUENCIA DE PAGO:', (prestamo.tipo_pago || 'mensual').toUpperCase());

    doc.moveDown(0.8);

    // Tarjeta Detalle de Amortización
    const boxY = doc.y;
    doc.rect(50, boxY, 495, 82).fillAndStroke('#0B162C', '#0B162C');

    doc.fillColor('#D4A843').fontSize(9.5).font('Helvetica-Bold')
      .text('DETALLE DEL ABONO EXTRAORDINARIO A CAPITAL APLICADO', 65, boxY + 10);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Monto Amortizado:', 65, boxY + 28);
    doc.fillColor('#10B981').fontSize(13).font('Helvetica-Bold')
      .text(fmt(amort.monto), 65, boxY + 40);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Modalidad Aplicada:', 225, boxY + 28);
    doc.fillColor('#FFFFFF').fontSize(10.5).font('Helvetica-Bold')
      .text(amort.tipo_reduccion === 'cuota' ? 'Reducción de Cuota' : 'Reducción de Plazo', 225, boxY + 42);

    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
      .text('Saldo Capital Posterior:', 385, boxY + 28);
    doc.fillColor('#D4A843').fontSize(13).font('Helvetica-Bold')
      .text(fmt(amort.saldo_nuevo), 385, boxY + 40);

    let impactText = '';
    if (amort.tipo_reduccion === 'cuota') {
      impactText = `Impacto: Cuota reducida de ${fmt(amort.cuota_anterior)} a ${fmt(amort.cuota_nueva)} mensuales · Manteniendo ${amort.cuotas_restantes_nueva} cuotas`;
    } else {
      const cuotasMenos = Number(amort.cuotas_restantes_anterior || 0) - Number(amort.cuotas_restantes_nueva || 0);
      impactText = `Impacto: Plazo reducido en ${cuotasMenos} cuota(s) · Restan ${amort.cuotas_restantes_nueva} cuotas pendientes · Cuota: ${fmt(amort.cuota_anterior)}`;
    }
    if (amort.observacion) {
      impactText += ` · Obs: ${amort.observacion}`;
    }

    doc.fillColor('#E2E8F0').fontSize(8.5).font('Helvetica-Bold')
      .text(impactText, 65, boxY + 63, { width: 465 });

    doc.y = boxY + 98;

    // Tabla del Cronograma
    doc.fillColor(colorNavy).fontSize(11).font('Helvetica-Bold')
      .text('CRONOGRAMA DE PAGOS RESULTANTE', { underline: false });
    doc.moveDown(0.6);

    const colX = [50, 75, 140, 208, 273, 333, 400, 472];
    const colWidths = [25, 65, 68, 65, 60, 67, 72, 73];

    const drawTableHeader = () => {
      let headerY = doc.y;
      doc.rect(50, headerY - 2, 495, 18).fill('#0B162C');
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      doc.text('N°', colX[0], headerY + 3, { width: colWidths[0], align: 'center' });
      doc.text('Vencimiento', colX[1], headerY + 3, { width: colWidths[1], align: 'center' });
      doc.text('Saldo In.', colX[2], headerY + 3, { width: colWidths[2], align: 'right' });
      doc.text('Capital', colX[3], headerY + 3, { width: colWidths[3], align: 'right' });
      doc.text('Interés', colX[4], headerY + 3, { width: colWidths[4], align: 'right' });
      doc.text('Cuota', colX[5], headerY + 3, { width: colWidths[5], align: 'right' });
      doc.text('Saldo Fin.', colX[6], headerY + 3, { width: colWidths[6], align: 'right' });
      doc.text('Estado', colX[7], headerY + 3, { width: colWidths[7], align: 'center' });

      doc.y = headerY + 22;
    };

    drawTableHeader();

    let count = 0;
    cronograma.forEach(row => {
      if (doc.y > 730) {
        doc.addPage();
        drawTableHeader();
      }

      let rowY = doc.y;
      if (count % 2 !== 0) {
        doc.rect(50, rowY - 2, 495, 16).fill(colorBgRow);
      }

      const saldoIn = row.saldoInicial !== undefined ? Number(row.saldoInicial) : (Number(row.saldo || 0) + Number(row.capital || 0));
      const isPagada = row.estado === 'pagada' || row.estado === 'Pagada';

      doc.fillColor(isPagada ? colorMuted : colorNavy).font(isPagada ? 'Helvetica' : 'Helvetica-Bold').fontSize(7.8);
      doc.text(String(row.numero_cuota || row.num), colX[0], rowY, { width: colWidths[0], align: 'center' });
      doc.text(fmtPdfDate(row.fecha_vencimiento || row.fechaVencimiento), colX[1], rowY, { width: colWidths[1], align: 'center' });
      doc.text(fmt(saldoIn), colX[2], rowY, { width: colWidths[2], align: 'right' });
      doc.text(fmt(row.capital), colX[3], rowY, { width: colWidths[3], align: 'right' });
      doc.text(fmt(row.interes), colX[4], rowY, { width: colWidths[4], align: 'right' });
      doc.text(fmt(row.monto_cuota || row.cuota), colX[5], rowY, { width: colWidths[5], align: 'right' });
      doc.text(fmt(row.saldo), colX[6], rowY, { width: colWidths[6], align: 'right' });

      if (isPagada) {
        doc.fillColor(colorSuccess).font('Helvetica-Bold').text('PAGADA', colX[7], rowY, { width: colWidths[7], align: 'center' });
      } else {
        doc.fillColor('#F59E0B').font('Helvetica').text('PENDIENTE', colX[7], rowY, { width: colWidths[7], align: 'center' });
      }

      doc.moveDown(0.7);
      count++;
    });

    // Disclaimer
    doc.moveDown(1.5);
    if (doc.y > 730) doc.addPage();
    doc.fillColor(colorMuted).fontSize(8).font('Helvetica-Oblique')
      .text('Este documento certifica la correcta aplicación del abono a capital y el recálculo oficial de las cuotas del cronograma de pagos.', { align: 'center', width: 495 });

    doc.end();

  } catch (error) {
    console.error('Error generando comprobante PDF de amortización:', error);
    if (!res.headersSent) {
      res.status(500).send('Error al generar el comprobante PDF: ' + error.message);
    }
  }
};



require('dotenv').config();
const pool = require('../config/db');

async function test() {
  try {
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
        p.monto AS prestamo_monto,
        p.interes AS prestamo_interes,
        p.tipo_pago,
        p.plazo_meses,
        (SELECT COUNT(*) FROM cuotas c2 WHERE c2.prestamo_id = p.id) AS total_cuotas
      FROM cuotas cu
      JOIN prestamos p ON cu.prestamo_id = p.id
      JOIN clientes c ON p.cliente_id = c.id
      LEFT JOIN inversionistas i ON p.inversor_id = i.id
      ORDER BY cu.fecha_vencimiento ASC
      LIMIT 2
    `);
    console.log('Test success, sample row:', cuotas[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error executing query:', err);
    process.exit(1);
  }
}

test();

require('dotenv').config();
const pool = require('../config/db');

async function run() {
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM amortizaciones LIKE 'cronograma_snapshot'");
    if (cols.length === 0) {
      await pool.query("ALTER TABLE amortizaciones ADD COLUMN cronograma_snapshot LONGTEXT NULL AFTER observacion");
      console.log('Column cronograma_snapshot added successfully');
    } else {
      console.log('Column cronograma_snapshot already exists');
    }

    // Backfill loan 27's existing amortizacion if snapshot is null
    const [amortRows] = await pool.query("SELECT id, prestamo_id, cronograma_snapshot FROM amortizaciones WHERE cronograma_snapshot IS NULL");
    for (const a of amortRows) {
      const [cuotas] = await pool.query("SELECT * FROM cuotas WHERE prestamo_id = ? ORDER BY numero_cuota ASC", [a.prestamo_id]);
      if (cuotas.length > 0) {
        await pool.query("UPDATE amortizaciones SET cronograma_snapshot = ? WHERE id = ?", [JSON.stringify(cuotas), a.id]);
        console.log(`Backfilled snapshot for amortizacion id ${a.id}`);
      }
    }

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

run();

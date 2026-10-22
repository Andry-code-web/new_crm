require('dotenv').config();
const pool = require('../config/db');

async function run() {
  try {
    const [res] = await pool.query("ALTER TABLE prestamos MODIFY COLUMN tipo_pago ENUM('diario','semanal','quincenal','mensual') NOT NULL DEFAULT 'mensual'");
    console.log('ALTER TABLE SUCCESS:', res);
    process.exit(0);
  } catch (err) {
    console.error('ALTER TABLE ERROR:', err);
    process.exit(1);
  }
}

run();

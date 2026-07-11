require('dotenv').config();
const pool = require('../config/db');

async function run() {
  try {
    // Verificar si la columna ya existe para evitar errores
    const [columns] = await pool.query("SHOW COLUMNS FROM prestamos LIKE 'moneda'");
    if (columns.length === 0) {
      await pool.query("ALTER TABLE prestamos ADD COLUMN moneda VARCHAR(5) NOT NULL DEFAULT '$'");
      console.log("Columna 'moneda' agregada con éxito a la tabla 'prestamos'.");
    } else {
      console.log("La columna 'moneda' ya existe en 'prestamos'.");
    }
  } catch (error) {
    console.error("Error al alterar la tabla prestamos:", error);
  } finally {
    process.exit(0);
  }
}
run();

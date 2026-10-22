const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

try {
  const filePath = path.join(__dirname, '../views/calendario.ejs');
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Test compiling EJS template
  const fn = ejs.compile(content, { filename: filePath });
  console.log('EJS template compiled successfully without syntax errors!');

  // Test rendering with sample data
  const output = fn({
    user: { name: 'Mauricio', role: 'admin', avatar: 'https://i.pravatar.cc/150' },
    cuotasJson: JSON.stringify([
      {
        id: 1,
        prestamo_id: 12,
        numero_cuota: 2,
        total_cuotas: 24,
        fecha_vencimiento: '2026-10-03',
        monto_cuota: 280,
        capital: 200,
        interes: 80,
        saldo: 3200,
        estado: 'proximo',
        cliente_nombre: 'María López',
        inversor_nombre: 'Inversiones Los Andes'
      }
    ]),
    success: null,
    error: null
  });

  console.log('Template rendered successfully! Output length:', output.length);
  process.exit(0);
} catch (err) {
  console.error('Error rendering template:', err);
  process.exit(1);
}

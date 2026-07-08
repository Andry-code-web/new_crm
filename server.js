require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const expressLayouts = require('express-ejs-layouts');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const asesorRoutes = require('./routes/asesor');
const clienteRoutes = require('./routes/cliente');
const inversionistaRoutes = require('./routes/inversionista');

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================
// Configuración de sesiones
// =============================
app.set('trust proxy', 1);

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  }
});

// =============================
// Configuración EJS
// =============================
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// =============================
// Middleware
// =============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =============================
// Sesiones
// =============================
app.use(session({
  key: 'session_id',
  secret: process.env.SESSION_SECRET || 'coinest_super_secret_key_2026',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// =============================
// Rutas
// =============================
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/asesor', asesorRoutes);
app.use('/cliente', clienteRoutes);
app.use('/inversionista', inversionistaRoutes);

// =============================
// Ruta principal
// =============================
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }

  res.redirect('/login');
});

// =============================
// Prueba de conexión a la BD
// =============================
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Database connected successfully');
    conn.release();
  } catch (err) {
    console.error('❌ Database connection error:', err);
  }
})();

// =============================
// Iniciar servidor
// =============================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
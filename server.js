require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const asesorRoutes = require('./routes/asesor');
const clienteRoutes = require('./routes/cliente');
const inversionistaRoutes = require('./routes/inversionista');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as templating engine
app.use(expressLayouts);
app.set('layout', 'layout'); // default layout
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'coinest_super_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  }
}));

// Routes
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/asesor', asesorRoutes);
app.use('/cliente', clienteRoutes);
app.use('/inversionista', inversionistaRoutes);

// Catch-all route to redirect to dashboard or login
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

//test de coneccion de base de datos
const pool = require('./config/db');

pool.getConnection()
  .then(conn => {
    console.log('Database connected successfully');
    conn.release();
  })
  .catch(err => console.error('Database connection error:', err));

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

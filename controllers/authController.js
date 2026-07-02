const pool = require('../config/db');

exports.renderLogin = (req, res) => {
  res.render('login', { error: null });
};

exports.handleLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length > 0) {
      const user = rows[0];
      let match = false;
      try {
        const bcrypt = require('bcrypt');
        match = await bcrypt.compare(password, user.password);
      } catch {
        match = password === user.password;
      }

      if (match) {
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.role = user.role || 'cliente';
        return res.redirect(`/dashboard/${req.session.role}`);
      }
    }
    return res.render('login', { error: 'Correo o contraseña incorrecta' });
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'Ocurrió un error durante el inicio de sesión.' });
  }
};

exports.handleLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login');
  });
};

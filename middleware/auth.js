module.exports = {
  ensureAuthenticated: (req, res, next) => {
    if (req.session.userId) {
      return next();
    }
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
  },

  forwardAuthenticated: (req, res, next) => {
    if (!req.session.userId) {
      return next();
    }
    const role = req.session.role || 'cliente';
    res.redirect(`/dashboard/${role}`);
  },

  ensureRole: (roles) => {
    return (req, res, next) => {
      if (!req.session.userId) {
        return res.redirect('/login');
      }

      const userRole = req.session.role;
      if (roles.includes(userRole)) {
        return next();
      }

      res.redirect(`/dashboard/${userRole || 'cliente'}`);
    };
  }
};

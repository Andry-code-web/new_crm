exports.getCommonData = (req) => ({
  user: {
    name: req.session.userEmail ? req.session.userEmail.split('@')[0] : 'Usuario',
    email: req.session.userEmail || '',
    avatar: 'https://i.pravatar.cc/150?u=' + req.session.userId,
    role: req.session.role
  }
});

exports.getFlash = (req) => ({
  success: req.query.success || null,
  error: req.query.error || null
});

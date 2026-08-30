// Shared by every admin-gated endpoint (api/admin/dashboard.js, api/agents/console-chat.js).
// TODO: Replace with proper session-based auth before production (see admin/index.html).
function isAdminAuthenticated(req) {
  const token = req.headers['x-admin-token']
  return !!token && token === process.env.ADMIN_SECRET
}

module.exports = { isAdminAuthenticated }

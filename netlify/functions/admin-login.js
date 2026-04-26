const crypto = require('crypto');

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function getSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.APPS_SCRIPT_ADMIN_KEY || process.env.VITE_ADMIN_KEY || 'local-dev-secret';
}

function sign(exp) {
  return crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

    const body = JSON.parse(event.body || '{}');
    const expectedPassword = process.env.STAFF_PASSWORD || process.env.VITE_ADMIN_PASSWORD || 'poolstaff';
    if (String(body.password || '') !== expectedPassword) {
      return json(401, { ok: false, error: 'Incorrect password.' });
    }

    const exp = Date.now() + TOKEN_TTL_MS;
    return json(200, { ok: true, token: `${exp}.${sign(exp)}` });
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Login failed.' });
  }
};

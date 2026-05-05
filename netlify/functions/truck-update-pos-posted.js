const crypto = require('crypto');

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

function verifyToken(authHeader) {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '');
  const [exp, signature] = token.split('.');
  if (!exp || !signature || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getAuthHeader(headers = {}) {
  return headers.authorization || headers.Authorization || headers.AUTHORIZATION || '';
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
    if (!verifyToken(getAuthHeader(event.headers))) {
      return json(401, { ok: false, error: 'Truck staff session expired. Please sign in again.' });
    }

    const body = JSON.parse(event.body || '{}');
    if (!body.orderId || typeof body.posted !== 'boolean') {
      return json(400, { ok: false, error: 'Invalid POS reconciliation update.' });
    }

    const scriptUrl = process.env.VITE_SCRIPT_URL;
    const adminKey = process.env.APPS_SCRIPT_ADMIN_KEY || process.env.VITE_ADMIN_KEY;
    if (!scriptUrl || !adminKey) throw new Error('Missing Netlify admin environment variables.');

    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateTruckPosPosted',
        adminKey,
        orderId: body.orderId,
        posted: body.posted,
        postedBy: body.postedBy || 'Truck Staff'
      })
    });
    const data = await response.json();
    return json(response.ok && data.ok ? 200 : 502, data);
  } catch (err) {
    return json(500, { ok: false, error: err.message || 'Unable to update truck POS reconciliation.' });
  }
};

'use strict';
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { META_PIXEL_ID, META_CAPI_TOKEN, META_TEST_CODE, SITE_ORIGIN } = process.env;
  const version = process.env.META_GRAPH_VERSION || 'v25.0';
  if (META_PIXEL_ID !== '1114550287797449' || !META_CAPI_TOKEN || !SITE_ORIGIN || !/^v\d+\.0$/.test(version)) {
    return res.status(503).json({ error: 'Tracking configuration unavailable' });
  }
  let origin;
  try { origin = new URL(SITE_ORIGIN).origin; } catch { return res.status(503).json({ error: 'Tracking configuration unavailable' }); }
  if (req.headers.origin !== origin) return res.status(403).json({ error: 'Origin not allowed' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'JSON required' });
  let body;
  try {
    if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) > 8192) return res.status(413).json({ error: 'Payload too large' });
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid event' });
  const { event_id, phone, value, url, fbp, fbc } = body;
  if (typeof event_id !== 'string' || !/^purchase_[0-9a-f-]{36}$/.test(event_id) || typeof phone !== 'string' || !/^\+973\d{8}$/.test(phone) || ![14,22,33].includes(value)) return res.status(400).json({ error: 'Invalid event' });
  let source;
  try { source = new URL(url); if (source.origin !== origin) throw new Error(); } catch { return res.status(400).json({ error: 'Invalid source' }); }
  // Drop query parameters and fragments so customer data in URLs is never forwarded.
  const user_data = { ph: [hash(phone.replace(/\D/g, ''))], country: [hash('bh')] };
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string') user_data.client_user_agent = ua.slice(0, 1024);
  // Vercel overwrites this platform header; do not trust client-supplied body IPs.
  const ip = req.headers['x-vercel-forwarded-for'];
  if (typeof ip === 'string') user_data.client_ip_address = ip.split(',')[0].trim();
  for (const [key, cookie] of Object.entries({ fbp, fbc })) {
    if (typeof cookie === 'string' && /^fb\.\d+\.\d+\.[A-Za-z0-9_.-]+$/.test(cookie) && cookie.length <= 512) user_data[key] = cookie;
  }
  const payload = { data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now()/1000), event_id,
    action_source: 'website', event_source_url: source.origin + source.pathname, user_data,
    custom_data: { value, currency: 'BHD', content_name: 'JoyPretty Vitamin C Eye Serum' } }] };
  if (META_TEST_CODE) payload.test_event_code = META_TEST_CODE;
  try {
    const upstream = await fetch(`https://graph.facebook.com/${version}/${META_PIXEL_ID}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${META_CAPI_TOKEN}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
    });
    const result = await upstream.json();
    if (!upstream.ok || result.events_received !== 1) return res.status(502).json({ error: 'Tracking delivery failed' });
    return res.status(200).json({ ok: true, event_id });
  } catch { return res.status(502).json({ error: 'Tracking delivery failed' }); }
};

const crypto = require('crypto');
const sha = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const PIXEL = process.env.META_PIXEL_ID || '1114550287797449';
  const TOKEN = process.env.META_CAPI_TOKEN;
  if (!TOKEN) return res.status(500).json({ ok: false, error: 'META_CAPI_TOKEN is missing' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const phone = String(b.phone || '').replace(/\D/g, '');
  if (!b.event_id || phone.length < 8) return res.status(400).json({ ok: false });

  const first = String(b.name || '').trim().split(/\s+/)[0];
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();

  const user = {
    ph: [sha(phone)],
    country: [sha('bh')],
    client_user_agent: req.headers['user-agent'] || ''
  };
  if (first) user.fn = [sha(first)];
  if (ip) user.client_ip_address = ip;
  if (b.fbp) user.fbp = b.fbp;
  if (b.fbc) user.fbc = b.fbc;

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: String(b.event_id),
      event_source_url: b.url,
      action_source: 'website',
      user_data: user,
      custom_data: {
        value: Number(b.value) || 0,
        currency: 'BHD',
        content_name: 'JoyPretty Vitamin C Eye Serum - ' + (b.offer || '')
      }
    }]
  };
  if (process.env.META_TEST_CODE) payload.test_event_code = process.env.META_TEST_CODE;

  const ver = process.env.META_API_VERSION || 'v23.0';
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${PIXEL}/events?access_token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, meta: j });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};

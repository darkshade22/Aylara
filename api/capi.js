const crypto = require('crypto');
// Meta reporting only: checkout and order storage remain in BHD.
// Reference peg: 1 USD = 0.376 BHD. Keep the browser and API calculation identical.
function metaPurchaseValue(valueBHD){return Math.round((Number(valueBHD)/0.376)*100)/100}
const sha = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const PIXEL = (process.env.META_PIXEL_ID || '1114550287797449').trim();
  const TEST_CODE = (process.env.META_TEST_CODE || '').trim();
  const TOKEN = process.env.META_CAPI_TOKEN;
  if (!TOKEN) return res.status(500).json({ ok: false, error: 'META_CAPI_TOKEN is missing' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const phone = String(b.phone || '').replace(/\D/g, '');
  if (!b.event_id || phone.length < 8) return res.status(400).json({ ok: false });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();

  const user = {
    ph: [sha(phone)],
    country: [sha('bh')],
    client_user_agent: req.headers['user-agent'] || ''
  };
  if (ip) user.client_ip_address = ip;
  if (b.fbp) user.fbp = b.fbp;
  if (b.fbc) user.fbc = b.fbc;

  // Keep the actual page origin/path; do not forward query strings or fragments.
  let sourceUrl;
  try {
    const source = new URL(b.url);
    if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw new Error();
    sourceUrl = source.origin + source.pathname;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid source URL' });
  }

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: String(b.event_id),
      event_source_url: sourceUrl,
      action_source: 'website',
      user_data: user,
      custom_data: {
        value: metaPurchaseValue(Number(b.value) || 0),
        currency: 'USD'
      }
    }]
  };
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  const ver = (process.env.META_API_VERSION || 'v23.0').trim();
  try {
    const r = await fetch(`https://graph.facebook.com/${ver}/${PIXEL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    const j = await r.json();
    const accepted = r.ok && j.events_received === 1;
    return res.status(accepted ? 200 : 502).json({
      ok: accepted,
      event_id: String(b.event_id),
      pixel_id: PIXEL,
      test_mode: Boolean(TEST_CODE),
      test_event_code: TEST_CODE || null,
      // Return diagnostics without forwarding raw upstream errors or customer data.
      ...(accepted ? { events_received: j.events_received } : {
        error: 'Tracking delivery failed',
        meta_error_code: j.error?.code,
        meta_error_subcode: j.error?.error_subcode
      })
    });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};




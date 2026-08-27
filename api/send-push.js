// Manual test-send endpoint. Client's "Send test notification" button
// posts here with {title, body} and every registered device receives it.

const { sendToAll } = require('./_push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    // Pass through tag/url/actions so the client can send a fully-formed
    // notification (including a proper title) - avoids the SW fallback path.
    const opts = {};
    if (body.tag) opts.tag = body.tag;
    if (body.url) opts.url = body.url;
    if (body.actions) opts.actions = body.actions;
    const result = await sendToAll(body.title || '🏫 ניהול ישיבה', body.body || '', opts);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

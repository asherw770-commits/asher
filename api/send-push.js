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
    const result = await sendToAll(body.title || 'התראה', body.body || '');
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

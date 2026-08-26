// Vercel serverless function: sends a Web Push notification to every device
// subscription registered under /shared/main._pushSubs in Firestore.
//
// Runtime: Node.js (Vercel Hobby plan free tier).
// Deps: `web-push` — installed automatically by Vercel when it builds this
// function (declared in package.json).
//
// Auth: no auth. The Firestore rules for shared/main are already open by
// design (the whole app runs without login), so trusting anyone with the
// endpoint URL to send a push to registered devices matches the same
// threat model. If this is later a problem, add a shared-secret header.

const webpush = require('web-push');

// VAPID keys generated once by hand. Public key is embedded in the client;
// private key stays here. If keys are ever rotated, both places need updating.
const VAPID_PUBLIC = 'BLxDAcMfulTSDwQR8QTlMNKWLSOVF9gKJcl7DtaUQm7Kp7dTS6FAcohZOy-HRveGFZjSHI90lZ3GN_5rUHGlPoM';
const VAPID_PRIVATE = 'sDrMW5eNhil_ZiKWMOl4P4CqUNlU6VPoDV1cl9m021U';
const VAPID_SUBJECT = 'mailto:asher.w770@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Firestore REST (no auth needed since /shared/main is world-readable/writable).
// Using REST rather than firebase-admin so this function has zero extra deps
// beyond web-push and doesn't need a service account credential.
const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

// Firestore Value → plain JS. Only handles the shapes we actually use here.
function fromV(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    for (const k of Object.keys(f)) out[k] = fromV(f[k]);
    return out;
  }
  if ('arrayValue' in v) {
    return ((v.arrayValue && v.arrayValue.values) || []).map(fromV);
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const title = body.title || 'התראה';
    const msgBody = body.body || '';

    const resp = await fetch(FS_BASE + '/shared/main');
    if (!resp.ok) {
      res.status(502).json({ error: 'Firestore fetch failed: ' + resp.status });
      return;
    }
    const doc = await resp.json();
    const fields = doc.fields || {};
    const subsMap = fromV(fields._pushSubs) || {};

    const payload = JSON.stringify({ title, body: msgBody });
    const results = { sent: 0, failed: 0, gone: [] };

    for (const key of Object.keys(subsMap)) {
      const entry = subsMap[key];
      const sub = entry && entry.sub;
      if (!sub || !sub.endpoint) continue;
      try {
        await webpush.sendNotification(sub, payload);
        results.sent++;
      } catch (e) {
        results.failed++;
        // 404/410 means the subscription is dead - the client can prune it
        // on its next enable/disable cycle
        if (e.statusCode === 404 || e.statusCode === 410) results.gone.push(key);
      }
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

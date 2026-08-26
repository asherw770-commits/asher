// Shared push-notification sender. Used by both the manual /api/send-push
// endpoint and the scheduled /api/cron endpoint so notification delivery
// logic lives in exactly one place.

const webpush = require('web-push');

const VAPID_PUBLIC = 'BLxDAcMfulTSDwQR8QTlMNKWLSOVF9gKJcl7DtaUQm7Kp7dTS6FAcohZOy-HRveGFZjSHI90lZ3GN_5rUHGlPoM';
const VAPID_PRIVATE = 'sDrMW5eNhil_ZiKWMOl4P4CqUNlU6VPoDV1cl9m021U';
const VAPID_SUBJECT = 'mailto:asher.w770@gmail.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

// Firestore Value → plain JS. Only handles the shapes actually used here.
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

async function loadDoc() {
  const resp = await fetch(FS_BASE + '/shared/main');
  if (!resp.ok) throw new Error('Firestore load failed: ' + resp.status);
  const doc = await resp.json();
  const out = {};
  const f = doc.fields || {};
  for (const k of Object.keys(f)) out[k] = fromV(f[k]);
  return out;
}

// Send a push notification to every registered device.
// `opts` may include `tag`, `url`, and `actions` (which iOS 16.4+ may or
// may not render as buttons - default action is always "tap to open").
async function sendToAll(title, body, opts) {
  const D = await loadDoc();
  const subs = D._pushSubs || {};
  const payload = JSON.stringify(Object.assign({ title: title, body: body }, opts || {}));
  const result = { sent: 0, failed: 0 };
  for (const key of Object.keys(subs)) {
    const sub = subs[key] && subs[key].sub;
    if (!sub || !sub.endpoint) continue;
    try {
      await webpush.sendNotification(sub, payload);
      result.sent++;
    } catch (e) {
      result.failed++;
    }
  }
  return result;
}

module.exports = { sendToAll, loadDoc };

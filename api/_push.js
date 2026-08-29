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
  const result = { sent: 0, failed: 0, pruned: 0 };
  const deadKeys = [];
  // Per-device dedupe: if two entries share the same deviceId, keep only
  // the newest (latest `at`). Legacy entries without deviceId are treated
  // as unique so we don't accidentally drop them.
  const bestByDevice = {};
  for (const key of Object.keys(subs)) {
    const e = subs[key]; if (!e) continue;
    const did = e.deviceId || ('_legacy:' + key);
    const at = e.at || 0;
    if (!bestByDevice[did] || bestByDevice[did].at < at) bestByDevice[did] = { key, at };
  }
  const allowedKeys = new Set(Object.values(bestByDevice).map(x => x.key));
  for (const key of Object.keys(subs)) {
    if (!allowedKeys.has(key)) { deadKeys.push(key); continue; }
    const sub = subs[key] && subs[key].sub;
    if (!sub || !sub.endpoint) { deadKeys.push(key); continue; }
    try {
      // TTL=86400 (24h): if the device is offline/asleep, Apple's push server
      // will retry delivery for a day instead of dropping after the default
      // 4h. urgency='high' bypasses iOS's "save battery, delay push" mode so
      // the reminder wakes the phone instantly even from a locked/idle state.
      // These headers are what makes a closed PWA actually receive the push.
      await webpush.sendNotification(sub, payload, {
        TTL: 86400,
        urgency: 'high',
        topic: (opts && opts.tag ? String(opts.tag).slice(0, 32).replace(/[^A-Za-z0-9]/g, '') : undefined)
      });
      result.sent++;
    } catch (e) {
      result.failed++;
      // 404 (subscription not found) and 410 (Gone) mean the browser/OS has
      // permanently revoked this subscription. Keeping it around wastes a
      // send attempt on every notification and can slow down the whole
      // dispatch, so prune it from Firestore.
      const code = e && (e.statusCode || e.status);
      if (code === 404 || code === 410) deadKeys.push(key);
    }
  }
  if (deadKeys.length) {
    result.pruned = await pruneSubs(deadKeys);
  }
  return result;
}

// Remove a set of push subscription entries from shared/main._pushSubs.
// Uses Firestore REST PATCH with fieldPaths mask targeting only the doomed
// keys so unrelated concurrent updates aren't clobbered.
async function pruneSubs(keys) {
  if (!keys || !keys.length) return 0;
  const paths = keys.map(k => '_pushSubs.`' + k.replace(/`/g, '\\`') + '`');
  const params = paths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
  const url = FS_BASE + '/shared/main?' + params;
  const fields = {};
  // Firestore delete-a-field: PATCH with the mask but no value in fields.
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields })
  });
  return resp.ok ? keys.length : 0;
}

module.exports = { sendToAll, loadDoc };

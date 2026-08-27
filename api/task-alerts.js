// Server-side task alert dispatcher. Runs on cron (every 10 minutes on
// Vercel) so task reminders fire even when no phone/browser is open.
//
// Client-side checkTaskAlerts() only fires when a device is actively
// running the app - phones lock, browsers close, PWAs go to sleep. Push
// notifications for time-based reminders MUST be fired from a server
// timer to be reliable.

const { sendToAll } = require('./_push');

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

// Firestore Value → plain JS
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

// Plain JS → Firestore Value
function toV(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toV) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toV(v[k]);
    return { mapValue: { fields: fields } };
  }
  return { nullValue: null };
}

async function loadTasks() {
  const resp = await fetch(FS_BASE + '/shared/main?mask.fieldPaths=tk&mask.fieldPaths=_notifiedTasks');
  if (!resp.ok) throw new Error('load failed: ' + resp.status);
  const doc = await resp.json();
  const f = doc.fields || {};
  return { tk: fromV(f.tk) || [], notified: fromV(f._notifiedTasks) || {} };
}

async function writeNotified(notified) {
  const url = FS_BASE + '/shared/main?updateMask.fieldPaths=_notifiedTasks';
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _notifiedTasks: toV(notified) } })
  });
  if (!resp.ok) throw new Error('write notified failed: ' + resp.status);
}

module.exports = async (req, res) => {
  try {
    const { tk, notified } = await loadTasks();
    const now = Date.now();
    // Fire for tasks whose alertAt is in the last 2 minutes and not yet
    // notified. Tight window keeps the alert at the exact minute the user
    // asked for (cron now runs every minute).
    const windowMs = 2 * 60 * 1000;
    const fired = [];
    for (const t of tk) {
      if (!t || t.dn || !t.alertAt) continue;
      if (notified[t.id]) continue;
      const at = new Date(t.alertAt).getTime();
      if (isNaN(at)) continue;
      const delta = now - at;
      if (delta < 0 || delta > windowMs) continue;
      // fire — put the task content as the title (iOS shows it in bold) so
      // the notification READS AS the reminder itself, not "reminder from
      // <app>: <content>". Body deliberately empty for clean single-line UX.
      const title = t.tx ? ('🔔 ' + t.tx) : '🔔 תזכורת';
      const body = t.ps ? ('👤 ' + t.ps) : '';
      try {
        await sendToAll(title, body, { tag: 'task-' + t.id, url: '/?page=tasks' });
        notified[t.id] = new Date().toISOString();
        fired.push({ id: t.id, tx: t.tx });
      } catch (e) {
        console.error('sendToAll failed for task', t.id, e);
      }
    }

    // Also prune notified entries for tasks that no longer exist or whose
    // alertAt is over 24h old, so _notifiedTasks doesn't accumulate forever.
    const cutoff = now - 24 * 60 * 60 * 1000;
    const liveIds = new Set(tk.filter(t => t && t.id).map(t => t.id));
    let pruned = 0;
    for (const id of Object.keys(notified)) {
      const notifiedAt = new Date(notified[id]).getTime();
      if (!liveIds.has(id) || (isFinite(notifiedAt) && notifiedAt < cutoff)) {
        delete notified[id];
        pruned++;
      }
    }

    if (fired.length || pruned) await writeNotified(notified);

    res.status(200).json({ ok: true, fired: fired.length, pruned, tasks: fired });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

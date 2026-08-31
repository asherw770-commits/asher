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
  const resp = await fetch(FS_BASE + '/shared/main');
  if (!resp.ok) throw new Error('load failed: ' + resp.status);
  const doc = await resp.json();
  const f = doc.fields || {};
  return {
    tk: fromV(f.tk) || [],
    cs: fromV(f.cs) || [],
    cx: fromV(f.cx) || [],
    notified: fromV(f._notifiedTasks) || {},
    convNotified: fromV(f._convNotified) || {}
  };
}
async function writeConvNotified(convNotified) {
  const url = FS_BASE + '/shared/main?updateMask.fieldPaths=_convNotified';
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { _convNotified: toV(convNotified) } })
  });
  if (!resp.ok) throw new Error('write convNotified failed: ' + resp.status);
}
// Compute today's conversation slots (1st/2nd/3rd boys on the queue) using
// the same sort the client uses: urgent > callback-due > oldest-conversation
// first. Returns array of 3 boy names.
function computeConvSlots(cs, cx) {
  function lastSess(id) {
    let latest = null;
    for (const s of cx) if (s.si === id) {
      if (!latest || s.dt > latest.dt) latest = s;
    }
    return latest;
  }
  const today = new Date().toISOString().slice(0, 10);
  const talkedToday = new Set();
  for (const s of cx) if (s.dt === today) talkedToday.add(s.si);
  const ord = cs.slice()
    .filter(s => !talkedToday.has(s.id))
    .sort((a, b) => {
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
      const ac = a.cb && a.cb <= today, bc = b.cb && b.cb <= today;
      if (ac && !bc) return -1;
      if (!ac && bc) return 1;
      const la = lastSess(a.id), lb = lastSess(b.id);
      const da = la ? la.dt : '0', db = lb ? lb.dt : '0';
      if (da !== db) return da < db ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  return [ord[0], ord[1], ord[2]].map(s => s ? { id: s.id, name: s.name } : null);
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
    const { tk, cs, cx, notified, convNotified } = await loadTasks();
    const now = Date.now();
    // ─── Conversation-slot alerts ────────────────────────────────────────
    // 6 time windows per day (IL time). Each fires once per day thanks to
    // _convNotified[YYYY-MM-DD_slot] flag. cron-job.org runs this endpoint
    // every minute so we just check whether the current IL minute matches.
    const nowIL = new Date(now + 3 * 3600 * 1000); // approx IL summer (+3)
    const hh = nowIL.getUTCHours();
    const mm = nowIL.getUTCMinutes();
    const dateKey = nowIL.getUTCFullYear() + '-' + String(nowIL.getUTCMonth() + 1).padStart(2, '0') + '-' + String(nowIL.getUTCDate()).padStart(2, '0');
    const convSlots = computeConvSlots(cs, cx);
    // Reveal notifications: title generic, body prompts to open the app
    // (SW opens /?cvreveal=<slot> which the client renders as a big card).
    const revealHits = [
      { h: 15, m: 30, slot: 0 },
      { h: 19, m: 10, slot: 1 },
      { h: 21, m: 45, slot: 2 }
    ];
    for (const r of revealHits) {
      if (hh === r.h && mm === r.m) {
        const key = dateKey + '_reveal_' + r.slot;
        if (convNotified[key]) continue;
        if (!convSlots[r.slot]) continue;
        try {
          await sendToAll('🎯 שיבוץ שיחה', 'לחץ לגילוי שם הבחור לשיחה', {
            tag: 'conv-reveal-' + r.slot,
            url: '/?cvreveal=' + r.slot
          });
          convNotified[key] = new Date().toISOString();
        } catch (e) { console.error('reveal push failed', e); }
      }
    }
    // Prep notifications (5 min before each conversation time): put the
    // boy's name up front so the user knows who to prep and taps through
    // to that boy's conversation history page.
    const prepHits = [
      { h: 17, m: 55, slot: 0, session: '18:00' },
      { h: 19, m: 25, slot: 1, session: '19:30' },
      { h: 22, m: 25, slot: 2, session: '22:30' }
    ];
    for (const p of prepHits) {
      if (hh === p.h && mm === p.m) {
        const key = dateKey + '_prep_' + p.slot;
        if (convNotified[key]) continue;
        const boy = convSlots[p.slot];
        if (!boy) continue;
        try {
          await sendToAll(
            '⏰ 5 דק׳ לשיחה — ' + boy.name,
            'הכן שיחה של ' + p.session + ' · לחץ לפתיחת ההיסטוריה',
            {
              tag: 'conv-prep-' + p.slot,
              url: '/?cvprep=' + encodeURIComponent(boy.id)
            }
          );
          convNotified[key] = new Date().toISOString();
        } catch (e) { console.error('prep push failed', e); }
      }
    }
    // Prune conv-notified entries from previous days (keep only today's)
    let convPruned = 0;
    for (const k of Object.keys(convNotified)) {
      if (!k.startsWith(dateKey + '_')) {
        delete convNotified[k];
        convPruned++;
      }
    }
    try { await writeConvNotified(convNotified); } catch (e) { console.error('write convNotified failed', e); }
    // ─── /Conversation-slot alerts ───────────────────────────────────────
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

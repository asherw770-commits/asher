// Server-side dispatcher for ALL time-based notifications. cron-job.org
// hits this endpoint every minute; we compute current Asia/Jerusalem
// wall-clock and fire whichever notification's time matches.
//
// Everything the user can retime lives under D._notifSchedule (edited
// from Settings → 🔔 התראות → ⏱ שעות התראות). Snooze mechanics stay in
// the endpoint since they need per-day state (_snoozeEvening flag).

const { sendToAll } = require('./_push');

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

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

async function loadDoc() {
  const resp = await fetch(FS_BASE + '/shared/main');
  if (!resp.ok) throw new Error('load failed: ' + resp.status);
  const doc = await resp.json();
  const f = doc.fields || {};
  return {
    tk: fromV(f.tk) || [],
    cs: fromV(f.cs) || [],
    cx: fromV(f.cx) || [],
    notified: fromV(f._notifiedTasks) || {},
    convNotified: fromV(f._convNotified) || {},
    dailyNotified: fromV(f._dailyNotified) || {},
    inactive: fromV(f._inactiveBoys) || {},
    schedule: fromV(f._notifSchedule) || {},
    snoozeEve: !!fromV(f._snoozeEvening),
    pushSubs: fromV(f._pushSubs) || {}
  };
}
async function writeField(name, value) {
  const url = FS_BASE + '/shared/main?updateMask.fieldPaths=' + encodeURIComponent(name);
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [name]: toV(value) } })
  });
  if (!resp.ok) throw new Error('write ' + name + ' failed: ' + resp.status);
}

function computeConvSlots(cs, cx, inactiveMap) {
  inactiveMap = inactiveMap || {};
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
    .filter(s => !inactiveMap[s.name])
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

// DST-safe IL time via Intl — same trick /api/cron uses. Returns
// { hh, mm, weekday, dateKey } — weekday is short English (Sun/Mon/...).
function nowInIL() {
  const now = new Date();
  const hh = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(now), 10);
  const mm = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', minute: '2-digit' }).format(now), 10);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(now);
  // Reconstruct IL date components
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const mo = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return { hh, mm, weekday, dateKey: y + '-' + mo + '-' + d };
}
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : null;
}

module.exports = async (req, res) => {
  try {
    const doc = await loadDoc();
    const { tk, cs, cx, notified, convNotified, dailyNotified, inactive, schedule, snoozeEve } = doc;
    const DEFAULT_SCHED = {
      conv1: '15:30', conv2: '19:10', conv3: '21:45',
      prep1: '17:55', prep2: '19:25', prep3: '22:25',
      phAfternoon: '15:13',
      phEvening: '21:48',
      printWeek: '20:00',
      printSat: '21:00'
    };
    const sched = Object.assign({}, DEFAULT_SCHED, schedule || {});
    const now = Date.now();
    const il = nowInIL();
    const { hh, mm, weekday, dateKey } = il;
    const isSat = (weekday === 'Sat');
    const isFri = (weekday === 'Fri');
    // Sun-Thu are the yeshiva days
    const isYeshivaDay = ['Sun','Mon','Tue','Wed','Thu'].indexOf(weekday) >= 0;

    // ─── 1. Task deadline reminders (server-side, fires when app is closed)
    const windowMs = 2 * 60 * 1000;
    const fired = [];
    for (const t of tk) {
      if (!t || t.dn || !t.alertAt) continue;
      if (notified[t.id]) continue;
      const at = new Date(t.alertAt).getTime();
      if (isNaN(at)) continue;
      const delta = now - at;
      if (delta < 0 || delta > windowMs) continue;
      const title = t.tx ? ('🔔 ' + t.tx) : '🔔 תזכורת';
      const body = t.ps ? ('👤 ' + t.ps) : '';
      try {
        await sendToAll(title, body, { tag: 'task-' + t.id, url: '/?page=tasks' });
        notified[t.id] = new Date().toISOString();
        fired.push({ id: t.id, tx: t.tx });
      } catch (e) { console.error('task push failed', t.id, e); }
    }
    // Prune notified entries older than 24h or for deleted tasks
    const cutoff = now - 24 * 60 * 60 * 1000;
    const liveIds = new Set(tk.filter(t => t && t.id).map(t => t.id));
    let taskPruned = 0;
    for (const id of Object.keys(notified)) {
      const notifiedAt = new Date(notified[id]).getTime();
      if (!liveIds.has(id) || (isFinite(notifiedAt) && notifiedAt < cutoff)) {
        delete notified[id];
        taskPruned++;
      }
    }
    if (fired.length || taskPruned) await writeField('_notifiedTasks', notified);

    // ─── 2. Conversation slots (reveal + prep, 6 daily notifications) ───
    const convSlots = computeConvSlots(cs, cx, inactive);
    const revealHits = [
      Object.assign({ slot: 0 }, parseHM(sched.conv1) || { h: 15, m: 30 }),
      Object.assign({ slot: 1 }, parseHM(sched.conv2) || { h: 19, m: 10 }),
      Object.assign({ slot: 2 }, parseHM(sched.conv3) || { h: 21, m: 45 })
    ];
    for (const r of revealHits) {
      if (hh === r.h && mm === r.m) {
        const key = dateKey + '_reveal_' + r.slot;
        if (convNotified[key]) continue;
        if (!convSlots[r.slot]) continue;
        try {
          await sendToAll('🎯 שיבוץ שיחה', '', {
            tag: 'conv-reveal-' + r.slot,
            url: '/?cvreveal=' + r.slot
          });
          convNotified[key] = new Date().toISOString();
        } catch (e) { console.error('reveal push failed', e); }
      }
    }
    const prepHits = [
      Object.assign({ slot: 0, session: '18:00' }, parseHM(sched.prep1) || { h: 17, m: 55 }),
      Object.assign({ slot: 1, session: '19:30' }, parseHM(sched.prep2) || { h: 19, m: 25 }),
      Object.assign({ slot: 2, session: '22:30' }, parseHM(sched.prep3) || { h: 22, m: 25 })
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
            { tag: 'conv-prep-' + p.slot, url: '/?cvprep=' + encodeURIComponent(boy.id) }
          );
          convNotified[key] = new Date().toISOString();
        } catch (e) { console.error('prep push failed', e); }
      }
    }
    // Prune yesterday's conv-notified keys
    for (const k of Object.keys(convNotified)) {
      if (!k.startsWith(dateKey + '_')) delete convNotified[k];
    }
    try { await writeField('_convNotified', convNotified); } catch (e) { console.error(e); }

    // ─── 3. Daily notifications: phones + print (user-editable times) ───
    async function fireOnce(schedKey, hmStr, title, body, opts) {
      const t = parseHM(hmStr);
      if (!t) return false;
      if (hh !== t.h || mm !== t.m) return false;
      const key = dateKey + '_' + schedKey;
      if (dailyNotified[key]) return false;
      try {
        await sendToAll(title, body, opts);
        dailyNotified[key] = new Date().toISOString();
        return true;
      } catch (e) { console.error('daily push failed', schedKey, e); return false; }
    }

    if (isYeshivaDay) {
      // 📱 Afternoon phone deposits reminder
      await fireOnce('phAft', sched.phAfternoon,
        '📱 הפקדות טלפונים - צהריים',
        'זמן לעדכן מי הפקיד ומי איחר',
        { tag: 'phones-afternoon', url: '/?page=phones&t=afternoon' });
      // 📱 Evening phone deposits reminder — includes snooze action
      const eveFired = await fireOnce('phEve', sched.phEvening,
        '📱 הפקדות טלפונים - ערב',
        'זמן לעדכן הפקדות ערב · לנודניק לחץ על ההתראה',
        {
          tag: 'phones-evening',
          url: '/?page=phones&t=tonight&snoozeable=1',
          actions: [{ action: 'snooze', title: '😴 נודניק 15 דק׳' }]
        });
      // Reset snooze flag when a fresh evening reminder fires
      if (eveFired && snoozeEve) {
        try { await writeField('_snoozeEvening', false); } catch (e) { console.error(e); }
      }
      // 😴 Snooze follow-up — 15 min after evening reminder, only if snoozed
      const eveHM = parseHM(sched.phEvening);
      if (eveHM && snoozeEve) {
        // Compute snooze time: eveHM + 15 min
        let snH = eveHM.h, snM = eveHM.m + 15;
        if (snM >= 60) { snH += 1; snM -= 60; }
        if (snH >= 24) snH -= 24;
        if (hh === snH && mm === snM) {
          const key = dateKey + '_phSnooze';
          if (!dailyNotified[key]) {
            try {
              await sendToAll('📱 הפקדות טלפונים - תזכורת',
                'תזכורת אחרי נודניק - עדכן הפקדות ערב',
                { tag: 'phones-evening-snooze', url: '/?page=phones&t=tonight' });
              dailyNotified[key] = new Date().toISOString();
              await writeField('_snoozeEvening', false);
            } catch (e) { console.error(e); }
          }
        }
      }
      // 🖨 Print report reminder (weekday)
      await fireOnce('printWeek', sched.printWeek,
        '🖨 הדפס דוח יומי',
        'הגיע הזמן להדפיס את הדוח היומי',
        { tag: 'print-report', url: '/?action=print-report' });
    }
    if (isSat) {
      // 🖨 Print report on motzash for that evening's use
      await fireOnce('printSat', sched.printSat,
        '🖨 הדפס דוח יומי',
        'הגיע הזמן להדפיס את הדוח היומי',
        { tag: 'print-report', url: '/?action=print-report' });
    }
    // Prune yesterday's daily-notified keys
    for (const k of Object.keys(dailyNotified)) {
      if (!k.startsWith(dateKey + '_')) delete dailyNotified[k];
    }
    try { await writeField('_dailyNotified', dailyNotified); } catch (e) { console.error(e); }

    res.status(200).json({
      ok: true,
      il: { hh, mm, weekday, dateKey },
      taskFired: fired.length,
      taskPruned
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

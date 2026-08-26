// Scheduled push-notification dispatcher, called by Vercel Cron entries in
// vercel.json. Three cron times per school day:
//   ?t=af  → afternoon phone-deposit reminder      (15:13 IL summer)
//   ?t=ev  → evening phone-deposit reminder        (21:48 IL summer)
//   ?t=sn  → evening snooze follow-up              (22:03 IL summer)
//
// Snooze mechanism: the ?t=ev push carries a snooze action + snooze data
// URL. When the user taps snooze, the SW POSTs /api/snooze which writes
// _snoozeEvening=true to Firestore. Then the ?t=sn cron 15 minutes later
// only fires the follow-up reminder if that flag is set (and clears it).
//
// DST warning: Vercel cron times are UTC only. The schedule in vercel.json
// is set for Israel Summer Time (UTC+3). When Israel drops back to UTC+2
// (last Sun of October), the times will fire one hour earlier IL time and
// the schedule needs to be adjusted.

const { sendToAll, loadDoc } = require('./_push');

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

// Set/clear a single field on shared/main via Firestore REST. Uses
// updateMask so other fields aren't disturbed.
async function setField(name, value) {
  const fields = {};
  fields[name] = value === null || value === undefined
    ? { nullValue: null }
    : (typeof value === 'boolean' ? { booleanValue: value } : { stringValue: String(value) });
  const url = FS_BASE + '/shared/main?updateMask.fieldPaths=' + encodeURIComponent(name);
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields })
  });
  if (!resp.ok) throw new Error('Firestore patch failed: ' + resp.status);
}

module.exports = async (req, res) => {
  try {
    const t = (req.query && req.query.t) || 'af';

    if (t === 'pr') {
      await sendToAll(
        '🖨 זמן להדפיס דוח יומי',
        'בוקר טוב! הדפס את הדוח היומי לתחילת היום',
        { tag: 'print-report', url: '/?action=print-report' }
      );
      return res.status(200).json({ ok: true, type: 'print' });
    }

    if (t === 'af') {
      await sendToAll(
        '📱 הפקדות טלפונים - צהריים',
        'זמן לעדכן מי הפקיד ומי איחר',
        { tag: 'phones-afternoon', url: '/?page=phones&t=afternoon' }
      );
      return res.status(200).json({ ok: true, type: 'afternoon' });
    }

    if (t === 'ev') {
      // clear any stale snooze from a previous day before scheduling a new one
      await setField('_snoozeEvening', false);
      await sendToAll(
        '📱 הפקדות טלפונים - ערב',
        'זמן לעדכן הפקדות ערב · לנודניק לחץ על ההתראה',
        {
          tag: 'phones-evening',
          url: '/?page=phones&t=tonight&snoozeable=1',
          actions: [{ action: 'snooze', title: '😴 נודניק 15 דק׳' }]
        }
      );
      return res.status(200).json({ ok: true, type: 'evening' });
    }

    if (t === 'sn') {
      // only fire the follow-up if the user actually snoozed the 21:48 push
      const D = await loadDoc();
      if (!D._snoozeEvening) return res.status(200).json({ ok: true, type: 'snooze', skipped: true });
      await setField('_snoozeEvening', false);
      await sendToAll(
        '📱 הפקדות טלפונים - תזכורת',
        'תזכורת אחרי נודניק - עדכן הפקדות ערב',
        { tag: 'phones-evening-snooze', url: '/?page=phones&t=tonight' }
      );
      return res.status(200).json({ ok: true, type: 'snooze', fired: true });
    }

    res.status(400).json({ error: 'unknown type: ' + t });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

// Called by the service worker when the user taps the "snooze" action on
// an evening reminder notification. Writes _snoozeEvening=true to
// shared/main so the ?t=sn cron 15 minutes later actually fires the
// follow-up push.

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

module.exports = async (req, res) => {
  try {
    const url = FS_BASE + '/shared/main?updateMask.fieldPaths=_snoozeEvening';
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { _snoozeEvening: { booleanValue: true } } })
    });
    if (!resp.ok) {
      res.status(502).json({ error: 'firestore ' + resp.status });
      return;
    }
    res.status(200).json({ ok: true, snoozed: true });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

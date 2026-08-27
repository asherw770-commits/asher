// Nightly server-side snapshot of shared/main → /backups/{stamp}_nightly.
// Runs from Vercel cron so a full backup exists every night regardless of
// whether anyone opens the app that day (the in-app daily backup only fires
// on the first user save of the day).

const PROJECT_ID = 'asher-1b6e7';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

function len(v) {
  if (!v) return 0;
  if (v.arrayValue) return (v.arrayValue.values || []).length;
  if (v.mapValue) return Object.keys(v.mapValue.fields || {}).length;
  return 0;
}

// Israel-local wall time for the id. Approximate IST summer offset (+3);
// winter would be one hour off, which is fine for a nightly backup id.
function ilStamp(now) {
  const il = new Date(now.getTime() + 3 * 3600 * 1000);
  const y = il.getUTCFullYear();
  const m = String(il.getUTCMonth() + 1).padStart(2, '0');
  const d = String(il.getUTCDate()).padStart(2, '0');
  const hh = String(il.getUTCHours()).padStart(2, '0');
  const mm = String(il.getUTCMinutes()).padStart(2, '0');
  const ss = String(il.getUTCSeconds()).padStart(2, '0');
  return y + '-' + m + '-' + d + '_' + hh + '-' + mm + '-' + ss;
}

module.exports = async (req, res) => {
  try {
    // Read the main doc as raw Firestore fields so we can re-embed them
    // in the backup unchanged. shared/main is already photo-free (client
    // splits per-boy photos into /photos/*), so this fits well under the
    // 1MB doc-size limit.
    const resp = await fetch(FS_BASE + '/shared/main');
    if (!resp.ok) return res.status(502).json({ error: 'load shared/main failed: ' + resp.status });
    const doc = await resp.json();
    const fields = doc.fields || {};

    const id = ilStamp(new Date()) + '_nightly';

    // Match the shape the client-side backup writer uses so both flavours
    // (client daily + server nightly) render identically in the restore UI.
    const backupFields = {
      date:        { stringValue: id },
      savedAt:     { stringValue: new Date().toISOString() },
      writerBuild: { stringValue: 'server-cron' },
      label:       { stringValue: 'nightly' },
      reason:      { stringValue: 'nightly' },
      pbCount:     { integerValue: String(len(fields.pb)) },
      wtCount:     { integerValue: String(len(fields.wt)) },
      cxCount:     { integerValue: String(len(fields.cx)) },
      phDays:      { integerValue: String(len(fields.ph)) },
      data:        { mapValue: { fields: fields } }
    };

    const putResp = await fetch(FS_BASE + '/backups/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: backupFields })
    });
    if (!putResp.ok) {
      const errText = await putResp.text();
      return res.status(502).json({ error: 'backup write failed: ' + putResp.status + ' ' + errText });
    }

    // Prune older nightly backups - keep the last 30.
    let pruned = 0;
    try {
      const listResp = await fetch(FS_BASE + '/backups?pageSize=300&mask.fieldPaths=date');
      if (listResp.ok) {
        const listJson = await listResp.json();
        const nightly = (listJson.documents || [])
          .map(function (d) { return d.name.split('/').pop(); })
          .filter(function (n) { return n.endsWith('_nightly'); })
          .sort()
          .reverse();
        const toDelete = nightly.slice(30);
        for (const n of toDelete) {
          try {
            const delResp = await fetch(FS_BASE + '/backups/' + encodeURIComponent(n), { method: 'DELETE' });
            if (delResp.ok) pruned++;
          } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* prune failures are non-fatal */ }

    res.status(200).json({
      ok: true,
      id: id,
      pbCount: len(fields.pb),
      wtCount: len(fields.wt),
      cxCount: len(fields.cx),
      phDays: len(fields.ph),
      pruned: pruned
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

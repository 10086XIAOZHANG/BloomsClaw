const base = 'http://127.0.0.1:8000/api/v2/tenants/default_tenant/databases/default_database';
const cols = await (await fetch(`${base}/collections`)).json();
if (!cols.length) { console.log('（无集合）'); process.exit(0); }
for (const c of cols) {
  const rec = await (await fetch(`${base}/collections/${c.id}/get`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 100 }),
  })).json();
  console.log('\n=== ' + c.name + '  (id=' + c.id + ', 记录数=' + (rec.ids?.length ?? 0) + ') ===');
  (rec.ids ?? []).forEach((id, i) => {
    const m = rec.metadatas?.[i] ?? {}; const doc = rec.documents?.[i] ?? '';
    console.log(' - key=' + (m.key ?? '?') + '\n   ' + String(doc).replace(/\n/g, '\n   '));
  });
}

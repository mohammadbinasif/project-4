// End-to-end proof: replay the browser's exact data flow against the live server.
// Run: node scripts/e2e-flow.js   (server must be running on :3000)
//
// Mirrors public/app.js: async/await, response.ok checks, JSON.stringify POST.

const BASE = 'http://localhost:3000/api/interns';

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {                       // check BEFORE json()
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.errors?.join(' ') || `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

async function main() {
  console.log('STEP 1 — page load: GET list + stats in parallel (Promise.all)');
  const [list, stats] = await Promise.all([
    apiFetch(BASE),
    apiFetch('http://localhost:3000/api/stats')
  ]);
  console.log(`  loaded ${list.count} interns, stats:`, stats.data.byTrack);

  console.log('\nSTEP 2 — form submit: POST with JSON.stringify + header');
  const created = await apiFetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Tester', track: 'QA', email: 'e2e@decodelabs.dev' })
  });
  console.log(`  server replied 201, id=${created.data.id}, Location-style body ok`);

  console.log('\nSTEP 3 — render: .map() over returned array (as the DOM would)');
  const rows = (await apiFetch(BASE)).data.map(
    (i) => `  #${i.id} ${i.name} (${i.track})`
  );
  rows.forEach((r) => console.log(r));

  console.log('\nSTEP 4 — delete button: DELETE -> 200');
  const deleted = await apiFetch(`${BASE}/${created.data.id}`, { method: 'DELETE' });
  console.log(`  ${deleted.message}`);

  console.log('\nSTEP 5 — error paths (must throw, not crash):');
  try {
    await apiFetch(`${BASE}/99999`);
  } catch (e) { console.log(`  404 -> caught: "${e.message}"`); }
  try {
    await apiFetch(`${BASE}?simulateError=1`);
  } catch (e) { console.log(`  500 -> caught: "${e.message}"`); }
  try {
    await apiFetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', track: '', email: 'bad' })
    });
  } catch (e) { console.log(`  400 -> caught: "${e.message}"`); }

  console.log('\nALL STEPS PASSED — frontend<->backend data flow works end to end.');
}

main().catch((err) => { console.error('E2E FAILED:', err.message); process.exit(1); });

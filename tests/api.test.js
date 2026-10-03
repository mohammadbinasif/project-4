// Quality gate: npm test
// Covers the backend contract AND the frontend's error-handling rules.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const app = require('../server');
let server;
let BASE;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const json = (res) => res.json();

// ---------- Noun-based routes & status codes ----------
test('GET /api/interns -> 200 with seeded array', async () => {
  const res = await fetch(`${BASE}/api/interns`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  assert.ok(body.count >= 3);
});

test('GET /api/interns/:id -> 200, unknown -> 404 JSON', async () => {
  const ok = await fetch(`${BASE}/api/interns/1`);
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).data.name, 'Alice Johnson');

  const missing = await fetch(`${BASE}/api/interns/9999`);
  assert.equal(missing.status, 404);
  const body = await json(missing);
  assert.equal(body.success, false);
  assert.match(body.error, /not found/i);
});

test('GET is NOT allowed to POST route confusion — verb matters', async () => {
  const res = await fetch(`${BASE}/api/interns`, { method: 'POST' });
  assert.ok([400, 404].includes(res.status), 'POST with no body must not succeed');
});

// ---------- CREATE: 201 + Location header ----------
test('POST valid intern -> 201 + Location header + body', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Diana Prince', track: 'Frontend', email: 'diana@decodelabs.dev' })
  });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('location'), '/api/interns/4');
  const body = await json(res);
  assert.equal(body.data.id, 4);
  assert.equal(body.data.name, 'Diana Prince');
});

// ---------- CREATE: 400 with readable errors ----------
test('POST invalid -> 400 with errors array (not a crash)', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', track: '', email: 'not-an-email' })
  });
  assert.equal(res.status, 400);
  const body = await json(res);
  assert.equal(body.success, false);
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.length >= 3, 'one message per broken field');
});

test('POST duplicate email -> 400 (business rule)', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Clone', track: 'Backend', email: 'diana@decodelabs.dev' })
  });
  assert.equal(res.status, 400);
  const body = await json(res);
  assert.match(body.errors.join(' '), /already registered/i);
});

test('POST malformed JSON -> 400 (JSON parse error handled)', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not json'
  });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /valid JSON/i);
});

// ---------- DELETE: 200 then 404 on second attempt ----------
test('DELETE -> 200, second DELETE -> 404', async () => {
  const first = await fetch(`${BASE}/api/interns/4`, { method: 'DELETE' });
  assert.equal(first.status, 200);
  const body = await json(first);
  assert.equal(body.data.id, 4);

  const second = await fetch(`${BASE}/api/interns/4`, { method: 'DELETE' });
  assert.equal(second.status, 404);
});

test('DELETE unknown id -> 404 with JSON error', async () => {
  const res = await fetch(`${BASE}/api/interns/99999`, { method: 'DELETE' });
  assert.equal(res.status, 404);
  assert.equal((await json(res)).success, false);
});

// ---------- 500 (required status code, demo hook) ----------
test('GET ?simulateError=1 -> 500 with JSON error', async () => {
  const res = await fetch(`${BASE}/api/interns?simulateError=1`);
  assert.equal(res.status, 500);
  const body = await json(res);
  assert.equal(body.success, false);
  assert.match(body.error, /simulated/i);
});

// ---------- CORS (frontend calls from another origin) ----------
test('CORS: Access-Control-Allow-Origin header present', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    headers: { Origin: 'http://localhost:5500' }
  });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('CORS preflight OPTIONS for POST is answered', async () => {
  const res = await fetch(`${BASE}/api/interns`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5500',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.ok([200, 204].includes(res.status));
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers') || '', /content-type/i);
});

// ---------- 404 for unknown API routes (JSON, not HTML) ----------
test('unknown API route -> 404 JSON', async () => {
  const res = await fetch(`${BASE}/api/nope`);
  assert.equal(res.status, 404);
  assert.match((await json(res)).error, /not found/i);
});

// ---------- Frontend files: rule checks (static analysis) ----------
// Strip comments first so prose like "no .then() chains" doesn't trip the checks.
const rawAppJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const appJs = rawAppJs
  .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
  .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (keep http:// matches)

test('frontend uses async/await, not .then() chains', () => {
  assert.ok(!/\.then\(/.test(appJs), 'no .then() chains allowed');
  assert.ok(/async function/.test(appJs) && /await fetch/.test(appJs));
});

test('frontend checks response.ok BEFORE response.json()', () => {
  const okIndex = appJs.indexOf('if (!response.ok)');
  const jsonIndex = appJs.indexOf('response.json()');
  assert.ok(okIndex !== -1, 'must check response.ok');
  assert.ok(jsonIndex !== -1, 'must parse json after');
  assert.ok(okIndex < jsonIndex, 'ok check must come first');
});

test('frontend has try/catch/finally around requests', () => {
  const catches = (appJs.match(/catch \(/g) || []).length;
  const finallys = (appJs.match(/finally \{/g) || []).length;
  assert.ok(catches >= 4, `expected >=4 catch blocks, found ${catches}`);
  assert.ok(finallys >= 4, `expected >=4 finally blocks, found ${finallys}`);
});

test('frontend renders with textContent and createElement (no innerHTML)', () => {
  assert.ok(!/innerHTML/.test(appJs), 'innerHTML is forbidden (XSS)');
  assert.ok(/textContent/.test(appJs));
  assert.ok(/createElement/.test(appJs));
  assert.ok(/\.map\(/.test(appJs), 'render must use .map()');
});

test('frontend uses JSON.stringify + application/json header for POST', () => {
  assert.ok(/JSON\.stringify\(payload\)/.test(appJs));
  assert.ok(/'Content-Type': 'application\/json'/.test(appJs));
});

test('frontend uses Promise.all for parallel requests', () => {
  assert.ok(/Promise\.all\(/.test(appJs), 'parallel fetches must use Promise.all');
});

test('frontend shows errors on screen, not console-only', () => {
  assert.ok(/showError\(/.test(appJs));
  assert.ok(/errorBanner\.textContent/.test(appJs));
});

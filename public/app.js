// ============================================================
// PROJECT 4 · FRONTEND — Intern Directory
//
// Rules this file follows (your requirements):
//  1. async/await everywhere — no .then() chains
//  2. Every request wrapped in try / catch / finally
//  3. if (!response.ok) -> throw BEFORE response.json()
//  4. Errors shown on screen (banner), never console-only
//  5. Spinner shown while loading, ALWAYS hidden in finally
//  6. Render with .map() + createElement + textContent (no innerHTML = no XSS)
//  7. Parallel requests use Promise.all (never await inside a for loop)
// ============================================================

const API_URL = 'http://localhost:3000/api/interns';

// ---------- DOM references (grabbed once, reused everywhere) ----------
const form = document.getElementById('intern-form');
const loadBtn = document.getElementById('load-btn');
const simulateBtn = document.getElementById('simulate-btn');
const listEl = document.getElementById('intern-list');
const spinner = document.getElementById('spinner');
const errorBanner = document.getElementById('error-banner');
const notice = document.getElementById('notice');
const emptyState = document.getElementById('empty-state');
const statsEl = document.getElementById('stats');
const addBtn = document.getElementById('add-btn');

// ============================================================
// 1) THE SHARED REQUEST WRAPPER
//    Every fetch in the app funnels through here, so every
//    request gets the same try/catch/finally treatment.
// ============================================================
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (networkErr) {
    // fetch() only rejects on NETWORK problems (server down, offline, CORS)
    // A 404 or 500 response does NOT throw — the next block handles that.
    throw new ApiError('Cannot reach the server. Is the backend running on port 3000?', 0);
  }

  // ---- REQUIRED PATTERN: check ok BEFORE calling response.json() ----
  if (!response.ok) {
    let serverMessage = '';
    try {
      // The server sends { error } or { errors: [...] } in the body.
      // We try to read it, but never assume it's valid JSON.
      const body = await response.json();
      serverMessage = Array.isArray(body.errors)
        ? body.errors.join(' ')
        : (body.error || '');
    } catch {
      serverMessage = ''; // non-JSON error body — fall back to status text
    }
    const fallback = `Request failed (HTTP ${response.status})`;
    throw new ApiError(serverMessage || fallback, response.status);
  }

  // Only NOW is it safe to parse the success body
  if (response.status === 204) return null; // DELETE returns no body
  return response.json();
}

// ---------- UI helpers ----------
function showError(message) {
  errorBanner.textContent = message;   // textContent, not innerHTML — XSS-safe
  errorBanner.hidden = false;
}

function clearMessages() {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
  notice.hidden = true;
  notice.textContent = '';
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function setLoading(isLoading) {
  spinner.hidden = !isLoading;
  // Prevent double-clicks while a request is in flight
  [loadBtn, addBtn, simulateBtn].forEach((btn) => { btn.disabled = isLoading; });
}

// ============================================================
// 2) RENDER — .map() + createElement + textContent
//    Never innerHTML: a name like "<img onerror=...>" would
//    execute as code. textContent escapes it automatically.
// ============================================================
function renderInterns(interns) {
  listEl.replaceChildren(); // clear list safely

  emptyState.hidden = interns.length > 0;

  const items = interns.map((intern) => {
    const li = document.createElement('li');
    li.className = 'intern-item';

    const info = document.createElement('div');
    info.className = 'info';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = intern.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${intern.email} · joined ${intern.joined} · #${intern.id}`;

    info.append(name, meta);

    const track = document.createElement('span');
    track.className = 'track';
    track.textContent = intern.track;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteIntern(intern.id, intern.name));

    li.append(info, track, deleteBtn);
    return li;
  });

  listEl.append(...items);
}

// ============================================================
// 3) GET — the "Load" button + automatic page-load call
//    Two endpoints, fetched IN PARALLEL with Promise.all
//    (NOT: await one, then await the next — that wastes round-trips)
// ============================================================
async function loadInterns() {
  clearMessages();
  setLoading(true);                       // spinner ON
  try {
    const [listRes, statsRes] = await Promise.all([
      apiFetch(API_URL),
      apiFetch('http://localhost:3000/api/stats')
    ]);

    renderInterns(listRes.data);
    statsEl.textContent =
      `${listRes.count} intern${listRes.count === 1 ? '' : 's'} · ` +
      Object.entries(statsRes.data.byTrack)
        .map(([track, n]) => `${track}: ${n}`)
        .join(' · ');
  } catch (err) {
    // On screen — NOT console-only
    showError(`Could not load interns: ${err.message}`);
  } finally {
    setLoading(false);                    // spinner OFF, always
  }
}

// ============================================================
// 4) POST — the form
//    JSON.stringify + Content-Type: application/json header
// ============================================================
async function addIntern(event) {
  event.preventDefault();                 // stop the browser's default submit/reload

  const payload = {
    name: document.getElementById('name').value.trim(),
    track: document.getElementById('track').value.trim(),
    email: document.getElementById('email').value.trim()
  };

  clearMessages();
  setLoading(true);
  try {
    const created = await apiFetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // required so Express parses the body
      body: JSON.stringify(payload)                    // object -> JSON string
    });

    form.reset();                          // clear inputs only on success
    showNotice(`Added ${created.data.name} (id ${created.data.id}).`);
    await loadInterns();                   // refresh the list (its own try/catch/finally)
  } catch (err) {
    showError(`Could not add intern: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// ============================================================
// 5) DELETE — one row
//    If two tabs delete the same row, the second gets a 404
//    from the server. We surface it, then refresh to stay in sync.
// ============================================================
async function deleteIntern(id, name) {
  clearMessages();
  setLoading(true);
  try {
    await apiFetch(`${API_URL}/${id}`, { method: 'DELETE' });
    showNotice(`Deleted ${name} (id ${id}).`);
    await loadInterns();
  } catch (err) {
    showError(`Could not delete #${id}: ${err.message}`);
    await loadInterns();                   // resync in case it vanished elsewhere
  } finally {
    setLoading(false);
  }
}

// ---------- Simulate a real 500 to prove the error UI works ----------
async function simulateServerError() {
  clearMessages();
  setLoading(true);
  try {
    await apiFetch(`${API_URL}?simulateError=1`);
  } catch (err) {
    showError(`Server error caught by the UI: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// ---------- Wiring ----------
form.addEventListener('submit', addIntern);
loadBtn.addEventListener('click', loadInterns);
simulateBtn.addEventListener('click', simulateServerError);

// Page-load call: fetch data as soon as the page opens
loadInterns();

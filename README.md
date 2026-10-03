# Project 4: Frontend & Backend Integration

A complete **Intern Directory** — an HTML/CSS/JS frontend talking to an Express REST
API, with bulletproof error handling: no blank screens, no silent failures, no XSS.

> **Domain milestone:** Frontend ↔ Backend integration
> **Stack:** Node.js 24 + Express + vanilla JavaScript (no frameworks, no build step)

---

## Quick Start

```bash
npm install
npm start          # serves BOTH the API and the frontend
```

Open **http://localhost:3000** — the page loads its data automatically.

```bash
npm test           # 20 automated tests (API + frontend code rules)
node scripts/e2e-flow.js   # replay the browser's exact data flow against the server
```

---

## Architecture: How the Pieces Connect

```text
┌─────────────────────────────  Browser  ─────────────────────────────┐
│  index.html  +  styles.css  +  app.js                              │
│                                                                     │
│  form submit ──► JSON.stringify(payload)                            │
│  Load button ──► Promise.all([fetch list, fetch stats])            │
│  render       ──► .map() + createElement + textContent             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  fetch()  — HTTP + JSON
                           │  Origin: http://localhost:3000  (cross-origin safe via CORS)
┌──────────────────────────▼──────────────────────────────────────────┐
│  server.js  (Express)                                               │
│    GET    /api/interns            → 200  { count, data: [...] }    │
│    POST   /api/interns            → 201  { data: { id, ... } }     │
│    DELETE /api/interns/:id        → 200  |  404                    │
│    GET    /api/stats              → 200  { total, byTrack }        │
│    errors                         → 400 | 404 | 500  (all JSON)    │
│    app.use(cors())  ◄── lets any origin call the API               │
└─────────────────────────────────────────────────────────────────────┘
```

**Noun-based routes:** `/api/interns` names *the resource* — the HTTP verb
(GET/POST/DELETE) says what to do. Compare the wrong style: `/api/getInterns`,
`/api/addIntern`, `/api/deleteIntern` — verbs in the URL break REST conventions
and make caching/proxies behave oddly.

---

## Backend: Routes & Status Codes

| Operation | HTTP | Route | Success | Failures |
|---|---|---|---|---|
| Fetch list | GET | `/api/interns` | **200** | 500 (`?simulateError=1`) |
| Fetch one | GET | `/api/interns/:id` | **200** | **404** |
| Add new | POST | `/api/interns` | **201** + `Location` | **400** (validation, bad JSON) |
| Remove | DELETE | `/api/interns/:id` | **200** | **404** |
| Stats | GET | `/api/stats` | **200** | — |

### Testing the API with curl

```bash
# 200 — list
curl http://localhost:3000/api/interns

# 201 — create
curl -X POST http://localhost:3000/api/interns \
  -H "Content-Type: application/json" \
  -d '{"name":"Diana Prince","track":"Frontend","email":"diana@decodelabs.dev"}'

# 400 — validation failures (one message per field)
curl -X POST http://localhost:3000/api/interns \
  -H "Content-Type: application/json" \
  -d '{"name":"X","track":"","email":"not-an-email"}'
# -> {"success":false,"errors":["Name is required (min 2 characters).", ...]}

# 400 — malformed JSON (the error handler catches the parse crash)
curl -X POST http://localhost:3000/api/interns \
  -H "Content-Type: application/json" -d '{ not json'

# 404 — unknown id / unknown route
curl http://localhost:3000/api/interns/9999
curl http://localhost:3000/api/nope

# 500 — demo hook used by the "Simulate 500" button
curl "http://localhost:3000/api/interns?simulateError=1"

# CORS — response carries Access-Control-Allow-Origin: *
curl -I -H "Origin: http://localhost:5500" http://localhost:3000/api/interns
```

### CORS, in plain English

The frontend and API are different *origins* (or may be — e.g. Live Server on
port 5500). The browser blocks cross-origin `fetch()` **unless the server opts in**.
`app.use(cors())` adds `Access-Control-Allow-Origin: *`, and also answers the
browser's automatic preflight `OPTIONS` request that accompanies JSON POSTs.

---

## Frontend: The Five Required Patterns (all in `public/app.js`)

### 1. `fetch()` + `async/await` — no `.then()` chains

```js
const listRes = await apiFetch(API_URL);
renderInterns(listRes.data);
```

### 2. `if (!response.ok)` → throw **before** `response.json()`

`fetch()` does **not** throw on 404/500 — it only rejects on network failure.
If you skip this check, `response.json()` on an error body gives you confusing
`undefined` fields. So:

```js
const response = await fetch(url, options);
if (!response.ok) {                    // ← check FIRST
  const body = await response.json().catch(() => ({}));
  throw new ApiError(body.error || `HTTP ${response.status}`, response.status);
}
return response.json();                // ← only now parse the success body
```

### 3. `try / catch / finally` around every request

```js
async function loadInterns() {
  setLoading(true);                        // spinner ON
  try {
    const [listRes, statsRes] = await Promise.all([apiFetch(LIST), apiFetch(STATS)]);
    renderInterns(listRes.data);
  } catch (err) {
    showError(`Could not load interns: ${err.message}`);   // on screen, not console-only
  } finally {
    setLoading(false);                     // spinner OFF — always
  }
}
```

### 4. Parallel requests: `Promise.all`, never `await` in a loop

```js
// ✅ both requests fly at the same time
const [a, b] = await Promise.all([fetch(url1), fetch(url2)]);

// ❌ for (const id of ids) await fetch(...)  // waits for each one sequentially
```

The Load button uses `Promise.all` for list + stats; wrong-way examples are
called out in the code comments.

### 5. Render with `.map()` + `createElement` + `textContent` (XSS-proof)

```js
const items = interns.map((intern) => {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = intern.name;   // ← text, never HTML: "<img onerror=...>" stays text
  li.append(name);
  return li;
});
listEl.replaceChildren(...items);  // clear + render in one safe call
```

`innerHTML` appears **nowhere** in this project — a test enforces it.

---

## Error Handling: The Contract

| Layer | Responsibility |
|---|---|
| **Server** | Never crash on bad input → always JSON `{ success:false, error/errors }` with the right status |
| **`apiFetch()`** | One shared wrapper: network failure → friendly message; `!response.ok` → parse server error → throw `ApiError` |
| **Callers** | `catch` → `showError()` writes into the red `role="alert"` banner; `finally` → hide spinner + re-enable buttons |

Guarantees you can demo:

- **Server off?** → "Cannot reach the server. Is the backend running on port 3000?"
- **Press "Simulate 500"** → red banner with the server's message
- **Duplicate email / short name** → 400 errors listed line-by-line in the banner
- **Delete a row twice** (two tabs) → second delete shows the 404 message, list resyncs
- **Never a blank screen**: list + banner + spinner are independent DOM nodes

---

## Common Mistakes This Project Avoids

| Mistake | What happens | Fix used here |
|---|---|---|
| Forgetting `await` | `fetch()` renders a Promise → `undefined.data` crash | `await` on every call; test asserts `async/await` present |
| `await` inside a `for` loop | Slow sequential requests | `Promise.all([...])` in `loadInterns()` |
| Assuming 404 throws | `catch` never runs; error silently ignored | explicit `if (!response.ok) throw` |
| `console.log` only | User sees a blank/broken page | `showError()` writes to an on-screen banner |
| `.then()` chains | Unreadable nesting | banned by test, `async/await` only |
| `innerHTML` for rendering | XSS if a name contains HTML | `textContent` + `createElement`, enforced by test |
| Forgetting `JSON.stringify` | Server receives `[object Object]` → 400 | `body: JSON.stringify(payload)` + `Content-Type` header |

---

## Project Structure

```text
project4/
├── README.md
├── package.json
├── server.js                 # Express API + CORS + static hosting + error handler
├── public/                   # the frontend (served by the same server)
│   ├── index.html            # form, buttons, spinner, error banner
│   ├── styles.css
│   └── app.js                # fetch + async/await + try/catch/finally + render
├── scripts/
│   └── e2e-flow.js           # replays the browser flow against the live API
└── tests/
    └── api.test.js           # 20 tests: status codes, CORS, frontend code rules
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the server..." banner | Backend not running → `npm start` |
| `EADDRINUSE :3000` | Another process holds port 3000 → close it or `PORT=3001 npm start` |
| Changes to app.js don't appear | Hard-refresh the browser (Ctrl+Shift+R) |
| CORS error in browser console | `cors()` removed from server.js — restore it |

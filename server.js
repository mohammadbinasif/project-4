// ============================================================
// PROJECT 4 · BACKEND — Intern Directory REST API
//
// Routes are NOUN-based: /api/interns  (not /api/getInterns)
//   GET    /api/interns           -> 200  fetch list
//   GET    /api/interns/:id       -> 200 | 404
//   POST   /api/interns           -> 201 | 400
//   DELETE /api/interns/:id       -> 200 | 404
//   GET    /api/stats             -> 200  (loaded in parallel via Promise.all)
//   GET    /api/interns?simulateError=1 -> 500 (demo button for error UI)
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------- In-memory store (this project is about the DATA FLOW) ----------
let interns = [
  { id: 1, name: 'Alice Johnson', track: 'Frontend', email: 'alice@decodelabs.dev', joined: '2026-09-01' },
  { id: 2, name: 'Barry Chen',    track: 'Backend',  email: 'barry@decodelabs.dev', joined: '2026-09-08' },
  { id: 3, name: 'Carmen Diaz',   track: 'Data',     email: 'carmen@decodelabs.dev', joined: '2026-09-15' }
];
let nextId = 4;

// ---------- Middleware ----------
app.use(cors());                       // CORS: let the frontend call us from ANY origin
app.use(express.json({ limit: '10kb' })); // parse JSON bodies -> req.body (invalid JSON -> 400 below)

// Serve the frontend from the same server (one command runs everything)
app.use(express.static(path.join(__dirname, 'public')));

// ---------- READ: list ----------
app.get('/api/interns', (req, res) => {
  // Demo hook so the UI can show a REAL 500 error on screen
  if (req.query.simulateError === '1') {
    return res.status(500).json({
      success: false,
      error: 'Simulated server failure (demo endpoint ?simulateError=1)'
    });
  }
  res.status(200).json({ success: true, count: interns.length, data: interns });
});

// ---------- READ: one ----------
app.get('/api/interns/:id', (req, res) => {
  const intern = interns.find((i) => i.id === Number(req.params.id));
  if (!intern) {
    return res.status(404).json({ success: false, error: `Intern ${req.params.id} not found` });
  }
  res.status(200).json({ success: true, data: intern });
});

// ---------- CREATE ----------
app.post('/api/interns', (req, res) => {
  const { name, track, email } = req.body || {};
  const errors = [];

  if (!name || name.trim().length < 2) errors.push('Name is required (min 2 characters).');
  if (!track || track.trim().length < 2) errors.push('Track is required (e.g. Frontend, Backend, Data).');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid email is required.');
  } else if (interns.some((i) => i.email.toLowerCase() === email.trim().toLowerCase())) {
    errors.push('That email is already registered.');
  }

  if (errors.length) return res.status(400).json({ success: false, errors });

  const intern = {
    id: nextId++,
    name: name.trim(),
    track: track.trim(),
    email: email.trim(),
    joined: new Date().toISOString().slice(0, 10)
  };
  interns.push(intern);

  res.status(201)                                        // 201 Created, not 200
    .location(`/api/interns/${intern.id}`)               // Location header points at the new resource
    .json({ success: true, message: 'Intern added', data: intern });
});

// ---------- DELETE ----------
app.delete('/api/interns/:id', (req, res) => {
  const id = Number(req.params.id);
  const index = interns.findIndex((i) => i.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: `Intern ${id} not found — it may already be deleted.` });
  }
  const [removed] = interns.splice(index, 1);
  res.status(200).json({ success: true, message: `Deleted ${removed.name}`, data: removed });
});

// ---------- Stats (fetched in parallel with the list) ----------
app.get('/api/stats', (req, res) => {
  const byTrack = {};
  for (const i of interns) byTrack[i.track] = (byTrack[i.track] || 0) + 1;
  res.status(200).json({ success: true, data: { total: interns.length, byTrack } });
});

// ---------- 404 for unknown API routes (JSON, not HTML) ----------
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
});
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Not found: ${req.method} ${req.originalUrl}. Open / for the app.` });
});

// ---------- Error handler: malformed JSON -> 400, anything else -> 500 ----------
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body is too large.' });
  }
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Export the app so tests can start it on any port; listen only when run directly.
module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nIntern Directory API  ->  http://localhost:${PORT}`);
    console.log(`Frontend              ->  http://localhost:${PORT}/`);
    console.log(`CORS enabled: any origin may call the API\n`);
  });
}

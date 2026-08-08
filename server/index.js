import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';

/**
 * FieldAR API server: user accounts + per-account geospatial layers.
 * Storage is plain JSON on disk (pilot scale). Also serves the built
 * frontend from ../dist when present, so a single process can host the app.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FIELDAR_DATA_DIR || path.join(__dirname, 'data');
const LAYERS_DIR = path.join(DATA_DIR, 'layers');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'jwt-secret');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8080);
const MAX_LAYER_BYTES = 30 * 1024 * 1024;

fs.mkdirSync(LAYERS_DIR, { recursive: true });

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (fs.existsSync(SECRET_FILE)
    ? fs.readFileSync(SECRET_FILE, 'utf8').trim()
    : (() => {
        const secret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
        return secret;
      })());

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function layerPath(id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  return path.join(LAYERS_DIR, `${id}.json`);
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: MAX_LAYER_BYTES }));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'NOT_LOGGED_IN' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = loadUsers().find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'NOT_LOGGED_IN' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'NOT_LOGGED_IN' });
  }
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 6) {
    return res.status(400).json({ error: 'WEAK_CREDENTIALS' });
  }
  const users = loadUsers();
  if (users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'EMAIL_TAKEN' });
  }
  const user = {
    id: `user-${crypto.randomBytes(8).toString('hex')}`,
    email,
    hash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = loadUsers().find((u) => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.hash))) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/layers', auth, (req, res) => {
  const layers = fs
    .readdirSync(LAYERS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(LAYERS_DIR, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((layer) => layer && layer.userId === req.user.id)
    .map(({ id, name, sourceFormat, createdAt, featureCount }) => ({
      id,
      name,
      sourceFormat,
      createdAt,
      featureCount,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ layers });
});

app.post('/api/layers', auth, (req, res) => {
  const { name, sourceFormat, style, geojson } = req.body ?? {};
  if (!name || !geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return res.status(400).json({ error: 'INVALID_LAYER' });
  }
  const record = {
    id: `saved-${crypto.randomBytes(8).toString('hex')}`,
    userId: req.user.id,
    name: String(name).slice(0, 200),
    sourceFormat: String(sourceFormat || 'geojson').slice(0, 40),
    createdAt: new Date().toISOString(),
    featureCount: geojson.features.length,
    style: style ?? {},
    geojson,
  };
  fs.writeFileSync(layerPath(record.id), JSON.stringify(record));
  const { id, name: layerName, sourceFormat: format, createdAt, featureCount } = record;
  res
    .status(201)
    .json({ layer: { id, name: layerName, sourceFormat: format, createdAt, featureCount } });
});

app.put('/api/layers/:id', auth, (req, res) => {
  const file = layerPath(req.params.id);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'NOT_FOUND' });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.userId !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  const { name, sourceFormat, style, geojson } = req.body ?? {};
  if (geojson && (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features))) {
    return res.status(400).json({ error: 'INVALID_LAYER' });
  }
  if (name) record.name = String(name).slice(0, 200);
  if (sourceFormat) record.sourceFormat = String(sourceFormat).slice(0, 40);
  if (style) record.style = style;
  if (geojson) {
    record.geojson = geojson;
    record.featureCount = geojson.features.length;
  }
  fs.writeFileSync(file, JSON.stringify(record));
  res.json({ ok: true });
});

app.get('/api/layers/:id', auth, (req, res) => {
  const file = layerPath(req.params.id);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'NOT_FOUND' });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.userId !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  const { userId, ...layer } = record;
  res.json({ layer });
});

app.delete('/api/layers/:id', auth, (req, res) => {
  const file = layerPath(req.params.id);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'NOT_FOUND' });
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.userId !== req.user.id) return res.status(404).json({ error: 'NOT_FOUND' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // The Vite build uses base "/AR_WEB_APP/" for GitHub Pages; serve it here too.
  app.use('/AR_WEB_APP', express.static(DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`FieldAR server listening on http://localhost:${PORT}`);
});

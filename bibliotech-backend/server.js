'use strict';
/* BiblioTech – servidor (Express + SQLite) */
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = +process.env.PORT || 3000;
const TZ = process.env.APP_TIMEZONE || 'America/Bogota';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'bibliotech.db');
const SESSION_DAYS = 7;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, category TEXT NOT NULL, isbn TEXT DEFAULT '', shelf TEXT DEFAULT '', copies INTEGER NOT NULL, value INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS readers (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', affiliation TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loans (id TEXT PRIMARY KEY, reader_id TEXT NOT NULL, book_id TEXT NOT NULL, date TEXT NOT NULL, due TEXT NOT NULL, returned_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_loans_book ON loans(book_id);
CREATE INDEX IF NOT EXISTS idx_loans_reader ON loans(reader_id);
`);

/* ---------- utilidades ---------- */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pad4 = n => String(n).padStart(4, '0');
const getSet = (k, def) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); if (!r) return def; try { return JSON.parse(r.value); } catch { return def; } };
const setSet = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_PROFILE = { name: 'Administrador', email: '', phone: '', avatar: null };
const DEFAULT_CONFIG = { institution: 'Archivo Central BiblioTech', loanDays: 14, maxBooks: 4 };
const AFFILIATIONS = ['Estudiante', 'Docente', 'Investigador', 'Público'];

/* ---------- normalizadores / validación ---------- */
function bookInput(b = {}) {
  const o = { title: str(b.title), author: str(b.author), category: str(b.category, 80), isbn: str(b.isbn, 40), shelf: str(b.shelf, 40), copies: Math.floor(+b.copies), value: Math.floor(+b.value || 0) };
  if (!o.title || !o.author || !o.category) bad('Título, autor y categoría son obligatorios.');
  if (!(o.copies >= 1 && o.copies <= 999)) bad('El número de ejemplares debe estar entre 1 y 999.');
  if (!(o.value >= 0 && o.value <= 1e9)) bad('El valor de reposición no es válido.');
  return o;
}
function readerInput(r = {}) {
  const o = { name: str(r.name), doc: str(r.doc, 40), email: str(r.email, 120), phone: str(r.phone, 40), affiliation: str(r.affiliation, 30), status: str(r.status, 20) };
  if (!o.name || !o.doc) bad('Nombre y documento son obligatorios.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) bad('El correo electrónico no es válido.');
  if (!AFFILIATIONS.includes(o.affiliation)) bad('Afiliación no válida.');
  if (!['ACTIVO', 'SUSPENDIDO'].includes(o.status)) bad('Estado no válido.');
  return o;
}
function profileInput(p = {}, current = DEFAULT_PROFILE) {
  const o = { name: str(p.name, 80) || current.name, email: str(p.email, 120), phone: str(p.phone, 40), avatar: current.avatar };
  if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) bad('El correo del perfil no es válido.');
  if ('avatar' in p) {
    if (p.avatar === null) o.avatar = null;
    else if (typeof p.avatar === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(p.avatar) && p.avatar.length < 3_000_000) o.avatar = p.avatar;
    else bad('La imagen no es válida o supera el tamaño permitido (2 MB).');
  }
  return o;
}
function configInput(c = {}) {
  const loanDays = Math.floor(+c.loanDays), maxBooks = Math.floor(+c.maxBooks);
  if (!(loanDays >= 1 && loanDays <= 90)) bad('El plazo de préstamo debe estar entre 1 y 90 días.');
  if (!(maxBooks >= 1 && maxBooks <= 20)) bad('El máximo de libros debe estar entre 1 y 20.');
  return { institution: str(c.institution, 120), loanDays, maxBooks };
}

/* ---------- consultas ---------- */
const bookRow = r => r && ({ ...r, copies: +r.copies, value: +r.value });
const loanRow = r => ({ id: r.id, readerId: r.reader_id, bookId: r.book_id, date: r.date, due: r.due, returnedAt: r.returned_at });
const activeOfBook = id => db.prepare('SELECT COUNT(*) n FROM loans WHERE book_id=? AND returned_at IS NULL').get(id).n;
const activeOfReader = id => db.prepare('SELECT COUNT(*) n FROM loans WHERE reader_id=? AND returned_at IS NULL').get(id).n;
function getState() {
  return {
    books: db.prepare('SELECT * FROM books ORDER BY rowid').all().map(bookRow),
    readers: db.prepare('SELECT * FROM readers ORDER BY rowid').all(),
    loans: db.prepare('SELECT * FROM loans ORDER BY rowid').all().map(loanRow),
    profile: getSet('profile', DEFAULT_PROFILE),
    config: getSet('config', DEFAULT_CONFIG),
    readNotifs: getSet('readNotifs', [])
  };
}
const suffix = id => parseInt(String(id).split('-').pop(), 10) || 0;
function recomputeCounters() {
  const max = (t) => db.prepare(`SELECT id FROM ${t}`).all().reduce((m, r) => Math.max(m, suffix(r.id)), 0);
  setSet('c_book', max('books')); setSet('c_reader', max('readers')); setSet('c_loan', max('loans'));
}
function nextId(kind) {
  const n = +getSet('c_' + kind, 0) + 1; setSet('c_' + kind, n);
  const y = today().slice(0, 4);
  return kind === 'book' ? `LB-${pad4(n)}` : kind === 'reader' ? `BT-${y}-${pad4(n)}` : `PR-${y}-${pad4(n)}`;
}

/* ---------- datos de ejemplo ---------- */
function seedDemo() {
  const t = today(), d = n => addDays(t, n);
  const insB = db.prepare('INSERT INTO books(id,title,author,category,isbn,shelf,copies,value) VALUES(?,?,?,?,?,?,?,?)');
  [['Cien Años de Soledad', 'Gabriel García Márquez', 'Literatura', '9780307474728', 'B-04', 3, 59000], ['El Nombre de la Rosa', 'Umberto Eco', 'Literatura', '9788426403568', 'B-06', 2, 68000], ['Ficciones', 'Jorge Luis Borges', 'Literatura', '9788420633121', 'B-09', 2, 45000], ['Clean Code', 'Robert C. Martin', 'Tecnología', '9780132350884', 'T-02', 2, 135000], ['Sapiens: De animales a dioses', 'Yuval Noah Harari', 'Historia', '9788499926223', 'H-01', 2, 79000], ['Design Patterns', 'Erich Gamma et al.', 'Tecnología', '9780201633610', 'T-05', 1, 160000], ['Introducción a los Algoritmos', 'Thomas H. Cormen', 'Tecnología', '9780262033848', 'T-07', 2, 210000], ['Crítica de la Razón Pura', 'Immanuel Kant', 'Filosofía', '9788430609574', 'F-03', 1, 72000], ['Don Quijote de la Mancha', 'Miguel de Cervantes', 'Literatura', '9788424116033', 'B-01', 3, 85000], ['El Amor en los Tiempos del Cólera', 'Gabriel García Márquez', 'Literatura', '9780307387264', 'B-05', 2, 52000]]
    .forEach((b, i) => insB.run(`LB-${pad4(i + 1)}`, ...b));
  const y = t.slice(0, 4), R = n => `BT-${y}-${pad4(n)}`;
  const insR = db.prepare('INSERT INTO readers(id,name,doc,email,phone,affiliation,status) VALUES(?,?,?,?,?,?,?)');
  [['Camila Andrea Morales', 'CC 1.094.882.109', 'camila.morales@correo.com', '+57 312 904 2218', 'Estudiante', 'ACTIVO'], ['Carlos Eduardo Restrepo', 'CC 79.482.901', 'carlos.restrepo@correo.com', '+57 300 455 1099', 'Docente', 'ACTIVO'], ['Mei-Ling Zhou', 'PAS E-9821422', 'm.zhou@correo.com', '+57 301 677 2200', 'Investigador', 'ACTIVO'], ['Hernando Silva Giraldo', 'CC 14.230.119', 'hernando.silva@correo.com', '+57 315 220 9811', 'Público', 'ACTIVO'], ['Juan Pablo Quintero', 'TI 1.002.439.112', 'juan.quintero@correo.com', '+57 319 883 4001', 'Estudiante', 'SUSPENDIDO'], ['Valeria Rojas Castillo', 'CC 52.889.340', 'valeria.rojas@correo.com', '+57 311 502 9110', 'Docente', 'ACTIVO']]
    .forEach((r, i) => insR.run(R(i + 1), ...r));
  const insL = db.prepare('INSERT INTO loans(id,reader_id,book_id,date,due,returned_at) VALUES(?,?,?,?,?,?)');
  [[1, 1, 1, -5, 9], [2, 2, 8, -20, -6], [3, 3, 4, -12, 2], [4, 3, 7, -3, 11], [5, 6, 2, -14, 0], [6, 1, 5, -9, 5], [7, 4, 3, -25, -11, -12], [8, 5, 9, -30, -16, -15], [9, 1, 6, -2, 12, -1], [10, 6, 10, -1, 13], [11, 4, 4, -6, 8, -3], [12, 2, 1, -4, 10, -2]]
    .forEach(([n, r, b, dt, du, ret]) => insL.run(`PR-${y}-${pad4(n)}`, R(r), `LB-${pad4(b)}`, d(dt), d(du), ret === undefined ? null : d(ret)));
  recomputeCounters();
}
if (!getSet('initialized', false)) {
  if (process.env.SEED_DEMO !== '0') seedDemo();
  setSet('profile', DEFAULT_PROFILE); setSet('config', DEFAULT_CONFIG); setSet('readNotifs', []); setSet('initialized', true);
}

/* ---------- autenticación ---------- */
let SECRET = process.env.SESSION_SECRET || getSet('secret', null);
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); setSet('secret', SECRET); }
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const sameStr = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const username = process.env.ADMIN_USER || 'admin';
  const generated = !process.env.ADMIN_PASSWORD;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(username,salt,hash) VALUES(?,?,?)').run(username, salt, hashPw(pw, salt));
  console.log('\n==============================================');
  console.log(' Usuario administrador creado');
  console.log('   Usuario:    ' + username);
  console.log('   Contraseña: ' + (generated ? pw + '   (cámbiala en Configuración)' : '(la definida en ADMIN_PASSWORD)'));
  console.log('==============================================\n');
}
const sign = payload => { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [b, s] = tok.split('.');
  if (!sameStr(s, crypto.createHmac('sha256', SECRET).update(b).digest('base64url'))) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    const u = db.prepare('SELECT username,hash FROM users WHERE username=?').get(p.u);
    return u && u.hash.slice(0, 16) === p.v ? u.username : null;
  } catch { return null; }
}
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(x => x[0]));
const sessionUser = req => verifyToken(cookieOf(req).bt_session);
const secureFlag = req => (process.env.COOKIE_SECURE === '1' || req.secure) ? '; Secure' : '';
function startSession(req, res, username) {
  const u = db.prepare('SELECT hash FROM users WHERE username=?').get(username);
  const tok = sign({ u: username, v: u.hash.slice(0, 16), exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `bt_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secureFlag(req)}`);
}
const attempts = new Map();
function checkRate(ip) { const a = attempts.get(ip); if (a && a.until > Date.now() && a.n >= 5) bad('Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.', 429); }
function failRate(ip) { const a = attempts.get(ip); if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + 15 * 60e3 }); else a.n++; }

/* ---------- app ---------- */
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', (req, res) => sessionUser(req) ? res.sendFile(path.join(__dirname, 'private', 'index.html')) : res.redirect('/login.html'));

const api = express.Router();
api.use((req, res, next) => { // defensa CSRF: las escrituras exigen una cabecera que un sitio externo no puede enviar
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'bibliotech') return res.status(403).json({ error: 'Solicitud no permitida.' });
  next();
});
const h = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };

api.post('/login', h((req, res) => {
  checkRate(req.ip);
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(str(req.body?.username, 60));
  const ok = u && sameStr(hashPw(String(req.body?.password ?? ''), u.salt), u.hash);
  if (!ok) { failRate(req.ip); bad('Usuario o contraseña incorrectos.', 401); }
  attempts.delete(req.ip); startSession(req, res, u.username); res.json({ ok: true });
}));
api.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'bt_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ ok: true }); });

api.use((req, res, next) => { const u = sessionUser(req); if (!u) return res.status(401).json({ error: 'Sesión no iniciada.' }); req.user = u; next(); });

api.get('/state', h((req, res) => res.json(getState())));

/* Libros */
api.post('/books', h((req, res) => {
  const b = bookInput(req.body);
  if (b.isbn && db.prepare('SELECT 1 FROM books WHERE isbn=?').get(b.isbn)) bad('Ya existe un libro con ese ISBN.', 409);
  const id = nextId('book');
  db.prepare('INSERT INTO books(id,title,author,category,isbn,shelf,copies,value) VALUES(@id,@title,@author,@category,@isbn,@shelf,@copies,@value)').run({ id, ...b });
  res.status(201).json({ id });
}));
api.put('/books/:id', h((req, res) => {
  const cur = db.prepare('SELECT 1 FROM books WHERE id=?').get(req.params.id); if (!cur) bad('Libro no encontrado.', 404);
  const b = bookInput(req.body), out = activeOfBook(req.params.id);
  if (b.isbn && db.prepare('SELECT 1 FROM books WHERE isbn=? AND id<>?').get(b.isbn, req.params.id)) bad('Ya existe un libro con ese ISBN.', 409);
  if (b.copies < out) bad(`No puedes dejar menos de ${out} ejemplares: hay ${out} prestados.`, 409);
  db.prepare('UPDATE books SET title=@title,author=@author,category=@category,isbn=@isbn,shelf=@shelf,copies=@copies,value=@value WHERE id=@id').run({ id: req.params.id, ...b });
  res.json({ ok: true });
}));
api.delete('/books/:id', h((req, res) => {
  if (!db.prepare('SELECT 1 FROM books WHERE id=?').get(req.params.id)) bad('Libro no encontrado.', 404);
  if (activeOfBook(req.params.id)) bad('No se puede eliminar: tiene préstamos activos.', 409);
  db.prepare('DELETE FROM books WHERE id=?').run(req.params.id); res.json({ ok: true });
}));

/* Lectores */
api.post('/readers', h((req, res) => {
  const r = readerInput(req.body);
  if (db.prepare('SELECT 1 FROM readers WHERE lower(doc)=lower(?)').get(r.doc)) bad('Ya existe un lector con ese documento.', 409);
  const id = nextId('reader');
  db.prepare('INSERT INTO readers(id,name,doc,email,phone,affiliation,status) VALUES(@id,@name,@doc,@email,@phone,@affiliation,@status)').run({ id, ...r });
  res.status(201).json({ id });
}));
api.put('/readers/:id', h((req, res) => {
  if (!db.prepare('SELECT 1 FROM readers WHERE id=?').get(req.params.id)) bad('Lector no encontrado.', 404);
  const r = readerInput(req.body);
  if (db.prepare('SELECT 1 FROM readers WHERE lower(doc)=lower(?) AND id<>?').get(r.doc, req.params.id)) bad('Ya existe un lector con ese documento.', 409);
  db.prepare('UPDATE readers SET name=@name,doc=@doc,email=@email,phone=@phone,affiliation=@affiliation,status=@status WHERE id=@id').run({ id: req.params.id, ...r });
  res.json({ ok: true });
}));
api.post('/readers/:id/toggle', h((req, res) => {
  const r = db.prepare('SELECT status FROM readers WHERE id=?').get(req.params.id); if (!r) bad('Lector no encontrado.', 404);
  const status = r.status === 'SUSPENDIDO' ? 'ACTIVO' : 'SUSPENDIDO';
  db.prepare('UPDATE readers SET status=? WHERE id=?').run(status, req.params.id); res.json({ status });
}));
api.delete('/readers/:id', h((req, res) => {
  if (!db.prepare('SELECT 1 FROM readers WHERE id=?').get(req.params.id)) bad('Lector no encontrado.', 404);
  if (activeOfReader(req.params.id)) bad('No se puede eliminar: tiene libros sin devolver.', 409);
  db.prepare('DELETE FROM readers WHERE id=?').run(req.params.id); res.json({ ok: true });
}));

/* Préstamos */
api.post('/loans', h((req, res) => {
  const t = db.transaction(() => {
    const r = db.prepare('SELECT * FROM readers WHERE id=?').get(str(req.body?.readerId, 40));
    const b = db.prepare('SELECT * FROM books WHERE id=?').get(str(req.body?.bookId, 40));
    const days = Math.floor(+req.body?.days);
    if (!r || !b) bad('Selecciona un lector y un libro válidos.');
    if (!(days >= 1 && days <= 90)) bad('El plazo debe estar entre 1 y 90 días.');
    const cfg = getSet('config', DEFAULT_CONFIG), now = today();
    if (r.status === 'SUSPENDIDO') bad('El lector está suspendido.', 409);
    if (db.prepare('SELECT 1 FROM loans WHERE reader_id=? AND returned_at IS NULL AND due<?').get(r.id, now)) bad('El lector tiene préstamos vencidos. Debe devolverlos primero.', 409);
    if (activeOfReader(r.id) >= cfg.maxBooks) bad(`El lector ya tiene el máximo de ${cfg.maxBooks} libros.`, 409);
    if (b.copies - activeOfBook(b.id) < 1) bad('No hay ejemplares disponibles de este libro.', 409);
    const id = nextId('loan'), due = addDays(now, days);
    db.prepare('INSERT INTO loans(id,reader_id,book_id,date,due,returned_at) VALUES(?,?,?,?,?,NULL)').run(id, r.id, b.id, now, due);
    return { id, due };
  });
  res.status(201).json(t());
}));
api.post('/loans/:id/return', h((req, res) => {
  const l = db.prepare('SELECT * FROM loans WHERE id=?').get(req.params.id); if (!l) bad('Préstamo no encontrado.', 404);
  if (l.returned_at) bad('Este préstamo ya fue devuelto.', 409);
  db.prepare('UPDATE loans SET returned_at=? WHERE id=?').run(today(), l.id); res.json({ ok: true });
}));
api.post('/loans/:id/renew', h((req, res) => {
  const l = db.prepare('SELECT * FROM loans WHERE id=?').get(req.params.id); if (!l) bad('Préstamo no encontrado.', 404);
  if (l.returned_at) bad('Este préstamo ya fue devuelto.', 409);
  const now = today(), due = addDays(l.due > now ? l.due : now, 7);
  db.prepare('UPDATE loans SET due=? WHERE id=?').run(due, l.id); res.json({ due });
}));

/* Perfil, configuración, avisos, contraseña */
api.put('/profile', h((req, res) => { setSet('profile', profileInput(req.body, getSet('profile', DEFAULT_PROFILE))); res.json({ ok: true }); }));
api.put('/config', h((req, res) => { setSet('config', configInput(req.body)); res.json({ ok: true }); }));
api.put('/notifs', h((req, res) => {
  const list = Array.isArray(req.body?.readNotifs) ? req.body.readNotifs.map(x => str(x, 120)).slice(-500) : bad('Datos no válidos.');
  setSet('readNotifs', list); res.json({ ok: true });
}));
api.post('/password', h((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.user);
  if (!sameStr(hashPw(String(req.body?.current ?? ''), u.salt), u.hash)) bad('La contraseña actual no es correcta.', 403);
  const next = String(req.body?.next ?? '');
  if (next.length < 8) bad('La nueva contraseña debe tener al menos 8 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET salt=?, hash=? WHERE username=?').run(salt, hashPw(next, salt), u.username);
  startSession(req, res, u.username); res.json({ ok: true });
}));

/* Administración de datos */
api.post('/admin/clear', h((req, res) => {
  db.transaction(() => { db.exec('DELETE FROM loans; DELETE FROM books; DELETE FROM readers;'); setSet('readNotifs', []); recomputeCounters(); })();
  res.json({ ok: true });
}));
api.post('/admin/reset-demo', h((req, res) => {
  db.transaction(() => { db.exec('DELETE FROM loans; DELETE FROM books; DELETE FROM readers;'); setSet('readNotifs', []); seedDemo(); })();
  res.json({ ok: true });
}));
api.post('/admin/import', h((req, res) => {
  const p = req.body || {};
  if (!Array.isArray(p.books) || !Array.isArray(p.readers) || !Array.isArray(p.loans)) bad('El archivo no es un respaldo válido de BiblioTech.');
  const idOk = v => /^[\w-]{1,40}$/.test(String(v));
  const books = p.books.map(b => { if (!idOk(b.id)) bad('Respaldo con libro sin código válido.'); return { id: String(b.id), ...bookInput(b) }; });
  const readers = p.readers.map(r => { if (!idOk(r.id)) bad('Respaldo con lector sin código válido.'); return { id: String(r.id), ...readerInput(r) }; });
  const loans = p.loans.map(l => {
    if (!idOk(l.id) || !idOk(l.readerId) || !idOk(l.bookId) || !ISO.test(l.date) || !ISO.test(l.due) || (l.returnedAt && !ISO.test(l.returnedAt))) bad('Respaldo con préstamos no válidos.');
    return { id: String(l.id), readerId: String(l.readerId), bookId: String(l.bookId), date: l.date, due: l.due, returnedAt: l.returnedAt || null };
  });
  if (new Set(books.map(b => b.id)).size !== books.length || new Set(readers.map(r => r.id)).size !== readers.length || new Set(loans.map(l => l.id)).size !== loans.length) bad('El respaldo contiene códigos duplicados.');
  db.transaction(() => {
    db.exec('DELETE FROM loans; DELETE FROM books; DELETE FROM readers;');
    const iB = db.prepare('INSERT INTO books(id,title,author,category,isbn,shelf,copies,value) VALUES(@id,@title,@author,@category,@isbn,@shelf,@copies,@value)');
    const iR = db.prepare('INSERT INTO readers(id,name,doc,email,phone,affiliation,status) VALUES(@id,@name,@doc,@email,@phone,@affiliation,@status)');
    const iL = db.prepare('INSERT INTO loans(id,reader_id,book_id,date,due,returned_at) VALUES(@id,@readerId,@bookId,@date,@due,@returnedAt)');
    books.forEach(x => iB.run(x)); readers.forEach(x => iR.run(x)); loans.forEach(x => iL.run(x));
    if (p.profile) setSet('profile', profileInput(p.profile, getSet('profile', DEFAULT_PROFILE)));
    if (p.config) setSet('config', configInput(p.config));
    setSet('readNotifs', Array.isArray(p.readNotifs) ? p.readNotifs.map(x => str(x, 120)).slice(-500) : []);
    recomputeCounters();
  })();
  res.json({ ok: true });
}));

api.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use('/api', api);
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'Datos no válidos.' });
  console.error(err); res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => console.log(`BiblioTech listo en http://localhost:${PORT}`));

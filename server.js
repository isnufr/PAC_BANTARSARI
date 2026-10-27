import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { db, hashPassword, verifyPassword, initialAdminPassword } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const SESSION_MS = 1000 * 60 * 60 * 12; // 12 jam

function getStatusKeys() {
  return db.prepare('SELECT key FROM status_master ORDER BY urutan ASC, id ASC').all().map((r) => r.key);
}
function getAllStatuses() {
  return db.prepare('SELECT * FROM status_master ORDER BY urutan ASC, id ASC').all();
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  next();
});

/* ---------------- Util ---------------- */
const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const num = (v) => Number(v);
const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
};

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function audit(user, aksi, wargaId, detail) {
  db.prepare('INSERT INTO audit (user_id, username, aksi, warga_id, detail) VALUES (?,?,?,?,?)').run(
    user ? user.id : null,
    user ? user.username : null,
    aksi,
    wargaId ?? null,
    detail ?? null
  );
}

/* ---------------- Auth ---------------- */
const attempts = new Map(); // ip -> {count, until}
function loginLimited(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 5 && a.until > Date.now();
}
function noteFail(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + 1000 * 60 * 10;
  attempts.set(ip, a);
}

function auth(req, res, next) {
  const token = parseCookies(req).sid;
  if (!token) return res.status(401).json({ error: 'Silakan login.' });
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.nama, u.role, u.desa_id, u.aktif, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  if (!row || row.expires_at < Date.now() || !row.aktif) {
    return res.status(401).json({ error: 'Sesi berakhir, silakan login kembali.' });
  }
  req.user = row;
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Khusus admin.' });

app.post(
  '/api/login',
  wrap((req, res) => {
    const ip = req.ip;
    if (loginLimited(ip)) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.' });
    }
    const { username, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
    if (!u || !u.aktif || !verifyPassword(String(password || ''), u.password_hash)) {
      noteFail(ip);
      return res.status(401).json({ error: 'Username atau password salah.' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
      token,
      u.id,
      Date.now() + SESSION_MS
    );
    res.set(
      'Set-Cookie',
      `sid=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${
        SECURE_COOKIE ? '; Secure' : ''
      }`
    );
    audit(u, 'LOGIN', null, null);
    res.json({ ok: true });
  })
);

app.post(
  '/api/logout',
  wrap((req, res) => {
    const token = parseCookies(req).sid;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.set('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  })
);

app.get(
  '/api/me',
  auth,
  wrap((req, res) => {
    const u = req.user;
    const desa = u.desa_id ? db.prepare('SELECT nama FROM desa WHERE id=?').get(u.desa_id) : null;
    res.json({
      id: u.id,
      username: u.username,
      nama: u.nama,
      role: u.role,
      desa_id: u.desa_id,
      desa: desa ? desa.nama : null,
    });
  })
);

app.post(
  '/api/password',
  auth,
  wrap((req, res) => {
    const { lama, baru } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(String(lama || ''), u.password_hash)) {
      return res.status(400).json({ error: 'Password lama salah.' });
    }
    if (!baru || String(baru).length < 8) {
      return res.status(400).json({ error: 'Password baru minimal 8 karakter.' });
    }
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(baru)), u.id);
    audit(req.user, 'GANTI_PASSWORD', null, null);
    res.json({ ok: true });
  })
);

/* ---------------- Meta ---------------- */
app.get(
  '/api/desa',
  auth,
  wrap((req, res) => {
    let rows = db.prepare('SELECT id, nama FROM desa ORDER BY nama').all();
    if (req.user.role === 'operator') rows = rows.filter((d) => d.id === req.user.desa_id);
    res.json(rows);
  })
);

app.post(
  '/api/desa',
  auth,
  adminOnly,
  wrap((req, res) => {
    const nama = clean(req.body.nama);
    if (!nama) return res.status(400).json({ error: 'Nama desa wajib diisi.' });
    try {
      db.prepare('INSERT INTO desa (nama) VALUES (?)').run(nama);
    } catch {
      return res.status(400).json({ error: 'Desa sudah ada.' });
    }
    audit(req.user, 'TAMBAH_DESA', null, nama);
    res.json({ ok: true });
  })
);

/* ---------------- Dusun ---------------- */
app.get(
  '/api/dusun',
  auth,
  wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT du.id, du.desa_id, du.nama, d.nama AS desa,
           (SELECT COUNT(*) FROM warga w WHERE w.dusun_id = du.id AND w.deleted_at IS NULL) AS jumlah
         FROM dusun du JOIN desa d ON d.id = du.desa_id ORDER BY d.nama, du.nama`
      )
      .all();
    res.json(req.user.role === 'operator' ? rows.filter((r) => r.desa_id === req.user.desa_id) : rows);
  })
);

app.post(
  '/api/dusun',
  auth,
  wrap((req, res) => {
    const nama = clean(req.body.nama);
    const desaId = req.user.role === 'operator' ? req.user.desa_id : num(req.body.desa_id);
    if (!nama) return res.status(400).json({ error: 'Nama dusun wajib diisi.' });
    if (!desaId || !db.prepare('SELECT 1 FROM desa WHERE id=?').get(desaId)) {
      return res.status(400).json({ error: 'Desa wajib dipilih.' });
    }
    let id;
    try {
      id = Number(db.prepare('INSERT INTO dusun (desa_id, nama) VALUES (?,?)').run(desaId, nama).lastInsertRowid);
    } catch {
      return res.status(400).json({ error: 'Dusun tersebut sudah ada di desa ini.' });
    }
    audit(req.user, 'TAMBAH_DUSUN', null, `${nama} (desa #${desaId})`);
    res.json({ ok: true, id });
  })
);

app.put(
  '/api/dusun/:id',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const nama = clean(req.body.nama);
    const du = db.prepare('SELECT * FROM dusun WHERE id=?').get(id);
    if (!du) return res.status(404).json({ error: 'Dusun tidak ditemukan.' });
    if (!nama) return res.status(400).json({ error: 'Nama dusun wajib diisi.' });
    try {
      db.prepare('UPDATE dusun SET nama=? WHERE id=?').run(nama, id);
    } catch {
      return res.status(400).json({ error: 'Dusun tersebut sudah ada di desa ini.' });
    }
    audit(req.user, 'UBAH_DUSUN', null, `${du.nama} → ${nama}`);
    res.json({ ok: true });
  })
);

app.delete(
  '/api/dusun/:id',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const du = db.prepare('SELECT * FROM dusun WHERE id=?').get(id);
    if (!du) return res.status(404).json({ error: 'Dusun tidak ditemukan.' });
    const pakai = db.prepare('SELECT COUNT(*) c FROM warga WHERE dusun_id=?').get(id).c;
    if (pakai > 0) {
      return res.status(400).json({ error: `Dusun masih dipakai ${pakai} data warga (termasuk Tempat Sampah).` });
    }
    db.prepare('DELETE FROM dusun WHERE id=?').run(id);
    audit(req.user, 'HAPUS_DUSUN', null, du.nama);
    res.json({ ok: true });
  })
);

/* ---------------- Master Status Kepartaian ---------------- */
app.get(
  '/api/status',
  auth,
  wrap((req, res) => {
    const list = db
      .prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM warga w WHERE w.deleted_at IS NULL AND INSTR(',' || w.status || ',', ',' || s.key || ',') > 0) AS jumlah_warga
        FROM status_master s ORDER BY s.urutan ASC, s.id ASC
      `)
      .all();
    res.json(list);
  })
);

app.post(
  '/api/status',
  auth,
  adminOnly,
  wrap((req, res) => {
    const label = clean(req.body.label);
    if (!label) return res.status(400).json({ error: 'Nama status wajib diisi.' });
    let key = clean(req.body.key) || label.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) return res.status(400).json({ error: 'Kode status tidak valid.' });
    if (db.prepare('SELECT 1 FROM status_master WHERE key=?').get(key)) {
      return res.status(400).json({ error: `Kode status "${key}" sudah ada.` });
    }
    const hint = clean(req.body.hint) || '';
    const color = clean(req.body.color) || '#ef4444';
    const maxUrutan = db.prepare('SELECT COALESCE(MAX(urutan), 0) max_u FROM status_master').get().max_u;
    const r = db
      .prepare('INSERT INTO status_master (key, label, hint, color, is_system, urutan) VALUES (?,?,?,?,0,?)')
      .run(key, label, hint, color, maxUrutan + 1);
    audit(req.user, 'TAMBAH_STATUS', null, `${label} (${key})`);
    res.json({ ok: true, id: Number(r.lastInsertRowid), key });
  })
);

app.put(
  '/api/status/:id',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const old = db.prepare('SELECT * FROM status_master WHERE id=?').get(id);
    if (!old) return res.status(404).json({ error: 'Status tidak ditemukan.' });
    const label = clean(req.body.label);
    if (!label) return res.status(400).json({ error: 'Nama status wajib diisi.' });
    let newKey = old.is_system ? old.key : (clean(req.body.key) || label.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, ''));
    if (!newKey) newKey = old.key;
    if (newKey !== old.key) {
      if (db.prepare('SELECT 1 FROM status_master WHERE key=? AND id<>?').get(newKey, id)) {
        return res.status(400).json({ error: `Kode status "${newKey}" sudah digunakan status lain.` });
      }
      // Otomatis perbarui data warga dari status lama ke status baru
      db.prepare(`
        UPDATE warga
        SET status = TRIM(REPLACE(',' || status || ',', ',' || ? || ',', ',' || ? || ','), ',')
        WHERE INSTR(',' || status || ',', ',' || ? || ',') > 0
      `).run(old.key, newKey, old.key);
    }
    const hint = clean(req.body.hint) || '';
    const color = clean(req.body.color) || old.color;
    db.prepare('UPDATE status_master SET key=?, label=?, hint=?, color=? WHERE id=?')
      .run(newKey, label, hint, color, id);
    audit(req.user, 'UBAH_STATUS', null, `${old.label} (${old.key}) → ${label} (${newKey})`);
    res.json({ ok: true, key: newKey });
  })
);

app.delete(
  '/api/status/:id',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const st = db.prepare('SELECT * FROM status_master WHERE id=?').get(id);
    if (!st) return res.status(404).json({ error: 'Status tidak ditemukan.' });
    if (st.is_system) return res.status(400).json({ error: `Status sistem "${st.label}" tidak dapat dihapus.` });
    const pakai = db.prepare("SELECT COUNT(*) c FROM warga WHERE INSTR(',' || status || ',', ',' || ? || ',') > 0").get(st.key).c;
    if (pakai > 0) {
      return res.status(400).json({ error: `Status "${st.label}" masih digunakan oleh ${pakai} data warga. Silakan ubah data warga tersebut sebelum menghapus status ini.` });
    }
    db.prepare('DELETE FROM status_master WHERE id=?').run(id);
    audit(req.user, 'HAPUS_STATUS', null, `${st.label} (${st.key})`);
    res.json({ ok: true });
  })
);

/* ---------------- Warga ---------------- */
function validateWarga(b, user, existingId = null) {
  const d = {
    nik: clean(b.nik),
    nama: clean(b.nama),
    jk: clean(b.jk),
    tempat_lahir: clean(b.tempat_lahir),
    tgl_lahir: clean(b.tgl_lahir),
    status_kawin: clean(b.status_kawin),
    pekerjaan: clean(b.pekerjaan),
    desa_id: b.desa_id ? num(b.desa_id) : null,
    dusun_id: b.dusun_id ? num(b.dusun_id) : null,
    rt: clean(b.rt),
    rw: clean(b.rw),
    alamat: clean(b.alamat),
    hp: clean(b.hp),
    jabatan: clean(b.jabatan),
    tingkat: clean(b.tingkat),
    no_kta: clean(b.no_kta),
    catatan: clean(b.catatan),
  };
  const validKeys = getStatusKeys();
  let rawStatuses = [];
  if (Array.isArray(b.status)) {
    rawStatuses = b.status.map(clean).filter(Boolean);
  } else if (typeof b.status === 'string') {
    rawStatuses = b.status.split(',').map((s) => s.trim()).filter(Boolean);
  }
  rawStatuses = rawStatuses.filter((s) => validKeys.includes(s));
  if (!rawStatuses.length) rawStatuses = ['NETRAL'];
  if (rawStatuses.length > 1 && rawStatuses.includes('NETRAL')) {
    rawStatuses = rawStatuses.filter((s) => s !== 'NETRAL');
  }
  rawStatuses = [...new Set(rawStatuses)];
  d.status = rawStatuses.join(',');
  if (!rawStatuses.includes('STRUKTURAL')) {
    d.jabatan = null;
    d.tingkat = null;
    d.no_kta = null;
  }
  if (user.role === 'operator') d.desa_id = user.desa_id;
  if (!d.nik || !/^\d{16}$/.test(d.nik)) return { error: 'NIK harus 16 digit angka.' };
  if (!d.nama) return { error: 'Nama wajib diisi.' };
  if (!d.desa_id || !db.prepare('SELECT 1 FROM desa WHERE id=?').get(d.desa_id)) {
    return { error: 'Desa wajib dipilih.' };
  }
  if (d.dusun_id) {
    const du = db.prepare('SELECT desa_id FROM dusun WHERE id=?').get(d.dusun_id);
    if (!du || du.desa_id !== d.desa_id) return { error: 'Dusun tidak sesuai dengan desa yang dipilih.' };
  }
  if (d.jk && !['L', 'P'].includes(d.jk)) return { error: 'Jenis kelamin tidak valid.' };
  if (d.tgl_lahir && !/^\d{4}-\d{2}-\d{2}$/.test(d.tgl_lahir)) {
    return { error: 'Format tanggal lahir tidak valid.' };
  }
  if (d.hp && !/^[0-9+\-\s]{6,20}$/.test(d.hp)) return { error: 'Nomor HP tidak valid.' };
  const dup = db.prepare('SELECT id, deleted_at FROM warga WHERE nik=?').get(d.nik);
  if (dup && dup.id !== existingId) {
    return {
      error: dup.deleted_at
        ? 'NIK ini ada di Tempat Sampah. Minta admin memulihkannya.'
        : 'NIK sudah terdaftar.',
    };
  }
  return { d };
}

function buildFilter(q, user, trash) {
  const where = [trash ? 'w.deleted_at IS NOT NULL' : 'w.deleted_at IS NULL'];
  const p = [];
  if (user.role === 'operator') {
    where.push('w.desa_id = ?');
    p.push(user.desa_id);
  } else if (q.desa) {
    where.push('w.desa_id = ?');
    p.push(num(q.desa));
  }
  if (q.status && getStatusKeys().includes(q.status)) {
    where.push("INSTR(',' || w.status || ',', ',' || ? || ',') > 0");
    p.push(q.status);
  }
  if (q.dusun) { where.push('w.dusun_id = ?'); p.push(num(q.dusun)); }
  if (q.rt) { where.push('w.rt = ?'); p.push(String(q.rt)); }
  if (q.rw) { where.push('w.rw = ?'); p.push(String(q.rw)); }
  if (q.jk && ['L', 'P'].includes(q.jk)) { where.push('w.jk = ?'); p.push(q.jk); }
  if (q.status_kawin) { where.push('w.status_kawin = ?'); p.push(String(q.status_kawin)); }
  if (q.tingkat) { where.push('w.tingkat = ?'); p.push(String(q.tingkat)); }
  if (q.q) {
    where.push('(w.nama LIKE ? OR w.nik LIKE ? OR w.hp LIKE ? OR w.alamat LIKE ?)');
    const like = `%${String(q.q).trim()}%`;
    p.push(like, like, like, like);
  }
  const umur = "CAST((julianday('now') - julianday(w.tgl_lahir)) / 365.25 AS INTEGER)";
  if (q.umurMin) { where.push(`w.tgl_lahir IS NOT NULL AND ${umur} >= ?`); p.push(num(q.umurMin)); }
  if (q.umurMax) { where.push(`w.tgl_lahir IS NOT NULL AND ${umur} <= ?`); p.push(num(q.umurMax)); }
  return { sql: where.join(' AND '), p, umur };
}

app.get(
  '/api/warga',
  auth,
  wrap((req, res) => {
    const trash = req.query.trash === '1' && req.user.role === 'admin';
    const f = buildFilter(req.query, req.user, trash);
    const limit = Math.min(Math.max(num(req.query.limit) || 20, 1), 100);
    const page = Math.max(num(req.query.page) || 1, 1);
    const total = db.prepare(`SELECT COUNT(*) c FROM warga w WHERE ${f.sql}`).get(...f.p).c;
    const rows = db
      .prepare(
        `SELECT w.*, d.nama AS desa, COALESCE(du.nama, w.dusun) AS dusun_nama, ${f.umur} AS umur
         FROM warga w JOIN desa d ON d.id = w.desa_id LEFT JOIN dusun du ON du.id = w.dusun_id
         WHERE ${f.sql}
         ORDER BY w.updated_at DESC, w.id DESC LIMIT ? OFFSET ?`
      )
      .all(...f.p, limit, (page - 1) * limit);
    res.json({ total, page, limit, rows });
  })
);

function canAccess(user, w) {
  return user.role === 'admin' || w.desa_id === user.desa_id;
}

app.post(
  '/api/warga',
  auth,
  wrap((req, res) => {
    const { d, error } = validateWarga(req.body || {}, req.user);
    if (error) return res.status(400).json({ error });
    const cols = Object.keys(d);
    const r = db
      .prepare(
        `INSERT INTO warga (${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`
      )
      .run(...cols.map((c) => d[c]), req.user.id);
    audit(req.user, 'TAMBAH', Number(r.lastInsertRowid), `${d.nama} (${d.nik}) - ${d.status}`);
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  })
);

app.put(
  '/api/warga/:id',
  auth,
  wrap((req, res) => {
    const id = num(req.params.id);
    const old = db.prepare('SELECT * FROM warga WHERE id=? AND deleted_at IS NULL').get(id);
    if (!old || !canAccess(req.user, old)) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    const { d, error } = validateWarga(req.body || {}, req.user, id);
    if (error) return res.status(400).json({ error });
    const changes = Object.keys(d)
      .filter((k) => (old[k] ?? null) !== d[k])
      .map((k) => `${k}: ${old[k] ?? '-'} → ${d[k] ?? '-'}`);
    const cols = Object.keys(d);
    db.prepare(
      `UPDATE warga SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`
    ).run(...cols.map((c) => d[c]), id);
    audit(req.user, 'UBAH', id, `${d.nama}: ${changes.join('; ') || 'tanpa perubahan'}`);
    res.json({ ok: true });
  })
);

app.delete(
  '/api/warga/:id',
  auth,
  wrap((req, res) => {
    const id = num(req.params.id);
    const w = db.prepare('SELECT * FROM warga WHERE id=? AND deleted_at IS NULL').get(id);
    if (!w || !canAccess(req.user, w)) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    db.prepare("UPDATE warga SET deleted_at=datetime('now','localtime') WHERE id=?").run(id);
    audit(req.user, 'HAPUS', id, `${w.nama} (${w.nik})`);
    res.json({ ok: true });
  })
);

app.post(
  '/api/warga/:id/restore',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const w = db.prepare('SELECT * FROM warga WHERE id=? AND deleted_at IS NOT NULL').get(id);
    if (!w) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    db.prepare('UPDATE warga SET deleted_at=NULL WHERE id=?').run(id);
    audit(req.user, 'PULIHKAN', id, `${w.nama} (${w.nik})`);
    res.json({ ok: true });
  })
);

app.delete(
  '/api/warga/:id/permanent',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const w = db.prepare('SELECT * FROM warga WHERE id=? AND deleted_at IS NOT NULL').get(id);
    if (!w) return res.status(404).json({ error: 'Data tidak ditemukan di Tempat Sampah.' });
    db.prepare('DELETE FROM warga WHERE id=?').run(id);
    audit(req.user, 'HAPUS_PERMANEN', id, `${w.nama} (${w.nik})`);
    res.json({ ok: true });
  })
);

/* ---------------- Statistik & Ekspor ---------------- */
app.get(
  '/api/stats',
  auth,
  wrap((req, res) => {
    const f = buildFilter({}, req.user, false);
    const total = db.prepare(`SELECT COUNT(*) c FROM warga w WHERE ${f.sql}`).get(...f.p).c;
    const byStatus = getAllStatuses().map((s) => {
      const c = db
        .prepare(`SELECT COUNT(*) c FROM warga w WHERE ${f.sql} AND INSTR(',' || w.status || ',', ',' || ? || ',') > 0`)
        .get(...f.p, s.key).c;
      return { status: s.key, c };
    });
    const byDesaRaw = db
      .prepare(
        `SELECT d.nama desa, w.status FROM warga w JOIN desa d ON d.id=w.desa_id WHERE ${f.sql}`
      )
      .all(...f.p);
    const desaCounts = {};
    for (const r of byDesaRaw) {
      const parts = (r.status || 'NETRAL').split(',').map((x) => x.trim()).filter(Boolean);
      for (const st of parts) {
        const k = `${r.desa}||${st}`;
        desaCounts[k] = (desaCounts[k] || 0) + 1;
      }
    }
    const byDesa = Object.entries(desaCounts).map(([k, c]) => {
      const [desa, status] = k.split('||');
      return { desa, status, c };
    });
    const byUmur = db
      .prepare(
        `SELECT CASE
           WHEN w.tgl_lahir IS NULL THEN 'Tidak diketahui'
           WHEN ${f.umur} < 17 THEN '< 17'
           WHEN ${f.umur} <= 25 THEN '17–25'
           WHEN ${f.umur} <= 35 THEN '26–35'
           WHEN ${f.umur} <= 45 THEN '36–45'
           WHEN ${f.umur} <= 55 THEN '46–55'
           ELSE '> 55' END AS kelompok, COUNT(*) c
         FROM warga w WHERE ${f.sql} GROUP BY kelompok`
      )
      .all(...f.p);
    const byJk = db
      .prepare(`SELECT COALESCE(w.jk,'-') jk, COUNT(*) c FROM warga w WHERE ${f.sql} GROUP BY w.jk`)
      .all(...f.p);
    const terbaru = db
      .prepare(
        `SELECT w.id, w.nama, w.status, d.nama desa, w.created_at FROM warga w
         JOIN desa d ON d.id=w.desa_id WHERE ${f.sql} ORDER BY w.created_at DESC, w.id DESC LIMIT 6`
      )
      .all(...f.p);
    res.json({ total, byStatus, byDesa, byUmur, byJk, terbaru });
  })
);

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

const EXPORT_COL_DEFS = {
  nik: { label: 'NIK', fn: (r) => r.nik || '' },
  nama: { label: 'Nama Lengkap', fn: (r) => r.nama || '' },
  jk: {
    label: 'JK',
    fn: (r) => {
      if (!r.jk) return '-';
      const val = String(r.jk).trim().toUpperCase();
      if (val === 'L' || val.startsWith('LAKI')) return 'L';
      if (val === 'P' || val.startsWith('PEREMPUAN') || val.startsWith('WANITA')) return 'P';
      return val;
    },
  },
  tempat_lahir: { label: 'Tempat Lahir', fn: (r) => r.tempat_lahir || '-' },
  tgl_lahir: { label: 'Tgl Lahir', fn: (r) => r.tgl_lahir || '-' },
  umur: { label: 'Umur', fn: (r) => (r.umur != null ? r.umur : '-') },
  status_kawin: { label: 'Status Kawin', fn: (r) => r.status_kawin || '-' },
  pekerjaan: { label: 'Pekerjaan', fn: (r) => r.pekerjaan || '-' },
  desa: { label: 'Desa', fn: (r) => r.desa || '-' },
  dusun_nama: { label: 'Dusun', fn: (r) => r.dusun_nama || '-' },
  rt: { label: 'RT', fn: (r) => (r.rt ? String(r.rt).padStart(2, '0') : '-') },
  rw: { label: 'RW', fn: (r) => (r.rw ? String(r.rw).padStart(2, '0') : '-') },
  alamat: { label: 'Alamat', fn: (r) => r.alamat || '-' },
  hp: { label: 'No HP / WA', fn: (r) => r.hp || '-' },
  status: { label: 'Status Kepartaian', fn: (r) => r.status || '-' },
  jabatan: { label: 'Jabatan', fn: (r) => r.jabatan || '-' },
  tingkat: { label: 'Tingkat', fn: (r) => r.tingkat || '-' },
  no_kta: { label: 'No KTA', fn: (r) => r.no_kta || '-' },
  catatan: { label: 'Catatan', fn: (r) => r.catatan || '-' },
  created_at: { label: 'Tgl Terdaftar', fn: (r) => r.created_at || '-' },
};

app.get(
  '/api/export/data',
  auth,
  wrap((req, res) => {
    const f = buildFilter(req.query, req.user, false);
    const rows = db
      .prepare(
        `SELECT w.*, d.nama AS desa, COALESCE(du.nama, w.dusun) AS dusun_nama, ${f.umur} AS umur
         FROM warga w JOIN desa d ON d.id=w.desa_id LEFT JOIN dusun du ON du.id=w.dusun_id
         WHERE ${f.sql} ORDER BY d.nama, dusun_nama, w.rw, w.rt, w.nama`
      )
      .all(...f.p);
    res.json({ total: rows.length, rows });
  })
);

const INDO_MONTHS = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
];

function buildExportFileNameServer(q, user, ext) {
  const now = new Date();
  const bulan = INDO_MONTHS[now.getMonth()];
  const tahun = now.getFullYear();

  let statusStr = 'SEMUA-STATUS';
  if (q.status) {
    statusStr = String(q.status).toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
  }

  let desaStr = 'SEMUA-DESA';
  const desaId = user.role === 'operator' ? user.desa_id : (q.desa ? Number(q.desa) : null);
  if (desaId) {
    const d = db.prepare('SELECT nama FROM desa WHERE id=?').get(desaId);
    if (d) desaStr = d.nama.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
  }

  let dusunStr = '';
  if (q.dusun) {
    const du = db.prepare('SELECT nama FROM dusun WHERE id=?').get(Number(q.dusun));
    if (du) dusunStr = du.nama.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
  }

  const parts = [statusStr, desaStr];
  if (dusunStr) parts.push(dusunStr);
  parts.push(bulan, tahun);
  return `${parts.join('_')}.${ext}`;
}

app.get(
  '/api/export',
  auth,
  wrap((req, res) => {
    const f = buildFilter(req.query, req.user, false);
    const rows = db
      .prepare(
        `SELECT w.*, d.nama AS desa, COALESCE(du.nama, w.dusun) AS dusun_nama, ${f.umur} AS umur
         FROM warga w JOIN desa d ON d.id=w.desa_id LEFT JOIN dusun du ON du.id=w.dusun_id
         WHERE ${f.sql} ORDER BY d.nama, dusun_nama, w.rw, w.rt, w.nama`
      )
      .all(...f.p);

    let activeKeys = Object.keys(EXPORT_COL_DEFS);
    if (req.query.cols) {
      const requested = req.query.cols.split(',').map((s) => s.trim());
      const filtered = requested.filter((k) => EXPORT_COL_DEFS[k]);
      if (filtered.length > 0) activeKeys = filtered;
    }

    const format = String(req.query.format || 'csv').toLowerCase();

    if (format === 'xlsx' || format === 'excel') {
      const fileName = buildExportFileNameServer(req.query, req.user, 'xlsx');
      const headerRow = ['NO', ...activeKeys.map((k) => EXPORT_COL_DEFS[k].label)];
      const dataRows = rows.map((r, i) => [i + 1, ...activeKeys.map((k) => String(EXPORT_COL_DEFS[k].fn(r)))]);

      // Title & Kop rows in Excel
      let statusLabel = req.query.status || 'SEMUA STATUS';
      let desaLabel = 'SEMUA DESA';
      const desaId = req.user.role === 'operator' ? req.user.desa_id : (req.query.desa ? Number(req.query.desa) : null);
      if (desaId) {
        const d = db.prepare('SELECT nama FROM desa WHERE id=?').get(desaId);
        if (d) desaLabel = `DESA ${d.nama.toUpperCase()}`;
      }
      let dusunLabel = '';
      if (req.query.dusun) {
        const du = db.prepare('SELECT nama FROM dusun WHERE id=?').get(Number(req.query.dusun));
        if (du) dusunLabel = `DUSUN ${du.nama.toUpperCase()}`;
      }
      const kopPartsExcel = [
        'STATUS: ' + statusLabel.toUpperCase(),
        'DESA: ' + (desaLabel || 'SEMUA DESA').toUpperCase(),
      ];
      if (dusunLabel) kopPartsExcel.push('DUSUN: ' + dusunLabel.toUpperCase());

      const now = new Date();
      const tglWaktu = now.toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const titleRows = [
        ['PENGURUS ANAK CABANG PDI PERJUANGAN KECAMATAN BANTARSARI'],
        ['LAPORAN DATA KADER & PENGURUS'],
        [kopPartsExcel.join(' | ')],
        [`WAKTU EKSPOR: ${tglWaktu} WIB | TOTAL: ${rows.length} DATA`],
        [],
      ];

      const wsData = [...titleRows, headerRow, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Pastikan NIK, No HP, RT, RW tidak diformat sebagai angka ilmiah
      activeKeys.forEach((key, colIdx) => {
        const tableColIdx = colIdx + 1; // offset kolom NO
        if (['nik', 'hp', 'rt', 'rw', 'no_kta'].includes(key)) {
          for (let r = 5; r <= wsData.length; r++) {
            const cellRef = XLSX.utils.encode_cell({ r: r - 1, c: tableColIdx });
            if (ws[cellRef]) ws[cellRef].t = 's';
          }
        }
      });

      const colWidths = headerRow.map((h, i) => {
        let maxLen = h.length;
        for (let j = 0; j < Math.min(rows.length, 100); j++) {
          const val = String(dataRows[j]?.[i] || '');
          if (val.length > maxLen) maxLen = val.length;
        }
        return { wch: Math.min(Math.max(maxLen + 3, i === 0 ? 6 : 10), 45) };
      });
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data Kader');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      audit(req.user, 'EKSPOR_EXCEL', null, `${rows.length} baris`);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
      return res.send(buf);
    }

    const fileName = buildExportFileNameServer(req.query, req.user, 'csv');
    const headerRow = ['NO', ...activeKeys.map((k) => EXPORT_COL_DEFS[k].label)];
    const lines = [headerRow.map(csvCell).join(',')];
    rows.forEach((r, i) => {
      lines.push(
        [
          i + 1,
          ...activeKeys.map((k) => {
            const val = EXPORT_COL_DEFS[k].fn(r);
            if (k === 'nik') return `="${r.nik}"`;
            return csvCell(val);
          }),
        ].join(',')
      );
    });

    audit(req.user, 'EKSPOR_CSV', null, `${rows.length} baris`);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.send('\uFEFF' + lines.join('\r\n'));
  })
);

app.post(
  '/api/import',
  auth,
  wrap((req, res) => {
    const { rows, updateExisting } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Tidak ada data untuk diimpor.' });
    }
    if (rows.length > 10000) {
      return res.status(400).json({ error: 'Maksimal 10.000 data per sekali impor.' });
    }

    const desaList = db.prepare('SELECT id, nama FROM desa').all();
    const desaMap = new Map();
    desaList.forEach((d) => {
      desaMap.set(d.nama.toLowerCase().trim(), d.id);
      desaMap.set(String(d.id), d.id);
    });

    const dusunList = db.prepare('SELECT id, desa_id, nama FROM dusun').all();
    const dusunMap = new Map();
    dusunList.forEach((du) => {
      dusunMap.set(`${du.desa_id}||${du.nama.toLowerCase().trim()}`, du.id);
    });

    const validStatusKeys = getStatusKeys();
    const statusMasterList = getAllStatuses();
    const statusLabelToKey = new Map();
    statusMasterList.forEach((s) => {
      statusLabelToKey.set(s.key.toUpperCase(), s.key);
      statusLabelToKey.set(s.label.toUpperCase(), s.key);
    });

    const insertDusunStmt = db.prepare('INSERT INTO dusun (desa_id, nama) VALUES (?,?)');
    const getWargaByNik = db.prepare('SELECT id, deleted_at, desa_id FROM warga WHERE nik=?');
    const insertWargaStmt = db.prepare(`
      INSERT INTO warga (
        nik, nama, jk, tempat_lahir, tgl_lahir, status_kawin, pekerjaan,
        desa_id, dusun, dusun_id, rt, rw, alamat, hp, status, jabatan,
        tingkat, no_kta, catatan, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const updateWargaStmt = db.prepare(`
      UPDATE warga SET
        nama=?, jk=?, tempat_lahir=?, tgl_lahir=?, status_kawin=?, pekerjaan=?,
        desa_id=?, dusun=?, dusun_id=?, rt=?, rw=?, alamat=?, hp=?, status=?, jabatan=?,
        tingkat=?, no_kta=?, catatan=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    const seenNikInFile = new Set();

    db.exec('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const rowNum = i + 2;
        const rawNik = clean(row.nik);
        const nik = rawNik ? String(rawNik).replace(/\D/g, '') : null;
        const nama = clean(row.nama);

        if (!nik || nik.length !== 16) {
          errors.push(`Baris ${rowNum}: NIK harus 16 digit angka (ditemukan: "${rawNik || '-'}").`);
          skipped++;
          continue;
        }

        if (seenNikInFile.has(nik)) {
          errors.push(`Baris ${rowNum}: NIK ${nik} duplikat di dalam file yang sama (dilewati).`);
          skipped++;
          continue;
        }
        seenNikInFile.add(nik);

        if (!nama) {
          errors.push(`Baris ${rowNum}: Nama wajib diisi.`);
          skipped++;
          continue;
        }

        let desaId = null;
        if (req.user.role === 'operator') {
          desaId = req.user.desa_id;
        } else {
          const rawDesa = clean(row.desa);
          if (rawDesa) {
            desaId = desaMap.get(rawDesa.toLowerCase().trim()) || null;
          }
          if (!desaId && req.user.desa_id) {
            desaId = req.user.desa_id;
          }
        }

        if (!desaId) {
          errors.push(`Baris ${rowNum} (${nama}): Desa wajib dipilih/sesuai desa Kecamatan Bantarsari.`);
          skipped++;
          continue;
        }

        let dusunId = null;
        const rawDusun = clean(row.dusun);
        if (rawDusun) {
          const dKey = `${desaId}||${rawDusun.toLowerCase().trim()}`;
          if (dusunMap.has(dKey)) {
            dusunId = dusunMap.get(dKey);
          } else {
            try {
              const resDu = insertDusunStmt.run(desaId, rawDusun);
              dusunId = Number(resDu.lastInsertRowid);
              dusunMap.set(dKey, dusunId);
            } catch {
              const existingDu = db.prepare('SELECT id FROM dusun WHERE desa_id=? AND nama=?').get(desaId, rawDusun);
              dusunId = existingDu ? existingDu.id : null;
            }
          }
        }

        let jk = clean(row.jk)?.toUpperCase() || null;
        if (jk) {
          if (jk.startsWith('L')) jk = 'L';
          else if (jk.startsWith('P') || jk.startsWith('W')) jk = 'P';
          else jk = null;
        }

        let tglLahir = clean(row.tgl_lahir);
        if (tglLahir) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(tglLahir)) {
            // ok
          } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(tglLahir)) {
            const parts = tglLahir.split(/[\/\-]/);
            const d = parts[0].padStart(2, '0');
            const m = parts[1].padStart(2, '0');
            const y = parts[2];
            tglLahir = `${y}-${m}-${d}`;
          } else {
            const dt = new Date(tglLahir);
            if (!isNaN(dt.getTime())) {
              tglLahir = dt.toISOString().slice(0, 10);
            } else {
              tglLahir = null;
            }
          }
        }

        let rawStatus = row.status;
        let statuses = [];
        if (Array.isArray(rawStatus)) {
          statuses = rawStatus.map((s) => String(s).trim());
        } else if (typeof rawStatus === 'string') {
          statuses = rawStatus.split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
        }
        let resolvedStatuses = [];
        for (const s of statuses) {
          const up = s.toUpperCase();
          if (statusLabelToKey.has(up)) {
            resolvedStatuses.push(statusLabelToKey.get(up));
          } else if (validStatusKeys.includes(up)) {
            resolvedStatuses.push(up);
          }
        }
        if (!resolvedStatuses.length) resolvedStatuses = ['NETRAL'];
        if (resolvedStatuses.length > 1 && resolvedStatuses.includes('NETRAL')) {
          resolvedStatuses = resolvedStatuses.filter((s) => s !== 'NETRAL');
        }
        resolvedStatuses = [...new Set(resolvedStatuses)];
        const statusStr = resolvedStatuses.join(',');

        let jabatan = clean(row.jabatan);
        let tingkat = clean(row.tingkat);
        let noKta = clean(row.no_kta);
        if (!resolvedStatuses.includes('STRUKTURAL')) {
          jabatan = null;
          tingkat = null;
          noKta = null;
        }

        const rt = clean(row.rt);
        const rw = clean(row.rw);
        const alamat = clean(row.alamat);
        const hp = clean(row.hp);
        const tempatLahir = clean(row.tempat_lahir);
        const statusKawin = clean(row.status_kawin);
        const pekerjaan = clean(row.pekerjaan);
        const catatan = clean(row.catatan);

        const existing = getWargaByNik.get(nik);
        if (existing) {
          if (req.user.role === 'operator' && existing.desa_id !== req.user.desa_id) {
            errors.push(`Baris ${rowNum}: NIK ${nik} sudah terdaftar di desa lain.`);
            skipped++;
            continue;
          }

          if (existing.deleted_at) {
            errors.push(`Baris ${rowNum}: NIK ${nik} ada di Backup / Tempat Sampah.`);
            skipped++;
            continue;
          }

          if (!updateExisting) {
            errors.push(`Baris ${rowNum}: NIK ${nik} sudah terdaftar (${nama}). Dilewati.`);
            skipped++;
            continue;
          }

          updateWargaStmt.run(
            nama, jk, tempatLahir, tglLahir, statusKawin, pekerjaan,
            desaId, rawDusun, dusunId, rt, rw, alamat, hp, statusStr, jabatan,
            tingkat, noKta, catatan, existing.id
          );
          updated++;
        } else {
          insertWargaStmt.run(
            nik, nama, jk, tempatLahir, tglLahir, statusKawin, pekerjaan,
            desaId, rawDusun, dusunId, rt, rw, alamat, hp, statusStr, jabatan,
            tingkat, noKta, catatan, req.user.id
          );
          inserted++;
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('Import error:', err);
      return res.status(500).json({ error: 'Gagal memproses impor: ' + err.message });
    }

    audit(req.user, 'IMPORT', null, `Total ${rows.length} data: ${inserted} baru, ${updated} diperbarui, ${skipped} dilewati`);
    res.json({
      ok: true,
      total: rows.length,
      inserted,
      updated,
      skipped,
      errors: errors.slice(0, 100),
    });
  })
);

/* ---------------- Pengguna (admin) ---------------- */
app.get(
  '/api/users',
  auth,
  adminOnly,
  wrap((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.id, u.username, u.nama, u.role, u.desa_id, u.aktif, d.nama AS desa
           FROM users u LEFT JOIN desa d ON d.id=u.desa_id ORDER BY u.role, u.nama`
        )
        .all()
    );
  })
);

function validateUser(b, isNew) {
  const d = {
    username: clean(b.username),
    nama: clean(b.nama),
    role: clean(b.role),
    desa_id: b.desa_id ? num(b.desa_id) : null,
    aktif: b.aktif === 0 || b.aktif === false ? 0 : 1,
  };
  if (isNew && (!d.username || !/^[a-zA-Z0-9_.]{3,30}$/.test(d.username))) {
    return { error: 'Username 3–30 karakter (huruf, angka, _ atau .).' };
  }
  if (!d.nama) return { error: 'Nama wajib diisi.' };
  if (!['admin', 'operator'].includes(d.role)) return { error: 'Peran tidak valid.' };
  if (d.role === 'operator') {
    if (!d.desa_id || !db.prepare('SELECT 1 FROM desa WHERE id=?').get(d.desa_id)) {
      return { error: 'Operator harus ditugaskan ke satu desa.' };
    }
  } else d.desa_id = null;
  const pw = b.password ? String(b.password) : null;
  if ((isNew || pw) && (!pw || pw.length < 8)) return { error: 'Password minimal 8 karakter.' };
  return { d, pw };
}

app.post(
  '/api/users',
  auth,
  adminOnly,
  wrap((req, res) => {
    const { d, pw, error } = validateUser(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    try {
      db.prepare(
        'INSERT INTO users (username, nama, password_hash, role, desa_id, aktif) VALUES (?,?,?,?,?,?)'
      ).run(d.username, d.nama, hashPassword(pw), d.role, d.desa_id, d.aktif);
    } catch {
      return res.status(400).json({ error: 'Username sudah dipakai.' });
    }
    audit(req.user, 'TAMBAH_USER', null, `${d.username} (${d.role})`);
    res.json({ ok: true });
  })
);

app.put(
  '/api/users/:id',
  auth,
  adminOnly,
  wrap((req, res) => {
    const id = num(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    const { d, pw, error } = validateUser(req.body || {}, false);
    if (error) return res.status(400).json({ error });
    if (id === req.user.id && (d.role !== 'admin' || !d.aktif)) {
      return res.status(400).json({ error: 'Anda tidak bisa menonaktifkan atau menurunkan akun sendiri.' });
    }
    db.prepare('UPDATE users SET nama=?, role=?, desa_id=?, aktif=? WHERE id=?').run(
      d.nama, d.role, d.desa_id, d.aktif, id
    );
    if (pw) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pw), id);
    if (!d.aktif || pw) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(req.user, 'UBAH_USER', null, `${u.username}${pw ? ' (reset password)' : ''}`);
    res.json({ ok: true });
  })
);

app.get(
  '/api/audit',
  auth,
  adminOnly,
  wrap((req, res) => {
    res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all());
  })
);

/* ---------------- Static ---------------- */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan.' }));

app.listen(PORT, () => {
  console.log(`\n  BANTAR RED berjalan di http://localhost:${PORT}`);
  if (initialAdminPassword) {
    console.log('\n  ==== AKUN ADMIN AWAL (catat, hanya tampil sekali) ====');
    console.log('  username : admin');
    console.log(`  password : ${initialAdminPassword}`);
    console.log('  =====================================================\n');
  }
});

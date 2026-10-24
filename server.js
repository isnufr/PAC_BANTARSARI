import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
app.use(express.json({ limit: '200kb' }));
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

app.get(
  '/api/export',
  auth,
  wrap((req, res) => {
    const f = buildFilter(req.query, req.user, false);
    const rows = db
      .prepare(
        `SELECT w.*, d.nama AS desa, COALESCE(du.nama, w.dusun) AS dusun_nama, ${f.umur} AS umur FROM warga w JOIN desa d ON d.id=w.desa_id LEFT JOIN dusun du ON du.id=w.dusun_id
         WHERE ${f.sql} ORDER BY d.nama, dusun_nama, w.rw, w.rt, w.nama`
      )
      .all(...f.p);
    const head = ['NIK','Nama','JK','Tempat Lahir','Tgl Lahir','Umur','Status Kawin','Pekerjaan','Desa','Dusun','RT','RW','Alamat','No HP','Status','Jabatan','Tingkat','No KTA','Catatan'];
    const lines = [head.map(csvCell).join(',')];
    rows.forEach((r) => {
      lines.push(
        [
          `="${r.nik}"`, r.nama, r.jk, r.tempat_lahir, r.tgl_lahir, r.umur, r.status_kawin, r.pekerjaan,
          r.desa, r.dusun_nama, r.rt, r.rw, r.alamat, r.hp, r.status, r.jabatan, r.tingkat, r.no_kta, r.catatan,
        ]
          .map((v, i) => (i === 0 ? v : csvCell(v)))
          .join(',')
      );
    });
    audit(req.user, 'EKSPOR', null, `${rows.length} baris`);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="data-kader-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.send('\uFEFF' + lines.join('\r\n'));
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

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'kader.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS desa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator')),
  desa_id INTEGER REFERENCES desa(id),
  aktif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS status_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  hint TEXT,
  color TEXT NOT NULL DEFAULT '#ef4444',
  is_system INTEGER NOT NULL DEFAULT 0,
  urutan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS warga (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nik TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  jk TEXT CHECK (jk IN ('L','P')),
  tempat_lahir TEXT,
  tgl_lahir TEXT,
  status_kawin TEXT,
  pekerjaan TEXT,
  desa_id INTEGER NOT NULL REFERENCES desa(id),
  dusun TEXT,
  rt TEXT,
  rw TEXT,
  alamat TEXT,
  hp TEXT,
  status TEXT NOT NULL DEFAULT 'NETRAL',
  jabatan TEXT,
  tingkat TEXT,
  no_kta TEXT,
  catatan TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_warga_desa ON warga(desa_id);
CREATE INDEX IF NOT EXISTS idx_warga_status ON warga(status);
CREATE INDEX IF NOT EXISTS idx_warga_nama ON warga(nama);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  aksi TEXT NOT NULL,
  warga_id INTEGER,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

/* ---------- Dusun (turunan Desa) + migrasi ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS dusun (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desa_id INTEGER NOT NULL REFERENCES desa(id),
  nama TEXT NOT NULL,
  UNIQUE (desa_id, nama)
);
`);
if (!db.prepare('PRAGMA table_info(warga)').all().some((c) => c.name === 'dusun_id')) {
  db.exec('ALTER TABLE warga ADD COLUMN dusun_id INTEGER REFERENCES dusun(id)');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_warga_dusun ON warga(dusun_id)');
// Pindahkan isian teks "dusun" lama (jika ada) menjadi master dusun
db.exec(`
INSERT OR IGNORE INTO dusun (desa_id, nama)
  SELECT DISTINCT desa_id, TRIM(dusun) FROM warga
  WHERE dusun_id IS NULL AND dusun IS NOT NULL AND TRIM(dusun) <> '';
UPDATE warga SET dusun_id = (
  SELECT du.id FROM dusun du WHERE du.desa_id = warga.desa_id AND du.nama = TRIM(warga.dusun)
) WHERE dusun_id IS NULL AND dusun IS NOT NULL AND TRIM(dusun) <> '';
`);

/* ---------- Migrasi status (dukungan multi-status) ---------- */
const wargaSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='warga'").get()?.sql || '';
if (wargaSql.includes("CHECK (status IN")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE warga_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      jk TEXT CHECK (jk IN ('L','P')),
      tempat_lahir TEXT,
      tgl_lahir TEXT,
      status_kawin TEXT,
      pekerjaan TEXT,
      desa_id INTEGER NOT NULL REFERENCES desa(id),
      dusun TEXT,
      rt TEXT,
      rw TEXT,
      alamat TEXT,
      hp TEXT,
      status TEXT NOT NULL DEFAULT 'NETRAL',
      jabatan TEXT,
      tingkat TEXT,
      no_kta TEXT,
      catatan TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      deleted_at TEXT,
      dusun_id INTEGER REFERENCES dusun(id)
    );
    INSERT INTO warga_new SELECT id, nik, nama, jk, tempat_lahir, tgl_lahir, status_kawin, pekerjaan, desa_id, dusun, rt, rw, alamat, hp, status, jabatan, tingkat, no_kta, catatan, created_by, created_at, updated_at, deleted_at, dusun_id FROM warga;
    DROP TABLE warga;
    ALTER TABLE warga_new RENAME TO warga;
    CREATE INDEX IF NOT EXISTS idx_warga_desa ON warga(desa_id);
    CREATE INDEX IF NOT EXISTS idx_warga_status ON warga(status);
    CREATE INDEX IF NOT EXISTS idx_warga_nama ON warga(nama);
    CREATE INDEX IF NOT EXISTS idx_warga_dusun ON warga(dusun_id);
    PRAGMA foreign_keys = ON;
  `);
}

/* ---------- Password hashing (scrypt, tanpa dependensi tambahan) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

/* ---------- Seed awal ---------- */
const DESA_AWAL = [
  'Bantarsari', 'Binangun', 'Bulaksari', 'Cikedondong',
  'Citembong', 'Kamulyan', 'Kedungwadas', 'Rawajaya',
];

if (db.prepare('SELECT COUNT(*) c FROM desa').get().c === 0) {
  const ins = db.prepare('INSERT INTO desa (nama) VALUES (?)');
  DESA_AWAL.forEach((d) => ins.run(d));
}

const STATUS_AWAL = [
  { key: 'NETRAL', label: 'Netral', hint: 'Bukan / tidak memihak ke manapun', color: '#94a3b8', is_system: 1, urutan: 1 },
  { key: 'STRUKTURAL', label: 'Struktural', hint: 'Pengurus resmi Partai PDI Perjuangan', color: '#ef4444', is_system: 1, urutan: 2 },
  { key: 'ADS', label: 'ADS', hint: 'Adistrya Senter', color: '#f59e0b', is_system: 0, urutan: 3 },
  { key: 'SOBAT_KAISAR', label: 'Sobat Kaisar', hint: '', color: '#a78bfa', is_system: 0, urutan: 4 },
  { key: 'LAINNYA', label: 'Lainnya', hint: '', color: '#38bdf8', is_system: 0, urutan: 5 },
];

if (db.prepare('SELECT COUNT(*) c FROM status_master').get().c === 0) {
  const ins = db.prepare('INSERT INTO status_master (key, label, hint, color, is_system, urutan) VALUES (?,?,?,?,?,?)');
  STATUS_AWAL.forEach((s) => ins.run(s.key, s.label, s.hint, s.color, s.is_system, s.urutan));
}

export let initialAdminPassword = null;
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  initialAdminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
  db.prepare(
    "INSERT INTO users (username, nama, password_hash, role) VALUES ('admin','Administrator',?, 'admin')"
  ).run(hashPassword(initialAdminPassword));
}

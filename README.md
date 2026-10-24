# BANTAR RED — Kandang Banteng Kecamatan Bantarsari

Aplikasi web pengelolaan database warga dan kader kepartaian Kecamatan Bantarsari, Kabupaten Cilacap.
Stack: Node.js (≥ 22.5) + Express.js + SQLite bawaan Node (`node:sqlite`).

---

## Fitur Utama
- **Database Berjenjang**: Desa $\rightarrow$ Dusun $\rightarrow$ RT & RW.
- **Multi-Status Kepartaian**: Mendukung pemilihan lebih dari 1 status (mis. Struktural + ADS/ADSE).
- **Kontrol Master Status**: Admin dapat menambah, mengubah nama/warna badge, dan menghapus status kepartaian. Perubahan nama status otomatis diperbarui ke seluruh data warga (*cascade update*).
- **Manajemen Hak Akses**:
  - **Admin**: Akses penuh seluruh desa, master pengguna & status, wilayah, backup data, dan riwayat aktivitas.
  - **Operator**: Khusus mengelola data warga di desa yang ditugaskan.
- **Pencarian Cepat & Filter**: Berdasarkan nama, NIK, No. HP, status afiliasi, desa, dusun, umur, dan jenis kelamin.
- **Ekspor Excel / CSV**: Unduh data warga terfilter ke format spreadsheet.
- **Backup & Pulihkan (Soft Delete)**: Data yang dihapus tersimpan di menu Backup dan dapat dipulihkan atau dihapus permanen.
- **Audit Trail**: Seluruh aktivitas tercatat lengkap dengan waktu dan pelaksana.

---

## Menjalankan di Lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000` (atau port yang ditentukan di environment).

---

## Panduan Deploy ke VPS / Coolify

### 1. Menggunakan Docker / Coolify (Direkomendasikan)
Proyek ini sudah dilengkapi `Dockerfile` berbasis `node:22-alpine` sehingga kompatibel penuh dengan `node:sqlite`.

1. Di panel **Coolify**, pilih **New Resource** $\rightarrow$ **Public/Private Git Repository** (atau Dockerfile).
2. Tentukan **Build Pack**: `Dockerfile`.
3. Tambahkan **Persistent Storage / Volume**:
   - Source path: `bantar_red_data` (atau folder di host)
   - Destination path: `/app/data`
4. Konfigurasikan **Environment Variables**:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `DATA_DIR=/app/data`
   - `ADMIN_PASSWORD=PasswordAdminPilihanAnda` (opsional saat inisialisasi awal)
5. Klik **Deploy**.

### 2. Menggunakan VPS Manual (Node.js Direct + PM2 / Systemd)
Pastikan Node.js versi **>= 22.5.0** sudah terpasang di VPS:
```bash
node -v # wajib >= v22.5.0
npm install --omit=dev
PORT=3000 NODE_ENV=production node server.js
```
Gunakan reverse proxy seperti Caddy atau Nginx dengan sertifikat SSL (HTTPS) agar cookie `Secure` berjalan optimal.

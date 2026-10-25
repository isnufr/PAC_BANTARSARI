'use strict';

/* ================= Konfigurasi ================= */
let STATUS = [
  { key: 'NETRAL', label: 'Netral', hint: 'Bukan / tidak memihak ke manapun', color: '#94a3b8' },
  { key: 'STRUKTURAL', label: 'Struktural', hint: 'Pengurus resmi Partai PDI Perjuangan', color: '#ef4444' },
  { key: 'ADS', label: 'ADS', hint: 'Adistrya Senter', color: '#f59e0b' },
  { key: 'SOBAT_KAISAR', label: 'Sobat Kaisar', hint: '', color: '#a78bfa' },
  { key: 'LAINNYA', label: 'Lainnya', hint: '', color: '#38bdf8' },
];
let STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.key, s]));
let STATUS_COLOR = Object.fromEntries(STATUS.map((s) => [s.key, s.color || '#ef4444']));

function setStatusList(list) {
  if (Array.isArray(list) && list.length) {
    STATUS = list;
    STATUS_MAP = Object.fromEntries(STATUS.map((s) => [s.key, s]));
    STATUS_COLOR = Object.fromEntries(STATUS.map((s) => [s.key, s.color || '#ef4444']));
  }
}
const TINGKAT = ['DPC', 'PAC', 'Ranting', 'Anak Ranting'];
const KAWIN = ['Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati'];
const TITLES = {
  dashboard: 'Dashboard', warga: 'Database', sampah: 'Backup',
  pengguna: 'Pengguna & Wilayah', audit: 'Riwayat Aktivitas',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (k) => {
  if (!k) return '';
  const list = String(k).split(',').map((s) => s.trim()).filter(Boolean);
  return list
    .map((item) => {
      const col = STATUS_COLOR[item] || STATUS_MAP[item]?.color || '#94a3b8';
      return `<span class="badge ${esc(item)}" style="--c:${esc(col)}">${esc(STATUS_MAP[item]?.label || item)}</span>`;
    })
    .join(' ');
};
const fmtDate = (s) => {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

const state = {
  me: null, view: 'dashboard', desa: [], dusun: [],
  f: { q: '', desa: '', dusun: '', status: '', rt: '', rw: '', jk: '', umurMin: '', umurMax: '', page: 1 },
};

/* ================= API ================= */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error(data?.error || 'Sesi berakhir'); }
  if (!res.ok) throw new Error(data?.error || 'Terjadi kesalahan');
  return data;
}

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}

function openModal(title, html, narrow = false) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('.modal-box').classList.toggle('narrow', narrow);
  $('#modal').classList.remove('hidden');
  const first = $('#modal-body input:not([type=radio]), #modal-body select');
  if (first) setTimeout(() => first.focus(), 50);
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); setNav(false); } });

function confirmBox(title, text, okLabel = 'Ya, lanjutkan') {
  return new Promise((resolve) => {
    openModal(title, `<p>${text}</p>
      <div class="modal-foot"><button class="btn" id="c-no">Batal</button>
      <button class="btn btn-primary" id="c-yes">${esc(okLabel)}</button></div>`, true);
    $('#c-no').onclick = () => { closeModal(); resolve(false); };
    $('#c-yes').onclick = () => { closeModal(); resolve(true); };
  });
}

/* ================= Login / Sesi ================= */
function showLogin() {
  state.me = null;
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-password').value = '';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-submit');
  btn.disabled = true; $('#login-error').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { username: $('#login-username').value, password: $('#login-password').value } });
    await boot();
  } catch (err) { $('#login-error').textContent = err.message; }
  btn.disabled = false;
});

$('#btn-logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); };

$('#btn-password').onclick = () => {
  openModal('Ganti Password', `
    <form id="pw-form" class="form-grid">
      <label class="field full"><span>Password lama</span><input type="password" id="pw-lama" autocomplete="current-password" required></label>
      <label class="field full"><span>Password baru (min. 8 karakter)</span><input type="password" id="pw-baru" autocomplete="new-password" minlength="8" required></label>
      <p class="form-error full" id="pw-err"></p>
      <div class="modal-foot full"><button type="button" class="btn" onclick="closeModal()">Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`, true);
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/password', { method: 'POST', body: { lama: $('#pw-lama').value, baru: $('#pw-baru').value } });
      closeModal(); toast('Password berhasil diganti');
    } catch (err) { $('#pw-err').textContent = err.message; }
  };
};

async function boot() {
  try { state.me = await api('/me'); } catch { return showLogin(); }
  try {
    const [desa, dusun, statusList] = await Promise.all([
      api('/desa').catch((e) => { console.warn('Gagal memuat desa:', e); return []; }),
      api('/dusun').catch((e) => { console.warn('Gagal memuat dusun:', e); return []; }),
      api('/status').catch((e) => { console.warn('Gagal memuat status:', e); return null; }),
    ]);
    state.desa = desa || [];
    state.dusun = dusun || [];
    if (statusList) setStatusList(statusList);
  } catch (err) {
    console.error('Boot error:', err);
  }
  const admin = state.me.role === 'admin';
  $$('.admin-only').forEach((n) => n.classList.toggle('hidden', !admin));
  $('#user-name').textContent = state.me.nama;
  $('#user-role').textContent = admin ? 'Administrator' : `Operator · ${state.me.desa}`;
  $('#user-avatar').textContent = state.me.nama.trim()[0].toUpperCase();
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  go(state.view);
}

/* ================= Navigasi ================= */
function go(view) {
  if (!state.me) return showLogin();
  state.view = view;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  $('#page-title').textContent = TITLES[view];
  setNav(false);
  $('#top-actions').innerHTML = '';
  ({ dashboard: renderDashboard, warga: renderWarga, sampah: renderSampah, pengguna: renderPengguna, audit: renderAudit })[view]();
}
$$('.nav-item').forEach((n) => (n.onclick = () => go(n.dataset.view)));

// Sidebar mobile: buka/tutup laci + backdrop (ketuk di luar untuk menutup)
function setNav(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#nav-backdrop').classList.toggle('show', open);
  document.body.classList.toggle('nav-open', open);
  $('#btn-menu').setAttribute('aria-expanded', String(open));
}
$('#btn-menu').onclick = () => setNav(!$('#sidebar').classList.contains('open'));
$('#btn-close-menu').onclick = () => setNav(false);
$('#nav-backdrop').onclick = () => setNav(false);
window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) setNav(false); });

/* ================= Dashboard ================= */
async function renderDashboard() {
  const c = $('#content');
  c.innerHTML = '<p class="muted">Memuat…</p>';
  const s = await api('/stats');
  const cnt = Object.fromEntries(s.byStatus.map((r) => [r.status, r.c]));
  const total = s.total;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  // donut
  let acc = 0;
  const stops = STATUS.map((st) => {
    const from = acc; acc += total ? ((cnt[st.key] || 0) / total) * 100 : 0;
    return `${STATUS_COLOR[st.key]} ${from}% ${acc}%`;
  });
  const donutBg = total ? `conic-gradient(${stops.join(',')})` : 'rgba(255,255,255,.08)';

  // per desa
  const desaMap = {};
  s.byDesa.forEach((r) => { (desaMap[r.desa] ||= { total: 0 })[r.status] = r.c; desaMap[r.desa].total += r.c; });
  const desaRows = Object.entries(desaMap).sort((a, b) => b[1].total - a[1].total);
  const maxDesa = Math.max(1, ...desaRows.map((r) => r[1].total));

  const umurOrder = ['< 17', '17–25', '26–35', '36–45', '46–55', '> 55', 'Tidak diketahui'];
  const umurMap = Object.fromEntries(s.byUmur.map((r) => [r.kelompok, r.c]));
  const maxUmur = Math.max(1, ...Object.values(umurMap));
  const jk = Object.fromEntries(s.byJk.map((r) => [r.jk, r.c]));

  c.innerHTML = `
    <div class="grid stats">
      <div class="stat total"><small>Total Warga Terdata</small><b>${total}</b><em>${state.me?.role === 'admin' ? 'Seluruh desa' : esc(state.me?.desa || '')}</em></div>
      ${STATUS.map((st) => `<div class="stat" style="--accent:${STATUS_COLOR[st.key]}"><small>${esc(st.label)}</small><b>${cnt[st.key] || 0}</b><em>${pct(cnt[st.key] || 0)}% dari total</em></div>`).join('')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Komposisi Status</h3>
        <div class="donut-wrap">
          <div class="donut" style="background:${donutBg}"><div class="mid"><div>${total}<small>orang</small></div></div></div>
          <div class="legend">${STATUS.map((st) => `<span style="--c:${STATUS_COLOR[st.key]}">${esc(st.label)} — <b>${cnt[st.key] || 0}</b></span>`).join('')}</div>
        </div>
      </div>
      <div class="card"><h3>Warga Terbaru</h3>
        <div class="recent">${s.terbaru.length ? s.terbaru.map((r) => `
          <div class="recent-item"><div class="grow"><b>${esc(r.nama)}</b><span class="tiny muted">${esc(r.desa)} · ${fmtDate(r.created_at)}</span></div>${badge(r.status)}</div>`).join('')
          : '<p class="muted">Belum ada data.</p>'}</div>
      </div>
      <div class="card"><h3>Sebaran per Desa</h3>
        <div class="bars">${desaRows.length ? desaRows.map(([d, v]) => `
          <div class="bar-row"><span>${esc(d)}</span>
            <div class="track" style="width:${(v.total / maxDesa) * 100}%">${STATUS.map((st) => v[st.key] ? `<div class="seg" title="${esc(st.label)}: ${v[st.key]}" style="width:${(v[st.key] / v.total) * 100}%;background:${STATUS_COLOR[st.key]}"></div>` : '').join('')}</div>
            <span class="val">${v.total}</span></div>`).join('') : '<p class="muted">Belum ada data.</p>'}</div>
        <div class="legend">${STATUS.map((st) => `<span style="--c:${STATUS_COLOR[st.key]}">${esc(st.label)}</span>`).join('')}</div>
      </div>
      <div class="card"><h3>Kelompok Umur &amp; Jenis Kelamin</h3>
        <div class="bars">${umurOrder.filter((k) => umurMap[k]).map((k) => `
          <div class="bar-row"><span>${esc(k)}</span><div class="track" style="width:${(umurMap[k] / maxUmur) * 100}%"><div class="seg" style="width:100%;background:linear-gradient(90deg,var(--red-dark),var(--red-2))"></div></div><span class="val">${umurMap[k]}</span></div>`).join('') || '<p class="muted">Belum ada data.</p>'}</div>
        <div class="legend"><span style="--c:#60a5fa">Laki-laki — <b>${jk.L || 0}</b></span><span style="--c:#f472b6">Perempuan — <b>${jk.P || 0}</b></span><span style="--c:#6b7280">Belum diisi — <b>${jk['-'] || 0}</b></span></div>
      </div>
    </div>`;
}

/* ================= Data Warga ================= */
function filterQS(extra = {}) {
  const p = new URLSearchParams();
  Object.entries({ ...state.f, ...extra }).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  return p.toString();
}

// Opsi dropdown dusun, difilter berdasarkan desa yang dipilih
function dusunOpts(desaId, selected, firstLabel) {
  const list = state.dusun.filter((d) => !desaId || d.desa_id === +desaId);
  return `<option value="">${esc(firstLabel)}</option>` + list
    .map((d) => `<option value="${d.id}" ${+selected === d.id ? 'selected' : ''}>${esc(d.nama)}${desaId ? '' : ' · ' + esc(d.desa)}</option>`)
    .join('');
}

// Normalisasi nomor HP Indonesia -> tautan WhatsApp (wa.me). Kosong jika tidak valid.
function waLink(hp) {
  const first = String(hp ?? '').split(/[\/,;]/).find((s) => /\d/.test(s)) || '';
  let d = first.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (d.length < 9 || d.length > 15) return '';
  return 'https://wa.me/' + d;
}
const WA_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path fill="currentColor" transform="translate(5.8 5.6) scale(.52)" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const DL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>';

function waShortcut(r) {
  const href = waLink(r.hp);
  return href
    ? `<a class="btn-action btn-wa" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Chat WhatsApp ${esc(r.nama)}" title="Chat WhatsApp (${esc(r.hp)})" onclick="event.stopPropagation()">${WA_ICON}</a>`
    : `<button type="button" class="btn-action btn-wa is-disabled" disabled aria-label="Nomor WhatsApp ${esc(r.nama)} belum tersedia" title="No. HP belum diisi atau tidak valid" onclick="event.stopPropagation()">${WA_ICON}</button>`;
}

function wargaShell(trash) {
  const admin = state.me?.role === 'admin';
  const c = $('#content');
  c.innerHTML = `
    <div class="chips" id="chips"></div>
    <div class="filters">
      <input class="search" id="f-q" type="search" placeholder="Cari nama, NIK, No. HP, alamat…" aria-label="Cari" value="${esc(state.f.q)}">
      ${admin ? `<select id="f-desa" class="f-half" aria-label="Filter desa"><option value="">Semua desa</option>${state.desa.map((d) => `<option value="${d.id}" ${+state.f.desa === d.id ? 'selected' : ''}>${esc(d.nama)}</option>`).join('')}</select>` : ''}
      <select id="f-dusun" class="${admin ? 'f-half' : 'f-wide'}" aria-label="Filter dusun">${dusunOpts(admin ? state.f.desa : (state.me?.desa_id || ''), state.f.dusun, 'Semua dusun')}</select>
      <input id="f-rw" class="f-rw" inputmode="numeric" placeholder="RW" aria-label="RW" value="${esc(state.f.rw)}">
      <input id="f-rt" class="f-rt" inputmode="numeric" placeholder="RT" aria-label="RT" value="${esc(state.f.rt)}">
      <select id="f-jk" aria-label="Jenis kelamin"><option value="">L/P</option><option value="L" ${state.f.jk === 'L' ? 'selected' : ''}>Laki-laki</option><option value="P" ${state.f.jk === 'P' ? 'selected' : ''}>Perempuan</option></select>
      <input id="f-umin" class="f-umin" type="number" inputmode="numeric" min="0" placeholder="Umur min" aria-label="Umur minimal" value="${esc(state.f.umurMin)}">
      <input id="f-umax" class="f-umax" type="number" inputmode="numeric" min="0" placeholder="Umur maks" aria-label="Umur maksimal" value="${esc(state.f.umurMax)}">
      <button type="button" class="btn btn-sm" id="f-reset">Reset</button>
    </div>
    <div id="table-area"></div>`;
  const apply = () => {
    state.f.q = $('#f-q').value.trim();
    if ($('#f-desa')) state.f.desa = $('#f-desa').value;
    state.f.dusun = $('#f-dusun').value;
    state.f.rw = $('#f-rw').value.trim(); state.f.rt = $('#f-rt').value.trim();
    state.f.jk = $('#f-jk').value; state.f.umurMin = $('#f-umin').value; state.f.umurMax = $('#f-umax').value;
    state.f.page = 1;
    loadWarga(trash);
  };
  let t;
  $('#f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 300); });
  if ($('#f-desa')) {
    // ganti desa -> daftar dusun ikut berubah
    $('#f-desa').addEventListener('change', () => { $('#f-dusun').innerHTML = dusunOpts($('#f-desa').value, '', 'Semua dusun'); });
  }
  ['#f-desa', '#f-dusun', '#f-jk'].forEach((s) => $(s) && $(s).addEventListener('change', apply));
  ['#f-rw', '#f-rt', '#f-umin', '#f-umax'].forEach((s) => $(s).addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 400); }));
  $('#f-reset').onclick = () => {
    state.f = { q: '', desa: '', dusun: '', status: '', rt: '', rw: '', jk: '', umurMin: '', umurMax: '', page: 1 };
    trash ? renderSampah() : renderWarga();
  };
}

async function renderWarga() {
  $('#top-actions').innerHTML = `
    <a class="btn" id="btn-export" href="#" title="Ekspor Excel" aria-label="Ekspor Excel">${DL_ICON}<span class="lbl">Ekspor Excel</span></a>
    <button class="btn btn-primary" id="btn-add" type="button" title="Tambah Data" aria-label="Tambah Data"><span aria-hidden="true">＋</span><span class="lbl">Tambah Data</span></button>`;
  $('#btn-add').onclick = () => wargaForm();
  $('#btn-export').onclick = (e) => { e.preventDefault(); window.location = '/api/export?' + filterQS({ page: '' }); };
  wargaShell(false);
  loadWarga(false);
}

function renderSampah() {
  state.f.status = '';
  wargaShell(true);
  loadWarga(true);
}

async function loadWarga(trash) {
  const area = $('#table-area');
  const [list, stats] = await Promise.all([
    api('/warga?' + filterQS({ trash: trash ? 1 : '', limit: 15 })),
    trash ? null : api('/stats'),
  ]);

  if (!trash && stats) {
    const cnt = Object.fromEntries(stats.byStatus.map((r) => [r.status, r.c]));
    $('#chips').innerHTML =
      `<button class="chip ${!state.f.status ? 'active' : ''}" data-s="">Semua<b>${stats.total}</b></button>` +
      STATUS.map((s) => `<button class="chip ${state.f.status === s.key ? 'active' : ''}" data-s="${s.key}" title="${esc(s.hint)}">${esc(s.label)}<b>${cnt[s.key] || 0}</b></button>`).join('');
    $$('.chip').forEach((b) => (b.onclick = () => { state.f.status = b.dataset.s; state.f.page = 1; loadWarga(false); }));
  } else if (trash) {
    $('#chips').innerHTML = '<p class="muted tiny">Data yang dihapus disimpan di sini. Pulihkan jika terhapus tidak sengaja, atau hapus permanen.</p>';
  }

  if (!list.rows.length) {
    area.innerHTML = `<div class="empty card"><big>${trash ? '♻' : '☰'}</big>${trash ? 'Data backup kosong.' : 'Belum ada data yang cocok. Klik “Tambah Data” untuk memulai.'}</div>`;
    return;
  }
  const pages = Math.ceil(list.total / list.limit);
  area.innerHTML = `
    <div class="wlist">${list.rows.map((r) => {
      const jkUmur = [r.jk, r.umur != null ? r.umur + ' th' : ''].filter(Boolean).join(' · ') || '-';
      return `
      <article class="wcard" data-id="${r.id}" role="button" tabindex="0" aria-label="Lihat detail ${esc(r.nama)}" title="Klik untuk lihat detail">
        <div class="w-main">
          <div class="w-name">${esc(r.nama)}</div>
          <div class="w-meta">
            <span class="w-pill ${r.jk === 'L' || r.jk === 'P' ? r.jk : ''}">${esc(jkUmur)}</span>
            <span class="w-desa${r.dusun_nama ? ' has-dusun' : ''}">${esc(r.desa || '-')}</span>${r.dusun_nama ? `<span class="w-dusun">${esc(r.dusun_nama)}</span>` : ''}
            <span class="w-status">${badge(r.status)}</span>
          </div>
        </div>
        <div class="w-shortcuts">
          ${trash
            ? `<button type="button" class="btn-action btn-restore" data-restore="${r.id}" aria-label="Pulihkan ${esc(r.nama)}" title="Pulihkan" onclick="event.stopPropagation()">${RESTORE_ICON}</button>
               <button type="button" class="btn-action btn-del" data-perm="${r.id}" data-nama="${esc(r.nama)}" aria-label="Hapus permanen" title="Hapus permanen" onclick="event.stopPropagation()">${TRASH_ICON}</button>`
            : `${waShortcut(r)}
               <button type="button" class="btn-action btn-del" data-del="${r.id}" data-nama="${esc(r.nama)}" aria-label="Hapus ${esc(r.nama)}" title="Hapus" onclick="event.stopPropagation()">${TRASH_ICON}</button>`}
        </div>
      </article>`;
    }).join('')}</div>
    <div class="pager"><span>${list.total} data · halaman ${list.page} dari ${pages}</span>
      <span class="pg"><button type="button" class="btn btn-sm" id="pg-prev" ${list.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button><button type="button" class="btn btn-sm" id="pg-next" ${list.page >= pages ? 'disabled' : ''}>Berikutnya ›</button></span></div>`;

  const byId = Object.fromEntries(list.rows.map((r) => [r.id, r]));
  $('#pg-prev').onclick = () => { state.f.page--; loadWarga(trash); };
  $('#pg-next').onclick = () => { state.f.page++; loadWarga(trash); };

  // Klik kartu untuk membuka detail data (on click)
  $$('.wcard', area).forEach((c) => {
    const r = byId[c.dataset.id];
    if (!r) return;
    c.onclick = (e) => {
      if (e.target.closest('.btn-action')) return;
      wargaDetail(r, trash);
    };
    c.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('.btn-action')) return;
        e.preventDefault();
        wargaDetail(r, trash);
      }
    };
  });

  $$('[data-del]', area).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    if (!(await confirmBox('Hapus data?', `Pindahkan <b>${b.dataset.nama}</b> ke Backup? Admin masih bisa memulihkannya.`, 'Ya, hapus'))) return;
    try { await api('/warga/' + b.dataset.del, { method: 'DELETE' }); toast('Data dipindahkan ke Backup'); loadWarga(false); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-restore]', area).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    try { await api(`/warga/${b.dataset.restore}/restore`, { method: 'POST' }); toast('Data dipulihkan'); loadWarga(true); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-perm]', area).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    if (!(await confirmBox('Hapus permanen?', `Data <b>${b.dataset.nama}</b> akan dihapus selamanya dan tidak bisa dipulihkan.`, 'Hapus permanen'))) return;
    try { await api(`/warga/${b.dataset.perm}/permanent`, { method: 'DELETE' }); toast('Data dihapus permanen'); loadWarga(true); } catch (e) { toast(e.message, true); }
  }));
}

function wargaDetail(r, isTrash = false) {
  const row = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">-</span>'}</dd>`;
  const hpDisplay = r.hp
    ? `${esc(r.hp)}${waLink(r.hp) ? ` <a class="link-btn" href="${esc(waLink(r.hp))}" target="_blank" rel="noopener noreferrer" style="color:#22c55e;margin-left:8px;font-weight:600">Chat WA ↗</a>` : ''}`
    : '';

  openModal('Detail Warga', `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px"><div class="avatar" style="width:52px;height:52px;font-size:22px">${esc(r.nama[0])}</div>
      <div><h3 style="font-size:20px">${esc(r.nama)}</h3>${badge(r.status)}</div></div>
    <dl class="kv">
      ${row('NIK', r.nik)}${row('Jenis kelamin', r.jk === 'L' ? 'Laki-laki' : r.jk === 'P' ? 'Perempuan' : '')}
      ${row('Tempat, tgl lahir', [r.tempat_lahir, r.tgl_lahir && fmtDate(r.tgl_lahir)].filter(Boolean).join(', '))}
      ${row('Umur', r.umur != null ? r.umur + ' tahun' : '')}${row('Status kawin', r.status_kawin)}${row('Pekerjaan', r.pekerjaan)}
      ${row('Desa', r.desa)}${row('Dusun', r.dusun_nama)}${row('RT / RW', `${r.rt || '-'} / ${r.rw || '-'}`)}${r.alamat ? row('Alamat', r.alamat) : ''}${row('No. HP', hpDisplay)}
      ${String(r.status || '').includes('STRUKTURAL') ? row('Jabatan', r.jabatan) + row('Tingkat', r.tingkat) + row('No. KTA', r.no_kta) : ''}
      ${row('Catatan', r.catatan)}${row('Dibuat', fmtDate(r.created_at))}${row('Diubah', fmtDate(r.updated_at))}
    </dl>
    <div class="modal-foot">
      <button type="button" class="btn" onclick="closeModal()">Tutup</button>
      ${isTrash
        ? `<button type="button" class="btn btn-primary" id="detail-btn-restore">Pulihkan Data</button>`
        : `<button type="button" class="btn btn-primary" id="detail-btn-edit">${EDIT_ICON}<span>Ubah Data</span></button>`}
    </div>`);

  const editBtn = $('#detail-btn-edit');
  if (editBtn) {
    editBtn.onclick = () => {
      closeModal();
      wargaForm(r);
    };
  }
  const restoreBtn = $('#detail-btn-restore');
  if (restoreBtn) {
    restoreBtn.onclick = async () => {
      try {
        await api(`/warga/${r.id}/restore`, { method: 'POST' });
        closeModal();
        toast('Data dipulihkan');
        loadWarga(true);
      } catch (e) {
        toast(e.message, true);
      }
    };
  }
}

function wargaForm(r = null) {
  const v = (k) => esc(r?.[k] ?? '');
  const admin = state.me?.role === 'admin';
  const cur = (r?.status ? String(r.status).split(',').map((s) => s.trim()).filter(Boolean) : ['NETRAL']);
  openModal(r ? 'Ubah Data' : 'Tambah Data', `
    <form id="w-form" class="form-grid" novalidate>
      <div class="form-section">Identitas</div>
      <label class="field"><span>NIK (16 digit) *</span><input id="w-nik" inputmode="numeric" maxlength="16" value="${v('nik')}" required><small class="hint" id="nik-hint"></small></label>
      <label class="field"><span>Nama lengkap *</span><input id="w-nama" value="${v('nama')}" required></label>
      <label class="field"><span>Jenis kelamin</span><select id="w-jk"><option value="">-</option><option value="L" ${r?.jk === 'L' ? 'selected' : ''}>Laki-laki</option><option value="P" ${r?.jk === 'P' ? 'selected' : ''}>Perempuan</option></select></label>
      <label class="field"><span>Status perkawinan</span><select id="w-kawin"><option value="">-</option>${KAWIN.map((k) => `<option ${r?.status_kawin === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label class="field"><span>Tempat lahir</span><input id="w-tempat" value="${v('tempat_lahir')}"></label>
      <label class="field"><span>Tanggal lahir</span><input id="w-tgl" type="date" value="${v('tgl_lahir')}"></label>
      <label class="field"><span>Pekerjaan</span><input id="w-kerja" value="${v('pekerjaan')}"></label>
      <label class="field"><span>No. HP / WhatsApp</span><input id="w-hp" inputmode="tel" value="${v('hp')}"></label>

      <div class="form-section">Alamat</div>
      <label class="field"><span>Desa *</span><select id="w-desa" ${admin ? '' : 'disabled'}>${admin ? '<option value="">Pilih desa…</option>' : ''}${state.desa.map((d) => `<option value="${d.id}" ${(r?.desa_id ?? state.me?.desa_id) === d.id ? 'selected' : ''}>${esc(d.nama)}</option>`).join('')}</select></label>
      <label class="field"><span>Dusun <button type="button" class="link-btn" id="dusun-add-toggle">＋ Dusun baru</button></span><select id="w-dusun"></select></label>
      <div class="field full hidden" id="dusun-new"><span>Tambah dusun baru di desa terpilih</span>
        <div class="inline-row"><input id="dusun-new-nama" placeholder="Nama dusun"><button type="button" class="btn" id="dusun-new-save">Simpan dusun</button></div></div>
      <label class="field"><span>RT</span><input id="w-rt" inputmode="numeric" maxlength="3" value="${v('rt')}"></label>
      <label class="field"><span>RW</span><input id="w-rw" inputmode="numeric" maxlength="3" value="${v('rw')}"></label>

      <div class="form-section">Kepartaian</div>
      <div class="field full"><span>Status * <small class="muted" style="font-weight:normal">(Bisa pilih lebih dari satu)</small></span>
        <div class="status-picker" role="group" aria-label="Status">
          ${STATUS.map((s) => `<label style="--c:${STATUS_COLOR[s.key]}"><input type="checkbox" name="status" value="${s.key}" ${cur.includes(s.key) ? 'checked' : ''}><span class="opt">${esc(s.label)}</span></label>`).join('')}
        </div>
        <small class="hint" id="status-hint"></small>
      </div>
      <div id="struktural-box" class="form-grid full" style="padding:0;display:contents">
        <label class="field st"><span>Jabatan</span><input id="w-jabatan" placeholder="mis. Ketua Ranting" value="${v('jabatan')}"></label>
        <label class="field st"><span>Tingkat kepengurusan</span><select id="w-tingkat"><option value="">-</option>${TINGKAT.map((t) => `<option ${r?.tingkat === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field st"><span>No. KTA</span><input id="w-kta" value="${v('no_kta')}"></label>
      </div>
      <label class="field full"><span>Catatan</span><textarea id="w-catatan">${v('catatan')}</textarea></label>
      <p class="form-error full" id="w-err"></p>
      <div class="modal-foot full"><button type="button" class="btn" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="w-save">${r ? 'Simpan Perubahan' : 'Simpan'}</button></div>
    </form>`);

  const sync = (e) => {
    if (e && e.target) {
      if (e.target.value === 'NETRAL' && e.target.checked) {
        $$('input[name=status]').forEach((i) => {
          if (i.value !== 'NETRAL') i.checked = false;
        });
      } else if (e.target.value !== 'NETRAL' && e.target.checked) {
        const netral = $('input[name=status][value="NETRAL"]');
        if (netral) netral.checked = false;
      }
    }
    const current = $$('input[name=status]:checked').map((i) => i.value);
    if (e && !current.length) {
      const netral = $('input[name=status][value="NETRAL"]');
      if (netral) netral.checked = true;
    }
    const selected = $$('input[name=status]:checked').map((i) => i.value);
    const hasStruktural = selected.includes('STRUKTURAL');
    $$('.st').forEach((el) => el.classList.toggle('hidden', !hasStruktural));
    const hints = selected
      .map((k) => STATUS_MAP[k]?.hint ? `${STATUS_MAP[k].label}: ${STATUS_MAP[k].hint}` : '')
      .filter(Boolean);
    $('#status-hint').textContent = hints.length ? `(${hints.join(' · ')})` : '';
  };
  $$('input[name=status]').forEach((i) => i.addEventListener('change', sync));
  sync();

  // Desa -> Dusun bertingkat
  const fillDusun = (sel) => {
    const d = $('#w-desa').value;
    $('#w-dusun').innerHTML = dusunOpts(d, sel, d ? '— Pilih dusun —' : '— Pilih desa dulu —');
  };
  fillDusun(r?.dusun_id);
  $('#w-desa').addEventListener('change', () => fillDusun(''));
  $('#dusun-add-toggle').onclick = () => {
    if (!$('#w-desa').value) return toast('Pilih desa terlebih dahulu', true);
    $('#dusun-new').classList.toggle('hidden');
    $('#dusun-new-nama').focus();
  };
  const saveDusun = async () => {
    const nama = $('#dusun-new-nama').value.trim();
    if (!nama) return;
    try {
      const res = await api('/dusun', { method: 'POST', body: { desa_id: $('#w-desa').value, nama } });
      state.dusun = await api('/dusun');
      fillDusun(res.id);
      $('#dusun-new-nama').value = '';
      $('#dusun-new').classList.add('hidden');
      toast('Dusun ditambahkan');
    } catch (err) { $('#w-err').textContent = err.message; }
  };
  $('#dusun-new-save').onclick = saveDusun;
  $('#dusun-new-nama').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveDusun(); } });

  $('#w-nik').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    const n = e.target.value.length, h = $('#nik-hint');
    h.className = 'hint ' + (n === 16 ? 'ok' : n ? 'bad' : '');
    h.textContent = n ? (n === 16 ? '✓ 16 digit' : `${n}/16 digit`) : '';
  });
  $('#w-nik').dispatchEvent(new Event('input'));

  $('#w-form').onsubmit = async (e) => {
    e.preventDefault();
    const selStatus = $$('input[name=status]:checked').map((i) => i.value);
    const body = {
      nik: $('#w-nik').value, nama: $('#w-nama').value, jk: $('#w-jk').value, status_kawin: $('#w-kawin').value,
      tempat_lahir: $('#w-tempat').value, tgl_lahir: $('#w-tgl').value, pekerjaan: $('#w-kerja').value, hp: $('#w-hp').value,
      desa_id: $('#w-desa').value, dusun_id: $('#w-dusun').value, rt: $('#w-rt').value, rw: $('#w-rw').value, alamat: r?.alamat || '',
      status: selStatus.length ? selStatus.join(',') : 'NETRAL', catatan: $('#w-catatan').value,
      jabatan: $('#w-jabatan').value, tingkat: $('#w-tingkat').value, no_kta: $('#w-kta').value,
    };
    if (!selStatus.includes('STRUKTURAL')) { body.jabatan = ''; body.tingkat = ''; body.no_kta = ''; }
    $('#w-save').disabled = true; $('#w-err').textContent = '';
    try {
      await api(r ? '/warga/' + r.id : '/warga', { method: r ? 'PUT' : 'POST', body });
      closeModal(); toast(r ? 'Data diperbarui' : 'Data ditambahkan');
      state.view === 'warga' ? loadWarga(false) : go(state.view);
    } catch (err) { $('#w-err').textContent = err.message; $('#w-save').disabled = false; }
  };
}

/* ================= Pengguna, Wilayah & Status ================= */
async function renderPengguna() {
  $('#top-actions').innerHTML = '<button class="btn btn-primary" id="btn-add-user"><span>＋</span><span class="lbl">Tambah Pengguna</span></button>';
  $('#btn-add-user').onclick = () => userForm();
  const [users, desa, dusun, statusList] = await Promise.all([
    api('/users').catch(() => []),
    api('/desa').catch(() => []),
    api('/dusun').catch(() => []),
    api('/status').catch(() => STATUS),
  ]);
  state.desa = desa || []; state.dusun = dusun || [];
  if (statusList) setStatusList(statusList);
  const byId = Object.fromEntries((users || []).map((u) => [u.id, u]));
  const stById = Object.fromEntries((statusList || []).map((s) => [s.id, s]));

  $('#content').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Wilayah</th><th>Akun</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td data-label="Nama"><div class="name">${esc(u.nama)}</div></td>
        <td data-label="Username" class="mono">${esc(u.username)}</td>
        <td data-label="Peran"><span class="badge role">${u.role === 'admin' ? 'Admin' : 'Operator'}</span></td>
        <td data-label="Wilayah">${esc(u.desa || 'Semua desa')}</td>
        <td data-label="Akun">${u.aktif ? '<span class="badge NETRAL" style="--c:#4ade80">Aktif</span>' : '<span class="badge off">Nonaktif</span>'}</td>
        <td class="actions"><button class="btn btn-sm" data-uedit="${u.id}">Ubah</button></td></tr>`).join('')}</tbody></table></div>

    <div class="card" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="font-size:16px;margin-bottom:2px">Status Kepartaian</h3>
          <p class="muted tiny">Kelola kategori/status warga, ubah nama (mis. ADS menjadi ADSE), petunjuk, warna badge, atau tambah status baru.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-status"><span>＋</span> Tambah Status</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Status &amp; Badge</th><th>Kode</th><th>Petunjuk / Keterangan</th><th>Warga Terdata</th><th></th></tr></thead>
        <tbody>${statusList.map((st) => `<tr>
          <td data-label="Status"><span class="badge" style="--c:${esc(st.color)}">${esc(st.label)}</span></td>
          <td data-label="Kode" class="mono tiny muted">${esc(st.key)}</td>
          <td data-label="Petunjuk" class="muted tiny">${esc(st.hint || '-')}</td>
          <td data-label="Warga Terdata"><span><b>${st.jumlah_warga || 0}</b> warga</span></td>
          <td class="actions">
            <button class="btn btn-sm" data-stedit="${st.id}">Ubah</button>
            ${st.is_system ? '' : `<button class="btn btn-sm btn-danger" data-stdel="${st.id}">Hapus</button>`}
          </td></tr>`).join('')}</tbody></table></div>
    </div>

    <div class="card" style="margin-top:18px"><h3>Wilayah — Desa &amp; Dusun</h3>
      <div class="wilayah">${desa.map((d) => {
        const ds = dusun.filter((x) => x.desa_id === d.id);
        return `<div class="wil-desa">
          <div class="wil-head"><b>${esc(d.nama)}</b><span class="muted tiny">${ds.length} dusun</span></div>
          <div class="chips">${ds.length ? ds.map((x) => `<span class="chip active dusun-chip">${esc(x.nama)}<b>${x.jumlah}</b>
            <button class="chip-x" data-dren="${x.id}" title="Ubah nama" aria-label="Ubah nama ${esc(x.nama)}">✎</button><button class="chip-x" data-ddel="${x.id}" title="Hapus" aria-label="Hapus ${esc(x.nama)}">✕</button></span>`).join('') : '<span class="muted tiny">Belum ada dusun</span>'}</div>
          <form class="dusun-form inline-row" data-desa="${d.id}"><input placeholder="Tambah dusun di ${esc(d.nama)}" required><button class="btn btn-sm">Tambah</button></form>
        </div>`;
      }).join('')}</div>
      <form id="desa-form" class="inline-row" style="max-width:420px;margin-top:6px"><input id="desa-nama" placeholder="Tambah desa/kelurahan baru" required><button class="btn">Tambah desa</button></form>
    </div>`;

  $$('[data-uedit]').forEach((b) => (b.onclick = () => userForm(byId[b.dataset.uedit])));

  // --- Status Kepartaian ---
  $('#btn-add-status').onclick = () => statusForm();
  $$('[data-stedit]').forEach((b) => (b.onclick = () => statusForm(stById[b.dataset.stedit])));
  $$('[data-stdel]').forEach((b) => (b.onclick = async () => {
    const st = stById[b.dataset.stdel];
    if (!(await confirmBox('Hapus status?', `Hapus status <b>${esc(st.label)}</b> (${esc(st.key)})? Pastikan tidak ada data warga yang menggunakan status ini.`, 'Ya, hapus'))) return;
    try {
      await api('/status/' + st.id, { method: 'DELETE' });
      toast('Status berhasil dihapus');
      renderPengguna();
    } catch (er) { toast(er.message, true); }
  }));

  // --- Dusun ---
  const dById = Object.fromEntries(dusun.map((x) => [x.id, x]));
  $$('.dusun-form').forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/dusun', { method: 'POST', body: { desa_id: f.dataset.desa, nama: $('input', f).value } });
      toast('Dusun ditambahkan'); renderPengguna();
    } catch (er) { toast(er.message, true); }
  }));
  $$('[data-dren]').forEach((b) => (b.onclick = () => {
    const x = dById[b.dataset.dren];
    openModal('Ubah Nama Dusun', `<form id="dren-form"><label class="field"><span>Desa ${esc(x.desa)}</span><input id="dren-nama" value="${esc(x.nama)}" required></label>
      <p class="form-error" id="dren-err"></p><div class="modal-foot"><button type="button" class="btn" onclick="closeModal()">Batal</button><button class="btn btn-primary">Simpan</button></div></form>`, true);
    $('#dren-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/dusun/' + x.id, { method: 'PUT', body: { nama: $('#dren-nama').value } }); closeModal(); toast('Nama dusun diubah'); renderPengguna(); } catch (er) { $('#dren-err').textContent = er.message; }
    };
  }));
  $$('[data-ddel]').forEach((b) => (b.onclick = async () => {
    const x = dById[b.dataset.ddel];
    if (!(await confirmBox('Hapus dusun?', `Hapus dusun <b>${esc(x.nama)}</b> dari desa ${esc(x.desa)}? Hanya bisa jika tidak dipakai data warga.`, 'Ya, hapus'))) return;
    try { await api('/dusun/' + x.id, { method: 'DELETE' }); toast('Dusun dihapus'); renderPengguna(); } catch (er) { toast(er.message, true); }
  }));
  $('#desa-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/desa', { method: 'POST', body: { nama: $('#desa-nama').value } }); toast('Desa ditambahkan'); renderPengguna(); } catch (er) { toast(er.message, true); }
  };
}

function userForm(u = null) {
  openModal(u ? 'Ubah Pengguna' : 'Tambah Pengguna', `
    <form id="u-form" class="form-grid">
      <label class="field"><span>Nama *</span><input id="u-nama" value="${esc(u?.nama || '')}" required></label>
      <label class="field"><span>Username *</span><input id="u-user" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''} autocomplete="off" required></label>
      <label class="field"><span>Peran</span><select id="u-role"><option value="operator" ${u?.role !== 'admin' ? 'selected' : ''}>Operator (per desa)</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin (semua akses)</option></select></label>
      <label class="field" id="u-desa-wrap"><span>Desa yang dikelola</span><select id="u-desa">${state.desa.map((d) => `<option value="${d.id}" ${u?.desa_id === d.id ? 'selected' : ''}>${esc(d.nama)}</option>`).join('')}</select></label>
      <label class="field"><span>${u ? 'Reset password (opsional)' : 'Password * (min. 8)'}</span><input id="u-pw" type="password" autocomplete="new-password" ${u ? '' : 'required'}></label>
      ${u ? `<label class="field"><span>Status akun</span><select id="u-aktif"><option value="1" ${u.aktif ? 'selected' : ''}>Aktif</option><option value="0" ${!u.aktif ? 'selected' : ''}>Nonaktif</option></select></label>` : ''}
      <p class="form-error full" id="u-err"></p>
      <div class="modal-foot full"><button type="button" class="btn" onclick="closeModal()">Batal</button><button class="btn btn-primary">Simpan</button></div>
    </form>`, true);
  const sync = () => $('#u-desa-wrap').classList.toggle('hidden', $('#u-role').value === 'admin');
  $('#u-role').onchange = sync; sync();
  $('#u-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      nama: $('#u-nama').value, username: $('#u-user').value, role: $('#u-role').value,
      desa_id: $('#u-desa').value, password: $('#u-pw').value, aktif: u ? +$('#u-aktif').value : 1,
    };
    try {
      await api(u ? '/users/' + u.id : '/users', { method: u ? 'PUT' : 'POST', body });
      closeModal(); toast('Pengguna disimpan'); renderPengguna();
    } catch (err) { $('#u-err').textContent = err.message; }
  };
}

function statusForm(st = null) {
  const PRESET_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#38bdf8', '#6366f1', '#a78bfa', '#ec4899', '#94a3b8'];
  const curColor = st?.color || '#ef4444';
  openModal(st ? 'Ubah Status Kepartaian' : 'Tambah Status Kepartaian', `
    <form id="st-form" class="form-grid">
      <label class="field"><span>Nama Status *</span><input id="st-label" value="${esc(st?.label || '')}" placeholder="mis. ADSE, Relawan, dsb" required></label>
      <label class="field"><span>Kode Status ${st?.is_system ? '(Sistem, tetap)' : '(Otomatis jika kosong)'}</span><input id="st-key" value="${esc(st?.key || '')}" placeholder="mis. ADSE" ${st?.is_system ? 'disabled' : ''}></label>
      <label class="field full"><span>Petunjuk / Keterangan Singkat</span><input id="st-hint" value="${esc(st?.hint || '')}" placeholder="mis. Keterangan singkat petunjuk status ini"></label>
      <div class="field full">
        <span style="display:block;margin-bottom:6px">Warna Badge</span>
        <div class="inline-row" style="gap:12px;align-items:center;flex-wrap:wrap">
          <input id="st-color" type="color" value="${curColor.startsWith('#') ? curColor : '#ef4444'}" style="width:44px;height:36px;padding:2px;cursor:pointer;border-radius:8px;background:none;border:1px solid var(--line)">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${PRESET_COLORS.map((c) => `<button type="button" class="color-dot" data-col="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid ${c.toLowerCase() === curColor.toLowerCase() ? '#fff' : 'transparent'};cursor:pointer"></button>`).join('')}
          </div>
          <span class="badge" id="st-preview" style="--c:${curColor};margin-left:auto;font-size:13px">${esc(st?.label || 'Contoh Badge')}</span>
        </div>
      </div>
      <p class="form-error full" id="st-err"></p>
      <div class="modal-foot full"><button type="button" class="btn" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="st-save">Simpan Status</button></div>
    </form>`, true);

  const updatePreview = () => {
    const col = $('#st-color').value;
    const lbl = $('#st-label').value.trim() || 'Contoh Badge';
    const prev = $('#st-preview');
    if (prev) {
      prev.textContent = lbl;
      prev.style.setProperty('--c', col);
    }
  };
  $('#st-color').addEventListener('input', updatePreview);
  $('#st-label').addEventListener('input', updatePreview);
  $$('.color-dot').forEach((btn) => (btn.onclick = () => {
    $('#st-color').value = btn.dataset.col;
    $$('.color-dot').forEach((b) => (b.style.borderColor = b.dataset.col === btn.dataset.col ? '#fff' : 'transparent'));
    updatePreview();
  }));

  $('#st-form').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      label: $('#st-label').value.trim(),
      key: $('#st-key') && !$('#st-key').disabled ? $('#st-key').value.trim() : (st?.key || ''),
      hint: $('#st-hint').value.trim(),
      color: $('#st-color').value,
    };
    $('#st-save').disabled = true; $('#st-err').textContent = '';
    try {
      await api(st ? '/status/' + st.id : '/status', { method: st ? 'PUT' : 'POST', body });
      closeModal();
      toast(st ? 'Status berhasil diperbarui' : 'Status berhasil ditambahkan');
      const updated = await api('/status');
      setStatusList(updated);
      renderPengguna();
    } catch (err) {
      $('#st-err').textContent = err.message;
      $('#st-save').disabled = false;
    }
  };
}

/* ================= Riwayat ================= */
async function renderAudit() {
  const rows = await api('/audit');
  $('#content').innerHTML = `
    <p class="muted tiny" style="margin-bottom:12px">200 aktivitas terakhir.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Keterangan</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td data-label="Waktu" class="mono">${esc(r.at)}</td>
        <td data-label="Pengguna">${esc(r.username || '-')}</td>
        <td data-label="Aksi"><span class="badge role">${esc(r.aksi)}</span></td>
        <td data-label="Keterangan" style="word-break:break-word">${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

boot();

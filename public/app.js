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
  dashboard: 'Dashboard', warga: 'Database', 'export-import': 'Export & Import', sampah: 'Backup',
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
  ({ dashboard: renderDashboard, warga: renderWarga, 'export-import': renderExportImport, sampah: renderSampah, pengguna: renderPengguna, audit: renderAudit })[view]();
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
function formatRt(v) {
  if (!v) return '';
  const s = String(v).trim();
  return /^RT/i.test(s) ? s : `RT ${s}`;
}
function formatRw(v) {
  if (!v) return '';
  const s = String(v).trim();
  return /^RW/i.test(s) ? s : `RW ${s}`;
}

const WA_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.6-1.2A9 9 0 1012 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path fill="currentColor" transform="translate(5.8 5.6) scale(.52)" d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>';
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
    <button class="btn btn-primary" id="btn-add" type="button" title="Tambah Data" aria-label="Tambah Data"><span aria-hidden="true">＋</span><span class="lbl">Tambah Data</span></button>`;
  $('#btn-add').onclick = () => wargaForm();
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
      const locParts = [r.desa || '', r.dusun_nama || '', formatRt(r.rt), formatRw(r.rw)].filter(Boolean);
      const locHtml = locParts.length ? locParts.map(esc).join('<span class="w-sep" aria-hidden="true">›</span>') : '-';
      return `
      <article class="wcard" data-id="${r.id}" role="button" tabindex="0" aria-label="Lihat detail ${esc(r.nama)}" title="Klik untuk lihat detail">
        <div class="w-row-top">
          <div class="w-name" title="${esc(r.nama)}">${esc(r.nama)}</div>
          <div class="w-status">${badge(r.status)}</div>
        </div>
        <div class="w-row-sub">
          <div class="w-meta">
            <span class="w-pill ${r.jk === 'L' || r.jk === 'P' ? r.jk : ''}">${esc(jkUmur)}</span>
            <span class="w-loc" title="${esc(locParts.join(' › '))}">${locHtml}</span>
          </div>
          <div class="w-shortcuts">
            ${trash
              ? `<button type="button" class="btn-action btn-restore" data-restore="${r.id}" aria-label="Pulihkan ${esc(r.nama)}" title="Pulihkan" onclick="event.stopPropagation()">${RESTORE_ICON}</button>
                 <button type="button" class="btn-action btn-del" data-perm="${r.id}" data-nama="${esc(r.nama)}" aria-label="Hapus permanen" title="Hapus permanen" onclick="event.stopPropagation()">${TRASH_ICON}</button>`
              : `${waShortcut(r)}
                 <button type="button" class="btn-action btn-del" data-del="${r.id}" data-nama="${esc(r.nama)}" aria-label="Hapus ${esc(r.nama)}" title="Hapus" onclick="event.stopPropagation()">${TRASH_ICON}</button>`}
          </div>
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

/* ================= EXPORT & IMPORT ================= */
const EXPORT_COLUMNS = [
  { key: 'nik', label: 'NIK (16 Digit)', default: true },
  { key: 'nama', label: 'Nama Lengkap', default: true },
  { key: 'jk', label: 'Jenis Kelamin (L/P)', default: true },
  { key: 'tempat_lahir', label: 'Tempat Lahir', default: false },
  { key: 'tgl_lahir', label: 'Tanggal Lahir', default: true },
  { key: 'umur', label: 'Umur', default: true },
  { key: 'status_kawin', label: 'Status Perkawinan', default: false },
  { key: 'pekerjaan', label: 'Pekerjaan', default: false },
  { key: 'desa', label: 'Desa', default: true },
  { key: 'dusun_nama', label: 'Dusun', default: true },
  { key: 'rt', label: 'RT', default: true },
  { key: 'rw', label: 'RW', default: true },
  { key: 'alamat', label: 'Alamat', default: true },
  { key: 'hp', label: 'No. HP / WA', default: true },
  { key: 'status', label: 'Status Kepartaian', default: true },
  { key: 'jabatan', label: 'Jabatan (Struktural)', default: false },
  { key: 'tingkat', label: 'Tingkat (Struktural)', default: false },
  { key: 'no_kta', label: 'No. KTA', default: false },
  { key: 'catatan', label: 'Catatan', default: false },
  { key: 'created_at', label: 'Tanggal Terdaftar', default: false },
];

let eiCurrentTab = 'export';
let eiFilter = {
  desa: '', dusun: '', status: '', jk: '', status_kawin: '',
  tingkat: '', rt: '', rw: '', umurMin: '', umurMax: '', q: ''
};
let eiSelectedCols = new Set(EXPORT_COLUMNS.filter((c) => c.default).map((c) => c.key));
let eiExportData = [];
let eiImportFileRows = [];
let eiImportFileName = '';
let eiImportFileSize = 0;
let eiUpdateExisting = false;

function renderExportImport() {
  const admin = state.me?.role === 'admin';
  if (!admin && state.me?.desa_id) {
    eiFilter.desa = String(state.me.desa_id);
  }

  const c = $('#content');
  c.innerHTML = `
    <div class="ei-wrap">
      <div class="ei-tabs" role="tablist">
        <button type="button" class="ei-tab-btn ${eiCurrentTab === 'export' ? 'active' : ''}" id="tab-btn-export" role="tab" aria-selected="${eiCurrentTab === 'export'}">
          <i>📤</i><span>Export Data</span>
        </button>
        <button type="button" class="ei-tab-btn ${eiCurrentTab === 'import' ? 'active' : ''}" id="tab-btn-import" role="tab" aria-selected="${eiCurrentTab === 'import'}">
          <i>📥</i><span>Import Data</span>
        </button>
      </div>

      <div id="ei-tab-content"></div>
    </div>`;

  $('#tab-btn-export').onclick = () => {
    eiCurrentTab = 'export';
    $('#tab-btn-export').classList.add('active');
    $('#tab-btn-import').classList.remove('active');
    renderExportTab();
  };

  $('#tab-btn-import').onclick = () => {
    eiCurrentTab = 'import';
    $('#tab-btn-import').classList.add('active');
    $('#tab-btn-export').classList.remove('active');
    renderImportTab();
  };

  if (eiCurrentTab === 'export') {
    renderExportTab();
  } else {
    renderImportTab();
  }
}

function getExportVal(r, key) {
  switch (key) {
    case 'nik': return r.nik ? String(r.nik) : '';
    case 'nama': return r.nama || '';
    case 'jk': return r.jk === 'L' ? 'Laki-laki (L)' : r.jk === 'P' ? 'Perempuan (P)' : (r.jk || '-');
    case 'tempat_lahir': return r.tempat_lahir || '-';
    case 'tgl_lahir': return r.tgl_lahir || '-';
    case 'umur': return r.umur != null ? String(r.umur) : '-';
    case 'status_kawin': return r.status_kawin || '-';
    case 'pekerjaan': return r.pekerjaan || '-';
    case 'desa': return r.desa || '-';
    case 'dusun_nama': return r.dusun_nama || r.dusun || '-';
    case 'rt': return r.rt ? String(r.rt).padStart(2, '0') : '-';
    case 'rw': return r.rw ? String(r.rw).padStart(2, '0') : '-';
    case 'alamat': return r.alamat || '-';
    case 'hp': return r.hp || '-';
    case 'status': {
      if (!r.status) return 'NETRAL';
      return String(r.status).split(',').map((k) => STATUS_MAP[k.trim()]?.label || k.trim()).join(', ');
    }
    case 'jabatan': return r.jabatan || '-';
    case 'tingkat': return r.tingkat || '-';
    case 'no_kta': return r.no_kta || '-';
    case 'catatan': return r.catatan || '-';
    case 'created_at': return r.created_at ? fmtDate(r.created_at) : '-';
    default: return r[key] || '-';
  }
}

async function fetchExportData() {
  const p = new URLSearchParams();
  Object.entries(eiFilter).forEach(([k, v]) => {
    if (v !== '' && v != null) p.set(k, v);
  });
  try {
    const res = await api('/export/data?' + p.toString());
    eiExportData = res.rows || [];
    updateExportCounterUI();
  } catch (err) {
    console.error('Gagal mengambil data export:', err);
    toast('Gagal memuat data export: ' + err.message, true);
  }
}

function updateExportCounterUI() {
  const total = eiExportData.length;
  const countEl = $('#ei-counter-num');
  if (countEl) countEl.textContent = total.toLocaleString('id-ID');
  const badgeEl = $('#ei-col-badge');
  if (badgeEl) badgeEl.textContent = `${eiSelectedCols.size} dari ${EXPORT_COLUMNS.length} kolom dipilih`;
}

function renderExportTab() {
  const admin = state.me?.role === 'admin';
  const tc = $('#ei-tab-content');
  if (!tc) return;

  tc.innerHTML = `
    <!-- KARTU 1: FILTER DATA -->
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">1</span>
          <div>
            <h3>Tentukan Filter Data (Kriteria Ekspor)</h3>
            <p class="ei-card-subtitle">Pilih kriteria untuk menyaring data warga yang ingin dimasukkan ke dalam berkas.</p>
          </div>
        </div>
        <button type="button" class="btn btn-sm" id="btn-reset-filter">Reset Filter</button>
      </div>

      <div class="ei-filter-grid">
        ${admin ? `
          <div class="ei-field">
            <label for="exp-desa">Desa</label>
            <select id="exp-desa">
              <option value="">Semua Desa</option>
              ${state.desa.map((d) => `<option value="${d.id}" ${+eiFilter.desa === d.id ? 'selected' : ''}>${esc(d.nama)}</option>`).join('')}
            </select>
          </div>` : `
          <div class="ei-field">
            <label>Desa</label>
            <input type="text" value="${esc(state.me?.desa || 'Desa Anda')}" disabled style="opacity:.8;background:var(--panel-strong)" />
          </div>`}

        <div class="ei-field">
          <label for="exp-dusun">Dusun</label>
          <select id="exp-dusun">
            ${dusunOpts(admin ? eiFilter.desa : (state.me?.desa_id || ''), eiFilter.dusun, 'Semua Dusun')}
          </select>
        </div>

        <div class="ei-field">
          <label for="exp-status">Status Kepartaian</label>
          <select id="exp-status">
            <option value="">Semua Status</option>
            ${STATUS.map((s) => `<option value="${s.key}" ${eiFilter.status === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </div>

        <div class="ei-field">
          <label for="exp-jk">Jenis Kelamin</label>
          <select id="exp-jk">
            <option value="">Semua (L &amp; P)</option>
            <option value="L" ${eiFilter.jk === 'L' ? 'selected' : ''}>Laki-laki (L)</option>
            <option value="P" ${eiFilter.jk === 'P' ? 'selected' : ''}>Perempuan (P)</option>
          </select>
        </div>

        <div class="ei-field">
          <label for="exp-kawin">Status Perkawinan</label>
          <select id="exp-kawin">
            <option value="">Semua Status Kawin</option>
            ${KAWIN.map((k) => `<option value="${k}" ${eiFilter.status_kawin === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
          </select>
        </div>

        <div class="ei-field">
          <label for="exp-tingkat">Tingkat (Struktural)</label>
          <select id="exp-tingkat">
            <option value="">Semua Tingkat</option>
            ${TINGKAT.map((t) => `<option value="${t}" ${eiFilter.tingkat === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select>
        </div>

        <div class="ei-field">
          <label for="exp-rt">RT</label>
          <input id="exp-rt" type="text" placeholder="Contoh: 01" value="${esc(eiFilter.rt)}" />
        </div>

        <div class="ei-field">
          <label for="exp-rw">RW</label>
          <input id="exp-rw" type="text" placeholder="Contoh: 02" value="${esc(eiFilter.rw)}" />
        </div>

        <div class="ei-field">
          <label for="exp-umin">Umur Minimal</label>
          <input id="exp-umin" type="number" min="0" max="120" placeholder="Min (contoh: 17)" value="${esc(eiFilter.umurMin)}" />
        </div>

        <div class="ei-field">
          <label for="exp-umax">Umur Maksimal</label>
          <input id="exp-umax" type="number" min="0" max="120" placeholder="Maks (contoh: 35)" value="${esc(eiFilter.umurMax)}" />
        </div>

        <div class="ei-field" style="grid-column: 1 / -1">
          <label for="exp-q">Pencarian Kata Kunci (Nama, NIK, No. HP, atau Alamat)</label>
          <input id="exp-q" type="search" placeholder="Ketik kata kunci pencarian..." value="${esc(eiFilter.q)}" />
        </div>
      </div>
    </section>

    <!-- KARTU 2: CHECKLIST PILIHAN KOLOM -->
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">2</span>
          <div>
            <h3>Pilih Kolom Data yang Ingin Diekspor (Checklist Manual)</h3>
            <p class="ei-card-subtitle">Centang kolom yang ingin disertakan. Anda bebas menentukan kolom mana pun.</p>
          </div>
        </div>
        <span class="badge role" id="ei-col-badge">${eiSelectedCols.size} dari ${EXPORT_COLUMNS.length} kolom dipilih</span>
      </div>

      <div class="ei-preset-bar">
        <span style="font-size:12.5px;color:var(--muted);font-weight:600">Pilihan Cepat:</span>
        <button type="button" class="btn btn-sm" id="btn-col-all">Pilih Semua</button>
        <button type="button" class="btn btn-sm" id="btn-col-standard">Preset Standar</button>
        <button type="button" class="btn btn-sm" id="btn-col-struktural">Preset Struktural</button>
        <button type="button" class="btn btn-sm" id="btn-col-contact">Preset Kontak &amp; Wilayah</button>
        <button type="button" class="btn btn-sm btn-danger" id="btn-col-none">Batal Semua</button>
      </div>

      <div class="ei-cols-grid" id="ei-cols-container">
        ${EXPORT_COLUMNS.map((c) => {
          const checked = eiSelectedCols.has(c.key);
          return `
            <label class="ei-col-label ${checked ? 'checked' : ''}" data-key="${c.key}">
              <input type="checkbox" value="${c.key}" ${checked ? 'checked' : ''} />
              <span title="${esc(c.label)}">${esc(c.label)}</span>
            </label>`;
        }).join('')}
      </div>
    </section>

    <!-- KARTU 3: FORMAT DAN DOWNLOAD -->
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">3</span>
          <div>
            <h3>Pilih Format &amp; Unduh Berkas</h3>
            <p class="ei-card-subtitle">Klik format berkas yang Anda butuhkan di bawah ini.</p>
          </div>
        </div>
      </div>

      <!-- Live Counter Banner -->
      <div class="ei-counter-banner">
        <div class="ei-counter-info">
          <span class="icon">📊</span>
          <div>
            <strong>Ditemukan <b id="ei-counter-num">-</b> data warga</strong>
            <div><small>Sesuai dengan kriteria filter yang Anda tentukan di atas.</small></div>
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--muted)">Ukuran Kertas PDF:</label>
          <select id="pdf-paper" style="width:auto;padding:6px 10px;font-size:13px">
            <option value="a4" selected>A4</option>
            <option value="folio">F4 / Folio</option>
          </select>
          <label style="font-size:12px;color:var(--muted)">Orientasi PDF:</label>
          <select id="pdf-orient" style="width:auto;padding:6px 10px;font-size:13px">
            <option value="auto" selected>Otomatis (Sesuai Kolom)</option>
            <option value="landscape">Lanskap (Melebar)</option>
            <option value="portrait">Potret (Tegak)</option>
          </select>
        </div>
      </div>

      <!-- Action Buttons Grid -->
      <div class="ei-actions-grid">
        <button type="button" class="ei-dl-card excel" id="btn-export-excel">
          <div class="ei-dl-card-head">
            <span class="dl-icon">📗</span>
            <span class="ei-dl-badge">Rekomendasi</span>
          </div>
          <strong>Export ke Excel (.xlsx)</strong>
          <small>Berkas Microsoft Excel asli. Kolom tersusun rapi, teks NIK tidak terpotong, dan siap dianalisis.</small>
        </button>

        <button type="button" class="ei-dl-card csv" id="btn-export-csv">
          <div class="ei-dl-card-head">
            <span class="dl-icon">📄</span>
            <span class="ei-dl-badge">Universal</span>
          </div>
          <strong>Export ke CSV (.csv)</strong>
          <small>Format teks berstandar UTF-8 dengan pemisah koma. Kompatibel dengan semua sistem database.</small>
        </button>

        <button type="button" class="ei-dl-card pdf" id="btn-export-pdf">
          <div class="ei-dl-card-head">
            <span class="dl-icon">📕</span>
            <span class="ei-dl-badge">Siap Cetak</span>
          </div>
          <strong>Export ke PDF (.pdf)</strong>
          <small>Dokumen siap cetak dengan kop resmi PAC PDI Perjuangan Bantarsari, tabel bergaris, dan nomor halaman.</small>
        </button>
      </div>
    </section>`;

  // Filter event listeners
  const onFilterChange = () => {
    if (admin && $('#exp-desa')) {
      eiFilter.desa = $('#exp-desa').value;
      const dSel = $('#exp-dusun');
      if (dSel) dSel.innerHTML = dusunOpts(eiFilter.desa, '', 'Semua Dusun');
      eiFilter.dusun = '';
    }
    if ($('#exp-dusun')) eiFilter.dusun = $('#exp-dusun').value;
    if ($('#exp-status')) eiFilter.status = $('#exp-status').value;
    if ($('#exp-jk')) eiFilter.jk = $('#exp-jk').value;
    if ($('#exp-kawin')) eiFilter.status_kawin = $('#exp-kawin').value;
    if ($('#exp-tingkat')) eiFilter.tingkat = $('#exp-tingkat').value;
    if ($('#exp-rt')) eiFilter.rt = $('#exp-rt').value.trim();
    if ($('#exp-rw')) eiFilter.rw = $('#exp-rw').value.trim();
    if ($('#exp-umin')) eiFilter.umurMin = $('#exp-umin').value.trim();
    if ($('#exp-umax')) eiFilter.umurMax = $('#exp-umax').value.trim();
    if ($('#exp-q')) eiFilter.q = $('#exp-q').value.trim();

    fetchExportData();
  };

  if ($('#exp-desa')) $('#exp-desa').onchange = onFilterChange;
  if ($('#exp-dusun')) $('#exp-dusun').onchange = onFilterChange;
  if ($('#exp-status')) $('#exp-status').onchange = onFilterChange;
  if ($('#exp-jk')) $('#exp-jk').onchange = onFilterChange;
  if ($('#exp-kawin')) $('#exp-kawin').onchange = onFilterChange;
  if ($('#exp-tingkat')) $('#exp-tingkat').onchange = onFilterChange;

  let searchTimeout = null;
  ['exp-rt', 'exp-rw', 'exp-umin', 'exp-umax', 'exp-q'].forEach((id) => {
    const el = $('#' + id);
    if (el) {
      el.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(onFilterChange, 250);
      };
    }
  });

  $('#btn-reset-filter').onclick = () => {
    eiFilter = {
      desa: admin ? '' : String(state.me?.desa_id || ''),
      dusun: '', status: '', jk: '', status_kawin: '',
      tingkat: '', rt: '', rw: '', umurMin: '', umurMax: '', q: ''
    };
    renderExportTab();
  };

  // Checklist Column event listeners
  const updateColsUI = () => {
    $$('#ei-cols-container .ei-col-label').forEach((lbl) => {
      const key = lbl.dataset.key;
      const chk = lbl.querySelector('input');
      const isChecked = eiSelectedCols.has(key);
      chk.checked = isChecked;
      lbl.classList.toggle('checked', isChecked);
    });
    updateExportCounterUI();
  };

  $$('#ei-cols-container .ei-col-label').forEach((lbl) => {
    const key = lbl.dataset.key;
    const chk = lbl.querySelector('input');
    chk.onchange = (e) => {
      if (chk.checked) eiSelectedCols.add(key);
      else eiSelectedCols.delete(key);
      lbl.classList.toggle('checked', chk.checked);
      updateExportCounterUI();
    };
  });

  $('#btn-col-all').onclick = () => {
    EXPORT_COLUMNS.forEach((c) => eiSelectedCols.add(c.key));
    updateColsUI();
  };
  $('#btn-col-none').onclick = () => {
    eiSelectedCols.clear();
    updateColsUI();
  };
  $('#btn-col-standard').onclick = () => {
    eiSelectedCols = new Set(['nik', 'nama', 'jk', 'tgl_lahir', 'umur', 'desa', 'dusun_nama', 'rt', 'rw', 'alamat', 'hp', 'status']);
    updateColsUI();
  };
  $('#btn-col-struktural').onclick = () => {
    eiSelectedCols = new Set(['nik', 'nama', 'jk', 'hp', 'desa', 'dusun_nama', 'rt', 'rw', 'status', 'jabatan', 'tingkat', 'no_kta']);
    updateColsUI();
  };
  $('#btn-col-contact').onclick = () => {
    eiSelectedCols = new Set(['nik', 'nama', 'jk', 'desa', 'dusun_nama', 'rt', 'rw', 'alamat', 'hp', 'status']);
    updateColsUI();
  };

  // Download Action Listeners
  $('#btn-export-excel').onclick = handleExportExcel;
  $('#btn-export-csv').onclick = handleExportCsv;
  $('#btn-export-pdf').onclick = handleExportPdf;

  // Initial data fetch
  fetchExportData();
}

const INDO_MONTHS = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
];

function getExportMeta() {
  const now = new Date();
  const bulan = INDO_MONTHS[now.getMonth()];
  const tahun = now.getFullYear();

  // 1. Status
  let statusKey = eiFilter.status || '';
  let statusLabel = statusKey ? (STATUS_MAP[statusKey]?.label || statusKey) : 'SEMUA STATUS';
  let statusSlug = (statusKey ? (STATUS_MAP[statusKey]?.label || statusKey) : 'SEMUA-STATUS')
    .toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // 2. Desa
  let desaName = '';
  const currentDesaId = eiFilter.desa || (state.me?.role === 'operator' && state.me?.desa_id ? String(state.me.desa_id) : '');
  if (currentDesaId) {
    const dObj = state.desa.find((d) => d.id === +currentDesaId);
    desaName = dObj?.nama || (state.me?.desa_id === +currentDesaId ? state.me.desa : '');
  }
  let desaSlug = desaName
    ? desaName.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : 'SEMUA-DESA';
  let desaLabel = desaName ? `DESA ${desaName.toUpperCase()}` : 'SEMUA DESA (KEC. BANTARSARI)';

  // 3. Dusun (jika dipilih)
  let dusunName = '';
  if (eiFilter.dusun) {
    const duObj = state.dusun.find((du) => du.id === +eiFilter.dusun);
    dusunName = duObj?.nama || '';
  }
  let dusunSlug = dusunName
    ? dusunName.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : '';
  let dusunLabel = dusunName ? `DUSUN ${dusunName.toUpperCase()}` : '';

  // Penamaan Berkas: STATUS_DESA_DUSUN_BULAN_TAHUN (jika dusun dipilih)
  //                  STATUS_DESA_BULAN_TAHUN (jika dusun tidak dipilih)
  const fnParts = [statusSlug, desaSlug];
  if (dusunSlug) fnParts.push(dusunSlug);
  fnParts.push(bulan, tahun);
  const fileNameBase = fnParts.join('_');

  // Wilayah untuk Kop Laporan
  let wilayahText = desaLabel;
  if (dusunLabel) {
    wilayahText += ` — ${dusunLabel}`;
  }

  const tglWaktu = now.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    statusLabel,
    statusSlug,
    desaName,
    desaLabel,
    dusunName,
    dusunLabel,
    wilayahText,
    bulan,
    tahun,
    fileNameBase,
    tglWaktu,
  };
}

function handleExportExcel() {
  if (!eiSelectedCols.size) {
    return toast('Pilih minimal 1 kolom checklist untuk diekspor!', true);
  }
  if (!eiExportData.length) {
    return toast('Tidak ada data warga yang cocok dengan filter untuk diekspor.', true);
  }
  if (typeof XLSX === 'undefined') {
    return toast('Pustaka Excel sedang dimuat, silakan coba sesaat lagi...', true);
  }

  const meta = getExportMeta();
  const activeCols = EXPORT_COLUMNS.filter((c) => eiSelectedCols.has(c.key));
  const headerRow = ['NO', ...activeCols.map((c) => c.label)];
  const dataRows = eiExportData.map((r, i) => [
    i + 1,
    ...activeCols.map((c) => getExportVal(r, c.key)),
  ]);

  // Kop Resmi & Judul Dokumen di Baris 1 - 3 Excel
  const kopPartsExcel = [
    'STATUS: ' + meta.statusLabel.toUpperCase(),
    'DESA: ' + (meta.desaName ? meta.desaName.toUpperCase() : 'SEMUA DESA'),
  ];
  if (meta.dusunName) kopPartsExcel.push('DUSUN: ' + meta.dusunName.toUpperCase());

  const titleRows = [
    ['PENGURUS ANAK CABANG PDI PERJUANGAN KECAMATAN BANTARSARI'],
    ['LAPORAN DATA KADER & PENGURUS'],
    [kopPartsExcel.join(' | ')],
    [`WAKTU EKSPOR: ${meta.tglWaktu} WIB | TOTAL DATA: ${eiExportData.length} ORANG`],
    [],
  ];

  const wsData = [...titleRows, headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set tipe string untuk NIK, HP, RT, RW agar format tidak berubah
  activeCols.forEach((c, colIdx) => {
    const tableColIdx = colIdx + 1; // offset kolom NO
    if (['nik', 'hp', 'rt', 'rw', 'no_kta'].includes(c.key)) {
      for (let r = 5; r <= wsData.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r: r - 1, c: tableColIdx });
        if (ws[cellRef]) ws[cellRef].t = 's';
      }
    }
  });

  // Hitung lebar kolom otomatis yang proporsional
  ws['!cols'] = headerRow.map((h, i) => {
    let maxLen = h.length;
    for (let j = 0; j < Math.min(dataRows.length, 60); j++) {
      const valStr = String(dataRows[j]?.[i] ?? '');
      if (valStr.length > maxLen) maxLen = valStr.length;
    }
    return { wch: Math.min(Math.max(maxLen + 3, i === 0 ? 6 : 10), 45) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Kader');
  const finalFileName = `${meta.fileNameBase}.xlsx`;
  XLSX.writeFile(wb, finalFileName);
  toast(`Berhasil mengunduh berkas Excel: ${finalFileName}`);
}

function handleExportCsv() {
  if (!eiSelectedCols.size) {
    return toast('Pilih minimal 1 kolom checklist untuk diekspor!', true);
  }
  if (!eiExportData.length) {
    return toast('Tidak ada data warga yang cocok dengan filter untuk diekspor.', true);
  }

  const meta = getExportMeta();
  const activeCols = EXPORT_COLUMNS.filter((c) => eiSelectedCols.has(c.key));
  const headers = ['NO', ...activeCols.map((c) => c.label)].map(csvCell).join(',');
  const lines = [headers];

  eiExportData.forEach((r, i) => {
    const rowCells = [
      i + 1,
      ...activeCols.map((c) => {
        const v = getExportVal(r, c.key);
        if (c.key === 'nik') return `="${r.nik || ''}"`;
        return csvCell(v);
      }),
    ];
    lines.push(rowCells.join(','));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const finalFileName = `${meta.fileNameBase}.csv`;
  a.download = finalFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Berhasil mengunduh berkas CSV: ${finalFileName}`);
}

function handleExportPdf() {
  if (!eiSelectedCols.size) {
    return toast('Pilih minimal 1 kolom checklist untuk diekspor!', true);
  }
  if (!eiExportData.length) {
    return toast('Tidak ada data warga yang cocok dengan filter untuk diekspor.', true);
  }
  if (!window.jspdf?.jsPDF) {
    return toast('Pustaka PDF sedang dimuat, silakan coba sesaat lagi...', true);
  }

  const { jsPDF } = window.jspdf;
  const activeCols = EXPORT_COLUMNS.filter((c) => eiSelectedCols.has(c.key));
  const paper = $('#pdf-paper')?.value || 'a4';
  let orient = $('#pdf-orient')?.value || 'auto';
  if (orient === 'auto') {
    orient = activeCols.length > 5 ? 'landscape' : 'portrait';
  }

  const doc = new jsPDF({
    orientation: orient,
    unit: 'mm',
    format: paper === 'folio' ? [215, 330] : 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const meta = getExportMeta();

  // --- KOP RESMI PDI PERJUANGAN BANTARSARI ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(193, 18, 31); // Merah PDI Perjuangan
  doc.text('PENGURUS ANAK CABANG PARTAI DEMOKRASI INDONESIA PERJUANGAN', pageWidth / 2, 12, { align: 'center' });

  doc.setFontSize(10.5);
  doc.text('(PAC PDI PERJUANGAN) KECAMATAN BANTARSARI', pageWidth / 2, 17.5, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('KABUPATEN CILACAP — PROVINSI JAWA TENGAH', pageWidth / 2, 22.5, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Sekretariat: Kandang Banteng, Kec. Bantarsari, Kab. Cilacap, Jawa Tengah 53281', pageWidth / 2, 27, { align: 'center' });

  // Garis kop ganda (merah tebal & aksen emas)
  doc.setDrawColor(193, 18, 31);
  doc.setLineWidth(0.8);
  doc.line(10, 29.5, pageWidth - 10, 29.5);
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.35);
  doc.line(10, 30.7, pageWidth - 10, 30.7);

  // --- KOTAK JUDUL LAPORAN (MEMUAT STATUS, DESA, DUSUN SECARA PRESISI) ---
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(10, 33, pageWidth - 20, 16.5, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(185, 28, 28);
  doc.text('LAPORAN DATA KADER & PENGURUS', pageWidth / 2, 38, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  const kopPartsPdf = [
    'STATUS: ' + meta.statusLabel.toUpperCase(),
    'DESA: ' + (meta.desaName ? meta.desaName.toUpperCase() : 'SEMUA DESA'),
  ];
  if (meta.dusunName) kopPartsPdf.push('DUSUN: ' + meta.dusunName.toUpperCase());
  doc.text(kopPartsPdf.join('   |   '), pageWidth / 2, 42.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Waktu Ekspor: ${meta.tglWaktu} WIB   |   Total Data: ${eiExportData.length} Orang   |   Operator: ${state.me?.nama || 'Administrator'}`,
    pageWidth / 2,
    46.8,
    { align: 'center' }
  );

  // --- TABEL DATA ---
  const head = [['NO', ...activeCols.map((c) => c.label)]];
  const body = eiExportData.map((r, i) => [
    i + 1,
    ...activeCols.map((c) => String(getExportVal(r, c.key) ?? '-')),
  ]);

  // Dynamic Column Styles for optimal cell alignments
  const colStyles = {
    0: { halign: 'center', cellWidth: 9 }, // Kolom NO
  };
  activeCols.forEach((c, idx) => {
    const tableColIdx = idx + 1;
    if (c.key === 'nik') colStyles[tableColIdx] = { halign: 'center', cellWidth: activeCols.length > 8 ? 29 : 35 };
    else if (c.key === 'jk') colStyles[tableColIdx] = { halign: 'center', cellWidth: 9 };
    else if (c.key === 'tgl_lahir') colStyles[tableColIdx] = { halign: 'center', cellWidth: 20 };
    else if (c.key === 'umur') colStyles[tableColIdx] = { halign: 'center', cellWidth: 12 };
    else if (c.key === 'rt' || c.key === 'rw') colStyles[tableColIdx] = { halign: 'center', cellWidth: 10 };
    else if (c.key === 'hp') colStyles[tableColIdx] = { halign: 'center', cellWidth: 26 };
    else if (c.key === 'status') colStyles[tableColIdx] = { halign: 'center', cellWidth: 22 };
    else if (c.key === 'nama') colStyles[tableColIdx] = { fontStyle: 'bold' };
  });

  const isFewCols = activeCols.length <= 6;
  const isManyCols = activeCols.length > 9;
  const isSuperManyCols = activeCols.length > 13;

  doc.autoTable({
    head,
    body,
    startY: 52,
    margin: { left: 10, right: 10, bottom: 14 },
    theme: 'grid',
    styles: {
      overflow: 'linebreak',
      cellPadding: isSuperManyCols ? 1.4 : isManyCols ? 1.8 : 2.2,
      fontSize: isSuperManyCols ? 6.2 : isManyCols ? 7 : isFewCols ? 8.2 : 7.6,
      textColor: [15, 23, 42],
      valign: 'middle',
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [185, 28, 28],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: isSuperManyCols ? 6.8 : isManyCols ? 7.4 : isFewCols ? 8.6 : 8.0,
      halign: 'center',
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: colStyles,
  });

  // Nomor halaman dan footer presisi di setiap halaman: "Halaman X dari Y"
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Sistem Informasi BANTAR RED · Dokumen resmi PAC PDI Perjuangan Kecamatan Bantarsari',
      10,
      pageHeight - 6
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - 10, pageHeight - 6, { align: 'right' });
  }

  const finalFileName = `${meta.fileNameBase}.pdf`;
  doc.save(finalFileName);
  toast(`Berhasil mengunduh dokumen PDF: ${finalFileName}`);
}

/* ---------------- IMPORT TAB ---------------- */
function renderImportTab() {
  const tc = $('#ei-tab-content');
  if (!tc) return;

  tc.innerHTML = `
    <!-- PANDUAN & UNDUH TEMPLATE -->
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">1</span>
          <div>
            <h3>Panduan &amp; Unduh Template Format Import</h3>
            <p class="ei-card-subtitle">Unduh format template resmi agar data Anda langsung cocok dan diproses secara otomatis.</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="btn-tpl-excel">📥 Unduh Template Excel (.xlsx)</button>
          <button type="button" class="btn btn-sm" id="btn-tpl-csv">📥 Unduh Template CSV (.csv)</button>
        </div>
      </div>
      <div style="background:var(--panel-strong);border:1px solid var(--line);border-radius:12px;padding:14px 18px;font-size:13.5px;color:var(--muted);line-height:1.6">
        <strong style="color:#fff;display:block;margin-bottom:4px">Ketentuan Import Data:</strong>
        <ul style="margin:0;padding-left:18px">
          <li><b>NIK:</b> Wajib 16 digit angka (tidak boleh ada spasi atau tanda baca).</li>
          <li><b>Nama Lengkap:</b> Wajib diisi.</li>
          <li><b>Desa &amp; Dusun:</b> Sesuaikan dengan daftar desa resmi Kecamatan Bantarsari (Bantarsari, Binangun, Bulaksari, Cikedondong, Citembong, Kamulyan, Kedungwadas, Rawajaya). Dusun baru akan otomatis ditambahkan ke desa bersangkutan jika belum ada.</li>
          <li><b>Jenis Kelamin (JK):</b> Isi <code>L</code> untuk Laki-laki atau <code>P</code> untuk Perempuan.</li>
          <li><b>Tanggal Lahir:</b> Format <code>YYYY-MM-DD</code> (contoh: <code>1990-05-20</code>) atau <code>DD/MM/YYYY</code>.</li>
          <li><b>Status Kepartaian:</b> Pilihan: <code>NETRAL</code>, <code>STRUKTURAL</code>, <code>ADS</code>, <code>SOBAT_KAISAR</code>, atau <code>LAINNYA</code> (bisa koma jika lebih dari satu).</li>
        </ul>
      </div>
    </section>

    <!-- UPLOAD DROPZONE -->
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">2</span>
          <div>
            <h3>Pilih Berkas Excel / CSV yang Ingin Diimpor</h3>
            <p class="ei-card-subtitle">Dukungan berkas: .xlsx, .xls, atau .csv.</p>
          </div>
        </div>
      </div>

      <input type="file" id="ei-file-input" accept=".xlsx,.xls,.csv" style="display:none" />
      
      <div class="ei-dropzone" id="ei-dropzone" role="button" tabindex="0" aria-label="Klik atau seret berkas ke sini">
        <span class="drop-icon">📁</span>
        <strong>Seret berkas Excel/CSV ke sini atau <span style="color:var(--gold);text-decoration:underline">klik untuk memilih</span></strong>
        <p>Sistem akan memvalidasi data secara otomatis sebelum disimpan ke database.</p>
      </div>

      <div id="ei-file-info-container"></div>
    </section>

    <!-- PRATINJAU & EKSEKUSI (JIKA SUDAH PILIH FILE) -->
    <div id="ei-import-preview-section"></div>`;

  $('#btn-tpl-excel').onclick = downloadTemplateExcel;
  $('#btn-tpl-csv').onclick = downloadTemplateCsv;

  const dropzone = $('#ei-dropzone');
  const fileInput = $('#ei-file-input');

  dropzone.onclick = () => fileInput.click();
  dropzone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) handleSelectedImportFile(files[0]);
  });

  fileInput.onchange = () => {
    if (fileInput.files.length) handleSelectedImportFile(fileInput.files[0]);
  };

  if (eiImportFileRows.length) {
    showImportFilePreview();
  }
}

function downloadTemplateExcel() {
  if (typeof XLSX === 'undefined') return toast('Pustaka Excel sedang dimuat...', true);
  const head = [
    'NIK (16 Digit)', 'Nama Lengkap', 'Jenis Kelamin (L/P)', 'Tempat Lahir',
    'Tanggal Lahir (YYYY-MM-DD)', 'Status Perkawinan', 'Pekerjaan', 'Desa', 'Dusun',
    'RT', 'RW', 'Alamat Lengkap', 'No HP / WhatsApp', 'Status Kepartaian',
    'Jabatan', 'Tingkat', 'No KTA', 'Catatan'
  ];
  const sample = [
    [
      '3301010101900001', 'Ahmad Subagyo', 'L', 'Cilacap', '1990-05-12', 'Kawin', 'Petani',
      'Bantarsari', 'Cikerang', '01', '02', 'Jl. Merdeka No. 12', '081234567890', 'STRUKTURAL',
      'Ketua Ranting', 'Ranting', 'KTA-3301-001', 'Kader aktif'
    ],
    [
      '3301010202950002', 'Siti Rahmawati', 'P', 'Bantarsari', '1995-08-20', 'Belum Kawin', 'Wiraswasta',
      'Kamulyan', 'Mulyadadi', '03', '01', 'Dusun Mulyadadi RT 03', '085712345678', 'ADS',
      '', '', '', 'Simpatisan'
    ],
    [
      '3301010303880003', 'Budi Santoso', 'L', 'Cilacap', '1988-12-05', 'Kawin', 'Buruh',
      'Rawajaya', 'Rawasari', '02', '04', 'Rawajaya RT 02 RW 04', '089612345678', 'NETRAL',
      '', '', '', ''
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet([head, ...sample]);
  head.forEach((h, colIdx) => {
    for (let r = 1; r <= sample.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r, c: colIdx });
      if (ws[cellRef]) ws[cellRef].t = 's';
    }
  });

  ws['!cols'] = head.map((h, i) => {
    let max = h.length;
    for (let r = 0; r < sample.length; r++) {
      const s = String(sample[r][i] || '');
      if (s.length > max) max = s.length;
    }
    return { wch: max + 4 };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Import');
  XLSX.writeFile(wb, 'Template-Import-Data-Kader-Bantarsari.xlsx');
  toast('Template Excel berhasil diunduh');
}

function downloadTemplateCsv() {
  const head = [
    'NIK (16 Digit)', 'Nama Lengkap', 'Jenis Kelamin (L/P)', 'Tempat Lahir',
    'Tanggal Lahir (YYYY-MM-DD)', 'Status Perkawinan', 'Pekerjaan', 'Desa', 'Dusun',
    'RT', 'RW', 'Alamat Lengkap', 'No HP / WhatsApp', 'Status Kepartaian',
    'Jabatan', 'Tingkat', 'No KTA', 'Catatan'
  ];
  const sample = [
    [
      '="3301010101900001"', 'Ahmad Subagyo', 'L', 'Cilacap', '1990-05-12', 'Kawin', 'Petani',
      'Bantarsari', 'Cikerang', '01', '02', 'Jl. Merdeka No. 12', '081234567890', 'STRUKTURAL',
      'Ketua Ranting', 'Ranting', 'KTA-3301-001', 'Kader aktif'
    ],
    [
      '="3301010202950002"', 'Siti Rahmawati', 'P', 'Bantarsari', '1995-08-20', 'Belum Kawin', 'Wiraswasta',
      'Kamulyan', 'Mulyadadi', '03', '01', 'Dusun Mulyadadi RT 03', '085712345678', 'ADS',
      '', '', '', 'Simpatisan'
    ],
  ];

  const lines = [head.map(csvCell).join(',')];
  sample.forEach((row) => {
    lines.push(row.map((v, i) => (i === 0 ? v : csvCell(v))).join(','));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Template-Import-Data-Kader-Bantarsari.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Template CSV berhasil diunduh');
}

function handleSelectedImportFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) {
    return toast('Format berkas harus .xlsx, .xls, atau .csv', true);
  }

  eiImportFileName = file.name;
  eiImportFileSize = file.size;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });

      if (!rawRows.length) {
        return toast('Berkas tidak memiliki baris data untuk diimpor!', true);
      }

      eiImportFileRows = normalizeImportRows(rawRows);
      showImportFilePreview();
      toast(`Berhasil membaca ${eiImportFileRows.length} baris dari berkas ${file.name}`);
    } catch (err) {
      console.error('Error membaca file import:', err);
      toast('Gagal membaca berkas: ' + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}

function normalizeImportRows(rawRows) {
  return rawRows.map((raw) => {
    const item = {};
    Object.entries(raw).forEach(([k, v]) => {
      const cleanKey = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      const strVal = String(v ?? '').trim();

      if (cleanKey.includes('nik') || cleanKey.includes('ktp')) item.nik = strVal.replace(/\D/g, '');
      else if (cleanKey.includes('nama') || cleanKey === 'namaanggota' || cleanKey === 'namawarga') item.nama = strVal;
      else if (cleanKey === 'jk' || cleanKey.includes('jeniskelamin') || cleanKey === 'gender' || cleanKey === 'lp') item.jk = strVal;
      else if (cleanKey.includes('tempatlahir')) item.tempat_lahir = strVal;
      else if (cleanKey.includes('tgllahir') || cleanKey.includes('tanggallahir')) item.tgl_lahir = strVal;
      else if (cleanKey.includes('kawin') || cleanKey.includes('perkawinan')) item.status_kawin = strVal;
      else if (cleanKey.includes('kerja') || cleanKey.includes('pekerjaan') || cleanKey.includes('profesi')) item.pekerjaan = strVal;
      else if (cleanKey === 'desa' || cleanKey.includes('kelurahan')) item.desa = strVal;
      else if (cleanKey === 'dusun' || cleanKey.includes('dukuh') || cleanKey.includes('kampung')) item.dusun = strVal;
      else if (cleanKey === 'rt') item.rt = strVal;
      else if (cleanKey === 'rw') item.rw = strVal;
      else if (cleanKey === 'alamat' || cleanKey.includes('alamatlengkap')) item.alamat = strVal;
      else if (cleanKey.includes('hp') || cleanKey.includes('telepon') || cleanKey.includes('wa') || cleanKey.includes('whatsapp') || cleanKey === 'kontak') item.hp = strVal;
      else if (cleanKey === 'status' || cleanKey.includes('statuskader') || cleanKey.includes('statuspartai') || cleanKey.includes('statuskepartaian')) item.status = strVal;
      else if (cleanKey.includes('jabatan')) item.jabatan = strVal;
      else if (cleanKey.includes('tingkat')) item.tingkat = strVal;
      else if (cleanKey.includes('kta') || cleanKey.includes('nokta')) item.no_kta = strVal;
      else if (cleanKey.includes('catatan') || cleanKey.includes('keterangan')) item.catatan = strVal;
    });
    return item;
  });
}

function showImportFilePreview() {
  const infoCont = $('#ei-file-info-container');
  if (infoCont) {
    const sizeKb = (eiImportFileSize / 1024).toFixed(1);
    infoCont.innerHTML = `
      <div class="ei-file-picked">
        <div class="ei-file-info">
          <span class="f-icon">📄</span>
          <div>
            <strong>${esc(eiImportFileName)}</strong>
            <small>${sizeKb} KB · ${eiImportFileRows.length} baris data terbaca</small>
          </div>
        </div>
        <button type="button" class="btn btn-sm" id="btn-reselect-file">Ganti Berkas</button>
      </div>`;
    $('#btn-reselect-file').onclick = () => $('#ei-file-input').click();
  }

  // Row validation summary
  const seenNiks = new Set();
  let validCount = 0;
  let warnCount = 0;

  const evaluatedRows = eiImportFileRows.map((r, i) => {
    const errors = [];
    const warnings = [];

    if (!r.nik || r.nik.length !== 16) {
      errors.push('NIK bukan 16 digit');
    } else if (seenNiks.has(r.nik)) {
      warnings.push('Duplikat di berkas ini');
    } else {
      seenNiks.add(r.nik);
    }

    if (!r.nama) errors.push('Nama kosong');
    if (!r.desa && state.me?.role === 'admin') warnings.push('Desa kosong');

    if (errors.length) {
      warnCount++;
      return { ...r, _status: 'err', _msg: errors.join(', ') };
    } else if (warnings.length) {
      validCount++;
      return { ...r, _status: 'warn', _msg: warnings.join(', ') };
    } else {
      validCount++;
      return { ...r, _status: 'ok', _msg: 'Siap Diimpor' };
    }
  });

  const previewSec = $('#ei-import-preview-section');
  if (!previewSec) return;

  previewSec.innerHTML = `
    <section class="ei-card">
      <div class="ei-card-head">
        <div class="ei-card-title">
          <span class="step-num">3</span>
          <div>
            <h3>Opsi Penanganan &amp; Pratinjau Data</h3>
            <p class="ei-card-subtitle">Periksa pratinjau data di bawah sebelum memproses penyimpanan.</p>
          </div>
        </div>
      </div>

      <!-- Duplicate Handling Radio -->
      <div class="ei-options-box">
        <label class="ei-radio-option ${!eiUpdateExisting ? 'selected' : ''}">
          <input type="radio" name="ei-dup-mode" value="skip" ${!eiUpdateExisting ? 'checked' : ''} />
          <div>
            <strong>Lewati jika NIK sudah ada di database (Direkomendasikan)</strong>
            <small>Data warga yang NIK-nya sudah terdaftar tidak akan diubah atau ditimpa.</small>
          </div>
        </label>
        <label class="ei-radio-option ${eiUpdateExisting ? 'selected' : ''}">
          <input type="radio" name="ei-dup-mode" value="update" ${eiUpdateExisting ? 'checked' : ''} />
          <div>
            <strong>Perbarui data warga jika NIK sudah ada</strong>
            <small>Data lama akan diperbarui sesuai informasi terbaru dari berkas ini.</small>
          </div>
        </label>
      </div>

      <!-- Stats Bar -->
      <div class="ei-stats-row">
        <div class="ei-mini-stat">
          <small>Total Terdeteksi</small>
          <b>${eiImportFileRows.length}</b>
        </div>
        <div class="ei-mini-stat ok">
          <small>Siap Diimpor</small>
          <b>${validCount}</b>
        </div>
        <div class="ei-mini-stat ${warnCount > 0 ? 'err' : 'ok'}">
          <small>Perlu Perhatian</small>
          <b>${warnCount}</b>
        </div>
      </div>

      <!-- Table Preview (first 10 rows) -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600;color:var(--muted)">Pratinjau 10 Baris Pertama:</span>
          <small style="color:var(--muted)">Menampilkan max 10 baris</small>
        </div>
        <div class="ei-preview-box">
          <table class="ei-preview-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Status Validasi</th>
                <th>NIK</th>
                <th>Nama Lengkap</th>
                <th>JK</th>
                <th>Desa</th>
                <th>Dusun</th>
                <th>RT / RW</th>
                <th>No. HP</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${evaluatedRows.slice(0, 10).map((r, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>
                    <span class="ei-status-badge ${r._status}">
                      ${r._status === 'ok' ? '✓ ' : r._status === 'warn' ? '⚠ ' : '✕ '}
                      ${esc(r._msg)}
                    </span>
                  </td>
                  <td class="mono">${esc(r.nik || '-')}</td>
                  <td><b>${esc(r.nama || '-')}</b></td>
                  <td>${esc(r.jk || '-')}</td>
                  <td>${esc(r.desa || '-')}</td>
                  <td>${esc(r.dusun || '-')}</td>
                  <td>${esc([r.rt ? 'RT ' + r.rt : '', r.rw ? 'RW ' + r.rw : ''].filter(Boolean).join(' ') || '-')}</td>
                  <td>${esc(r.hp || '-')}</td>
                  <td>${badge(r.status || 'NETRAL')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Action Button -->
      <div style="display:flex;gap:12px;align-items:center;justify-content:flex-end;margin-top:8px">
        <button type="button" class="btn btn-primary" id="btn-start-import" style="padding:12px 28px;font-size:15px">
          🚀 Mulai Import ${validCount} Data Warga
        </button>
      </div>
    </section>`;

  $$('input[name="ei-dup-mode"]').forEach((r) => {
    r.onchange = () => {
      eiUpdateExisting = r.value === 'update';
      $$('.ei-radio-option').forEach((opt) => {
        opt.classList.toggle('selected', opt.querySelector('input').checked);
      });
    };
  });

  $('#btn-start-import').onclick = () => executeImportProcess(validCount);
}

async function executeImportProcess(validCount) {
  if (!eiImportFileRows.length || validCount === 0) {
    return toast('Tidak ada data valid yang bisa diimpor!', true);
  }

  const ok = await confirmBox(
    'Konfirmasi Import Data',
    `Yakin ingin mengimpor <b>${eiImportFileRows.length} data warga</b> ke database?<br><br>` +
    `Mode Duplikat: <b>${eiUpdateExisting ? 'Perbarui data yang sudah ada' : 'Lewati NIK yang sudah ada'}</b>.`,
    'Ya, Mulai Import'
  );
  if (!ok) return;

  const btn = $('#btn-start-import');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sedang Memproses Import...';
  }

  try {
    const res = await api('/import', {
      method: 'POST',
      body: {
        rows: eiImportFileRows,
        updateExisting: eiUpdateExisting,
      },
    });

    // Reset imported file state
    eiImportFileRows = [];
    eiImportFileName = '';
    eiImportFileSize = 0;

    let errorListHtml = '';
    if (res.errors && res.errors.length) {
      errorListHtml = `
        <div style="margin-top:14px;text-align:left">
          <small style="font-weight:600;color:#f87171;display:block;margin-bottom:6px">Catatan / Peringatan Baris (${res.errors.length}):</small>
          <div style="max-height:160px;overflow:auto;background:var(--field);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font-size:12px;color:var(--muted)">
            ${res.errors.map((e) => `<div>• ${esc(e)}</div>`).join('')}
          </div>
        </div>`;
    }

    openModal(
      'Hasil Import Data Selesai',
      `<div style="text-align:center;padding:10px 4px">
        <div style="font-size:42px;margin-bottom:10px">🎉</div>
        <h3 style="margin-bottom:6px">Proses Import Selesai!</h3>
        <p class="muted" style="font-size:14px;margin-bottom:18px">Berikut adalah rangkuman hasil import data ke database:</p>
        
        <div class="ei-stats-row" style="margin-bottom:14px">
          <div class="ei-mini-stat">
            <small>Total Diproses</small>
            <b>${res.total}</b>
          </div>
          <div class="ei-mini-stat ok">
            <small>Data Baru</small>
            <b>${res.inserted}</b>
          </div>
          <div class="ei-mini-stat warn">
            <small>Diperbarui</small>
            <b>${res.updated}</b>
          </div>
          <div class="ei-mini-stat ${res.skipped > 0 ? 'err' : ''}">
            <small>Dilewati</small>
            <b>${res.skipped}</b>
          </div>
        </div>

        ${errorListHtml}

        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px">
          <button type="button" class="btn" id="modal-btn-close">Tutup</button>
          <button type="button" class="btn btn-primary" id="modal-btn-warga">Lihat di Menu Database</button>
        </div>
      </div>`
    );

    $('#modal-btn-close').onclick = () => {
      closeModal();
      renderImportTab();
    };
    $('#modal-btn-warga').onclick = () => {
      closeModal();
      go('warga');
    };
  } catch (err) {
    console.error('Import API error:', err);
    toast('Gagal melakukan import: ' + err.message, true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = `🚀 Mulai Import ${validCount} Data Warga`;
    }
  }
}

boot();

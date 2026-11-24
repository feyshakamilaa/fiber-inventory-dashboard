/* Fiber Network Inventory Monitoring — logika dashboard (vanilla JS + Chart.js)
   Semua angka dihitung dari data/inventory_simulasi.csv (disalin ke assets/data.js). */
(function () {
  'use strict';

  /* ========== 1. DATA & ATURAN VALIDASI (sesuai data_dictionary.csv) ========== */
  const AREAS = ['Tarakan Barat', 'Tarakan Tengah', 'Tarakan Timur', 'Tarakan Utara'];
  const STATUSES = ['Active', 'Maintenance', 'Inactive', 'Planned'];
  const OTHER = 'Tidak valid / kosong';
  const REF_DATE = '2026-11-24';   // versi snapshot SIM-20261124
  const FIELDS = ['record_id', 'asset_id', 'device_type', 'area', 'asset_status', 'total_ports', 'used_ports', 'parent_odc_id', 'last_updated', 'project_id'];

  function parseCSV(text) {
    const out = []; let row = [], cell = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out.filter(r => r.length > 1 || r[0] !== '');
  }

  function isValidDate(s) {   // murni UTC agar tidak terpengaruh zona waktu perangkat
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3], t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  const isInt = s => /^-?\d+$/.test(s);

  function buildRows(csv) {
    const t = parseCSV(csv), head = t[0];
    const rows = t.slice(1).map(r => { const o = {}; head.forEach((h, i) => o[h.trim()] = (r[i] || '').trim()); return o; });

    const idCount = {}; rows.forEach(r => { if (r.asset_id) idCount[r.asset_id] = (idCount[r.asset_id] || 0) + 1; });
    const odcIds = new Set(rows.filter(r => r.device_type === 'ODC' && r.asset_id).map(r => r.asset_id));
    const today = REF_DATE;   // tanggal acuan snapshot dataset (bukan jam komputer)

    rows.forEach(r => {
      const iss = [];           // {cat: 'missing'|'duplicate'|'invalid', label}
      const add = (cat, label) => iss.push({ cat, label });
      const odpLike = r.device_type.startsWith('ODP');
      let missingCells = 0;

      FIELDS.forEach(f => { /* hitung sel wajib kosong */
        const required = ['record_id', 'asset_id', 'device_type', 'area', 'asset_status', 'last_updated'].includes(f) ||
          (odpLike && ['total_ports', 'used_ports', 'parent_odc_id'].includes(f));
        if (required && !r[f]) missingCells++;
      });
      r._requiredCells = 6 + (odpLike ? 3 : 0); r._missingCells = missingCells;

      if (!r.record_id) add('missing', 'record_id kosong');
      if (!r.asset_id) add('missing', 'asset_id kosong');
      else if (idCount[r.asset_id] > 1) add('duplicate', 'asset_id duplikat');
      if (r.device_type !== 'ODP' && r.device_type !== 'ODC') add('invalid', r.device_type ? 'Jenis perangkat tidak valid' : 'Jenis perangkat kosong');
      if (!r.area) add('missing', 'Wilayah kosong'); else if (!AREAS.includes(r.area)) add('invalid', 'Wilayah tidak valid');
      if (!r.asset_status) add('missing', 'Status kosong'); else if (!STATUSES.includes(r.asset_status)) add('invalid', 'Status tidak valid');
      if (!r.last_updated) add('missing', 'Tanggal update kosong'); else if (!isValidDate(r.last_updated) || r.last_updated > today) add('invalid', 'Tanggal update tidak valid');
      if (r.project_id && !/^PRJ-SIM-\d{3}$/.test(r.project_id)) add('invalid', 'Format project_id tidak valid');

      let total = NaN, used = NaN;
      if (odpLike) {
        if (!r.total_ports) add('missing', 'total_ports kosong');
        else if (!isInt(r.total_ports) || +r.total_ports <= 0) add('invalid', 'Kapasitas port tidak valid'); else total = +r.total_ports;
        if (!r.used_ports) add('missing', 'used_ports kosong');
        else if (!isInt(r.used_ports) || +r.used_ports < 0) add('invalid', 'Port terpakai tidak valid'); else used = +r.used_ports;
        if (!isNaN(total) && !isNaN(used) && used > total) add('invalid', 'Port terpakai melebihi kapasitas');
        if (!r.parent_odc_id) add('missing', 'ODC induk kosong'); else if (!odcIds.has(r.parent_odc_id)) add('invalid', 'ODC induk tidak ditemukan');
      }
      r._issues = iss;
      r._total = total; r._used = used;
      r._review = iss.length > 0;
      r._portOK = r.device_type === 'ODP' && !r._review;   // dipakai untuk hitung utilisasi
      r._areaKey = AREAS.includes(r.area) ? r.area : OTHER;
      r._statusKey = STATUSES.includes(r.asset_status) ? r.asset_status : OTHER;
      r._typeKey = r.device_type === 'ODP' || r.device_type === 'ODC' ? r.device_type : OTHER;
      r._util = r._portOK ? r._used / r._total : NaN;
      r._search = Object.values(r).filter(v => typeof v === 'string').join(' ').toLowerCase();
    });
    return rows;
  }

  /* ========== 2. AGREGASI (selalu dari baris yang sedang difilter) ========== */
  function countBy(rows, key, cats) { const m = {}; cats.forEach(c => m[c] = 0); rows.forEach(r => { m[r[key]] = (m[r[key]] || 0) + 1; }); return m; }

  function stats(rows) {
    const s = { total: rows.length };
    s.odp = rows.filter(r => r.device_type === 'ODP').length;
    s.odc = rows.filter(r => r.device_type === 'ODC').length;
    const ok = rows.filter(r => r._portOK);
    s.odpValid = ok.length;
    s.ports = ok.reduce((a, r) => a + r._total, 0);
    s.used = ok.reduce((a, r) => a + r._used, 0);
    s.avail = s.ports - s.used;
    s.util = s.ports ? s.used / s.ports : NaN;
    s.reqCells = rows.reduce((a, r) => a + r._requiredCells, 0);
    s.missCells = rows.reduce((a, r) => a + r._missingCells, 0);
    s.complete = s.reqCells ? 1 - s.missCells / s.reqCells : NaN;
    s.review = rows.filter(r => r._review).length;
    s.valid = s.total - s.review;
    s.rowsComplete = rows.filter(r => !r._issues.some(i => i.cat === 'missing')).length;
    s.rowsIncomplete = s.total - s.rowsComplete;
    s.rowsDup = rows.filter(r => r._issues.some(i => i.cat === 'duplicate')).length;
    s.rowsInvalid = rows.filter(r => r._issues.some(i => i.cat === 'invalid')).length;
    return s;
  }

  const FiberCore = { parseCSV, buildRows, stats, AREAS, STATUSES, OTHER };
  if (typeof window !== 'undefined') window.FiberCore = FiberCore;
  if (typeof document === 'undefined') return;

  /* ========== 3. UI ========== */
  const $ = (s, el) => (el || document).querySelector(s);
  const ALL = buildRows(window.INVENTORY_CSV);
  const nf = new Intl.NumberFormat('id-ID');
  const num = v => isNaN(v) ? '—' : nf.format(v);
  const pct = (v, d = 1) => isNaN(v) ? '—' : (v * 100).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { area: '', type: '', view: 'overview' };
  const VIEWS = {
    overview: ['Overview', 'Ringkasan inventory perangkat ODP dan ODC beserta kapasitas dan utilisasi port.'],
    inventory: ['Network Inventory', 'Analisis perangkat berdasarkan jenis, wilayah, kapasitas port, dan status.'],
    quality: ['Data Quality', 'Pemeriksaan kelengkapan, duplikasi, dan validitas data berdasarkan data dictionary.'],
    explorer: ['Data Explorer', 'Telusuri seluruh record inventory: cari, filter, urutkan, dan ekspor.']
  };
  const filtered = () => ALL.filter(r => (!state.area || r.area === state.area) && (!state.type || r.device_type === state.type));

  /* --- warna & Chart.js --- */
  const C = { primary: '#2563eb', navy: '#1e3a5f', teal: '#14b8a6', slate: '#cbd5e1', amber: '#f59e0b', red: '#ef4444', violet: '#8b5cf6', muted: '#64748b' };
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = C.muted;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = { duration: 650, easing: 'easeOutQuart' };
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0f172a';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  const grid = { color: '#eef1f5', drawBorder: false };
  const charts = {};
  function draw(id, type, data, options) {
    const ch = charts[id];
    if (ch) { ch.data.labels = data.labels; ch.data.datasets.forEach((d, i) => Object.assign(d, data.datasets[i])); ch.data.datasets.length = data.datasets.length; ch.update(); return; }
    charts[id] = new Chart($('#' + id), { type, data, options });
  }
  const barOpts = (extra = {}) => Object.assign({
    scales: { x: { grid: { display: false }, ...(extra.x || {}) }, y: { beginAtZero: true, grid, ticks: { precision: 0 }, ...(extra.y || {}) } },
    plugins: { legend: { position: 'bottom' } }, borderRadius: 6
  }, extra.root || {});
  const donutOpts = { cutout: '66%', plugins: { legend: { position: 'bottom' } } };
  const areaCats = () => state.area ? [state.area] : [...AREAS, OTHER];
  const areaCatsAll = () => [...AREAS, OTHER];

  /* --- KPI --- */
  const ICONS = {
    box: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    port: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11v2M11 11v2M15 11v2"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
    check: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    x: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>'
  };
  function kpi(k) {
    return `<article class="kpi-card c-${k.c}"><div class="kpi-top"><div class="kpi-identity"><div class="kpi-icon ${k.c}"><svg viewBox="0 0 24 24">${ICONS[k.i]}</svg></div><div class="kpi-label">${k.label}</div></div></div>
      <div class="kpi-value">${k.value}${k.sup ? `<sup>${k.sup}</sup>` : ''}</div><div class="kpi-sub">${k.sub}</div></article>`;
  }

  /* --- render per halaman --- */
  function renderOverview(rows, s) {
    $('#kpiOverview').innerHTML = [
      { c: 'primary', i: 'box', label: 'Total perangkat ODP', value: num(s.odp), sub: `${num(s.odpValid)} ODP lolos validasi` },
      { c: 'info', i: 'server', label: 'Total perangkat ODC', value: num(s.odc), sub: 'Jenis perangkat ODC' },
      { c: 'purple', i: 'port', label: 'Total kapasitas port ODP', value: num(s.ports), sub: `${num(s.avail)} port tersedia` },
      { c: 'success', i: 'gauge', label: 'Utilisasi port', value: pct(s.util), sub: `${num(s.used)} dari ${num(s.ports)} port terpakai` },
      { c: 'success', i: 'check', label: 'Kelengkapan data', value: pct(s.complete, 2), sub: `${num(s.reqCells - s.missCells)} dari ${num(s.reqCells)} field wajib terisi` },
      { c: 'warning', i: 'alert', label: 'Data perlu diperiksa', value: num(s.review), sub: `${pct(s.total ? s.review / s.total : NaN)} dari ${num(s.total)} record` }
    ].map(kpi).join('');

    const cats = areaCats();
    const by = t => cats.map(a => rows.filter(r => r._areaKey === a && r._typeKey === t).length);
    draw('cOvArea', 'bar', { labels: cats, datasets: [
      { label: 'ODP', data: by('ODP'), backgroundColor: C.primary, stack: 's' },
      { label: 'ODC', data: by('ODC'), backgroundColor: C.teal, stack: 's' },
      { label: 'Jenis tidak valid', data: by(OTHER), backgroundColor: C.amber, stack: 's' }] },
      barOpts({ x: { stacked: true }, y: { stacked: true } }));
    draw('cOvPorts', 'doughnut', { labels: ['Terpakai', 'Tersedia'], datasets: [{ data: [s.used, s.avail], backgroundColor: [C.navy, C.teal], borderWidth: 0 }] }, donutOpts);
    $('#ovPortsNote').textContent = s.ports ? `Utilisasi ${pct(s.util)} dari ${num(s.odpValid)} ODP valid` : 'Tidak ada ODP valid pada filter ini';
  }

  function renderInventory(rows) {
    const types = ['ODP', 'ODC', OTHER];
    draw('cInvType', 'bar', { labels: types, datasets: [{ data: types.map(t => rows.filter(r => r._typeKey === t).length), backgroundColor: [C.primary, C.teal, C.amber] }] },
      { indexAxis: 'y', borderRadius: 6, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid, ticks: { precision: 0 } }, y: { grid: { display: false } } } });
    const cats = areaCats();
    draw('cInvArea', 'bar', { labels: cats, datasets: [
      { label: 'ODP', data: cats.map(a => rows.filter(r => r._areaKey === a && r._typeKey === 'ODP').length), backgroundColor: C.primary },
      { label: 'ODC', data: cats.map(a => rows.filter(r => r._areaKey === a && r._typeKey === 'ODC').length), backgroundColor: C.teal }] }, barOpts());
    const ok = rows.filter(r => r._portOK), pc = state.area ? [state.area] : AREAS;
    const sum = (a, k) => ok.filter(r => r.area === a).reduce((x, r) => x + r[k], 0);
    draw('cInvPorts', 'bar', { labels: pc, datasets: [
      { label: 'Kapasitas port', data: pc.map(a => sum(a, '_total')), backgroundColor: C.slate },
      { label: 'Port terpakai', data: pc.map(a => sum(a, '_used')), backgroundColor: C.navy }] },
      barOpts({ root: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { afterBody: it => { const t = sum(pc[it[0].dataIndex], '_total'); return t ? 'Utilisasi: ' + pct(sum(pc[it[0].dataIndex], '_used') / t) : ''; } } } } } }));
    const st = [...STATUSES, OTHER], sc = countBy(rows, '_statusKey', st);
    draw('cInvStatus', 'doughnut', { labels: st, datasets: [{ data: st.map(k => sc[k]), backgroundColor: [C.teal, C.amber, C.muted, C.primary, C.slate], borderWidth: 0 }] }, donutOpts);
    const bands = ['< 25%', '25–49%', '50–74%', '75–99%', '100% (penuh)'];
    const b = [0, 0, 0, 0, 0]; ok.forEach(r => { const u = r._util; b[u >= 1 ? 4 : u >= .75 ? 3 : u >= .5 ? 2 : u >= .25 ? 1 : 0]++; });
    draw('cInvUtil', 'bar', { labels: bands, datasets: [{ label: 'Jumlah ODP', data: b, backgroundColor: [C.teal, '#5eead4', C.primary, C.navy, C.red] }] }, barOpts({ root: { plugins: { legend: { display: false } } } }));
    const pm = {}; rows.filter(r => r.device_type === 'ODP' && r.parent_odc_id).forEach(r => pm[r.parent_odc_id] = (pm[r.parent_odc_id] || 0) + 1);
    const top = Object.entries(pm).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    draw('cInvOdc', 'bar', { labels: top.map(t => t[0]), datasets: [{ label: 'Jumlah ODP', data: top.map(t => t[1]), backgroundColor: C.primary }] },
      { indexAxis: 'y', borderRadius: 6, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid, ticks: { precision: 0 } }, y: { grid: { display: false } } } });
  }

  const qs = { page: 1, per: 10 };
  function renderQuality(rows, s) {
    $('#kpiQuality').innerHTML = [
      { c: 'success', i: 'check', label: 'Data lengkap', value: num(s.rowsComplete), sub: 'Record tanpa field wajib kosong' },
      { c: 'danger', i: 'x', label: 'Data tidak lengkap', value: num(s.rowsIncomplete), sub: 'Record dengan field wajib kosong' },
      { c: 'purple', i: 'copy', label: 'Data duplikat', value: num(s.rowsDup), sub: 'Record dengan asset_id ganda' },
      { c: 'warning', i: 'alert', label: 'Format / nilai tidak valid', value: num(s.rowsInvalid), sub: 'Record dengan nilai di luar aturan' },
      { c: 'primary', i: 'gauge', label: 'Kelengkapan data', value: pct(s.complete, 2), sub: `${num(s.missCells)} sel wajib kosong dari ${num(s.reqCells)}` },
      { c: 'warning', i: 'alert', label: 'Perlu diperiksa', value: num(s.review), sub: `${num(s.valid)} record valid` }
    ].map(kpi).join('');
    draw('cQVal', 'doughnut', { labels: ['Valid', 'Perlu diperiksa'], datasets: [{ data: [s.valid, s.review], backgroundColor: [C.teal, C.amber], borderWidth: 0 }] }, donutOpts);
    const cnt = {}, cat = {}; rows.forEach(r => r._issues.forEach(i => { cnt[i.label] = (cnt[i.label] || 0) + 1; cat[i.label] = i.cat; }));
    const e = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const col = { missing: C.red, duplicate: C.violet, invalid: C.amber };
    draw('cQIssue', 'bar', { labels: e.map(x => x[0]), datasets: [{ label: 'Jumlah temuan', data: e.map(x => x[1]), backgroundColor: e.map(x => col[cat[x[0]]]) }] },
      { indexAxis: 'y', borderRadius: 6, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid, ticks: { precision: 0 } }, y: { grid: { display: false } } } });
    const bad = rows.filter(r => r._review), pages = Math.max(1, Math.ceil(bad.length / qs.per));
    qs.page = Math.min(qs.page, pages);
    const slice = bad.slice((qs.page - 1) * qs.per, qs.page * qs.per);
    const badge = i => `<span class="badge ${i.cat === 'missing' ? 'danger' : i.cat === 'duplicate' ? 'purple' : 'warning'}">${esc(i.label)}</span>`;
    $('#qTable tbody').innerHTML = slice.length ? slice.map(r => `<tr><td class="cell-mono">${esc(r.record_id)}</td><td class="cell-mono ${r.asset_id ? '' : 'empty'}">${esc(r.asset_id || 'kosong')}</td><td>${esc(r.device_type || '—')}</td><td>${esc(r.area || '—')}</td><td><div class="issue-list">${r._issues.map(badge).join('')}</div></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-state">Tidak ada data yang perlu diperiksa pada filter ini.</td></tr>';
    $('#qInfo').textContent = bad.length ? `Menampilkan ${(qs.page - 1) * qs.per + 1}–${(qs.page - 1) * qs.per + slice.length} dari ${bad.length} record` : '';
    pager($('#qPager'), qs.page, pages, p => { qs.page = p; renderQuality(rows, s); });
  }

  /* --- Data Explorer --- */
  const COLS = [
    { k: 'record_id', l: 'Record ID', mono: 1 }, { k: 'asset_id', l: 'Asset ID', mono: 1 }, { k: 'device_type', l: 'Jenis' },
    { k: 'area', l: 'Wilayah' }, { k: 'asset_status', l: 'Status' }, { k: '_total', l: 'Port total', n: 1 }, { k: '_used', l: 'Terpakai', n: 1 },
    { k: '_util', l: 'Utilisasi', n: 1 }, { k: 'parent_odc_id', l: 'ODC induk', mono: 1 }, { k: 'last_updated', l: 'Update', mono: 1 }, { k: '_review', l: 'Kualitas' }
  ];
  const es = { key: 'record_id', dir: 1, page: 1, per: 25, q: '', quality: '' };
  $('#eTable thead').innerHTML = '<tr>' + COLS.map(c => `<th class="sortable ${c.n ? 'num' : ''}" data-k="${c.k}">${c.l} <span class="sort"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></th>`).join('') + '</tr>';
  $('#eTable thead').addEventListener('click', e => {
    const th = e.target.closest('th'); if (!th) return;
    es.dir = es.key === th.dataset.k ? -es.dir : 1; es.key = th.dataset.k; es.page = 1; renderExplorer();
  });
  function explorerRows() {
    const q = es.q.toLowerCase();
    let r = filtered().filter(x => (!q || x._search.includes(q)) && (!es.quality || (es.quality === 'review') === x._review));
    const k = es.key, num = COLS.find(c => c.k === k).n || k === '_review';
    r.sort((a, b) => {
      let x = a[k], y = b[k];
      const ex = x === '' || x === undefined || (typeof x === 'number' && isNaN(x)), ey = y === '' || y === undefined || (typeof y === 'number' && isNaN(y));
      if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;   // kosong selalu di akhir
      if (num) return (x - y) * es.dir;
      return String(x).localeCompare(String(y), 'id', { numeric: true }) * es.dir;
    });
    return r;
  }
  function renderExplorer() {
    const rows = explorerRows(), pages = Math.max(1, Math.ceil(rows.length / es.per));
    es.page = Math.min(es.page, pages);
    const slice = rows.slice((es.page - 1) * es.per, es.page * es.per);
    [...$('#eTable thead').children[0].children].forEach(th => { th.classList.remove('sorted-asc', 'sorted-desc'); if (th.dataset.k === es.key) th.classList.add(es.dir > 0 ? 'sorted-asc' : 'sorted-desc'); });
    const cell = (r, c) => {
      if (c.k === '_review') return r._review ? `<span class="badge warning dot" title="${esc(r._issues.map(i => i.label).join('; '))}">Perlu diperiksa</span>` : '<span class="badge success dot">Valid</span>';
      if (c.k === '_util') return isNaN(r._util) ? '—' : pct(r._util, 0);
      if (c.k === '_total' || c.k === '_used') return r.device_type === 'ODC' ? '—' : (isNaN(r[c.k]) ? `<span class="empty">${esc(r[c.k === '_total' ? 'total_ports' : 'used_ports'] || 'kosong')}</span>` : r[c.k]);
      if (c.k === 'parent_odc_id' && r.device_type === 'ODC') return '—';
      const v = r[c.k];
      return v ? esc(v) : (c.k === 'asset_id' || c.k === 'area' || c.k === 'asset_status' || c.k === 'last_updated' || c.k === 'parent_odc_id' ? '<span class="empty">kosong</span>' : '—');
    };
    $('#eTable tbody').innerHTML = slice.length ? slice.map(r => '<tr>' + COLS.map(c => `<td class="${c.n ? 'num' : ''} ${c.mono ? 'cell-mono' : ''}">${cell(r, c)}</td>`).join('') + '</tr>').join('')
      : `<tr><td colspan="${COLS.length}" class="empty-state">Tidak ada data yang cocok dengan pencarian/filter.</td></tr>`;
    $('#eInfo').textContent = rows.length ? `Menampilkan ${(es.page - 1) * es.per + 1}–${(es.page - 1) * es.per + slice.length} dari ${num_(rows.length)} record` : '0 record';
    pager($('#ePager'), es.page, pages, p => { es.page = p; renderExplorer(); });
  }
  const num_ = nf.format;

  function pager(el, page, pages, go) {
    const set = new Set([1, pages, page - 1, page, page + 1]); const list = [...set].filter(p => p >= 1 && p <= pages).sort((a, b) => a - b);
    let h = `<button class="pager-btn" ${page === 1 ? 'disabled' : ''} data-p="${page - 1}" aria-label="Sebelumnya"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>`;
    list.forEach((p, i) => { if (i && p - list[i - 1] > 1) h += '<button class="pager-btn" disabled>…</button>'; h += `<button class="pager-btn ${p === page ? 'is-active' : ''}" data-p="${p}">${p}</button>`; });
    h += `<button class="pager-btn" ${page === pages ? 'disabled' : ''} data-p="${page + 1}" aria-label="Berikutnya"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>`;
    el.innerHTML = h;
    el.onclick = e => { const b = e.target.closest('button[data-p]'); if (b && !b.disabled) go(+b.dataset.p); };
  }

  /* --- Export CSV --- */
  function exportCSV(name, rows) {
    const head = [...FIELDS, 'data_quality_status', 'issue_details'];
    const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head.join(',')].concat(rows.map(r => [...FIELDS.map(f => r[f]), r._review ? 'Needs Review' : 'Valid', r._issues.map(i => i.label).join('; ')].map(q).join(',')));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  /* --- kontrol utama --- */
  function render() {
    const rows = filtered(), s = stats(rows), v = state.view;
    $('#heroSub').textContent = VIEWS[v][1];
    $('#crumb').textContent = VIEWS[v][0];
    document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('is-active', a.dataset.nav === v));
    document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== 'view-' + v);
    $('#navReview').textContent = stats(ALL).review;
    const on = state.area || state.type;
    $('#filterNote').hidden = !on;
    if (on) $('#filterNote').textContent = `Filter aktif: ${[state.area, state.type].filter(Boolean).join(' · ')} — ${num(rows.length)} dari ${num(ALL.length)} record ditampilkan.`;
    if (v === 'overview') renderOverview(rows, s);
    else if (v === 'inventory') renderInventory(rows);
    else if (v === 'quality') renderQuality(rows, s);
    else renderExplorer();
  }
  function route() { const h = location.hash.slice(1); state.view = VIEWS[h] ? h : 'overview'; document.body.classList.remove('has-drawer-open'); render(); window.scrollTo({ top: 0 }); }

  $('#fArea').onchange = e => { state.area = e.target.value; qs.page = 1; es.page = 1; render(); };
  $('#fType').onchange = e => { state.type = e.target.value; qs.page = 1; es.page = 1; render(); };
  $('#fReset').onclick = () => { state.area = state.type = ''; $('#fArea').value = $('#fType').value = ''; qs.page = es.page = 1; render(); };
  $('#eSearch').oninput = e => { es.q = e.target.value.trim(); es.page = 1; renderExplorer(); };
  $('#eQ').onchange = e => { es.quality = e.target.value; es.page = 1; renderExplorer(); };
  $('#ePer').onchange = e => { es.per = +e.target.value; es.page = 1; renderExplorer(); };
  $('#eExport').onclick = () => exportCSV('inventory_explorer_export.csv', explorerRows());
  $('#qExport').onclick = () => exportCSV('data_perlu_diperiksa.csv', filtered().filter(r => r._review));
  document.addEventListener('click', e => { if (e.target.closest('[data-drawer-open]')) document.body.classList.add('has-drawer-open'); });
  $('.drawer-backdrop').onclick = () => document.body.classList.remove('has-drawer-open');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('has-drawer-open'); });
  window.addEventListener('hashchange', route);
  $('#footMeta').textContent = `Sumber: inventory_simulasi.csv · ${num(ALL.length)} record`;
  /* --- layar loading: tampil sampai font, data, dan grafik selesai --- */
  const loader = $('#loader'), fill = $('#loaderFill'), msg = $('#loaderMsg');
  const step = (p, t) => { fill.style.width = p + '%'; if (t) msg.textContent = t; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  (async function boot() {
    let done = false;
    const finish = () => { if (done) return; done = true; step(100, 'Selesai'); loader.classList.add('is-done'); document.body.classList.remove('is-loading'); setTimeout(() => loader.remove(), 600); };
    setTimeout(finish, 9000);                                   // pengaman agar tidak menggantung
    try {
      step(25, 'Memuat font & tampilan');
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, wait(2500)]);
      step(55, 'Menghitung indikator dari dataset');
      await frame(); route();
      step(80, 'Menggambar grafik');
      await frame(); await wait(750);                           // tunggu animasi grafik selesai
    } catch (e) { console.error(e); try { route(); } catch (_) {} }
    finish();
  })();
})();

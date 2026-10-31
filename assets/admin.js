// =====================================================================
//  Administration
// =====================================================================
(async function () {
  'use strict';
  const O = window.OTT;
  const esc = O.esc;
  const ctx = await O.init({ page: 'admin', minRole: 'admin' });
  if (!ctx) return;
  const sb = O.sb;

  // ---------- shell ----------
  const SECTIONS = [
    ['grp', 'Records'],
    ['personnel', 'Personnel'],
    ['records', 'Training records'],
    ['grp', 'Set-up'],
    ['courses', 'Courses'],
    ['functions', 'Job functions'],
    ['matrix', 'Training matrix'],
    ['grp', 'System'],
    ['access', 'Access & roles'],
    ['import', 'Import CSV']
  ];
  O.$('#app').innerHTML =
    '<div class="admin-shell">' +
      '<nav class="side" aria-label="Admin sections">' +
        SECTIONS.map((s) => s[0] === 'grp' ? '<div class="grp">' + s[1] + '</div>' : '<button data-sec="' + s[0] + '">' + s[1] + '</button>').join('') +
      '</nav>' +
      '<div class="admin-main" id="main"></div>' +
    '</div>';
  const main = O.$('#main');
  const dlg = O.$('#dlg');

  // ---------- reference data cache ----------
  const REF = { fns: [], courses: [], people: [] };
  async function loadRef() {
    const [fns, courses, people] = await Promise.all([
      O.fetchAll(() => sb.from('job_functions').select('*').order('sort_order').order('name')),
      O.fetchAll(() => sb.from('courses').select('*').order('sort_order').order('abbreviation')),
      O.fetchAll(() => sb.from('personnel').select('id,employee_no,full_name,status,job_function_id').order('full_name'))
    ]);
    REF.fns = fns; REF.courses = courses; REF.people = people;
  }
  const fnName = (id) => (REF.fns.find((f) => f.id === id) || {}).name || '—';
  const course = (id) => REF.courses.find((c) => c.id === id) || { abbreviation: '?', name: '?' };
  const person = (id) => REF.people.find((p) => p.id === id) || { full_name: '?', employee_no: '?' };

  // ---------- dialog helpers ----------
  function openDialog(title, bodyHtml, footHtml) {
    dlg.innerHTML =
      '<div class="modal-head"><h2 id="dlgTitle">' + esc(title) + '</h2><button class="icon-btn" data-close aria-label="Close">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '');
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    return dlg;
  }

  function fieldHtml(f, v) {
    const id = 'f_' + f.k;
    const lbl = '<span class="' + (f.req ? 'req' : '') + '">' + esc(f.label) + '</span>';
    const common = ' id="' + id + '" name="' + f.k + '"' + (f.req ? ' required' : '') + (f.readonly ? ' readonly' : '');
    const cls = f.wide ? ' span-all' : '';
    if (f.type === 'checkbox') return '<label class="check' + cls + '"><input type="checkbox"' + common + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
    if (f.type === 'textarea') return '<label class="field span-all">' + lbl + '<textarea' + common + '>' + esc(v) + '</textarea></label>';
    if (f.type === 'select') {
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      return '<label class="field' + cls + '">' + lbl + '<select' + common + '>' + (f.req ? '' : '<option value="">—</option>') +
        opts.map((o) => { const val = Array.isArray(o) ? o[0] : o, txt = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (String(v ?? '') === String(val) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }).join('') +
        '</select></label>';
    }
    return '<label class="field' + cls + '">' + lbl + '<input type="' + (f.type || 'text') + '"' + common +
      (f.step ? ' step="' + f.step + '"' : '') + (f.min != null ? ' min="' + f.min + '"' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
      (f.list ? ' list="' + f.list + '"' : '') + ' value="' + esc(v ?? '') + '"></label>' + (f.help ? '<div class="small muted' + cls + '" style="margin-top:-8px">' + esc(f.help) + '</div>' : '');
  }

  function readForm(fields) {
    const out = {};
    fields.forEach((f) => {
      const el = dlg.querySelector('#f_' + f.k);
      if (!el || f.virtual) return;
      if (f.type === 'checkbox') out[f.k] = el.checked;
      else if (f.type === 'number') out[f.k] = el.value === '' ? null : Number(el.value);
      else { const v = el.value.trim(); out[f.k] = v === '' ? null : v; }
    });
    return out;
  }

  // ---------- generic list + form engine ----------
  // cfg: { table, key, title, singular, intro, select, order, cols, fields, search, filters, beforeSave, afterForm, rowActions, headerActions, onSaved, canDelete, deleteHook }
  async function listView(cfg) {
    main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
    let rows;
    try {
      rows = await O.fetchAll(() => {
        let q = sb.from(cfg.table).select(cfg.select || '*');
        (cfg.order || []).forEach((o) => { q = q.order(o[0], { ascending: o[1] !== false }); });
        return q;
      });
    } catch (e) { main.innerHTML = '<div class="card">' + esc(O.friendlyError(e)) + '</div>'; return; }
    if (cfg.prepare) rows.forEach(cfg.prepare);
    if (cfg.beforeRender) cfg.beforeRender(rows);

    const filters = cfg.filters || [];
    main.innerHTML =
      '<div class="page-head"><div><h1>' + esc(cfg.title) + '</h1>' + (cfg.intro ? '<p>' + cfg.intro + '</p>' : '') + '</div>' +
        '<div class="toolbar">' + (cfg.headerActions || '') + '<button class="btn btn-primary" id="addBtn">+ Add ' + esc(cfg.singular) + '</button></div></div>' +
      '<div class="toolbar">' +
        '<label class="field" style="flex:1 1 260px">Search<input type="search" id="lq" placeholder="Search…"></label>' +
        filters.map((f, i) => '<label class="field" style="flex:0 1 200px">' + esc(f.label) + '<select data-fi="' + i + '"><option value="">All</option>' +
          f.options().map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></label>').join('') +
      '</div>' +
      '<div class="card" style="padding:0"><div class="table-wrap" style="max-height:68vh"><table class="data"><thead><tr>' +
        cfg.cols.map((c) => '<th>' + esc(c.label) + '</th>').join('') + '<th><span class="sr-only">Actions</span></th>' +
      '</tr></thead><tbody id="lbody"></tbody></table></div></div>' +
      '<div class="small muted" id="lcount"></div>';

    let limit = 300;
    const fv = filters.map(() => '');
    function visible() {
      const q = O.$('#lq').value.trim().toLowerCase();
      return rows.filter((r) =>
        (!q || cfg.search.some((k) => String(typeof k === 'function' ? k(r) : r[k] ?? '').toLowerCase().includes(q))) &&
        filters.every((f, i) => !fv[i] || String(f.value(r)) === fv[i]));
    }
    function draw() {
      const list = visible();
      O.$('#lbody').innerHTML = list.slice(0, limit).map((r) =>
        '<tr>' + cfg.cols.map((c) => '<td>' + (c.fmt ? c.fmt(r[c.k], r) : esc(r[c.k] ?? '—')) + '</td>').join('') +
        '<td style="text-align:right;white-space:nowrap">' + (cfg.rowActions ? cfg.rowActions(r) : '') +
        '<button class="btn btn-sm" data-edit="' + esc(r[cfg.key]) + '">Edit</button></td></tr>').join('') ||
        '<tr><td colspan="' + (cfg.cols.length + 1) + '" class="empty">Nothing here yet.</td></tr>';
      O.$('#lcount').innerHTML = 'Showing ' + Math.min(limit, list.length) + ' of ' + list.length +
        (list.length > limit ? ' · <button class="btn-link" id="lmore">show more</button>' : '');
      const m = O.$('#lmore'); if (m) m.addEventListener('click', () => { limit += 500; draw(); });
    }
    O.$('#lq').addEventListener('input', O.debounce(draw, 150));
    O.$$('[data-fi]').forEach((s) => s.addEventListener('change', () => { fv[Number(s.dataset.fi)] = s.value; draw(); }));
    O.$('#addBtn').addEventListener('click', () => openForm(cfg, null));
    O.$('#lbody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (b) openForm(cfg, rows.find((r) => String(r[cfg.key]) === b.dataset.edit));
    });
    draw();
    cfg._visible = visible;
    cfg._rows = rows;
    if (cfg.afterList) cfg.afterList(rows, visible);
    return rows;
  }

  function openForm(cfg, row) {
    const isNew = !row;
    const fields = cfg.fields.filter((f) => !(f.newOnly && !isNew));
    const body = (cfg.formTop ? cfg.formTop(row) : '') +
      '<form id="frm" class="form-grid" novalidate>' + fields.map((f) => fieldHtml(Object.assign({}, f, { readonly: f.readonly || (f.lockOnEdit && !isNew) }), row ? row[f.k] : f.default)).join('') + '</form>' +
      (cfg.formBottom ? cfg.formBottom(row) : '');
    const foot =
      (!isNew && cfg.canDelete !== false ? '<button class="btn btn-danger" id="delBtn">Delete</button>' : '') +
      '<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="saveBtn">' + (isNew ? 'Add ' + esc(cfg.singular) : 'Save changes') + '</button></div>';
    openDialog((isNew ? 'Add ' : 'Edit ') + cfg.singular, body, foot);
    const state = {};
    if (cfg.afterForm) cfg.afterForm(row, state);

    O.$('#saveBtn', dlg).addEventListener('click', async () => {
      const frm = O.$('#frm', dlg);
      if (!frm.reportValidity()) return;
      let payload = readForm(fields);
      if (cfg.beforeSave) { payload = await cfg.beforeSave(payload, row, state); if (!payload) return; }
      const btn = O.$('#saveBtn', dlg); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        let saved;
        if (isNew) {
          const { data, error } = await sb.from(cfg.table).insert(payload).select().single();
          if (error) throw error; saved = data;
        } else {
          const { data, error } = await sb.from(cfg.table).update(payload).eq(cfg.key, row[cfg.key]).select().single();
          if (error) throw error; saved = data;
        }
        if (cfg.onSaved) await cfg.onSaved(saved, row, state);
        dlg.close();
        O.toast((isNew ? 'Added' : 'Saved') + ' ' + cfg.singular + '.');
        await loadRef();
        route();
      } catch (e) {
        O.toast(O.friendlyError(e), 'error');
        btn.disabled = false; btn.textContent = isNew ? 'Add ' + cfg.singular : 'Save changes';
      }
    });

    const del = O.$('#delBtn', dlg);
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Delete this ' + cfg.singular + '? This cannot be undone.' + (cfg.deleteWarning ? '\n\n' + cfg.deleteWarning : ''))) return;
      try {
        if (cfg.beforeDelete) await cfg.beforeDelete(row);
        const { error } = await sb.from(cfg.table).delete().eq(cfg.key, row[cfg.key]);
        if (error) throw error;
        if (cfg.afterDelete) await cfg.afterDelete(row);
        dlg.close(); O.toast('Deleted.');
        await loadRef(); route();
      } catch (e) { O.toast(O.friendlyError(e), 'error'); }
    });
    return state;
  }

  const yesNo = (v) => v ? '<span class="pill pill-valid">Yes</span>' : '<span class="pill pill-plain">No</span>';

  // =================================================================
  //  PERSONNEL
  // =================================================================
  function qrDataUrl(text, size) {
    const holder = document.createElement('div');
    new QRCode(holder, { text, width: size || 256, height: size || 256, correctLevel: QRCode.CorrectLevel.M });
    const c = holder.querySelector('canvas');
    return c ? c.toDataURL('image/png') : (holder.querySelector('img') || {}).src;
  }
  const qrLink = (id) => O.personUrl(id) + '&qr=1';

  async function printBadges(list) {
    if (!list.length) { O.toast('No people to print.'); return; }
    if (list.length > 300 && !confirm('Print ' + list.length + ' badges?')) return;
    const urls = await O.photoUrls(list.map((p) => p.photo_path));
    const w = window.open('', '_blank');
    if (!w) { O.toast('Allow pop-ups to print badges.', 'error'); return; }
    const cards = list.map((p) =>
      '<div class="b"><div class="top">' + esc(O.C.APP_NAME) + '</div><div class="mid">' +
      (urls[p.photo_path] ? '<img class="ph" src="' + esc(urls[p.photo_path]) + '" alt="">' : '<div class="ph">' + esc(O.initials(p.full_name)) + '</div>') +
      '<div><div class="nm">' + esc(p.full_name) + '</div><div class="en">' + esc(p.employee_no) + '</div><div class="ps">' + esc(p.position || '') + '</div></div></div>' +
      '<div class="qr"><img src="' + qrDataUrl(qrLink(p.id), 220) + '" alt=""><span>Scan to view training record</span></div></div>').join('');
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>QR badges</title><style>' +
      '@page{size:A4;margin:10mm}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#16201C}' +
      '.grid{display:grid;grid-template-columns:repeat(3,54mm);gap:6mm;justify-content:center}' +
      '.b{width:54mm;height:86mm;border:0.3mm solid #999;border-radius:3mm;overflow:hidden;display:flex;flex-direction:column;break-inside:avoid}' +
      '.top{background:#16201C;color:#fff;font-size:8pt;font-weight:600;padding:2mm 3mm}' +
      '.mid{display:flex;gap:2.5mm;padding:2.5mm 3mm;align-items:center}' +
      '.ph{width:16mm;height:20mm;object-fit:cover;border-radius:1.5mm;background:#D5DBD6;display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}' +
      '.nm{font-size:9pt;font-weight:700;line-height:1.15}.en{font-family:Consolas,monospace;font-size:7.5pt;margin-top:1mm}.ps{font-size:7pt;color:#4A5752;margin-top:.5mm}' +
      '.qr{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;padding-bottom:2mm}.qr img{width:38mm;height:38mm}.qr span{font-size:6.5pt;color:#4A5752}' +
      '</style></head><body><div class="grid">' + cards + '</div><script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>');
    w.document.close();
  }

  async function processPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const W = 480, H = 600, ratio = W / H;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (sw / sh > ratio) { const nw = sh * ratio; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / ratio; sy = (sh - nh) / 4; sh = nh; } // bias towards top (faces)
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
    } finally { URL.revokeObjectURL(url); }
  }

  const PERSONNEL = {
    table: 'personnel', key: 'id', title: 'Personnel', singular: 'person',
    intro: 'People whose training is tracked. The job function decides which courses are mandatory.',
    order: [['full_name']],
    prepare: (r) => { r._fn = fnName(r.job_function_id); },
    search: ['employee_no', 'full_name', 'position', 'department', 'employer', '_fn'],
    filters: [
      { label: 'Job function', options: () => REF.fns.map((f) => [f.id, f.name]), value: (r) => r.job_function_id || '' },
      { label: 'Department', options: () => [...new Set(REF._depts || [])].map((d) => [d, d]), value: (r) => r.department || '' },
      { label: 'Status', options: () => [['Active', 'Active'], ['Inactive', 'Inactive']], value: (r) => r.status }
    ],
    cols: [
      { k: 'employee_no', label: 'Employee no.', fmt: (v) => '<span class="mono">' + esc(v) + '</span>' },
      { k: 'full_name', label: 'Name', fmt: (v, r) => '<a href="person.html?id=' + r.id + '" target="_blank" rel="noopener" style="font-weight:600;text-decoration:none">' + esc(v) + '</a>' },
      { k: 'position', label: 'Position' },
      { k: '_fn', label: 'Job function' },
      { k: 'department', label: 'Department' },
      { k: 'employer', label: 'Employer' },
      { k: 'status', label: 'Status', fmt: (v) => v === 'Active' ? '<span class="pill pill-valid">Active</span>' : '<span class="pill pill-plain">Inactive</span>' }
    ],
    headerActions: '<button class="btn" id="badgesBtn">Print QR badges (filtered)</button>',
    beforeRender: (rows) => { REF._depts = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort(); },
    afterList: (rows, visible) => { O.$('#badgesBtn').addEventListener('click', () => printBadges(visible())); },
    fields: [
      { k: 'employee_no', label: 'Employee no.', req: true },
      { k: 'full_name', label: 'Full name', req: true },
      { k: 'position', label: 'Position / title' },
      { k: 'job_function_id', label: 'Job function', type: 'select', options: () => REF.fns.filter((f) => f.active).map((f) => [f.id, f.name]) },
      { k: 'department', label: 'Department', list: 'deptList' },
      { k: 'section', label: 'Section / unit' },
      { k: 'employer', label: 'Employer (company or contractor)', list: 'empList' },
      { k: 'email', label: 'Email', type: 'email' },
      { k: 'phone', label: 'Phone', type: 'tel' },
      { k: 'date_joined', label: 'Date joined', type: 'date' },
      { k: 'status', label: 'Status', type: 'select', req: true, options: ['Active', 'Inactive'], default: 'Active' },
      { k: 'notes', label: 'Notes', type: 'textarea' }
    ],
    formTop: (row) =>
      '<div class="photo-edit"><div id="phPrev">' + O.photoHtml(null, row ? row.full_name : '?') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<label class="btn" style="align-self:flex-start">Choose photo<input type="file" id="phFile" accept="image/*" class="sr-only"></label>' +
        (row && row.photo_path ? '<button type="button" class="btn-link" id="phRemove" style="align-self:flex-start">Remove photo</button>' : '') +
        '<span class="small muted">Cropped to 4:5 and resized automatically.</span>' +
      '</div></div>' +
      '<datalist id="deptList">' + (REF._depts || []).map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>' +
      '<datalist id="empList">' + [...new Set((PERSONNEL._rows || []).map((r) => r.employer).filter(Boolean))].map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>',
    formBottom: (row) => row ?
      '<h3 style="margin:20px 0 10px;font-size:14px">QR code</h3><div class="qr-box"><div id="qrHere"></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;min-width:0;flex:1">' +
        '<div class="mono small" style="word-break:break-all">' + esc(qrLink(row.id)) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-sm" id="qrCopy">Copy link</button>' +
          '<button type="button" class="btn btn-sm" id="qrDl">Download PNG</button>' +
          '<button type="button" class="btn btn-sm" id="qrBadge">Print badge</button>' +
          '<button type="button" class="btn btn-sm" id="recAdd">+ Training record</button>' +
        '</div></div></div>' : '',
    afterForm: async (row, state) => {
      O.$('#phFile', dlg).addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        state.file = f; state.remove = false;
        O.$('#phPrev', dlg).innerHTML = '<img class="photo" alt="New photo preview" src="' + URL.createObjectURL(f) + '">';
      });
      const rm = O.$('#phRemove', dlg);
      if (rm) rm.addEventListener('click', () => { state.remove = true; state.file = null; O.$('#phPrev', dlg).innerHTML = O.photoHtml(null, row.full_name); });
      if (row) {
        if (row.photo_path) { const u = await O.photoUrls([row.photo_path]); if (u[row.photo_path] && !state.file && !state.remove) O.$('#phPrev', dlg).innerHTML = O.photoHtml(u[row.photo_path], row.full_name); }
        const data = qrDataUrl(qrLink(row.id), 256);
        O.$('#qrHere', dlg).innerHTML = '<img src="' + data + '" alt="QR code for ' + esc(row.full_name) + '">';
        O.$('#qrCopy', dlg).addEventListener('click', async () => { try { await navigator.clipboard.writeText(qrLink(row.id)); O.toast('Link copied.'); } catch (_) { O.toast('Could not copy.', 'error'); } });
        O.$('#qrDl', dlg).addEventListener('click', () => { const a = document.createElement('a'); a.href = qrDataUrl(qrLink(row.id), 512); a.download = 'QR-' + row.employee_no + '.png'; a.click(); });
        O.$('#qrBadge', dlg).addEventListener('click', () => printBadges([row]));
        O.$('#recAdd', dlg).addEventListener('click', () => { dlg.close(); openForm(RECORDS, null); const sel = O.$('#f_person_pick', dlg); if (sel) { sel.value = row.employee_no + ' — ' + row.full_name; sel.dispatchEvent(new Event('input')); } });
      }
    },
    onSaved: async (saved, row, state) => {
      const old = row && row.photo_path;
      if (state.file) {
        const blob = await processPhoto(state.file);
        const path = saved.id + '/' + Date.now() + '.jpg';
        const up = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (up.error) throw up.error;
        const { error } = await sb.from('personnel').update({ photo_path: path }).eq('id', saved.id);
        if (error) throw error;
        if (old) await sb.storage.from('photos').remove([old]);
      } else if (state.remove && old) {
        await sb.from('personnel').update({ photo_path: null }).eq('id', saved.id);
        await sb.storage.from('photos').remove([old]);
      }
    },
    deleteWarning: 'All of this person’s training records will be deleted too. To keep history, set Status to Inactive instead.',
    afterDelete: async (row) => { if (row.photo_path) await sb.storage.from('photos').remove([row.photo_path]); }
  };

  // =================================================================
  //  TRAINING RECORDS
  // =================================================================
  const personLabel = (p) => p.employee_no + ' — ' + p.full_name;
  const RECORDS = {
    table: 'training_records', key: 'id', title: 'Training records', singular: 'training record',
    intro: 'Completed training for any course, mandatory or not. Expiry fills in from the course validity; you can override it.',
    select: 'id,person_id,course_id,completion_date,expiry_date,certificate_no,provider,remarks,updated_by,updated_at',
    order: [['completion_date', false]],
    prepare: (r) => { const p = person(r.person_id), c = course(r.course_id); r._emp = p.employee_no; r._name = p.full_name; r._abbr = c.abbreviation; r._course = c.name; r._st = statusOf(r.expiry_date); },
    search: ['_emp', '_name', '_abbr', '_course', 'certificate_no', 'provider'],
    filters: [
      { label: 'Course', options: () => REF.courses.map((c) => [c.id, c.abbreviation + ' — ' + c.name]), value: (r) => r.course_id },
      { label: 'Expiry', options: () => [['Valid', 'Valid'], ['Due soon', 'Due soon'], ['Expired', 'Expired']], value: (r) => r._st }
    ],
    cols: [
      { k: '_name', label: 'Person', fmt: (v, r) => '<a href="person.html?id=' + r.person_id + '" target="_blank" rel="noopener" style="font-weight:600;text-decoration:none">' + esc(v) + '</a><div class="small muted mono">' + esc(r._emp) + '</div>' },
      { k: '_abbr', label: 'Course', fmt: (v, r) => '<span class="abbr">' + esc(v) + '</span> <span class="muted">' + esc(r._course) + '</span>' },
      { k: 'completion_date', label: 'Completed', fmt: (v) => O.fmtDate(v) },
      { k: 'expiry_date', label: 'Expires', fmt: (v) => v ? O.fmtDate(v) : 'No expiry' },
      { k: '_st', label: 'Status', fmt: (v) => O.pill(v) },
      { k: 'certificate_no', label: 'Certificate' },
      { k: 'updated_by', label: 'Last edited by', fmt: (v, r) => '<span class="small">' + esc(v || '—') + '</span>' }
    ],
    fields: [
      { k: 'person_pick', label: 'Person', req: true, list: 'peopleList', placeholder: 'Type employee no. or name', virtual: true, wide: true },
      { k: 'course_id', label: 'Course', type: 'select', req: true, options: () => REF.courses.filter((c) => c.active).map((c) => [c.id, c.abbreviation + ' — ' + c.name]) },
      { k: 'completion_date', label: 'Completion date', type: 'date', req: true },
      { k: 'expiry_date', label: 'Expiry date', type: 'date', help: 'Leave as filled for the standard validity, or change it.' },
      { k: 'certificate_no', label: 'Certificate no.' },
      { k: 'provider', label: 'Trainer / provider' },
      { k: 'remarks', label: 'Remarks', type: 'textarea' }
    ],
    formTop: () => '<datalist id="peopleList">' + REF.people.map((p) => '<option value="' + esc(personLabel(p)) + '">').join('') + '</datalist>',
    afterForm: (row, state) => {
      const pick = O.$('#f_person_pick', dlg), cSel = O.$('#f_course_id', dlg), comp = O.$('#f_completion_date', dlg), exp = O.$('#f_expiry_date', dlg);
      if (row) { const p = person(row.person_id); pick.value = personLabel(p); }
      if (!row) cSel.value = '';
      state.expTouched = !!(row && row.expiry_date && row.expiry_date !== O.addMonths(row.completion_date, course(row.course_id).validity_months));
      exp.addEventListener('input', () => { state.expTouched = true; });
      const recalc = () => {
        if (state.expTouched) return;
        const c = REF.courses.find((x) => x.id === cSel.value);
        exp.value = c && c.validity_months && comp.value ? O.addMonths(comp.value, c.validity_months) : '';
      };
      cSel.addEventListener('change', recalc); comp.addEventListener('change', recalc);
      pick.addEventListener('input', () => pick.setCustomValidity(''));
    },
    beforeSave: (payload, row) => {
      const pick = O.$('#f_person_pick', dlg);
      const p = REF.people.find((x) => personLabel(x) === pick.value.trim()) || REF.people.find((x) => x.employee_no.toLowerCase() === pick.value.trim().toLowerCase());
      if (!p) { pick.setCustomValidity('Pick a person from the list.'); pick.reportValidity(); return null; }
      payload.person_id = p.id;
      const c = REF.courses.find((x) => x.id === payload.course_id);
      if (!payload.expiry_date && c && c.validity_months) payload.expiry_date = O.addMonths(payload.completion_date, c.validity_months);
      if (payload.expiry_date && payload.expiry_date < payload.completion_date) { O.toast('Expiry date is before completion date.', 'error'); return null; }
      return payload;
    }
  };
  function statusOf(exp) {
    if (!exp) return 'Valid';
    const n = O.daysUntil(exp);
    return n < 0 ? 'Expired' : n <= O.C.DUE_SOON_DAYS ? 'Due soon' : 'Valid';
  }

  // =================================================================
  //  COURSES & JOB FUNCTIONS
  // =================================================================
  const COURSES = {
    table: 'courses', key: 'id', title: 'Courses', singular: 'course',
    intro: 'The course list. Validity sets how long a completion stays in date; leave it empty for courses that never expire.',
    order: [['sort_order'], ['abbreviation']],
    search: ['abbreviation', 'name', 'category', 'provider'],
    filters: [{ label: 'Active', options: () => [['true', 'Active'], ['false', 'Inactive']], value: (r) => String(r.active) }],
    cols: [
      { k: 'abbreviation', label: 'Abbr.', fmt: (v) => '<span class="abbr">' + esc(v) + '</span>' },
      { k: 'name', label: 'Course name', fmt: (v) => '<strong>' + esc(v) + '</strong>' },
      { k: 'category', label: 'Category' },
      { k: 'validity_months', label: 'Validity', fmt: (v) => v ? v + ' months' : 'No expiry' },
      { k: 'delivery_method', label: 'Delivery' },
      { k: 'duration_hours', label: 'Hours' },
      { k: 'active', label: 'Active', fmt: yesNo }
    ],
    fields: [
      { k: 'abbreviation', label: 'Abbreviation', req: true, placeholder: 'e.g. H2S' },
      { k: 'name', label: 'Course name', req: true },
      { k: 'category', label: 'Category', type: 'select', options: ['HSE', 'Technical', 'Induction', 'Emergency response', 'Leadership', 'Other'] },
      { k: 'validity_months', label: 'Validity (months)', type: 'number', min: 1, help: 'Empty = never expires' },
      { k: 'delivery_method', label: 'Delivery', type: 'select', options: ['Classroom', 'Online', 'Practical', 'Blended', 'On-the-job'] },
      { k: 'duration_hours', label: 'Duration (hours)', type: 'number', step: '0.5', min: 0 },
      { k: 'provider', label: 'Usual provider' },
      { k: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
      { k: 'description', label: 'Description', type: 'textarea' },
      { k: 'active', label: 'Active', type: 'checkbox', default: true }
    ],
    beforeSave: (p) => { p.abbreviation = p.abbreviation.toUpperCase(); if (p.sort_order == null) p.sort_order = 0; return p; },
    deleteWarning: 'Courses with training records cannot be deleted — untick Active instead.'
  };

  const FUNCTIONS = {
    table: 'job_functions', key: 'id', title: 'Job functions', singular: 'job function',
    intro: 'Job functions are the columns of the training matrix. Each person has one.',
    order: [['sort_order'], ['name']],
    prepare: (r) => { r._n = REF.people.filter((p) => p.job_function_id === r.id && p.status === 'Active').length; },
    search: ['name', 'description'],
    cols: [
      { k: 'name', label: 'Job function', fmt: (v) => '<strong>' + esc(v) + '</strong>' },
      { k: 'description', label: 'Description' },
      { k: '_n', label: 'Active people', fmt: (v) => '<span class="mono">' + v + '</span>' },
      { k: 'sort_order', label: 'Order' },
      { k: 'active', label: 'Active', fmt: yesNo }
    ],
    fields: [
      { k: 'name', label: 'Name', req: true },
      { k: 'sort_order', label: 'Sort order', type: 'number', default: 0 },
      { k: 'description', label: 'Description', type: 'textarea' },
      { k: 'active', label: 'Active', type: 'checkbox', default: true }
    ],
    beforeSave: (p) => { if (p.sort_order == null) p.sort_order = 0; return p; },
    deleteWarning: 'People with this job function will be left without one, and its matrix column is removed.'
  };

  // =================================================================
  //  ACCESS & ROLES
  // =================================================================
  const ROLE_TEXT = { viewer: 'Viewer — all person pages', manager: 'Manager — + report & people directory', admin: 'Admin — + administration' };
  const ACCESS = {
    table: 'app_users', key: 'email', title: 'Access & roles', singular: 'user',
    intro: 'Only Google accounts listed here can sign in. Use the exact Gmail / Google Workspace address the person signs in with. Untick Active to suspend access without deleting.',
    order: [['email']],
    search: ['email', 'full_name', 'role'],
    filters: [
      { label: 'Role', options: () => [['viewer', 'Viewer'], ['manager', 'Manager'], ['admin', 'Admin']], value: (r) => r.role },
      { label: 'Active', options: () => [['true', 'Active'], ['false', 'Suspended']], value: (r) => String(r.active) }
    ],
    cols: [
      { k: 'email', label: 'Google account', fmt: (v) => '<span class="mono">' + esc(v) + '</span>' + (v === ctx.email.toLowerCase() ? ' <span class="pill pill-plain">you</span>' : '') },
      { k: 'full_name', label: 'Name' },
      { k: 'role', label: 'Role', fmt: (v) => '<span class="pill ' + (v === 'admin' ? 'pill-expired' : v === 'manager' ? 'pill-due' : 'pill-valid') + '">' + esc(v) + '</span>' },
      { k: 'active', label: 'Access', fmt: (v) => v ? '<span class="pill pill-valid">Active</span>' : '<span class="pill pill-plain">Suspended</span>' },
      { k: 'created_at', label: 'Added', fmt: (v) => O.fmtDate(v) }
    ],
    headerActions: '<button class="btn" id="bulkUsers">Add several</button>',
    afterList: () => O.$('#bulkUsers').addEventListener('click', bulkUsers),
    fields: [
      { k: 'email', label: 'Google account email', type: 'email', req: true, lockOnEdit: true, wide: true, placeholder: 'name@gmail.com' },
      { k: 'full_name', label: 'Name' },
      { k: 'role', label: 'Role', type: 'select', req: true, default: 'viewer', options: () => Object.entries(ROLE_TEXT) },
      { k: 'active', label: 'Active (can sign in)', type: 'checkbox', default: true }
    ],
    beforeSave: (p, row) => {
      if (p.email) p.email = p.email.toLowerCase();
      if (row) delete p.email;
      const me = ctx.email.toLowerCase();
      if (row && row.email === me && (p.role !== 'admin' || !p.active) && !confirm('You are removing your own admin access. You will be signed out of Admin. Continue?')) return null;
      return p;
    },
    onSaved: async (saved, row) => { if (row && row.email === ctx.email.toLowerCase() && (saved.role !== 'admin' || !saved.active)) location.href = 'index.html'; },
    beforeDelete: async (row) => { if (row.email === ctx.email.toLowerCase()) throw new Error('You cannot delete your own access. Ask another admin.'); }
  };

  function bulkUsers() {
    openDialog('Add several users',
      '<p class="muted" style="margin-top:0">One Google email per line. Optionally add a comma and the name: <span class="mono">name@gmail.com, Full Name</span></p>' +
      '<label class="field">Emails<textarea id="bulkList" rows="8" placeholder="first.person@gmail.com, First Person&#10;second.person@gmail.com"></textarea></label>' +
      '<label class="field" style="margin-top:12px">Role for all<select id="bulkRole">' + Object.entries(ROLE_TEXT).map((r) => '<option value="' + r[0] + '">' + esc(r[1]) + '</option>').join('') + '</select></label>',
      '<div class="right"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bulkGo">Add users</button></div>');
    O.$('#bulkGo', dlg).addEventListener('click', async () => {
      const role = O.$('#bulkRole', dlg).value;
      const rows = O.$('#bulkList', dlg).value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [email, ...name] = l.split(','); return { email: email.trim().toLowerCase(), full_name: name.join(',').trim() || null, role, active: true };
      });
      const bad = rows.filter((r) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
      if (!rows.length) return;
      if (bad.length) { O.toast('Not valid emails: ' + bad.map((b) => b.email).join(', '), 'error'); return; }
      const { error } = await sb.from('app_users').upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
      if (error) { O.toast(O.friendlyError(error), 'error'); return; }
      dlg.close(); O.toast(rows.length + ' user(s) added. Existing emails were left unchanged.'); route();
    });
  }

  // =================================================================
  //  TRAINING MATRIX
  // =================================================================
  let matrixHandler = null;
  async function matrixView() {
    if (matrixHandler) { main.removeEventListener('click', matrixHandler); matrixHandler = null; }
    main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading matrix…</div>';
    let links;
    try { links = await O.fetchAll(() => sb.from('training_matrix').select('job_function_id,course_id')); }
    catch (e) { main.innerHTML = '<div class="card">' + esc(O.friendlyError(e)) + '</div>'; return; }
    const fns = REF.fns.filter((f) => f.active), crs = REF.courses.filter((c) => c.active);
    const key = (f, c) => f + '|' + c;
    const orig = new Set(links.map((l) => key(l.job_function_id, l.course_id)));
    const cur = new Set(orig);

    main.innerHTML =
      '<div class="page-head"><div><h1>Training matrix</h1><p>Click a cell to toggle <strong>M</strong> (mandatory). Saving recalculates everyone’s compliance. Inactive courses and functions are hidden.</p></div>' +
        '<div class="toolbar"><button class="btn" id="mxCsv">Export CSV</button><button class="btn" id="mxUndo" disabled>Discard changes</button><button class="btn btn-primary" id="mxSave" disabled>Save changes</button></div></div>' +
      '<div class="toolbar"><label class="field" style="flex:0 1 280px">Filter courses<input type="search" id="mxQ" placeholder="Abbreviation or name"></label></div>' +
      (fns.length && crs.length ?
        '<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="corner">Course</th>' +
          fns.map((f) => '<th scope="col">' + esc(f.name) + '</th>').join('') + '</tr></thead><tbody>' +
          crs.map((c) => '<tr data-q="' + esc((c.abbreviation + ' ' + c.name).toLowerCase()) + '"><td class="rowhead"><span class="abbr">' + esc(c.abbreviation) + '</span> ' + esc(c.name) + '</td>' +
            fns.map((f) => { const k = key(f.id, c.id), on = cur.has(k);
              return '<td class="cell"><button class="mcell' + (on ? ' on' : '') + '" data-k="' + k + '" aria-pressed="' + on + '" aria-label="' + esc(c.abbreviation + ' for ' + f.name) + '">' + (on ? 'M' : '') + '</button></td>'; }).join('') +
          '</tr>').join('') +
        '</tbody></table></div>'
        : '<div class="card muted">Add at least one active course and one active job function first.</div>') +
      '<div class="legend-inline"><span><i class="dot" style="background:var(--accent)"></i>Mandatory</span><span><i class="dot" style="outline:2px dashed #9A5B00;background:#fff"></i>Unsaved change</span></div>';

    const changes = () => [...cur].filter((k) => !orig.has(k)).length + [...orig].filter((k) => !cur.has(k)).length;
    const refreshBtns = () => { const n = changes(); O.$('#mxSave').disabled = !n; O.$('#mxUndo').disabled = !n; O.$('#mxSave').textContent = n ? 'Save changes (' + n + ')' : 'Save changes'; };
    matrixHandler = onCell;
    main.addEventListener('click', onCell);
    function onCell(e) {
      if (!O.$('.matrix', main)) return;
      const b = e.target.closest('.mcell'); if (!b) return;
      const k = b.dataset.k;
      if (cur.has(k)) cur.delete(k); else cur.add(k);
      const on = cur.has(k);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.textContent = on ? 'M' : '';
      b.classList.toggle('dirty', on !== orig.has(k));
      refreshBtns();
    }
    O.$('#mxQ').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); O.$$('tr[data-q]').forEach((tr) => tr.classList.toggle('hidden', !!q && !tr.dataset.q.includes(q))); });
    O.$('#mxUndo').addEventListener('click', () => { main.removeEventListener('click', onCell); matrixView(); });
    O.$('#mxSave').addEventListener('click', async () => {
      const add = [...cur].filter((k) => !orig.has(k)).map((k) => { const [f, c] = k.split('|'); return { job_function_id: f, course_id: c }; });
      const del = [...orig].filter((k) => !cur.has(k));
      try {
        if (add.length) { const { error } = await sb.from('training_matrix').insert(add); if (error) throw error; }
        for (const k of del) { const [f, c] = k.split('|'); const { error } = await sb.from('training_matrix').delete().eq('job_function_id', f).eq('course_id', c); if (error) throw error; }
        O.toast('Matrix saved.');
        main.removeEventListener('click', onCell); matrixView();
      } catch (e) { O.toast(O.friendlyError(e), 'error'); }
    });
    O.$('#mxCsv').addEventListener('click', () => {
      O.downloadCsv('training-matrix.csv', ['Course abbr', 'Course'].concat(fns.map((f) => f.name)),
        crs.map((c) => [c.abbreviation, c.name].concat(fns.map((f) => cur.has(key(f.id, c.id)) ? 'M' : ''))));
    });
    refreshBtns();
  }

  // =================================================================
  //  IMPORT CSV
  // =================================================================
  function parseAnyDate(s) {
    if (!s) return null;
    s = s.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);           // DD/MM/YYYY
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/);       // 12 Oct 2026
    if (m) { const i = O.MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); if (i >= 0) return m[3] + '-' + String(i + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    return undefined;                                                   // invalid
  }

  function importView() {
    main.innerHTML =
      '<div class="page-head"><div><h1>Import CSV</h1><p>Bring existing data in from Excel: save the sheet as <strong>CSV UTF-8</strong>, using the template columns. Dates as YYYY-MM-DD or DD/MM/YYYY.</p></div></div>' +
      '<div class="row">' +
        importCard('people', 'Personnel', 'Adds new people and updates existing ones (matched on employee_no). Job function must match a name in Job functions.') +
        importCard('records', 'Training records', 'Adds training records. Person is matched on employee_no, course on its abbreviation. Exact duplicates are skipped.') +
      '</div>';
    bindImport('people', ['employee_no', 'full_name', 'position', 'job_function', 'department', 'section', 'employer', 'email', 'phone', 'date_joined', 'status'], importPeople);
    bindImport('records', ['employee_no', 'course_abbreviation', 'completion_date', 'expiry_date', 'certificate_no', 'provider', 'remarks'], importRecords);
  }
  function importCard(id, title, text) {
    return '<section class="card grow" style="display:flex;flex-direction:column;gap:12px"><h2>' + title + '</h2><p class="muted" style="margin:0">' + text + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="' + id + 'Tpl">Download template</button>' +
      '<label class="btn">Choose CSV file<input type="file" accept=".csv,text/csv" id="' + id + 'File" class="sr-only"></label>' +
      '<button class="btn btn-primary" id="' + id + 'Go" disabled>Import</button></div><div class="import-log hidden" id="' + id + 'Log" aria-live="polite"></div></section>';
  }
  function bindImport(id, cols, run) {
    let parsed = null;
    const log = O.$('#' + id + 'Log');
    O.$('#' + id + 'Tpl').addEventListener('click', () => O.downloadCsv(id + '-template.csv', cols, []));
    O.$('#' + id + 'File').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      parsed = O.parseCsv(await f.text());
      const missing = cols.slice(0, id === 'people' ? 2 : 3).filter((c) => !(parsed[0] && c in parsed[0]));
      log.classList.remove('hidden');
      if (!parsed.length || missing.length) { log.textContent = parsed.length ? 'Missing required columns: ' + missing.join(', ') : 'No rows found.'; O.$('#' + id + 'Go').disabled = true; return; }
      log.textContent = f.name + ': ' + parsed.length + ' rows ready. Press Import.';
      O.$('#' + id + 'Go').disabled = false;
    });
    O.$('#' + id + 'Go').addEventListener('click', async () => {
      if (!parsed) return;
      O.$('#' + id + 'Go').disabled = true;
      try { log.textContent = await run(parsed, (m) => { log.textContent = m; }); }
      catch (err) { log.textContent = 'Stopped: ' + O.friendlyError(err); }
      await loadRef();
    });
  }

  async function importPeople(rows, progress) {
    const fnByName = Object.fromEntries(REF.fns.map((f) => [f.name.toLowerCase(), f.id]));
    const errors = [], good = [], seen = new Set();
    rows.forEach((r, i) => {
      const line = i + 2;
      if (!r.employee_no || !r.full_name) { errors.push('Row ' + line + ': employee_no and full_name are required'); return; }
      if (seen.has(r.employee_no)) { errors.push('Row ' + line + ': duplicate employee_no ' + r.employee_no + ' in file'); return; }
      seen.add(r.employee_no);
      let fid = null;
      if (r.job_function) { fid = fnByName[r.job_function.toLowerCase()]; if (!fid) { errors.push('Row ' + line + ': unknown job function "' + r.job_function + '"'); return; } }
      const dj = parseAnyDate(r.date_joined);
      if (dj === undefined) { errors.push('Row ' + line + ': bad date_joined "' + r.date_joined + '"'); return; }
      const status = r.status ? (r.status.toLowerCase().startsWith('in') ? 'Inactive' : 'Active') : 'Active';
      const o = { employee_no: r.employee_no, full_name: r.full_name, job_function_id: fid, status };
      ['position', 'department', 'section', 'employer', 'email', 'phone'].forEach((k) => { if (r[k]) o[k] = r[k]; });
      if (dj) o.date_joined = dj;
      good.push(o);
    });
    let done = 0;
    for (let i = 0; i < good.length; i += 500) {
      const chunk = good.slice(i, i + 500);
      const { error } = await sb.from('personnel').upsert(chunk, { onConflict: 'employee_no' });
      if (error) throw error;
      done += chunk.length; progress('Imported ' + done + ' of ' + good.length + '…');
    }
    return 'Done. ' + done + ' people added or updated.' + (errors.length ? '\n\nSkipped ' + errors.length + ':\n' + errors.join('\n') : '');
  }

  async function importRecords(rows, progress) {
    const pByEmp = Object.fromEntries(REF.people.map((p) => [p.employee_no.toLowerCase(), p.id]));
    const cByAbbr = Object.fromEntries(REF.courses.map((c) => [c.abbreviation.toLowerCase(), c]));
    progress('Checking existing records…');
    const existing = new Set((await O.fetchAll(() => sb.from('training_records').select('person_id,course_id,completion_date'))).map((r) => r.person_id + '|' + r.course_id + '|' + r.completion_date));
    const errors = [], good = []; let dup = 0;
    rows.forEach((r, i) => {
      const line = i + 2;
      const pid = pByEmp[(r.employee_no || '').toLowerCase()];
      const c = cByAbbr[(r.course_abbreviation || '').toLowerCase()];
      const cd = parseAnyDate(r.completion_date), ed = parseAnyDate(r.expiry_date);
      if (!pid) { errors.push('Row ' + line + ': unknown employee_no "' + r.employee_no + '"'); return; }
      if (!c) { errors.push('Row ' + line + ': unknown course "' + r.course_abbreviation + '"'); return; }
      if (!cd) { errors.push('Row ' + line + ': bad completion_date "' + r.completion_date + '"'); return; }
      if (ed === undefined) { errors.push('Row ' + line + ': bad expiry_date "' + r.expiry_date + '"'); return; }
      const k = pid + '|' + c.id + '|' + cd;
      if (existing.has(k)) { dup++; return; }
      existing.add(k);
      const o = { person_id: pid, course_id: c.id, completion_date: cd, expiry_date: ed || (c.validity_months ? O.addMonths(cd, c.validity_months) : null) };
      ['certificate_no', 'provider', 'remarks'].forEach((x) => { if (r[x]) o[x] = r[x]; });
      good.push(o);
    });
    let done = 0;
    for (let i = 0; i < good.length; i += 500) {
      const chunk = good.slice(i, i + 500);
      const { error } = await sb.from('training_records').insert(chunk);
      if (error) throw error;
      done += chunk.length; progress('Imported ' + done + ' of ' + good.length + '…');
    }
    return 'Done. ' + done + ' records added.' + (dup ? ' ' + dup + ' duplicates skipped.' : '') + (errors.length ? '\n\nSkipped ' + errors.length + ':\n' + errors.join('\n') : '');
  }

  // =================================================================
  //  ROUTER
  // =================================================================
  const VIEWS = {
    personnel: () => listView(PERSONNEL), records: () => listView(RECORDS), courses: () => listView(COURSES),
    functions: () => listView(FUNCTIONS), matrix: matrixView, access: () => listView(ACCESS), import: importView
  };
  async function route() {
    const [sec, arg] = (location.hash.replace('#', '') || 'personnel').split('/');
    const name = VIEWS[sec] ? sec : 'personnel';
    O.$$('.side button').forEach((b) => { if (b.dataset.sec === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const rows = await VIEWS[name]();
    if (arg && name === 'personnel' && rows) {
      const r = rows.find((x) => x.id === arg);
      if (r) openForm(PERSONNEL, r);
      history.replaceState(null, '', '#personnel');
    }
  }
  O.$$('.side button').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.sec; }));
  window.addEventListener('hashchange', route);

  main.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
  try { await loadRef(); } catch (e) { main.innerHTML = '<div class="card">' + esc(O.friendlyError(e)) + '</div>'; return; }
  route();
})();

// =====================================================================
//  Manager report
// =====================================================================
(async function () {
  'use strict';
  const O = window.OTT;
  const ctx = await O.init({ page: 'report', minRole: 'manager' });
  if (!ctx) return;
  O.showLoading('Building report…');

  let people, fns, courses, status;
  try {
    [people, fns, courses, status] = await Promise.all([
      O.fetchAll(() => O.sb.from('personnel').select('id,employee_no,full_name,position,department,section,employer,job_function_id').eq('status', 'Active').order('full_name')),
      O.fetchAll(() => O.sb.from('job_functions').select('id,name,sort_order').order('sort_order').order('name')),
      O.fetchAll(() => O.sb.from('courses').select('id,abbreviation,name,sort_order').order('sort_order').order('name')),
      O.fetchAll(() => O.sb.from('v_training_status').select('person_id,course_id,status,completion_date,expiry_date').eq('mandatory', true))
    ]);
  } catch (e) { O.$('#app').innerHTML = '<div class="page"><div class="card">' + O.esc(O.friendlyError(e)) + '</div></div>'; return; }

  const esc = O.esc;
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));
  const fnById = Object.fromEntries(fns.map((f) => [f.id, f]));
  const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));
  people.forEach((p) => { p.fn = (fnById[p.job_function_id] || {}).name || '—'; });
  const allRows = status.filter((r) => personById[r.person_id]).map((r) => Object.assign(r, { p: personById[r.person_id], c: courseById[r.course_id] || { abbreviation: '?', name: '?' } }));
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const depts = uniq(people.map((p) => p.department));
  const employers = uniq(people.map((p) => p.employer));

  const BANDS = [
    { key: 'full', label: '100% compliant', color: '#0F5E5A', test: (v) => v >= 100 },
    { key: 'high', label: '80–99%', color: '#4FA594', test: (v) => v >= 80 && v < 100 },
    { key: 'mid', label: '50–79%', color: '#E0A100', test: (v) => v >= 50 && v < 80 },
    { key: 'low', label: 'Below 50%', color: '#C2412D', test: (v) => v < 50 }
  ];

  const F = { dept: '', fn: '', employer: '', course: '' };   // page filters
  const T = { status: '', band: '', q: '', limit: 100, sort: 'expiry' }; // table filters

  // ---------- skeleton ----------
  const sel = (id, label, opts, all) =>
    '<label class="field" style="flex:0 1 190px"><span class="field-label-caps">' + label + '</span><select id="' + id + '"><option value="">' + all + '</option>' +
    opts.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></label>';

  O.$('#app').innerHTML =
    '<div class="page">' +
      '<div class="page-head">' +
        '<div><h1>Overall training compliance</h1><p>Mandatory courses from the training matrix · active personnel · as of ' + O.fmtDate(O.isoDate(O.today())) + '</p></div>' +
        '<div class="toolbar">' +
          sel('fDept', 'Department', depts.map((d) => [d, d]), 'All departments') +
          sel('fFn', 'Job function', fns.map((f) => [f.id, f.name]), 'All functions') +
          sel('fEmp', 'Employer', employers.map((e) => [e, e]), 'All employers') +
          sel('fCourse', 'Course', courses.map((c) => [c.id, c.abbreviation + ' — ' + c.name]), 'All courses') +
          '<button class="btn" id="resetBtn">Reset</button>' +
          '<button class="btn" id="printBtn">Print</button>' +
        '</div>' +
      '</div>' +
      '<div class="kpis" id="kpis"></div>' +
      '<div class="chart-grid">' +
        '<section class="chart-card"><h2>Requirements by status</h2><div class="hint">Every mandatory person × course. Click a status to filter the table.</div><div id="donutStatus"></div></section>' +
        '<section class="chart-card"><h2>People by compliance</h2><div class="hint">Share of each person’s mandatory courses in date. Click a band to filter the table.</div><div id="donutBands"></div></section>' +
        '<section class="chart-card"><h2>Expiry outlook</h2><div class="hint">Certificates already expired, then expiring per month for the next 12 months.</div><div id="cols"></div></section>' +
      '</div>' +
      '<div class="chart-grid">' +
        '<section class="chart-card"><h2>Compliance by department</h2><div class="hint">Click a bar to filter the whole report.</div><div class="bars-list" id="byDept"></div></section>' +
        '<section class="chart-card"><h2>Compliance by job function</h2><div class="hint">Click a bar to filter the whole report.</div><div class="bars-list" id="byFn"></div></section>' +
      '</div>' +
      '<section class="chart-card"><div class="card-head" style="margin-bottom:4px"><h2>Status by course</h2><span class="legend-inline" style="margin:0">' +
        O.STATUS.map((s) => '<span><i class="dot" style="background:' + O.STATUS_COLOR[s] + '"></i>' + s + '</span>').join('') +
      '</span></div><div class="hint">Lowest compliance first. Click a course to filter the whole report.</div><div class="bars-list" id="byCourse" style="max-height:none"></div></section>' +
      '<section class="card">' +
        '<div class="card-head">' +
          '<div><h2>Needs action</h2><div class="small muted" id="tblCount"></div></div>' +
          '<div class="toolbar">' +
            '<div class="chips" role="group" aria-label="Status filter" id="tblChips"></div>' +
            '<label class="sr-only" for="tblQ">Search</label><input type="search" id="tblQ" placeholder="Search name, employee no., course" style="width:240px">' +
            '<button class="btn" id="csvActions">Export list</button>' +
            '<button class="btn" id="csvPeople">Export people summary</button>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap"><table class="data"><thead><tr>' +
          '<th>Person</th><th>Employee no.</th><th>Department</th><th>Job function</th><th>Course</th>' +
          '<th><button id="sortExpiry">Expiry ↕</button></th><th>Status</th>' +
        '</tr></thead><tbody id="tblBody"></tbody></table></div>' +
        '<div style="text-align:center;margin-top:12px"><button class="btn hidden" id="tblMore">Show more</button></div>' +
      '</section>' +
    '</div>';

  // ---------- chart helpers ----------
  function donut(segments, centerBig, centerSmall, kind, activeKey) {
    const total = segments.reduce((a, s) => a + s.value, 0);
    const R = 62, SW = 22, C = 2 * Math.PI * R;
    let off = 0;
    const arcs = total ? segments.map((s) => {
      if (!s.value) return '';
      const len = (s.value / total) * C;
      const gap = segments.filter((x) => x.value).length > 1 ? 2 : 0;
      const el = '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="' + s.color + '" stroke-width="' + SW + '"' +
        ' stroke-dasharray="' + Math.max(len - gap, 0.1).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"' +
        ' transform="rotate(-90 80 80)"' + (activeKey && activeKey !== s.key ? ' opacity="0.3"' : '') + '><title>' + esc(s.label) + ': ' + s.value + '</title></circle>';
      off += len;
      return el;
    }).join('') : '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="#EEF0EC" stroke-width="' + SW + '"/>';
    const svg = '<svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="' + esc(segments.map((s) => s.label + ' ' + s.value).join(', ')) + '">' + arcs +
      '<text x="80" y="80" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="26" fill="#16201C">' + esc(centerBig) + '</text>' +
      '<text x="80" y="100" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="#4A5752">' + esc(centerSmall) + '</text></svg>';
    const legend = '<div class="legend">' + segments.map((s) =>
      '<button data-kind="' + kind + '" data-key="' + esc(s.key) + '" aria-pressed="' + (activeKey === s.key) + '"><i class="dot" style="background:' + s.color + '"></i>' + esc(s.label) +
      '<span class="n">' + s.value + (total ? ' · ' + Math.round(s.value / total * 100) + '%' : '') + '</span></button>').join('') + '</div>';
    return '<div class="donut-wrap">' + svg + legend + '</div>';
  }

  function pctBars(groups, kind) {
    if (!groups.length) return '<div class="empty">No data</div>';
    return groups.map((g) =>
      '<button class="hbar" data-kind="' + kind + '" data-key="' + esc(g.key) + '" title="' + esc(g.label) + ': ' + g.compliant + ' of ' + g.required + ' in date">' +
        '<span class="lbl">' + esc(g.label) + ' <span class="muted small">(' + g.people + ')</span></span>' +
        '<span class="track"><span style="width:' + (g.pct || 0) + '%;background:' + O.bandColor(g.pct) + '"></span></span>' +
        '<span class="val">' + (g.pct == null ? '—' : g.pct + '%') + '</span>' +
      '</button>').join('');
  }

  function stackedBars(groups) {
    if (!groups.length) return '<div class="empty">No data</div>';
    return groups.map((g) =>
      '<button class="hbar" data-kind="course" data-key="' + esc(g.key) + '" title="' + esc(O.STATUS.map((s) => s + ' ' + g[s]).join(' · ')) + '">' +
        '<span class="lbl"><span class="mono" style="font-weight:600">' + esc(g.abbr) + '</span> ' + esc(g.label) + '</span>' +
        '<span class="track">' + O.STATUS.map((s) => g[s] ? '<span style="width:' + (g[s] / g.required * 100) + '%;background:' + O.STATUS_COLOR[s] + '"></span>' : '').join('') + '</span>' +
        '<span class="val">' + (g.pct == null ? '—' : g.pct + '%') + '</span>' +
      '</button>').join('');
  }

  function columns(items) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return '<div class="cols" role="img" aria-label="' + esc(items.map((i) => i.label + ' ' + i.value).join(', ')) + '">' + items.map((i) =>
      '<div class="col" title="' + esc(i.label + ': ' + i.value) + '"><span class="n">' + (i.value || '') + '</span>' +
      '<div class="stack" style="height:' + (i.value ? Math.max(3, i.value / max * 150) : 0) + 'px;background:' + i.color + '"></div>' +
      '<span class="m">' + esc(i.short) + '</span></div>').join('') + '</div>' +
      '<div class="legend-inline"><span><i class="dot" style="background:#C2412D"></i>Expired</span><span><i class="dot" style="background:#E0A100"></i>This month</span><span><i class="dot" style="background:#1F7A68"></i>Later</span></div>';
  }

  // ---------- compute ----------
  function scope() {
    const ps = people.filter((p) => (!F.dept || p.department === F.dept) && (!F.fn || p.job_function_id === F.fn) && (!F.employer || p.employer === F.employer));
    const ids = new Set(ps.map((p) => p.id));
    let rows = allRows.filter((r) => ids.has(r.person_id) && (!F.course || r.course_id === F.course));
    const inScope = F.course ? new Set(rows.map((r) => r.person_id)) : ids;
    return { people: ps.filter((p) => inScope.has(p.id)), rows };
  }

  function groupPct(rows, keyFn, labelFn) {
    const m = new Map();
    rows.forEach((r) => {
      const k = keyFn(r) || '—';
      if (!m.has(k)) m.set(k, { key: k, label: labelFn ? labelFn(k) : k, required: 0, compliant: 0, ppl: new Set(), Valid: 0, 'Due soon': 0, Expired: 0, 'Not done': 0 });
      const g = m.get(k);
      g.required++; g[r.status]++; g.ppl.add(r.person_id);
      if (r.status === 'Valid' || r.status === 'Due soon') g.compliant++;
    });
    return [...m.values()].map((g) => Object.assign(g, { pct: O.pct(g.compliant, g.required), people: g.ppl.size }));
  }

  let current = { people: [], rows: [], personPct: {} };

  function render() {
    const { people: ps, rows } = scope();
    const sum = O.summarize(rows.map((r) => Object.assign({ mandatory: true }, r)));
    const byPerson = {};
    rows.forEach((r) => { (byPerson[r.person_id] = byPerson[r.person_id] || []).push(r); });
    const personPct = {};
    ps.forEach((p) => { const s = O.summarize((byPerson[p.id] || []).map((r) => Object.assign({ mandatory: true }, r))); personPct[p.id] = s.pct; });
    current = { people: ps, rows, personPct };
    const fullyCompliant = ps.filter((p) => personPct[p.id] === 100).length;
    const withReq = ps.filter((p) => personPct[p.id] != null).length;

    // KPIs
    const R = 26, C = 2 * Math.PI * R, v = sum.pct || 0;
    O.$('#kpis').innerHTML =
      '<div class="kpi kpi-hero">' +
        '<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="' + R + '" fill="none" stroke="#33403B" stroke-width="8"/>' +
        (v ? '<circle cx="32" cy="32" r="' + R + '" fill="none" stroke="#5FC4B4" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (C * v / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>' : '') + '</svg>' +
        '<div><div class="k">Mandatory compliance</div><div class="v">' + (sum.pct == null ? '—' : sum.pct + '%') + '</div><div class="s">' + sum.compliant + ' of ' + sum.required + ' in date</div></div>' +
      '</div>' +
      kpi('Personnel in scope', ps.length, fullyCompliant + ' fully compliant (' + (O.pct(fullyCompliant, withReq) ?? 0) + '%)', '') +
      kpi('Valid', sum.Valid, 'beyond ' + O.C.DUE_SOON_DAYS + ' days', O.STATUS_COLOR.Valid) +
      kpi('Due within ' + O.C.DUE_SOON_DAYS + ' days', sum['Due soon'], 'still valid — book refreshers', O.STATUS_COLOR['Due soon']) +
      kpi('Expired', sum.Expired, 'need retraining', O.STATUS_COLOR.Expired) +
      kpi('Not done', sum['Not done'], 'never completed', O.STATUS_COLOR['Not done']);

    // Donuts
    O.$('#donutStatus').innerHTML = donut(O.STATUS.map((s) => ({ key: s, label: s, value: sum[s], color: O.STATUS_COLOR[s] })),
      sum.pct == null ? '—' : sum.pct + '%', 'in date', 'status', T.status);
    const bandCounts = BANDS.map((b) => ({ key: b.key, label: b.label, color: b.color, value: ps.filter((p) => personPct[p.id] != null && b.test(personPct[p.id])).length }));
    O.$('#donutBands').innerHTML = donut(bandCounts, String(withReq), 'people', 'band', T.band);

    // Expiry outlook
    const t = O.today();
    const items = [{ label: 'Expired', short: 'Exp.', value: sum.Expired, color: '#C2412D' }];
    for (let i = 0; i < 12; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const n = rows.filter((r) => { if (!r.expiry_date || r.status === 'Expired') return false; const e = O.parseDate(r.expiry_date); return e.getFullYear() === y && e.getMonth() === m; }).length;
      items.push({ label: O.MONTHS[m] + ' ' + y, short: O.MONTHS[m], value: n, color: i === 0 ? '#E0A100' : '#1F7A68' });
    }
    O.$('#cols').innerHTML = columns(items);

    // Bars
    const byPct = (a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.label.localeCompare(b.label);
    O.$('#byDept').innerHTML = pctBars(groupPct(rows, (r) => r.p.department).sort(byPct), 'dept');
    O.$('#byFn').innerHTML = pctBars(groupPct(rows, (r) => r.p.job_function_id, (k) => (fnById[k] || {}).name || '—').sort(byPct), 'fn');
    O.$('#byCourse').innerHTML = stackedBars(groupPct(rows, (r) => r.course_id, (k) => (courseById[k] || {}).name || '?')
      .map((g) => Object.assign(g, { abbr: (courseById[g.key] || {}).abbreviation || '?' })).sort(byPct));

    renderTable();
  }

  function kpi(label, value, sub, color) {
    return '<div class="kpi"><div class="k">' + (color ? '<i class="dot" style="background:' + color + '"></i>' : '') + esc(label) + '</div><div class="v">' + value + '</div><div class="s">' + esc(sub) + '</div></div>';
  }

  // ---------- table ----------
  function actionRows() {
    const q = T.q.toLowerCase();
    let list = current.rows.filter((r) => r.status !== 'Valid');
    if (T.status) list = list.filter((r) => r.status === T.status);
    if (T.band) { const b = BANDS.find((x) => x.key === T.band); list = list.filter((r) => current.personPct[r.person_id] != null && b.test(current.personPct[r.person_id])); }
    if (q) list = list.filter((r) => r.p.full_name.toLowerCase().includes(q) || r.p.employee_no.toLowerCase().includes(q) || r.c.abbreviation.toLowerCase().includes(q) || r.c.name.toLowerCase().includes(q));
    const rank = { 'Expired': 0, 'Not done': 1, 'Due soon': 2 };
    list.sort(T.sort === 'expiry'
      ? (a, b) => (a.expiry_date || '9999') .localeCompare(b.expiry_date || '9999') || rank[a.status] - rank[b.status]
      : (a, b) => (b.expiry_date || '0000').localeCompare(a.expiry_date || '0000'));
    return list;
  }

  function renderTable() {
    const statuses = ['', 'Expired', 'Due soon', 'Not done'];
    O.$('#tblChips').innerHTML = statuses.map((s) => '<button class="chip" data-st="' + s + '" aria-pressed="' + (T.status === s) + '">' + (s || 'All') + '</button>').join('') +
      (T.band ? '<button class="chip" data-clearband aria-pressed="true">' + esc(BANDS.find((b) => b.key === T.band).label) + ' ✕</button>' : '');
    const list = actionRows();
    O.$('#tblCount').textContent = list.length + ' item' + (list.length === 1 ? '' : 's');
    const slice = list.slice(0, T.limit);
    O.$('#tblBody').innerHTML = slice.length ? slice.map((r) =>
      '<tr><td><a href="person.html?id=' + r.person_id + '" style="font-weight:600;text-decoration:none">' + esc(r.p.full_name) + '</a></td>' +
      '<td class="mono">' + esc(r.p.employee_no) + '</td><td>' + esc(r.p.department || '—') + '</td><td>' + esc(r.p.fn) + '</td>' +
      '<td><span class="abbr">' + esc(r.c.abbreviation) + '</span> <span class="muted">' + esc(r.c.name) + '</span></td>' +
      '<td>' + O.fmtDate(r.expiry_date) + '</td><td>' + O.pill(r.status) + '</td></tr>').join('')
      : '<tr><td colspan="7" class="empty">Nothing needs action for this selection.</td></tr>';
    O.$('#tblMore').classList.toggle('hidden', list.length <= T.limit);
  }

  // ---------- events ----------
  const bindSel = (id, key) => O.$('#' + id).addEventListener('change', (e) => { F[key] = e.target.value; T.limit = 100; render(); });
  bindSel('fDept', 'dept'); bindSel('fFn', 'fn'); bindSel('fEmp', 'employer'); bindSel('fCourse', 'course');
  O.$('#resetBtn').addEventListener('click', () => {
    Object.keys(F).forEach((k) => { F[k] = ''; });
    T.status = ''; T.band = ''; T.q = ''; O.$('#tblQ').value = '';
    ['fDept', 'fFn', 'fEmp', 'fCourse'].forEach((id) => { O.$('#' + id).value = ''; });
    render();
  });
  O.$('#printBtn').addEventListener('click', () => window.print());

  O.$('#app').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (b) {
      const k = b.dataset.key;
      switch (b.dataset.kind) {
        case 'status': T.status = T.status === k ? '' : k; if (T.status === 'Valid') T.status = ''; renderStatusOnly(); return;
        case 'band': T.band = T.band === k ? '' : k; renderStatusOnly(); return;
        case 'dept': F.dept = F.dept === k ? '' : k; O.$('#fDept').value = F.dept; break;
        case 'fn': F.fn = F.fn === k ? '' : k; O.$('#fFn').value = F.fn; break;
        case 'course': F.course = F.course === k ? '' : k; O.$('#fCourse').value = F.course; break;
      }
      render();
      return;
    }
    const chip = e.target.closest('[data-st]');
    if (chip) { T.status = chip.dataset.st; renderStatusOnly(); return; }
    if (e.target.closest('[data-clearband]')) { T.band = ''; renderStatusOnly(); }
  });
  function renderStatusOnly() { T.limit = 100; render(); }

  O.$('#tblQ').addEventListener('input', O.debounce((e) => { T.q = e.target.value.trim(); T.limit = 100; renderTable(); }, 150));
  O.$('#tblMore').addEventListener('click', () => { T.limit += 200; renderTable(); });
  O.$('#sortExpiry').addEventListener('click', () => { T.sort = T.sort === 'expiry' ? 'expiry-desc' : 'expiry'; renderTable(); });

  const stamp = () => O.isoDate(O.today());
  O.$('#csvActions').addEventListener('click', () => {
    O.downloadCsv('needs-action-' + stamp() + '.csv',
      ['Employee no', 'Name', 'Department', 'Section', 'Employer', 'Job function', 'Course abbr', 'Course', 'Completed', 'Expiry', 'Status'],
      actionRows().map((r) => [r.p.employee_no, r.p.full_name, r.p.department, r.p.section, r.p.employer, r.p.fn, r.c.abbreviation, r.c.name, r.completion_date, r.expiry_date, r.status]));
  });
  O.$('#csvPeople').addEventListener('click', () => {
    const byP = {};
    current.rows.forEach((r) => { (byP[r.person_id] = byP[r.person_id] || []).push(r); });
    O.downloadCsv('people-compliance-' + stamp() + '.csv',
      ['Employee no', 'Name', 'Position', 'Department', 'Section', 'Employer', 'Job function', 'Required', 'In date', 'Due soon', 'Expired', 'Not done', 'Compliance %'],
      current.people.map((p) => { const s = O.summarize((byP[p.id] || []).map((r) => Object.assign({ mandatory: true }, r))); return [p.employee_no, p.full_name, p.position, p.department, p.section, p.employer, p.fn, s.required, s.compliant, s['Due soon'], s.Expired, s['Not done'], s.pct]; }));
  });

  render();
})();

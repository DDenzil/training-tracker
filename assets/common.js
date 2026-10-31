// =====================================================================
//  Online Training Tracker — shared helpers (window.OTT)
// =====================================================================
(function () {
  'use strict';
  const C = window.OTT_CONFIG || {};
  if (!window.supabase || !window.supabase.createClient) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Could not load the Supabase library. Check your internet connection.</p>';
    return;
  }
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const RANK = { viewer: 1, manager: 2, admin: 3 };
  const STATUS = ['Valid', 'Due soon', 'Expired', 'Not done'];
  const STATUS_CLASS = { 'Valid': 'pill-valid', 'Due soon': 'pill-due', 'Expired': 'pill-expired', 'Not done': 'pill-notdone' };
  const STATUS_COLOR = { 'Valid': '#1F7A68', 'Due soon': '#E0A100', 'Expired': '#C2412D', 'Not done': '#A9B3AF' };
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ---------- small utils ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 200); }; };

  function parseDate(d) {               // 'YYYY-MM-DD' → local Date (no TZ shift)
    if (!d) return null;
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, day);
  }
  function fmtDate(d) {
    const x = parseDate(d);
    return x ? String(x.getDate()).padStart(2, '0') + ' ' + MONTHS[x.getMonth()] + ' ' + x.getFullYear() : '—';
  }
  function isoDate(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function daysUntil(d) { const x = parseDate(d); return x ? Math.round((x - today()) / 86400000) : null; }
  function addMonths(iso, months) {
    const d = parseDate(iso); if (!d || !months) return '';
    const day = d.getDate();
    d.setMonth(d.getMonth() + Number(months));
    if (d.getDate() < day) d.setDate(0);             // e.g. 31 Jan + 1 month → 28/29 Feb
    return isoDate(d);
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }
  function pill(status) { return '<span class="pill ' + (STATUS_CLASS[status] || 'pill-plain') + '">' + esc(status) + '</span>'; }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : null; }
  function personUrl(id) { return new URL('person.html?id=' + encodeURIComponent(id), location.href).href; }

  // ---------- toasts ----------
  function toast(msg, type) {
    let host = $('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
  }
  function friendlyError(err) {
    const m = (err && (err.message || err.details)) || String(err);
    if (/violates foreign key constraint/i.test(m)) return 'This item is still used elsewhere (e.g. training records). Mark it inactive instead of deleting.';
    if (/duplicate key value/i.test(m)) return 'That value already exists — it must be unique.';
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
    return m;
  }

  // ---------- data ----------
  async function fetchAll(build, pageSize) {
    pageSize = pageSize || 1000;
    let out = [], from = 0;
    for (;;) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  const photoCache = new Map();
  async function photoUrls(paths) {
    const need = [...new Set(paths.filter((p) => p && !photoCache.has(p)))];
    for (let i = 0; i < need.length; i += 200) {
      const chunk = need.slice(i, i + 200);
      const { data, error } = await sb.storage.from('photos').createSignedUrls(chunk, 3600);
      if (!error && data) data.forEach((r) => { if (r.signedUrl) photoCache.set(r.path, r.signedUrl); });
    }
    const map = {};
    paths.forEach((p) => { if (p && photoCache.has(p)) map[p] = photoCache.get(p); });
    return map;
  }
  function photoHtml(url, name, cls) {
    return url
      ? '<img class="photo ' + (cls || '') + '" src="' + esc(url) + '" alt="Photo of ' + esc(name) + '">'
      : '<div class="photo ' + (cls || '') + '" role="img" aria-label="No photo for ' + esc(name) + '">' + esc(initials(name)) + '</div>';
  }

  // Summarise v_training_status rows (mandatory only) for one or many people
  function summarize(rows) {
    const s = { required: 0, Valid: 0, 'Due soon': 0, Expired: 0, 'Not done': 0 };
    rows.forEach((r) => { if (r.mandatory) { s.required++; s[r.status]++; } });
    s.compliant = s.Valid + s['Due soon'];          // still in date
    s.pct = pct(s.compliant, s.required);
    return s;
  }
  function bandColor(p) {
    if (p == null) return '#A9B3AF';
    if (p >= 100) return '#0F5E5A';
    if (p >= 80) return '#4FA594';
    if (p >= 50) return '#E0A100';
    return '#C2412D';
  }

  function downloadCsv(filename, header, rows) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '﻿' + [header].concat(rows).map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Simple CSV parser (handles quotes, commas and newlines in quotes)
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    if (!rows.length) return [];
    const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.map((r) => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
  }

  // ---------- auth + page frame ----------
  const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  function renderTopbar(ctx, page) {
    const bar = $('#topbar'); if (!bar) return;
    const links = [];
    if (ctx) {
      links.push(['index.html', ctx.role === 'viewer' ? 'Find person' : 'People', 'people']);
      if (RANK[ctx.role] >= RANK.manager) links.push(['report.html', 'Report', 'report']);
      if (ctx.role === 'admin') links.push(['admin.html', 'Admin', 'admin']);
    }
    bar.className = 'topbar';
    bar.innerHTML =
      '<div class="topbar-inner">' +
        '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">' +
          '<a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">TT</span>' + esc(C.APP_NAME || 'Training Tracker') + '</a>' +
          (links.length ? '<nav class="topnav" aria-label="Main">' + links.map((l) => '<a href="' + l[0] + '"' + (l[2] === page ? ' class="active" aria-current="page"' : '') + '>' + l[1] + '</a>').join('') + '</nav>' : '') +
        '</div>' +
        (ctx ? '<div class="who"><span class="role-badge">' + esc(ctx.role) + '</span><span>' + esc(ctx.email) + '</span><button class="btn btn-sm btn-ghost" id="signOutBtn">Sign out</button></div>' : '') +
      '</div>';
    const so = $('#signOutBtn');
    if (so) so.addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'index.html'; });
  }

  function renderGate(kind, detail) {
    renderTopbar(null);
    const app = $('#app');
    let body = '';
    if (kind === 'signin') {
      body = '<h1>' + esc(C.APP_NAME || 'Training Tracker') + '</h1>' +
             '<p>Shows the safety training status and compliance of personnel against the training matrix. For registered users only.</p>' +
             '<p>Sign in with the Google account that the Safety Training Team registered for you.</p>' +
             '<button class="btn-google" id="googleBtn">' + GOOGLE_ICON + 'Sign in with Google</button>' +
             '<p class="small"><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms of Service</a></p>';
    } else if (kind === 'unregistered') {
      body = '<h1>Not registered</h1><p><strong>' + esc(detail) + '</strong> is not registered to use this system.</p>' +
             '<p>' + esc(C.CONTACT_LINE || '') + '</p>' +
             '<button class="btn" id="switchBtn">Use a different account</button>' +
             '<p class="small"><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms of Service</a></p>';
    } else if (kind === 'denied') {
      body = '<h1>No access</h1><p>Your account does not have access to this page.</p><a class="btn" href="index.html">Go to start page</a>';
    } else {
      body = '<h1>Something went wrong</h1><p>' + esc(detail || '') + '</p><button class="btn" onclick="location.reload()">Try again</button>';
    }
    app.innerHTML = '<div class="gate"><div class="gate-card">' + body + '</div></div>';
    const g = $('#googleBtn');
    if (g) g.addEventListener('click', signIn);
    const s = $('#switchBtn');
    if (s) s.addEventListener('click', async () => { await sb.auth.signOut(); signIn(); });
  }

  function signIn() {
    sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.href.split('#')[0], queryParams: { prompt: 'select_account' } }
    });
  }

  function showLoading(msg) {
    const app = $('#app');
    if (app) app.innerHTML = '<div class="loading"><div class="spinner"></div>' + esc(msg || 'Loading…') + '</div>';
  }

  // Call at the top of every page. Returns { sb, email, role } or null.
  async function init(opts) {
    opts = opts || {};
    showLoading('Checking sign-in…');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { renderGate('signin'); return null; }
    if (location.hash && /access_token|error/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    const { data: role, error } = await sb.rpc('my_role');
    if (error) { renderGate('error', error.message); return null; }
    const email = session.user.email;
    if (!role) { renderGate('unregistered', email); return null; }
    if (RANK[role] < RANK[opts.minRole || 'viewer']) { renderGate('denied'); renderTopbar({ email, role }, opts.page); return null; }
    const ctx = { sb, email, role, isManager: RANK[role] >= RANK.manager, isAdmin: role === 'admin' };
    renderTopbar(ctx, opts.page);
    return ctx;
  }

  window.OTT = {
    sb, C, RANK, STATUS, STATUS_CLASS, STATUS_COLOR, MONTHS,
    $, $$, esc, debounce, parseDate, fmtDate, isoDate, today, daysUntil, addMonths, initials,
    pill, pct, personUrl, toast, friendlyError, fetchAll, photoUrls, photoHtml,
    summarize, bandColor, downloadCsv, parseCsv, init, showLoading
  };
})();

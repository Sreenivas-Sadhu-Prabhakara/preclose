/* ============================================================
   preclose — UI wiring. All logic reads the pure engine (PRECLOSE) and
   formatter (PRECLOSE_FMT). No network, no inline handlers (CSP).
   ============================================================ */
(function () {
  'use strict';
  const E = window.PRECLOSE;
  const F = window.PRECLOSE_FMT;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  };

  const LS_SCENARIOS = 'preclose.scenarios.v1';
  const LS_THEME = 'preclose.theme.v1';
  const VERIFIED_ON = '2026-07-22';

  // ---------- state ----------
  let prepayEvents = [];   // [{month, amount, everyMonths, chargeType, chargeValue}]
  let rateEvents = [];     // [{month, newRate, mode}]

  // ---------- RBI note (verified citation) ----------
  $('#rbiNote').innerHTML =
    'The tool does not know your bank&rsquo;s fee schedule. The Reserve Bank of India bars ' +
    'foreclosure charges or pre-payment penalties on floating-rate term loans to <em>individual</em> ' +
    'borrowers (RBI/2013-14/582, 7 May 2014); fixed-rate loans may still carry charges &mdash; ' +
    'confirm against your sanction letter. ' +
    '<span class="modelnote__verified">Guidance verified ' + VERIFIED_ON + '. Drives no calculation.</span>';

  // ---------- theme ----------
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const btn = $('#themeBtn');
    const isLight = t === 'light';
    btn.setAttribute('aria-pressed', String(isLight));
    btn.textContent = isLight ? 'Dark theme' : 'Light theme';
  }
  applyTheme(localStorage.getItem(LS_THEME) || '');
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'light' ? 'dark' : 'light';
    localStorage.setItem(LS_THEME, next);
    applyTheme(next);
    render();
  });

  // ---------- read inputs ----------
  function grouping() {
    const r = document.querySelector('input[name="grouping"]:checked');
    return r ? r.value : 'in';
  }
  function m(paise) { return F.money(paise, grouping()); }

  function readLoan() {
    const principal = Math.max(0, Number($('#principal').value) || 0);
    const rate = Math.max(0, Number($('#rate').value) || 0) / 100;
    const years = Math.max(0, Math.floor(Number($('#years').value) || 0));
    const mon = Math.max(0, Math.floor(Number($('#months').value) || 0));
    const months = years * 12 + mon;
    return { principal, annualRate: rate, months };
  }
  function strategy() {
    const r = document.querySelector('input[name="strategy"]:checked');
    return r ? r.value : 'tenure';
  }
  function startMonthValue() {
    return $('#startMonth').value || defaultStartMonth();
  }
  function defaultStartMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Map a 1-based schedule month index to a calendar YYYY-MM using the start month.
  function calendarFor(idx1) {
    const sm = startMonthValue();
    const [y, mo] = sm.split('-').map(Number);
    const total = (y * 12 + (mo - 1)) + (idx1 - 1);
    const yy = Math.floor(total / 12);
    const mm = (total % 12) + 1;
    return yy + '-' + String(mm).padStart(2, '0');
  }
  function closureLabel(idx1) {
    if (!idx1) return '—';
    const cal = calendarFor(idx1);
    const [y, mo] = cal.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[Number(mo) - 1] + ' ' + y;
  }

  // ---------- event rows ----------
  function makeCharge(ev) {
    return ev.chargeType && ev.chargeValue > 0
      ? { type: ev.chargeType, value: ev.chargeValue } : null;
  }

  function renderPrepayRows() {
    const wrap = $('#prepayEvents');
    wrap.innerHTML = '';
    prepayEvents.forEach((ev, idx) => {
      const row = el('div', { class: 'event' });
      row.appendChild(numField('At month', ev.month, 1, 480, (v) => { ev.month = v; render(); }));
      row.appendChild(numField('Amount (₹)', ev.amount, 0, 1e9, (v) => { ev.amount = v; render(); }, 1000));
      row.appendChild(numField('Every N months (0 = once)', ev.everyMonths, 0, 480, (v) => { ev.everyMonths = v; render(); }));
      row.appendChild(selectField('Charge', ev.chargeType || 'none',
        [['none', 'No charge'], ['flat', 'Flat ₹'], ['percent', '% of amount']],
        (v) => { ev.chargeType = v === 'none' ? '' : v; render(); }));
      row.appendChild(numField('Charge value', ev.chargeValue, 0, 1e7, (v) => { ev.chargeValue = v; render(); }, 0.01));
      const del = el('button', { class: 'event__del', type: 'button', 'aria-label': 'Remove prepayment' , text: 'Remove' });
      del.addEventListener('click', () => { prepayEvents.splice(idx, 1); renderPrepayRows(); render(); });
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }

  function renderRateRows() {
    const wrap = $('#rateEvents');
    wrap.innerHTML = '';
    rateEvents.forEach((ev, idx) => {
      const row = el('div', { class: 'event event--rate' });
      row.appendChild(numField('At month', ev.month, 1, 480, (v) => { ev.month = v; render(); }));
      row.appendChild(numField('New rate (%)', ev.newRate, 0, 36, (v) => { ev.newRate = v; render(); }, 0.01));
      row.appendChild(selectField('Handling', ev.mode || 'tenure',
        [['tenure', 'Keep EMI (stretch tenure)'], ['emi', 'Re-derive EMI']],
        (v) => { ev.mode = v; render(); }));
      const del = el('button', { class: 'event__del', type: 'button', 'aria-label': 'Remove rate change', text: 'Remove' });
      del.addEventListener('click', () => { rateEvents.splice(idx, 1); renderRateRows(); render(); });
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }

  function numField(label, val, min, max, onChange, step) {
    const f = el('div', { class: 'field' });
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    f.appendChild(el('label', { for: id, text: label }));
    const inp = el('input', { type: 'number', id, min, max, step: step || 1, value: String(val ?? 0), inputmode: 'decimal' });
    inp.addEventListener('input', () => onChange(Number(inp.value) || 0));
    f.appendChild(inp);
    return f;
  }
  function selectField(label, val, opts, onChange) {
    const f = el('div', { class: 'field' });
    const id = 's' + Math.random().toString(36).slice(2, 8);
    f.appendChild(el('label', { for: id, text: label }));
    const sel = el('select', { id });
    opts.forEach(([v, t]) => {
      const o = el('option', { value: v, text: t });
      if (v === val) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    f.appendChild(sel);
    return f;
  }

  $('#addPrepay').addEventListener('click', () => {
    prepayEvents.push({ month: 12, amount: 100000, everyMonths: 0, chargeType: '', chargeValue: 0 });
    renderPrepayRows(); render();
  });
  $('#addRate').addEventListener('click', () => {
    rateEvents.push({ month: 12, newRate: Number($('#rate').value) || 8.5, mode: 'tenure' });
    renderRateRows(); render();
  });

  // ---------- build the comparison config ----------
  function buildCfg() {
    const loan = readLoan();
    const expanded = E.expandPrepayments(
      prepayEvents.map((ev) => ({ month: ev.month, amount: ev.amount, everyMonths: ev.everyMonths })),
      loan.months
    );
    // charge is per-event; if any event carries a charge we attach the first
    // configured charge to the whole run (the engine applies it to each prepay).
    const charged = prepayEvents.find((ev) => ev.chargeType && ev.chargeValue > 0);
    const charge = charged ? makeCharge(charged) : null;
    const rateChanges = rateEvents.map((ev) => ({ month: ev.month, newRate: ev.newRate / 100, mode: ev.mode || 'tenure' }));
    return { loan, prepayments: expanded, rateChanges, charge };
  }

  // ---------- render everything ----------
  let lastSchedule = null;
  function render() {
    const cfg = buildCfg();
    if (cfg.loan.months <= 0 || cfg.loan.principal <= 0) {
      $('#verdict').innerHTML = '<p class="muted">Enter a loan amount, rate, and tenure to see the schedule.</p>';
      $('#schedule').innerHTML = ''; $('#baselineLine').textContent = '';
      $('#chart').innerHTML = ''; lastSchedule = null;
      return;
    }
    const cmp = E.compare(cfg);
    const primary = strategy();
    const shown = cmp[primary];
    lastSchedule = shown.schedule;

    // baseline line
    const b = cmp.baseline;
    $('#baselineLine').innerHTML =
      'Baseline (do nothing): EMI <strong>' + m(b.emiStart) + '</strong> for <strong>' + b.months +
      '</strong> months, total interest <strong>' + m(b.totalInterest) + '</strong>, closes <strong>' +
      closureLabel(b.months) + '</strong>.';

    renderVerdict(cmp);
    renderChart(cmp);
    renderSchedule(shown.schedule);
  }

  function renderVerdict(cmp) {
    const wrap = $('#verdict');
    wrap.innerHTML = '';
    const t = cmp.tenure, e = cmp.emi;
    const hasEvents = t.schedule.totalPrepaid > 0 || cmp.baseline.months !== t.schedule.months || rateEvents.length > 0;
    const tenureWins = t.netInterestSaved >= e.netInterestSaved;

    wrap.appendChild(vcol('Reduce tenure', t, tenureWins, cmp.baseline));
    wrap.appendChild(vcol('Reduce EMI', e, !tenureWins, cmp.baseline));

    const call = el('div', { class: 'verdict__call' });
    if (t.schedule.totalPrepaid <= 0 && rateEvents.length === 0) {
      call.innerHTML = 'Add a prepayment above to compare. With no prepayment, both strategies equal the baseline.';
    } else {
      const diff = Math.abs(t.netInterestSaved - e.netInterestSaved);
      const winner = tenureWins ? 'Reduce tenure' : 'Reduce EMI';
      call.innerHTML = '<strong>' + winner + '</strong> saves more here — by <strong>' + m(diff) +
        '</strong> in net interest. Reduce-tenure keeps your EMI the same and closes the loan ' +
        (t.monthsErased >= 0 ? t.monthsErased : 0) + ' months earlier; reduce-EMI lowers your monthly outgo but keeps the end date.';
    }
    wrap.appendChild(call);
  }

  function vcol(label, res, isWin, baseline) {
    const col = el('div', { class: 'vcol' + (isWin ? ' vcol--win' : '') });
    const head = el('div');
    head.innerHTML = '<span class="vcol__label">' + label + '</span>' +
      (isWin ? '<span class="vcol__win-badge">saves more</span>' : '');
    col.appendChild(head);
    const dl = el('dl');
    const newEmi = res.schedule.rows.length ? res.emiAfterFirstPrepay || res.schedule.rows[res.schedule.rows.length - 1].emi : baseline.emiStart;
    const pairs = [
      ['Net interest saved', '<span class="big money">' + m(res.netInterestSaved) + '</span>'],
      ['Charges netted', m(res.totalCharges)],
      ['Months erased', String(Math.max(0, res.monthsErased))],
      ['New closure', closureLabel(res.schedule.months)],
      [label === 'Reduce EMI' ? 'New EMI (after 1st prepay)' : 'EMI (unchanged)', m(newEmi)],
    ];
    pairs.forEach(([k, v]) => {
      dl.appendChild(el('dt', { text: k }));
      dl.appendChild(el('dd', { html: v }));
    });
    col.appendChild(dl);
    return col;
  }

  // ---------- burn-down chart (the motif) ----------
  function renderChart(cmp) {
    const W = 800, H = 320, padL = 8, padR = 8, padT = 12, padB = 24;
    const base = cmp.baseline.rows;
    const pre = cmp[strategy()].schedule.rows;
    const nBase = base.length;
    const maxBal = base.length ? base[0].opening : 1;
    const x = (i) => padL + (i / Math.max(1, nBase)) * (W - padL - padR);
    const y = (bal) => padT + (1 - bal / maxBal) * (H - padT - padB);

    function pathFor(rows) {
      let d = 'M ' + x(0).toFixed(1) + ' ' + y(rows.length ? rows[0].opening : 0).toFixed(1);
      rows.forEach((r, i) => { d += ' L ' + x(i + 1).toFixed(1) + ' ' + y(r.closing).toFixed(1); });
      return d;
    }

    const svg = $('#chart');
    svg.innerHTML =
      '<title id="chartTitle">Outstanding-balance burn-down</title>' +
      '<desc id="chartDesc">Baseline balance vs with-prepayments balance over time; the amber curve reaches zero earlier.</desc>';
    // baseline axis
    const baseAxisY = y(0);
    add(svg, 'line', { x1: padL, y1: baseAxisY, x2: W - padR, y2: baseAxisY, class: 'axis' });

    // erased span (between pre closure and base closure)
    const preClose = pre.length, baseClose = base.length;
    if (preClose < baseClose) {
      const x0 = x(preClose), x1 = x(baseClose);
      add(svg, 'rect', { x: x0.toFixed(1), y: padT, width: (x1 - x0).toFixed(1), height: (baseAxisY - padT).toFixed(1), class: 'erased-span' });
      for (let hx = x0; hx < x1; hx += 8) {
        add(svg, 'line', { x1: hx.toFixed(1), y1: padT, x2: (hx + 8).toFixed(1), y2: baseAxisY.toFixed(1), class: 'erased-hatch' });
      }
    }
    // curves
    add(svg, 'path', { d: pathFor(base), class: 'curve-base' });
    add(svg, 'path', { d: pathFor(pre), class: 'curve-pre' });
    // closure tick + dot on the pre curve
    if (preClose) {
      const cx = x(preClose);
      add(svg, 'line', { x1: cx.toFixed(1), y1: (baseAxisY - 14).toFixed(1), x2: cx.toFixed(1), y2: (baseAxisY + 6).toFixed(1), class: 'closure-tick' });
      add(svg, 'circle', { cx: cx.toFixed(1), cy: baseAxisY.toFixed(1), r: 4, class: 'closure-dot' });
      add(svg, 'text', { x: Math.min(cx + 6, W - 60).toFixed(1), y: (padT + 14).toFixed(1), class: 'axis-label', _text: 'closes ' + closureLabel(preClose) });
    }
    add(svg, 'text', { x: padL, y: (H - 6).toFixed(1), class: 'axis-label', _text: 'month 0' });
    add(svg, 'text', { x: (W - padR - 50).toFixed(1), y: (H - 6).toFixed(1), class: 'axis-label', _text: 'month ' + nBase });
  }
  function add(svg, tag, attrs) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) {
      if (k === '_text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    svg.appendChild(n);
    return n;
  }

  // ---------- schedule table (grouped by year, collapsible) ----------
  function renderSchedule(s) {
    const wrap = $('#schedule');
    wrap.innerHTML = '';
    const rows = s.rows;
    const startCal = startMonthValue();
    const [sy, sm] = startCal.split('-').map(Number);
    const startYearIdx = sy;

    // group rows by calendar year
    const groups = new Map();
    rows.forEach((r) => {
      const totalMonthsFromEpoch = (sy * 12 + (sm - 1)) + (r.month - 1);
      const yr = Math.floor(totalMonthsFromEpoch / 12);
      if (!groups.has(yr)) groups.set(yr, []);
      groups.get(yr).push(r);
    });

    let first = true;
    for (const [yr, grp] of groups) {
      const yrInterest = grp.reduce((a, r) => a + r.interest, 0);
      const details = el('details', { class: 'yeargroup' });
      if (first) { details.setAttribute('open', ''); first = false; }
      const summary = el('summary', { class: 'yeargroup__summary' });
      summary.innerHTML = '<span class="caret">' + yr + '</span>' +
        '<span class="yr-int">interest this year ' + m(yrInterest) + '</span>';
      details.appendChild(summary);

      const tw = el('div', { class: 'tablewrap' });
      const table = el('table', { class: 'sched' });
      table.innerHTML =
        '<thead><tr><th>Month</th><th>Opening</th><th>EMI</th><th>Interest</th><th>Principal</th><th>Prepay</th><th>Closing</th></tr></thead>';
      const tb = el('tbody');
      grp.forEach((r) => {
        const tr = el('tr');
        if (r.prepay > 0) tr.classList.add('has-prepay');
        if (isRateMonth(r.month)) tr.classList.add('has-rate');
        tr.innerHTML =
          '<td>' + closureLabel(r.month) + '</td>' +
          '<td>' + m(r.opening) + '</td>' +
          '<td>' + m(r.emi) + '</td>' +
          '<td>' + m(r.interest) + '</td>' +
          '<td>' + m(r.principal) + '</td>' +
          '<td class="' + (r.prepay > 0 ? 'prepay-cell' : '') + '">' + (r.prepay > 0 ? m(r.prepay) : '—') + '</td>' +
          '<td>' + m(r.closing) + '</td>';
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      tw.appendChild(table);
      details.appendChild(tw);
      wrap.appendChild(details);
    }
  }
  function isRateMonth(month) { return rateEvents.some((ev) => (ev.month | 0) === month); }

  // ---------- CSV export ----------
  $('#csvBtn').addEventListener('click', () => {
    if (!lastSchedule) return;
    const header = ['month_index', 'calendar', 'opening', 'emi', 'interest', 'principal', 'prepay', 'charge', 'closing'];
    const rows = [header];
    lastSchedule.rows.forEach((r) => rows.push([
      r.month, calendarFor(r.month),
      (r.opening / 100).toFixed(2), (r.emi / 100).toFixed(2), (r.interest / 100).toFixed(2),
      (r.principal / 100).toFixed(2), (r.prepay / 100).toFixed(2), (r.charge / 100).toFixed(2),
      (r.closing / 100).toFixed(2),
    ]));
    const csv = F.toCSV(rows);
    const name = ($('#scenarioName').value.trim() || 'preclose-schedule').replace(/[^\w.-]+/g, '_');
    downloadText(name + '.csv', 'text/csv', csv);
  });
  function downloadText(filename, mime, text) {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#printBtn').addEventListener('click', () => window.print());

  // ---------- scenarios (localStorage) ----------
  function snapshot() {
    return {
      name: $('#scenarioName').value.trim() || 'scenario',
      principal: $('#principal').value, rate: $('#rate').value,
      years: $('#years').value, months: $('#months').value,
      startMonth: startMonthValue(), grouping: grouping(), strategy: strategy(),
      prepayEvents: JSON.parse(JSON.stringify(prepayEvents)),
      rateEvents: JSON.parse(JSON.stringify(rateEvents)),
    };
  }
  function loadScenarios() {
    try { return JSON.parse(localStorage.getItem(LS_SCENARIOS) || '{}'); }
    catch (e) { return {}; }
  }
  function refreshScenarioSelect() {
    const sel = $('#scenarioSelect');
    const all = loadScenarios();
    sel.innerHTML = '<option value="">Load saved…</option>';
    Object.keys(all).sort().forEach((k) => sel.appendChild(el('option', { value: k, text: k })));
  }
  function applySnapshot(snap) {
    $('#principal').value = snap.principal;
    $('#rate').value = snap.rate;
    $('#years').value = snap.years;
    $('#months').value = snap.months;
    $('#startMonth').value = snap.startMonth || defaultStartMonth();
    const g = document.querySelector('input[name="grouping"][value="' + (snap.grouping || 'in') + '"]'); if (g) g.checked = true;
    const st = document.querySelector('input[name="strategy"][value="' + (snap.strategy || 'tenure') + '"]'); if (st) st.checked = true;
    prepayEvents = (snap.prepayEvents || []).map((e) => Object.assign({}, e));
    rateEvents = (snap.rateEvents || []).map((e) => Object.assign({}, e));
    $('#scenarioName').value = snap.name || '';
    renderPrepayRows(); renderRateRows(); render();
  }
  $('#saveScenario').addEventListener('click', () => {
    const snap = snapshot();
    const all = loadScenarios();
    all[snap.name] = snap;
    localStorage.setItem(LS_SCENARIOS, JSON.stringify(all));
    refreshScenarioSelect();
    $('#scenarioSelect').value = snap.name;
  });
  $('#scenarioSelect').addEventListener('change', (ev) => {
    const all = loadScenarios();
    const snap = all[ev.target.value];
    if (snap) applySnapshot(snap);
  });
  $('#dupScenario').addEventListener('click', () => {
    const cur = $('#scenarioName').value.trim();
    if (cur) $('#scenarioName').value = cur + ' (copy)';
  });

  // ---------- live recompute ----------
  ['#principal', '#rate', '#years', '#months', '#startMonth'].forEach((s) =>
    $(s).addEventListener('input', render));
  document.querySelectorAll('input[name="grouping"], input[name="strategy"]').forEach((r) =>
    r.addEventListener('change', render));

  // ---------- init ----------
  $('#startMonth').value = defaultStartMonth();
  prepayEvents = [{ month: 12, amount: 300000, everyMonths: 12, chargeType: '', chargeValue: 0 }];
  renderPrepayRows();
  renderRateRows();
  refreshScenarioSelect();
  render();
})();

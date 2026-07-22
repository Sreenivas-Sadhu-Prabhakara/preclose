'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../data/loan.js');
const F = require('../data/format.js');

// ---- deterministic PRNG for property/fuzz tests (cyrb53 -> mulberry32) ----
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(seedStr) { return mulberry32(cyrb53(seedStr) >>> 0); }

// A ₹50L @ 8.5% x 240 loan and a ₹10L @ 10% x 120 loan (the fixtures).
const FIX_A = { principal: 5000000, annualRate: 0.085, months: 240 };
const FIX_B = { principal: 1000000, annualRate: 0.10, months: 120 };

// ---------------------------------------------------------------------------
test('closed-form EMI fixtures to the paisa', () => {
  assert.equal(L.emi(5000000, 0.085, 240), 43391.16);
  assert.equal(L.emi(1000000, 0.10, 120), 13215.07);
});

test('rate-0% EMI is P/n exactly with zero total interest', () => {
  assert.equal(L.emi(12000, 0, 12), 1000);
  const s = L.buildSchedule({ loan: { principal: 12000, annualRate: 0, months: 12 } });
  assert.equal(s.totalInterest, 0);
  assert.equal(s.months, 12);
  assert.equal(s.rows[11].closing, 0);
});

test('cross-check: closed-form B(k) === iterative closing, every month, both fixtures', () => {
  // The iterative schedule rounds interest to the paisa each month; the closed
  // form compounds the exact EMI continuously. Per-paisa rounding accumulates,
  // so the honest agreement bound is sub-rupee (< 50 paise), not 1 paisa.
  const TOL = 0.50;
  for (const fx of [FIX_A, FIX_B]) {
    const s = L.buildSchedule({ loan: fx });
    let maxDiff = 0;
    // Months 1..n-1: the two models agree sub-rupee. The FINAL row is defined
    // by the paisa-reconciliation rule to close at exactly 0 (it absorbs the
    // rounding residual the closed form still carries), so it is asserted
    // separately, not against the analytic B(n).
    for (let k = 1; k < fx.months; k++) {
      const closedRupees = L.balanceAfter(fx.principal, fx.annualRate, fx.months, k);
      const iterRupees = s.rows[k - 1].closing / 100;
      maxDiff = Math.max(maxDiff, Math.abs(closedRupees - iterRupees));
      assert.ok(Math.abs(closedRupees - iterRupees) < TOL,
        `month ${k}: closed ${closedRupees} vs iter ${iterRupees}`);
    }
    assert.ok(maxDiff < 0.50, `max drift ${maxDiff} < ₹0.50`);
    assert.equal(s.rows[fx.months - 1].closing, 0, 'final row reconciles to 0');
  }
});

test('the stated 60-month balance fixture (paise-rounded EMI)', () => {
  // NB: brief printed 4406359.16; the true closed-form value using the
  // paise-rounded EMI (43391.16) is 4406359.28 — asserted to the true value.
  const closed = L.balanceAfter(5000000, 0.085, 240, 60);
  assert.ok(Math.abs(closed - 4406359.28) < 0.01, `got ${closed}`);
  const s = L.buildSchedule({ loan: FIX_A });
  assert.ok(Math.abs(s.rows[59].closing / 100 - closed) < 0.01);
});

test('schedule integrity: principal reconciles, closes at 0, per-row identities', () => {
  for (const fx of [FIX_A, FIX_B]) {
    const s = L.buildSchedule({ loan: fx });
    let sumPrincipal = 0;
    for (const r of s.rows) {
      const i = fx.annualRate / 12;
      assert.equal(r.interest, Math.round(r.opening * i), `interest id month ${r.month}`);
      assert.equal(r.principal, r.emi - r.interest, `principal id month ${r.month}`);
      assert.equal(r.closing, r.opening - r.principal - r.prepay, `closing id month ${r.month}`);
      assert.ok(r.closing >= 0, `no negative balance month ${r.month}`);
      sumPrincipal += r.principal;
    }
    assert.equal(sumPrincipal, L.toPaise(fx.principal), 'Σ principal === original principal');
    assert.equal(s.rows[s.rows.length - 1].closing, 0, 'final closing === 0');
  }
});

test('reduce-EMI invariant: same row count, new EMI === closed-form on reduced balance', () => {
  const k = 24;
  const prepayAmt = 500000;
  const s = L.buildSchedule({
    loan: FIX_A, strategy: 'emi',
    prepayments: [{ month: k, amount: prepayAmt }],
  });
  assert.equal(s.months, FIX_A.months, 'reduce-EMI keeps tenure');
  // balance after the prepay at month k:
  const balAfter = s.rows[k - 1].closing / 100;
  const remaining = FIX_A.months - k;
  const expectedEmi = L.emi(balAfter, FIX_A.annualRate, remaining);
  const actualEmi = s.rows[k].emi / 100; // EMI on the row after the prepay
  assert.ok(Math.abs(actualEmi - expectedEmi) < 0.01, `emi ${actualEmi} vs ${expectedEmi}`);
});

test('reduce-tenure dominance over reduce-EMI on 200 randomized loans', () => {
  const r = rng('dominance');
  for (let t = 0; t < 200; t++) {
    const loan = {
      principal: 100000 + Math.floor(r() * 19900000),
      annualRate: 0.06 + r() * 0.09,
      months: 12 + Math.floor(r() * 348),
    };
    const month = 1 + Math.floor(r() * (loan.months - 1));
    const amount = 10000 + Math.floor(r() * 500000);
    const c = L.compare({ loan, prepayments: [{ month, amount }] });
    assert.ok(c.tenure.netInterestSaved >= c.emi.netInterestSaved - 1,
      `tenure should dominate: ${c.tenure.netInterestSaved} vs ${c.emi.netInterestSaved}`);
    assert.ok(c.tenure.netInterestSaved > 0, 'positive saving when prepay>0 & rate>0');
    assert.ok(c.emi.netInterestSaved > 0);
  }
});

test('rate-change no-op deep-equals baseline; genuine change keeps balance continuous', () => {
  const base = L.buildSchedule({ loan: FIX_A });
  const noop = L.buildSchedule({
    loan: FIX_A,
    rateChanges: [{ month: 37, newRate: 0.085, mode: 'tenure' }],
  });
  assert.deepEqual(noop.rows, base.rows, 'r->r is a no-op');

  for (const mode of ['tenure', 'emi']) {
    const M = 61;
    const changed = L.buildSchedule({
      loan: FIX_A,
      rateChanges: [{ month: M, newRate: 0.095, mode }],
    });
    // closing at M-1 === opening at M (continuity across the reprice)
    assert.equal(changed.rows[M - 2].closing, changed.rows[M - 1].opening,
      `continuity under mode ${mode}`);
  }
});

test('prepayment >= outstanding closes loan that month, no negative row', () => {
  const s = L.buildSchedule({
    loan: FIX_B, strategy: 'tenure',
    prepayments: [{ month: 12, amount: 5000000 }], // way more than balance
  });
  assert.equal(s.months, 12, 'closes at month 12');
  const last = s.rows[11];
  assert.equal(last.closing, 0);
  // final outflow that month = EMI + prepay (prepay clamped to remaining balance)
  for (const r of s.rows) assert.ok(r.closing >= 0);
});

test('charge honesty: netInterestSaved === grossInterestSaved − totalCharges', () => {
  const cfg = {
    loan: FIX_A, strategy: 'tenure',
    prepayments: [{ month: 12, amount: 200000 }, { month: 24, amount: 200000 }],
    charge: { type: 'percent', value: 2 },
  };
  const c = L.compare(cfg);
  assert.equal(c.tenure.netInterestSaved,
    c.tenure.grossInterestSaved - c.tenure.totalCharges);
  assert.ok(c.tenure.totalCharges > 0, 'charges applied');
  // flat charge too
  const c2 = L.compare({ ...cfg, charge: { type: 'flat', value: 1500 } });
  assert.equal(c2.tenure.totalCharges, 2 * 150000, 'two events × ₹1500 flat = 3000 rupees paise');
});

test('property fuzz: 500 randomized loans reconcile, close at 0, never NaN/negative', () => {
  const r = rng('fuzz-500');
  for (let t = 0; t < 500; t++) {
    const loan = {
      principal: 100000 + Math.floor(r() * 19900000),
      annualRate: 0.06 + r() * 0.09,
      months: 12 + Math.floor(r() * 348),
    };
    const nPre = Math.floor(r() * 4);
    const prepayments = [];
    for (let j = 0; j < nPre; j++) {
      prepayments.push({
        month: 1 + Math.floor(r() * (loan.months - 1)),
        amount: 5000 + Math.floor(r() * 300000),
      });
    }
    const nRate = Math.floor(r() * 3);
    const rateChanges = [];
    for (let j = 0; j < nRate; j++) {
      rateChanges.push({
        month: 1 + Math.floor(r() * (loan.months - 1)),
        newRate: 0.06 + r() * 0.09,
        mode: r() < 0.5 ? 'tenure' : 'emi',
      });
    }
    const strategy = r() < 0.5 ? 'tenure' : 'emi';
    const s = L.buildSchedule({ loan, strategy, prepayments, rateChanges });
    let sumP = 0;
    for (const row of s.rows) {
      for (const cell of [row.opening, row.emi, row.interest, row.principal, row.prepay, row.closing]) {
        assert.ok(Number.isFinite(cell) && !Number.isNaN(cell), `finite cell t${t} m${row.month}`);
        assert.ok(cell >= 0, `non-negative cell t${t} m${row.month}`);
      }
      sumP += row.principal + row.prepay;
    }
    assert.equal(sumP, L.toPaise(loan.principal), `reconcile t${t}`);
    assert.equal(s.rows[s.rows.length - 1].closing, 0, `close-at-0 t${t}`);
  }
});

// ---------------------------------------------------------------------------
test('CSV round-trip: RFC-4180 export re-parses to identical rows/headers/totals', () => {
  const s = L.buildSchedule({ loan: FIX_B, prepayments: [{ month: 12, amount: 100000 }] });
  const header = ['month', 'opening', 'emi', 'interest', 'principal', 'prepay', 'closing'];
  const rows = [header].concat(s.rows.map((r) =>
    [r.month, r.opening, r.emi, r.interest, r.principal, r.prepay, r.closing]));
  const csv = F.toCSV(rows);
  const parsed = F.parseCSV(csv);
  assert.equal(parsed.length, rows.length, 'row count preserved');
  assert.deepEqual(parsed[0], header, 'header set preserved');
  // column totals for the 'principal' column survive the round trip
  const idx = header.indexOf('principal');
  const origTotal = s.rows.reduce((a, r) => a + r.principal, 0);
  const parsedTotal = parsed.slice(1).reduce((a, r) => a + Number(r[idx]), 0);
  assert.equal(parsedTotal, origTotal, 'principal column total preserved');
});

test('CSV quoting survives a scenario name with a comma and quotes', () => {
  const name = 'bonus "big", month 12';
  const csv = F.toCSV([['name'], [name]]);
  const parsed = F.parseCSV(csv);
  assert.equal(parsed[1][0], name);
});

test('money formatting: Indian lakh/crore grouping and paise', () => {
  assert.equal(F.money(500000000, 'in'), '50,00,000.00'); // ₹50,00,000
  assert.equal(F.money(500000000, 'plain'), '5,000,000.00');
  assert.equal(F.money(4339116, 'in'), '43,391.16');
  assert.equal(F.money(-100050, 'in'), '-1,000.50');
});

test('expandPrepayments: recurring events materialize on the right months', () => {
  const ev = L.expandPrepayments([{ month: 12, amount: 50000, everyMonths: 12 }], 40);
  assert.deepEqual(ev.map((e) => e.month), [12, 24, 36]);
  // merge same-month one-time + recurring
  const ev2 = L.expandPrepayments(
    [{ month: 12, amount: 10000 }, { month: 12, amount: 5000, everyMonths: 24 }], 30);
  const m12 = ev2.find((e) => e.month === 12);
  assert.equal(m12.amount, 15000);
});

test('determinism: identical inputs yield byte-identical schedules', () => {
  const cfg = { loan: FIX_A, strategy: 'emi', prepayments: [{ month: 18, amount: 250000 }] };
  const a = JSON.stringify(L.buildSchedule(cfg));
  const b = JSON.stringify(L.buildSchedule(cfg));
  assert.equal(a, b);
});

/* ============================================================
   preclose — loan engine (pure functions, no DOM, no network)
   Dual-export: browser global (window.PRECLOSE) + Node (module.exports).
   ALL money is computed in INTEGER PAISE; rupees are display-only.
   Monthly-rest reducing-balance model (disclosed on-screen).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PRECLOSE = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- rounding helpers (paise integers) ---------------------------------
  // Round a paise amount held as a float to the nearest whole paisa.
  function roundPaise(x) { return Math.round(x); }
  // Rupees (float) -> integer paise.
  function toPaise(rupees) { return Math.round(rupees * 100); }
  // Integer paise -> rupees (float), display only.
  function toRupees(paise) { return paise / 100; }

  // ---- closed-form annuity EMI (returns rupees, 2-dp) --------------------
  // EMI = P·i·(1+i)^n / ((1+i)^n − 1),  i = annualRate/12
  // rate 0% => P/n exactly.
  function emi(principalRupees, annualRate, months) {
    if (months <= 0) throw new Error('months must be > 0');
    const i = annualRate / 12;
    if (i === 0) return Math.round((principalRupees / months) * 100) / 100;
    const f = Math.pow(1 + i, months);
    return Math.round((principalRupees * i * f) / (f - 1) * 100) / 100;
  }

  // ---- closed-form outstanding balance after k payments (rupees) ---------
  // B(k) = P·(1+i)^k − EMI·((1+i)^k − 1)/i
  // Uses the paise-rounded EMI so it matches the schedule the borrower pays.
  function balanceAfter(principalRupees, annualRate, months, k) {
    const i = annualRate / 12;
    const E = emi(principalRupees, annualRate, months);
    if (i === 0) return principalRupees - E * k;
    const f = Math.pow(1 + i, k);
    return principalRupees * f - (E * (f - 1)) / i;
  }

  // Monthly interest on an integer-paise balance at annual rate (paise).
  function monthlyInterestPaise(balPaise, annualRate) {
    return roundPaise(balPaise * (annualRate / 12));
  }

  /* ------------------------------------------------------------------
     buildSchedule — the self-verifying iterative core.
     Inputs (all optional beyond loan):
       loan: { principal(₹), annualRate(decimal e.g. 0.085), months }
       strategy: 'tenure' | 'emi'   (how a prepayment is absorbed)
       prepayments: [{ month, amount(₹) }]   (already expanded; see expandPrepayments)
       rateChanges: [{ month, newRate(decimal), mode: 'tenure'|'emi' }]
       charge: { type: 'flat'|'percent', value } | null  (per prepayment event)
     Returns:
       { rows[], totalInterest(paise), months(actual), emiStart(paise),
         closureMonth, totalCharges(paise), totalPrepaid(paise) }
     Every row: { month, opening, emi, interest, principal, prepay, charge,
                  closing }  — all integer paise except month.
     Invariants (asserted in tests): closing >= 0 always; final closing === 0;
       Σ principal + Σ prepay === original principal; interest = round(opening·i);
       principal = emi − interest (clamped); closing = opening − principal − prepay.
     ------------------------------------------------------------------ */
  function buildSchedule(cfg) {
    const principalPaise = toPaise(cfg.loan.principal);
    const originalMonths = cfg.loan.months | 0;
    let annualRate = cfg.loan.annualRate;
    const strategy = cfg.strategy || 'tenure';

    const prepays = indexEvents(cfg.prepayments || []);
    const rateChanges = indexEvents(cfg.rateChanges || []);
    const charge = cfg.charge || null;

    // current EMI in paise; recomputed on reprice/reduce-EMI prepay.
    let emiPaise = toPaise(emi(cfg.loan.principal, annualRate, originalMonths));
    let bal = principalPaise;
    let remainingMonths = originalMonths; // months left under current EMI plan

    const rows = [];
    let totalInterest = 0;
    let totalCharges = 0;
    let totalPrepaid = 0;
    let month = 0;
    const HARD_CAP = originalMonths + 1200; // safety valve; tenure can only shrink

    while (bal > 0 && month < HARD_CAP) {
      month += 1;

      // --- rate change effective at the START of this month ---
      const rc = rateChanges.get(month);
      if (rc) {
        annualRate = rc.newRate;
        if ((rc.mode || 'tenure') === 'emi') {
          // re-derive EMI over the months still remaining, keep tenure
          emiPaise = toPaise(
            emi(toRupees(bal), annualRate, Math.max(1, remainingMonths))
          );
        }
        // mode 'tenure': keep EMI, let the tail lengthen/shorten naturally.
      }

      const opening = bal;
      const interest = monthlyInterestPaise(opening, annualRate);
      totalInterest += interest;

      // --- scheduled principal from the current EMI (clamped) ---
      let pay = emiPaise;
      let principal = pay - interest;
      // If the EMI cannot even cover interest (deep negative-am edge), or this is
      // the natural final month, close the loan cleanly.
      const isNaturalFinal = remainingMonths <= 1;
      if (principal >= opening || isNaturalFinal) {
        principal = opening; // never over-pay principal
        pay = principal + interest;
      } else if (principal < 0) {
        principal = 0; // guard; balance would grow — disclosed model won't emit this for valid inputs
      }
      bal = opening - principal;
      remainingMonths -= 1;

      // --- prepayment applied at END of this month (after the EMI) ---
      let prepay = 0;
      let chargePaise = 0;
      const pe = prepays.get(month);
      if (pe && bal > 0) {
        prepay = Math.min(toPaise(pe.amount), bal);
        bal -= prepay;
        totalPrepaid += prepay;
        if (charge) {
          if (charge.type === 'percent') {
            chargePaise = roundPaise(prepay * (charge.value / 100));
          } else {
            chargePaise = toPaise(charge.value);
          }
          totalCharges += chargePaise;
        }
        // reduce-EMI: re-derive EMI over the SAME remaining months.
        if (strategy === 'emi' && bal > 0 && remainingMonths > 0) {
          emiPaise = toPaise(emi(toRupees(bal), annualRate, remainingMonths));
        }
        // reduce-tenure: keep EMI; the loan simply ends sooner.
      }

      rows.push({
        month,
        opening,
        emi: pay,
        interest,
        principal,
        prepay,
        charge: chargePaise,
        closing: bal,
      });

      if (bal <= 0) break;
    }

    return {
      rows,
      months: rows.length,
      totalInterest,
      totalCharges,
      totalPrepaid,
      emiStart: toPaise(emi(cfg.loan.principal, cfg.loan.annualRate, originalMonths)),
      closureMonth: rows.length,
    };
  }

  // Map month -> event (last write wins for a given month).
  function indexEvents(list) {
    const m = new Map();
    for (const e of list) m.set(e.month | 0, e);
    return m;
  }

  /* Expand recurring prepayments into concrete {month, amount} events up to
     a horizon of `months`. One-time events have interval 0/undefined. */
  function expandPrepayments(events, months) {
    const out = [];
    for (const ev of events || []) {
      const amount = ev.amount;
      if (ev.everyMonths && ev.everyMonths > 0) {
        let m = ev.month | 0;
        for (; m <= months; m += ev.everyMonths) out.push({ month: m, amount });
      } else {
        out.push({ month: ev.month | 0, amount });
      }
    }
    // merge events landing on the same month (sum amounts)
    const byMonth = new Map();
    for (const e of out) {
      byMonth.set(e.month, (byMonth.get(e.month) || 0) + toPaise(e.amount));
    }
    return [...byMonth.entries()]
      .map(([month, paise]) => ({ month, amount: toRupees(paise) }))
      .sort((a, b) => a.month - b.month);
  }

  /* The comparison core: run the baseline (no events) and the with-events
     schedule under a given strategy; return interest saved (paise) net of
     charges, months erased, new EMI, and closure month. */
  function compare(cfg) {
    const baseline = buildSchedule({ loan: cfg.loan });
    function withStrategy(strategy) {
      const s = buildSchedule({
        loan: cfg.loan,
        strategy,
        prepayments: cfg.prepayments,
        rateChanges: cfg.rateChanges,
        charge: cfg.charge,
      });
      const grossSaved = baseline.totalInterest - s.totalInterest;
      const netSaved = grossSaved - s.totalCharges;
      return {
        schedule: s,
        grossInterestSaved: grossSaved,
        totalCharges: s.totalCharges,
        netInterestSaved: netSaved,
        monthsErased: baseline.months - s.months,
        newEmi: s.rows.length ? s.rows[s.rows.length - 1].emi : s.emiStart,
        emiAfterFirstPrepay: emiAfterFirstPrepay(s),
        closureMonth: s.closureMonth,
      };
    }
    return {
      baseline,
      tenure: withStrategy('tenure'),
      emi: withStrategy('emi'),
    };
  }

  // The EMI in force on the row AFTER the first prepayment (reduce-EMI check).
  function emiAfterFirstPrepay(s) {
    for (let idx = 0; idx < s.rows.length; idx++) {
      if (s.rows[idx].prepay > 0 && idx + 1 < s.rows.length) {
        return s.rows[idx + 1].emi;
      }
    }
    return s.rows.length ? s.rows[0].emi : 0;
  }

  return {
    roundPaise, toPaise, toRupees,
    emi, balanceAfter, monthlyInterestPaise,
    buildSchedule, expandPrepayments, compare,
    indexEvents, emiAfterFirstPrepay,
  };
});

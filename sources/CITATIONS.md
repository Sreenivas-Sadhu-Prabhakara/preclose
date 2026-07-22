# Citations — preclose

preclose has **no data corpus**. Every number on screen is computed from the
user's own inputs via the closed-form annuity formulas (re-derived and
cross-checked in `test/loan.test.js`). The only embedded *fact* is a single
static informational note about prepayment/foreclosure charges. It drives **no
calculation** — the prepayment-charge field is always user-entered.

## The one informational note (guidance text only)

> The Reserve Bank of India bars banks from levying foreclosure charges or
> pre-payment penalties on floating-rate term loans sanctioned to **individual**
> borrowers. Fixed-rate loans may still carry charges per your sanction letter —
> so confirm against yours.

**Source (verified verbatim, 2026-07-22):**

- Reserve Bank of India, circular **RBI/2013-14/582**, *DBOD.Dir.BC.No.110/13.03.00/2013-14*, dated **May 7, 2014** — "Levy of foreclosure charges / pre-payment penalty on Floating Rate Term Loans."
  Verbatim instruction: *"banks will not be permitted to charge foreclosure charges / pre-payment penalties on all floating rate term loans sanctioned to individual borrowers, with immediate effect."*
  URL: https://www.rbi.org.in/commonman/english/Scripts/Notification.aspx?Id=1381
  (A parallel NBFC circular *DNBR (PD) CC.No.101/03.10.001/2019-20* dated Aug 2, 2019 extends the principle to NBFC floating-rate term loans.)

**verified_how:** the RBI notification page was fetched at authoring time and the
instruction quoted word-for-word; `verified_on = 2026-07-22` is surfaced in-app
beside the note.

**Honest hedge shown in-app:** the note ends with "check your sanction letter"
because scope, product type (fixed vs floating), and the exact fee schedule are
lender-specific and change over time. preclose never asserts a fee amount — the
borrower types their own charge.

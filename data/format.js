/* ============================================================
   preclose — formatting + RFC-4180 CSV (pure, testable in Node)
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PRECLOSE_FMT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Indian lakh/crore grouping of an integer number (string in), e.g.
  // 12345678 -> "1,23,45,678". Plain grouping puts commas every 3 digits.
  function groupIndian(intStr) {
    const neg = intStr.startsWith('-');
    let s = neg ? intStr.slice(1) : intStr;
    if (s.length <= 3) return (neg ? '-' : '') + s;
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const parts = [];
    while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest.length) parts.unshift(rest);
    return (neg ? '-' : '') + parts.join(',') + ',' + last3;
  }

  function groupPlain(intStr) {
    const neg = intStr.startsWith('-');
    let s = neg ? intStr.slice(1) : intStr;
    return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Format integer paise as a money string. mode 'in' (Indian) or 'plain'.
  function money(paise, mode) {
    const neg = paise < 0;
    const abs = Math.abs(paise);
    const rupees = Math.floor(abs / 100);
    const p = String(abs % 100).padStart(2, '0');
    const grouped = (mode === 'plain' ? groupPlain : groupIndian)(String(rupees));
    return (neg ? '-' : '') + grouped + '.' + p;
  }

  // ---- RFC-4180 CSV ------------------------------------------------------
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows) {
    // rows: array of arrays (first row = header). CRLF line endings per RFC-4180.
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  // A compliant RFC-4180 parser (used by the round-trip self-test).
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let i = 0;
    let inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"') { inQuotes = true; i += 1; continue; }
      if (c === ',') { row.push(field); field = ''; i += 1; continue; }
      if (c === '\r') { i += 1; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
      field += c; i += 1;
    }
    row.push(field);
    rows.push(row);
    return rows;
  }

  // djb2 hash (stable localStorage keying by config).
  function djb2(str) {
    let h = 5381;
    for (let k = 0; k < str.length; k++) h = ((h << 5) + h + str.charCodeAt(k)) >>> 0;
    return h.toString(36);
  }

  return { groupIndian, groupPlain, money, toCSV, parseCSV, csvCell, djb2 };
});

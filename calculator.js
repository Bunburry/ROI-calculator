// ══════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════
const PRIE_FEE = 30000;
const WORK_HRS = 2080;    // BLS standard: 52 wks × 40 hrs
const WORK_DAYS = 240;    // Trading days per year
const UTIL_CAP = 0.80;    // 80% utilisation ceiling
const MAX_ANALYST_HRS = WORK_HRS * UTIL_CAP; // 1,664 hrs per analyst per year

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
const S = {
  aum: null, aumLabel: null, aumFeePct: null,
  team: null, teamLabel: null,
  salary: null, hr: null, salaryLabel: null,
  tasks: new Set(),
  vol: 10, cyc: 2
};

// ══════════════════════════════════════════════════
// INPUT HANDLERS
// ══════════════════════════════════════════════════
function pickAUM(el) {
  document.querySelectorAll('[data-g="aum"]').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  S.aum = el.dataset.v;
  S.aumLabel = el.dataset.label;
  S.aumFeePct = parseFloat(el.dataset.feepct);
  const v = parseInt(el.dataset.vol), c = parseInt(el.dataset.cyc);
  S.vol = v; S.cyc = c;
  document.getElementById('vol-sl').value = v;
  document.getElementById('cyc-sl').value = c;
  document.getElementById('vol-disp').innerHTML = v + '<small>portfolios / yr</small>';
  document.getElementById('cyc-disp').innerHTML = c + '<small>&times; / year</small>';
  document.getElementById('n0').disabled = false;
}

function pick(el) {
  const g = el.dataset.g;
  document.querySelectorAll('[data-g="' + g + '"]').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  if (g === 'team') { S.team = parseFloat(el.dataset.v); S.teamLabel = el.dataset.label; document.getElementById('n1').disabled = false; }
  if (g === 'salary') { S.salary = parseFloat(el.dataset.v); S.hr = parseFloat(el.dataset.hr); S.salaryLabel = el.dataset.label; document.getElementById('n2').disabled = false; }
}

function toggleTask(el) {
  const t = el.dataset.task;
  if (S.tasks.has(t)) { S.tasks.delete(t); el.classList.remove('sel'); }
  else { S.tasks.add(t); el.classList.add('sel'); }
  document.getElementById('n3').disabled = (S.tasks.size === 0);
  updatePreview();
}

function onVol(v) { S.vol = parseInt(v); document.getElementById('vol-disp').innerHTML = v + '<small>portfolios / yr</small>'; updatePreview(); }
function onCyc(v) { S.cyc = parseInt(v); document.getElementById('cyc-disp').innerHTML = v + '<small>&times; / year</small>'; updatePreview(); }

// ══════════════════════════════════════════════════
// CORE CALCULATION ENGINE
//
// Task scoping: IC memo & benchmarking are team deliverables
// (one per portfolio). Per-analyst tasks scale with headcount.
// Capacity cap applied to total team hours.
// ROI denominator = Total PRIE cost (review labor + fee).
// ══════════════════════════════════════════════════
function getTaskData() {
  const out = [];

  document.querySelectorAll('.task-row.sel').forEach(el => {
    const name = el.querySelector('.task-name').textContent.trim();
    const scope = el.dataset.scope; // 'analyst' or 'team'
    let manHrs, renHrs;

    if (el.dataset.special === 'daily') {
      // Daily task: hrs/day × working days × [analysts if per-analyst]
      const dailyHrs = parseFloat(el.dataset.hrsDaily);
      const dailyRen = 0.25; // 15 min
      if (scope === 'analyst') {
        manHrs = dailyHrs * WORK_DAYS * S.team;
        renHrs = dailyRen * WORK_DAYS * S.team;
      } else {
        manHrs = dailyHrs * WORK_DAYS;
        renHrs = dailyRen * WORK_DAYS;
      }
    } else if (scope === 'analyst') {
      // Per-analyst task: each analyst independently works N portfolios × cycles
      manHrs = parseFloat(el.dataset.hrs) * S.vol * S.cyc * S.team;
      renHrs = parseFloat(el.dataset.renhrs) * S.vol * S.cyc * S.team;
    } else {
      // Shared team output (one deliverable per portfolio): no headcount multiplier
      manHrs = parseFloat(el.dataset.hrs) * S.vol * S.cyc;
      renHrs = parseFloat(el.dataset.renhrs) * S.vol * S.cyc;
    }

    out.push({ name, manHrs, renHrs, saved: manHrs - renHrs, scope });
  });

  // ── Capacity ceiling ─────────────────────────────
  // Total available hours across the team (80% utilisation)
  const teamCapacity = S.team * MAX_ANALYST_HRS;
  const rawTotal = out.reduce((a, t) => a + t.manHrs, 0);

  let capApplied = false;
  if (rawTotal > teamCapacity) {
    capApplied = true;
    const ratio = teamCapacity / rawTotal;
    out.forEach(t => {
      t.manHrs *= ratio;
      t.renHrs *= ratio;
      t.saved = t.manHrs - t.renHrs;
    });
  }

  return { tasks: out, capApplied };
}

function updatePreview() {
  if (!S.hr || S.tasks.size === 0) {
    document.getElementById('prev-hrs').textContent = '--';
    document.getElementById('prev-cost').textContent = '--';
    return;
  }
  const { tasks, capApplied } = getTaskData();
  const h = tasks.reduce((a, t) => a + t.manHrs, 0);
  document.getElementById('prev-hrs').textContent = fmtN(Math.round(h)) + ' hrs';
  document.getElementById('prev-cost').textContent = fmtM(h * S.hr);
  const cn = document.getElementById('cap-notice');
  if (cn) cn.style.display = capApplied ? 'block' : 'none';
}

// ══════════════════════════════════════════════════
// ROI CALCULATION & RESULTS RENDER
// ══════════════════════════════════════════════════
function calcROI() {
  const { tasks: td, capApplied } = getTaskData();

  const totalManH = td.reduce((a, t) => a + t.manHrs, 0);
  const totalRenH = td.reduce((a, t) => a + t.renHrs, 0);

  const manC = totalManH * S.hr;          // Manual labor cost
  const assC = totalRenH * S.hr;          // PRIE-assisted review labor cost
  const totalPRIE = assC + PRIE_FEE;      // Total PRIE investment = review labor + fee
  const savings = manC - totalPRIE;       // Net savings

  // ── CORRECT ROI FORMULA ──────────────────────────
  // ROI = (Net savings / Total PRIE cost) × 100
  // Denominator = full PRIE investment, NOT just the $30K fee
  const rawRoi = totalPRIE > 0 ? Math.round((savings / totalPRIE) * 100) : 0;

  // Payback: days until cumulative savings = PRIE fee
  // Daily savings = (manC - totalPRIE) / 365
  const annualNetSavings = savings;
  const pb = annualNetSavings > 0 ? Math.round((PRIE_FEE / (annualNetSavings / 365))) : null;

  const feeAsPct = S.aumFeePct ? (S.aumFeePct * 100).toFixed(3) : null;

  // ── Render ROI headline ──────────────────────────
  const roiEl = document.getElementById('roi-big');
  if (savings <= 0) {
    roiEl.innerHTML = '<span style="font-size:36px">Near break-even</span>';
    roiEl.className = 'big amber';
  } else {
    roiEl.innerHTML = rawRoi.toLocaleString() + '<span class="u">%</span>';
    roiEl.className = 'big green';
  }

  document.getElementById('pb-val').textContent = pb ? '~' + pb + ' days' : 'N/A';
  document.getElementById('r-manual').textContent = fmtM(manC);
  document.getElementById('r-assisted').textContent = fmtM(totalPRIE);
  const savEl = document.getElementById('r-savings');
  savEl.textContent = savings > 0 ? fmtM(savings) : '$0';
  savEl.style.color = savings > 0 ? 'var(--green)' : 'var(--amber)';

  // ── Formula boxes ────────────────────────────────
  document.getElementById('c-formula-manual').textContent =
    fmtN(Math.round(totalManH)) + ' hrs × $' + S.hr.toFixed(2) + '/hr = ' + fmtM(manC);
  document.getElementById('c-formula-prie').textContent =
    fmtN(Math.round(totalRenH)) + ' hrs × $' + S.hr.toFixed(2) + '/hr + $30K fee = ' + fmtM(totalPRIE);
  document.getElementById('c-formula-savings').textContent =
    fmtM(manC) + ' − ' + fmtM(totalPRIE) + ' = ' + fmtM(savings);

  document.getElementById('fi-manual').innerHTML =
    'Σ(task hrs) × $' + S.hr.toFixed(2) + '/hr<br>= <b>' + fmtN(Math.round(totalManH)) + ' hrs × $' + S.hr.toFixed(2) + '</b><br>= <b>' + fmtM(manC) + '</b>';
  document.getElementById('fi-prie').innerHTML =
    'PRIE review labor + $30K fee<br>= <b>' + fmtN(Math.round(totalRenH)) + ' hrs × $' + S.hr.toFixed(2) + '</b> + $30K<br>= <b>' + fmtM(assC) + ' + $30K = ' + fmtM(totalPRIE) + '</b>';
  document.getElementById('fi-savings').innerHTML =
    fmtM(manC) + ' − ' + fmtM(totalPRIE) + '<br>= <b>' + fmtM(savings) + '</b>';
  document.getElementById('fi-roi').innerHTML =
    '(' + fmtM(savings) + ' net savings) ÷ ' + fmtM(totalPRIE) + ' total PRIE cost × 100<br>= <b>' + rawRoi.toLocaleString() + '%</b>';

  // ── AUM context ──────────────────────────────────
  const aumEl = document.getElementById('aum-context');
  if (aumEl && feeAsPct) {
    aumEl.innerHTML = 'At <b>' + S.aumLabel + '</b>, the $30K PRIE fee represents approximately <b>' + feeAsPct + '%</b> of AUM.';
    aumEl.style.display = 'block';
  }

  // ── Sanity warning if cap was hit ────────────────
  const sw = document.getElementById('sanity-warn');
  if (capApplied) {
    sw.textContent = 'Note: selected tasks at this volume and frequency would exceed realistic annual capacity (' +
      fmtN(Math.round(S.team * MAX_ANALYST_HRS)) + ' hrs / year across the team). Hours have been scaled to 80% utilisation to keep the model grounded. To model a larger workload, try increasing team size in Step 2.';
    sw.style.display = 'block';
  } else {
    sw.style.display = 'none';
  }

  // ── ROI narrative caption ────────────────────────
  document.getElementById('roi-caption').innerHTML = savings > 0
    ? 'Your <b>' + S.teamLabel + '</b> at <b>' + S.salaryLabel + '</b> reviewing <b>' + fmtN(S.vol) + ' portfolios</b> spends an estimated <b>' + fmtN(Math.round(totalManH)) + ' hrs / year</b> on selected manual tasks. PRIE reduces this to <b>' + fmtN(Math.round(totalRenH)) + ' hrs / year</b> of remaining review time. Total PRIE cost (review labor + $30K fee) = <b>' + fmtM(totalPRIE) + '</b>. Net savings: <b>' + fmtM(savings) + '</b>. ROI = ' + fmtM(savings) + ' ÷ ' + fmtM(totalPRIE) + ' = <b>' + rawRoi.toLocaleString() + '%</b>.'
    : 'Based on these inputs, the labor cost savings approach the PRIE investment. Try increasing portfolio volume or review frequency — or explore the Strategic Value tab for the broader picture.';

  buildWhatYouGet(totalManH, totalRenH, savings, rawRoi, pb);
  buildCmpChart(manC, assC);
  buildHrsChart(td);
  buildTable(td, totalManH, manC);

  document.querySelectorAll('.step').forEach(s => s.classList.remove('show'));
  document.getElementById('calc-panel').style.display = 'none';
  document.getElementById('p5').classList.add('show');
  document.querySelectorAll('.prog-step').forEach(el => {
    const s = parseInt(el.dataset.s); el.classList.remove('active', 'done');
    if (s === 5) el.classList.add('active'); if (s < 5) el.classList.add('done');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildWhatYouGet(totalManH, totalRenH, savings, roi, pb) {
  const hrsSaved = Math.round(totalManH - totalRenH);
  const container = document.getElementById('what-you-get');
  if (!container) return;
  const items = [
    { icon: '⏱', color: 'var(--coral)', bg: 'rgba(255,106,91,.08)', title: fmtN(hrsSaved) + ' analyst hours reclaimed annually', body: 'That\'s <b>' + Math.round(hrsSaved / 8) + ' full working days</b> per year returned to IC debate, client strategy, and portfolio decisions.' },
    { icon: '💰', color: 'var(--green)', bg: 'rgba(90,214,160,.08)', title: savings > 0 ? fmtM(savings) + ' net labor cost savings' : 'Near break-even on labor', body: savings > 0 ? 'After the full $30K annual PRIE fee and remaining review labor, your team recovers <b>' + fmtM(savings) + '</b> in analyst time value. Faster IC turnaround, expanded coverage, and better-structured outputs add further value on top.' : 'Your inputs are near break-even on direct labor savings. Additional value comes from faster decisions, expanded portfolio coverage, and improved output quality.' },
    { icon: '📊', color: 'var(--blue-2)', bg: 'rgba(79,138,255,.08)', title: 'Filings, benchmarking & IC dossiers in under an hour', body: 'What takes your team <b>4–8 hours per portfolio</b> manually, PRIE returns as a fully structured, IC-ready dossier in <b>under 60 minutes</b>, including analyst review time.' },
    { icon: '🔭', color: 'var(--amber)', bg: 'rgba(245,185,66,.08)', title: 'Continuous monitoring across all ' + fmtN(S.vol) + ' portfolios', body: 'Manual workflows tend to concentrate time on the largest holdings. PRIE extends structured coverage across all portfolios between formal review cycles, surfacing changes as they happen.' }
  ];
  container.innerHTML = items.map(it =>
    '<div style="display:flex;gap:16px;padding:18px 20px;border:1px solid var(--line);border-radius:8px;background:' + it.bg + ';border-left:3px solid ' + it.color + '">' +
    '<div style="font-size:22px;flex-shrink:0;margin-top:2px">' + it.icon + '</div>' +
    '<div><div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px;line-height:1.3">' + it.title + '</div>' +
    '<div style="font-size:13px;color:var(--ink-2);line-height:1.65">' + it.body + '</div></div></div>'
  ).join('');
}

function go(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('show'));
  const t = document.getElementById('p' + n); if (t) t.classList.add('show');
  document.querySelectorAll('.prog-step').forEach(el => {
    const s = parseInt(el.dataset.s);
    el.classList.remove('active', 'done');
    if (s === n) el.classList.add('active'); if (s < n) el.classList.add('done');
  });
  if (n === 4) updatePreview();
  document.querySelector('.progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchTab(id, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
}

function toggleMethod() {
  const d = document.getElementById('method-drawer'),
    t = document.getElementById('method-toggle-text'),
    a = document.getElementById('method-arrow');
  if (d.style.display !== 'none') { d.style.display = 'none'; t.textContent = 'Show methodology'; a.textContent = '▼'; }
  else { d.style.display = 'block'; t.textContent = 'Hide methodology'; a.textContent = '▲'; }
}

function restart() {
  S.aum = null; S.team = null; S.salary = null; S.hr = null; S.tasks.clear(); S.vol = 10; S.cyc = 2;
  document.querySelectorAll('.opt,.task-row').forEach(c => c.classList.remove('sel'));
  document.getElementById('vol-sl').value = 10;
  document.getElementById('cyc-sl').value = 2;
  document.getElementById('vol-disp').innerHTML = '10<small>portfolios / yr</small>';
  document.getElementById('cyc-disp').innerHTML = '2<small>&times; / year</small>';
  ['n0', 'n1', 'n2', 'n3'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
  document.getElementById('p5').classList.remove('show');
  document.getElementById('calc-panel').style.display = '';
  if (cC) { cC.destroy(); cC = null; }
  if (hC) { hC.destroy(); hC = null; }
  go(0);
}

function fmtN(n) { return n.toLocaleString(); }
function fmtM(n) {
  n = Math.round(n);
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + n;
}

let cC = null, hC = null;
const CC = { m: '#c0534a', a: '#2b8fcc', f: '#3a7fd4', grid: 'rgba(120,150,255,.1)', text: '#a3acd1' };

function buildCmpChart(manC, assC) {
  if (cC) cC.destroy();
  cC = new Chart(document.getElementById('cmp-chart'), {
    type: 'bar',
    data: {
      labels: ['Manual analyst work', 'PRIE-assisted (review)', 'ReN PRIE fee'],
      datasets: [{ data: [Math.round(manC), Math.round(assC), PRIE_FEE], backgroundColor: [CC.m, CC.a, CC.f], borderRadius: 4, barThickness: 52 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmtM(ctx.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: CC.text, font: { size: 12, family: "'Inter',sans-serif" } } },
        y: { grid: { color: CC.grid }, ticks: { color: CC.text, font: { size: 11, family: "'JetBrains Mono',monospace" }, callback: v => fmtM(v) } }
      }
    }
  });
}

function buildHrsChart(td) {
  if (hC) hC.destroy();
  const wrap = document.getElementById('hrs-wrap');
  wrap.style.height = Math.max(180, td.length * 56 + 60) + 'px';
  hC = new Chart(document.getElementById('hrs-chart'), {
    type: 'bar',
    data: {
      labels: td.map(t => t.name),
      datasets: [
        { label: 'Manual hours', data: td.map(t => Math.round(t.manHrs)), backgroundColor: CC.m, borderRadius: 3, barThickness: 12 },
        { label: 'PRIE-assisted hours', data: td.map(t => Math.round(t.renHrs)), backgroundColor: CC.f, borderRadius: 3, barThickness: 12 }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + fmtN(ctx.raw) + ' hrs' } } },
      scales: {
        x: { grid: { color: CC.grid }, ticks: { color: CC.text, font: { size: 11, family: "'JetBrains Mono',monospace" }, callback: v => fmtN(v) + ' hrs' } },
        y: { grid: { display: false }, ticks: { color: '#cdd4f0', font: { size: 12, family: "'Inter',sans-serif" } } }
      }
    }
  });
}

function buildTable(td, totalManH, totalManC) {
  const tbody = document.getElementById('bk-body');
  tbody.innerHTML = '';
  const maxH = Math.max(...td.map(t => t.manHrs), 1);
  td.forEach(t => {
    const cost = Math.round(t.manHrs * S.hr);
    const pct = t.manHrs > 0 ? Math.round((t.saved / t.manHrs) * 100) : 0;
    const fill = Math.round((t.manHrs / maxH) * 100);
    const scopeLabel = t.scope === 'analyst' ? 'Per analyst' : 'Team total';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td style="color:var(--ink);font-weight:500">' + t.name + '</td>' +
      '<td style="font-size:11px;color:var(--ink-3);font-family:JetBrains Mono,monospace">' + scopeLabel + '</td>' +
      '<td class="mc">' + fmtN(Math.round(t.manHrs)) + ' hrs<div class="mini-bar"><div class="mini-fill" style="width:' + fill + '%"></div></div></td>' +
      '<td>' + fmtM(cost) + '</td>' +
      '<td style="color:var(--blue-2);font-family:JetBrains Mono,monospace;font-size:12px">' + fmtN(Math.round(t.renHrs)) + ' hrs</td>' +
      '<td class="sc">-' + fmtN(Math.round(t.saved)) + ' hrs (' + pct + '%)</td>';
    tbody.appendChild(tr);
  });
  const tfoot = document.createElement('tr');
  tfoot.innerHTML = '<td>Total</td><td></td><td class="mc">' + fmtN(Math.round(totalManH)) + ' hrs</td><td>' + fmtM(totalManC) + '</td><td></td><td class="sc">-' + fmtN(Math.round(td.reduce((a, t) => a + t.saved, 0))) + ' hrs</td>';
  tbody.appendChild(tfoot);
}

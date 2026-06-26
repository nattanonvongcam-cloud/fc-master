/* =========================================================
   FC MASTER — shared data layer
   Reads match data from a public Google Sheet (CSV export).
   ========================================================= */

// ---- CONFIG ------------------------------------------------
// Update SHEET_ID if you ever copy this sheet to a new file.
// SHEET_NAME must match the tab name exactly.
const SHEET_ID = '1xnh81cMtYIHMfO-nr7pKYIu-z2QAtzcdEwshYOd3g4I';
const SHEET_NAME = 'Matches';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// Opponent crest images, keyed by exact Opponent name as it appears
// in the sheet. Add more entries here as you get more team logos —
// any opponent not listed just falls back to the plain placeholder box.
const OPPONENT_LOGOS = {
  'Eclipse': 'https://i.ibb.co/Zzd6LCC8/png-clipart-empty-set-null-set-null-sign-mathematics-mathematics-angle-logo-thumbnail.png',
};

// ---- CSV PARSING --------------------------------------------
// Minimal RFC4180-ish parser: handles quoted fields, commas
// inside quotes, and escaped "" quotes. Good enough for a
// Google Sheets CSV export.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\r') { /* skip */ }
      else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += char; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, '');
}

// Turns raw CSV rows into match objects, skipping anything
// without a usable date (e.g. stray blank rows).
function rowsToMatches(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = {
    date: headers.indexOf('date'),
    opponent: headers.indexOf('opponent'),
    scoreFor: headers.indexOf('scorefor'),
    scoreAgainst: headers.indexOf('scoreagainst'),
    tournament: headers.indexOf('tournament'),
    mvp: headers.indexOf('mvp'),
  };

  const matches = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const dateRaw = (cells[idx.date] || '').trim();
    if (!dateRaw) continue;

    const dateObj = new Date(dateRaw);
    if (isNaN(dateObj.getTime())) continue;

    const scoreFor = parseInt(cells[idx.scoreFor], 10);
    const scoreAgainst = parseInt(cells[idx.scoreAgainst], 10);
    if (isNaN(scoreFor) || isNaN(scoreAgainst)) continue;

    let result = 'DRAW';
    if (scoreFor > scoreAgainst) result = 'WIN';
    else if (scoreFor < scoreAgainst) result = 'LOSS';

    matches.push({
      date: dateObj,
      dateRaw,
      opponent: (cells[idx.opponent] || '').trim() || 'Unknown',
      scoreFor,
      scoreAgainst,
      tournament: (cells[idx.tournament] || '').trim() || 'Friendly',
      mvp: (cells[idx.mvp] || '').trim(),
      result,
    });
  }

  // newest first
  matches.sort((a, b) => b.date - a.date);
  return matches;
}

async function fetchMatches() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  return rowsToMatches(parseCSV(text));
}

// ---- HELPERS --------------------------------------------------
function computeStats(matches) {
  const wins = matches.filter(m => m.result === 'WIN').length;
  const losses = matches.filter(m => m.result === 'LOSS').length;
  const draws = matches.filter(m => m.result === 'DRAW').length;
  const total = matches.length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  return { total, wins, losses, draws, winRate };
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function badgeFor(result) {
  const cls = result === 'WIN' ? 'badge--win' : result === 'LOSS' ? 'badge--loss' : 'badge--draw';
  return `<span class="badge ${cls}">${result}</span>`;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// =========================================================
// HOME PAGE
// =========================================================
function renderHome(matches) {
  const stats = computeStats(matches);

  setText('stat-total', stats.total);
  setText('stat-wins', stats.wins);
  setText('stat-losses', stats.losses);
  setText('stat-draws', stats.draws);
  setText('stat-winrate', `${stats.winRate}%`);

  const latestEl = document.getElementById('latest-match');
  if (latestEl) {
    if (matches.length === 0) {
      latestEl.innerHTML = emptyState('No matches yet. Add a row to the Matches sheet to see it here.');
    } else {
      const m = matches[0];
      const opponentLogo = OPPONENT_LOGOS[m.opponent];
      const opponentCrest = opponentLogo
        ? `<img class="team-crest" src="${escapeHTML(opponentLogo)}" alt="${escapeHTML(m.opponent)} logo">`
        : `<div class="team-crest"></div>`;

      latestEl.innerHTML = `
        <div class="latest-match">
          <div class="latest-match__side">
	  <img class="team-crest" src="https://cdn.discordapp.com/icons/1453560675459924280/046e677ec699f821ec7f6a9abeb33d69.webp?size=80&quality=lossless" alt="FC Master logo">
          </div>
          <div class="latest-match__score">
            <span>${m.scoreFor}</span>
            <span class="latest-match__divider">&ndash;</span>
            <span>${m.scoreAgainst}</span>
          </div>
          <div class="latest-match__side">
            ${opponentCrest}
            <span class="latest-match__name">${escapeHTML(m.opponent)}</span>
          </div>
        </div>
        <div class="latest-match__meta">
          <span>${badgeFor(m.result)}</span>
          <span>${formatDate(m.date)} &middot; ${escapeHTML(m.tournament)}</span>
        </div>
      `;
    }
  }

  const recentEl = document.getElementById('recent-matches');
  if (recentEl) {
    const recent = matches.slice(0, 4);
    if (recent.length === 0) {
      recentEl.innerHTML = emptyState('No recent matches to show yet.');
    } else {
      recentEl.innerHTML = recent.map(m => `
        <div class="panel match-card-mini">
          <div class="match-card-mini__top">
            <span class="match-card-mini__opponent">vs ${escapeHTML(m.opponent)}</span>
            ${badgeFor(m.result)}
          </div>
          <span class="match-card-mini__score">${m.scoreFor} &ndash; ${m.scoreAgainst}</span>
          <span class="match-card-mini__date">${formatDate(m.date)}</span>
        </div>
      `).join('');
    }
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function emptyState(msg) {
  return `<div class="state-message">${escapeHTML(msg)}</div>`;
}

function errorState(msg) {
  return `<div class="state-message state-message--error">
    Couldn't load match data
    <small>${escapeHTML(msg)}</small>
  </div>`;
}

// =========================================================
// MATCHES PAGE (match history table + result filter)
// =========================================================
let ALL_MATCHES = [];
let ACTIVE_FILTER = 'ALL';

function renderMatchesTable() {
  const tbody = document.getElementById('matches-tbody');
  const countEl = document.getElementById('filter-count');
  if (!tbody) return;

  const filtered = ACTIVE_FILTER === 'ALL'
    ? ALL_MATCHES
    : ALL_MATCHES.filter(m => m.result === ACTIVE_FILTER);

  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${ALL_MATCHES.length} matches`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">${emptyState('No matches found for this filter.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(m => `
    <tr>
      <td data-label="Date" class="cell-muted">${formatDate(m.date)}</td>
      <td data-label="Opponent">vs ${escapeHTML(m.opponent)}</td>
      <td data-label="Score" class="cell-score">${m.scoreFor} &ndash; ${m.scoreAgainst}</td>
      <td data-label="Result">${badgeFor(m.result)}</td>
      <td data-label="Tournament"><span class="cell-tournament-tag">${escapeHTML(m.tournament)}</span></td>
      <td data-label="MVP" class="cell-muted">${m.mvp ? escapeHTML(m.mvp) : '&mdash;'}</td>
    </tr>
  `).join('');
}

function setupFilterBar() {
  const buttons = document.querySelectorAll('.filter-btn[data-filter]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_FILTER = btn.dataset.filter;
      buttons.forEach(b => b.classList.toggle('is-active', b === btn));
      renderMatchesTable();
    });
  });
}

// =========================================================
// STATS PAGE (streak/average cards + Chart.js visuals)
// =========================================================

// matches is newest-first. Current streak = how many of the most
// recent matches share the same result. Best streak = the longest
// run of consecutive WINs anywhere in the history.
function computeStreaks(matches) {
  let current = 0;
  let currentType = null;

  if (matches.length > 0) {
    currentType = matches[0].result;
    for (const m of matches) {
      if (m.result === currentType) current++;
      else break;
    }
  }

  let best = 0;
  let run = 0;
  const chrono = [...matches].reverse();
  for (const m of chrono) {
    if (m.result === 'WIN') { run++; if (run > best) best = run; }
    else { run = 0; }
  }

  return { current, currentType, best };
}

function computeAverages(matches) {
  if (matches.length === 0) return { avgFor: 0, avgAgainst: 0 };
  const totalFor = matches.reduce((sum, m) => sum + m.scoreFor, 0);
  const totalAgainst = matches.reduce((sum, m) => sum + m.scoreAgainst, 0);
  return {
    avgFor: totalFor / matches.length,
    avgAgainst: totalAgainst / matches.length,
  };
}

function streakSuffix(type) {
  return type === 'WIN' ? 'W' : type === 'LOSS' ? 'L' : type === 'DRAW' ? 'D' : '';
}

function streakColorClass(type) {
  return type === 'WIN' ? 'stat-card__value--win'
    : type === 'LOSS' ? 'stat-card__value--loss'
    : type === 'DRAW' ? 'stat-card__value--draw'
    : '';
}

function renderStreakStats(matches) {
  const streaks = computeStreaks(matches);
  const avgs = computeAverages(matches);
  const hasMatches = matches.length > 0;

  const currentEl = document.getElementById('stat-current-streak');
  if (currentEl) {
    currentEl.textContent = hasMatches ? `${streaks.current}${streakSuffix(streaks.currentType)}` : '—';
    currentEl.className = `stat-card__value ${hasMatches ? streakColorClass(streaks.currentType) : ''}`;
  }

  setText('stat-best-streak', hasMatches ? `${streaks.best}W` : '—');
  setText('stat-avg-for', hasMatches ? avgs.avgFor.toFixed(1) : '—');
  setText('stat-avg-against', hasMatches ? avgs.avgAgainst.toFixed(1) : '—');
}

// Cumulative win rate after each match, oldest to newest.
function computeWinRateSeries(matches) {
  const chrono = [...matches].reverse();
  let wins = 0;
  const labels = [];
  const data = [];
  chrono.forEach((m, i) => {
    if (m.result === 'WIN') wins++;
    labels.push(formatDateShort(m.date));
    data.push(Math.round((wins / (i + 1)) * 100));
  });
  return { labels, data };
}

// Goals for/against for the most recent `count` matches, oldest to newest.
function computeGoalsSeries(matches, count) {
  const chrono = [...matches].reverse();
  const slice = chrono.slice(-count);
  return {
    labels: slice.map(m => formatDateShort(m.date)),
    goalsFor: slice.map(m => m.scoreFor),
    goalsAgainst: slice.map(m => m.scoreAgainst),
  };
}

function chartCanvasWrap(canvasId) {
  const canvas = document.getElementById(canvasId);
  return canvas ? canvas.closest('.chart-canvas-wrap') : null;
}

function showChartMessage(canvasId, msg) {
  const wrap = chartCanvasWrap(canvasId);
  if (wrap) wrap.innerHTML = emptyState(msg);
}

let CHART_INSTANCES = [];

function renderCharts(matches) {
  CHART_INSTANCES.forEach(c => c.destroy());
  CHART_INSTANCES = [];

  if (typeof Chart === 'undefined') {
    ['chart-winrate', 'chart-breakdown', 'chart-goals'].forEach(id =>
      showChartMessage(id, 'Chart library failed to load. Check your connection and refresh.')
    );
    return;
  }

  if (matches.length === 0) {
    ['chart-winrate', 'chart-breakdown', 'chart-goals'].forEach(id =>
      showChartMessage(id, 'No matches yet. Add a row to the Matches sheet to see charts here.')
    );
    return;
  }

  const win = cssVar('--win');
  const loss = cssVar('--loss');
  const draw = cssVar('--draw');
  const accentBright = cssVar('--accent-blue-bright');
  const gridColor = cssVar('--border-line');
  const textColor = cssVar('--text-secondary');
  const panelBg = cssVar('--bg-panel');

  Chart.defaults.color = textColor;
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.font.size = 11;

  const legendLabelFont = { family: "'Oswald', sans-serif", size: 11 };

  const winrateCanvas = document.getElementById('chart-winrate');
  if (winrateCanvas) {
    const wr = computeWinRateSeries(matches);
    CHART_INSTANCES.push(new Chart(winrateCanvas, {
      type: 'line',
      data: {
        labels: wr.labels,
        datasets: [{
          label: 'Win Rate',
          data: wr.data,
          borderColor: accentBright,
          backgroundColor: 'rgba(91, 157, 255, 0.14)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 6 } },
          y: { grid: { color: gridColor }, min: 0, max: 100, ticks: { callback: v => v + '%' } },
        },
      },
    }));
  }

  const breakdownCanvas = document.getElementById('chart-breakdown');
  if (breakdownCanvas) {
    const stats = computeStats(matches);
    CHART_INSTANCES.push(new Chart(breakdownCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Wins', 'Losses', 'Draws'],
        datasets: [{
          data: [stats.wins, stats.losses, stats.draws],
          backgroundColor: [win, loss, draw],
          borderColor: panelBg,
          borderWidth: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 16, font: legendLabelFont } },
        },
      },
    }));
  }

  const goalsCanvas = document.getElementById('chart-goals');
  if (goalsCanvas) {
    const g = computeGoalsSeries(matches, 10);
    CHART_INSTANCES.push(new Chart(goalsCanvas, {
      type: 'bar',
      data: {
        labels: g.labels,
        datasets: [
          { label: 'Goals For', data: g.goalsFor, backgroundColor: win, borderRadius: 4, maxBarThickness: 28 },
          { label: 'Goals Against', data: g.goalsAgainst, backgroundColor: loss, borderRadius: 4, maxBarThickness: 28 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 16, font: legendLabelFont } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: gridColor }, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    }));
  }
}

// =========================================================
// INIT — detect which page we're on by its DOM, then render
// =========================================================
async function init() {
  const isHome = document.getElementById('recent-matches');
  const isMatchesPage = document.getElementById('matches-tbody');
  const isStatsPage = document.getElementById('chart-winrate');

  try {
    const matches = await fetchMatches();
    ALL_MATCHES = matches;

    if (isHome) renderHome(matches);
    if (isMatchesPage) {
      setupFilterBar();
      renderMatchesTable();
    }
    if (isStatsPage) {
      renderStreakStats(matches);
      renderCharts(matches);
    }
  } catch (err) {
    console.error('FC Master: failed to load match data', err);
    const msg = 'Check that the Google Sheet is shared as "Anyone with the link" and the tab is named "Matches".';

    if (isHome) {
      ['latest-match', 'recent-matches'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = errorState(msg);
      });
      ['stat-total', 'stat-wins', 'stat-losses', 'stat-draws', 'stat-winrate'].forEach(id => setText(id, '—'));
    }
    if (isMatchesPage) {
      document.getElementById('matches-tbody').innerHTML =
        `<tr><td colspan="6">${errorState(msg)}</td></tr>`;
    }
    if (isStatsPage) {
      renderStreakStats([]);
      ['chart-winrate', 'chart-breakdown', 'chart-goals'].forEach(id => showChartMessage(id, msg));
    }
  }
}

document.addEventListener('DOMContentLoaded', init);

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
      latestEl.innerHTML = `
        <div class="latest-match">
          <div class="latest-match__side">
            <div class="team-crest"></div>
            <span class="latest-match__name">FC Master</span>
          </div>
          <div class="latest-match__score">
            <span>${m.scoreFor}</span>
            <span class="latest-match__divider">&ndash;</span>
            <span>${m.scoreAgainst}</span>
          </div>
          <div class="latest-match__side">
            <div class="team-crest"></div>
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
// INIT — detect which page we're on by its DOM, then render
// =========================================================
async function init() {
  const isHome = document.getElementById('recent-matches');
  const isMatchesPage = document.getElementById('matches-tbody');

  try {
    const matches = await fetchMatches();
    ALL_MATCHES = matches;

    if (isHome) renderHome(matches);
    if (isMatchesPage) {
      setupFilterBar();
      renderMatchesTable();
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
  }
}

document.addEventListener('DOMContentLoaded', init);

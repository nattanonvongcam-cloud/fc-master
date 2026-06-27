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

const PLAYERS_SHEET_NAME = 'Players';
const PLAYERS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(PLAYERS_SHEET_NAME)}`;
const TEAMS_SHEET_NAME = 'Teams';
const TEAMS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TEAMS_SHEET_NAME)}`;

// Fallback avatar shown when a player has no Avatar URL in the sheet.
const DEFAULT_AVATAR = '';
const ORG_TEAMS = ['main', 'fc master', 'eclipse', 'rising'];

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

function normalizeTeamValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function isOrgTeam(value) {
  return ORG_TEAMS.some(team => normalizeTeamValue(team) === normalizeTeamValue(value));
}

function getOpponentSide(match) {
  const homeIsOrg = isOrgTeam(match.homeTeam);
  const awayIsOrg = isOrgTeam(match.awayTeam);

  if (homeIsOrg && !awayIsOrg) {
    return { name: match.awayTeam || 'Unknown', logo: match.awayLogo || '' };
  }
  if (awayIsOrg && !homeIsOrg) {
    return { name: match.homeTeam || 'Unknown', logo: match.homeLogo || '' };
  }
  return { name: match.awayTeam || match.homeTeam || 'Unknown', logo: match.awayLogo || match.homeLogo || '' };
}

function getOurSide(match) {
  if (isOrgTeam(match.homeTeam)) {
    return { score: match.scoreFor, against: match.scoreAgainst };
  }
  if (isOrgTeam(match.awayTeam)) {
    return { score: match.scoreAgainst, against: match.scoreFor };
  }
  return { score: match.scoreFor, against: match.scoreAgainst };
}

// Turns raw CSV rows into match objects, skipping anything
// without a usable date (e.g. stray blank rows).
function rowsToMatches(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = {
    date: headers.indexOf('date'),
    homeTeam: headers.indexOf('hometeam'),
    awayTeam: headers.indexOf('awayteam'),
    scoreFor: headers.indexOf('scorefor'),
    scoreAgainst: headers.indexOf('scoreagainst'),
    tournament: headers.indexOf('tournament'),
    mvp: headers.indexOf('mvp'),
    homeLogo: headers.indexOf('homelogo'),
    awayLogo: headers.indexOf('awaylogo'),
  };

  const matches = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const dateRaw = (cells[idx.date] || '').trim();
    if (!dateRaw) continue;

    const dateObj = new Date(dateRaw + 'T00:00:00');
    if (isNaN(dateObj.getTime())) continue;

    const scoreFor = parseInt(cells[idx.scoreFor], 10);
    const scoreAgainst = parseInt(cells[idx.scoreAgainst], 10);
    if (isNaN(scoreFor) || isNaN(scoreAgainst)) continue;

    const homeTeam = (cells[idx.homeTeam] || '').trim() || 'Unknown';
    const awayTeam = (cells[idx.awayTeam] || '').trim() || 'Unknown';
    const homeLogo = (idx.homeLogo >= 0 ? (cells[idx.homeLogo] || '') : '').trim();
    const awayLogo = (idx.awayLogo >= 0 ? (cells[idx.awayLogo] || '') : '').trim();
    const ourSide = getOurSide({ homeTeam, awayTeam, scoreFor, scoreAgainst });

    let result = 'DRAW';
    if (ourSide.score > ourSide.against) result = 'WIN';
    else if (ourSide.score < ourSide.against) result = 'LOSS';

    matches.push({
      date: dateObj,
      dateRaw,
      homeTeam,
      awayTeam,
      homeLogo,
      awayLogo,
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

// Turns raw Players-tab CSV rows into player objects, skipping rows
// without a usable name (e.g. stray blank rows).
function rowsToPlayers(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = {
    name: headers.indexOf('name'),
    role: headers.indexOf('role'),
    team: headers.indexOf('team'),
    joined: headers.indexOf('joined'),
    goals: headers.indexOf('goals'),
    assists: headers.indexOf('assists'),
    mvps: headers.indexOf('mvps'),
    avatar: headers.indexOf('avatar'),
  };

  const players = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = (cells[idx.name] || '').trim();
    if (!name) continue;

    const joinedRaw = (cells[idx.joined] || '').trim();
    const joinedDate = joinedRaw ? new Date(joinedRaw) : null;

    players.push({
      name,
      role: (cells[idx.role] || '').trim() || 'Player',
      team: (cells[idx.team] || '').trim() || 'Main',
      joinedRaw,
      joined: joinedDate && !isNaN(joinedDate.getTime()) ? joinedDate : null,
      goals: parseInt(cells[idx.goals], 10) || 0,
      assists: parseInt(cells[idx.assists], 10) || 0,
      mvps: parseInt(cells[idx.mvps], 10) || 0,
      avatar: (cells[idx.avatar] || '').trim(),
    });
  }

  // Leaderboard-style order: most goals first.
  players.sort((a, b) => b.goals - a.goals);
  return players;
}

async function fetchPlayers() {
  const res = await fetch(PLAYERS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  return rowsToPlayers(parseCSV(text));
}

// Turns raw Teams-tab CSV rows into team objects, skipping rows
// without a usable name (e.g. stray blank rows).
function rowsToTeams(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  const idx = {
    teamId: headers.indexOf('teamid'),
    name: headers.indexOf('name'),
    captain: headers.indexOf('captain'),
    description: headers.indexOf('description'),
    logo: headers.indexOf('logo'),
  };

  const teams = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = (cells[idx.name] || '').trim();
    if (!name) continue;

    teams.push({
      teamId: (cells[idx.teamId] || '').trim() || 'main',
      name,
      captain: (cells[idx.captain] || '').trim() || 'TBD',
      description: (cells[idx.description] || '').trim(),
      logo: (cells[idx.logo] || '').trim(),
    });
  }

  teams.sort((a, b) => a.name.localeCompare(b.name));
  return teams;
}

async function fetchTeams() {
  const res = await fetch(TEAMS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  return rowsToTeams(parseCSV(text));
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
      const opponent = getOpponentSide(m);
      const opponentCrest = opponent.logo
        ? `<img class="team-crest" src="${escapeHTML(opponent.logo)}" alt="${escapeHTML(opponent.name)} logo">`
        : `<div class="team-crest"></div>`;

      latestEl.innerHTML = `
        <div class="latest-match">
          <div class="latest-match__side">
            <img class="team-crest" src="https://cdn.discordapp.com/icons/1453560675459924280/046e677ec699f821ec7f6a9abeb33d69.webp?size=80&quality=lossless" alt="FC Master logo">
            <span class="latest-match__name">FC Master</span>
          </div>
          <div class="latest-match__score">
            <span>${m.scoreFor}</span>
            <span class="latest-match__divider">&ndash;</span>
            <span>${m.scoreAgainst}</span>
          </div>
          <div class="latest-match__side">
            ${opponentCrest}
            <span class="latest-match__name">${escapeHTML(opponent.name)}</span>
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
      recentEl.innerHTML = recent.map(m => {
        const opponent = getOpponentSide(m);
        return `
          <div class="panel match-card-mini">
            <div class="match-card-mini__top">
              <span class="match-card-mini__opponent">vs ${escapeHTML(opponent.name)}</span>
              ${badgeFor(m.result)}
            </div>
            <span class="match-card-mini__score">${m.scoreFor} &ndash; ${m.scoreAgainst}</span>
            <span class="match-card-mini__date">${formatDate(m.date)}</span>
          </div>
        `;
      }).join('');
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
let ALL_TEAMS = [];
let ACTIVE_FILTER = 'ALL';
let ACTIVE_TEAM_FILTER = 'ALL';

function teamFilterKeys(team) {
  const keys = new Set();
  const id = (team.teamId || '').trim();
  const name = (team.name || '').trim();
  if (id) keys.add(normalizeTeamValue(id));
  if (name) keys.add(normalizeTeamValue(name));
  return keys;
}

function matchInvolvesTeam(match, team) {
  const keys = teamFilterKeys(team);
  const home = normalizeTeamValue(match.homeTeam);
  const away = normalizeTeamValue(match.awayTeam);
  return keys.has(home) || keys.has(away);
}

function getTeamFilteredMatches() {
  if (ACTIVE_TEAM_FILTER === 'ALL') return ALL_MATCHES;
  const team = ALL_TEAMS.find(t => (t.teamId || '').trim() === ACTIVE_TEAM_FILTER);
  if (!team) return ALL_MATCHES;
  return ALL_MATCHES.filter(m => matchInvolvesTeam(m, team));
}

function renderTeamFilterBar() {
  const bar = document.getElementById('team-filter-bar');
  if (!bar) return;

  if (ALL_TEAMS.length === 0) {
    bar.innerHTML = '<span class="filter-count">No teams in sheet</span>';
    return;
  }

  bar.innerHTML = [
    '<button type="button" class="filter-btn filter-btn--team is-active" data-team-filter="ALL">All Teams</button>',
    ...ALL_TEAMS.map(team => {
      const id = (team.teamId || '').trim();
      return `<button type="button" class="filter-btn filter-btn--team" data-team-filter="${escapeHTML(id)}">${escapeHTML(team.name)}</button>`;
    }),
  ].join('');
}

function setupTeamFilterBar(onChange) {
  const bar = document.getElementById('team-filter-bar');
  if (!bar) return;

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-team-filter]');
    if (!btn) return;
    ACTIVE_TEAM_FILTER = btn.dataset.teamFilter;
    bar.querySelectorAll('[data-team-filter]').forEach(b => {
      b.classList.toggle('is-active', b === btn);
    });
    onChange();
  });
}

function renderMatchesTable() {
  const tbody = document.getElementById('matches-tbody');
  const countEl = document.getElementById('filter-count');
  if (!tbody) return;

  const teamFiltered = getTeamFilteredMatches();
  const filtered = ACTIVE_FILTER === 'ALL'
    ? teamFiltered
    : teamFiltered.filter(m => m.result === ACTIVE_FILTER);

  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${ALL_MATCHES.length} matches`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">${emptyState('No matches found for this filter.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(m => {
    const opponent = getOpponentSide(m);
    return `
    <tr>
      <td data-label="Date" class="cell-muted">${formatDate(m.date)}</td>
      <td data-label="Opponent">vs ${escapeHTML(opponent.name)}</td>
      <td data-label="Score" class="cell-score">${m.scoreFor} &ndash; ${m.scoreAgainst}</td>
      <td data-label="Result">${badgeFor(m.result)}</td>
      <td data-label="Tournament"><span class="cell-tournament-tag">${escapeHTML(m.tournament)}</span></td>
      <td data-label="MVP" class="cell-muted">${m.mvp ? escapeHTML(m.mvp) : '&mdash;'}</td>
    </tr>
  `;
  }).join('');
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

function renderStatsPage() {
  const matches = getTeamFilteredMatches();
  renderStreakStats(matches);
  renderCharts(matches);
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
// ROSTER PAGE (player grid)
// =========================================================
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function avatarMarkup(player, sizeClass) {
  if (player.avatar) {
    return `<img class="${sizeClass}" src="${escapeHTML(player.avatar)}" alt="${escapeHTML(player.name)}">`;
  }
  return `<div class="${sizeClass} ${sizeClass}--fallback">${escapeHTML(initials(player.name))}</div>`;
}

function playerLink(player) {
  return `player.html?name=${encodeURIComponent(player.name)}`;
}

function renderRoster(players) {
  const grid = document.getElementById('roster-grid');
  const countEl = document.getElementById('roster-count');
  if (!grid) return;

  if (countEl) countEl.textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;

  if (players.length === 0) {
    grid.innerHTML = emptyState('No players yet. Add a row to the Players sheet to see them here.');
    return;
  }

  grid.innerHTML = players.map(p => `
    <a class="panel player-card" href="${playerLink(p)}">
      ${avatarMarkup(p, 'player-card__avatar')}
      <span class="player-card__name">${escapeHTML(p.name)}</span>
      <span class="player-card__role">${escapeHTML(p.role)}</span>
      <span class="cell-tournament-tag player-card__team">${escapeHTML(p.team)}</span>
      <div class="player-card__stats">
        <div class="player-card__stat">
          <span class="player-card__stat-value">${p.goals}</span>
          <span class="player-card__stat-label">Goals</span>
        </div>
        <div class="player-card__stat">
          <span class="player-card__stat-value">${p.assists}</span>
          <span class="player-card__stat-label">Assists</span>
        </div>
        <div class="player-card__stat">
          <span class="player-card__stat-value">${p.mvps}</span>
          <span class="player-card__stat-label">MVPs</span>
        </div>
      </div>
    </a>
  `).join('');
}

function renderTeams(teams) {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;

  if (teams.length === 0) {
    grid.innerHTML = emptyState('No teams yet. Add a row to the Teams sheet to see them here.');
    return;
  }

  grid.innerHTML = teams.map(team => `
    <a class="panel player-card" href="team.html?id=${encodeURIComponent(team.teamId)}">
      ${team.logo
        ? `<img class="player-card__avatar" src="${escapeHTML(team.logo)}" alt="${escapeHTML(team.name)} logo">`
        : `<div class="player-card__avatar player-card__avatar--fallback">${escapeHTML(initials(team.name))}</div>`}
      <span class="player-card__name">${escapeHTML(team.name)}</span>
      <span class="player-card__role">Captain</span>
      <span class="cell-tournament-tag player-card__team">${escapeHTML(team.captain)}</span>
    </a>
  `).join('');
}

function computeStandings(teams, matches) {
  const standings = (teams || []).map(team => ({
    teamId: (team.teamId || '').trim() || 'main',
    name: team.name,
    logo: team.logo,
    mp: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
  }));

  const byKey = new Map(standings.map(team => [normalizeTeamValue(team.teamId || team.name), team]));

  matches.forEach(match => {
    const homeKey = normalizeTeamValue(match.homeTeam);
    const awayKey = normalizeTeamValue(match.awayTeam);

    const homeStanding = byKey.get(homeKey);
    const awayStanding = byKey.get(awayKey);

    if (homeStanding) {
      homeStanding.mp += 1;
      homeStanding.gf += match.scoreFor;
      homeStanding.ga += match.scoreAgainst;
      homeStanding.gd = homeStanding.gf - homeStanding.ga;

      if (match.scoreFor > match.scoreAgainst) {
        homeStanding.w += 1;
        homeStanding.pts += 3;
      } else if (match.scoreFor < match.scoreAgainst) {
        homeStanding.l += 1;
      } else {
        homeStanding.d += 1;
        homeStanding.pts += 1;
      }
    }

    if (awayStanding) {
      awayStanding.mp += 1;
      awayStanding.gf += match.scoreAgainst;
      awayStanding.ga += match.scoreFor;
      awayStanding.gd = awayStanding.gf - awayStanding.ga;

      if (match.scoreAgainst > match.scoreFor) {
        awayStanding.w += 1;
        awayStanding.pts += 3;
      } else if (match.scoreAgainst < match.scoreFor) {
        awayStanding.l += 1;
      } else {
        awayStanding.d += 1;
        awayStanding.pts += 1;
      }
    }
  });

  return standings.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return a.name.localeCompare(b.name);
  });
}

function renderRankings(teams, matches) {
  const tbody = document.getElementById('rankings-tbody');
  if (!tbody) return;

  const standings = computeStandings(teams, matches);
  if (standings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">${emptyState('No standings yet. Add teams and matches to see the table.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = standings.map((team, index) => {
    const rankDisplay = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}`;
    const crest = team.logo
      ? `<img class="rankings-crest" src="${escapeHTML(team.logo)}" alt="${escapeHTML(team.name)} logo">`
      : `<div class="rankings-crest rankings-crest--fallback">${escapeHTML(initials(team.name))}</div>`;

    return `
      <tr>
        <td data-label="#" class="rankings-rank">${escapeHTML(rankDisplay)}</td>
        <td data-label="Team">
          <div class="rankings-team-cell">
            ${crest}
            <span class="rankings-team-name">${escapeHTML(team.name)}</span>
          </div>
        </td>
        <td data-label="MP" class="rankings-stat">${team.mp}</td>
        <td data-label="W" class="rankings-stat">${team.w}</td>
        <td data-label="D" class="rankings-stat">${team.d}</td>
        <td data-label="L" class="rankings-stat">${team.l}</td>
        <td data-label="GD" class="rankings-stat">${team.gd > 0 ? '+' : ''}${team.gd}</td>
        <td data-label="PTS" class="rankings-stat rankings-stat--points">${team.pts}</td>
      </tr>
    `;
  }).join('');
}

// =========================================================
// PLAYER PROFILE PAGE
// =========================================================
function getQueryParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function renderPlayerProfile(players, matches) {
  const wrap = document.getElementById('player-profile');
  if (!wrap) return;

  const requested = (getQueryParam('name') || '').trim().toLowerCase();
  const player = players.find(p => p.name.toLowerCase() === requested);

  if (!requested || !player) {
    wrap.innerHTML = emptyState('Player not found. Go back to the Roster and pick a player card.');
    document.title = 'Player Not Found — FC Master';
    const mvpSection = document.getElementById('player-mvp-matches');
    if (mvpSection) mvpSection.innerHTML = '';
    return;
  }

  document.title = `${player.name} — FC Master`;

  wrap.innerHTML = `
    <div class="player-profile__header">
      ${avatarMarkup(player, 'player-profile__avatar')}
      <div class="player-profile__id">
        <h1 class="player-profile__name">${escapeHTML(player.name)}</h1>
        <div class="player-profile__tags">
          <span class="badge badge--draw">${escapeHTML(player.role)}</span>
          <span class="cell-tournament-tag">${escapeHTML(player.team)}</span>
        </div>
        <span class="player-profile__joined">${player.joined ? `Joined ${formatDate(player.joined)}` : ''}</span>
      </div>
    </div>
  `;

  const statGrid = document.getElementById('player-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = `
      <div class="panel stat-card">
        <span class="stat-card__label">Goals</span>
        <span class="stat-card__value stat-card__value--win">${player.goals}</span>
        <span class="stat-card__sub">Career total</span>
      </div>
      <div class="panel stat-card">
        <span class="stat-card__label">Assists</span>
        <span class="stat-card__value">${player.assists}</span>
        <span class="stat-card__sub">Career total</span>
      </div>
      <div class="panel stat-card">
        <span class="stat-card__label">MVP Awards</span>
        <span class="stat-card__value">${player.mvps}</span>
        <span class="stat-card__sub">Player of the match</span>
      </div>
    `;
  }

  const mvpSection = document.getElementById('player-mvp-matches');
  if (mvpSection) {
    const mvpMatches = matches.filter(m => m.mvp && m.mvp.toLowerCase() === player.name.toLowerCase());
    if (mvpMatches.length === 0) {
      mvpSection.innerHTML = emptyState('No recorded MVP matches yet.');
    } else {
      mvpSection.innerHTML = mvpMatches.slice(0, 6).map(m => {
        const opponent = getOpponentSide(m);
        return `
          <div class="panel match-card-mini">
            <div class="match-card-mini__top">
              <span class="match-card-mini__opponent">vs ${escapeHTML(opponent.name)}</span>
              ${badgeFor(m.result)}
            </div>
            <span class="match-card-mini__score">${m.scoreFor} &ndash; ${m.scoreAgainst}</span>
            <span class="match-card-mini__date">${formatDate(m.date)}</span>
          </div>
        `;
      }).join('');
    }
  }
}

// =========================================================
// TEAM PROFILE PAGE
// =========================================================
function renderTeamProfile(teams, players, matches) {
  const wrap = document.getElementById('team-profile');
  const statGrid = document.getElementById('team-stat-grid');
  const tbody = document.getElementById('team-matches-tbody');
  const rosterGrid = document.getElementById('team-roster-grid');
  if (!wrap) return;

  const requested = (getQueryParam('id') || '').trim().toLowerCase();
  const team = teams.find(t => (t.teamId || '').trim().toLowerCase() === requested);

  if (!requested || !team) {
    wrap.innerHTML = emptyState('Team not found. Go back to the Teams page and pick a team card.');
    document.title = 'Team Not Found — FC Master';
    if (statGrid) statGrid.innerHTML = '';
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">${emptyState('No team selected.')}</td></tr>`;
    if (rosterGrid) rosterGrid.innerHTML = '';
    return;
  }

  document.title = `${team.name} — FC Master`;

  wrap.innerHTML = `
    <div class="player-profile__header">
      ${team.logo
        ? `<img class="player-profile__avatar" src="${escapeHTML(team.logo)}" alt="${escapeHTML(team.name)} logo">`
        : `<div class="player-profile__avatar player-profile__avatar--fallback">${escapeHTML(initials(team.name))}</div>`}
      <div class="player-profile__id">
        <h1 class="player-profile__name">${escapeHTML(team.name)}</h1>
        <div class="player-profile__tags">
          <span class="badge badge--draw">Team</span>
          <span class="cell-tournament-tag">${escapeHTML(team.captain)}</span>
        </div>
        ${team.description ? `<p class="team-profile__description">${escapeHTML(team.description)}</p>` : ''}
      </div>
    </div>
  `;

  const teamMatches = matches.filter(m => {
    const home = normalizeTeamValue(m.homeTeam);
    const away = normalizeTeamValue(m.awayTeam);
    return home === requested || away === requested;
  });
  const stats = computeStats(teamMatches);

  if (statGrid) {
    statGrid.innerHTML = `
      <div class="panel stat-card">
        <span class="stat-card__label">Matches</span>
        <span class="stat-card__value">${stats.total}</span>
        <span class="stat-card__sub">Team history</span>
      </div>
      <div class="panel stat-card">
        <span class="stat-card__label">Wins</span>
        <span class="stat-card__value stat-card__value--win">${stats.wins}</span>
        <span class="stat-card__sub">Matches won</span>
      </div>
      <div class="panel stat-card">
        <span class="stat-card__label">Losses</span>
        <span class="stat-card__value stat-card__value--loss">${stats.losses}</span>
        <span class="stat-card__sub">Matches lost</span>
      </div>
      <div class="panel stat-card">
        <span class="stat-card__label">Win Rate</span>
        <span class="stat-card__value">${stats.winRate}%</span>
        <span class="stat-card__sub">${stats.draws} draws</span>
      </div>
    `;
  }

  if (tbody) {
    if (teamMatches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyState('No matches for this team yet.')}</td></tr>`;
    } else {
      tbody.innerHTML = teamMatches.map(m => {
        const opponent = getOpponentSide(m);
        return `
          <tr>
            <td data-label="Date" class="cell-muted">${formatDate(m.date)}</td>
            <td data-label="Opponent">vs ${escapeHTML(opponent.name)}</td>
            <td data-label="Score" class="cell-score">${m.scoreFor} &ndash; ${m.scoreAgainst}</td>
            <td data-label="Result">${badgeFor(m.result)}</td>
            <td data-label="Tournament"><span class="cell-tournament-tag">${escapeHTML(m.tournament)}</span></td>
            <td data-label="MVP" class="cell-muted">${m.mvp ? escapeHTML(m.mvp) : '&mdash;'}</td>
          </tr>
        `;
      }).join('');
    }
  }

  if (rosterGrid) {
    const filteredPlayers = players.filter(p => {
      const playerTeam = (p.team || '').trim().toLowerCase();
      const teamName = (team.name || '').trim().toLowerCase();
      const teamId = (team.teamId || '').trim().toLowerCase();
      return playerTeam === teamName || playerTeam === teamId || playerTeam === teamId.replace(/\s+/g, '');
    });

    if (filteredPlayers.length === 0) {
      rosterGrid.innerHTML = emptyState('No roster members for this team yet.');
    } else {
      rosterGrid.innerHTML = filteredPlayers.map(p => `
        <a class="panel player-card" href="${playerLink(p)}">
          ${avatarMarkup(p, 'player-card__avatar')}
          <span class="player-card__name">${escapeHTML(p.name)}</span>
          <span class="player-card__role">${escapeHTML(p.role)}</span>
          <span class="cell-tournament-tag player-card__team">${escapeHTML(p.team)}</span>
        </a>
      `).join('');
    }
  }
}

// =========================================================
// INIT — detect which page we're on by its DOM, then render
// =========================================================
async function init() {
  const isHome = document.getElementById('recent-matches');
  const isMatchesPage = document.getElementById('matches-tbody');
  const isStatsPage = document.getElementById('chart-winrate');
  const isRosterPage = document.getElementById('roster-grid');
  const isPlayerPage = document.getElementById('player-profile');
  const isTeamsPage = document.getElementById('teams-grid');
  const isTeamPage = document.getElementById('team-profile');
  const isRankingsPage = document.getElementById('rankings-root');
  const needsPlayers = isRosterPage || isPlayerPage || isTeamPage;
  const needsTeams = isTeamsPage || isTeamPage || isRankingsPage || isMatchesPage || isStatsPage;

  try {
    const [matches, players, teams] = await Promise.all([
      fetchMatches(),
      needsPlayers ? fetchPlayers() : Promise.resolve([]),
      needsTeams ? fetchTeams() : Promise.resolve([]),
    ]);
    ALL_MATCHES = matches;
    ALL_TEAMS = teams;

    if (isHome) renderHome(matches);
    if (isMatchesPage) {
      renderTeamFilterBar();
      setupTeamFilterBar(() => renderMatchesTable());
      setupFilterBar();
      renderMatchesTable();
    }
    if (isStatsPage) {
      renderTeamFilterBar();
      setupTeamFilterBar(() => renderStatsPage());
      renderStatsPage();
    }
    if (isRosterPage) renderRoster(players);
    if (isPlayerPage) renderPlayerProfile(players, matches);
    if (isTeamsPage) renderTeams(teams);
    if (isTeamPage) renderTeamProfile(teams, players, matches);
    if (isRankingsPage) renderRankings(teams, matches);
  } catch (err) {
    console.error('FC Master: failed to load match data', err);
    const msg = 'Check that the Google Sheet is shared as "Anyone with the link" and the tabs are named "Matches", "Players", and "Teams".';

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
      const teamBar = document.getElementById('team-filter-bar');
      if (teamBar) teamBar.innerHTML = '<span class="filter-count">Couldn\'t load teams</span>';
    }
    if (isStatsPage) {
      renderStatsPage();
      ['chart-winrate', 'chart-breakdown', 'chart-goals'].forEach(id => showChartMessage(id, msg));
      const teamBar = document.getElementById('team-filter-bar');
      if (teamBar) teamBar.innerHTML = '<span class="filter-count">Couldn\'t load teams</span>';
    }
    if (isRosterPage) {
      document.getElementById('roster-grid').innerHTML = errorState(msg);
    }
    if (isPlayerPage) {
      document.getElementById('player-profile').innerHTML = errorState(msg);
    }
    if (isTeamsPage) {
      document.getElementById('teams-grid').innerHTML = errorState(msg);
    }
    if (isTeamPage) {
      document.getElementById('team-profile').innerHTML = errorState(msg);
    }
    if (isRankingsPage) {
      document.getElementById('rankings-tbody').innerHTML = `<tr><td colspan="8">${errorState(msg)}</td></tr>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', init);

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

function resultFromScores(scoreA, scoreB) {
  if (scoreA > scoreB) return 'WIN';
  if (scoreA < scoreB) return 'LOSS';
  return 'DRAW';
}

// Result of a match from the perspective of a specific team (matched by TeamID or name).
// Returns null if the team isn't involved in this match.
function getResultForTeam(match, teamId) {
  const key = normalizeTeamValue(teamId);
  const home = normalizeTeamValue(match.homeTeam);
  const away = normalizeTeamValue(match.awayTeam);
  if (key === home) return resultFromScores(match.scoreFor, match.scoreAgainst);
  if (key === away) return resultFromScores(match.scoreAgainst, match.scoreFor);
  return null;
}

// Opponent info from the perspective of a specific team.
function getOpponentForTeam(match, teamId) {
  const key = normalizeTeamValue(teamId);
  const home = normalizeTeamValue(match.homeTeam);
  if (key === home) {
    return { name: match.awayTeam || 'Unknown', logo: match.awayLogo || '' };
  }
  return { name: match.homeTeam || 'Unknown', logo: match.homeLogo || '' };
}

// Stats (wins/losses/draws/winRate) computed from a specific team's perspective.
function computeStatsForTeam(matches, teamId) {
  let wins = 0, losses = 0, draws = 0;
  matches.forEach(m => {
    const r = getResultForTeam(m, teamId);
    if (r === 'WIN') wins++;
    else if (r === 'LOSS') losses++;
    else if (r === 'DRAW') draws++;
  });
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  return { total, wins, losses, draws, winRate };
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

    let result = 'DRAW';
    if (scoreFor > scoreAgainst) result = 'WIN';
    else if (scoreFor < scoreAgainst) result = 'LOSS';

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

function cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
  } catch (_) {}
}

function cacheGet(key, maxAgeMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, value } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null;
    return value;
  } catch (_) { return null; }
}

async function fetchMatches() {
  const CACHE_KEY = 'fcm_csv_matches';
  const cached = cacheGet(CACHE_KEY, 5 * 60 * 1000);
  if (cached) return rowsToMatches(parseCSV(cached));
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  cacheSet(CACHE_KEY, text);
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
  const CACHE_KEY = 'fcm_csv_players';
  const cached = cacheGet(CACHE_KEY, 5 * 60 * 1000);
  if (cached) return rowsToPlayers(parseCSV(cached));
  const res = await fetch(PLAYERS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  cacheSet(CACHE_KEY, text);
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
    color: headers.indexOf('color'),
  };

  const teams = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const name = (cells[idx.name] || '').trim();
    if (!name) continue;

    const colorRaw = idx.color >= 0 ? (cells[idx.color] || '').trim() : '';

    teams.push({
      teamId: (cells[idx.teamId] || '').trim() || 'main',
      name,
      captain: (cells[idx.captain] || '').trim() || 'TBD',
      description: (cells[idx.description] || '').trim(),
      logo: (cells[idx.logo] || '').trim(),
      colorRgb: hexToRgbTriplet(colorRaw) || DEFAULT_TEAM_COLOR_RGB,
    });
  }

  teams.sort((a, b) => a.name.localeCompare(b.name));
  return teams;
}

const DEFAULT_TEAM_COLOR_RGB = '91 157 255';

function hexToRgbTriplet(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '');
  if (!raw) return null;
  let r, g, b;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else return null;
  if ([r, g, b].some(n => isNaN(n))) return null;
  return `${r} ${g} ${b}`;
}

function findTeamForPlayer(teams, playerTeamValue) {
  if (!playerTeamValue) return null;
  return teams.find(t =>
    normalizeTeamValue(t.name) === normalizeTeamValue(playerTeamValue)
    || normalizeTeamValue(t.teamId) === normalizeTeamValue(playerTeamValue)
  ) || null;
}

function teamColorRgb(team) {
  return team && team.colorRgb ? team.colorRgb : DEFAULT_TEAM_COLOR_RGB;
}

function teamColorStyleAttr(team) {
  return `style="--team-c: ${teamColorRgb(team)}"`;
}

function playerCardStyleAttr(teams, player) {
  return teamColorStyleAttr(findTeamForPlayer(teams, player.team));
}

async function fetchTeams() {
  const CACHE_KEY = 'fcm_csv_teams';
  const cached = cacheGet(CACHE_KEY, 5 * 60 * 1000);
  if (cached) return rowsToTeams(parseCSV(cached));
  const res = await fetch(TEAMS_CSV_URL);
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  cacheSet(CACHE_KEY, text);
  return rowsToTeams(parseCSV(text));
}

// ---- HELPERS --------------------------------------------------
function getPerspectiveForTeam(match, activeTeamId) {
  const key = normalizeTeamValue(activeTeamId);
  const home = normalizeTeamValue(match.homeTeam);
  const away = normalizeTeamValue(match.awayTeam);

  if (key && key === home) {
    return {
      result: resultFromScores(match.scoreFor, match.scoreAgainst),
      scoreFor: match.scoreFor,
      scoreAgainst: match.scoreAgainst,
    };
  }

  if (key && key === away) {
    return {
      result: resultFromScores(match.scoreAgainst, match.scoreFor),
      scoreFor: match.scoreAgainst,
      scoreAgainst: match.scoreFor,
    };
  }

  return {
    result: match.result || 'DRAW',
    scoreFor: match.scoreFor,
    scoreAgainst: match.scoreAgainst,
  };
}

function computeStats(matches, activeTeamId = null) {
  const perspective = matches.map(m => getPerspectiveForTeam(m, activeTeamId));
  const wins = perspective.filter(m => m.result === 'WIN').length;
  const losses = perspective.filter(m => m.result === 'LOSS').length;
  const draws = perspective.filter(m => m.result === 'DRAW').length;
  const total = perspective.length;
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
  return `<span class="badge ${cls}">${result ?? '—'}</span>`;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// =========================================================
// HOME PAGE
// =========================================================
function renderHome(allMatches, teams) {
  const standings = computeStandings(teams, allMatches);
  const leader = standings[0];

  const leaderCard = document.getElementById('stat-leader-card');
  if (leaderCard) {
    if (leader && leader.mp > 0) {
      const winRate = Math.round((leader.w / leader.mp) * 100);
      const leaderSource = teams.find(t =>
        normalizeTeamValue(t.teamId) === normalizeTeamValue(leader.teamId)
        || normalizeTeamValue(t.name) === normalizeTeamValue(leader.name)
      );
      const colorRgb = teamColorRgb(leaderSource);
      leaderCard.setAttribute('style', `--team-c: ${colorRgb}`);
      leaderCard.className = 'panel stat-card stat-card--featured';

      const crest = leader.logo
        ? `<img class="team-crest stat-card__leader-crest" src="${escapeHTML(leader.logo)}" alt="${escapeHTML(leader.name)} logo">`
        : `<div class="team-crest stat-card__leader-crest stat-card__leader-crest--fallback">${escapeHTML(initials(leader.name))}</div>`;

      leaderCard.innerHTML = `
        <div class="stat-card__accent stat-card__accent--blue" aria-hidden="true"></div>
        <div class="stat-card__head">
          <span class="stat-card__label">Top Team</span>
          <span class="stat-card__pill">Leader</span>
        </div>
        <a class="stat-card__leader-link" href="team.html?id=${encodeURIComponent(leader.teamId)}">
          ${crest}
          <span class="stat-card__leader-name">${escapeHTML(leader.name)}</span>
        </a>
        <span class="stat-card__value stat-card__value--hero">${winRate}%</span>
        <span class="stat-card__sub">${leader.w}W ${leader.d}D ${leader.l}L &middot; ${leader.pts} pts</span>
      `;
    } else {
      leaderCard.removeAttribute('style');
      leaderCard.className = 'panel stat-card stat-card--featured';
      leaderCard.innerHTML = `
        <div class="stat-card__accent stat-card__accent--blue" aria-hidden="true"></div>
        <div class="stat-card__head">
          <span class="stat-card__label">Top Team</span>
          <span class="stat-card__pill">Leader</span>
        </div>
        ${emptyState('No standings yet')}
      `;
    }
  }

  const totalEl = document.getElementById('stat-total');
  const goalsEl = document.getElementById('stat-goals');
  const teamsEl = document.getElementById('stat-teams');
  if (totalEl) animateCounter(totalEl, allMatches.length);
  if (goalsEl) animateCounter(goalsEl, allMatches.reduce((s, m) => s + m.scoreFor + m.scoreAgainst, 0));
  if (teamsEl) animateCounter(teamsEl, teams.length);

  const latestEl = document.getElementById('latest-match');
  if (latestEl) {
    if (allMatches.length === 0) {
      latestEl.innerHTML = emptyState('No matches yet. Add a row to the Matches sheet to see it here.');
    } else {
      const m = allMatches[0];
      const homeCrest = m.homeLogo
        ? `<img class="team-crest" src="${escapeHTML(m.homeLogo)}" alt="${escapeHTML(m.homeTeam)} logo">`
        : `<div class="team-crest"></div>`;
      const awayCrest = m.awayLogo
        ? `<img class="team-crest" src="${escapeHTML(m.awayLogo)}" alt="${escapeHTML(m.awayTeam)} logo">`
        : `<div class="team-crest"></div>`;

      const homeTeamObj = teams.find(t =>
        normalizeTeamValue(t.name) === normalizeTeamValue(m.homeTeam) ||
        normalizeTeamValue(t.teamId) === normalizeTeamValue(m.homeTeam)
      );
      const awayTeamObj = teams.find(t =>
        normalizeTeamValue(t.name) === normalizeTeamValue(m.awayTeam) ||
        normalizeTeamValue(t.teamId) === normalizeTeamValue(m.awayTeam)
      );
      const homeColor = teamColorRgb(homeTeamObj);
      const awayColor = teamColorRgb(awayTeamObj);

      latestEl.innerHTML = `
        <div class="latest-match" style="--home-c:${homeColor};--away-c:${awayColor}">
          <div class="match-ink" aria-hidden="true"></div>
          ${m.homeLogo ? `<div class="match-logo match-logo--home" style="background-image:url('${escapeHTML(m.homeLogo)}')"></div>` : ''}
          ${m.awayLogo ? `<div class="match-logo match-logo--away" style="background-image:url('${escapeHTML(m.awayLogo)}')"></div>` : ''}
          <div class="latest-match__side">
            ${homeCrest}
          </div>
          <div class="latest-match__score">
            <div class="score-side score-side--home">
              ${String(m.scoreFor).split('').map((d, i, arr) =>
                `<span class="score-digit" style="font-size:${1.2 - (i / arr.length) * 0.35}em">${d}</span>`
              ).join('')}
            </div>
            <span class="latest-match__divider">&ndash;</span>
            <div class="score-side score-side--away">
              ${String(m.scoreAgainst).split('').reverse().map((d, i, arr) =>
                `<span class="score-digit" style="font-size:${1.2 - (i / arr.length) * 0.35}em">${d}</span>`
              ).reverse().join('')}
            </div>
          </div>
          <div class="latest-match__side">
            ${awayCrest}
          </div>
        </div>
        <div class="latest-match__names-row">
          <span class="latest-match__name">${escapeHTML(m.homeTeam)}</span>
          <span class="latest-match__name">${escapeHTML(m.awayTeam)}</span>
        </div>
        <div class="latest-match__meta">
          <span>${formatDate(m.date)} &middot; ${escapeHTML(m.tournament)}</span>
        </div>
      `;
    }
  }

  const recentEl = document.getElementById('recent-matches');
  if (recentEl) {
    const recent = allMatches.slice(0, 4);
    if (recent.length === 0) {
      recentEl.innerHTML = emptyState('No recent matches to show yet.');
    } else {
      const recentTeamColorMap = Object.fromEntries(teams.map(t => [
        normalizeTeamValue(t.name), teamColorRgb(t)
      ]));
      const recentTeamLogoMap = Object.fromEntries(teams.map(t => [
        normalizeTeamValue(t.name), t.logo || ''
      ]));
      recentEl.innerHTML = recent.map((m, i) => {
        return `
          <div class="panel match-card-mini animate-in"
               style="animation-delay:${i * 0.06}s;--home-c:${recentTeamColorMap[normalizeTeamValue(m.homeTeam)] || '61 123 255'};--away-c:${recentTeamColorMap[normalizeTeamValue(m.awayTeam)] || '61 123 255'}">
            <div class="match-ink match-ink--subtle" aria-hidden="true"></div>
            <div class="match-card-mini__top">
              <span class="match-card-mini__opponent">
                <span class="${m.result === 'WIN' ? 'match-card-mini__team--winner' : ''}">${escapeHTML(m.homeTeam)}</span>
                <span class="match-card-mini__vs"> vs </span>
                <span class="${m.result === 'LOSS' ? 'match-card-mini__team--winner' : ''}">${escapeHTML(m.awayTeam)}</span>
              </span>
            </div>
            <span class="match-card-mini__score">${m.scoreFor} &ndash; ${m.scoreAgainst}</span>
            ${badgeFor(m.result)}
            <span class="match-card-mini__date">${formatDate(m.date)}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function animateCounter(el, target) {
  el.classList.remove('skel');
  if (typeof target !== 'number' || isNaN(target)) {
    el.textContent = target;
    return;
  }
  const duration = 900;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
    el.classList.remove('skel');
  }
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
let ACTIVE_TEAM_FILTER = null;
let VIEW_MODE = 'table';

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
  if (!ACTIVE_TEAM_FILTER) return ALL_MATCHES;
  const team = ALL_TEAMS.find(t => (t.teamId || '').trim() === ACTIVE_TEAM_FILTER);
  if (!team) return [];
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
    `<button type="button" class="filter-btn filter-btn--team is-active" data-team-filter="">All Teams</button>`,
    ...ALL_TEAMS.map(team => {
      const id = (team.teamId || '').trim();
      const color = teamColorRgb(team);
      return `<button type="button" class="filter-btn filter-btn--team" data-team-filter="${escapeHTML(id)}" style="--team-c:${color}">${escapeHTML(team.name)}</button>`;
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

function getDisplayResultAndOpponent(m) {
  if (!ACTIVE_TEAM_FILTER) {
    return { opponent: { name: m.awayTeam || m.homeTeam || 'Unknown', logo: '' }, result: m.result };
  }
  const activeTeam = ALL_TEAMS.find(t => (t.teamId || '').trim() === ACTIVE_TEAM_FILTER);
  const matchKey = activeTeam ? (activeTeam.name || activeTeam.teamId) : ACTIVE_TEAM_FILTER;
  return {
    opponent: getOpponentForTeam(m, matchKey),
    result: getResultForTeam(m, matchKey),
  };
}

function getTeamSecondaryInfo(teamName, teamId, standingsByKey, teamLookup) {
  const lookupKey = normalizeTeamValue(teamId || teamName);
  const teamEntry = teamLookup.get(lookupKey) || teamLookup.get(normalizeTeamValue(teamName));
  const standing = standingsByKey.get(lookupKey) || standingsByKey.get(normalizeTeamValue(teamName));

  if (standing && standing.mp > 0) {
    if (standing.rank) {
      return `#${standing.rank}`;
    }
    const record = standing.d > 0
      ? `${standing.w}W · ${standing.d}D · ${standing.l}L`
      : `${standing.w}W · ${standing.l}L`;
    return record;
  }

  if (teamEntry && teamEntry.description) {
    const clean = String(teamEntry.description).replace(/\s+/g, ' ').trim();
    return clean.length > 38 ? `${clean.slice(0, 35)}…` : clean;
  }

  return '';
}

function renderMatchesTable() {
  const tbody = document.getElementById('matches-tbody');
  const countEl = document.getElementById('filter-count');
  if (!tbody) return;

  const teamFiltered = getTeamFilteredMatches();
  const filtered = ACTIVE_FILTER === 'ALL'
    ? teamFiltered
    : teamFiltered.filter(m => getDisplayResultAndOpponent(m).result === ACTIVE_FILTER);

  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${ALL_MATCHES.length} matches`;
  }

  const rowColorMap = Object.fromEntries(ALL_TEAMS.map(t => [
    normalizeTeamValue(t.name), teamColorRgb(t)
  ]));
  const standings = computeStandings(ALL_TEAMS, ALL_MATCHES).map((s, index) => ({ ...s, rank: index + 1 }));
  const standingsByKey = new Map();
  standings.forEach(s => {
    standingsByKey.set(normalizeTeamValue(s.teamId), s);
    standingsByKey.set(normalizeTeamValue(s.name), s);
  });
  const teamLookup = new Map();
  ALL_TEAMS.forEach(team => {
    teamLookup.set(normalizeTeamValue(team.teamId), team);
    teamLookup.set(normalizeTeamValue(team.name), team);
  });

  if (VIEW_MODE === 'card') {
    const tableWrap = document.querySelector('.table-wrapper');
    let cardGrid = document.getElementById('matches-cards-grid');
    if (!cardGrid) {
      cardGrid = document.createElement('div');
      cardGrid.id = 'matches-cards-grid';
      cardGrid.className = 'match-cards-grid';
      tableWrap.parentElement.insertBefore(cardGrid, tableWrap);
    }
    tableWrap.style.display = 'none';
    cardGrid.style.display = 'grid';

    if (filtered.length === 0) {
      cardGrid.innerHTML = emptyState('No matches found for this filter.');
      return;
    }
    cardGrid.innerHTML = filtered.map((m, i) => {
      const { result } = getDisplayResultAndOpponent(m);
      const homeLogo = m.homeLogo
        ? `<img class="match-card-vs__logo" src="${escapeHTML(m.homeLogo)}" alt="${escapeHTML(m.homeTeam)}">`
        : `<div class="match-card-vs__logo match-card-vs__logo--fallback">${escapeHTML(initials(m.homeTeam))}</div>`;
      const awayLogo = m.awayLogo
        ? `<img class="match-card-vs__logo" src="${escapeHTML(m.awayLogo)}" alt="${escapeHTML(m.awayTeam)}">`
        : `<div class="match-card-vs__logo match-card-vs__logo--fallback">${escapeHTML(initials(m.awayTeam))}</div>`;
      const homeTeamClass = result === 'WIN' ? 'match-card-vs__team-name--winner' : result === 'LOSS' ? 'match-card-vs__team-name--loser' : 'match-card-vs__team-name--draw';
      const awayTeamClass = result === 'LOSS' ? 'match-card-vs__team-name--winner' : result === 'WIN' ? 'match-card-vs__team-name--loser' : 'match-card-vs__team-name--draw';

      return `
        <div class="panel match-card-vs animate-in"
             style="animation-delay:${Math.min(i * 0.04, 0.3)}s;--home-c:${rowColorMap[normalizeTeamValue(m.homeTeam)] || '61 123 255'};--away-c:${rowColorMap[normalizeTeamValue(m.awayTeam)] || '61 123 255'}">
          <div class="match-ink match-ink--subtle" aria-hidden="true"></div>
          <div class="match-card-vs__teams">
            <div class="match-card-vs__side">
              ${homeLogo}
              <span class="match-card-vs__team-name ${homeTeamClass}">${escapeHTML(m.homeTeam)}</span>
            </div>
            <div class="match-card-vs__center">
              <span class="match-card-vs__score">${m.scoreFor} – ${m.scoreAgainst}</span>
            </div>
            <div class="match-card-vs__side">
              ${awayLogo}
              <span class="match-card-vs__team-name ${awayTeamClass}">${escapeHTML(m.awayTeam)}</span>
            </div>
          </div>
          <div class="match-card-vs__footer">
            <span>${formatDate(m.date)}</span>
            <span class="cell-tournament-tag">${escapeHTML(m.tournament)}</span>
          </div>
        </div>
      `;
    }).join('');
    return;
  }

  const tableWrap = document.querySelector('.table-wrapper');
  if (tableWrap) tableWrap.style.display = '';
  const cardGrid = document.getElementById('matches-cards-grid');
  if (cardGrid) cardGrid.style.display = 'none';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <div class="matches-table-row">
        <div class="matches-table-cell matches-table-cell--empty" style="grid-column: 1 / -1;">
          ${emptyState('No matches found for this filter.')}
        </div>
      </div>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((m, i) => {
    const { result } = getDisplayResultAndOpponent(m);
    const homeLogo = m.homeLogo
      ? `<img class="match-panel__logo" src="${escapeHTML(m.homeLogo)}" alt="${escapeHTML(m.homeTeam)}">`
      : `<div class="match-panel__logo match-panel__logo--fallback">${escapeHTML(initials(m.homeTeam))}</div>`;
    const awayLogo = m.awayLogo
      ? `<img class="match-panel__logo" src="${escapeHTML(m.awayLogo)}" alt="${escapeHTML(m.awayTeam)}">`
      : `<div class="match-panel__logo match-panel__logo--fallback">${escapeHTML(initials(m.awayTeam))}</div>`;

    const isHomeWin = m.result === 'WIN';
    const isAwayWin = m.result === 'LOSS';
    const isDraw = m.result === 'DRAW';

    const panelClass = isDraw
      ? 'match-panel match-panel--draw'
      : isHomeWin
        ? 'match-panel match-panel--home-win'
        : 'match-panel match-panel--away-win';

    const resultWatermark = isDraw
      ? '<span class="match-panel__watermark match-panel__watermark--draw">DRAW</span>'
      : isHomeWin
        ? '<span class="match-panel__watermark match-panel__watermark--home match-panel__watermark--win">WIN</span><span class="match-panel__watermark match-panel__watermark--away match-panel__watermark--loss">LOSS</span>'
        : '<span class="match-panel__watermark match-panel__watermark--home match-panel__watermark--loss">LOSS</span><span class="match-panel__watermark match-panel__watermark--away match-panel__watermark--win">WIN</span>';

    const panelStyle = `animation-delay:${Math.min(i * 0.03, 0.3)}s;--home-c:${rowColorMap[normalizeTeamValue(m.homeTeam)] || '61 123 255'};--away-c:${rowColorMap[normalizeTeamValue(m.awayTeam)] || '61 123 255'}`;
    const homeMeta = getTeamSecondaryInfo(m.homeTeam, m.homeTeam, standingsByKey, teamLookup);
    const awayMeta = getTeamSecondaryInfo(m.awayTeam, m.awayTeam, standingsByKey, teamLookup);

    return `
    <div class="panel ${panelClass} row-anim" style="${panelStyle}">
      ${resultWatermark}
      <div class="match-panel__branding" aria-hidden="true">FC MASTER</div>
      <div class="match-panel__top">
        <span class="match-panel__date cell-muted">${formatDate(m.date)}</span>
        <span class="cell-tournament-tag">${escapeHTML(m.tournament)}</span>
      </div>
      <div class="match-panel__middle">
        <div class="match-panel__side ${isHomeWin ? 'match-panel__side--winner' : isAwayWin ? 'match-panel__side--loser' : ''}">
          ${homeLogo}
          <div class="match-panel__team-block">
            <span class="match-panel__team-name">${escapeHTML(m.homeTeam)}</span>
            ${homeMeta ? `<span class="match-panel__team-meta">${escapeHTML(homeMeta)}</span>` : ''}
          </div>
        </div>
        <div class="match-panel__score-wrap">
          <div class="match-panel__score">${m.scoreFor} &ndash; ${m.scoreAgainst}</div>
        </div>
        <div class="match-panel__side ${isAwayWin ? 'match-panel__side--winner' : isHomeWin ? 'match-panel__side--loser' : ''}">
          ${awayLogo}
          <div class="match-panel__team-block">
            <span class="match-panel__team-name">${escapeHTML(m.awayTeam)}</span>
            ${awayMeta ? `<span class="match-panel__team-meta">${escapeHTML(awayMeta)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="match-panel__bottom">
        <div class="match-panel__mvp">${m.mvp ? `⭐ MVP — ${escapeHTML(m.mvp)}` : 'MVP — None'}</div>
      </div>
    </div>
  `;
  }).join('');
}

function setupViewToggle() {
  const toggle = document.getElementById('view-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    VIEW_MODE = btn.dataset.view;
    toggle.querySelectorAll('[data-view]').forEach(b =>
      b.classList.toggle('is-active', b === btn)
    );
    renderMatchesTable();
  });
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
  const activeTeamId = ACTIVE_TEAM_FILTER || null;
  renderStreakStats(matches, activeTeamId);
  renderCharts(matches, activeTeamId);
}

// =========================================================
// STATS PAGE (streak/average cards + Chart.js visuals)
// =========================================================

// matches is newest-first. Current streak = how many of the most
// recent matches share the same result. Best streak = the longest
// run of consecutive WINs anywhere in the history.
function computeStreaks(matches, activeTeamId = null) {
  let current = 0;
  let currentType = null;

  if (matches.length > 0) {
    currentType = getPerspectiveForTeam(matches[0], activeTeamId).result;
    for (const m of matches) {
      if (getPerspectiveForTeam(m, activeTeamId).result === currentType) current++;
      else break;
    }
  }

  let best = 0;
  let run = 0;
  const chrono = [...matches].reverse();
  for (const m of chrono) {
    if (getPerspectiveForTeam(m, activeTeamId).result === 'WIN') { run++; if (run > best) best = run; }
    else { run = 0; }
  }

  return { current, currentType, best };
}

function computeAverages(matches, activeTeamId = null) {
  if (matches.length === 0) return { avgFor: 0, avgAgainst: 0 };
  const totalFor = matches.reduce((sum, m) => sum + getPerspectiveForTeam(m, activeTeamId).scoreFor, 0);
  const totalAgainst = matches.reduce((sum, m) => sum + getPerspectiveForTeam(m, activeTeamId).scoreAgainst, 0);
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

function renderStreakStats(matches, activeTeamId = null) {
  const streaks = computeStreaks(matches, activeTeamId);
  const avgs = computeAverages(matches, activeTeamId);
  const hasMatches = matches.length > 0;

  const currentEl = document.getElementById('stat-current-streak');
  if (currentEl) {
    currentEl.textContent = hasMatches ? `${streaks.current}${streakSuffix(streaks.currentType)}` : '—';
    currentEl.className = `stat-card__value ${hasMatches ? streakColorClass(streaks.currentType) : ''}`;
  }

  setText('stat-best-streak', hasMatches ? `${streaks.best}W` : '—');
  setText('stat-avg-for', hasMatches ? avgs.avgFor.toFixed(1) : '—');
  setText('stat-avg-against', hasMatches ? avgs.avgAgainst.toFixed(1) : '—');

  const statCards = document.querySelectorAll('#streak-stats .stat-card');
  statCards.forEach((card, i) => {
    card.classList.remove('stat-card--animate');
    void card.offsetWidth;
    card.style.animationDelay = `${i * 0.07}s`;
    card.classList.add('stat-card--animate');
  });
}

// Cumulative win rate after each match, oldest to newest.
function computeWinRateSeries(matches, activeTeamId = null) {
  const chrono = [...matches].reverse();
  let wins = 0;
  const labels = [];
  const data = [];
  chrono.forEach((m, i) => {
    if (getPerspectiveForTeam(m, activeTeamId).result === 'WIN') wins++;
    labels.push(formatDateShort(m.date));
    data.push(Math.round((wins / (i + 1)) * 100));
  });
  return { labels, data };
}

// Goals for/against for the most recent `count` matches, oldest to newest.
function computeGoalsSeries(matches, count, activeTeamId = null) {
  const chrono = [...matches].reverse();
  const slice = chrono.slice(-count);
  return {
    labels: slice.map(m => formatDateShort(m.date)),
    goalsFor: slice.map(m => getPerspectiveForTeam(m, activeTeamId).scoreFor),
    goalsAgainst: slice.map(m => getPerspectiveForTeam(m, activeTeamId).scoreAgainst),
  };
}

function chartCanvasWrap(canvasId) {
  const canvas = document.getElementById(canvasId);
  return canvas ? canvas.closest('.chart-canvas-wrap') : null;
}

function showChartMessage(canvasId, msg) {
  const wrap = chartCanvasWrap(canvasId);
  if (!wrap) return;
  let overlay = wrap.querySelector('.chart-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'chart-overlay state-message';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;pointer-events:none;';
    wrap.style.position = 'relative';
    wrap.appendChild(overlay);
  }
  overlay.textContent = msg;
  overlay.style.display = 'flex';
  const canvas = wrap.querySelector('canvas');
  if (canvas) canvas.style.visibility = 'hidden';
}

let CHART_INSTANCES = [];

function renderCharts(matches, activeTeamId = null) {
  ['chart-winrate', 'chart-breakdown', 'chart-goals'].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      canvas.style.visibility = '';
      const overlay = canvas.closest('.chart-canvas-wrap')?.querySelector('.chart-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  });

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
    const wr = computeWinRateSeries(matches, activeTeamId);
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
    const stats = computeStats(matches, activeTeamId);
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
    const g = computeGoalsSeries(matches, 10, activeTeamId);
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

function mvpCountForPlayer(name) {
  if (!name || !Array.isArray(ALL_MATCHES)) return 0;
  return ALL_MATCHES.filter(m => m.mvp && m.mvp.toLowerCase() === name.toLowerCase()).length;
}

function cleanupEntranceAnimations(container) {
  container.querySelectorAll('.animate-in').forEach(el => {
    el.addEventListener('animationend', () => el.classList.remove('animate-in'), { once: true });
  });
}

function renderRoster(players, teams) {
  const grid = document.getElementById('roster-grid');
  const countEl = document.getElementById('roster-count');
  if (!grid) return;

  if (countEl) countEl.textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;

  if (players.length === 0) {
    grid.innerHTML = emptyState('No players yet. Add a row to the Players sheet to see them here.');
    return;
  }

  const top = players[0];
  if (top && top.goals > 0) {
    const topTeam = findTeamForPlayer(teams, top.team);
    const colorRgb = teamColorRgb(topTeam);
    const crest = top.avatar
      ? `<img class="feature-card__crest" src="${escapeHTML(top.avatar)}" alt="${escapeHTML(top.name)}">`
      : `<div class="feature-card__crest feature-card__crest--fallback">${escapeHTML(initials(top.name))}</div>`;
    const heroCard = document.createElement('div');
    heroCard.className = 'panel feature-card';
    heroCard.style.cssText = `--team-c: ${colorRgb}; --ink-c: ${colorRgb}; margin-bottom: 22px;`;
    heroCard.innerHTML = `
      <div class="ink-wash" aria-hidden="true"></div>
      ${topTeam && topTeam.logo ? `<div class="card-logo-bg card-logo-bg--left" style="background-image:url('${escapeHTML(topTeam.logo)}')"></div>` : ''}
      <div class="feature-card__accent"></div>
      <div class="feature-card__eyebrow">⚽ Top Scorer</div>
      <div class="feature-card__main">
        ${crest}
        <div class="feature-card__info">
          <span class="feature-card__name">${escapeHTML(top.name)}</span>
          <span class="feature-card__value">${top.goals} Goals</span>
          <span class="feature-card__sub">${top.assists} Assists · ${mvpCountForPlayer(top.name)} MVPs</span>
        </div>
      </div>
    `;
    grid.parentElement.insertBefore(heroCard, grid);
  }

  const teamColorMap = Object.fromEntries(teams.map(t => [t.name, teamColorRgb(t)]));

  grid.innerHTML = players.map((p, i) => {
    const teamObj = findTeamForPlayer(teams, p.team);
    return `
    <a class="panel player-card animate-in" href="${playerLink(p)}" style="animation-delay:${i * 0.05}s;--team-c: ${teamColorRgb(teamObj)}">
      <div class="ink-wash" style="--ink-c:${teamColorMap[p.team] || '61 123 255'}"></div>
      ${teamObj && teamObj.logo ? `<div class="card-logo-bg" style="background-image:url('${escapeHTML(teamObj.logo)}')"></div>` : ''}
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
          <span class="player-card__stat-value">${mvpCountForPlayer(p.name)}</span>
          <span class="player-card__stat-label">MVPs</span>
        </div>
      </div>
    </a>
    `;
  }).join('');

  cleanupEntranceAnimations(grid);
}

function renderTeams(teams) {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;

  if (teams.length === 0) {
    grid.innerHTML = emptyState('No teams yet. Add a row to the Teams sheet to see them here.');
    return;
  }

  grid.innerHTML = teams.map((team, i) => `
    <a class="panel player-card team-card animate-in" href="team.html?id=${encodeURIComponent(team.teamId)}" style="animation-delay:${i * 0.05}s;--team-c: ${teamColorRgb(team)}">
      ${team.logo
        ? `<img class="player-card__avatar" src="${escapeHTML(team.logo)}" alt="${escapeHTML(team.name)} logo">`
        : `<div class="player-card__avatar player-card__avatar--fallback">${escapeHTML(initials(team.name))}</div>`}
      <span class="player-card__name">${escapeHTML(team.name)}</span>
      <span class="player-card__role">Captain</span>
      <span class="cell-tournament-tag player-card__team">${escapeHTML(team.captain)}</span>
    </a>
  `).join('');

  cleanupEntranceAnimations(grid);
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

  const byKey = new Map();
  standings.forEach(team => {
    if (team.teamId) byKey.set(normalizeTeamValue(team.teamId), team);
    if (team.name) byKey.set(normalizeTeamValue(team.name), team);
  });

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

function renderRankingsHero(standings, teams) {
  const root = document.getElementById('rankings-root');
  if (!root || standings.length === 0) return;
  const leader = standings[0];
  if (!leader || leader.mp === 0) return;

  const leaderTeam = teams.find(t =>
    normalizeTeamValue(t.teamId) === normalizeTeamValue(leader.teamId) ||
    normalizeTeamValue(t.name) === normalizeTeamValue(leader.name)
  );
  const colorRgb = teamColorRgb(leaderTeam);
  const winRate = Math.round((leader.w / leader.mp) * 100);
  const crest = leader.logo
    ? `<img class="feature-card__crest" src="${escapeHTML(leader.logo)}" alt="${escapeHTML(leader.name)}">`
    : `<div class="feature-card__crest feature-card__crest--fallback">${escapeHTML(initials(leader.name))}</div>`;

  const card = document.createElement('div');
  card.className = 'panel feature-card';
  card.style.cssText = `--team-c: ${colorRgb};`;
  card.innerHTML = `
    <div class="feature-card__accent"></div>
    <div class="ink-wash" style="--ink-c:${colorRgb}"></div>
    ${leader.logo ? `<div class="card-logo-bg" style="background-image:url('${escapeHTML(leader.logo)}')"></div>` : ''}
    <div class="feature-card__eyebrow">🏆 Current Leader</div>
    <div class="feature-card__main">
      ${crest}
      <div class="feature-card__info">
        <span class="feature-card__name">${escapeHTML(leader.name)}</span>
        <span class="feature-card__value">${winRate}% Win Rate</span>
        <span class="feature-card__sub">${leader.w}W ${leader.d}D ${leader.l}L · ${leader.pts} pts</span>
      </div>
    </div>
  `;
  root.insertBefore(card, root.firstChild);
}

function renderRankings(teams, matches) {
  const tbody = document.getElementById('rankings-tbody');
  if (!tbody) return;

  const standings = computeStandings(teams, matches);
  renderRankingsHero(standings, teams);
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
      <tr class="row-anim" style="animation-delay:${index * 0.05}s;--ink-c:${teamColorRgb(teams.find(t => normalizeTeamValue(t.name) === normalizeTeamValue(team.name)) || null)}">
        <td data-label="#" class="rankings-rank">
          <div class="row-ink" aria-hidden="true"></div>
          ${escapeHTML(rankDisplay)}
        </td>
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

function renderPlayerProfile(players, matches, teams) {
  const wrap = document.getElementById('player-profile');
  if (!wrap) return;

  const requested = (getQueryParam('name') || '').trim().toLowerCase();
  const player = players.find(p => p.name.toLowerCase() === requested);

  if (!requested || !player) {
    wrap.innerHTML = emptyState('Player not found. Go back to the Roster and pick a player card.');
    document.title = 'Player Not Found';
    const mvpSection = document.getElementById('player-mvp-matches');
    if (mvpSection) mvpSection.innerHTML = '';
    return;
  }

  document.title = `${player.name}`;

  wrap.innerHTML = `
    <div class="player-profile__header" ${teamColorStyleAttr(findTeamForPlayer(teams, player.team))}>
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
        <span class="stat-card__value">${mvpCountForPlayer(player.name)}</span>
        <span class="stat-card__sub">Player of the match</span>
      </div>
    `;
  }

  const mvpSection = document.getElementById('player-mvp-matches');
  if (mvpSection) {
    const playerTeamObj = teams.find(t => normalizeTeamValue(t.name) === normalizeTeamValue(player.team)
      || normalizeTeamValue(t.teamId) === normalizeTeamValue(player.team));
    const playerMatchKey = playerTeamObj ? playerTeamObj.name : player.team;
    const mvpMatches = matches.filter(m => m.mvp && m.mvp.toLowerCase() === player.name.toLowerCase());
    if (mvpMatches.length === 0) {
      mvpSection.innerHTML = emptyState('No recorded MVP matches yet.');
    } else {
      mvpSection.innerHTML = mvpMatches.slice(0, 6).map(m => {
        const opponent = getOpponentForTeam(m, playerMatchKey);
        return `
          <div class="panel match-card-mini">
            <div class="match-card-mini__top">
              <span class="match-card-mini__opponent">vs ${escapeHTML(opponent.name)}</span>
              ${badgeFor(getResultForTeam(m, playerMatchKey))}
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
function applyTeamTheme(team) {
  const rgb = teamColorRgb(team);
  const root = document.documentElement;
  root.style.setProperty('--accent-blue',        `rgb(${rgb})`);
  root.style.setProperty('--accent-blue-bright', `rgb(${rgb})`);
  root.style.setProperty('--accent-blue-deep',   `rgb(${rgb} / 0.7)`);
  root.style.setProperty('--accent-glow',        `rgb(${rgb} / 0.55)`);
  root.style.setProperty('--accent-glow-soft',   `rgb(${rgb} / 0.18)`);
  root.style.setProperty('--accent-glow-strong', `rgb(${rgb} / 0.35)`);
  root.style.setProperty('--border-line',        `rgb(${rgb} / 0.1)`);
  root.style.setProperty('--border-line-strong', `rgb(${rgb} / 0.28)`);
}

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
    document.title = 'Team Not Found';
    if (statGrid) statGrid.innerHTML = '';
    if (tbody) tbody.innerHTML = `<tr><td colspan="6">${emptyState('No team selected.')}</td></tr>`;
    if (rosterGrid) rosterGrid.innerHTML = '';
    return;
  }

  document.title = `${team.name}`;
  applyTeamTheme(team);
  const banner = document.querySelector('.page-banner');
  if (banner && team.logo) {
    const wm = document.createElement('div');
    wm.className = 'page-banner__watermark';
    wm.style.backgroundImage = `url('${escapeHTML(team.logo)}')`;
    banner.appendChild(wm);
  }

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

  const teamMatchKey = team.name;
  const teamMatches = matches.filter(m => {
    const home = normalizeTeamValue(m.homeTeam);
    const away = normalizeTeamValue(m.awayTeam);
    return home === normalizeTeamValue(teamMatchKey) || away === normalizeTeamValue(teamMatchKey);
  });
  const stats = computeStatsForTeam(teamMatches, teamMatchKey);

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
        const opponent = getOpponentForTeam(m, teamMatchKey);
        return `
          <tr>
            <td data-label="Date" class="cell-muted">${formatDate(m.date)}</td>
            <td data-label="Opponent">vs ${escapeHTML(opponent.name)}</td>
            <td data-label="Score" class="cell-score">${m.scoreFor} &ndash; ${m.scoreAgainst}</td>
            <td data-label="Result">${badgeFor(getResultForTeam(m, teamMatchKey))}</td>
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
        <a class="panel player-card" href="${playerLink(p)}" ${teamColorStyleAttr(team)}>
          ${avatarMarkup(p, 'player-card__avatar')}
          <span class="player-card__name">${escapeHTML(p.name)}</span>
          <span class="player-card__role">${escapeHTML(p.role)}</span>
          <span class="cell-tournament-tag player-card__team">${escapeHTML(p.team)}</span>
        </a>
      `).join('');
    }
  }
}

function applyDesktopMode(on) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', on ? 'width=1280, initial-scale=1.0' : 'width=device-width, initial-scale=1.0');
  }
  if (document.body) {
    document.body.classList.toggle('force-desktop', on);
  }
}

function initDesktopModeToggle() {
  const existing = document.getElementById('desktop-mode-toggle');
  if (existing) existing.remove();

  const button = document.createElement('button');
  button.id = 'desktop-mode-toggle';
  button.type = 'button';
  button.className = 'desktop-mode-toggle';
  button.setAttribute('aria-label', 'Toggle desktop mode');

  const iconMonitor = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>';
  const iconPhone = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg>';

  const isActive = localStorage.getItem('fcm_desktop_mode') === '1';
  button.classList.toggle('is-active', isActive);
  button.innerHTML = isActive ? iconMonitor : iconPhone;

  button.addEventListener('click', () => {
    const next = localStorage.getItem('fcm_desktop_mode') !== '1';
    if (next) {
      localStorage.setItem('fcm_desktop_mode', '1');
    } else {
      localStorage.removeItem('fcm_desktop_mode');
    }

    applyDesktopMode(next);
    button.classList.toggle('is-active', next);
    button.innerHTML = next ? iconMonitor : iconPhone;
  });

  document.body.appendChild(button);
}

// =========================================================
// INIT — detect which page we're on by its DOM, then render
// =========================================================
function initBottomNav() {
  const pages = [
    {
      label: 'Home', href: 'index.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M9 21V12h6v9"/><path d="M3 12v9h18v-9"/></svg>`,
    },
    {
      label: 'Matches', href: 'matches.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
    },
    {
      label: 'Stats', href: 'stats.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
    },
    {
      label: 'Roster', href: 'roster.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>`,
    },
    {
      label: 'Rankings', href: 'rankings.html',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 21v-4"/><path d="M17 3l-5 5-5-5"/><rect x="4" y="8" width="16" height="9" rx="2"/></svg>`,
    },
  ];

  const nav = document.createElement('div');
  nav.id = 'bottom-nav';

  const pill = document.createElement('div');
  pill.id = 'bottom-nav-pill';
  nav.appendChild(pill);

  const currentFile = window.location.pathname.split('/').pop() || 'index.html';

  const items = pages.map(p => {
    const a = document.createElement('a');
    a.className = 'bn-item';
    a.href = p.href;
    a.innerHTML = p.icon + `<span>${p.label}</span>`;
    if (p.href === currentFile || (currentFile === '' && p.href === 'index.html')) {
      a.classList.add('is-active');
    }
    nav.appendChild(a);
    return a;
  });

  document.body.appendChild(nav);

  function movePill(el) {
    const navRect = nav.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    pill.style.left = (elRect.left - navRect.left) + 'px';
    pill.style.width = elRect.width + 'px';
  }

  const activeItem = nav.querySelector('.bn-item.is-active');
  if (activeItem) {
    pill.style.transition = 'none';
    requestAnimationFrame(() => {
      movePill(activeItem);
      requestAnimationFrame(() => { pill.style.transition = ''; });
    });
  }

  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('is-active'));
      item.classList.add('is-active');
      movePill(item);
    });
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function initTransitions() {
  const bar = document.createElement('div');
  bar.id = 'flash-bar';
  document.body.appendChild(bar);

  document.body.classList.add('page-entering');

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;

    const href = a.getAttribute('href');
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('http') ||
      href.startsWith('mailto') ||
      href.startsWith('javascript') ||
      a.target === '_blank'
    ) return;

    e.preventDefault();
    bar.classList.add('is-active');
    document.body.classList.add('page-exiting');

    setTimeout(() => { window.location.href = href; }, 260);
  });
}

async function init() {
  applyDesktopMode(localStorage.getItem('fcm_desktop_mode') === '1');
  registerServiceWorker();
  initTransitions();
  initDesktopModeToggle();
  initBottomNav();
  const isHome = document.getElementById('recent-matches');
  const isMatchesPage = document.getElementById('matches-tbody');
  const isStatsPage = document.getElementById('chart-winrate');
  const isRosterPage = document.getElementById('roster-grid');
  const isPlayerPage = document.getElementById('player-profile');
  const isTeamsPage = document.getElementById('teams-grid');
  const isTeamPage = document.getElementById('team-profile');
  const isRankingsPage = document.getElementById('rankings-root');
  const needsPlayers = isRosterPage || isPlayerPage || isTeamPage;
  const needsTeams = isHome || isTeamsPage || isTeamPage || isRankingsPage || isMatchesPage || isStatsPage || isPlayerPage || isRosterPage;

  try {
    const [matches, players, teams] = await Promise.all([
      fetchMatches(),
      needsPlayers ? fetchPlayers() : Promise.resolve([]),
      needsTeams ? fetchTeams() : Promise.resolve([]),
    ]);
    ALL_MATCHES = matches;
    ALL_TEAMS = teams;

    if (isHome) renderHome(matches, teams);
    if (isMatchesPage) {
      renderTeamFilterBar();
      setupTeamFilterBar(() => renderMatchesTable());
      setupFilterBar();
      setupViewToggle();
      renderMatchesTable();
    }
    if (isStatsPage) {
      renderTeamFilterBar();
      setupTeamFilterBar(() => renderStatsPage());
      renderStatsPage();
    }
    if (isRosterPage) renderRoster(players, teams);
    if (isPlayerPage) renderPlayerProfile(players, matches, teams);
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
      const leaderCard = document.getElementById('stat-leader-card');
      if (leaderCard) leaderCard.innerHTML = errorState(msg);
      ['stat-total', 'stat-goals', 'stat-teams'].forEach(id => setText(id, '—'));
    }
    if (isMatchesPage) {
      document.getElementById('matches-tbody').innerHTML =
        `<div class="matches-table-row"><div class="matches-table-cell matches-table-cell--empty" style="grid-column: 1 / -1;">${errorState(msg)}</div></div>`;
      const teamBar = document.getElementById('team-filter-bar');
      if (teamBar) teamBar.innerHTML = '<span class="filter-count">Couldn\'t load teams</span>';
    }
    if (isStatsPage) {
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

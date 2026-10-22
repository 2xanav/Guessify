import './style.css';
import * as spotify from './spotify.js';
import * as deezer from './deezer.js';
import { findPreview } from './deezer.js';
import { ClipPlayer } from './player.js';
import {
  CLIP_LENGTHS,
  clipLength,
  createGame,
  nextRound,
  pointsForStage,
  skip,
  submitGuess,
  winners,
} from './game.js';
import { normalizeTitle, titlesMatch } from './match.js';
import { genreBuckets } from './genres.js';
import { playOrder, remember, songKey } from './deck.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SOURCES = [
  { key: 'top-short', label: 'My top tracks · 4 weeks', load: () => spotify.getTopTracks('short_term') },
  { key: 'top-medium', label: 'My top tracks · 6 months', load: () => spotify.getTopTracks('medium_term') },
  { key: 'top-long', label: 'My top tracks · all time', load: () => spotify.getTopTracks('long_term') },
  { key: 'liked', label: 'Liked songs', load: () => spotify.getSavedTracks() },
];
// The only Deezer sources offered: the overall chart (/chart/0/tracks) and hand-picked public playlists.
const DEEZER_SOURCES = [
  ['dz-chart:0', 'Top 200 · Worldwide'],
  ['dz-playlist:15882196161', 'Rap'],
];
const ROUND_OPTIONS = [5, 10, 15, 20];
// Picking one of these eras re-themes the app (palettes live in style.css).
const ERA_THEMES = {
  '1960s': 'Psychedelic Pop',
  '1970s': 'Groovy Disco',
  '1980s': 'Synthwave Neon',
  '1990s': 'Grunge & Cyber-Teal',
  '2000s': 'Y2K Futuristic',
  '2010s': 'Flat & Millennial',
  '2020s': 'Neo-Biophilic Digital',
};
const MIX_THEME = { key: 'mix', name: 'Mixtape' };

// One themed decade gets its own palette; two or more share the Mixtape theme.
function eraTheme() {
  const { eras } = app.settings;
  if (eras.length > 1) return MIX_THEME;
  return ERA_THEMES[eras[0]] ? { key: eras[0], name: ERA_THEMES[eras[0]] } : null;
}

const PREVIEW_SECONDS = 30;
const MAX_CLIP = CLIP_LENGTHS.at(-1);

// ---------- settings ----------

const SETTINGS_KEY = 'gts.settings';
const DEFAULT_SETTINGS = {
  mode: 'single',
  rounds: 10,
  teamNames: ['Team 1', 'Team 2'],
  source: 'top-medium',
  eras: [], // empty means any era
  genre: 'any',
  artist: 'any',
  volume: 0.6,
};

function loadSettings() {
  try {
    const { era, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
    // Older versions stored a single `era` string.
    if (era && !saved.eras) saved.eras = era === 'any' ? [] : [era];
    // Deezer charts and playlists that are no longer offered fall back to the worldwide chart.
    if (saved.source?.startsWith('dz-') && !DEEZER_SOURCES.some(([k]) => k === saved.source)) saved.source = 'dz-chart:0';
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings));
  } catch {
    /* not persisted, still works for this visit */
  }
}

// ---------- app state ----------

const app = {
  screen: 'boot', // 'boot' | 'login' | 'setup' | 'game'
  settings: loadSettings(),
  profile: null,
  guest: false, // playing from Deezer only, without a Spotify account
  playlists: [],
  poolCache: new Map(),
  pool: [],
  poolLoading: false,
  poolError: null,
  songDetails: {}, // track id -> { genres (Deezer names), year }
  genreLoad: null, // { done, total } while details are being fetched
  genreError: null,
  game: null,
  gamePool: [], // every loaded song, used for guess suggestions
  queue: [], // songs not yet played this game
  current: null, // { track, preview }
  roundToken: 0,
  roundStatus: 'idle', // 'loading' | 'ready' | 'playing'
  revealPlaying: false,
  message: null, // { text, tone: 'good' | 'bad' | 'info' }
  error: null,
};

const player = new ClipPlayer();
player.setVolume(app.settings.volume);

// ---------- song pool ----------

const decade = (year) => (year ? `${Math.floor(year / 10) * 10}s` : null);

// Source keys: SOURCES keys, 'playlist:<spotify id>', 'dz-chart:<genre id>', 'dz-playlist:<deezer id>'.
function sourceLabel(key) {
  const [kind, id] = key.split(':');
  if (kind === 'playlist') return app.playlists.find((p) => p.id === id)?.name ?? 'Playlist';
  if (kind.startsWith('dz-')) return `Deezer · ${DEEZER_SOURCES.find(([k]) => k === key)?.[1] ?? 'Top'}`;
  return SOURCES.find((s) => s.key === key)?.label ?? key;
}

const GUEST_SOURCE = 'dz-chart:0';
const isDeezerSource = (key) => key.startsWith('dz-');

function loadSource(key) {
  const [kind, id] = key.split(':');
  if (kind === 'playlist') return spotify.getPlaylistTracks(id);
  if (kind === 'dz-chart') return deezer.getChartTracks(id);
  if (kind === 'dz-playlist') return deezer.getPlaylistTracks(id);
  return (SOURCES.find((s) => s.key === key) ?? SOURCES[1]).load();
}

const trackGenres = (t) => genreBuckets(app.songDetails[t.id]?.genres ?? []);
// Deezer chart and playlist tracks only get a year once their album is looked up.
const trackYear = (t) => t.year ?? app.songDetails[t.id]?.year ?? null;

function filteredPool() {
  const { eras, genre, artist } = app.settings;
  return app.pool.filter(
    (t) =>
      (!eras.length || eras.includes(decade(trackYear(t)))) &&
      (genre === 'any' || trackGenres(t).includes(genre)) &&
      (artist === 'any' || t.artists.includes(artist)),
  );
}

function eraOptions() {
  return [...new Set(app.pool.map((t) => decade(trackYear(t))).filter(Boolean))].sort();
}

function genreOptions() {
  const counts = new Map();
  for (const t of app.pool) for (const g of trackGenres(t)) counts.set(g, (counts.get(g) ?? 0) + 1);
  const options = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name]) => name);
  // A remembered pick stays visible while genres are still loading.
  const { genre } = app.settings;
  return genre === 'any' || options.includes(genre) ? options : [...options, genre];
}

let genreToken = 0;

async function loadGenres() {
  const token = ++genreToken;
  app.genreLoad = { done: 0, total: 0 };
  app.genreError = null;
  let lastPaint = 0;
  const { details, failed } = await deezer.getDetails(app.pool, (done, total, partial) => {
    if (token !== genreToken) return;
    app.genreLoad = { done, total };
    app.songDetails = partial;
    // Repaint only the center so typing in the sidebar isn't interrupted.
    if (app.screen === 'setup' && Date.now() - lastPaint > 400) {
      lastPaint = Date.now();
      renderSetupCenter();
    }
  });
  if (token !== genreToken) return;
  app.songDetails = details;
  app.genreLoad = null;
  if (failed) app.genreError = `Couldn't reach Deezer for ${failed} songs; they'll retry next time.`;
  if (app.screen === 'setup') renderSetupCenter();
}

function artistOptions() {
  const counts = new Map();
  for (const t of app.pool) for (const a of t.artists) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
}

async function loadPool() {
  const key = app.settings.source;
  if (app.poolCache.has(key)) {
    app.pool = app.poolCache.get(key);
    app.poolError = null;
    render();
    loadGenres();
    return;
  }
  app.pool = [];
  app.poolLoading = true;
  app.poolError = null;
  render();
  try {
    const tracks = await loadSource(key);
    app.poolCache.set(key, tracks);
    if (app.settings.source === key) app.pool = tracks;
  } catch (err) {
    if (app.settings.source === key) app.poolError = err.message;
  } finally {
    if (app.settings.source === key) {
      app.poolLoading = false;
      render();
      if (app.pool.length) loadGenres();
    }
  }
}

function setSource(key) {
  app.settings = { ...app.settings, source: key, eras: [], genre: 'any', artist: 'any' };
  saveSettings();
  loadPool();
}

// ---------- game flow ----------

// Every song played, across games and visits, so new games favour unheard songs.
const HISTORY_KEY = 'gts.history';

function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function markPlayed(track) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(remember(loadHistory(), songKey(track))));
  } catch {
    /* not persisted: repeats are only avoided within this game */
  }
}

function startGame() {
  const songs = playOrder(filteredPool(), loadHistory());
  if (!songs.length) return;
  const { mode, rounds, teamNames } = app.settings;
  const names = teamNames.map((n, i) => n.trim() || `Team ${i + 1}`);
  app.game = createGame({
    mode,
    rounds: Math.min(rounds, songs.length),
    teamNames: mode === 'versus' ? names : ['You'],
  });
  app.gamePool = app.pool;
  app.queue = songs;
  app.screen = 'game';
  app.error = null;
  startRound();
}

async function startRound() {
  const token = ++app.roundToken;
  player.stop();
  app.current = null;
  app.roundStatus = 'loading';
  app.revealPlaying = false;
  app.message = null;
  render();

  // Skip songs Deezer has no preview for.
  while (app.queue.length) {
    const track = app.queue.shift();
    const preview = await findPreview(track).catch(() => null);
    if (token !== app.roundToken) return;
    if (!preview) continue;
    try {
      await player.load(preview.previewUrl);
    } catch {
      continue;
    }
    if (token !== app.roundToken) return;
    app.current = { track, preview };
    markPlayed(track);
    app.roundStatus = 'ready';
    render();
    return;
  }

  if (app.game.roundIndex === 0) {
    app.screen = 'setup';
    app.error = "Deezer doesn't have previews for any of these songs. Try a different source.";
  } else {
    app.game = { ...app.game, rounds: app.game.roundIndex, over: true };
    app.error = 'Ran out of songs with Deezer previews, so the game ended early.';
  }
  render();
}

function endGame() {
  app.roundToken++;
  player.stop();
  app.game = null;
  app.current = null;
  app.screen = 'setup';
  render();
}

async function playClip() {
  if (app.roundStatus !== 'ready' || app.game.round.phase === 'done') return;
  const seconds = clipLength(app.game);
  setPlaying(true);
  try {
    await player.play(seconds, (t) => {
      const head = $('#playhead');
      if (head) head.style.width = `${(t / MAX_CLIP) * 100}%`;
    });
  } catch {
    app.error = 'Your browser blocked audio playback. Click play again.';
    render();
  } finally {
    if (app.roundStatus === 'playing') setPlaying(false);
  }
}

function setPlaying(playing) {
  app.roundStatus = playing ? 'playing' : 'ready';
  $('.play-btn')?.classList.toggle('is-playing', playing);
  const status = $('#play-status');
  if (status) status.textContent = playing ? 'Playing…' : 'Ready';
}

async function toggleReveal() {
  if (app.revealPlaying) {
    player.stop();
    return;
  }
  app.revealPlaying = true;
  render();
  try {
    await player.play(PREVIEW_SECONDS);
  } catch {
    /* autoplay blocked: the button stays available */
  }
  app.revealPlaying = false;
  if (app.game?.round.phase === 'done') render();
}

function describe(before, after, kind) {
  const names = after.teamNames;
  const versus = after.mode === 'versus';
  const { round } = after;
  const missed = kind === 'skip' ? (before.round.phase === 'steal' ? 'passed' : 'skipped') : 'missed';

  if (round.phase === 'done') {
    const { winner, points, stolen } = round.result;
    if (winner === null) return { text: versus ? 'Nobody got it.' : 'Out of clips — no points this round.', tone: 'bad' };
    if (stolen) return { text: `${names[winner]} stole it! +${points}`, tone: 'good' };
    return { text: versus ? `${names[winner]} got it! +${points}` : `Got it! +${points}`, tone: 'good' };
  }
  const len = CLIP_LENGTHS[round.stage];
  const pts = pointsForStage(round.stage);
  if (round.phase === 'steal') {
    return { text: `${names[before.round.activeTeam]} ${missed}. ${names[round.activeTeam]}, steal it for ${pts}!`, tone: 'bad' };
  }
  if (versus) {
    return { text: `Steal ${missed}. Back to ${names[round.activeTeam]}: ${len}s for ${pts} points.`, tone: 'info' };
  }
  return { text: `${kind === 'skip' ? 'Skipped' : 'Not it'}. ${len}s unlocked — worth ${pts} points.`, tone: 'info' };
}

function applyAction(kind, correct = false) {
  if (!app.current || app.game.round.phase === 'done') return;
  const before = app.game;
  app.game = kind === 'skip' ? skip(before) : submitGuess(before, correct);
  app.message = describe(before, app.game, kind);
  app.clearGuess = true;
  player.stop();
  app.roundStatus = 'ready';
  if (app.game.round.phase === 'done') {
    render();
    toggleReveal();
    return;
  }
  render();
  if (!correct && kind === 'guess') {
    const box = $('.guess-box');
    box?.classList.remove('shake');
    void box?.offsetWidth; // restart the animation
    box?.classList.add('shake');
  }
}

function submitTextGuess(text, pickedId = null) {
  if (!text.trim() || !app.current) return;
  const { track } = app.current;
  applyAction('guess', pickedId === track.id || titlesMatch(text, track.name));
}

// ---------- guess suggestions ----------

const suggest = { items: [], index: -1 };

function updateSuggestions(query) {
  const list = $('#suggestions');
  if (!list) return;
  const q = normalizeTitle(query);
  suggest.items =
    q.length < 2
      ? []
      : app.gamePool
          .filter((t) => normalizeTitle(t.name).includes(q) || t.artists.some((a) => normalizeTitle(a).includes(q)))
          .slice(0, 6);
  suggest.index = -1;
  list.innerHTML = suggest.items
    .map(
      (t, i) =>
        `<li role="option" data-index="${i}"><span class="s-title">${esc(t.name)}</span><span class="s-artist">${esc(t.artists.join(', '))}</span></li>`,
    )
    .join('');
  list.hidden = !suggest.items.length;
}

function highlightSuggestion(delta) {
  if (!suggest.items.length) return;
  suggest.index = (suggest.index + delta + suggest.items.length) % suggest.items.length;
  document.querySelectorAll('#suggestions li').forEach((li, i) => li.classList.toggle('active', i === suggest.index));
}

function pickSuggestion(i) {
  const track = suggest.items[i];
  if (track) submitTextGuess(track.name, track.id);
}

// ---------- rendering ----------

const icons = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5v11a1 1 0 0 0 1.5.86l8.5-5.5a1 1 0 0 0 0-1.72L6.5 5.64A1 1 0 0 0 5 6.5Z"/><rect x="17" y="5" width="2.5" height="14" rx="1"/></svg>',
  logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path fill="var(--bg)" d="M10 7.8v8.4a.8.8 0 0 0 1.2.68l6.6-4.2a.8.8 0 0 0 0-1.36l-6.6-4.2A.8.8 0 0 0 10 7.8Z"/></svg>',
};

function renderHeader() {
  const p = app.profile;
  if (app.guest) {
    $('#account').innerHTML = `<span class="user">Guest</span>
       <button class="btn ghost" data-action="welcome">Connect Spotify</button>`;
    return;
  }
  $('#account').innerHTML = p
    ? `<span class="user">${p.images?.[0]?.url ? `<img src="${esc(p.images[0].url)}" alt="">` : ''}${esc(p.display_name ?? p.id)}</span>
       <button class="btn ghost" data-action="logout">Sign out</button>`
    : '';
}

function renderLogin() {
  $('#left').innerHTML = '';
  $('#right').innerHTML = '';
  const setup = !spotify.isConfigured()
    ? `<div class="setup-note">
        <h3>One-time setup</h3>
        <ol>
          <li>Create an app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and tick <em>Web API</em>.</li>
          <li>Add this Redirect URI: <code>${esc(spotify.redirectUri)}</code></li>
          <li>Copy <code>.env.example</code> to <code>.env</code>, paste the app's Client ID, and restart <code>npm run dev</code>.</li>
        </ol>
      </div>`
    : spotify.isLoggedIn()
      ? `<button class="btn primary big" data-action="spotify">Continue with Spotify</button>`
      : `<button class="btn primary big" data-action="login">Connect Spotify</button>`;
  $('#center').innerHTML = `
    <div class="wordmark">guessify</div>
    <div class="hero">
      <p>Hear a song for 0.1 seconds, then longer if you need it — the faster you name it, the more points you get. Connect Spotify to play with your own music, or play as a guest with Deezer's charts and playlists.</p>
      ${errorBanner()}
      <div class="row">
        ${setup}
        <button class="btn ghost big" data-action="guest">Play as guest</button>
      </div>
    </div>`;
}

function errorBanner() {
  return app.error
    ? `<div class="error" role="alert"><span>${esc(app.error)}</span><button data-action="dismiss" aria-label="Dismiss">×</button></div>`
    : '';
}

function sideButton(action, value, label, active) {
  return `<button class="side-btn${active ? ' active' : ''}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active}">${esc(label)}</button>`;
}

function renderSetupLeft() {
  const s = app.settings;
  const playlistKey = s.source.startsWith('playlist:') ? s.source : '';
  const deezerKey = s.source.startsWith('dz-') ? s.source : '';
  const option = (value, label) =>
    `<option value="${esc(value)}"${deezerKey === value ? ' selected' : ''}>${esc(label)}</option>`;
  $('#left').innerHTML = `
    <h3 class="label">Mode</h3>
    <div class="stack">
      ${sideButton('mode', 'single', '1 Player', s.mode === 'single')}
      ${sideButton('mode', 'versus', '2 Players', s.mode === 'versus')}
    </div>
    ${
      s.mode === 'versus'
        ? `<h3 class="label">Teams</h3>
           <div class="stack">
             <input class="text-input" data-team="0" value="${esc(s.teamNames[0])}" maxlength="20" aria-label="Team 1 name">
             <input class="text-input" data-team="1" value="${esc(s.teamNames[1])}" maxlength="20" aria-label="Team 2 name">
           </div>`
        : ''
    }
    <h3 class="label">Rounds</h3>
    <div class="chips">
      ${ROUND_OPTIONS.map((n) => `<button class="chip${s.rounds === n ? ' active' : ''}" data-action="rounds" data-value="${n}">${n}</button>`).join('')}
    </div>
    ${
      app.guest
        ? ''
        : `<h3 class="label">Songs from</h3>
    <div class="stack">
      ${SOURCES.map((src) => sideButton('source', src.key, src.label, s.source === src.key)).join('')}
      <select class="text-input${playlistKey ? ' active' : ''}" id="playlist-select" aria-label="Use a playlist">
        <option value="">${app.playlists.length ? 'Or pick a playlist…' : 'Loading playlists…'}</option>
        ${app.playlists.map((p) => `<option value="playlist:${esc(p.id)}"${playlistKey === `playlist:${p.id}` ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>`
    }
    <h3 class="label">${app.guest ? 'Songs from' : 'Charts &amp; hits'}</h3>
    <div class="stack">
      <select class="text-input${deezerKey ? ' active' : ''}" id="deezer-select" aria-label="Use a Deezer chart or playlist">
        <option value="">Pick a chart or playlist…</option>
        ${DEEZER_SOURCES.map(([key, name]) => option(key, name)).join('')}
      </select>
    </div>`;
}

// `selected` is one value, or an array for multi-select rows (empty array = any).
function filterRow(label, action, options, selected, anyLabel, note = '') {
  const isActive = (v) =>
    Array.isArray(selected) ? (v === 'any' ? !selected.length : selected.includes(v)) : selected === v;
  return `
    <div class="filter-row">
      <span class="filter-label">${label}</span>
      <div class="filter-options">
        ${[['any', anyLabel], ...options.map((o) => [o, o])]
          .map(
            ([v, l]) =>
              `<button class="filter${isActive(v) ? ' active' : ''}" data-action="${action}" data-value="${esc(v)}" aria-pressed="${isActive(v)}">${esc(l)}</button>`,
          )
          .join('')}
        ${note ? `<span class="filter-note">${note}</span>` : ''}
      </div>
    </div>`;
}

function genreNote() {
  if (app.genreLoad) {
    const { done, total } = app.genreLoad;
    return `<span class="spinner"></span>Sorting genres &amp; years${total ? ` · ${done}/${total} songs` : '…'}`;
  }
  if (app.genreError) return esc(app.genreError);
  if (!genreOptions().length) return 'Deezer has no genres for these songs.';
  return '';
}

function renderSetupCenter() {
  const s = app.settings;
  const pool = filteredPool();
  let info;
  if (app.poolLoading) info = `<p class="pool-info"><span class="spinner"></span>Loading ${esc(sourceLabel(s.source))}…</p>`;
  else if (app.poolError) info = `<p class="pool-info bad">${esc(app.poolError)}</p>`;
  else if (!app.pool.length) info = `<p class="pool-info bad">No songs found in ${esc(sourceLabel(s.source))}.</p>`;
  else {
    const theme = eraTheme();
    info = `<p class="pool-info"><strong>${pool.length}</strong> songs from ${esc(sourceLabel(s.source))}${theme ? ` · <em>${theme.name}</em> theme` : ''}</p>`;
  }

  $('#center').innerHTML = `
    <div class="wordmark">guessify</div>
    ${errorBanner()}
    ${
      app.pool.length
        ? `<div class="filters">
            ${filterRow('Eras', 'era', eraOptions(), s.eras, 'Any era')}
            ${filterRow('Genres', 'genre', genreOptions(), s.genre, 'Any genre', genreNote())}
            ${filterRow('Artists', 'artist', artistOptions(), s.artist, 'Any artist')}
          </div>`
        : ''
    }
    ${info}
    <button class="btn primary big" data-action="start"${pool.length && !app.poolLoading ? '' : ' disabled'}>
      ${icons.play} Start ${s.mode === 'versus' ? '2-player' : '1-player'} game
    </button>
    <p class="rules">${
      s.mode === 'versus'
        ? 'Teams take turns. A wrong guess or skip lets the other team steal the same points. If the steal misses, the clip gets longer.'
        : 'Each wrong guess or skip unlocks a longer clip worth one point less.'
    }</p>`;
}

function renderRight() {
  const game = app.game;
  const stage = game && !game.over ? game.round.stage : -1;
  const done = game?.round.phase === 'done';
  $('#right').innerHTML = `
    <h3 class="label">Guess after</h3>
    <div class="ladder">
      ${CLIP_LENGTHS.map((len, i) => {
        const state = i === stage && !done ? 'current' : i < stage || (done && i <= stage) ? 'used' : '';
        return `<div class="rung ${state}"><span class="mono">${len}s</span><span>${pointsForStage(i)} pts</span></div>`;
      }).join('')}
    </div>
    <h3 class="label">Volume</h3>
    <input type="range" id="volume" min="0" max="1" step="0.01" value="${app.settings.volume}" aria-label="Volume">
    <h3 class="label">Playback</h3>
    <p class="side-note">Every clip plays from the start of the song's 30-second Deezer preview.</p>`;
}

function renderGameLeft() {
  const g = app.game;
  $('#left').innerHTML = `
    <h3 class="label">Game</h3>
    <div class="side-summary">
      <div><span>Mode</span><strong>${g.mode === 'versus' ? '2 Players' : '1 Player'}</strong></div>
      <div><span>Round</span><strong>${Math.min(g.roundIndex + 1, g.rounds)} / ${g.rounds}</strong></div>
      <div><span>Songs</span><strong>${esc(sourceLabel(app.settings.source))}</strong></div>
    </div>
    <button class="btn ghost wide" data-action="end">${g.over ? 'Back to setup' : 'End game'}</button>`;
}

function scoreboard() {
  const g = app.game;
  if (g.mode === 'single') {
    return `<div class="scoreboard single"><div class="team"><span>Score</span><strong>${g.scores[0]}</strong><small>of ${g.rounds * pointsForStage(0)}</small></div></div>`;
  }
  return `<div class="scoreboard">${g.teamNames
    .map((name, i) => {
      const active = !g.over && g.round.phase !== 'done' && g.round.activeTeam === i;
      const stealing = active && g.round.phase === 'steal';
      return `<div class="team${active ? ' active' : ''}">
        <span>${esc(name)}${stealing ? ' <em class="badge">Steal</em>' : ''}</span>
        <strong>${g.scores[i]}</strong>
      </div>`;
    })
    .join('')}</div>`;
}

function clipBar() {
  const len = clipLength(app.game);
  return `
    <div class="clip-bar" aria-hidden="true">
      <div class="unlocked" style="width:${(len / MAX_CLIP) * 100}%"></div>
      <div class="playhead" id="playhead"></div>
      ${CLIP_LENGTHS.slice(0, -1).map((l) => `<span class="tick" style="left:${(l / MAX_CLIP) * 100}%"></span>`).join('')}
    </div>
    <div class="clip-scale mono"><span>${len}s</span><span>${MAX_CLIP}s</span></div>`;
}

function turnLabel() {
  const g = app.game;
  const round = `Round ${g.roundIndex + 1} of ${g.rounds}`;
  if (g.mode === 'single' || g.round.phase === 'done') return round;
  const team = esc(g.teamNames[g.round.activeTeam]);
  return g.round.phase === 'steal' ? `${round} · <strong>${team}</strong> can steal` : `${round} · <strong>${team}</strong>'s turn`;
}

// Deezer-sourced tracks have no Spotify id, so search for them instead.
function spotifyLink(track) {
  if (!track.deezerId) return `https://open.spotify.com/track/${esc(track.id)}`;
  return `https://open.spotify.com/search/${esc(encodeURIComponent(`${track.name} ${track.artists[0] ?? ''}`.trim()))}`;
}

function renderGameCenter() {
  const g = app.game;
  if (g.over) return renderGameOver();

  const feedback = app.message ? `<p class="feedback ${app.message.tone}" role="status">${esc(app.message.text)}</p>` : '<p class="feedback"></p>';

  if (g.round.phase === 'done' && app.current) {
    const { track, preview } = app.current;
    const last = g.roundIndex + 1 >= g.rounds;
    $('#center').innerHTML = `
      ${scoreboard()}
      <p class="turn">Round ${g.roundIndex + 1} of ${g.rounds}</p>
      ${feedback}
      <div class="reveal">
        <img src="${esc(preview.cover || track.image)}" alt="">
        <div class="reveal-info">
          <h2>${esc(track.name)}</h2>
          <p>${esc(track.artists.join(', '))}</p>
          <p class="muted">${esc(track.album)}${trackYear(track) ? ` · ${trackYear(track)}` : ''}</p>
          <div class="reveal-actions">
            <button class="btn ghost" data-action="reveal-play">${app.revealPlaying ? `${icons.stop} Stop` : `${icons.play} Play preview`}</button>
            <a class="btn ghost" href="${spotifyLink(track)}" target="_blank" rel="noreferrer">Open in Spotify</a>
          </div>
        </div>
      </div>
      <button class="btn primary big" data-action="next">${last ? 'See results' : 'Next song'}</button>`;
    return;
  }

  const loading = app.roundStatus === 'loading';
  const len = clipLength(g);
  $('#center').innerHTML = `
    ${scoreboard()}
    ${errorBanner()}
    <p class="turn">${turnLabel()}</p>
    ${clipBar()}
    <div class="play-area">
      <button class="play-btn${app.roundStatus === 'playing' ? ' is-playing' : ''}" data-action="play" aria-label="Play ${len} second clip"${loading ? ' disabled' : ''}>
        ${loading ? '<span class="spinner big"></span>' : icons.play}
      </button>
      <span class="clip-len mono">${len}s</span>
    </div>
    <p class="status" id="play-status">${loading ? 'Finding the next song…' : app.roundStatus === 'playing' ? 'Playing…' : 'Ready'}</p>
    ${feedback}
    <form class="guess-row" id="guess-form" autocomplete="off">
      <div class="guess-box">
        ${icons.search}
        <input id="guess" placeholder="Name that track" aria-label="Your guess" ${loading ? 'disabled' : ''}>
        <ul id="suggestions" role="listbox" hidden></ul>
      </div>
      <button type="button" class="btn ghost" data-action="skip"${loading ? ' disabled' : ''}>${icons.skip} ${g.round.phase === 'steal' ? 'Pass' : 'Skip'}</button>
    </form>
    <p class="hint"><kbd>Ctrl</kbd> + <kbd>Space</kbd> plays the clip · <kbd>Enter</kbd> submits your guess</p>`;
}

function renderGameOver() {
  const g = app.game;
  const best = winners(g);
  let headline;
  if (g.mode === 'single') headline = `You scored ${g.scores[0]} of ${g.rounds * pointsForStage(0)}`;
  else if (best.length > 1) headline = "It's a tie!";
  else headline = `${esc(g.teamNames[best[0]])} wins!`;
  $('#center').innerHTML = `
    <div class="wordmark">game over</div>
    ${errorBanner()}
    <h2 class="headline">${headline}</h2>
    ${scoreboard()}
    <div class="row">
      <button class="btn primary big" data-action="again">${icons.play} Play again</button>
      <button class="btn ghost" data-action="end">Change settings</button>
    </div>`;
}

function render() {
  // Keep whatever the player was typing across re-renders.
  const guess = $('#guess');
  const typed = guess?.value ?? '';
  const hadFocus = document.activeElement === guess;

  renderHeader();
  document.body.dataset.screen = app.screen;
  document.documentElement.dataset.era = eraTheme()?.key ?? 'any';
  if (app.screen === 'boot') {
    $('#center').innerHTML = '<div class="wordmark">guessify</div><p class="pool-info"><span class="spinner"></span>Connecting…</p>';
  } else if (app.screen === 'login') {
    renderLogin();
  } else if (app.screen === 'setup') {
    renderSetupLeft();
    renderSetupCenter();
    renderRight();
  } else {
    renderGameLeft();
    renderGameCenter();
    renderRight();
  }

  suggest.items = [];
  suggest.index = -1;
  const input = $('#guess');
  if (input && !input.disabled) {
    if (!app.clearGuess) input.value = typed;
    if (hadFocus || app.roundStatus === 'ready') input.focus();
  }
  app.clearGuess = false;
}

// ---------- events ----------

const actions = {
  login: () => spotify.login(),
  logout: () => {
    spotify.logout();
    actions.welcome();
  },
  // Back to the Spotify-or-guest choice.
  welcome: () => {
    endGame();
    app.guest = false;
    app.profile = null;
    app.playlists = [];
    app.poolCache.clear();
    app.screen = 'login';
    render();
  },
  spotify: () => enterSpotify(),
  guest: () => enterGuest(),
  dismiss: () => {
    app.error = null;
    render();
  },
  mode: (v) => {
    app.settings = { ...app.settings, mode: v };
    saveSettings();
    render();
  },
  rounds: (v) => {
    app.settings = { ...app.settings, rounds: Number(v) };
    saveSettings();
    render();
  },
  source: (v) => setSource(v),
  era: (v) => {
    const { eras } = app.settings;
    const next = v === 'any' ? [] : eras.includes(v) ? eras.filter((e) => e !== v) : [...eras, v].sort();
    app.settings = { ...app.settings, eras: next };
    saveSettings();
    render();
  },
  genre: (v) => {
    app.settings = { ...app.settings, genre: v };
    saveSettings();
    render();
  },
  artist: (v) => {
    app.settings = { ...app.settings, artist: v };
    saveSettings();
    render();
  },
  start: startGame,
  play: playClip,
  skip: () => applyAction('skip'),
  next: () => {
    player.stop();
    app.game = nextRound(app.game);
    if (app.game.over) render();
    else startRound();
  },
  'reveal-play': toggleReveal,
  end: endGame,
  again: startGame,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el.dataset.value);
});

// Pick on mousedown so the input doesn't lose focus first.
document.addEventListener('mousedown', (e) => {
  const li = e.target.closest('#suggestions li');
  if (li) {
    e.preventDefault();
    pickSuggestion(Number(li.dataset.index));
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'guess-form') return;
  e.preventDefault();
  if (suggest.index >= 0) pickSuggestion(suggest.index);
  else submitTextGuess($('#guess').value);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'guess') updateSuggestions(e.target.value);
  else if (e.target.id === 'volume') {
    app.settings.volume = Number(e.target.value);
    player.setVolume(app.settings.volume);
    saveSettings();
  } else if (e.target.dataset.team) {
    app.settings.teamNames[Number(e.target.dataset.team)] = e.target.value;
    saveSettings();
  }
});

document.addEventListener('change', (e) => {
  if (['playlist-select', 'deezer-select'].includes(e.target.id) && e.target.value) setSource(e.target.value);
});

// Ctrl+Space plays from anywhere (plain Space types in the guess box).
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'guess') {
    if (e.key === 'ArrowDown') highlightSuggestion(1);
    else if (e.key === 'ArrowUp') highlightSuggestion(-1);
    else if (e.key === 'Escape') updateSuggestions('');
    else if (!(e.code === 'Space' && e.ctrlKey)) return;
    else playClip();
    e.preventDefault();
    return;
  }
  const typing = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName) && e.target.id !== 'volume';
  if (e.code === 'Space' && (e.ctrlKey || !typing) && app.screen === 'game') {
    e.preventDefault();
    playClip();
  }
});

// ---------- boot ----------

// Every visit starts on the Spotify-or-guest choice, except straight after a Spotify login.
async function boot() {
  render();
  let justLoggedIn = false;
  try {
    justLoggedIn = await spotify.handleRedirect();
  } catch (err) {
    app.error = err.message;
  }
  if (justLoggedIn && spotify.isConfigured()) enterSpotify();
  else {
    app.screen = 'login';
    render();
  }
}

async function enterSpotify() {
  if (!spotify.isConfigured() || !spotify.isLoggedIn()) return spotify.login();
  app.guest = false;
  app.screen = 'boot';
  render();
  try {
    app.profile = await spotify.getProfile();
  } catch (err) {
    app.screen = 'login';
    app.error =
      err.status === 403
        ? 'Spotify refused this account. In your Spotify app dashboard, add your account under User Management, then sign in again.'
        : err.message;
    if (err.status === 403) spotify.logout();
    render();
    return;
  }
  app.error = null;
  app.screen = 'setup';
  render();
  loadPool();
  app.playlists = await spotify.getPlaylists().catch(() => []);
  if (app.screen === 'setup') render();
}

async function enterGuest() {
  app.guest = true;
  app.profile = null;
  app.error = null;
  // Spotify sources need an account, so guests start on the worldwide chart.
  if (!isDeezerSource(app.settings.source)) app.settings = { ...app.settings, source: GUEST_SOURCE, eras: [], genre: 'any', artist: 'any' };
  app.screen = 'setup';
  render();
  loadPool();
}

// Spotify only accepts loopback redirect URIs written as 127.0.0.1, not localhost.
if (location.hostname === 'localhost') location.replace(location.href.replace('//localhost', '//127.0.0.1'));
else boot();

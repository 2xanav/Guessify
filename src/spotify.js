// Spotify Web API: Authorization Code + PKCE login (no client secret, no backend)
// and loading the user's songs. Spotify only supplies metadata here; audio comes
// from Deezer (see deezer.js).

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI || `${location.origin}/`;
const SCOPES = [
  'user-read-private',
  'user-top-read',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const TOKEN_KEY = 'gts.spotify.token';
const VERIFIER_KEY = 'gts.spotify.verifier';
const STATE_KEY = 'gts.spotify.state';

export const isConfigured = () => Boolean(CLIENT_ID);
export const redirectUri = REDIRECT_URI;

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the session just won't persist */
  }
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join('');
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  store(VERIFIER_KEY, verifier);
  store(STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

export function logout() {
  store(TOKEN_KEY, null);
}

async function requestToken(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Spotify login failed');
  const previous = load(TOKEN_KEY);
  const token = {
    accessToken: data.access_token,
    // Spotify may or may not rotate the refresh token.
    refreshToken: data.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  store(TOKEN_KEY, token);
  return token;
}

// Call once on page load. Completes the login if Spotify just redirected back.
// Resolves true when this page load is the return from a successful login.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;
  history.replaceState(null, '', location.pathname);
  if (error) throw new Error(`Spotify login was cancelled (${error})`);
  if (params.get('state') !== load(STATE_KEY)) throw new Error('Spotify login state mismatch, please try again');
  const verifier = load(VERIFIER_KEY);
  store(VERIFIER_KEY, null);
  store(STATE_KEY, null);
  await requestToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
  return true;
}

export const isLoggedIn = () => Boolean(load(TOKEN_KEY)?.accessToken);

async function accessToken() {
  let token = load(TOKEN_KEY);
  if (!token) throw new Error('Not signed in to Spotify');
  if (Date.now() > token.expiresAt - 60_000) {
    token = await requestToken({ grant_type: 'refresh_token', refresh_token: token.refreshToken });
  }
  return token.accessToken;
}

export class SpotifyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, retried = false) {
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 429 && !retried) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api(path, true);
  }
  if (res.status === 401) {
    logout();
    throw new SpotifyError('Your Spotify session expired, please sign in again', 401);
  }
  if (!res.ok) {
    let message = `Spotify request failed (${res.status})`;
    try {
      message = (await res.json()).error?.message || message;
    } catch {
      /* non-JSON error body */
    }
    throw new SpotifyError(message, res.status);
  }
  return res.json();
}

// Follows `next` links until `max` items are collected.
async function paged(path, max) {
  const items = [];
  let next = path;
  while (next && items.length < max) {
    const page = await api(next);
    items.push(...page.items);
    next = page.next;
  }
  return items.slice(0, max);
}

function toTrack(t) {
  if (!t || t.type !== 'track' || !t.id || t.is_local) return null;
  const images = t.album?.images ?? [];
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album?.name ?? '',
    image: images[0]?.url ?? '',
    year: Number.parseInt(t.album?.release_date, 10) || null,
    isrc: t.external_ids?.isrc ?? null,
  };
}

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => t && !seen.has(t.id) && seen.add(t.id));
}

export const getProfile = () => api('/me');

export async function getTopTracks(timeRange) {
  const items = await paged(`/me/top/tracks?limit=50&time_range=${timeRange}`, 100);
  return dedupe(items.map(toTrack));
}

export async function getSavedTracks() {
  const items = await paged('/me/tracks?limit=50', 500);
  return dedupe(items.map((i) => toTrack(i.track)));
}

export async function getPlaylists() {
  const items = await paged('/me/playlists?limit=50', 200);
  return items.filter(Boolean).map((p) => ({ id: p.id, name: p.name }));
}

export async function getPlaylistTracks(id) {
  // Newer API versions expose playlist contents at /items (entries under `item`);
  // older ones at /tracks (entries under `track`). Support both.
  let items;
  try {
    items = await paged(`/playlists/${id}/items?limit=50`, 500);
  } catch (err) {
    if (!(err instanceof SpotifyError) || ![403, 404].includes(err.status)) throw err;
    items = await paged(`/playlists/${id}/tracks?limit=50`, 500);
  }
  return dedupe(items.map((i) => toTrack(i.item ?? i.track)));
}

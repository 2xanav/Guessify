// Deezer supplies the audio: a 30 second MP3 preview for each Spotify track.
// The Deezer API doesn't send CORS headers, so requests go through JSONP.

import { normalizeTitle } from './match.js';

let callbackId = 0;

function jsonp(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const name = `__deezer_cb_${Date.now()}_${callbackId++}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      delete window[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Deezer did not respond'));
    }, timeoutMs);
    window[name] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Could not reach Deezer'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${name}`;
    document.head.append(script);
  });
}

// Deezer allows 50 requests per 5 seconds and answers code 4 past that; wait it out once.
async function api(url) {
  const data = await jsonp(url);
  if (data.error?.code !== 4) return data;
  await new Promise((r) => setTimeout(r, 5000));
  return jsonp(url);
}

function toPreview(dz) {
  return {
    previewUrl: dz.preview,
    deezerId: dz.id,
    albumId: dz.album?.id ?? null,
    cover: dz.album?.cover_xl || dz.album?.cover_big || '',
    deezerLink: dz.link,
  };
}

async function byIsrc(isrc) {
  const data = await api(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
  // The ISRC can resolve to a copy that isn't playable in this region (empty preview).
  return !data.error && data.preview && data.readable !== false ? toPreview(data) : null;
}

// Deezer's advanced `artist:"" track:""` syntax returns nothing, so plain search.
// Preference: same ISRC, then same artist + exact title, then same artist + title
// ignoring versions (a live cut can share a normalized title with the original).
async function bySearch(track) {
  const title = normalizeTitle(track.name);
  const artist = normalizeTitle(track.artists[0] ?? '');
  const data = await api(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=15`);
  const results = (data.data ?? []).filter(
    (r) => r.preview && r.readable !== false && normalizeTitle(r.artist?.name ?? '') === artist,
  );
  const hit =
    (track.isrc && results.find((r) => r.isrc === track.isrc)) ||
    results.find((r) => r.title.toLowerCase() === track.name.toLowerCase()) ||
    results.find((r) => normalizeTitle(r.title) === title);
  return hit ? toPreview(hit) : null;
}

// Tracks that came from a Deezer chart or playlist already know their Deezer id.
async function byId(id) {
  const data = await api(`https://api.deezer.com/track/${id}`);
  return !data.error && data.preview && data.readable !== false ? toPreview(data) : null;
}

// Returns { previewUrl, cover, ... } or null when Deezer has no playable preview.
// Preview URLs are signed and expire, so resolve right before a round, not ahead of time.
export async function findPreview(track) {
  if (track.deezerId) {
    const hit = await byId(track.deezerId).catch(() => null);
    if (hit) return hit;
  }
  if (track.isrc) {
    const hit = await byIsrc(track.isrc).catch(() => null);
    if (hit) return hit;
  }
  return bySearch(track);
}

// ---------- charts and editorial playlists (no login needed) ----------

// Same shape as spotify.js tracks. Ids are prefixed so they never collide with
// Spotify's. Chart and playlist entries carry no release year; getDetails fills it in.
function toTrack(dz) {
  if (!dz?.id || !dz.preview || dz.readable === false) return null;
  return {
    id: `dz:${dz.id}`,
    deezerId: dz.id,
    deezerAlbumId: dz.album?.id ?? null,
    name: dz.title,
    artists: [dz.artist?.name].filter(Boolean),
    album: dz.album?.title ?? '',
    image: dz.album?.cover_xl || dz.album?.cover_big || '',
    year: null,
    isrc: dz.isrc ?? null,
  };
}

function toTracks(items) {
  const seen = new Set();
  return items.map(toTrack).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
}

async function paged(url, max) {
  const items = [];
  let next = url;
  while (next && items.length < max) {
    const page = await api(next);
    if (page.error) throw new Error(page.error.message || 'Deezer request failed');
    items.push(...(page.data ?? []));
    next = page.next;
  }
  return items.slice(0, max);
}

// genreId 0 is the overall chart. Charts hold up to 200 tracks.
export async function getChartTracks(genreId) {
  return toTracks(await paged(`https://api.deezer.com/chart/${genreId}/tracks?limit=200`, 200));
}

export async function getPlaylistTracks(id) {
  return toTracks(await paged(`https://api.deezer.com/playlist/${id}/tracks?limit=100`, 300));
}

// Deezer's current top editorial playlists, so the list refreshes itself as
// Deezer rotates them. Mostly-instrumental moods are useless for guessing.
const WORDLESS = /lo-?fi|sleep|relax|calm|piano|meditat|focus|study|chill|ambient|classical|guitar|spa\b|instrumental/i;

export async function getEditorialPlaylists() {
  const data = await api('https://api.deezer.com/chart/0/playlists?limit=60');
  if (data.error) throw new Error(data.error.message || 'Deezer request failed');
  return (data.data ?? []).filter((p) => !WORDLESS.test(p.title)).map((p) => ({ id: p.id, name: p.title }));
}

// ---------- genres and release years ----------

const DETAILS_KEY = 'gts.deezer.details';
const albums = new Map(); // Deezer album id -> Promise<{ genres, year }>

function albumDetails(id) {
  if (!albums.has(id)) {
    const request = api(`https://api.deezer.com/album/${id}`).then((data) => {
      if (data.error) throw new Error(data.error.message || 'Deezer album lookup failed');
      return {
        genres: (data.genres?.data ?? []).map((g) => g.name),
        year: Number.parseInt(data.release_date, 10) || null,
      };
    });
    request.catch(() => albums.delete(id)); // let a later call retry
    albums.set(id, request);
  }
  return albums.get(id);
}

// Deezer tags each album (not track) with genres like "Pop" or "Rap/Hip Hop", and
// the album gives Deezer-sourced tracks their release year. Cached per track id in
// localStorage; songs missing from Deezer are cached empty, network failures aren't
// so they retry next time. Resolves to { details: { trackId: { genres, year } }, failed }.
export async function getDetails(tracks, onProgress) {
  let details = {};
  try {
    localStorage.removeItem('gts.deezer.genres'); // superseded by DETAILS_KEY
    details = JSON.parse(localStorage.getItem(DETAILS_KEY)) ?? {};
  } catch {
    /* start fresh */
  }
  const save = () => {
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
    } catch {
      /* not persisted, still works for this visit */
    }
  };
  const missing = tracks.filter((t) => !(t.id in details));
  const total = missing.length;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (missing.length) {
      const track = missing.shift();
      try {
        const albumId = track.deezerAlbumId ?? (await findPreview(track))?.albumId;
        details[track.id] = albumId ? await albumDetails(albumId) : { genres: [], year: null };
      } catch {
        failed++;
      }
      if (++done % 20 === 0) save();
      onProgress?.(done, total, details);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  save();
  return { details, failed };
}

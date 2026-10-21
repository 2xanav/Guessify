// Picks the order songs are played in, so back-to-back games on the same list
// don't repeat songs until everything has had a turn.

import { normalizeTitle } from './match.js';

// Playlists often hold the same song twice under different ids (single and album
// version, a remaster), so songs are identified by title + first artist.
export const songKey = (track) => `${normalizeTitle(track.name)}|${normalizeTitle(track.artists[0] ?? '')}`;

export function dedupeSongs(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    const key = songKey(t);
    return !seen.has(key) && seen.add(key);
  });
}

export function shuffle(list, random = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// `history` is song keys in the order they were played, oldest first. Songs never
// played come first in random order, then the rest, least recently played first.
export function playOrder(tracks, history, random = Math.random) {
  const lastPlayed = new Map(history.map((key, i) => [key, i]));
  const unique = dedupeSongs(tracks);
  const fresh = unique.filter((t) => !lastPlayed.has(songKey(t)));
  const played = shuffle(unique.filter((t) => lastPlayed.has(songKey(t))), random).sort(
    (a, b) => lastPlayed.get(songKey(a)) - lastPlayed.get(songKey(b)),
  );
  return [...shuffle(fresh, random), ...played];
}

// Moves `key` to the most recent end of the history, keeping it bounded.
export function remember(history, key, max = 3000) {
  return [...history.filter((k) => k !== key), key].slice(-max);
}

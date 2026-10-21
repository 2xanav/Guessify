# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server, pinned to `http://127.0.0.1:5173` (`strictPort`). The host and port must match the Redirect URI registered in the Spotify dashboard, so don't change them casually.
- `npm run dev:lan` — serves to the local network at `https://<LAN IP>:5174` with a self-signed cert (`@vitejs/plugin-basic-ssl`). HTTPS is required off loopback: Spotify rejects plain-HTTP non-loopback redirect URIs, and PKCE needs `crypto.subtle`. That URL must also be registered as a Redirect URI.
- `npm test` — Vitest, run once. Single file: `npx vitest run src/game.test.js`; single test: add `-t "steal"`.
- `npm run build` — production build to `dist/`.
- Requires `.env` with `VITE_SPOTIFY_CLIENT_ID` (see `.env.example`). Without it the app shows setup instructions instead of the login button.

## Architecture

Vanilla JS + Vite, no framework, no backend. Data flows Spotify → Deezer → `<audio>`:

- `src/spotify.js` — Authorization Code + PKCE login done entirely in the browser (tokens in localStorage, auto refresh), plus loaders for top tracks / liked songs / playlists, normalized to `{ id, name, artists[], album, image, year, isrc }`. Spotify supplies **metadata only**; it never plays audio. Playlist contents are read from `/playlists/{id}/items` with a fallback to the older `/tracks`, and entries may sit under `item` or `track`.
- `src/deezer.js` — maps a Spotify track to a Deezer 30s preview MP3: ISRC lookup first, then plain search filtered by artist. Deezer's API has no CORS, so it's called via **JSONP** (script tags). Deezer quirks that are verified: an ISRC can resolve to an unplayable copy (`readable: false`, empty `preview`), and the advanced `artist:"…" track:"…"` search syntax returns no results. Preview URLs are signed and expire, so they're resolved per round, not cached.
- `src/player.js` — `ClipPlayer` plays the first N seconds of a preview, stopping on a `requestAnimationFrame` check against both `currentTime` and the wall clock (needed for the 0.1s clip).
- `src/game.js` — pure, immutable game rules (stages, points, steal phase, rounds). No DOM access. This is where scoring changes go, and it's covered by `game.test.js`.
- Deezer is also a song source (no login): `/chart/{genreId}/tracks` (0 = overall, max 200) and editorial playlists listed live from `/chart/0/playlists` (instrumental moods filtered out). These tracks use ids prefixed `dz:`, carry `deezerId`/`deezerAlbumId`, and have `year: null`; the year arrives with the genres via `getDetails`, so read years through `trackYear()` in main.js. Source keys are `dz-chart:<id>` / `dz-playlist:<id>`.
- Genres come from Deezer, not Spotify (Spotify returned empty artist genres in practice). `deezer.getDetails` resolves each track via `findPreview` (or its `deezerAlbumId`), then reads `/album/{id}` for genres and release year (Deezer only tags albums), caching per track id in localStorage. `src/genres.js` merges overlapping Deezer genres (Dance + Electro, the Latin variants). Deezer's quota is 50 requests / 5s; `api()` in deezer.js waits and retries once on error code 4.
- Era themes: eras are multi-select (`settings.eras`, empty = any). Picking a single 1960s–2020s era sets `<html data-era>` to it; two or more set `data-era="mix"` (the Mixtape theme), and `style.css` overrides the color tokens per decade. New colors should use tokens (or `color-mix` on `--accent`), never hardcoded hex values, so every theme picks them up.
- `src/deck.js` — pure song ordering for a game: dedupes by normalized title + first artist, plays never-heard songs first, then least-recently-played. Play history (song keys, oldest first) lives in localStorage under `gts.history`, appended in `startRound` when a song actually plays.
- `src/match.js` — title normalization and typo-tolerant guess matching, also used to match Deezer results.
- Entry flow: every visit opens on the welcome screen (`screen: 'login'`), which offers Spotify (Connect, or Continue if a token is stored) or **Play as guest**. The one exception is the return from the OAuth redirect, which goes straight to setup. Guest mode (`app.guest`) hides the Spotify sources and only offers `dz-` sources, falling back to `dz-chart:0`.
- `src/main.js` — the single `app` state object, a `render()` that rebuilds the left sidebar, center stage and right sidebar from state with template strings, and delegated event handlers keyed on `data-action`. Anything from an API must go through `esc()` before it goes into HTML. Playback progress updates the DOM directly (`setPlaying`, `#playhead`) rather than calling `render()`, and `render()` preserves the guess input's text and focus.

## Game rules (as implemented)

Clips are 0.1/0.5/2/8/16s worth 5/4/3/2/1 points. A wrong guess or skip advances the clip. In 2-player mode a wrong guess or skip first gives the other team one steal attempt at the same stage. If the steal misses, the clip advances and the turn returns to the original team. Teams alternate who hears each new song first.

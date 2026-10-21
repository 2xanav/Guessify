# Guessify

Name songs from your own Spotify library after hearing 0.1s, 0.5s, 2s, 8s or 16s of them.
Song info comes from the Spotify Web API; the audio is Deezer's 30-second preview of the same track.

## Scoring

| Clip | 0.1s | 0.5s | 2s | 8s | 16s |
|------|------|------|----|----|-----|
| Points | 5 | 4 | 3 | 2 | 1 |

- **1 player:** a wrong guess or skip unlocks the next clip, worth one point less. Missing the 16s clip scores nothing.
- **2 players:** teams alternate who hears each new song first. A wrong guess (or skip) lets the other team **steal** for the same points with the same clip. If the steal misses, the clip gets longer and the turn goes back to the first team.

## Setup

1. Create an app at <https://developer.spotify.com/dashboard>, choose **Web API**, and add the Redirect URI
   `http://127.0.0.1:5173/` (Spotify doesn't accept `localhost`).
2. In the app's **User Management**, add the Spotify account(s) that will sign in (required while the app is in development mode).
3. Copy `.env.example` to `.env` and set `VITE_SPOTIFY_CLIENT_ID`. No client secret is needed (PKCE login).
4. Run:

   ```sh
   npm install
   npm run dev
   ```

   then open <http://127.0.0.1:5173/>.

## Notes

- Songs Deezer has no preview for (or only an unplayable regional copy of) are skipped automatically.
- Clips play from the start of Deezer's preview, which isn't always the start of the song.
- Deezer has no video API; album art is shown when the song is revealed.

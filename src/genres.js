// Deezer's album genres are already broad, but a few overlap ("Dance" and
// "Electro", five flavours of Latin). Fold those together; keep the rest as-is.

const MERGED = {
  'Rap/Hip Hop': 'Hip-Hop',
  Dance: 'Electronic',
  Electro: 'Electronic',
  'R&B': 'R&B & Soul',
  'Soul & Funk': 'R&B & Soul',
  Alternative: 'Indie & Alt',
  'Latin Music': 'Latin',
  Reggaeton: 'Latin',
  Salsa: 'Latin',
  Cumbia: 'Latin',
  'Traditional Mexicano': 'Latin',
  'Brazilian Music': 'Latin',
  'Films/Games': 'Soundtracks',
};

export function genreBuckets(deezerGenres) {
  return [...new Set(deezerGenres.map((g) => MERGED[g] ?? g))];
}

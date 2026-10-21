// Title normalization for judging guesses and matching Spotify tracks to Deezer.

export function normalizeTitle(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '') // "(feat. X)", "[Remastered]"
    .replace(/\s+-\s+.*$/, '') // "- 2011 Remaster", "- Live"
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Exact after normalization, with a small typo allowance for longer titles.
export function titlesMatch(guess, answer) {
  const g = normalizeTitle(guess);
  const a = normalizeTitle(answer);
  if (!g || !a) return false;
  if (g === a) return true;
  return levenshtein(g, a) <= Math.floor(a.length / 8);
}

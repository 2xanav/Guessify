import { describe, expect, it } from 'vitest';
import { genreBuckets } from './genres.js';

describe('genreBuckets', () => {
  it('folds overlapping Deezer genres together', () => {
    expect(genreBuckets(['Dance', 'Electro'])).toEqual(['Electronic']);
    expect(genreBuckets(['Reggaeton', 'Latin Music'])).toEqual(['Latin']);
    expect(genreBuckets(['Rap/Hip Hop'])).toEqual(['Hip-Hop']);
  });

  it('keeps every distinct genre an album has', () => {
    expect(genreBuckets(['Pop', 'R&B'])).toEqual(['Pop', 'R&B & Soul']);
  });

  it('passes unmerged genres through unchanged', () => {
    expect(genreBuckets(['Rock', 'K-Pop'])).toEqual(['Rock', 'K-Pop']);
    expect(genreBuckets([])).toEqual([]);
  });
});

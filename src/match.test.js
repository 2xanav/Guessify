import { describe, expect, it } from 'vitest';
import { normalizeTitle, titlesMatch } from './match.js';

describe('normalizeTitle', () => {
  it('strips versions, features and punctuation', () => {
    expect(normalizeTitle('Bohemian Rhapsody - Remastered 2011')).toBe('bohemian rhapsody');
    expect(normalizeTitle('Señorita (feat. Camila Cabello)')).toBe('senorita');
    expect(normalizeTitle("Don't Stop Me Now [Live]")).toBe('dont stop me now');
    expect(normalizeTitle('Rock & Roll')).toBe('rock and roll');
  });
});

describe('titlesMatch', () => {
  it('accepts exact titles regardless of case and extras', () => {
    expect(titlesMatch('bohemian rhapsody', 'Bohemian Rhapsody - Remastered 2011')).toBe(true);
  });

  it('allows a small typo on long titles but not short ones', () => {
    expect(titlesMatch('bohemian rapsody', 'Bohemian Rhapsody')).toBe(true);
    expect(titlesMatch('hellp', 'Hello')).toBe(false);
  });

  it('rejects different songs and empty guesses', () => {
    expect(titlesMatch('Yesterday', 'Let It Be')).toBe(false);
    expect(titlesMatch('   ', 'Let It Be')).toBe(false);
  });
});

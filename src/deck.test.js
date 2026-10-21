import { describe, expect, it } from 'vitest';
import { dedupeSongs, playOrder, remember, songKey } from './deck.js';

const song = (id, name, artist = 'Artist') => ({ id, name, artists: [artist] });

describe('dedupeSongs', () => {
  it('drops the same song saved under different ids', () => {
    const tracks = [song('a', 'Hello'), song('b', 'Hello - 2015 Remaster'), song('c', 'Hello', 'Someone Else')];
    expect(dedupeSongs(tracks).map((t) => t.id)).toEqual(['a', 'c']);
  });
});

describe('playOrder', () => {
  const tracks = Array.from({ length: 6 }, (_, i) => song(`id${i}`, `Song ${i}`));

  it('plays every unplayed song before any repeat', () => {
    const history = [songKey(tracks[0]), songKey(tracks[1])];
    const order = playOrder(tracks, history);
    expect(order.slice(0, 4).map((t) => t.id).sort()).toEqual(['id2', 'id3', 'id4', 'id5']);
  });

  it('repeats the least recently played songs first', () => {
    const history = tracks.map(songKey); // id0 oldest ... id5 newest
    expect(playOrder(tracks, history).map((t) => t.id)).toEqual(['id0', 'id1', 'id2', 'id3', 'id4', 'id5']);
  });

  it('never repeats across two back-to-back games that fit in the list', () => {
    let history = [];
    const played = [];
    for (let game = 0; game < 2; game++) {
      for (const t of playOrder(tracks, history).slice(0, 3)) {
        played.push(t.id);
        history = remember(history, songKey(t));
      }
    }
    expect(new Set(played).size).toBe(6);
  });
});

describe('remember', () => {
  it('moves a replayed song to the newest end and caps the length', () => {
    expect(remember(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});

import { describe, expect, it } from 'vitest';
import { clipLength, createGame, nextRound, skip, submitGuess, winners } from './game.js';

const wrong = (s) => submitGuess(s, false);
const right = (s) => submitGuess(s, true);

describe('single player', () => {
  it('awards 5 points for a first-clip guess', () => {
    const s = right(createGame());
    expect(s.scores).toEqual([5]);
    expect(s.round.result).toEqual({ winner: 0, points: 5, stolen: false });
  });

  it('each miss unlocks a longer clip worth one point less', () => {
    let s = createGame();
    expect(clipLength(s)).toBe(0.1);
    s = wrong(s);
    expect(clipLength(s)).toBe(0.5);
    s = skip(s);
    expect(clipLength(s)).toBe(2);
    s = right(s);
    expect(s.scores).toEqual([3]);
  });

  it('gives nothing after missing the 16s clip', () => {
    let s = createGame();
    for (let i = 0; i < 4; i++) s = wrong(s);
    expect(clipLength(s)).toBe(16);
    s = wrong(s);
    expect(s.round.phase).toBe('done');
    expect(s.round.result).toEqual({ winner: null, points: 0, stolen: false });
    expect(s.scores).toEqual([0]);
  });

  it('ends after the configured number of rounds', () => {
    let s = createGame({ rounds: 2 });
    s = nextRound(right(s));
    expect(s.over).toBe(false);
    s = nextRound(right(s));
    expect(s.over).toBe(true);
    expect(s.scores).toEqual([10]);
  });
});

describe('two player', () => {
  const versus = () => createGame({ mode: 'versus', rounds: 4 });

  it('a wrong guess hands the other team a steal at the same points', () => {
    const s = wrong(versus());
    expect(s.round).toMatchObject({ phase: 'steal', activeTeam: 1, stage: 0 });
    const stolen = right(s);
    expect(stolen.scores).toEqual([0, 5]);
    expect(stolen.round.result).toEqual({ winner: 1, points: 5, stolen: true });
  });

  it('a missed steal returns to the guessing team with a longer clip', () => {
    let s = wrong(versus());
    s = wrong(s);
    expect(s.round).toMatchObject({ phase: 'guess', activeTeam: 0, stage: 1 });
    s = right(s);
    expect(s.scores).toEqual([4, 0]);
  });

  it('skipping also opens the steal', () => {
    expect(skip(versus()).round).toMatchObject({ phase: 'steal', activeTeam: 1 });
  });

  it('nobody scores when the last steal misses', () => {
    let s = versus();
    for (let i = 0; i < 9; i++) s = wrong(s);
    expect(s.round).toMatchObject({ phase: 'steal', stage: 4 });
    s = wrong(s);
    expect(s.round.result).toEqual({ winner: null, points: 0, stolen: false });
  });

  it('alternates which team hears each new song first', () => {
    let s = nextRound(right(versus()));
    expect(s.round.activeTeam).toBe(1);
    s = right(s);
    expect(s.scores).toEqual([5, 5]);
    expect(winners(s)).toEqual([0, 1]);
    s = nextRound(s);
    expect(s.round.activeTeam).toBe(0);
  });

  it('ignores actions once the round is decided', () => {
    const done = right(versus());
    expect(wrong(done)).toBe(done);
    expect(right(done)).toBe(done);
  });
});

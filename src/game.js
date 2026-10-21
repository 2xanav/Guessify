// Pure game rules. Every action takes a state and returns a new one, so the
// UI can re-render from state and the rules can be unit tested without a DOM.

export const CLIP_LENGTHS = [0.1, 0.5, 2, 8, 16];
export const MAX_POINTS = 5;

export function pointsForStage(stage) {
  return MAX_POINTS - stage;
}

export function createGame({ mode = 'single', rounds = 10, teamNames } = {}) {
  const names =
    mode === 'versus' ? teamNames ?? ['Team 1', 'Team 2'] : teamNames?.slice(0, 1) ?? ['You'];
  return {
    mode,
    rounds,
    teamNames: names,
    scores: names.map(() => 0),
    roundIndex: 0,
    round: newRound(0),
    over: false,
  };
}

function newRound(startingTeam) {
  // phase: 'guess' -> the guessing team is answering
  //        'steal' -> (versus only) the other team gets one shot at the same points
  //        'done'  -> the round is resolved; see `result`
  return { stage: 0, guessingTeam: startingTeam, activeTeam: startingTeam, phase: 'guess', result: null };
}

function finish(state, winner, stolen) {
  const points = winner === null ? 0 : pointsForStage(state.round.stage);
  const scores = state.scores.slice();
  if (winner !== null) scores[winner] += points;
  return {
    ...state,
    scores,
    round: { ...state.round, phase: 'done', result: { winner, points, stolen } },
  };
}

// Move to the next (longer) clip, handing the turn back to the guessing team.
function advance(state) {
  const stage = state.round.stage + 1;
  if (stage >= CLIP_LENGTHS.length) return finish(state, null, false);
  const { guessingTeam } = state.round;
  return { ...state, round: { ...state.round, stage, activeTeam: guessingTeam, phase: 'guess' } };
}

function otherTeam(team) {
  return team === 0 ? 1 : 0;
}

export function submitGuess(state, correct) {
  const { phase, activeTeam } = state.round;
  if (state.over || phase === 'done') return state;

  if (correct) return finish(state, activeTeam, phase === 'steal');

  if (phase === 'guess' && state.mode === 'versus') {
    return { ...state, round: { ...state.round, phase: 'steal', activeTeam: otherTeam(activeTeam) } };
  }
  return advance(state);
}

// Skipping counts as a wrong answer: in versus it still opens the steal.
export function skip(state) {
  return submitGuess(state, false);
}

export function nextRound(state) {
  if (state.round.phase !== 'done') return state;
  const roundIndex = state.roundIndex + 1;
  if (roundIndex >= state.rounds) return { ...state, over: true };
  // In versus the teams alternate who hears each new song first.
  const startingTeam = state.mode === 'versus' ? roundIndex % 2 : 0;
  return { ...state, roundIndex, round: newRound(startingTeam) };
}

export function clipLength(state) {
  return CLIP_LENGTHS[state.round.stage];
}

export function winners(state) {
  const best = Math.max(...state.scores);
  return state.scores.flatMap((s, i) => (s === best ? [i] : []));
}

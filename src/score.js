// Tennis game scoring (one "game" = 0/15/30/40/Deuce/Advantage).

const LABELS = ['0', '15', '30', '40'];

export function createScore() {
  return { player: 0, cpu: 0, winner: null };
}

export function addPoint(score, who) {
  if (score.winner) return score;
  score[who]++;
  const p = score.player;
  const c = score.cpu;
  if (p >= 4 && p - c >= 2) score.winner = 'player';
  else if (c >= 4 && c - p >= 2) score.winner = 'cpu';
  return score;
}

/** Total points played (used for deuce/ad side selection). */
export function pointsPlayed(score) {
  return score.player + score.cpu;
}

export function isDeuceSide(score) {
  return pointsPlayed(score) % 2 === 0;
}

/** Human readable call, e.g. "15 - 30", "デュース", "アドバンテージ あなた". */
export function scoreText(score) {
  const p = score.player;
  const c = score.cpu;
  if (score.winner === 'player') return 'ゲーム あなた';
  if (score.winner === 'cpu') return 'ゲーム CPU';
  if (p >= 3 && c >= 3) {
    if (p === c) return 'デュース';
    return p > c ? 'アドバンテージ あなた' : 'アドバンテージ CPU';
  }
  return `${LABELS[p]} - ${LABELS[c]}`;
}

export function scoreLabels(score) {
  const p = score.player;
  const c = score.cpu;
  if (p >= 3 && c >= 3) {
    if (p === c) return { player: '40', cpu: '40' };
    return p > c ? { player: 'AD', cpu: '40' } : { player: '40', cpu: 'AD' };
  }
  return { player: LABELS[Math.min(p, 3)], cpu: LABELS[Math.min(c, 3)] };
}

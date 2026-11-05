import { describe, it, expect } from 'vitest';
import { createScore, addPoint, scoreText, scoreLabels, isDeuceSide } from '../../src/score.js';

const play = (seq) => { const s = createScore(); for (const w of seq) addPoint(s, w === 'p' ? 'player' : 'cpu'); return s; };

describe('score', () => {
  it('love game', () => {
    const s = play('pppp');
    expect(s.winner).toBe('player');
    expect(scoreText(s)).toBe('ゲーム あなた');
  });
  it('labels', () => {
    expect(scoreText(play('pc'))).toBe('15 - 15');
    expect(scoreText(play('ppc'))).toBe('30 - 15');
    expect(scoreLabels(play('pppc'))).toEqual({ player: '40', cpu: '15' });
  });
  it('deuce and advantage', () => {
    const s = play('pppccc');
    expect(scoreText(s)).toBe('デュース');
    addPoint(s, 'cpu');
    expect(scoreText(s)).toBe('アドバンテージ CPU');
    expect(s.winner).toBeNull();
    addPoint(s, 'player');
    expect(scoreText(s)).toBe('デュース');
    addPoint(s, 'player');
    addPoint(s, 'player');
    expect(s.winner).toBe('player');
  });
  it('no points after the game is decided', () => {
    const s = play('cccc');
    addPoint(s, 'player');
    expect(s.player).toBe(0);
    expect(s.winner).toBe('cpu');
  });
  it('deuce/ad side alternates', () => {
    expect(isDeuceSide(play(''))).toBe(true);
    expect(isDeuceSide(play('p'))).toBe(false);
  });
});

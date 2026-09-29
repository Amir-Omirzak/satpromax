import { describe, expect, it } from 'vitest';
import { isCorrectAnswer } from '../src/services/grading.js';
import { mergeProgress } from '../src/services/progress.js';

describe('isCorrectAnswer', () => {
  it.each([
    ['0.75', '0.75'],
    ['.75', '0.75'],
    ['3/4', '0.75'],
    ['0,75', '3/4'],
    [' 12 ', '12'],
    ['12.0', '12'],
    ['-2/4', '-0.5'],
    ['b', 'B'],
    ['x = 3', 'X=3'],
  ])('accepts %j for %j', (given, expected) => {
    expect(isCorrectAnswer(given, expected)).toBe(true);
  });

  it.each([
    ['0.7', '0.75'],
    ['4/3', '0.75'],
    ['1/0', '0'],
    ['a', 'b'],
    ['', '0'],
  ])('rejects %j for %j', (given, expected) => {
    expect(isCorrectAnswer(given, expected)).toBe(false);
  });
});

describe('mergeProgress', () => {
  const duration = 1000;

  it('starts from the reported position', () => {
    expect(mergeProgress(undefined, { watchedSec: 120.7 }, duration)).toEqual({ watchedSec: 120, completed: false });
  });

  it('never moves backwards when the student rewinds', () => {
    expect(mergeProgress({ watchedSec: 500, completed: false }, { watchedSec: 100 }, duration).watchedSec).toBe(500);
  });

  it('caps watched time at the lesson length', () => {
    expect(mergeProgress(undefined, { watchedSec: 5000 }, duration).watchedSec).toBe(duration);
  });

  it('completes automatically at 90%', () => {
    expect(mergeProgress(undefined, { watchedSec: 899 }, duration).completed).toBe(false);
    expect(mergeProgress(undefined, { watchedSec: 900 }, duration).completed).toBe(true);
  });

  it('completes when the student marks the lesson done', () => {
    expect(mergeProgress(undefined, { watchedSec: 10, completed: true }, duration).completed).toBe(true);
  });

  it('keeps a lesson completed', () => {
    expect(mergeProgress({ watchedSec: 950, completed: true }, { watchedSec: 0, completed: false }, duration)).toEqual({
      watchedSec: 950,
      completed: true,
    });
  });
});

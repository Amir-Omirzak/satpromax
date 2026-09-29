/**
 * Checks a student's answer to a SAT Math practice task.
 *
 * SAT grid-in answers are accepted in several equivalent forms, so "3/4",
 * ".75" and "0.75" all match an expected answer of 0.75. Non-numeric answers
 * (e.g. multiple choice letters) are compared case- and whitespace-insensitively.
 */
export function isCorrectAnswer(given: string, expected: string): boolean {
  const a = toNumber(given);
  const b = toNumber(expected);
  if (a !== null && b !== null) {
    return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
  }
  return normalize(given) === normalize(expected);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function toNumber(raw: string): number | null {
  const s = normalize(raw).replace(',', '.');
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);

  const fraction = /^([+-]?\d+)\/(\d+)$/.exec(s);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  return null;
}

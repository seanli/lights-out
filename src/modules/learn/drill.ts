// "Whose echo is this?" drill: Leitner boxes over the bottom-row table. Pure scheduling here; the view
// keeps the round on screen and the boxes are saved under rules.json → learn.drill.saveKey.
// Never touches stars or progress.
import type { Rng } from '../../contracts';

export interface DrillRules { cards: number; boxes: number; missGap: number; saveKey: string }
/** box per card (1 = learning, `boxes` = known); cards keyed by their bottom row, e.g. "0,4" */
export interface DrillSave { boxes: Record<string, number>; rounds: number }
export interface Round { queue: string[]; pos: number; right: number; answered: boolean | null }

export const emptySave = (): DrillSave => ({ boxes: {}, rounds: 0 });

/** a card's weight: each box nearer "known" is drawn half as often */
const weight = (box: number, boxes: number) => 2 ** (boxes - Math.min(Math.max(box, 1), boxes));

/** `rules.cards` cards, drawn by weight from the boxes, never the same card twice in a row */
export function planRound(keys: readonly string[], save: DrillSave, rules: DrillRules, rng: Pick<Rng, 'next'>): string[] {
  const out: string[] = [];
  for (let k = 0; k < rules.cards; k++) {
    const pool = keys.filter((key) => key !== out[k - 1] || keys.length === 1);
    const ws = pool.map((key) => weight(save.boxes[key] ?? 1, rules.boxes));
    let r = rng.next() * ws.reduce((a, b) => a + b, 0);
    let pick = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { r -= ws[i]!; if (r < 0) { pick = i; break; } }
    out.push(pool[pick]!);
  }
  return out;
}

/**
 * Score the current card. Right: up a box. Wrong: back to box 1, and the card comes back `missGap`
 * cards later in this round (the round stays `rules.cards` long).
 */
export function answer(round: Round, save: DrillSave, right: boolean, rules: DrillRules): { round: Round; save: DrillSave } {
  const key = round.queue[round.pos]!;
  const box = save.boxes[key] ?? 1;
  const boxes = { ...save.boxes, [key]: right ? Math.min(box + 1, rules.boxes) : 1 };
  let queue = round.queue;
  if (!right) {
    const at = Math.min(round.pos + rules.missGap, queue.length - 1);
    if (at > round.pos) queue = [...queue.slice(0, at), key, ...queue.slice(at)].slice(0, rules.cards);
  }
  return { round: { ...round, queue, right: round.right + (right ? 1 : 0), answered: right }, save: { ...save, boxes } };
}

export const nextCard = (round: Round): Round => ({ ...round, pos: round.pos + 1, answered: null });
export const finished = (round: Round): boolean => round.pos >= round.queue.length;

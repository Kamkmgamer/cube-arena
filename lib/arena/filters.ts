// Leaderboard filters, kept in the URL (?size=3&tools=model_only). Every
// filter defaults to "all", which shows every board that has results.

import type { BoardSection } from './board';
import { type Board, type Challenge, type Mode, SIZES, type Size, type ToolUse } from './rules';

export interface Filters {
  board: Board | 'all';
  size: Size | 'all';
  challenge: Challenge | 'all';
  mode: Mode | 'all';
  tools: ToolUse | 'all';
}

export const ALL: Filters = { board: 'all', size: 'all', challenge: 'all', mode: 'all', tools: 'all' };

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | 'all' => (allowed.includes(v as T) ? (v as T) : 'all');

export function filtersFrom(sp: Record<string, string | string[] | undefined>): Filters {
  const size = Number(sp.size);
  return {
    board: pick<Board>(sp.board, ['verified', 'community']),
    size: SIZES.includes(size as Size) ? (size as Size) : 'all',
    challenge: pick<Challenge>(sp.challenge, ['ladder', 'scramble']),
    mode: pick<Mode>(sp.mode, ['interactive', 'one_shot']),
    tools: pick<ToolUse>(sp.tools, ['model_only', 'code', 'solver']),
  };
}

export function filtersQuery(f: Filters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== 'all') q.set(k, String(v));
  return q.toString();
}

const rows = (s: BoardSection) => (s.challenge === 'ladder' ? s.ladder.length : s.scramble.length);

/** The boards that match, in page order. The board filter drops rows, so ranks restart within it. */
export function applyFilters(sections: BoardSection[], f: Filters): BoardSection[] {
  return sections
    .filter(
      (s) =>
        (f.size === 'all' || s.size === f.size) &&
        (f.challenge === 'all' || s.challenge === f.challenge) &&
        (f.mode === 'all' || s.mode === f.mode) &&
        (f.tools === 'all' || s.toolUse === f.tools),
    )
    .map((s) =>
      f.board === 'all' ? s : { ...s, ladder: s.ladder.filter((r) => r.board === f.board), scramble: s.scramble.filter((r) => r.board === f.board) },
    )
    .filter((s) => rows(s) > 0);
}

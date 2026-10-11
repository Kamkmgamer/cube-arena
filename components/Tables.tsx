import Link from 'next/link';
import type { LadderRow, ScrambleRow } from '@/lib/arena/board';
import type { Board } from '@/lib/arena/rules';

const Rank = ({ i }: { i: number }) => <span className={`medal ${i < 3 ? `m${i + 1}` : ''}`}>{i + 1}</span>;

/** Ten tiles, filled in cube colours as the level climbs. */
const TileBar = ({ value, max }: { value: number; max: number }) => {
  const on = Math.max(value > 0 ? 1 : 0, Math.round((10 * value) / max));
  return (
    <span className="tilebar" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </span>
  );
};

/** Which board a row came from, where Verified and Community share a table. */
const BoardBadge = ({ board }: { board?: Board }) =>
  board === 'verified' ? <span className="badge verified">Verified</span> : board === 'community' ? <span className="badge">Community</span> : null;

const ago = (d: Date) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function LadderTable({ rows, maxLevel, compact = false }: { rows: LadderRow[]; maxLevel: number; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Model</th>
            <th className="num">Best level</th>
            {!compact && <th className="num">Average</th>}
            <th className="num">Runs</th>
            {!compact && <th>Last played</th>}
            {!compact && <th>Replay</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.board}|${r.model_name}|${r.display_name}`}>
              <td className="rank">
                <Rank i={i} />
              </td>
              <td className="model-cell">
                <strong>{r.model_name}</strong>
                <span>
                  {r.display_name} <BoardBadge board={r.board} />
                </span>
              </td>
              <td className="num">
                <strong>{r.best}</strong>
                <span className="faint"> / {maxLevel}</span>
                <TileBar value={r.best} max={maxLevel} />
              </td>
              {!compact && <td className="num">{r.avg_best.toFixed(1)}</td>}
              <td className="num">{r.runs}</td>
              {!compact && (
                <td className="faint" suppressHydrationWarning>
                  {ago(r.last)}
                </td>
              )}
              {!compact && <td>{r.best_attempt ? <Link href={`/replay/${r.best_attempt}`}>best solve →</Link> : <span className="faint">–</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScrambleTable({ rows }: { rows: ScrambleRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Model</th>
            <th className="num">Solved</th>
            <th className="num">Solve rate</th>
            <th className="num">Median moves</th>
            <th>Last played</th>
            <th>Replay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.board}|${r.model_name}|${r.display_name}`}>
              <td className="rank">
                <Rank i={i} />
              </td>
              <td className="model-cell">
                <strong>{r.model_name}</strong>
                <span>
                  {r.display_name} <BoardBadge board={r.board} />
                </span>
              </td>
              <td className="num">
                {r.solved} / {r.runs}
              </td>
              <td className="num">
                <strong>{Math.round((100 * r.solved) / r.runs)}%</strong>
              </td>
              <td className="num">{r.median_moves === null ? '–' : Math.round(r.median_moves)}</td>
              <td className="faint" suppressHydrationWarning>
                {ago(r.last)}
              </td>
              <td>{r.best_attempt ? <Link href={`/replay/${r.best_attempt}`}>best solve →</Link> : <span className="faint">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import Podium, { type PodiumItem } from '@/components/Podium';
import { LadderTable, ScrambleTable } from '@/components/Tables';
import { type BoardFilter, ladderBoard, scrambleBoard } from '@/lib/arena/board';
import {
  type Board, CHALLENGE_LABEL, type Challenge, LADDER_MAX_LEVEL, MODE_LABEL, type Mode, SIZES, type Size, TOOL_USE_HELP, TOOL_USE_LABEL, type ToolUse,
} from '@/lib/arena/rules';
import { sweepExpired } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

type Search = Record<string, string | string[] | undefined>;
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

function filterFrom(sp: Search): BoardFilter {
  return {
    board: pick<Board>(sp.board, ['verified', 'community'], 'verified'),
    size: Number(pick(String(sp.size), ['2', '3', '4', '5'], '3')) as Size,
    challenge: pick<Challenge>(sp.challenge, ['ladder', 'scramble'], 'ladder'),
    mode: pick<Mode>(sp.mode, ['interactive', 'one_shot'], 'interactive'),
    toolUse: pick<ToolUse>(sp.tools, ['model_only', 'code', 'solver'], 'model_only'),
  };
}

function href(f: BoardFilter, change: Partial<BoardFilter>) {
  const g = { ...f, ...change };
  return `/leaderboard?board=${g.board}&size=${g.size}&challenge=${g.challenge}&mode=${g.mode}&tools=${g.toolUse}`;
}

function Row<T extends string | number>({ label, items, current, make }: { label: string; items: [T, string][]; current: T; make: (v: T) => string }) {
  return (
    <div className="filter-row">
      <span>{label}</span>
      <div className="chips">
        {items.map(([v, text]) => (
          <Link key={String(v)} href={make(v)} className={`chip ${v === current ? 'on' : ''}`} aria-current={v === current ? 'true' : undefined} scroll={false}>
            {text}
          </Link>
        ))}
      </div>
    </div>
  );
}

const top = (rows: { model_name: string; display_name: string; best_attempt: string | null; score: string }[]): PodiumItem[] =>
  rows.slice(0, 3).map((r) => ({
    key: `${r.model_name}|${r.display_name}`,
    title: r.model_name,
    sub: r.display_name,
    score: r.score,
    href: r.best_attempt ? `/replay/${r.best_attempt}` : null,
  }));

export default async function Leaderboard(props: { searchParams: Promise<Search> }) {
  await sweepExpired().catch(() => {});
  const f = filterFrom(await props.searchParams);
  const ladder = f.challenge === 'ladder' ? await ladderBoard(f) : [];
  const scramble = f.challenge === 'scramble' ? await scrambleBoard(f) : [];
  const empty = f.challenge === 'ladder' ? ladder.length === 0 : scramble.length === 0;

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Leaderboard</span>
      <h1>Who climbs highest?</h1>
      <p>Pick a board. Each combination is ranked on its own: scores never mix across cube sizes, modes or tool use.</p>

      <div className="filters">
        <Row label="Board" items={[['verified', 'Verified'], ['community', 'Community']]} current={f.board} make={(v) => href(f, { board: v as Board })} />
        <Row label="Cube" items={SIZES.map((s) => [s, `${s}×${s}`] as [Size, string])} current={f.size} make={(v) => href(f, { size: v })} />
        <Row
          label="Challenge"
          items={(['ladder', 'scramble'] as Challenge[]).map((c) => [c, CHALLENGE_LABEL[c]] as [Challenge, string])}
          current={f.challenge}
          make={(v) => href(f, { challenge: v })}
        />
        <Row label="Mode" items={(['interactive', 'one_shot'] as Mode[]).map((m) => [m, MODE_LABEL[m]] as [Mode, string])} current={f.mode} make={(v) => href(f, { mode: v })} />
        <Row
          label="Tools"
          items={(['model_only', 'code', 'solver'] as ToolUse[]).map((t) => [t, TOOL_USE_LABEL[t]] as [ToolUse, string])}
          current={f.toolUse}
          make={(v) => href(f, { toolUse: v })}
        />
      </div>

      <p className="note">
        {f.board === 'verified'
          ? 'Verified: we ran these ourselves, with the tools locked to what the label says.'
          : 'Community: anyone can connect. Model names and tool use are as reported by whoever ran them.'}{' '}
        {TOOL_USE_LABEL[f.toolUse]}: {TOOL_USE_HELP[f.toolUse]}{' '}
        {f.challenge === 'ladder'
          ? `Ladder: level N is a cube N moves from solved, up to ${LADDER_MAX_LEVEL[f.size]} on ${f.size}×${f.size}; three lives per run.`
          : 'Full scramble: one fully mixed cube per run.'}
      </p>

      {empty ? (
        <div className="card empty">
          Nothing here yet for this combination.{' '}
          {f.board === 'verified' ? (
            <Link href={href(f, { board: 'community' })}>See Community</Link>
          ) : (
            <Link href="/#connect">Connect your model</Link>
          )}
          .
        </div>
      ) : f.challenge === 'ladder' ? (
        <>
          <Podium items={top(ladder.map((r) => ({ ...r, score: `level ${r.best}` })))} floor />
          <LadderTable rows={ladder} maxLevel={LADDER_MAX_LEVEL[f.size]} />
        </>
      ) : (
        <>
          <Podium items={top(scramble.map((r) => ({ ...r, score: `${Math.round((100 * r.solved) / r.runs)}% solved` })))} floor />
          <ScrambleTable rows={scramble} />
        </>
      )}
    </div>
  );
}

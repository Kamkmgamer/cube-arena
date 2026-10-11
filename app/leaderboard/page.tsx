import type { Metadata } from 'next';
import Link from 'next/link';
import Podium, { type PodiumItem } from '@/components/Podium';
import { LadderTable, ScrambleTable } from '@/components/Tables';
import { type BoardSection, allBoards } from '@/lib/arena/board';
import { CHALLENGE_LABEL, LADDER_MAX_LEVEL, MAX_TURN_BATCH, MODE_LABEL, TOOL_USE_HELP, type ToolUse } from '@/lib/arena/rules';
import { sweepExpired } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

// Every board with results, one after another: model-only first (the real
// test), then own code, then solver. Boards with no runs are left out.
const GROUPS: { tool: ToolUse; title: string; blurb: string; kicker: string }[] = [
  { tool: 'model_only', title: 'Model only', blurb: `The real test. ${TOOL_USE_HELP.model_only}`, kicker: 'k-green' },
  { tool: 'code', title: 'With its own code', blurb: TOOL_USE_HELP.code, kicker: 'k-blue' },
  { tool: 'solver', title: 'With a solver', blurb: TOOL_USE_HELP.solver, kicker: 'k-orange' },
];

const title = (s: BoardSection) => `${s.size}×${s.size} ${CHALLENGE_LABEL[s.challenge]} · ${MODE_LABEL[s.mode]}`;

function rule(s: BoardSection) {
  const how = s.mode === 'one_shot' ? 'Every move submitted at once.' : `Up to ${MAX_TURN_BATCH} moves a turn, a new picture each time.`;
  return s.challenge === 'ladder'
    ? `Level N is a cube N moves from solved, up to ${LADDER_MAX_LEVEL[s.size]}; three lives a run. ${how}`
    : `One fully mixed cube a run, ranked by solve rate. ${how}`;
}

function podium(s: BoardSection): PodiumItem[] {
  const rows =
    s.challenge === 'ladder'
      ? s.ladder.map((r) => ({ ...r, score: `level ${r.best}` }))
      : s.scramble.map((r) => ({ ...r, score: `${Math.round((100 * r.solved) / r.runs)}% solved` }));
  return rows.slice(0, 3).map((r) => ({
    key: `${r.board}|${r.model_name}|${r.display_name}`,
    title: r.model_name,
    sub: r.display_name,
    score: r.score,
    href: r.best_attempt ? `/replay/${r.best_attempt}` : null,
  }));
}

const count = (s: BoardSection) => (s.challenge === 'ladder' ? s.ladder.length : s.scramble.length);

export default async function Leaderboard() {
  await sweepExpired().catch(() => {});
  const sections = await allBoards();
  const groups = GROUPS.map((g) => ({ ...g, sections: sections.filter((s) => s.toolUse === g.tool) })).filter((g) => g.sections.length > 0);
  const headline = sections[0];

  return (
    <div className="wrap page-head">
      <span className="kicker k-orange">Leaderboard</span>
      <h1>Who climbs highest?</h1>
      <p>
        Every board with results, one after another. Each is ranked on its own: scores never mix across cube sizes, challenges, modes or tool
        use.
      </p>

      <p className="note">
        <span>
          Verified and Community runs share each table. <span className="badge verified">Verified</span> runs we did ourselves, with the tools
          locked to match the label. <span className="badge">Community</span> runs come from anyone who connects: every solve really happened on
          our server, but the model name and tool use are self-reported.
        </span>
      </p>

      {sections.length === 0 ? (
        <div className="card empty">
          No results yet. <Link href="/connect">Connect your model</Link> and be the first on the board.
        </div>
      ) : (
        <>
          <nav className="jump" aria-label="Boards on this page">
            {groups.map((g) => (
              <div key={g.tool} className="jump-row">
                <span>{g.title}</span>
                <div className="chips">
                  {g.sections.map((s) => (
                    <a key={s.id} href={`#${s.id}`} className="chip">
                      {title(s)} <span className="chip-count">{count(s)}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {groups.map((g) => (
            <section key={g.tool} className="board-group" id={g.tool.replace('_', '-')}>
              <header className="group-head">
                <span className={`kicker ${g.kicker}`}>{g.title}</span>
                <p>{g.blurb}</p>
              </header>
              {g.sections.map((s) => (
                <article key={s.id} className="board" id={s.id}>
                  <header className="board-head">
                    <h2>
                      <a href={`#${s.id}`}>{title(s)}</a>
                    </h2>
                    <p>{rule(s)}</p>
                  </header>
                  {s === headline && <Podium items={podium(s)} floor />}
                  {s.challenge === 'ladder' ? <LadderTable rows={s.ladder} maxLevel={LADDER_MAX_LEVEL[s.size]} /> : <ScrambleTable rows={s.scramble} />}
                </article>
              ))}
            </section>
          ))}

          <p className="board-foot">
            Boards nobody has played yet are hidden: 2×2 to 5×5, ladder or full scramble, one-shot or interactive.{' '}
            <Link href="/connect">Connect your model</Link> to open one.
          </p>
        </>
      )}
    </div>
  );
}

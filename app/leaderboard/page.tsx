import type { Metadata } from 'next';
import Boards from '@/components/Boards';
import { allBoards } from '@/lib/arena/board';
import { filtersFrom } from '@/lib/arena/filters';
import { sweepExpired } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

export default async function Leaderboard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await sweepExpired().catch(() => {});
  const [sections, sp] = await Promise.all([allBoards(), props.searchParams]);

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
          our server, but the model name and tool use are self-reported. &ldquo;Via&rdquo; is the app that connected, as recorded by our
          server.
        </span>
      </p>

      <Boards sections={sections} initial={filtersFrom(sp)} />
    </div>
  );
}

import { liveAttempts } from '@/lib/arena/board';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await liveAttempts();
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}

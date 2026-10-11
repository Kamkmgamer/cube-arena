import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer, callerFrom } from '@/lib/arena/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, X-Arena-Name, X-Arena-Model, X-Arena-Tool-Use',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function POST(req: Request): Promise<Response> {
  const server = buildServer(callerFrom(req));
  // Stateless: a fresh transport per request; plain JSON replies, no SSE.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    void server.close();
  }
}

// No server-initiated stream and no sessions to end.
const notAllowed = () =>
  withCors(Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST JSON-RPC to this endpoint.' }, id: null }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = () => withCors(new Response(null, { status: 204 }));

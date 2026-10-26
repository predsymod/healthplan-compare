import { allow } from "@/lib/limit";
import { apiDocs, callTool, INSTRUCTIONS, TOOLS } from "@/lib/tools";

// Remote MCP server (streamable HTTP, stateless JSON responses). No secrets are used here.
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
};

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function handle(m: Rpc) {
  if (m.id === undefined) return null; // a notification needs no reply
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: { name: "healthplan-compare", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call": {
      const r = callTool(String(m.params?.name ?? ""), m.params?.arguments);
      return ok(m.id, {
        content: [{ type: "text", text: JSON.stringify(r.ok ? r.result : { error: r.error }) }],
        isError: !r.ok,
      });
    }
    default:
      return fail(m.id, -32601, "Method not found");
  }
}

export async function POST(req: Request) {
  if (!allow(req)) {
    return Response.json(fail(null, -32000, "Too many requests. Try again in a minute."), { status: 429, headers: CORS });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400, headers: CORS });
  }
  const batch = Array.isArray(body);
  const messages: Rpc[] = batch ? (body as Rpc[]) : [body as Rpc];
  const replies = messages.map(handle).filter((r) => r !== null);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return Response.json(batch ? replies : replies[0], { headers: CORS });
}

// A plain GET (for example a browser or an assistant fetching this URL) gets the API description instead of an error.
export function GET(req: Request) {
  return new Response(apiDocs(new URL(req.url).origin), {
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

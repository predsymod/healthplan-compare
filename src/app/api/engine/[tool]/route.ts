import { allow } from "@/lib/limit";
import { apiDocs, callTool, queryArgs } from "@/lib/tools";

// Plain REST version of the same tools, for agents and apps that do not speak MCP.
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  if (!allow(req)) return Response.json({ error: "Too many requests." }, { status: 429, headers: CORS });
  const { tool } = await ctx.params;
  let args: unknown = {};
  try {
    args = await req.json();
  } catch {
    // an empty body is fine for next_question
  }
  const r = callTool(tool, args);
  return Response.json(r.ok ? r.result : { error: r.error }, { status: r.ok ? 200 : 400, headers: CORS });
}

const NO_STORE = { "Cache-Control": "no-store" };
// With no query string, describe the API. With one, run the tool, so a client that can only GET can use it.
export async function GET(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const url = new URL(req.url);
  if (!url.search) {
    return new Response(apiDocs(url.origin), { headers: { ...CORS, ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!allow(req)) return Response.json({ error: "Too many requests." }, { status: 429, headers: { ...CORS, ...NO_STORE } });
  const { tool } = await ctx.params;
  const r = callTool(tool, queryArgs(url.searchParams));
  return Response.json(r.ok ? r.result : { error: r.error }, { status: r.ok ? 200 : 400, headers: { ...CORS, ...NO_STORE } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

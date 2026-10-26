import { allow } from "@/lib/limit";
import { agentGuide, callTool } from "@/lib/tools";

// Plain REST version of the same tools, for agents and apps that do not speak MCP.
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export function GET(req: Request) {
  return new Response(agentGuide(new URL(req.url).origin), {
    headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

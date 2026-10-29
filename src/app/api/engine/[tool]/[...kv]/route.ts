import { GET as queryGet } from "../route";

// The same GET as /api/engine/<tool>?a=1&b=2, written as path segments: /api/engine/<tool>/a/1/b/2.
// Some assistants' fetch tools drop query strings they build themselves but keep the path.
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ tool: string; kv: string[] }> }) {
  const { tool, kv } = await ctx.params;
  const sp = new URLSearchParams();
  for (let i = 0; i + 1 < kv.length; i += 2) sp.set(decodeURIComponent(kv[i]), decodeURIComponent(kv[i + 1]));
  const url = new URL(req.url);
  const rewritten = new Request(`${url.origin}/api/engine/${tool}?${sp.toString()}`, { headers: req.headers });
  return queryGet(rewritten, { params: Promise.resolve({ tool }) });
}

export { OPTIONS } from "../route";

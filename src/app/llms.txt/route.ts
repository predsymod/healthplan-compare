import { agentGuide } from "@/lib/tools";

// llms.txt convention: a plain-text page that tells an AI assistant how to use this site.
export const runtime = "nodejs";

export function GET(req: Request) {
  return new Response(agentGuide(new URL(req.url).origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

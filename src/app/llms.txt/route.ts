import { apiDocs } from "@/lib/tools";

// llms.txt convention: a plain-text description of what this site offers and how to call it.
export const runtime = "nodejs";

export function GET(req: Request) {
  return new Response(apiDocs(new URL(req.url).origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

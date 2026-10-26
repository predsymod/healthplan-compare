import { NextResponse } from "next/server";
import {
  buildMessages,
  EXPLAIN_SCHEMA,
  pickCandidates,
  verify,
  type Explanation,
  type RawExplanation,
} from "@/lib/explain";
import { resolveQuery, type Search } from "@/lib/query";

// The Meta key is read here, on the server only. It is never sent to the browser.
export const runtime = "nodejs";

const HOUR = 60 * 60 * 1000;
const MAX_CALLS_PER_HOUR = 40; // protects the hackathon credits from a public demo link
const calls: number[] = [];
const cache = new Map<string, { at: number; value: Explanation }>();

function parseJson(content: string): RawExplanation | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const v = JSON.parse(cleaned);
    if (typeof v?.summary === "string" && Array.isArray(v?.points) && typeof v?.caveat === "string") {
      const points = v.points.filter(
        (p: unknown): p is RawExplanation["points"][number] =>
          !!p && typeof (p as { text?: unknown }).text === "string" && Array.isArray((p as { claims?: unknown }).claims),
      );
      return { summary: v.summary, caveat: v.caveat, points };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function POST(req: Request) {
  const key = process.env.META_API_KEY ?? process.env.MODEL_API_KEY;
  if (!key) return NextResponse.json({ error: "The explanation service is not configured." }, { status: 503 });

  let body: Search;
  try {
    body = (await req.json()) as Search;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const q = resolveQuery(body);
  if (!q.county || q.rows.length === 0) {
    return NextResponse.json({ error: "No plans to explain for that ZIP." }, { status: 400 });
  }

  const cacheKey = JSON.stringify([q.household, q.zip, q.county.fips, q.tobacco]);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return NextResponse.json(hit.value);

  const now = Date.now();
  while (calls.length && now - calls[0] > HOUR) calls.shift();
  if (calls.length >= MAX_CALLS_PER_HOUR) {
    return NextResponse.json({ error: "Too many explanation requests right now. Try again later." }, { status: 429 });
  }
  calls.push(now);

  const cands = pickCandidates(q.rows);
  const base = (process.env.META_API_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.META_MODEL ?? "muse-spark-1.3",
        messages: buildMessages(q.household, q.county.name, cands),
        response_format: {
          type: "json_schema",
          json_schema: { name: "PlanExplanation", strict: true, schema: EXPLAIN_SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    console.error("explain: request failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "The explanation service did not respond." }, { status: 502 });
  }

  if (!res.ok) {
    console.error("explain: Meta API returned", res.status, (await res.text()).slice(0, 300));
    return NextResponse.json({ error: `The explanation service returned an error (${res.status}).` }, { status: 502 });
  }

  const data = await res.json();
  const raw = parseJson(String(data?.choices?.[0]?.message?.content ?? ""));
  if (!raw) return NextResponse.json({ error: "The explanation came back in an unexpected format." }, { status: 502 });

  const value = verify(raw, cands);
  cache.set(cacheKey, { at: Date.now(), value });
  return NextResponse.json(value);
}

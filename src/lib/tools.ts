import { comparePlans, rankResults, type PlanFilter } from "./engine";
import { SCENARIOS, type Scenario } from "./rank";
import { FIELDS, nextStep } from "./tree";

// The tools an agent can call. The same list backs the MCP endpoint and the plain REST endpoint.

export const INSTRUCTIONS = [
  "healthplan-compare compares Colorado individual-market (ACA) health plans for people under 65, using the public CMS 2026 plan data.",
  "How to use it:",
  "1. Call next_question with whatever the user has already told you (an empty object to start). Never ask for a field you already have.",
  "2. If it returns status 'ask', put the questions to the user in ONE short message, then call next_question again with all answers so far. Repeat until status is 'ready'. If it returns 'stop', explain the message and end.",
  "3. Call rank_plans with the same answers to get ranked plans. Use compare_plans when the user is weighing specific plans. Pass the same answers object every time; the tools keep no state.",
  "Do not ask whether the user has other coverage. If they say they are on Medicare or Medicaid, pass coverage: 'medicare' or 'medicaid' and the tool will stop with an explanation.",
  "Rules: This is educational cost estimation. Do not recommend a plan, give medical or financial advice, or say what the user should buy; describe the tradeoffs and let them decide.",
  "Only quote dollar figures that the tools return, exactly as returned, and say whether each is per month or per year. Do not do your own premium or cost arithmetic. If asked for a number the tools did not return, say it is not available.",
  "Always pass on the caveats the tools return. Check priceBasis: when it says 'after estimated premium tax credit', say the prices include an estimated credit (and explain it from subsidyEstimate, including any cost-sharing reduction on Silver plans); when it says 'before any premium tax credit', say prices are before subsidies. Costs assume in-network care.",
  "Treat the household details the user gives you (ages, children, ZIP code, income, health needs) as private: use them only for this task and do not save them to long-term memory unless the user asks you to.",
  "When rank_plans or compare_plans returns, its first content block is a formatted markdown answer (tables with plan names, units and caveats). Show those tables to the user first, as returned, then add a short plain-language summary of the tradeoffs. Do not re-type the figures into another layout or leave the tables out; use the JSON block for follow-up questions.",
  "Explain tradeoffs between the views: premium only, light year, managing a condition, big year, and worst case. The cheapest plan changes between them, which is the point.",
].join("\n");

// Neutral API description, served on GET /mcp, /llms.txt and /api/engine/<tool> and published at docs/llms.txt.
// It documents the endpoints; the rules for presenting results travel with the tools (INSTRUCTIONS, usageRules).
export function apiDocs(origin: string): string {
  const fields = FIELDS.map((f) => `- ${f.name} (${f.type}): ${f.ask}${f.example ? ` Example: ${f.example}` : ""}`);
  return [
    "# Colorado health plan compare: API description",
    "",
    "A free, public tool that prices and compares Colorado individual-market (ACA) health plans for people under 65, from the CMS 2026 plan data.",
    "It exposes three stateless tools over MCP and plain REST. No login or key is needed.",
    "",
    "## Endpoints",
    `REST: POST ${origin}/api/engine/<tool> with a JSON body (Content-Type: application/json).`,
    `REST by GET, for clients that can only fetch URLs: ${origin}/api/engine/<tool>/<field>/<value>/<field>/<value>/..., where each answer field below is a path pair (children_ages and plan_ids are comma-separated; use none for no spouse or to skip income). The same fields also work as a query string (?field=value&...), but some fetch tools drop query strings, so prefer the path form. rank_plans also takes sort, limit, metal, type, insurer, hsa_only and max_monthly_premium. A finished rank_plans or compare_plans GET returns formatted markdown tables (add format/json for the raw figures); an unfinished one returns the next questions plus a continueUrl that already carries the answers so far.`,
    `MCP (streamable HTTP, stateless JSON-RPC 2.0): POST ${origin}/mcp with the methods initialize, tools/list and tools/call.`,
    "",
    "## Tools",
    "- next_question: takes the answers collected so far and returns the next questions to ask (status 'ask'), a reason the tool does not apply (status 'stop'), or status 'ready'.",
    "- rank_plans: takes answers (optionally sort, limit, filter) and returns the best plan under five views of a year plus a ranked list, with an estimated premium tax credit when income is given.",
    "- compare_plans: takes answers and plan_ids and returns the plans side by side with exact differences.",
    "The tools keep no state: every call carries the full 'answers' object.",
    "",
    "## The answers object",
    ...fields,
    "",
    "## Example",
    `curl -s -X POST ${origin}/api/engine/next_question -H "Content-Type: application/json" -d '{"answers":{}}'`,
    `${origin}/api/engine/rank_plans/age/40/spouse_age/38/children_ages/5,7,9/zip/80202/household_income/90000/expected_care/ongoing`,
    "",
    "## About the results",
    "Every response carries its caveats and usageRules. The figures are educational estimates, not advice or a recommendation of any plan.",
  ].join("\n");
}

const answersSchema = {
  type: "object",
  description:
    "Everything learned about the household so far. Use these exact keys and omit the ones not yet known. Use null for 'none' only where noted.",
  properties: Object.fromEntries(
    FIELDS.map((f) => [
      f.name,
      {
        description: [f.ask, f.example && `Example: ${f.example}`].filter(Boolean).join(" "),
        ...(f.allowed ? { enum: f.allowed } : {}),
      },
    ]),
  ),
  additionalProperties: false,
};

const SCENARIO_KEYS = SCENARIOS.map((s) => s.key);

// Short presentation rules attached to every result, so they reach the assistant whichever way it calls the tools.
export const USAGE_RULES = [
  "Educational estimate only: do not recommend a plan or give medical or financial advice.",
  "Quote dollar figures exactly as returned and say whether each is per month or per year; do not do your own cost arithmetic.",
  "Pass on the caveats in this result.",
  "Show the markdown tables in `presentation` to the user first, as returned, then summarise the tradeoffs in a few sentences.",
  "Treat the household details as private and do not save them to long-term memory unless the user asks.",
];

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
};

const asArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : undefined;

function parseFilter(v: unknown): PlanFilter {
  const f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    metal: asArray(f.metal),
    type: asArray(f.type),
    insurer: typeof f.insurer === "string" ? f.insurer : undefined,
    hsa_only: f.hsa_only === true,
    max_monthly_premium: typeof f.max_monthly_premium === "number" ? f.max_monthly_premium : undefined,
  };
}

export const TOOLS: Tool[] = [
  {
    name: "next_question",
    description:
      "Start here. Given the answers collected so far, returns the next questions to ask the user (status 'ask'), a reason to stop (status 'stop', e.g. the user is on Medicare), or status 'ready' when rank_plans can run. Also reports invalid answers in 'issues'. Ask only the questions returned.",
    inputSchema: { type: "object", properties: { answers: answersSchema }, additionalProperties: false },
    run: (args) => nextStep(args.answers),
  },
  {
    name: "rank_plans",
    description:
      "Ranks Colorado plans sold in the household's county by yearly cost under five views: premium only, light year, managing a condition, big year and worst case. Returns the best plan for each view and a ranked list led by the view that matches the user's expected care. When household_income is in the premium-credit range it also estimates the 2026 premium tax credit and returns prices after it (plus before-credit figures). If the intake is not finished it returns the next question instead. Optional filter narrows by metal level, plan type, insurer, HSA eligibility or maximum monthly premium.",
    inputSchema: {
      type: "object",
      properties: {
        answers: answersSchema,
        sort: { type: "string", enum: SCENARIO_KEYS, description: "View to rank by. Defaults to the one matching expected_care." },
        limit: { type: "integer", minimum: 1, maximum: 15, description: "How many plans to return (default 5)." },
        filter: {
          type: "object",
          properties: {
            metal: { type: "array", items: { type: "string" }, description: "e.g. Bronze, Silver, Gold, Platinum, Expanded Bronze" },
            type: { type: "array", items: { type: "string" }, description: "e.g. HMO, PPO, EPO" },
            insurer: { type: "string" },
            hsa_only: { type: "boolean" },
            max_monthly_premium: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      required: ["answers"],
      additionalProperties: false,
    },
    run: (args) =>
      rankResults(args.answers, {
        sort: SCENARIO_KEYS.includes(args.sort as Scenario) ? (args.sort as Scenario) : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        filter: parseFilter(args.filter),
      }),
  },
  {
    name: "compare_plans",
    description:
      "Side-by-side numbers for specific plans (ids from rank_plans), with exact differences from the first plan in premium, deductible, out-of-pocket maximum and each yearly view. Use it for follow-up questions like 'how much more is plan B than plan A in a bad year'.",
    inputSchema: {
      type: "object",
      properties: {
        answers: answersSchema,
        plan_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      },
      required: ["answers", "plan_ids"],
      additionalProperties: false,
    },
    run: (args) => comparePlans(args.answers, asArray(args.plan_ids) ?? []),
  },
];

const NONE = /^(null|none)$/i;
const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

// Flat query parameters become the same arguments as the POST body, for clients that can only fetch URLs.
export function queryArgs(sp: URLSearchParams): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = sp.get(f.name);
    if (v === null) continue;
    // "none" means no spouse or no income, and for children it means an empty list
    answers[f.name] = NONE.test(v) ? (f.name === "children_ages" ? [] : null) : v;
  }
  const filter: Record<string, unknown> = {};
  if (sp.has("metal")) filter.metal = list(sp.get("metal")!);
  if (sp.has("type")) filter.type = list(sp.get("type")!);
  if (sp.has("insurer")) filter.insurer = sp.get("insurer");
  if (sp.get("hsa_only") === "true") filter.hsa_only = true;
  if (sp.has("max_monthly_premium")) filter.max_monthly_premium = Number(sp.get("max_monthly_premium"));
  return {
    answers,
    sort: sp.get("sort") ?? undefined,
    limit: sp.has("limit") ? Number(sp.get("limit")) : undefined,
    plan_ids: sp.has("plan_ids") ? list(sp.get("plan_ids")!) : undefined,
    filter,
  };
}

export function callTool(name: string, args: unknown): { ok: true; result: unknown } | { ok: false; error: string } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    const result = tool.run(args && typeof args === "object" ? (args as Record<string, unknown>) : {});
    return { ok: true, result: result && typeof result === "object" ? { ...result, usageRules: USAGE_RULES } : result };
  } catch (e) {
    console.error("tool failed", name, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "The tool failed. Check the arguments and try again." };
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

// rank_plans nests its payload under `result`; compare_plans carries it at the top level.
export function presentationOf(r: unknown): string | undefined {
  if (!isObj(r)) return undefined;
  const inner = isObj(r.result) ? r.result : r;
  return typeof inner.presentation === "string" ? inner.presentation : undefined;
}

function withoutPresentation(r: Obj): Obj {
  const strip = ({ presentation: _p, ...rest }: Obj) => rest;
  return isObj(r.result) ? { ...r, result: strip(r.result) } : strip(r);
}

// MCP content: the formatted tables first, so a client that shows only the first block still shows a clean answer,
// then the JSON for follow-up calls (plan ids, exact figures).
export function mcpContent(result: unknown): { type: "text"; text: string }[] {
  const md = presentationOf(result);
  if (md && isObj(result)) return [{ type: "text", text: md }, { type: "text", text: JSON.stringify(withoutPresentation(result)) }];
  return [{ type: "text", text: JSON.stringify(result) }];
}

// GET URLs are written as path segments (/api/engine/<tool>/age/40/zip/80202/), not query strings: some assistants'
// fetch tools drop query strings they build themselves but keep the path.
const seg = (k: string, v: string) => `${encodeURIComponent(k)}/${encodeURIComponent(v).replace(/%2C/gi, ",")}/`;

// A URL that carries the answers collected so far, ending where the next field/value pair can be appended.
export function continueUrl(origin: string, tool: string, collected: unknown): string {
  let path = "";
  if (isObj(collected)) {
    for (const [k, v] of Object.entries(collected)) {
      if (v === undefined) continue;
      path += seg(k, v === null ? "none" : Array.isArray(v) ? (v.length ? v.join(",") : "none") : String(v));
    }
  }
  return `${origin}/api/engine/${tool}/${path}`;
}

function compareUrl(origin: string, search: URLSearchParams, ids: string[]): string {
  let path = "";
  for (const f of FIELDS) if (search.has(f.name)) path += seg(f.name, search.get(f.name)!);
  return `${origin}/api/engine/compare_plans/${path}${seg("plan_ids", ids.join(","))}`;
}

// What a GET returns: the formatted markdown for finished rankings, JSON (with a continueUrl) for questions.
export function getBody(origin: string, tool: string, result: unknown, search: URLSearchParams): { body: string; type: string } {
  const md = presentationOf(result);
  if (md && search.get("format") !== "json" && isObj(result)) {
    const rules = Array.isArray(result.usageRules) ? (result.usageRules as string[]) : [];
    const ids = isObj(result.result) && Array.isArray(result.result.plans) ? (result.result.plans as { id: string }[]).slice(0, 3).map((p) => p.id) : [];
    return {
      type: "text/markdown; charset=utf-8",
      body: [
        md,
        ...(ids.length > 1 ? ["", `Compare the top ${ids.length}: ${compareUrl(origin, search, ids)}`] : []),
        `Raw figures as JSON: add format/json to this request's URL.`,
        "",
        "**Usage rules for this tool:**",
        ...rules.map((r) => `- ${r}`),
      ].join("\n"),
    };
  }
  const out = isObj(result) && result.status === "ask" ? { ...result, continueUrl: continueUrl(origin, tool, result.collected) } : result;
  return { type: "application/json", body: JSON.stringify(out) };
}

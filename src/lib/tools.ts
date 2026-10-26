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
  "Explain tradeoffs between the views: premium only, light year, managing a condition, big year, and worst case. The cheapest plan changes between them, which is the point.",
].join("\n");

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

export function callTool(name: string, args: unknown): { ok: true; result: unknown } | { ok: false; error: string } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    return { ok: true, result: tool.run(args && typeof args === "object" ? (args as Record<string, unknown>) : {}) };
  } catch (e) {
    console.error("tool failed", name, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "The tool failed. Check the arguments and try again." };
  }
}

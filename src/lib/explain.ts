import { planLabel, usd } from "./format";
import { householdSize, SCENARIOS, sortBy, type Household, type Ranked } from "./rank";

export const FIELDS = [
  "monthly_premium",
  "annual_premium",
  "deductible",
  "max_out_of_pocket",
  "total_light",
  "total_condition",
  "total_big",
  "total_worst",
] as const;

export type Candidate = { label: string; row: Ranked };

export type Claim = { plan: string; field: string; compare_plan: string; compare_field: string; value: number };
export type RawPoint = { scenario: string; text: string; claims: Claim[] };
export type RawExplanation = { summary: string; points: RawPoint[]; caveat: string };

export type CheckedPoint = {
  scenario: string;
  text: string;
  status: "verified" | "flagged" | "blocked";
  problems: string[];
};
export type Explanation = {
  summary: { text: string; problems: string[] };
  points: CheckedPoint[];
  caveat: string;
  stats: { claims: number; verified: number; failed: number };
};

export function fieldValue(r: Ranked, f: string): number | null {
  switch (f) {
    case "monthly_premium":
      return r.monthly;
    case "annual_premium":
      return r.totals.premium;
    case "deductible":
      return r.deductible;
    case "max_out_of_pocket":
      return r.moop;
    case "total_light":
      return r.totals.light;
    case "total_condition":
      return r.totals.condition;
    case "total_big":
      return r.totals.big;
    case "total_worst":
      return r.totals.worst;
    default:
      return null;
  }
}

// The plans Muse may talk about: the top three for each kind of year, at most 10, labelled P1..Pn.
export function pickCandidates(rows: Ranked[]): Candidate[] {
  const seen = new Map<string, Ranked>();
  for (const s of SCENARIOS) {
    for (const r of sortBy(rows, s.key).slice(0, 3)) if (r.totals[s.key] !== null) seen.set(r.plan.id, r);
  }
  return [...seen.values()].slice(0, 10).map((row, i) => ({ label: `P${i + 1}`, row }));
}

export const EXPLAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "points", "caveat"],
  properties: {
    summary: { type: "string", description: "Two sentences, no dollar figures." },
    caveat: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scenario", "text", "claims"],
        properties: {
          scenario: { type: "string", enum: [...SCENARIOS.map((s) => s.key), "overall"] },
          text: { type: "string" },
          claims: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["plan", "field", "compare_plan", "compare_field", "value"],
              properties: {
                plan: { type: "string", description: "Plan label such as P1" },
                field: { type: "string", enum: [...FIELDS] },
                compare_plan: { type: "string", description: 'Label to subtract, or "" for none' },
                compare_field: { type: "string", enum: [...FIELDS, "none"] },
                value: { type: "number", description: "Whole dollars. For a difference, the absolute difference." },
              },
            },
          },
        },
      },
    },
  },
} as const;

const num = (n: number | null) => (n === null ? "n/a" : String(Math.round(n)));

export function buildMessages(household: Household, county: string, cands: Candidate[]) {
  const size = householdSize(household);
  const plans = cands
    .map(({ label, row: r }) =>
      [
        `${label}: ${planLabel(r.plan)} (${r.plan.metal}, ${r.plan.type})`,
        `  monthly_premium=${num(r.monthly)} annual_premium=${num(r.totals.premium)}`,
        `  deductible=${num(r.deductible)} max_out_of_pocket=${num(r.moop)}`,
        `  total_light=${num(r.totals.light)} total_condition=${num(r.totals.condition)}`,
        `  total_big=${num(r.totals.big)} total_worst=${num(r.totals.worst)}`,
      ].join("\n"),
    )
    .join("\n");

  const system = [
    "You explain ACA health plan cost tradeoffs for an educational cost-estimator website.",
    "Rules:",
    "- Educational only. Never give medical advice, never comment on anyone's health, and never tell the user which plan to buy or enroll in. Describe tradeoffs and let the user decide.",
    "- Use only the plans and numbers provided. Refer to plans by their name; do not invent plans or numbers.",
    "- Every dollar figure in your text must be a whole-dollar number copied exactly from the data, or a difference between two data values, and must appear as a claim in that point's claims list (plan label, field, value). For a difference, set compare_plan and compare_field and put the absolute difference in value. Otherwise use compare_plan \"\" and compare_field \"none\".",
    "- The summary must contain no dollar figures.",
    "- Format dollar figures like $12,345.",
    "- Write 3 to 5 points. Cover how the best plan changes between a light year and a bad year, and the premium-versus-risk tradeoff.",
    "- The caveat must say these are estimates before subsidies, in-network only, and based on standard scenarios for one person.",
    "Scenario meanings: light = premium plus about $500 of routine care per person; condition = premium plus the plan's standard managing-a-chronic-condition scenario; big = premium plus the plan's standard having-a-baby scenario; worst = premium plus the plan's maximum out-of-pocket limit.",
  ].join("\n");

  const user = [
    `Household: ${size} ${size === 1 ? "person" : "people"} (${household.adults.length} adult${household.adults.length > 1 ? "s" : ""}, ${household.children.length} children), ${county} County, Colorado, 2026 plans, all amounts per year unless named monthly.`,
    "Plans:",
    plans,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const FIGURE = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const ADVICE =
  /\b(you should (buy|choose|pick|enroll|select|get)|i recommend|we recommend|best choice for you|go with|sign up for)\b/i;
const TOLERANCE = 1;

export const figuresIn = (text: string): number[] =>
  [...text.matchAll(FIGURE)].map((m) => Number(m[1].replace(/,/g, "")));

// Recomputes every claim from the server-side plan data, then checks that each dollar figure in the
// prose is backed by a verified claim.
export function verify(raw: RawExplanation, cands: Candidate[]): Explanation {
  const byLabel = new Map(cands.map((c) => [c.label, c.row]));
  let claims = 0;
  let verified = 0;

  const checkClaim = (c: Claim): { ok: boolean; problem?: string } => {
    claims++;
    const a = byLabel.get(c.plan);
    const av = a ? fieldValue(a, c.field) : null;
    if (av === null) return { ok: false, problem: `${c.plan} ${c.field} is not in the data` };
    let actual = av;
    if (c.compare_plan) {
      const b = byLabel.get(c.compare_plan);
      const bv = b ? fieldValue(b, c.compare_field) : null;
      if (bv === null) return { ok: false, problem: `${c.compare_plan} ${c.compare_field} is not in the data` };
      actual = Math.abs(av - bv);
    }
    if (Math.abs(actual - c.value) > TOLERANCE) {
      return { ok: false, problem: `said ${usd(c.value)} but the data says ${usd(Math.round(actual))}` };
    }
    verified++;
    return { ok: true };
  };

  // Plan names can contain dollar amounts ("Bronze $8500 Medical Deductible"); those are labels, not claims.
  const names = cands.flatMap((c) => [c.row.plan.name, planLabel(c.row.plan)]).sort((a, b) => b.length - a.length);
  const scrub = (text: string) => names.reduce((t, n) => t.split(n).join(" "), text);

  const checkText = (text: string, good: number[]): string[] =>
    figuresIn(scrub(text))
      .filter((n) => !good.some((g) => Math.abs(g - n) <= TOLERANCE))
      .map((n) => `${usd(n)} is not backed by a checked figure`);

  // Muse refers to plans as P1..Pn; swap in readable names once the figures have been checked.
  const named = (text: string) =>
    text.replace(/\bP\d{1,2}\b/g, (m) => {
      const r = byLabel.get(m);
      return r ? planLabel(r.plan) : m;
    });

  const allGood: number[] = [];
  const points: CheckedPoint[] = raw.points.map((p) => {
    const problems: string[] = [];
    const good: number[] = [];
    for (const c of p.claims) {
      const r = checkClaim(c);
      if (r.ok) good.push(c.value);
      else problems.push(r.problem!);
    }
    problems.push(...checkText(p.text, good));
    allGood.push(...good);
    if (ADVICE.test(p.text)) {
      return {
        scenario: p.scenario,
        text: "",
        status: "blocked" as const,
        problems: ["Removed: sounded like a recommendation."],
      };
    }
    return {
      scenario: p.scenario,
      text: named(p.text),
      status: problems.length ? ("flagged" as const) : ("verified" as const),
      problems,
    };
  });

  return {
    summary: {
      text: ADVICE.test(raw.summary) ? "" : named(raw.summary),
      problems: checkText(raw.summary, allGood),
    },
    points,
    caveat: raw.caveat,
    stats: { claims, verified, failed: claims - verified },
  };
}

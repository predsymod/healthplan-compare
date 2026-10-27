import { loadState } from "./data";
import { lookupZip, type ZipCounty } from "./geo";

// The intake decision tree. Each node collects a few fields; edges pick the next node from what is known.
// The tree decides what to ask next, so an agent only has to relay the questions and the answers.

export type Care = "little" | "ongoing" | "major" | "unsure";
export type Coverage = "none" | "employer" | "medicare" | "medicaid";

export type Answers = {
  coverage?: Coverage;
  age?: number;
  spouse_age?: number | null;
  children_ages?: number[];
  zip?: string;
  county_fips?: string;
  tobacco?: boolean;
  household_income?: number | null;
  expected_care?: Care;
};

export type Issue = { field: string; problem: string };

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

type FieldDef = {
  name: keyof Answers;
  type: string;
  ask: string;
  allowed?: string[];
  example?: string;
  parse: (v: unknown) => Parsed<unknown>;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): Parsed<T> =>
  typeof v === "string" && (values as readonly string[]).includes(v.trim().toLowerCase())
    ? { ok: true, value: v.trim().toLowerCase() as T }
    : { ok: false, problem: `must be one of: ${values.join(", ")}` };

const COVERAGE = ["none", "employer", "medicare", "medicaid"] as const;
const CARE = ["little", "ongoing", "major", "unsure"] as const;

export const FIELDS: FieldDef[] = [
  {
    name: "coverage",
    type: "choice",
    ask: "Optional, never asked: only set it if the user says they are on Medicare or Medicaid, so the tool can stop.",
    allowed: [...COVERAGE],
    example: "medicare, medicaid, employer or none",
    parse: oneOf(COVERAGE),
  },
  {
    name: "age",
    type: "whole number",
    ask: "How old is the main applicant?",
    example: "45",
    parse: (v) => {
      const n = num(v);
      return n !== null && Number.isInteger(n) && n >= 18 && n <= 120
        ? { ok: true, value: n }
        : { ok: false, problem: "must be a whole-number age of 18 or older" };
    },
  },
  {
    name: "spouse_age",
    type: "whole number or null",
    ask: "Is a spouse or partner on the plan? If so, their age; otherwise null.",
    example: "43, or null for none",
    parse: (v) => {
      if (v === null) return { ok: true, value: null };
      const n = num(v);
      return n !== null && Number.isInteger(n) && n >= 18 && n <= 64
        ? { ok: true, value: n }
        : { ok: false, problem: "must be null or a whole-number age from 18 to 64 (people 65+ are on Medicare, which is not covered)" };
    },
  },
  {
    name: "children_ages",
    type: "list of whole numbers",
    ask: "Are any children or other dependents on the plan? List their ages; use an empty list for none.",
    example: "[4, 6, 8], or [] for none",
    parse: (v) => {
      const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : null;
      if (!list) return { ok: false, problem: "must be a list of ages" };
      const ages = list.map(num);
      if (ages.some((a) => a === null || !Number.isInteger(a) || a < 0 || a > 25))
        return { ok: false, problem: "every age must be a whole number from 0 to 25" };
      if (ages.length > 8) return { ok: false, problem: "at most 8 dependents are supported" };
      return { ok: true, value: ages as number[] };
    },
  },
  {
    name: "zip",
    type: "5-digit ZIP",
    ask: "What is their Colorado home ZIP code?",
    example: "80202",
    parse: (v) => {
      const z = typeof v === "number" ? String(v).padStart(5, "0") : typeof v === "string" ? v.trim() : "";
      if (!/^\d{5}$/.test(z)) return { ok: false, problem: "must be a 5-digit ZIP code" };
      return lookupZip(loadState("co").zips, z)
        ? { ok: true, value: z }
        : { ok: false, problem: "is not a Colorado ZIP code this tool recognises (only Colorado is supported)" };
    },
  },
  {
    name: "county_fips",
    type: "county code",
    ask: "That ZIP code spans counties that are priced differently. Which county do they live in?",
    parse: (v) =>
      typeof v === "string" && /^\d{5}$/.test(v.trim())
        ? { ok: true, value: v.trim() }
        : { ok: false, problem: "must be one of the county codes offered" },
  },
  {
    name: "tobacco",
    type: "yes/no",
    ask: "Does anyone on the plan use tobacco? (Optional; defaults to no.)",
    parse: (v) => {
      if (typeof v === "boolean") return { ok: true, value: v };
      if (typeof v === "string" && /^(yes|true|y)$/i.test(v.trim())) return { ok: true, value: true };
      if (typeof v === "string" && /^(no|false|n)$/i.test(v.trim())) return { ok: true, value: false };
      return { ok: false, problem: "must be yes or no" };
    },
  },
  {
    name: "household_income",
    type: "dollars per year or null",
    ask: "What is the household's expected income this year (before tax, including all earners)? This only checks whether they might qualify for premium credits. They may skip it (null).",
    example: "85000, or null to skip",
    parse: (v) => {
      if (v === null) return { ok: true, value: null };
      const n = num(v);
      return n !== null && n >= 0 ? { ok: true, value: Math.round(n) } : { ok: false, problem: "must be a dollar amount or null" };
    },
  },
  {
    name: "expected_care",
    type: "choice",
    ask: "How much medical care do they expect this year? Pick the closest.",
    allowed: [...CARE],
    example: "little = checkups only; ongoing = a condition or regular prescriptions; major = surgery, a baby or a hospital stay; unsure",
    parse: oneOf(CARE),
  },
];

const BY_NAME = new Map(FIELDS.map((f) => [f.name, f]));

export function normalize(raw: unknown): { answers: Answers; issues: Issue[] } {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const answers: Record<string, unknown> = {};
  const issues: Issue[] = [];
  for (const f of FIELDS) {
    const v = src[f.name];
    if (v === undefined) continue;
    const r = f.parse(v);
    if (r.ok) answers[f.name] = r.value;
    else issues.push({ field: f.name, problem: r.problem });
  }
  return { answers: answers as Answers, issues };
}

// Counties of the ZIP that are priced differently (different rating areas); [] when no question is needed.
export function countyChoices(zip: string): ZipCounty[] {
  const counties = lookupZip(loadState("co").zips, zip) ?? [];
  return new Set(counties.map((c) => c.area)).size > 1 ? counties : [];
}

type Node = { id: string; title: string; instruction: string; fields: (keyof Answers)[] };

export const NODES: Node[] = [
  {
    id: "household",
    title: "Who needs coverage, and where?",
    instruction: "Collect everyone in one message, and take anything the user already said instead of asking again.",
    fields: ["age", "spouse_age", "children_ages", "zip"],
  },
  {
    id: "county",
    title: "Which county?",
    instruction: "Only asked when the ZIP spans counties with different prices.",
    fields: ["county_fips"],
  },
  {
    id: "income",
    title: "Could they qualify for premium credits?",
    instruction: "One question. It is fine for the user to skip it.",
    fields: ["household_income"],
  },
  {
    id: "care",
    title: "How much care do they expect?",
    instruction: "One question. It only decides which view of the results to lead with.",
    fields: ["expected_care"],
  },
];

export type Question = { field: string; type: string; ask: string; allowed?: string[]; example?: string };

export type Step =
  | { status: "ask"; node: { id: string; title: string; instruction: string }; questions: Question[]; issues: Issue[]; collected: Answers }
  | { status: "stop"; reason: string; message: string; collected: Answers }
  | { status: "ready"; collected: Answers; assumptions: string[] };

const q = (name: keyof Answers, extra?: Partial<Question>): Question => {
  const f = BY_NAME.get(name)!;
  return { field: f.name, type: f.type, ask: f.ask, allowed: f.allowed, example: f.example, ...extra };
};

// Walks the tree from the start with what is known and says what happens next.
export function nextStep(raw: unknown): Step {
  const { answers: a, issues } = normalize(raw);
  const ask = (id: string, names: (keyof Answers)[], extra?: Record<string, Partial<Question>>): Step => {
    const node = NODES.find((n) => n.id === id)!;
    const missing = names.filter((n) => a[n] === undefined);
    return {
      status: "ask",
      node: { id: node.id, title: node.title, instruction: node.instruction },
      questions: missing.map((n) => q(n, extra?.[n])),
      issues: issues.filter((i) => (names as string[]).includes(i.field)),
      collected: a,
    };
  };

  // The tool is for under-65 ACA shoppers, so coverage is never asked; it only matters if the user volunteers it.
  if (a.coverage === "medicare" || a.coverage === "medicaid") {
    return {
      status: "stop",
      reason: a.coverage,
      collected: a,
      message:
        a.coverage === "medicare"
          ? "This tool compares individual-market plans for people under 65. People on Medicare should use Medicare.gov or a licensed Medicare advisor."
          : "People enrolled in Medicaid (Health First Colorado) do not buy these plans. Contact Health First Colorado.",
    };
  }

  // household
  const household: (keyof Answers)[] = ["age", "spouse_age", "children_ages", "zip"];
  if (household.some((n) => a[n] === undefined)) return ask("household", household);
  if (a.age! >= 65) {
    return {
      status: "stop",
      reason: "medicare_age",
      collected: a,
      message: "People 65 and older are generally eligible for Medicare, which this tool does not cover.",
    };
  }

  // county, only when it changes the price
  const assumptions: string[] = [];
  const choices = countyChoices(a.zip!);
  if (choices.length && a.county_fips === undefined) {
    const s = ask("county", ["county_fips"], {
      county_fips: { allowed: choices.map((c) => c.fips), example: choices.map((c) => `${c.fips} = ${c.name} County`).join("; ") },
    });
    return s;
  }
  if (!choices.length) {
    const counties = lookupZip(loadState("co").zips, a.zip!)!;
    if (counties.length > 1) assumptions.push(`The ZIP spans several counties with the same pricing; ${counties[0].name} County was used for the plan list.`);
  }

  if (a.household_income === undefined) return ask("income", ["household_income"]);
  if (a.expected_care === undefined) return ask("care", ["expected_care"]);

  return { status: "ready", collected: a, assumptions };
}

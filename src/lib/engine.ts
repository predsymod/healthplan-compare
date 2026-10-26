import { loadState } from "./data";
import { lookupZip, pickCounty, serviceAreasFor } from "./geo";
import { planLabel } from "./format";
import { householdSize, rankPlans, SCENARIOS, sortBy, type Household, type Ranked, type Scenario } from "./rank";
import { screenSubsidy, type SubsidyScreen } from "./subsidy";
import { nextStep, type Answers, type Care } from "./tree";

// Prices every standard plan sold in the household's county. Used by the web page and by the agent tools.
export function rankFor(h: { household: Household; zip: string; countyFips?: string; tobacco: boolean }) {
  const { zips, plans, rates, serviceAreas } = loadState("co");
  const counties = lookupZip(zips, h.zip);
  const county = counties ? pickCounty(counties, h.countyFips) : null;
  const rows: Ranked[] = county
    ? rankPlans(plans, rates, {
        household: h.household,
        area: county.area,
        tobacco: h.tobacco,
        serviceAreaIds: serviceAreasFor(serviceAreas, county.fips),
      })
    : [];
  return { counties, county, rows };
}

const whole = (n: number | null) => (n === null ? null : Math.round(n));

export type PlanSummary = {
  id: string;
  name: string;
  insurer: string;
  metal: string;
  type: string;
  hsaEligible: boolean;
  monthlyPremium: number;
  deductible: number;
  maxOutOfPocket: number;
  perYear: Record<Scenario, number | null>;
};

export const summarize = (r: Ranked): PlanSummary => ({
  id: r.plan.id,
  name: planLabel(r.plan),
  insurer: r.plan.issuer,
  metal: r.plan.metal,
  type: r.plan.type,
  hsaEligible: r.plan.hsa,
  monthlyPremium: Math.round(r.monthly),
  deductible: Math.round(r.deductible),
  maxOutOfPocket: Math.round(r.moop),
  perYear: {
    premium: whole(r.totals.premium),
    light: whole(r.totals.light),
    condition: whole(r.totals.condition),
    big: whole(r.totals.big),
    worst: whole(r.totals.worst),
  },
});

export const SCENARIO_MEANING: Record<Scenario, string> = Object.fromEntries(
  SCENARIOS.map((s) => [s.key, `${s.label}: ${s.help}`]),
) as Record<Scenario, string>;

const CAVEATS = [
  "These are estimates for educational use, not advice or a recommendation of any plan.",
  "Premiums are before any premium tax credit or Colorado state subsidy.",
  "Costs assume in-network, covered care. Out-of-network care and uncovered services can cost more.",
  "Care scenarios (light, condition, big year) describe one person. If several family members have care, costs rise toward the worst case.",
  "No doctors, hospitals or prescriptions are checked against plan networks or drug lists.",
];

const HEADLINE: Record<Care, Scenario> = { little: "light", ongoing: "condition", major: "big", unsure: "worst" };

export type PlanFilter = {
  metal?: string[];
  type?: string[];
  insurer?: string;
  hsa_only?: boolean;
  max_monthly_premium?: number;
};

function applyFilter(rows: Ranked[], f: PlanFilter = {}): Ranked[] {
  const lower = (xs?: string[]) => (xs ?? []).map((x) => x.toLowerCase());
  const metals = lower(f.metal);
  const types = lower(f.type);
  return rows.filter(
    (r) =>
      (!metals.length || metals.includes(r.plan.metal.toLowerCase())) &&
      (!types.length || types.includes(r.plan.type.toLowerCase())) &&
      (!f.insurer || r.plan.issuer.toLowerCase().includes(f.insurer.toLowerCase())) &&
      (!f.hsa_only || r.plan.hsa) &&
      (f.max_monthly_premium === undefined || r.monthly <= f.max_monthly_premium),
  );
}

function householdOf(a: Answers): Household {
  return { adults: a.spouse_age ? [a.age!, a.spouse_age] : [a.age!], children: a.children_ages ?? [] };
}

export type RankResult = {
  household: { adults: number[]; children: number[]; size: number };
  location: { zip: string; county: string; ratingArea: number };
  planYear: string;
  source: string;
  plansAvailable: number;
  plansMatching: number;
  subsidyScreen: SubsidyScreen | null;
  leadWith: { scenario: Scenario; meaning: string };
  bestBy: Record<string, PlanSummary | null>;
  plans: PlanSummary[];
  scenarioMeanings: Record<string, string>;
  caveats: string[];
  assumptions: string[];
};

// Runs the whole pipeline for a finished intake. Returns the next question instead when the intake is incomplete.
export function rankResults(
  raw: unknown,
  opts: { sort?: Scenario; limit?: number; filter?: PlanFilter } = {},
): { status: "ready"; result: RankResult } | Exclude<ReturnType<typeof nextStep>, { status: "ready" }> {
  const step = nextStep(raw);
  if (step.status !== "ready") return step;
  const a = step.collected;
  const household = householdOf(a);
  const { county, rows } = rankFor({ household, zip: a.zip!, countyFips: a.county_fips, tobacco: a.tobacco ?? false });
  const { meta } = loadState("co");
  const lead = HEADLINE[a.expected_care ?? "unsure"];
  const sortKey = opts.sort ?? lead;
  const matching = applyFilter(rows, opts.filter);
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 15);

  const bestBy: Record<string, PlanSummary | null> = {};
  for (const s of SCENARIOS) {
    const top = sortBy(matching, s.key)[0];
    bestBy[s.key] = top ? summarize(top) : null;
  }

  return {
    status: "ready",
    result: {
      household: { ...household, size: householdSize(household) },
      location: { zip: a.zip!, county: county!.name, ratingArea: county!.area },
      planYear: meta.planYear,
      source: meta.source,
      plansAvailable: rows.length,
      plansMatching: matching.length,
      subsidyScreen: typeof a.household_income === "number" ? screenSubsidy(a.household_income, householdSize(household)) : null,
      leadWith: { scenario: sortKey, meaning: SCENARIO_MEANING[sortKey] },
      bestBy,
      plans: sortBy(matching, sortKey).slice(0, limit).map(summarize),
      scenarioMeanings: SCENARIO_MEANING,
      caveats: [...CAVEATS, meta.note].filter(Boolean),
      assumptions: step.assumptions,
    },
  };
}

// Side-by-side numbers for the plans the user is weighing, with the exact differences from the first plan.
export function comparePlans(raw: unknown, planIds: string[]) {
  const step = nextStep(raw);
  if (step.status !== "ready") return step;
  const a = step.collected;
  const { rows } = rankFor({ household: householdOf(a), zip: a.zip!, countyFips: a.county_fips, tobacco: a.tobacco ?? false });
  const byId = new Map(rows.map((r) => [r.plan.id, r]));
  const found = planIds.map((id) => byId.get(id)).filter((r): r is Ranked => !!r);
  const missing = planIds.filter((id) => !byId.has(id));
  const plans = found.map(summarize);
  const [base, ...rest] = plans;
  const differences = base
    ? rest.map((p) => ({
        plan: p.id,
        versus: base.id,
        monthlyPremiumDiff: p.monthlyPremium - base.monthlyPremium,
        deductibleDiff: p.deductible - base.deductible,
        maxOutOfPocketDiff: p.maxOutOfPocket - base.maxOutOfPocket,
        perYearDiff: Object.fromEntries(
          SCENARIOS.map((s) => [s.key, p.perYear[s.key] === null || base.perYear[s.key] === null ? null : p.perYear[s.key]! - base.perYear[s.key]!]),
        ),
      }))
    : [];
  return {
    status: "ready" as const,
    plans,
    differences,
    unknownPlanIds: missing,
    note: "Differences are the second plan minus the first plan; positive means it costs more.",
    caveats: CAVEATS,
  };
}

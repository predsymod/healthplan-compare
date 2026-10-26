import { loadState } from "./data";
import { lookupZip, pickCounty, serviceAreasFor } from "./geo";
import { planLabel } from "./format";
import { householdSize, rankPlans, SCENARIOS, sortBy, type Household, type Ranked, type Scenario } from "./rank";
import { estimateCredit, screenSubsidy, type SubsidyScreen } from "./subsidy";
import { nextStep, type Answers, type Care } from "./tree";

// Prices every standard plan sold in the household's county. Used by the web page and by the agent tools.
export function rankFor(h: { household: Household; zip: string; countyFips?: string; tobacco: boolean; csr?: 73 | 87 | 94 }) {
  const { zips, plans, rates, serviceAreas } = loadState("co");
  const counties = lookupZip(zips, h.zip);
  const county = counties ? pickCounty(counties, h.countyFips) : null;
  const rows: Ranked[] = county
    ? rankPlans(plans, rates, {
        household: h.household,
        area: county.area,
        tobacco: h.tobacco,
        serviceAreaIds: serviceAreasFor(serviceAreas, county.fips),
        csr: h.csr,
      })
    : [];
  return { counties, county, rows };
}

const whole = (n: number | null) => (n === null ? null : Math.round(n));
const wholeAll = (t: Record<Scenario, number | null>) =>
  ({ premium: whole(t.premium), light: whole(t.light), condition: whole(t.condition), big: whole(t.big), worst: whole(t.worst) }) as Record<Scenario, number | null>;

export type PlanSummary = {
  id: string;
  name: string;
  insurer: string;
  metal: string;
  type: string;
  costSharingVariant: string | null;
  hsaEligible: boolean;
  monthlyPremium: number;
  monthlyPremiumBeforeCredit: number;
  estimatedMonthlyCredit: number;
  deductible: number;
  maxOutOfPocket: number;
  perYear: Record<Scenario, number | null>;
  perYearBeforeCredit: Record<Scenario, number | null>;
};

export const summarize = (r: Ranked): PlanSummary => {
  const csr = /^(\d+)% AV/.exec(r.plan.variant);
  return {
    id: r.plan.id,
    name: planLabel(r.plan),
    insurer: r.plan.issuer,
    metal: r.plan.metal,
    type: r.plan.type,
    costSharingVariant: csr ? `${csr[1]}% cost-sharing reduction` : null,
    hsaEligible: r.plan.hsa,
    monthlyPremium: Math.round(r.monthly),
    monthlyPremiumBeforeCredit: Math.round(r.credit?.grossMonthly ?? r.monthly),
    estimatedMonthlyCredit: Math.round((r.credit?.annual ?? 0) / 12),
    deductible: Math.round(r.deductible),
    maxOutOfPocket: Math.round(r.moop),
    perYear: wholeAll(r.totals),
    perYearBeforeCredit: wholeAll(r.credit?.grossTotals ?? r.totals),
  };
};

export const SCENARIO_MEANING: Record<Scenario, string> = Object.fromEntries(
  SCENARIOS.map((s) => [s.key, `${s.label}: ${s.help}`]),
) as Record<Scenario, string>;

const caveats = (credited: boolean) => [
  "These are estimates for educational use, not advice or a recommendation of any plan.",
  credited
    ? "Prices are after an ESTIMATED premium tax credit. The real credit depends on final modified adjusted gross income, any job-based coverage offer, and who is on the tax return, and it is settled when you file taxes. Colorado state subsidies are not included."
    : "Premiums are before any premium tax credit or Colorado state subsidy.",
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

export type SubsidyEstimate = {
  benchmarkPlan: string;
  benchmarkMonthlyPremium: number;
  applicablePercent: number;
  expectedMonthlyContribution: number;
  estimatedMonthlyCredit: number;
  costSharingReduction: { level: number; note: string } | null;
  howItWorks: string;
};

type Priced = {
  county: ReturnType<typeof rankFor>["county"];
  rows: Ranked[];
  screen: SubsidyScreen | null;
  estimate: SubsidyEstimate | null;
};

// Prices the household. With an income in the credit range it also estimates the premium tax credit, applies it
// to every plan, and swaps Silver plans for their cost-sharing-reduction variant where the household qualifies.
function priced(a: Answers): Priced {
  const household = householdOf(a);
  const tobacco = a.tobacco ?? false;
  const args = { household, zip: a.zip!, countyFips: a.county_fips, tobacco };
  const plain = rankFor(args);
  const size = householdSize(household);
  const screen = typeof a.household_income === "number" ? screenSubsidy(a.household_income, size) : null;
  if (!a.household_income || screen?.band !== "subsidy_range") return { county: plain.county, rows: plain.rows, screen, estimate: null };

  // The benchmark is the second-lowest-cost Silver plan, priced without any tobacco surcharge.
  const base = tobacco ? rankFor({ ...args, tobacco: false }).rows : plain.rows;
  const silvers = base.filter((r) => r.plan.metal === "Silver").sort((x, y) => x.monthly - y.monthly);
  const bench = silvers[1] ?? silvers[0];
  const est = bench ? estimateCredit(a.household_income, size, bench.totals.premium!) : null;
  if (!bench || !est) return { county: plain.county, rows: plain.rows, screen, estimate: null };

  const shown = est.csr ? rankFor({ ...args, csr: est.csr }).rows : plain.rows;
  const rows = shown.map((r): Ranked => {
    const c = Math.min(est.annualCredit, r.totals.premium ?? 0);
    const net = Object.fromEntries(
      Object.entries(r.totals).map(([k, v]) => [k, v === null ? null : v - c]),
    ) as Record<Scenario, number | null>;
    return { ...r, monthly: r.monthly - c / 12, totals: net, credit: { annual: c, grossMonthly: r.monthly, grossTotals: r.totals } };
  });

  return {
    county: plain.county,
    rows,
    screen,
    estimate: {
      benchmarkPlan: planLabel(bench.plan),
      benchmarkMonthlyPremium: Math.round(bench.monthly),
      applicablePercent: est.applicablePercent,
      expectedMonthlyContribution: Math.round(est.expectedAnnualContribution / 12),
      estimatedMonthlyCredit: Math.round(est.annualCredit / 12),
      costSharingReduction: est.csr
        ? {
            level: est.csr,
            note: `At this income, Silver plans come with extra cost-sharing reductions (${est.csr}% actuarial value): lower deductibles and out-of-pocket limits. The Silver plans listed are those versions. Bronze and Gold plans do not get them.`,
          }
        : null,
      howItWorks:
        "Estimated credit = the benchmark premium (second-lowest-cost Silver plan in the county for this household) minus an expected contribution of the applicable percentage of income (2026 table, IRS Rev. Proc. 2025-25). The credit can lower any plan's premium, but never below zero.",
    },
  };
}

export type RankResult = {
  household: { adults: number[]; children: number[]; size: number };
  location: { zip: string; county: string; ratingArea: number };
  planYear: string;
  source: string;
  plansAvailable: number;
  plansMatching: number;
  priceBasis: "after estimated premium tax credit" | "before any premium tax credit";
  subsidyScreen: SubsidyScreen | null;
  subsidyEstimate: SubsidyEstimate | null;
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
  const { county, rows, screen, estimate } = priced(a);
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
  const household = householdOf(a);

  return {
    status: "ready",
    result: {
      household: { ...household, size: householdSize(household) },
      location: { zip: a.zip!, county: county!.name, ratingArea: county!.area },
      planYear: meta.planYear,
      source: meta.source,
      plansAvailable: rows.length,
      plansMatching: matching.length,
      priceBasis: estimate ? "after estimated premium tax credit" : "before any premium tax credit",
      subsidyScreen: screen,
      subsidyEstimate: estimate,
      leadWith: { scenario: sortKey, meaning: SCENARIO_MEANING[sortKey] },
      bestBy,
      plans: sortBy(matching, sortKey).slice(0, limit).map(summarize),
      scenarioMeanings: SCENARIO_MEANING,
      caveats: [...caveats(!!estimate), meta.note].filter(Boolean),
      assumptions: step.assumptions,
    },
  };
}

// Side-by-side numbers for the plans the user is weighing, with the exact differences from the first plan.
export function comparePlans(raw: unknown, planIds: string[]) {
  const step = nextStep(raw);
  if (step.status !== "ready") return step;
  const { rows, estimate } = priced(step.collected);
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
    priceBasis: estimate ? "after estimated premium tax credit" : "before any premium tax credit",
    plans,
    differences,
    unknownPlanIds: missing,
    note: "Differences are the second plan minus the first plan; positive means it costs more.",
    caveats: caveats(!!estimate),
  };
}

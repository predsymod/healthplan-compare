export type Plan = {
  id: string;
  baseId: string;
  issuer: string;
  name: string;
  metal: string;
  variant: string;
  type: string;
  serviceAreaId: string;
  hsa: boolean;
  deductible: number | null; // combined medical + drug, when integrated
  medicalDeductible: number | null;
  drugDeductible: number | null;
  moop: number;
  familyDeductible: number | null;
  familyMedicalDeductible: number | null;
  familyDrugDeductible: number | null;
  familyMoop: number | null;
  sbcBabyDeductible: number | null;
  sbcBabyCopay: number | null;
  sbcBabyCoinsurance: number | null;
  sbcDiabetesDeductible: number | null;
  sbcDiabetesCopay: number | null;
  sbcDiabetesCoinsurance: number | null;
};

export type RateRow = {
  baseId: string;
  area: number;
  age: string;
  rate: number;
  tobaccoRate: number | null;
};

export type Scenario = "premium" | "light" | "condition" | "big" | "worst";

export const SCENARIOS: { key: Scenario; label: string; help: string }[] = [
  { key: "premium", label: "Premium only", help: "12 x monthly premium" },
  {
    key: "light",
    label: "Light year",
    help: "Premium plus routine care, assumed at up to $500 of your deductible",
  },
  {
    key: "condition",
    label: "Managing a condition",
    help: "Premium plus your cost in the plan's standard 'managing diabetes' scenario (about $5,600 of care)",
  },
  {
    key: "big",
    label: "Big year",
    help: "Premium plus your cost in the plan's standard 'having a baby' scenario (about $12,700 of care)",
  },
  {
    key: "worst",
    label: "Worst case",
    help: "Premium plus the plan's out-of-pocket maximum",
  },
];

export type Household = { adults: number[]; children: number[] };

export type Ranked = {
  plan: Plan;
  deductible: number;
  moop: number;
  monthly: number;
  totals: Record<Scenario, number | null>;
  // Set when an estimated premium tax credit has been applied: monthly and totals are then after the credit.
  credit?: { annual: number; grossMonthly: number; grossTotals: Record<Scenario, number | null> };
};

export function ageBand(age: number): string {
  if (age <= 14) return "0-14";
  if (age >= 64) return "64 and over";
  return String(age);
}

const sum = (...xs: (number | null)[]): number | null =>
  xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0);

// ACA rating: every adult is rated by age. Children under 21 are rated by age too,
// but only the three oldest are charged. A dependent aged 21+ is rated as an adult.
export function chargedAges(h: Household): number[] {
  const under21 = h.children.filter((a) => a < 21).sort((a, b) => b - a).slice(0, 3);
  const grownKids = h.children.filter((a) => a >= 21);
  return [...h.adults, ...grownKids, ...under21];
}

export function householdSize(h: Household): number {
  return h.adults.length + h.children.length;
}

export function rankPlans(
  plans: Plan[],
  rates: RateRow[],
  opts: {
    household: Household;
    area: number;
    tobacco: boolean;
    serviceAreaIds?: Set<string>;
    // When set, Silver plans are shown as their cost-sharing-reduction variant (73, 87 or 94) instead of Standard.
    csr?: 73 | 87 | 94;
  },
): Ranked[] {
  const ages = chargedAges(opts.household);
  const family = householdSize(opts.household) > 1;
  const members = Math.max(1, householdSize(opts.household));

  const byPlan = new Map<string, Map<string, number>>();
  for (const r of rates) {
    if (r.area !== opts.area) continue;
    const m = opts.tobacco && r.tobaccoRate != null ? r.tobaccoRate : r.rate;
    let bands = byPlan.get(r.baseId);
    if (!bands) byPlan.set(r.baseId, (bands = new Map()));
    if (!bands.has(r.age)) bands.set(r.age, m);
  }

  const out: Ranked[] = [];
  for (const plan of plans) {
    if (plan.metal === "Catastrophic") continue;
    const wanted =
      opts.csr && plan.metal === "Silver" ? plan.variant.startsWith(`${opts.csr}% AV`) : plan.variant.startsWith("Standard");
    if (!wanted) continue;
    if (opts.serviceAreaIds && !opts.serviceAreaIds.has(plan.serviceAreaId)) continue;
    const bands = byPlan.get(plan.baseId);
    if (!bands) continue;
    let monthly = 0;
    let complete = true;
    for (const a of ages) {
      const r = bands.get(ageBand(a));
      if (r === undefined) complete = false;
      else monthly += r;
    }
    if (!complete) continue;

    const premium = monthly * 12;
    const individualDed =
      plan.deductible ?? (plan.medicalDeductible ?? 0) + (plan.drugDeductible ?? 0);
    const familyDed =
      plan.familyDeductible ??
      (plan.familyMedicalDeductible ?? 0) + (plan.familyDrugDeductible ?? 0);
    const deductible = family && familyDed > 0 ? familyDed : family ? individualDed * 2 : individualDed;
    const moop = family ? (plan.familyMoop ?? plan.moop * 2) : plan.moop;

    // Scenario care is for one person; the per-person limit applies to them.
    const cap = (oop: number | null) => (oop === null ? null : Math.min(oop, plan.moop));
    const baby = cap(sum(plan.sbcBabyDeductible, plan.sbcBabyCopay, plan.sbcBabyCoinsurance));
    const diabetes = cap(
      sum(plan.sbcDiabetesDeductible, plan.sbcDiabetesCopay, plan.sbcDiabetesCoinsurance),
    );
    out.push({
      plan,
      deductible,
      moop,
      monthly,
      totals: {
        premium,
        light: premium + Math.min(deductible, 500 * members),
        condition: diabetes === null ? null : premium + diabetes,
        big: baby === null ? null : premium + baby,
        worst: premium + moop,
      },
    });
  }
  return out;
}

export function sortBy(rows: Ranked[], key: Scenario): Ranked[] {
  return [...rows].sort((a, b) => {
    const x = a.totals[key];
    const y = b.totals[key];
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  });
}

export function winners(rows: Ranked[]): Record<Scenario, Ranked | undefined> {
  const w = {} as Record<Scenario, Ranked | undefined>;
  for (const s of SCENARIOS) w[s.key] = sortBy(rows, s.key)[0];
  return w;
}

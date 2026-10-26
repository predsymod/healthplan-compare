export type Plan = {
  id: string;
  baseId: string;
  issuer: string;
  name: string;
  metal: string;
  variant: string;
  type: string;
  hsa: boolean;
  deductible: number | null; // combined medical + drug, when integrated
  medicalDeductible: number | null;
  drugDeductible: number | null;
  moop: number;
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

export type Ranked = {
  plan: Plan;
  deductible: number;
  monthly: number;
  totals: Record<Scenario, number | null>;
};

export function ageBand(age: number): string {
  if (age <= 14) return "0-14";
  if (age >= 64) return "64 and over";
  return String(age);
}

const sum = (...xs: (number | null)[]): number | null =>
  xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0);

export function rankPlans(
  plans: Plan[],
  rates: RateRow[],
  opts: { age: number; area: number; tobacco: boolean },
): Ranked[] {
  const band = ageBand(opts.age);
  const monthlyById = new Map<string, number>();
  for (const r of rates) {
    if (r.area !== opts.area || r.age !== band) continue;
    const m = opts.tobacco && r.tobaccoRate != null ? r.tobaccoRate : r.rate;
    if (!monthlyById.has(r.baseId)) monthlyById.set(r.baseId, m);
  }

  const out: Ranked[] = [];
  for (const plan of plans) {
    if (!plan.variant.startsWith("Standard") || plan.metal === "Catastrophic") continue;
    const monthly = monthlyById.get(plan.baseId);
    if (monthly === undefined) continue;
    const premium = monthly * 12;
    const deductible =
      plan.deductible ?? (plan.medicalDeductible ?? 0) + (plan.drugDeductible ?? 0);
    const cap = (oop: number | null) => (oop === null ? null : Math.min(oop, plan.moop));
    const baby = cap(sum(plan.sbcBabyDeductible, plan.sbcBabyCopay, plan.sbcBabyCoinsurance));
    const diabetes = cap(
      sum(plan.sbcDiabetesDeductible, plan.sbcDiabetesCopay, plan.sbcDiabetesCoinsurance),
    );
    out.push({
      plan,
      deductible,
      monthly,
      totals: {
        premium,
        light: premium + Math.min(deductible, 500),
        condition: diabetes === null ? null : premium + diabetes,
        big: baby === null ? null : premium + baby,
        worst: premium + plan.moop,
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

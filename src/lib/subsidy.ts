// Income screening and the premium tax credit estimate.
// Sources: Rev. Proc. 2025-25 (IRS) for the 2026 applicable percentage table and the 400% limit;
// the 2025 HHS poverty guidelines (48 states + DC), which set eligibility for 2026 coverage.
const FPL_BASE = 15650;
const FPL_PER_EXTRA = 5500;

// [lower FPL %, upper FPL %, initial %, final %] from Rev. Proc. 2025-25 section 3.01. The last band is capped at 400%.
const TABLE_2026: [number, number, number, number][] = [
  [0, 133, 2.1, 2.1],
  [133, 150, 3.14, 4.19],
  [150, 200, 4.19, 6.6],
  [200, 250, 6.6, 8.44],
  [250, 300, 8.44, 9.96],
  [300, 400, 9.96, 9.96],
];

export type SubsidyBand = "medicaid_likely" | "subsidy_range" | "above_limit";

export type SubsidyScreen = {
  band: SubsidyBand;
  fplPercent: number;
  fplAmount: number;
  message: string;
  basis: string;
};

export const fplFor = (size: number) => FPL_BASE + FPL_PER_EXTRA * (Math.max(1, size) - 1);

// Share of income a household is expected to put toward the benchmark plan, interpolated within its band.
export function applicablePercent(fplPercent: number): number | null {
  if (fplPercent > 400) return null;
  const row = TABLE_2026.find(([lo, hi]) => fplPercent >= lo && fplPercent < hi) ?? TABLE_2026[TABLE_2026.length - 1];
  const [lo, hi, a, b] = row;
  return a + ((b - a) * (fplPercent - lo)) / (hi - lo);
}

// Silver cost-sharing reductions: 94% up to 150% of poverty, 87% up to 200%, 73% up to 250%.
export function csrLevel(fplPercent: number): 73 | 87 | 94 | null {
  if (fplPercent <= 150) return 94;
  if (fplPercent <= 200) return 87;
  if (fplPercent <= 250) return 73;
  return null;
}

export function screenSubsidy(annualIncome: number, size: number): SubsidyScreen {
  const fplAmount = fplFor(size);
  const exact = (annualIncome / fplAmount) * 100;
  const fplPercent = Math.round(exact);
  const basis =
    "Based on the 2025 federal poverty guidelines ($" +
    fplAmount.toLocaleString("en-US") +
    " for a household of " +
    size +
    "), Colorado's 138% adult Medicaid limit, and the 2026 premium tax credit rules in IRS Rev. Proc. 2025-25 (credits end above 400% of poverty). Confirm with Connect for Health Colorado.";

  if (exact < 138) {
    return {
      band: "medicaid_likely",
      fplPercent,
      fplAmount,
      basis,
      message:
        "Adults at this income level are usually eligible for Health First Colorado (Medicaid), which this tool does not cover. Children may qualify for CHP+ at higher incomes. Check with Health First Colorado before buying a plan.",
    };
  }
  if (exact <= 400) {
    return {
      band: "subsidy_range",
      fplPercent,
      fplAmount,
      basis,
      message:
        "This income is in the range where a household can qualify for premium tax credits that lower the monthly premium.",
    };
  }
  return {
    band: "above_limit",
    fplPercent,
    fplAmount,
    basis,
    message:
      "This income is above the 400% limit for 2026 premium tax credits, so the prices shown are likely what you would pay. Income counted is modified adjusted gross income, so deductions such as retirement or HSA contributions can change the result.",
  };
}

export type CreditEstimate = {
  applicablePercent: number;
  expectedAnnualContribution: number;
  annualCredit: number;
  csr: 73 | 87 | 94 | null;
};

// Credit = benchmark (second-lowest-cost Silver) premium minus the expected contribution, never below zero.
export function estimateCredit(annualIncome: number, size: number, benchmarkAnnualPremium: number): CreditEstimate | null {
  const fpl = (annualIncome / fplFor(size)) * 100;
  const pct = applicablePercent(fpl);
  if (pct === null || fpl < 138) return null;
  const expected = (pct / 100) * annualIncome;
  return {
    applicablePercent: Math.round(pct * 100) / 100,
    expectedAnnualContribution: Math.round(expected),
    annualCredit: Math.max(0, Math.round(benchmarkAnnualPremium - expected)),
    csr: csrLevel(fpl),
  };
}

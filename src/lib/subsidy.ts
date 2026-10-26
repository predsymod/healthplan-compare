// Screening only: which income band a household falls in. This does not estimate the subsidy amount.
// 2025 HHS poverty guidelines (48 states + DC) set eligibility for 2026 marketplace coverage.
const FPL_BASE = 15650;
const FPL_PER_EXTRA = 5500;

export type SubsidyBand = "medicaid_likely" | "subsidy_range" | "above_limit";

export type SubsidyScreen = {
  band: SubsidyBand;
  fplPercent: number;
  fplAmount: number;
  message: string;
  basis: string;
};

export const fplFor = (size: number) => FPL_BASE + FPL_PER_EXTRA * (Math.max(1, size) - 1);

export function screenSubsidy(annualIncome: number, size: number): SubsidyScreen {
  const fplAmount = fplFor(size);
  const fplPercent = Math.round((annualIncome / fplAmount) * 100);
  const basis =
    "Based on the 2025 federal poverty guidelines ($" +
    fplAmount.toLocaleString("en-US") +
    " for a household of " +
    size +
    "), Colorado's 138% adult Medicaid limit, and the 400% premium-credit limit reported for 2026. Confirm with Connect for Health Colorado.";

  if (fplPercent < 138) {
    return {
      band: "medicaid_likely",
      fplPercent,
      fplAmount,
      basis,
      message:
        "Adults at this income level are usually eligible for Health First Colorado (Medicaid), which this tool does not cover. Children may qualify for CHP+ at higher incomes. Check with Health First Colorado before buying a plan.",
    };
  }
  if (fplPercent <= 400) {
    return {
      band: "subsidy_range",
      fplPercent,
      fplAmount,
      basis,
      message:
        "This income is in the range where a household can qualify for premium tax credits that lower the monthly premium. The prices shown here are before any credit, and the credit amount is not estimated yet.",
    };
  }
  return {
    band: "above_limit",
    fplPercent,
    fplAmount,
    basis,
    message:
      "This income is above the 400% limit reported for 2026 premium tax credits, so the prices shown are likely what you would pay. Income counted is modified adjusted gross income, so deductions such as retirement or HSA contributions can change the result.",
  };
}

import { describe, expect, it } from "vitest";
import { ageBand, chargedAges, rankPlans, sortBy, winners, type Plan, type RateRow } from "./rank";

const one = (age: number) => ({ adults: [age], children: [] as number[] });

const base: Plan = {
  id: "A-01", baseId: "A", issuer: "X", name: "A", metal: "Silver",
  variant: "Standard Silver On Exchange Plan", type: "PPO", hsa: false,
  deductible: 1000, medicalDeductible: null, drugDeductible: null, moop: 6000,
  familyDeductible: 2000, familyMedicalDeductible: null, familyDrugDeductible: null, familyMoop: 12000,
  sbcBabyDeductible: 1000, sbcBabyCopay: 200, sbcBabyCoinsurance: 3000,
  sbcDiabetesDeductible: 1000, sbcDiabetesCopay: 100, sbcDiabetesCoinsurance: 500,
};
const cheap: Plan = { ...base, id: "B-01", baseId: "B", name: "B", moop: 9000,
  deductible: 8000, sbcBabyDeductible: 8000, sbcBabyCopay: 0, sbcBabyCoinsurance: 3000 };
const rates: RateRow[] = [
  { baseId: "A", area: 3, age: "45", rate: 500, tobaccoRate: 700 },
  { baseId: "B", area: 3, age: "45", rate: 300, tobaccoRate: 420 },
  { baseId: "A", area: 1, age: "45", rate: 999, tobaccoRate: null },
];

describe("ageBand", () => {
  it("maps ages to CMS bands", () => {
    expect(ageBand(10)).toBe("0-14");
    expect(ageBand(45)).toBe("45");
    expect(ageBand(64)).toBe("64 and over");
  });
});

describe("rankPlans", () => {
  const rows = rankPlans([base, cheap], rates, { household: one(45), area: 3, tobacco: false });
  const a = rows.find((r) => r.plan.id === "A-01")!;

  it("only includes plans with a rate in the area and age", () => {
    expect(rankPlans([base], rates, { household: one(30), area: 3, tobacco: false })).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });
  it("computes scenario totals", () => {
    expect(a.totals.premium).toBe(6000);
    expect(a.totals.light).toBe(6500);
    expect(a.totals.condition).toBe(6000 + 1600);
    expect(a.totals.big).toBe(6000 + 4200);
    expect(a.totals.worst).toBe(12000);
  });
  it("caps scenario cost at the out-of-pocket max", () => {
    const capped = rankPlans([{ ...base, moop: 2000 }], rates, { household: one(45), area: 3, tobacco: false });
    expect(capped[0].totals.big).toBe(6000 + 2000);
  });
  it("uses tobacco rate when asked", () => {
    const t = rankPlans([base], rates, { household: one(45), area: 3, tobacco: true });
    expect(t[0].monthly).toBe(700);
  });
  it("sums medical and drug deductibles when not integrated", () => {
    const split = { ...base, deductible: null, medicalDeductible: 700, drugDeductible: 300 };
    expect(rankPlans([split], rates, { household: one(45), area: 3, tobacco: false })[0].deductible).toBe(1000);
  });
  it("excludes CSR variants and catastrophic plans", () => {
    const csr = { ...base, variant: "94% AV Level Silver Plan" };
    const cat = { ...base, metal: "Catastrophic" };
    expect(rankPlans([csr, cat], rates, { household: one(45), area: 3, tobacco: false })).toHaveLength(0);
  });
  it("produces different winners for different scenarios", () => {
    const w = winners(rows);
    expect(w.premium?.plan.id).toBe("B-01");
    expect(w.worst?.plan.id).toBe("A-01");
  });
  it("sorts missing totals last", () => {
    const missing = { ...base, id: "C-01", baseId: "C", sbcBabyCopay: null };
    const r = rankPlans([missing, base], [...rates, { baseId: "C", area: 3, age: "45", rate: 100, tobaccoRate: null }],
      { household: one(45), area: 3, tobacco: false });
    expect(sortBy(r, "big")[0].plan.id).toBe("A-01");
  });
});

describe("households", () => {
  const ratesFam: RateRow[] = [
    { baseId: "A", area: 3, age: "45", rate: 500, tobaccoRate: null },
    { baseId: "A", area: 3, age: "43", rate: 450, tobaccoRate: null },
    { baseId: "A", area: 3, age: "0-14", rate: 200, tobaccoRate: null },
    { baseId: "A", area: 3, age: "17", rate: 300, tobaccoRate: null },
  ];
  it("charges only the three oldest children under 21", () => {
    expect(chargedAges({ adults: [45], children: [2, 5, 7, 9] }).sort((a, b) => a - b)).toEqual([5, 7, 9, 45]);
    expect(chargedAges({ adults: [45], children: [22] })).toEqual([45, 22]);
  });
  it("sums member premiums and uses family limits", () => {
    const [r] = rankPlans([base], ratesFam, {
      household: { adults: [45, 43], children: [4, 6, 8, 17] }, area: 3, tobacco: false,
    });
    // 45 + 43 + three oldest children (17, 8, 6) = 500 + 450 + 300 + 200 + 200
    expect(r.monthly).toBe(1650);
    expect(r.moop).toBe(12000);
    expect(r.deductible).toBe(2000);
    expect(r.totals.worst).toBe(1650 * 12 + 12000);
  });
  it("drops a plan if any charged member has no rate", () => {
    expect(rankPlans([base], ratesFam, { household: { adults: [45, 50], children: [] }, area: 3, tobacco: false })).toHaveLength(0);
  });
});

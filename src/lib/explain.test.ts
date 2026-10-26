import { describe, expect, it } from "vitest";
import { figuresIn, pickCandidates, verify, type Candidate, type RawExplanation } from "./explain";
import type { Plan, Ranked } from "./rank";

const plan = (id: string): Plan =>
  ({ id, baseId: id, issuer: "X", name: id, metal: "Gold", variant: "Standard", type: "HMO", serviceAreaId: "S" }) as Plan;

const row = (id: string, premium: number, worst: number): Ranked => ({
  plan: plan(id),
  deductible: 1000,
  moop: worst - premium,
  monthly: premium / 12,
  totals: { premium, light: premium + 500, condition: premium + 1500, big: premium + 4000, worst },
});

const cands: Candidate[] = [
  { label: "P1", row: row("A", 6000, 12000) },
  { label: "P2", row: row("B", 4000, 14000) },
];

const claim = (plan: string, field: string, value: number, cp = "", cf = "none") => ({
  plan, field, compare_plan: cp, compare_field: cf, value,
});

const raw = (text: string, claims: ReturnType<typeof claim>[], summary = "Two plans compared."): RawExplanation => ({
  summary,
  caveat: "Estimates.",
  points: [{ scenario: "worst", text, claims }],
});

describe("figuresIn", () => {
  it("extracts dollar amounts", () => {
    expect(figuresIn("From $1,234 to $12,000 and $5.")).toEqual([1234, 12000, 5]);
  });
});

describe("pickCandidates", () => {
  it("labels plans P1..Pn without duplicates", () => {
    const c = pickCandidates([row("A", 6000, 12000), row("B", 4000, 14000)]);
    expect(c.map((x) => x.label)).toEqual(["P1", "P2"]);
  });
});

describe("verify", () => {
  it("passes figures that match the plan data", () => {
    const out = verify(raw("P1 worst case is $12,000.", [claim("P1", "total_worst", 12000)]), cands);
    expect(out.points[0].status).toBe("verified");
    expect(out.stats).toEqual({ claims: 1, verified: 1, failed: 0 });
  });
  it("replaces plan labels with plan names in the output text", () => {
    const out = verify(raw("P1 is $2,000 above P2 on premium.", [claim("P1", "annual_premium", 2000, "P2", "annual_premium")]), cands);
    expect(out.points[0].text).toBe("X · A is $2,000 above X · B on premium.");
  });
  it("does not treat dollar amounts inside plan names as claims", () => {
    const named: Candidate[] = [{ label: "P1", row: { ...row("A", 6000, 12000), plan: { ...plan("A"), name: "Value Bronze $8500 Deductible" } } }];
    const out = verify(raw("Value Bronze $8500 Deductible costs $6,000.", [claim("P1", "annual_premium", 6000)]), named);
    expect(out.points[0].status).toBe("verified");
  });
  it("flags a wrong figure and reports the real one", () => {
    const out = verify(raw("P1 worst case is $11,000.", [claim("P1", "total_worst", 11000)]), cands);
    expect(out.points[0].status).toBe("flagged");
    expect(out.points[0].problems[0]).toContain("$12,000");
    expect(out.stats.failed).toBe(1);
  });
  it("verifies a difference between two plans", () => {
    const ok = verify(
      raw("P2 costs $2,000 less in premium.", [claim("P2", "annual_premium", 2000, "P1", "annual_premium")]),
      cands,
    );
    expect(ok.points[0].status).toBe("verified");
  });
  it("flags dollar figures in the prose that no claim backs", () => {
    const out = verify(raw("P1 costs $6,000 but also $9,999.", [claim("P1", "annual_premium", 6000)]), cands);
    expect(out.points[0].status).toBe("flagged");
    expect(out.points[0].problems.join(" ")).toContain("$9,999");
  });
  it("flags unknown plan labels", () => {
    const out = verify(raw("P9 is great at $5,000.", [claim("P9", "annual_premium", 5000)]), cands);
    expect(out.points[0].status).toBe("flagged");
  });
  it("blocks advice-like language", () => {
    const out = verify(raw("You should choose P1.", []), cands);
    expect(out.points[0].status).toBe("blocked");
    expect(out.points[0].text).toBe("");
  });
  it("flags unbacked figures in the summary", () => {
    const out = verify(raw("P1 costs $6,000.", [claim("P1", "annual_premium", 6000)], "Saves $7,777 a year."), cands);
    expect(out.summary.problems.length).toBe(1);
  });
});

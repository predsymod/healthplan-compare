import { describe, expect, it } from "vitest";
import { comparePlans, rankFor, rankResults } from "./engine";
import { applicablePercent, csrLevel, estimateCredit, screenSubsidy } from "./subsidy";
import { callTool } from "./tools";
import { POST as mcp } from "../app/mcp/route";

const answers = {
  coverage: "none",
  age: 40,
  spouse_age: 38,
  children_ages: [5, 7, 9],
  zip: "80202",
  household_income: 90000,
  expected_care: "major",
};

describe("rankResults", () => {
  it("returns the next question when the intake is unfinished", () => {
    const r = rankResults({ coverage: "none" });
    expect(r.status).toBe("ask");
  });

  it("agrees with the ranking used by the web page", () => {
    const r = rankResults({ ...answers, household_income: null }, { limit: 3 });
    if (r.status !== "ready") throw new Error("not ready");
    const direct = rankFor({ household: { adults: [40, 38], children: [5, 7, 9] }, zip: "80202", tobacco: false });
    expect(r.result.plansAvailable).toBe(direct.rows.length);
    const worst = Math.min(...direct.rows.map((x) => x.totals.worst!));
    expect(r.result.bestBy.worst!.perYear.worst).toBe(Math.round(worst));
  });

  it("leads with the view that matches the expected care", () => {
    const r = rankResults(answers);
    expect(r.status === "ready" && r.result.leadWith.scenario).toBe("big");
    const little = rankResults({ ...answers, expected_care: "little" });
    expect(little.status === "ready" && little.result.leadWith.scenario).toBe("light");
  });

  it("sorts the list by the lead view", () => {
    const r = rankResults(answers, { limit: 10 });
    if (r.status !== "ready") throw new Error("not ready");
    const v = r.result.plans.map((p) => p.perYear.big!);
    expect(v).toEqual([...v].sort((a, b) => a - b));
  });

  it("filters by metal level and premium", () => {
    const r = rankResults(answers, { filter: { metal: ["gold"], max_monthly_premium: 100000 }, limit: 15 });
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.result.plans.length).toBeGreaterThan(0);
    expect(r.result.plans.every((p) => p.metal === "Gold")).toBe(true);
    expect(r.result.plansMatching).toBeLessThan(r.result.plansAvailable);
  });

  it("includes the caveats and a subsidy screen", () => {
    const r = rankResults(answers);
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.result.caveats.join(" ")).toMatch(/ESTIMATED premium tax credit/);
    expect(r.result.subsidyScreen?.band).toBe("subsidy_range");
    expect(r.result.priceBasis).toBe("after estimated premium tax credit");
  });

  it("skips the subsidy screen when income is skipped, and prices before credits", () => {
    const r = rankResults({ ...answers, household_income: null });
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.result.subsidyScreen).toBeNull();
    expect(r.result.subsidyEstimate).toBeNull();
    expect(r.result.priceBasis).toBe("before any premium tax credit");
    expect(r.result.caveats.join(" ")).toMatch(/before any premium tax credit/);
    expect(r.result.plans.every((p) => p.estimatedMonthlyCredit === 0)).toBe(true);
  });

  it("applies the same credit amount, capped at the premium, to every plan", () => {
    const r = rankResults(answers, { limit: 15 });
    if (r.status !== "ready" || !r.result.subsidyEstimate) throw new Error("no estimate");
    const { estimatedMonthlyCredit } = r.result.subsidyEstimate;
    expect(estimatedMonthlyCredit).toBeGreaterThan(0);
    for (const p of r.result.plans) {
      expect(p.estimatedMonthlyCredit).toBeLessThanOrEqual(estimatedMonthlyCredit);
      expect(p.monthlyPremium).toBeGreaterThanOrEqual(0);
      // after-credit and before-credit figures differ by the annual credit applied (within rounding)
      const gap = p.perYearBeforeCredit.worst! - p.perYear.worst!;
      expect(Math.abs(gap - p.estimatedMonthlyCredit * 12)).toBeLessThanOrEqual(12);
    }
  });

  it("cannot make a premium negative when the credit exceeds it", () => {
    const r = rankResults({ ...answers, household_income: 30000, children_ages: [4] , spouse_age: null }, { limit: 15 });
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.result.plans.every((p) => p.perYear.premium! >= 0)).toBe(true);
  });

  it("swaps in cost-sharing-reduction Silver plans at lower incomes", () => {
    const single = { coverage: "none", age: 45, spouse_age: null, children_ages: [], zip: "80202", household_income: 22000, expected_care: "ongoing" };
    const r = rankResults(single, { filter: { metal: ["Silver"] }, limit: 15 });
    if (r.status !== "ready" || !r.result.subsidyEstimate) throw new Error("no estimate");
    expect(r.result.subsidyEstimate.costSharingReduction?.level).toBe(94);
    expect(r.result.plans.length).toBeGreaterThan(0);
    expect(r.result.plans.every((p) => p.costSharingVariant === "94% cost-sharing reduction")).toBe(true);
    const std = rankResults({ ...single, household_income: 60000 }, { filter: { metal: ["Silver"] }, limit: 15 });
    if (std.status !== "ready") throw new Error("not ready");
    expect(std.result.plans.every((p) => p.costSharingVariant === null)).toBe(true);
  });

  it("gives no credit above 400% of poverty", () => {
    const r = rankResults({ ...answers, household_income: 400000 });
    if (r.status !== "ready") throw new Error("not ready");
    expect(r.result.subsidyEstimate).toBeNull();
    expect(r.result.priceBasis).toBe("before any premium tax credit");
  });
});

describe("comparePlans", () => {
  it("reports exact differences from the first plan", () => {
    const list = rankResults(answers, { limit: 2 });
    if (list.status !== "ready") throw new Error("not ready");
    const [a, b] = list.result.plans;
    const c = comparePlans(answers, [a.id, b.id]);
    if (c.status !== "ready" || !("differences" in c)) throw new Error("not ready");
    expect(c.differences[0].monthlyPremiumDiff).toBe(b.monthlyPremium - a.monthlyPremium);
    expect(c.differences[0].perYearDiff.worst).toBe(b.perYear.worst! - a.perYear.worst!);
  });

  it("names plan ids it does not know", () => {
    const c = comparePlans(answers, ["nope", "nada"]);
    expect(c.status === "ready" && "unknownPlanIds" in c && c.unknownPlanIds).toEqual(["nope", "nada"]);
  });
});

describe("applicablePercent and credit", () => {
  it("matches the 2026 IRS table at the band edges", () => {
    expect(applicablePercent(100)).toBe(2.1);
    expect(applicablePercent(133)).toBeCloseTo(3.14, 5);
    expect(applicablePercent(150)).toBeCloseTo(4.19, 5);
    expect(applicablePercent(200)).toBeCloseTo(6.6, 5);
    expect(applicablePercent(250)).toBeCloseTo(8.44, 5);
    expect(applicablePercent(300)).toBeCloseTo(9.96, 5);
    expect(applicablePercent(400)).toBeCloseTo(9.96, 5);
  });
  it("interpolates within a band", () => {
    expect(applicablePercent(175)).toBeCloseTo((4.19 + 6.6) / 2, 5);
  });
  it("has no percentage above 400%", () => {
    expect(applicablePercent(400.5)).toBeNull();
  });
  it("assigns cost-sharing levels", () => {
    expect([csrLevel(140), csrLevel(150), csrLevel(180), csrLevel(200), csrLevel(240), csrLevel(251)]).toEqual([94, 94, 87, 87, 73, null]);
  });
  it("computes the credit as benchmark minus expected contribution, floored at zero", () => {
    // household of 1 at 300% FPL: 46,950 income x 9.96% = 4,676 expected
    const e = estimateCredit(46950, 1, 8000)!;
    expect(e.expectedAnnualContribution).toBe(4676);
    expect(e.annualCredit).toBe(3324);
    expect(estimateCredit(46950, 1, 3000)!.annualCredit).toBe(0);
  });
  it("gives no estimate below the Medicaid line or above 400%", () => {
    expect(estimateCredit(15000, 1, 8000)).toBeNull();
    expect(estimateCredit(70000, 1, 8000)).toBeNull();
  });
});

describe("screenSubsidy", () => {
  it("bands income by federal poverty level", () => {
    expect(screenSubsidy(20000, 1).band).toBe("medicaid_likely");
    expect(screenSubsidy(50000, 1).band).toBe("subsidy_range");
    expect(screenSubsidy(70000, 1).band).toBe("above_limit");
    expect(screenSubsidy(15650, 1).fplPercent).toBe(100);
    expect(screenSubsidy(32150, 4).fplPercent).toBe(100);
  });
});

describe("tools and MCP endpoint", () => {
  it("rejects an unknown tool", () => {
    expect(callTool("nope", {}).ok).toBe(false);
  });

  const rpc = async (body: unknown) => {
    const res = await mcp(new Request("http://x/mcp", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: res.status === 202 ? null : await res.json() };
  };

  it("initializes and lists the tools", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(init.json.result.protocolVersion).toBe("2025-03-26");
    expect(init.json.result.instructions).toMatch(/next_question/);
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.json.result.tools.map((t: { name: string }) => t.name)).toEqual(["next_question", "rank_plans", "compare_plans"]);
  });

  it("acknowledges notifications with 202", async () => {
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  });

  it("runs a tool call", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "next_question", arguments: { answers: {} } } });
    const out = JSON.parse(r.json.result.content[0].text);
    expect(out.status).toBe("ask");
    expect(r.json.result.isError).toBe(false);
  });

  it("returns an error for an unknown method", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 4, method: "nope" });
    expect(r.json.error.code).toBe(-32601);
  });
});

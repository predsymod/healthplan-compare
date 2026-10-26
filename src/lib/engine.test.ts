import { describe, expect, it } from "vitest";
import { comparePlans, rankFor, rankResults } from "./engine";
import { screenSubsidy } from "./subsidy";
import { callTool } from "./tools";
import { POST as mcp } from "../app/mcp/route";

const answers = {
  coverage: "none",
  age: 45,
  spouse_age: 43,
  children_ages: [4, 6, 8],
  zip: "80134",
  household_income: 90000,
  expected_care: "major",
};

describe("rankResults", () => {
  it("returns the next question when the intake is unfinished", () => {
    const r = rankResults({ coverage: "none" });
    expect(r.status).toBe("ask");
  });

  it("agrees with the ranking used by the web page", () => {
    const r = rankResults(answers, { limit: 3 });
    if (r.status !== "ready") throw new Error("not ready");
    const direct = rankFor({ household: { adults: [45, 43], children: [4, 6, 8] }, zip: "80134", tobacco: false });
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
    expect(r.result.caveats.join(" ")).toMatch(/before any premium tax credit/);
    expect(r.result.subsidyScreen?.band).toBe("subsidy_range");
  });

  it("skips the subsidy screen when income is skipped", () => {
    const r = rankResults({ ...answers, household_income: null });
    expect(r.status === "ready" && r.result.subsidyScreen).toBeNull();
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

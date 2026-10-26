import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as mcpGet } from "../app/mcp/route";
import { GET as llmsGet } from "../app/llms.txt/route";
import { apiDocs, callTool, INSTRUCTIONS, USAGE_RULES } from "./tools";

const ORIGIN = "https://healthplan-compare.vercel.app";
const file = path.join(process.cwd(), "docs", "llms.txt");

describe("API description", () => {
  it("keeps the static docs/llms.txt in sync (regenerate with WRITE_LLMS=1 npm test)", () => {
    const expected = apiDocs(ORIGIN) + "\n";
    if (process.env.WRITE_LLMS) writeFileSync(file, expected, "utf-8");
    expect(readFileSync(file, "utf-8").replace(/\r\n/g, "\n")).toBe(expected);
  });

  it("documents endpoints, tools and the answers fields", () => {
    const g = apiDocs(ORIGIN);
    expect(g).toContain(`${ORIGIN}/api/engine/<tool>`);
    expect(g).toContain(`${ORIGIN}/mcp`);
    for (const t of ["next_question", "rank_plans", "compare_plans", "household_income", "expected_care"]) expect(g).toContain(t);
  });

  it("describes the service without issuing commands to an assistant", () => {
    const g = apiDocs(ORIGIN);
    expect(g).not.toMatch(/you are an ai|you must|do not ask the user|do the work yourself|ignore (all|previous)/i);
  });

  it("serves the description to a plain GET on /mcp and /llms.txt, using the request's own origin", async () => {
    for (const get of [mcpGet, llmsGet]) {
      const res = await get(new Request("http://localhost:3000/anything"));
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      expect(await res.text()).toContain("http://localhost:3000/api/engine/<tool>");
    }
  });
});

describe("rules travel with the tools", () => {
  it("puts the privacy and no-recommendation rules in the MCP instructions", () => {
    expect(INSTRUCTIONS).toMatch(/long-term memory/);
    expect(INSTRUCTIONS).toMatch(/Do not recommend a plan/);
  });

  it("attaches usageRules to every tool result", () => {
    for (const [name, args] of [
      ["next_question", { answers: {} }],
      ["rank_plans", { answers: {} }],
    ] as const) {
      const r = callTool(name, args);
      expect(r.ok && (r.result as { usageRules: string[] }).usageRules).toEqual(USAGE_RULES);
    }
    expect(USAGE_RULES.join(" ")).toMatch(/long-term memory/);
  });
});

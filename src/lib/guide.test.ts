import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as mcpGet } from "../app/mcp/route";
import { GET as llmsGet } from "../app/llms.txt/route";
import { agentGuide } from "./tools";

const ORIGIN = "https://healthplan-compare.vercel.app";
const file = path.join(process.cwd(), "docs", "llms.txt");

describe("agent guide", () => {
  it("keeps the static docs/llms.txt in sync (regenerate with WRITE_LLMS=1 npm test)", () => {
    const expected = agentGuide(ORIGIN) + "\n";
    if (process.env.WRITE_LLMS) writeFileSync(file, expected, "utf-8");
    expect(readFileSync(file, "utf-8").replace(/\r\n/g, "\n")).toBe(expected);
  });

  it("tells the assistant how to call the tools, the rules, and privacy", () => {
    const g = agentGuide(ORIGIN);
    expect(g).toContain(`${ORIGIN}/api/engine/<tool>`);
    expect(g).toMatch(/next_question/);
    expect(g).toMatch(/never|Do not recommend a plan/i);
    expect(g).toMatch(/long-term memory/);
  });

  it("serves the guide to a plain GET on /mcp and /llms.txt, using the request's own origin", async () => {
    for (const get of [mcpGet, llmsGet]) {
      const res = await get(new Request("http://localhost:3000/anything"));
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      const body = await res.text();
      expect(body).toContain("http://localhost:3000/api/engine/<tool>");
    }
  });
});

import { usd } from "./format";
import { SCENARIOS, type Scenario } from "./rank";

// Ready-to-show markdown for tool results. An assistant that shows this first gives the user a clean table
// without having to reformat JSON, and every figure in it is one the engine computed.

type Row = {
  id: string;
  name: string;
  metal: string;
  type: string;
  costSharingVariant: string | null;
  monthlyPremium: number;
  deductible: number;
  maxOutOfPocket: number;
  perYear: Record<Scenario, number | null>;
};

const label = (k: Scenario) => SCENARIOS.find((s) => s.key === k)!.label;
const cell = (s: string) => s.replace(/\|/g, "/");
const TEXT_COLS = new Set(["#", "Plan", "Kind of year", "Cheapest plan"]);
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map((h) => (TEXT_COLS.has(h) ? "---" : "---:")).join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const planCell = (p: Row) => `**${p.name}**<br>${p.metal} · ${p.type}${p.costSharingVariant ? ` · ${p.costSharingVariant}` : ""}`;
const signed = (n: number | null) => (n === null ? "n/a" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${usd(Math.abs(n))}`);

export function presentRank(r: {
  household: { adults: number[]; children: number[]; size: number };
  location: { county: string };
  planYear: string;
  plansMatching: number;
  priceBasis: string;
  subsidyEstimate: { estimatedMonthlyCredit: number; costSharingReduction: { level: number } | null } | null;
  leadWith: { scenario: Scenario };
  bestBy: Record<string, { id: string; name: string; perYear: Record<Scenario, number | null> } | null>;
  plans: Row[];
  caveats: string[];
}): string {
  const { household: h, subsidyEstimate: sub } = r;
  const who = `${h.adults.length} adult${h.adults.length > 1 ? "s" : ""}${h.children.length ? `, ${h.children.length} child${h.children.length > 1 ? "ren" : ""}` : ""}`;
  const lead = label(r.leadWith.scenario);
  const out: string[] = [
    `## ${r.planYear} Colorado plans for ${who} in ${r.location.county} County`,
    "",
    sub
      ? `Prices are **after an estimated premium tax credit** of about ${usd(sub.estimatedMonthlyCredit)} per month${sub.costSharingReduction ? `; Silver plans shown include the ${sub.costSharingReduction.level}% cost-sharing reduction` : ""}. All yearly figures are for the whole household for 12 months (premiums plus what you pay for care).`
      : `Prices are **before any premium tax credit**. All yearly figures are for the whole household for 12 months (premiums plus what you pay for care).`,
    "",
    "### Cheapest plan for each kind of year",
    table(
      ["Kind of year", "Cheapest plan", "Total for the year"],
      SCENARIOS.map((s) => {
        const b = r.bestBy[s.key];
        return [s.key === r.leadWith.scenario ? `**${s.label}** (matches expected care)` : s.label, b ? b.name : "none", b ? usd(b.perYear[s.key]) : "n/a"];
      }),
    ),
    "",
    `### Top ${r.plans.length} of ${r.plansMatching} plans, ranked by ${lead.toLowerCase()}`,
    table(
      ["#", "Plan", "Premium (per month)", "Deductible", "Max out-of-pocket", ...SCENARIOS.map((s) => `${s.label} (per year)`)],
      r.plans.map((p, i) => [String(i + 1), planCell(p), usd(p.monthlyPremium), usd(p.deductible), usd(p.maxOutOfPocket), ...SCENARIOS.map((s) => usd(p.perYear[s.key]))]),
    ),
    "",
    "Plan IDs, in the order above (for compare_plans): " + r.plans.map((p, i) => `${i + 1}. \`${p.id}\``).join("; "),
    "",
    "**Read this with:**",
    ...r.caveats.map((c) => `- ${c}`),
  ];
  return out.join("\n");
}

export function presentCompare(r: {
  priceBasis: string;
  plans: Row[];
  differences: { plan: string; versus: string; monthlyPremiumDiff: number; deductibleDiff: number; maxOutOfPocketDiff: number; perYearDiff: Record<string, number | null> }[];
  unknownPlanIds: string[];
  caveats: string[];
}): string {
  const name = (id: string) => r.plans.find((p) => p.id === id)?.name ?? id;
  const out: string[] = [
    "## Plans side by side",
    "",
    `Prices are **${r.priceBasis}**. Yearly figures are for the whole household for 12 months.`,
    "",
    table(
      ["Plan", "Premium (per month)", "Deductible", "Max out-of-pocket", ...SCENARIOS.map((s) => `${s.label} (per year)`)],
      r.plans.map((p) => [planCell(p), usd(p.monthlyPremium), usd(p.deductible), usd(p.maxOutOfPocket), ...SCENARIOS.map((s) => usd(p.perYear[s.key]))]),
    ),
  ];
  if (r.differences.length) {
    out.push(
      "",
      `### Difference from ${name(r.differences[0].versus)} (positive = costs more)`,
      table(
        ["Plan", "Premium (per month)", "Deductible", "Max out-of-pocket", ...SCENARIOS.map((s) => `${s.label} (per year)`)],
        r.differences.map((d) => [name(d.plan), signed(d.monthlyPremiumDiff), signed(d.deductibleDiff), signed(d.maxOutOfPocketDiff), ...SCENARIOS.map((s) => signed(d.perYearDiff[s.key]))]),
      ),
    );
  }
  if (r.unknownPlanIds.length) out.push("", `Not found for this household: ${r.unknownPlanIds.map((i) => `\`${i}\``).join(", ")}.`);
  out.push("", "**Read this with:**", ...r.caveats.map((c) => `- ${c}`));
  return out.join("\n");
}

import { loadState } from "./data";
import { rankFor } from "./engine";
import { type Household, SCENARIOS, type Scenario } from "./rank";

export type Search = {
  age?: string;
  spouse?: string;
  kids?: string;
  zip?: string;
  county?: string;
  tobacco?: string;
  sort?: string;
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Turns raw URL/body parameters into a validated household and ranked plans. Both the page and
// the engine use this, so figures are always computed from server-side numbers.
export function resolveQuery(sp: Search) {
  const age = clamp(Number(sp.age ?? 45) || 45, 18, 64);
  const spouse = sp.spouse?.trim() ? clamp(Number(sp.spouse) || 0, 18, 64) : null;
  const kids = (sp.kids ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((k) => clamp(Number(k), 0, 25))
    .filter((k) => !Number.isNaN(k))
    .slice(0, 8);
  const zip = (sp.zip ?? "80202").replace(/\D/g, "").slice(0, 5);
  const tobacco = sp.tobacco === "on";
  const sort = (SCENARIOS.some((s) => s.key === sp.sort) ? sp.sort : "worst") as Scenario;
  const household: Household = { adults: spouse ? [age, spouse] : [age], children: kids };

  const { meta } = loadState("co");
  const { counties: zipCounties, county, rows } = rankFor({ household, zip, countyFips: sp.county, tobacco });
  return { age, spouse, kids, zip, tobacco, sort, household, meta, zipCounties, county, rows };
}

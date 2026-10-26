import { loadState } from "./data";
import { lookupZip, pickCounty, serviceAreasFor } from "./geo";
import { rankPlans, type Household, type Ranked, SCENARIOS, type Scenario } from "./rank";

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
// the explain route use this, so the explanation is always computed from server-side numbers.
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

  const { meta, plans, rates, serviceAreas, zips } = loadState("co");
  const zipCounties = lookupZip(zips, zip);
  const county = zipCounties ? pickCounty(zipCounties, sp.county) : null;
  const rows: Ranked[] = county
    ? rankPlans(plans, rates, {
        household,
        area: county.area,
        tobacco,
        serviceAreaIds: serviceAreasFor(serviceAreas, county.fips),
      })
    : [];
  return { age, spouse, kids, zip, tobacco, sort, household, meta, zipCounties, county, rows };
}

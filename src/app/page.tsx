import ExplainPanel from "./ExplainPanel";
import { planLabel, usd } from "@/lib/format";
import { resolveQuery, type Search } from "@/lib/query";
import { chargedAges, householdSize, sortBy, winners, SCENARIOS, type Scenario } from "@/lib/rank";

const SHORT: Record<Scenario, string> = {
  premium: "Just the premiums, no care costs.",
  light: "Healthy year: premiums plus routine care (up to $500 per person, within the deductible).",
  condition: "One person manages a chronic condition (the plan's standard diabetes scenario, about $5,600 of care).",
  big: "One person has a baby or a similar large event (the plan's standard scenario, about $12,700 of care).",
  worst: "Everything goes wrong: premiums plus the plan's maximum out-of-pocket limit. In-network care only; out-of-network and uncovered services can cost more.",
};

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { age, spouse, kids, zip, tobacco, sort, household, meta, zipCounties, county, rows } = resolveQuery(sp);
  const size = householdSize(household);
  const charged = chargedAges(household).length;
  const best = winners(rows);
  const sorted = sortBy(rows, sort);
  const shown = sorted.slice(0, 40);
  const lowest = (key: Scenario) => best[key]?.plan.id;
  const params = (s: Scenario) =>
    new URLSearchParams({
      age: String(age),
      ...(spouse ? { spouse: String(spouse) } : {}),
      ...(kids.length ? { kids: kids.join(",") } : {}),
      zip,
      ...(county ? { county: county.fips } : {}),
      ...(tobacco ? { tobacco: "on" } : {}),
      sort: s,
    }).toString();

  return (
    <main>
      <h1>Health plan compare</h1>
      <div className="sub">
        {meta.exchange} individual-market plans, {meta.planYear} data. Educational cost estimator, not medical
        advice.
      </div>
      <div className="banner">
        <strong>All dollar amounts are for one full year</strong> (12 months of premiums plus what you pay for
        care). They are estimates <strong>before any subsidies</strong> (federal tax credits, cost-sharing
        reductions or Colorado Premium Assistance). Verify plans and prices on{" "}
        <a href="https://connectforhealthco.com">Connect for Health Colorado</a> or with the insurer before
        enrolling. Under-65, non-Medicaid only.
      </div>

      <form>
        <label>Your age<input name="age" type="number" min={18} max={64} defaultValue={age} /></label>
        <label>
          Spouse/partner age
          <input name="spouse" type="number" min={18} max={64} defaultValue={spouse ?? ""} placeholder="none" />
        </label>
        <label>
          Children&apos;s ages
          <input name="kids" type="text" defaultValue={kids.join(", ")} placeholder="e.g. 4, 6, 8" />
        </label>
        <label>
          ZIP code
          <input name="zip" type="text" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={zip} />
        </label>
        {zipCounties && zipCounties.length > 1 && (
          <label>
            County (this ZIP spans several)
            <select name="county" defaultValue={county?.fips}>
              {zipCounties.map((c) => (
                <option key={c.fips} value={c.fips}>
                  {c.name} ({Math.round(c.share * 100)}% of ZIP)
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check"><input name="tobacco" type="checkbox" defaultChecked={tobacco} /> Tobacco user</label>
        <button type="submit">Compare plans</button>
      </form>
      <div className="muted small">
        Example:{" "}
        <a href="?age=45&spouse=43&kids=4,6,8&zip=80134">you 45, spouse 43, three kids (4, 6, 8)</a> ·{" "}
        <a href="?age=45&zip=80134">just you, 45</a>
      </div>

      <div className="household">
        <strong>
          {size} {size === 1 ? "person" : "people"}
        </strong>
        : {household.adults.length} adult{household.adults.length > 1 ? "s" : ""}
        {kids.length ? `, ${kids.length} child${kids.length > 1 ? "ren" : ""}` : ""}.{" "}
        {size > 1
          ? `Family plan limits apply${charged < size ? `; only ${charged} are charged a premium (the plan charges for the three oldest children under 21)` : ""}.`
          : "Individual plan limits apply."}{" "}
        {county
          ? `${rows.length} plans are sold in ${county.name} County (rating area ${county.area}).`
          : ""}
      </div>

      {!county && (
        <div className="banner">
          We don&apos;t recognise ZIP {zip || "(blank)"} as a Colorado ZIP. Enter a 5-digit Colorado ZIP to see plans.
        </div>
      )}

      {county && (
        <>
      <h2>Best plan for each kind of year</h2>
      <div className="muted small">The cheapest plan changes with how much care you use. Total cost for the year:</div>
      <div className="cards">
        {SCENARIOS.map((s) => {
          const w = best[s.key];
          return (
            <div className="card" key={s.key}>
              <div className="k">{s.label}</div>
              <div className="t">{w ? usd(w.totals[s.key]) : ""}</div>
              <div className="p">{w ? planLabel(w.plan) : "none"}</div>
              <div className="d">{SHORT[s.key]}</div>
            </div>
          );
        })}
      </div>

      <ExplainPanel
        key={`${zip}-${county?.fips}-${age}-${spouse}-${kids.join(",")}-${tobacco}`}
        query={{
          age: String(age),
          ...(spouse ? { spouse: String(spouse) } : {}),
          kids: kids.join(","),
          zip,
          ...(county ? { county: county.fips } : {}),
          ...(tobacco ? { tobacco: "on" } : {}),
        }}
      />

      <h2>
        All plans <span className="muted small">sorted by {SCENARIOS.find((s) => s.key === sort)?.label.toLowerCase()} (click a column to re-sort)</span>
      </h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th title="Per month, whole household">Premium<div className="unit">per month</div></th>
              <th title={size > 1 ? "Family (group) deductible" : "Individual deductible"}>Deductible<div className="unit">{size > 1 ? "family" : "individual"}</div></th>
              <th title="Most you pay for care in a year, on top of premiums">Max out-of-pocket<div className="unit">{size > 1 ? "family" : "individual"}</div></th>
              {SCENARIOS.map((s) => (
                <th key={s.key} title={s.help}>
                  <a className={s.key === sort ? "on" : ""} href={`?${params(s.key)}`}>{s.label}</a>
                  <div className="unit">per year</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.plan.id}>
                <td>
                  <div>{planLabel(r.plan)}</div>
                  <div className="muted small">{r.plan.metal} &middot; {r.plan.type}</div>
                </td>
                <td>{usd(r.monthly)}</td>
                <td>{usd(r.deductible)}</td>
                <td>{usd(r.moop)}</td>
                {SCENARIOS.map((s) => (
                  <td key={s.key} className={lowest(s.key) === r.plan.id ? "low" : ""}>
                    {usd(r.totals[s.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown.length && (
        <div className="muted small">Showing the best {shown.length} of {sorted.length} plans for this sort.</div>
      )}
        </>
      )}
      <footer>
        Data: {meta.source}, retrieved {meta.retrieved}. {meta.note} ZIP-to-county uses Census ZIP areas, so a few ZIPs (P.O. boxes, new ZIPs) may not be found. For families, scenario care costs are for one family member and come from each plan&apos;s standard Summary of Benefits
        examples, not from your own care; family-wide care would cost more. Whether a family deductible is shared or per person varies by plan and is not modeled. The out-of-pocket maximum covers in-network, covered care only. Network breadth, drugs and doctors are not modeled. Green cells mark the
        cheapest plan in that column.
      </footer>
    </main>
  );
}

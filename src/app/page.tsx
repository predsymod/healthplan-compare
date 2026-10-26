import { loadState } from "@/lib/data";
import { rankPlans, sortBy, winners, SCENARIOS, type Scenario } from "@/lib/rank";

type Search = { age?: string; area?: string; tobacco?: string; sort?: string };

const usd = (n: number | null) =>
  n === null ? "n/a" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const age = Math.min(64, Math.max(0, Number(sp.age ?? 45) || 45));
  const area = Math.min(9, Math.max(1, Number(sp.area ?? 3) || 3));
  const tobacco = sp.tobacco === "on";
  const sort = (SCENARIOS.some((s) => s.key === sp.sort) ? sp.sort : "worst") as Scenario;

  const { meta, plans, rates } = loadState("co");
  const rows = rankPlans(plans, rates, { age, area, tobacco });
  const best = winners(rows);
  const sorted = sortBy(rows, sort).slice(0, 40);
  const qs = (s: Scenario) =>
    `?age=${age}&area=${area}${tobacco ? "&tobacco=on" : ""}&sort=${s}`;

  return (
    <main>
      <h1>Health plan compare</h1>
      <div className="sub">
        {meta.exchange} individual plans, {meta.planYear} data. Educational cost estimator, not medical advice.
      </div>
      <div className="banner">
        Estimates before any subsidies (federal premium tax credits, cost-sharing reductions or Colorado
        Premium Assistance). Costs in the &quot;managing a condition&quot; and &quot;big year&quot; columns come from each
        plan&apos;s standard Summary of Benefits scenarios, not from your own care. Verify plans and prices on{" "}
        <a href="https://connectforhealthco.com">Connect for Health Colorado</a> or with the insurer before
        enrolling. Under-65, non-Medicaid only.
      </div>

      <form>
        <label>Age (0-64)<input name="age" type="number" min={0} max={64} defaultValue={age} /></label>
        <label>
          Rating area
          <select name="area" defaultValue={area}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((a) => (
              <option key={a} value={a}>Area {a}</option>
            ))}
          </select>
        </label>
        <label>Tobacco user<input name="tobacco" type="checkbox" defaultChecked={tobacco} /></label>
        <button type="submit">Compare</button>
      </form>

      <h2>Cheapest plan by kind of year ({rows.length} plans)</h2>
      <div className="cards">
        {SCENARIOS.map((s) => {
          const w = best[s.key];
          return (
            <div className="card" key={s.key} title={s.help}>
              <div className="k">{s.label}</div>
              <div className="p">{w ? `${w.plan.issuer} ${w.plan.name}` : "none"}</div>
              <div className="t">{w ? usd(w.totals[s.key]) : ""}</div>
            </div>
          );
        })}
      </div>

      <h2>All plans, sorted by {SCENARIOS.find((s) => s.key === sort)?.label.toLowerCase()}</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Insurer</th>
              <th>Plan</th>
              <th>Metal</th>
              <th>Type</th>
              <th>Deductible</th>
              <th>Max OOP</th>
              {SCENARIOS.map((s) => (
                <th key={s.key} title={s.help}>
                  <a className={s.key === sort ? "on" : ""} href={qs(s.key)}>{s.label}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.plan.id}>
                <td>{r.plan.issuer}</td>
                <td>{r.plan.name}</td>
                <td>{r.plan.metal}</td>
                <td>{r.plan.type}</td>
                <td>{usd(r.deductible)}</td>
                <td>{usd(r.plan.moop)}</td>
                {SCENARIOS.map((s) => (
                  <td key={s.key}>{usd(r.totals[s.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        Data: {meta.source}, retrieved {meta.retrieved}. {meta.note} Rating area is chosen manually for now (ZIP
        lookup is not built yet). Network breadth, drugs and doctors are not modeled.
      </footer>
    </main>
  );
}

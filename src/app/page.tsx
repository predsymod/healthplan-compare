import type { Metadata } from "next";
import { headers } from "next/headers";
import { rankResults } from "@/lib/engine";
import { usd } from "@/lib/format";
import { SCENARIOS, type Scenario } from "@/lib/rank";
import { lookupZip } from "@/lib/geo";
import { loadState } from "@/lib/data";
import CopyButton from "./CopyButton";

type Search = { age?: string; spouse?: string; kids?: string; zip?: string; county?: string; income?: string; care?: string; tobacco?: string };

const CARE = [
  { key: "little", title: "Mostly healthy", help: "Checkups and the odd visit" },
  { key: "ongoing", title: "Regular care", help: "A condition or regular prescriptions" },
  { key: "major", title: "A big year", help: "Surgery, a baby or a hospital stay" },
] as const;

const num = (v: string | undefined) => (v && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const seg = (k: string, v: string) => `${k}/${encodeURIComponent(v).replace(/%2C/gi, ",")}/`;

// A page with someone's household in the URL must not be indexed; the bare form can be.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  return sp.age || sp.zip || sp.income ? { robots: { index: false, follow: false } } : {};
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "healthplan-compare.vercel.app"}`;

  const submitted = !!sp.age && !!sp.zip && !!sp.care;
  const kids = (sp.kids ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
  const income = (sp.income ?? "").replace(/\D/g, "");
  const care = CARE.some((c) => c.key === sp.care) ? sp.care! : "ongoing";
  const answers = {
    age: num(sp.age),
    spouse_age: num(sp.spouse) ?? null,
    children_ages: kids,
    zip: (sp.zip ?? "").replace(/\D/g, "").slice(0, 5),
    ...(sp.county ? { county_fips: sp.county } : {}),
    tobacco: sp.tobacco === "on",
    household_income: income ? Number(income) : null,
    expected_care: care,
  };
  const out = submitted ? rankResults(answers, { limit: 5 }) : null;
  const counties = out?.status === "ask" && out.node.id === "county" ? lookupZip(loadState("co").zips, answers.zip) : null;
  const ready = out?.status === "ready" ? out.result : null;

  // One link that carries the whole household, for assistants that can open only links the user pastes.
  let link = "";
  if (ready) {
    const county = lookupZip(loadState("co").zips, answers.zip)?.find((c) => c.name === ready.location.county);
    link =
      `${origin}/api/engine/rank_plans/` +
      seg("age", String(answers.age)) + seg("spouse_age", answers.spouse_age ? String(answers.spouse_age) : "none") +
      seg("children_ages", kids.length ? kids.join(",") : "none") + seg("zip", answers.zip) +
      (county ? seg("county_fips", county.fips) : "") + (answers.tobacco ? seg("tobacco", "yes") : "") +
      seg("household_income", income || "none") + seg("expected_care", care).slice(0, -1);
  }
  const prompt = `Help me pick a health plan. Open this link and walk me through the results: ${link}`;
  const lead = ready ? (ready.leadWith.scenario as Scenario) : "condition";
  const leadLabel = SCENARIOS.find((s) => s.key === lead)?.label.toLowerCase();
  const top = ready?.plans[0];

  return (
    <main className="narrow">
      <h1>Find the right Colorado health plan</h1>
      <p className="sub">Six quick answers. We price every plan sold in your county for a light year and a bad one, then show where each plan wins.</p>

      <form className="intake">
        <div className="row">
          <label>You (age)<input name="age" type="number" min={18} max={64} required defaultValue={sp.age ?? ""} placeholder="40" /></label>
          <label>Partner (age)<input name="spouse" type="number" min={18} max={64} defaultValue={sp.spouse ?? ""} placeholder="none" /></label>
          <label>Children (ages)<input name="kids" type="text" defaultValue={sp.kids ?? ""} placeholder="e.g. 5, 7, 9" /></label>
          <label>ZIP code<input name="zip" type="text" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required defaultValue={sp.zip ?? ""} placeholder="80202" /></label>
        </div>
        {counties && counties.length > 1 && (
          <label>That ZIP spans several counties. Which one do you live in?
            <select name="county" defaultValue={sp.county} required>
              <option value="">Choose a county</option>
              {counties.map((c) => <option key={c.fips} value={c.fips}>{c.name} ({Math.round(c.share * 100)}% of ZIP)</option>)}
            </select>
          </label>
        )}
        <label>Household income per year <span className="opt">(optional, to estimate your premium tax credit)</span>
          <input name="income" type="text" inputMode="numeric" defaultValue={income} placeholder="e.g. 90000" />
        </label>
        <fieldset>
          <legend>How much care do you expect this year?</legend>
          <div className="choices">
            {CARE.map((c) => (
              <label key={c.key} className="choice">
                <input type="radio" name="care" value={c.key} defaultChecked={care === c.key} required />
                <span><strong>{c.title}</strong><small>{c.help}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <details>
          <summary>More options</summary>
          <label className="check"><input name="tobacco" type="checkbox" defaultChecked={sp.tobacco === "on"} /> Anyone on the plan uses tobacco</label>
        </details>
        <button type="submit">See my plans</button>
      </form>

      {out && out.status === "stop" && <div className="notice">{out.message}</div>}
      {out && out.status === "ask" && !counties && (
        <div className="notice">{out.questions.map((q) => q.ask).join(" ")}{out.issues.map((i) => ` ${i.field}: ${i.problem}.`).join("")}</div>
      )}

      {ready && top && (
        <section className="result">
          <h2>Your results</h2>
          <p className="sub">
            {ready.household.adults.length} adult{ready.household.adults.length > 1 ? "s" : ""}
            {ready.household.children.length ? `, ${ready.household.children.length} child${ready.household.children.length > 1 ? "ren" : ""}` : ""} in {ready.location.county} County,{" "}
            {ready.plansAvailable} plans for the {ready.planYear} plan year (if you are enrolling for a later year, prices will differ).{" "}
            {ready.subsidyEstimate
              ? `Prices include an estimated premium tax credit of about ${usd(ready.subsidyEstimate.estimatedMonthlyCredit)} a month.`
              : "Prices are before any premium tax credit."}
          </p>

          <div className="hero">
            <div className="k">Lowest estimated cost for a year of {leadLabel}</div>
            <div className="big">{usd(top.perYear[lead])}<span> a year</span></div>
            <div className="p">{top.name}</div>
            <div className="d">{top.metal} · {top.type} · {usd(top.monthlyPremium)} a month · deductible {usd(top.deductible)} · out-of-pocket max {usd(top.maxOutOfPocket)}</div>
          </div>

          <div className="trio">
            {([["premium", "Lowest monthly bill"], ["big", "Best if you have a big year"], ["worst", "Best in the worst case"]] as const).map(([k, title]) => {
              const b = ready.bestBy[k];
              return b ? (
                <div className="mini" key={k}>
                  <div className="k">{title}</div>
                  <div className="p">{b.name}</div>
                  <div className="t">{usd(b.perYear[k])}<span> a year</span></div>
                </div>
              ) : null;
            })}
          </div>

          <h3>Top {ready.plans.length} for a year of {leadLabel}</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Plan</th><th>Per month</th><th>Deductible</th><th>Out-of-pocket max</th><th>{SCENARIOS.find((s) => s.key === lead)?.label}</th><th>Worst case</th></tr>
              </thead>
              <tbody>
                {ready.plans.map((p) => (
                  <tr key={p.id}>
                    <td><div>{p.name}</div><div className="muted small">{p.metal} · {p.type}{p.costSharingVariant ? ` · ${p.costSharingVariant}` : ""}</div></td>
                    <td>{usd(p.monthlyPremium)}</td><td>{usd(p.deductible)}</td><td>{usd(p.maxOutOfPocket)}</td>
                    <td>{usd(p.perYear[lead])}</td><td>{usd(p.perYear.worst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Yearly figures are for the whole household: 12 months of premiums plus what you pay for care.</p>

          <div className="handoff">
            <h3>Take this to your AI assistant</h3>
            <p className="muted small">It opens your results and walks you through the tradeoffs, and you can ask follow-up questions.</p>
            <textarea readOnly rows={3} defaultValue={prompt} />
            <div className="actions">
              <CopyButton text={prompt} label="Copy" />
              <a className="btn" href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noreferrer">Open in Claude</a>
              <a className="btn" href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noreferrer">Open in ChatGPT</a>
            </div>
          </div>

          <details className="caveats">
            <summary>What these numbers assume</summary>
            <ul>{ready.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </details>
        </section>
      )}

      <footer>
        Educational estimates, not advice or a recommendation of any plan. Verify plans and prices on{" "}
        <a href="https://connectforhealthco.com">Connect for Health Colorado</a> or with the insurer before enrolling. Under-65, non-Medicaid only. Data: CMS 2026 Colorado plan data.
      </footer>
    </main>
  );
}

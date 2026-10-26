"use client";

import { useState } from "react";
import type { Explanation } from "@/lib/explain";

type Props = { query: Record<string, string> };

const LABEL: Record<string, string> = {
  premium: "Premium only",
  light: "Light year",
  condition: "Managing a condition",
  big: "Big year",
  worst: "Worst case",
  overall: "Overall",
};

export default function ExplainPanel({ query }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<Explanation | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setState("loading");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setData(json as Explanation);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  return (
    <section className="explain">
      <h2>Why these plans? <span className="muted small">explained by Muse Spark (Meta)</span></h2>
      {state === "idle" && (
        <>
          <div className="muted small">
            Muse Spark explains the tradeoffs in plain English. Every dollar figure it quotes is re-checked against the
            plan data before you see it.
          </div>
          <button type="button" onClick={run}>Explain these results</button>
        </>
      )}
      {state === "loading" && <div className="muted">Muse Spark is reading the plan data&hellip; this can take up to a minute.</div>}
      {state === "error" && (
        <div>
          <div className="warn">{error}</div>
          <button type="button" onClick={run}>Try again</button>
        </div>
      )}
      {state === "done" && data && (
        <div>
          {data.summary.text && <p className="lead">{data.summary.text}</p>}
          {data.points.map((p, i) => (
            <div key={i} className={`point ${p.status}`}>
              <div className="tag">
                {LABEL[p.scenario] ?? p.scenario}
                {p.status === "verified" && <span className="ok"> &#10003; figures checked</span>}
                {p.status === "flagged" && <span className="bad"> &#9888; check this figure</span>}
              </div>
              {p.text && <div>{p.text}</div>}
              {p.problems.length > 0 && (
                <ul className="muted small">{p.problems.map((m, j) => <li key={j}>{m}</li>)}</ul>
              )}
            </div>
          ))}
          <div className="muted small">
            {data.stats.verified} of {data.stats.claims} quoted figures matched the plan data
            {data.stats.failed > 0 ? `; ${data.stats.failed} did not and are marked above` : ""}.
          </div>
          <div className="muted small">{data.caveat}</div>
          <div className="muted small">
            AI-generated explanation of estimates. Educational only, not medical or financial advice, and not a
            recommendation of any plan.
          </div>
        </div>
      )}
    </section>
  );
}

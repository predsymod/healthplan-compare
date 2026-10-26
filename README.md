# healthplan-compare

An educational ACA health plan cost comparison tool. Colorado first, built so other states can be added as new datasets.

**Not medical advice and not an eligibility determination.** Estimates only. Verify plans, prices and subsidies with the official exchange (Connect for Health Colorado) or the insurer before enrolling.

Scope: individual-market ACA plans, under-65, non-Medicaid.

## Hackathon contribution log

Built for the Meta AI Developer Hackathon, Oct 26 to Nov 4, 2026. Everything in this repo was created in that window; see the commit history.

- 2026-10-26: Colorado data build script (`scripts/build_co_data.py`), bundled 2026 plan data from the CMS State-Based Exchange QHP PUF (`data/co/`).
- 2026-10-26: Next.js app, scenario-based ranking engine with tests, household sizing (spouse and up to 3 charged children, family deductible and out-of-pocket max).
- 2026-10-26: ZIP lookup (Census ZIP-to-county, CMS county-to-rating-area) and county service-area filtering so only plans sold in the user's county are ranked.
- 2026-10-26: Muse Spark explanation panel (server route, JSON-schema output, every quoted figure re-verified against plan data in code).
- 2026-10-26: Agent interface: an intake decision tree (`src/lib/tree.ts`), income-band subsidy screening, and three tools (`next_question`, `rank_plans`, `compare_plans`) served as a remote MCP server at `/mcp` and as REST at `/api/engine/<tool>`.

## Agent interface

The engine can be driven by any agent that speaks MCP or HTTP. The tools hold no state: the agent passes the answers it has collected each call, and `next_question` says what to ask next (and stops for Medicare or Medicaid). Tool outputs carry the caveats and the exact numbers an agent may quote.

- MCP: `POST /mcp` (streamable HTTP, JSON responses)
- REST: `POST /api/engine/next_question`, `/rank_plans`, `/compare_plans`

No API keys are used by these endpoints.

## Data

Source: CMS State-based Exchange QHP PUF, Colorado, plan year 2026. CMS notes SBE data does not reflect state subsidies such as Colorado Premium Assistance.

Rebuild: `python -I scripts/build_co_data.py 2026` (needs pandas).
ZIP lookup: `python -I scripts/build_co_zips.py` (Census ZCTA-to-county file plus the CMS Colorado rating-area table).

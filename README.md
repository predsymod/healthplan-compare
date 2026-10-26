# healthplan-compare

An educational ACA health plan cost comparison tool. Colorado first, built so other states can be added as new datasets.

**Not medical advice and not an eligibility determination.** Estimates only. Verify plans, prices and subsidies with the official exchange (Connect for Health Colorado) or the insurer before enrolling.

Scope: individual-market ACA plans, under-65, non-Medicaid.

## Hackathon contribution log

Built for the Meta AI Developer Hackathon, Oct 26 to Nov 4, 2026. Everything in this repo was created in that window; see the commit history.

- 2026-10-26: Colorado data build script (`scripts/build_co_data.py`), bundled 2026 plan data from the CMS State-Based Exchange QHP PUF (`data/co/`).
- 2026-10-26: Next.js app, scenario-based ranking engine with tests, household sizing (spouse and up to 3 charged children, family deductible and out-of-pocket max).

## Data

Source: CMS State-based Exchange QHP PUF, Colorado, plan year 2026. CMS notes SBE data does not reflect state subsidies such as Colorado Premium Assistance.

Rebuild: `python -I scripts/build_co_data.py 2026` (needs pandas).

import fs from "node:fs";
import path from "node:path";
import type { Plan, RateRow } from "./rank";

export type Meta = {
  state: string;
  exchange: string;
  planYear: string;
  source: string;
  retrieved: string;
  plans: number;
  note: string;
};

const cache = new Map<string, unknown>();

function load<T>(state: string, file: string): T {
  const key = `${state}/${file}`;
  if (!cache.has(key)) {
    const p = path.join(process.cwd(), "data", state, file);
    cache.set(key, JSON.parse(fs.readFileSync(p, "utf-8")));
  }
  return cache.get(key) as T;
}

export const loadState = (state: string) => ({
  meta: load<Meta>(state, "meta.json"),
  plans: load<Plan[]>(state, "plans.json"),
  rates: load<RateRow[]>(state, "rates.json"),
});

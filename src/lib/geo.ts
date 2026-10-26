export type ZipCounty = { fips: string; name: string; area: number; share: number };
export type ZipIndex = Record<string, { counties: ZipCounty[] }>;
export type ServiceAreaRow = {
  serviceAreaId: string;
  entireState: string | null;
  county: string | null;
};

export function lookupZip(zips: ZipIndex, zip: string): ZipCounty[] | null {
  const hit = zips[zip.trim()];
  return hit && hit.counties.length ? hit.counties : null;
}

// Picks the requested county if it belongs to the ZIP, otherwise the county with the most land.
export function pickCounty(counties: ZipCounty[], fips?: string): ZipCounty {
  return counties.find((c) => c.fips === fips) ?? counties[0];
}

// Service areas the insurer files by county ("Pueblo - 08101"); entire-state areas cover everywhere.
export function serviceAreasFor(rows: ServiceAreaRow[], fips: string): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.entireState === "true" || (r.county ?? "").endsWith(` - ${fips}`)) ids.add(r.serviceAreaId);
  }
  return ids;
}

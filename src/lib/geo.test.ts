import { describe, expect, it } from "vitest";
import { lookupZip, pickCounty, serviceAreasFor } from "./geo";

const zips = {
  "80138": {
    counties: [
      { fips: "08035", name: "Douglas", area: 3, share: 0.55 },
      { fips: "08039", name: "Elbert", area: 3, share: 0.45 },
    ],
  },
};

describe("geo", () => {
  it("looks up a ZIP and returns null for unknown ones", () => {
    expect(lookupZip(zips, " 80138 ")).toHaveLength(2);
    expect(lookupZip(zips, "99999")).toBeNull();
  });
  it("defaults to the largest county and honours a valid choice", () => {
    const c = lookupZip(zips, "80138")!;
    expect(pickCounty(c).name).toBe("Douglas");
    expect(pickCounty(c, "08039").name).toBe("Elbert");
    expect(pickCounty(c, "08001").name).toBe("Douglas");
  });
  it("matches service areas by county FIPS and includes entire-state areas", () => {
    const rows = [
      { serviceAreaId: "S1", entireState: "true", county: null },
      { serviceAreaId: "S2", entireState: "false", county: "Douglas - 08035" },
      { serviceAreaId: "S3", entireState: "false", county: "Mesa - 08077" },
    ];
    expect([...serviceAreasFor(rows, "08035")].sort()).toEqual(["S1", "S2"]);
  });
});

import { describe, expect, it } from "vitest";
import { loadState } from "./data";
import { countyChoices, nextStep } from "./tree";

const base = { coverage: "none", age: 45, spouse_age: 43, children_ages: [4, 6, 8], zip: "80134" };
const full = { ...base, household_income: 90000, expected_care: "ongoing" };

describe("intake tree", () => {
  it("starts by asking about coverage", () => {
    const s = nextStep({});
    expect(s.status).toBe("ask");
    if (s.status === "ask") expect(s.questions.map((q) => q.field)).toEqual(["coverage"]);
  });

  it("stops for Medicare and Medicaid", () => {
    expect(nextStep({ coverage: "medicare" }).status).toBe("stop");
    expect(nextStep({ coverage: "medicaid" }).status).toBe("stop");
  });

  it("stops for someone 65 or older", () => {
    const s = nextStep({ coverage: "none", age: 66, spouse_age: null, children_ages: [], zip: "80134" });
    expect(s.status).toBe("stop");
  });

  it("asks for the whole household in one step", () => {
    const s = nextStep({ coverage: "none" });
    expect(s.status === "ask" && s.questions.map((q) => q.field)).toEqual(["age", "spouse_age", "children_ages", "zip"]);
  });

  it("does not ask again for what it already has", () => {
    const s = nextStep({ coverage: "none", age: 45, zip: "80134" });
    expect(s.status === "ask" && s.questions.map((q) => q.field)).toEqual(["spouse_age", "children_ages"]);
  });

  it("treats null spouse and an empty child list as answered", () => {
    const s = nextStep({ coverage: "none", age: 30, spouse_age: null, children_ages: [], zip: "80202" });
    expect(s.status === "ask" && s.node.id).toBe("income");
  });

  it("reports an invalid answer and asks again", () => {
    const s = nextStep({ ...base, zip: "99999" });
    expect(s.status).toBe("ask");
    if (s.status === "ask") {
      expect(s.issues[0].field).toBe("zip");
      expect(s.questions.map((q) => q.field)).toContain("zip");
    }
  });

  it("accepts children as a comma string", () => {
    const s = nextStep({ ...full, children_ages: "4, 6, 8" });
    expect(s.status).toBe("ready");
  });

  it("asks for income, then expected care, then is ready", () => {
    const a = nextStep(base);
    expect(a.status === "ask" && a.node.id).toBe("income");
    const b = nextStep({ ...base, household_income: null });
    expect(b.status === "ask" && b.node.id).toBe("care");
    expect(nextStep({ ...base, household_income: null, expected_care: "unsure" }).status).toBe("ready");
  });

  it("asks which county only when the ZIP spans different rating areas", () => {
    const { zips } = loadState("co");
    const zip = Object.keys(zips).find((z) => countyChoices(z).length > 0)!;
    expect(zip).toBeDefined();
    const answers = { coverage: "none", age: 40, spouse_age: null, children_ages: [], zip };
    const s = nextStep(answers);
    expect(s.status === "ask" && s.node.id).toBe("county");
    const pick = countyChoices(zip)[0].fips;
    const t = nextStep({ ...answers, county_fips: pick });
    expect(t.status === "ask" && t.node.id).toBe("income");
    expect(nextStep(base).status === "ask" && (nextStep(base) as { node: { id: string } }).node.id).not.toBe("county");
  });
});

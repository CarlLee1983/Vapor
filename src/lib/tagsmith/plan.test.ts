import { describe, expect, it } from "vitest";
import { listTagLines, planNextTag } from "./plan";

describe("planNextTag", () => {
  it("plans the next semver patch from existing tags", () => {
    const plan = planNextTag({
      config: { exists: false, content: null },
      tags: ["v1.0.0", "v1.1.0", "nightly"],
      level: "patch",
    });

    expect(plan.tag).toBe("v1.1.1");
    expect(plan.fromVersion).toBe("1.1.0");
    expect(plan.latestTag).toBe("v1.1.0");
    expect(plan.configSource).toBe("inferred");
    expect(plan.anomalyCount).toBe(0);
  });

  it("uses .tagsmith.json when present", () => {
    const plan = planNextTag({
      config: {
        exists: true,
        content: JSON.stringify({
          pattern: "release/{version}",
          model: { type: "semver", allowPrerelease: true },
          initialVersion: "0.1.0",
          push: true,
        }),
      },
      tags: ["release/1.0.0"],
      level: "minor",
    });

    expect(plan.tag).toBe("release/1.1.0");
    expect(plan.configSource).toBe("file");
  });

  it("plans an explicit version when set-version is provided", () => {
    const plan = planNextTag({
      config: { exists: false, content: null },
      tags: ["v1.0.0", "v1.1.0"],
      explicitVersion: "2.0.0",
    });

    expect(plan.tag).toBe("v2.0.0");
    expect(plan.version).toBe("2.0.0");
    expect(plan.fromVersion).toBe("1.1.0");
  });

  it("rejects explicit versions that are not greater than latest", () => {
    expect(() =>
      planNextTag({
        config: { exists: false, content: null },
        tags: ["v1.0.0", "v1.1.0"],
        explicitVersion: "1.0.5",
      }),
    ).toThrow(/not greater/i);
  });

  it("lists configured tag lines", () => {
    const lines = listTagLines(
      {
        exists: true,
        content: JSON.stringify({
          tags: [
            {
              name: "app",
              pattern: "v{version}",
              model: { type: "semver" },
              initialVersion: "0.1.0",
              push: false,
            },
            {
              name: "release",
              pattern: "release/{version}",
              model: { type: "semver" },
              initialVersion: "0.1.0",
              push: true,
            },
          ],
          default: "release",
        }),
      },
      [],
    );

    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.name === "release")?.isDefault).toBe(true);
  });
});

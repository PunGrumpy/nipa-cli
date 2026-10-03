import { describe, expect, test } from "bun:test";

import { isNewer, shouldCheck, updateNotice } from "../src/lib/update";

describe("isNewer", () => {
  test.each([
    ["0.2.0", "0.1.0", true],
    ["0.10.0", "0.9.9", true],
    ["v1.0.0", "0.9.0", true],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.2.0", false],
    ["0.2.0-beta.1", "0.2.0", false],
  ])("%s newer than %s: %p", (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });
});

describe("shouldCheck", () => {
  const release = { env: {}, isTTY: true, version: "0.1.0" };

  test("checks a release build on a terminal", () => {
    expect(shouldCheck(release)).toBe(true);
  });

  test("skips CI, scripts, dev builds and the opt-out", () => {
    expect(shouldCheck({ ...release, env: { CI: "true" } })).toBe(false);
    expect(shouldCheck({ ...release, isTTY: false })).toBe(false);
    expect(shouldCheck({ ...release, version: "0.0.0" })).toBe(false);
    expect(
      shouldCheck({ ...release, env: { NIPA_NO_UPDATE_CHECK: "1" } })
    ).toBe(false);
  });
});

test("the notice names both versions and links the release", () => {
  const notice = updateNotice("0.2.0", "0.1.0");
  expect(notice).toContain("v0.1.0");
  expect(notice).toContain("v0.2.0");
  expect(notice).toContain("releases/tag/v0.2.0");
});

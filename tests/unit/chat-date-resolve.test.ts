import { describe, expect, it } from "vitest";
import {
  dateRuleNote,
  resolveDate,
  resolveDates,
} from "../../editors/knowledge-vault/chat/core/date-resolve.js";

// 2026-10-22 is a Thursday.
const T = "2026-10-22";

describe("resolveDate", () => {
  const cases: [string, string | null][] = [
    ["we need this wrapped by the end of next month", "2026-11-30"],
    [
      "wrap up by the third of March, put that in as the deadline",
      "2027-03-03",
    ],
    ["move the target date to January 15", "2027-01-15"],
    ["deadline is December 1st", "2026-12-01"],
    ["due 22 October", "2026-10-22"],
    ["the 15th of january 2028", "2028-01-15"],
    ["set it to 2027-01-15", "2027-01-15"],
    ["tomorrow", "2026-10-23"],
    ["the day after tomorrow", "2026-10-24"],
    ["by friday", "2026-10-23"],
    ["next friday", "2026-10-30"],
    ["thursday", "2026-10-29"],
    ["end of this week", "2026-10-23"],
    ["end of next week", "2026-10-30"],
    ["sometime next week", "2026-10-26"],
    ["in two weeks", "2026-11-05"],
    ["10 days from now", "2026-11-01"],
    ["in a month", "2026-11-22"],
    ["end of the month", "2026-10-31"],
    ["end of the year", "2026-12-31"],
    ["end of Q1", "2027-03-31"],
    ["end of the quarter", "2026-12-31"],
    ["by end of march", "2027-03-31"],
    ["next month", "2026-11-01"],
    ["clear the target date", null],
    ["march on with the plan", null],
    ["the second item", null],
    ["a decade of data", null],
  ];
  for (const [u, want] of cases)
    it(`${u} -> ${want}`, () => expect(resolveDate(u, T)).toBe(want));

  it("leaves two different dates unresolved", () => {
    expect(resolveDates("today, not tomorrow", T)).toHaveLength(2);
    expect(resolveDate("today, not tomorrow", T)).toBeNull();
  });

  it("rolls a past day of this year into next year", () => {
    expect(resolveDate("by March 3", "2026-03-04")).toBe("2027-03-03");
    expect(resolveDate("by March 3", "2026-03-03")).toBe("2026-03-03");
  });

  it("rejects a malformed today", () => {
    expect(() => resolveDate("tomorrow", "22/10/2026")).toThrow();
  });
});

describe("dateRuleNote", () => {
  // 2026-10-27 is a Tuesday: "next friday" is Friday of next week.
  it("explains the next <weekday> rule with the resolved date", () => {
    expect(resolveDate("by next friday", "2026-10-27")).toBe("2026-11-06");
    expect(resolveDate("by this friday", "2026-10-27")).toBe("2026-10-30");
    expect(dateRuleNote("wrap this up by next friday", "2026-11-06")).toBe(
      'Date read from your words: 2026-11-06 (Friday). "Next Friday" means Friday of next week (weeks start Monday); say "this Friday" for the coming one.',
    );
  });

  it("names only the date otherwise", () => {
    expect(dateRuleNote("due December 1st", "2026-12-01")).toBe(
      "Date read from your words: 2026-12-01 (Tuesday).",
    );
  });
});

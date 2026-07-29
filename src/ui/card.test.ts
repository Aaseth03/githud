import { describe, expect, it } from "vitest";
import { cardProblems, type Card } from "./card";

function card(over: Partial<Card> = {}): Card {
  return {
    stack: [],
    status: { branch: "main", dirty: 0, last_commit: null, ahead: null },
    milestones: { milestones: [], errors: [] },
    has_milestones: false,
    ...over,
  };
}

describe("card problems", () => {
  it("surfaces milestone parse errors with the file that caused them", () => {
    // The failure-mode contract: the error shows in Activity while the rest of
    // the card still renders.
    const problems = cardProblems(
      card({
        milestones: {
          milestones: [],
          errors: ["line 12: unrecognised status `nearly` for M3"],
        },
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("planning/milestones.md");
    expect(problems[0]).toContain("line 12");
  });

  it("reports nothing for a project with no milestones", () => {
    // Absence is a state, not a failure — most repos have none.
    expect(cardProblems(card({ has_milestones: false }))).toEqual([]);
  });

  it("reports nothing when the milestones parse cleanly", () => {
    const clean = card({
      has_milestones: true,
      milestones: {
        milestones: [
          {
            number: 1,
            title: "A",
            state: "done",
            validation: null,
            done_items: 1,
            total_items: 1,
          },
        ],
        errors: [],
      },
    });

    expect(cardProblems(clean)).toEqual([]);
  });

  it("keeps every error rather than collapsing them", () => {
    const problems = cardProblems(
      card({
        milestones: { milestones: [], errors: ["first", "second", "third"] },
      }),
    );

    expect(problems).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import { formatAttackLootCompletionMessage } from "./attack-job";

describe("formatAttackLootCompletionMessage", () => {
  it("mentionne les joueurs trop faibles", () => {
    const msg = formatAttackLootCompletionMessage(
      { ok: 2, failed: 1, weakPlayer: 1 },
      {
        results: [
          { ok: true },
          { ok: true },
          { ok: false, reason: "weak_player" },
        ],
      },
      3
    );
    expect(msg).toContain("2 OK");
    expect(msg).toContain("trop faible");
  });
});

import { describe, expect, it } from "vitest";
import { derivePlayerActivity } from "../src/galaxy-activity.js";

describe("galaxy-activity", () => {
  it("marque inactif et vacances", () => {
    const vacation = derivePlayerActivity({
      user: { class: ["vacation", "inactive"] },
      lastActivity: "",
    });
    expect(vacation.onVacation).toBe(true);
    expect(vacation.activityLabel).toBe("Vacances");
    expect(vacation.isAttackableInactive).toBe(false);

    const inactive = derivePlayerActivity({
      user: { class: ["inactive"] },
      lastActivity: "",
    });
    expect(inactive.inactive).toBe(true);
    expect(inactive.activityLabel).toBe("Inactif (7j+)");
    expect(inactive.isAttackableInactive).toBe(true);
  });

  it("détecte en ligne et activité récente", () => {
    const online = derivePlayerActivity({
      user: { class: [] },
      lastActivity: "(*)",
      lastActivityNum: 0,
    });
    expect(online.activityLabel).toBe("En ligne");

    const recent = derivePlayerActivity({
      user: { class: [] },
      lastActivity: "15m",
      lastActivityNum: 15,
    });
    expect(recent.activityLabel).toBe("Actif 15m");
    expect(recent.lastActivityMinutes).toBe(15);
  });

  it("gère noob et strong", () => {
    const slot = derivePlayerActivity({
      user: { class: ["noob", "strong"] },
      lastActivity: "",
    });
    expect(slot.isNoob).toBe(true);
    expect(slot.isStrong).toBe(true);
  });
});

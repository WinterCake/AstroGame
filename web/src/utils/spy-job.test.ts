import { describe, expect, it, vi } from "vitest";
import type { Job } from "../api/client";
import {
  formatSpySendCompletionMessage,
  handleSpySendJobUpdate,
  isSpySendJobWarning,
} from "./spy-job";

describe("spy-job", () => {
  describe("formatSpySendCompletionMessage", () => {
    it("affiche OK et total", () => {
      const msg = formatSpySendCompletionMessage({ ok: 3 }, { meta: { ok: 3, total: 5 } });
      expect(msg).toContain("3 OK");
      expect(msg).toContain("5 cible");
    });

    it("détaille les échecs par raison", () => {
      const msg = formatSpySendCompletionMessage(
        { ok: 1 },
        {
          meta: { ok: 1, total: 4, failed: 3, weakPlayer: 1, planetGone: 1, coordsChanged: 1 },
        }
      );
      expect(msg).toContain("3 échec");
      expect(msg).toContain("trop faible");
      expect(msg).toContain("planète absente");
      expect(msg).toContain("coords obsolète");
    });

    it("mentionne les retraits galaxie", () => {
      const msg = formatSpySendCompletionMessage(
        { ok: 2 },
        { meta: { ok: 2, total: 2, removedFromGalaxy: ["1:1:1"] } }
      );
      expect(msg).toContain("1 retirée");
    });
  });

  describe("isSpySendJobWarning", () => {
    it("true si échecs ou retraits", () => {
      expect(isSpySendJobWarning({ meta: { failed: 1, total: 2, ok: 1 } })).toBe(true);
      expect(isSpySendJobWarning({ meta: { removedFromGalaxy: ["1:1:1"], ok: 1, total: 1 } })).toBe(true);
      expect(isSpySendJobWarning({ meta: { ok: 2, total: 2 } })).toBe(false);
    });
  });

  describe("handleSpySendJobUpdate", () => {
    it("met à jour le message en cours", () => {
      const setJobMsg = vi.fn();
      const setJobMsgWarn = vi.fn();
      const job = {
        status: "running",
        progress: { done: 2, total: 5, ok: 2 },
      } as Job;

      handleSpySendJobUpdate(job, 5, setJobMsg, setJobMsgWarn);
      expect(setJobMsgWarn).toHaveBeenCalledWith(false);
      expect(setJobMsg).toHaveBeenCalledWith(expect.stringContaining("2/5"));
    });

    it("gère la complétion avec warning", () => {
      const setJobMsg = vi.fn();
      const setJobMsgWarn = vi.fn();
      const onComplete = vi.fn();
      const job = {
        status: "completed",
        progress: { ok: 1 },
        result: { meta: { ok: 1, total: 2, failed: 1 } },
      } as Job;

      handleSpySendJobUpdate(job, 2, setJobMsg, setJobMsgWarn, onComplete);
      expect(setJobMsgWarn).toHaveBeenCalledWith(true);
      expect(onComplete).toHaveBeenCalled();
    });

    it("affiche erreur si failed", () => {
      const setJobMsg = vi.fn();
      const setJobMsgWarn = vi.fn();
      const job = { status: "failed", error: "timeout" } as Job;

      handleSpySendJobUpdate(job, 1, setJobMsg, setJobMsgWarn);
      expect(setJobMsg).toHaveBeenCalledWith("Erreur : timeout");
      expect(setJobMsgWarn).toHaveBeenCalledWith(false);
    });
  });
});

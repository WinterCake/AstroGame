import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDataDir, destroyTestDataDir } from "../helpers/test-data-dir.js";

describe("API routes", () => {
  let app;

  beforeAll(async () => {
    createTestDataDir();
    const mod = await import("../../server/index.js");
    app = mod.app;
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    destroyTestDataDir();
  });

  describe("GET /api/spy/reports", () => {
    it("filtre sansDefense=true comme filterSpyReports", async () => {
      const res = await app.inject({ method: "GET", url: "/api/spy/reports?sansDefense=true" });
      expect(res.statusCode).toBe(200);
      const coords = res.json().reports.map((r) => r.coords).sort();
      expect(coords).toEqual(["1:1:1"]);
    });

    it("filtre filter=sans-defense", async () => {
      const res = await app.inject({ method: "GET", url: "/api/spy/reports?filter=sans-defense" });
      const coords = res.json().reports.map((r) => r.coords).sort();
      expect(coords).toEqual(["1:1:1"]);
    });

    it("filtre minLoot", async () => {
      const res = await app.inject({ method: "GET", url: "/api/spy/reports?minLoot=500000000" });
      const coords = res.json().reports.map((r) => r.coords);
      expect(coords).toEqual(["1:1:1"]);
    });

    it("paginate les résultats", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/spy/reports?page=1&pageSize=2",
      });
      const body = res.json();
      expect(body.reports).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(2);
    });
  });

  describe("GET /api/attacks/import", () => {
    it("retourne le store normalisé avec today/history", async () => {
      const res = await app.inject({ method: "GET", url: "/api/attacks/import" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attacks).toHaveLength(2);
      expect(body.meta).toBeDefined();
      expect(body).toHaveProperty("attacksToday");
      expect(body).toHaveProperty("attacksHistory");
      expect(body).toHaveProperty("todayCount");
    });
  });
});

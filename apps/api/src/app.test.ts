import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Database } from "./db.js";
import { createApp } from "./app.js";
import type { EditorAuth } from "./auth.js";
import type { EvidenceStore } from "./media.js";

const auth: EditorAuth = {
  async authenticate(email, password) {
    return email === "editor@example.test" && password === "correct password"
      ? "token"
      : null;
  },
  async requireEditor(request, response, next) {
    if (request.header("authorization") === "Bearer token") next();
    else
      response.status(401).json({
        error: { code: "unauthorized", message: "Editor login required." },
      });
  },
};
const evidence: EvidenceStore = {
  async upload() {
    return { publicId: "test", format: "jpg", deliveryType: "authenticated" };
  },
  signedUrl() {
    return "https://example.test/signed";
  },
  async remove() {},
};

function fakeDatabase(): Database {
  const query = async (sql: string): Promise<any> => {
    if (sql.includes("UPDATE route_annotations"))
      return { rowCount: 0, rows: [] };
    if (sql.includes("SELECT revision FROM map_revision"))
      return { rowCount: 1, rows: [{ revision: 7 }] };
    if (sql.includes("FROM buildings ORDER BY"))
      return {
        rowCount: 1,
        rows: [
          {
            id: "building-1",
            name: "Library",
            mapped_level_count: 2,
            footprint: {
              type: "Polygon",
              coordinates: [
                [
                  [75, 22],
                  [75.001, 22],
                  [75.001, 22.001],
                  [75, 22],
                ],
              ],
            },
            approach: [75, 22],
            approach_approximate: true,
            ground_floor_lift_available: null,
          },
        ],
      };
    if (sql.includes("FROM route_features f LEFT JOIN"))
      return {
        rowCount: 1,
        rows: [
          {
            id: "route-1",
            geometry: {
              type: "LineString",
              coordinates: [
                [75, 22],
                [75.001, 22],
              ],
            },
            classification: "main",
            blocked: false,
          },
        ],
      };
    if (sql.includes("FROM public_points")) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
    end: async () => undefined,
  } as unknown as Database;
}

describe("API application", () => {
  const app = createApp({
    database: fakeDatabase(),
    auth,
    evidence,
    webOrigin: "http://localhost:5173",
  });

  it("returns a lean public map contract", async () => {
    const response = await request(app).get("/api/map").expect(200);
    expect(response.body).toMatchObject({
      revision: 7,
      buildings: [{ id: "building-1", name: "Library" }],
      routes: [{ id: "route-1", blocked: false }],
      points: [],
    });
  });

  it("rejects cross-origin mutations before processing input", async () => {
    const response = await request(app)
      .post("/api/editor/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "editor@example.test", password: "correct password" })
      .expect(401);
    expect(response.body.error.code).toBe("unauthorized");
  });

  it("uses the stable not-found error contract", async () => {
    const response = await request(app).get("/does-not-exist").expect(404);
    expect(response.body).toEqual({
      error: { code: "not_found", message: "Endpoint not found." },
    });
  });
});

import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { loadConfig } from "../../apps/api/dist/config.js";
import { createDatabase } from "../../apps/api/dist/db.js";

const WEB_URL = "http://localhost:5173";
const API_URL = "http://localhost:3001";
const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const marker = `Local verification ${new Date().toISOString()}`;
const pointName = `Verification point ${Date.now()}`;
const floorBlockName = `Verification room ${Date.now()}`;
const editorAnnotation = "Verified locally; safe to delete.";
const floorNumber = 199;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let token;
let pointId;
let messageId;
let routeId;
let buildingId;
let originalAnnotation;
let browser;
let evidenceExpected = true;
const results = {};

async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", WEB_URL);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} failed with ${response.status}: ${body?.error?.code ?? "unknown"}`,
    );
  return body;
}

async function jsonApi(path, method, body) {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loginPage(page) {
  await page.goto(`${WEB_URL}/editor`);
  await page.getByLabel("Email").fill(config.EDITOR_EMAIL);
  await page.getByLabel("Password").fill(config.EDITOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("svg.campus-map")).toBeVisible({ timeout: 30_000 });
}

async function cleanup() {
  if (messageId && token)
    await api(`/api/editor/messages/${messageId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  if (pointId && token)
    await api(`/api/editor/points/${pointId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  if (buildingId) {
    await database.query(
      `DELETE FROM floor_layouts WHERE building_id=$1 AND floor_number=$2
       AND layout->'blocks' @> $3::jsonb`,
      [
        buildingId,
        floorNumber,
        JSON.stringify([{ id: "live-verification-block" }]),
      ],
    );
  }
  if (routeId) {
    if (originalAnnotation) {
      await database.query(
        `UPDATE route_annotations SET public_note=$2,blocked=$3,block_reason=$4,expires_at=$5,
         version=$6,updated_at=$7 WHERE route_feature_id=$1`,
        [
          routeId,
          originalAnnotation.public_note,
          originalAnnotation.blocked,
          originalAnnotation.block_reason,
          originalAnnotation.expires_at,
          originalAnnotation.version,
          originalAnnotation.updated_at,
        ],
      );
    } else {
      await database.query(
        "DELETE FROM route_annotations WHERE route_feature_id=$1",
        [routeId],
      );
    }
  }
}

try {
  const health = await api("/api/health");
  if (health.status !== "ok") throw new Error("API health did not return ok");
  const map = await api("/api/map");
  const startBuilding = map.buildings.find(
    (item) => item.name === "Central Library",
  );
  const destinationBuilding = map.buildings.find((item) => item.name === "LT");
  if (!startBuilding || !destinationBuilding)
    throw new Error("Required real OSM buildings are missing");
  buildingId = startBuilding.id;

  const routeRequest = (profile) => ({
    start: { kind: "building", buildingId: startBuilding.id },
    destination: { kind: "building", buildingId: destinationBuilding.id },
    profile,
  });
  const profileResults = {};
  for (const profile of ["healthy", "wheelchair", "heavy_luggage"]) {
    const response = await jsonApi(
      "/api/routing/route",
      "POST",
      routeRequest(profile),
    );
    if (response.status !== "ok" || response.geometry.coordinates.length < 2)
      throw new Error(`${profile} route failed`);
    profileResults[profile] = {
      distanceMeters: response.distanceMeters,
      featureCount: response.featureIds.length,
    };
  }
  const initialRoute = await jsonApi(
    "/api/routing/route",
    "POST",
    routeRequest("healthy"),
  );
  routeId =
    initialRoute.featureIds[Math.floor(initialRoute.featureIds.length / 2)];
  const annotationResult = await database.query(
    "SELECT * FROM route_annotations WHERE route_feature_id=$1",
    [routeId],
  );
  originalAnnotation = annotationResult.rows[0] ?? null;
  const existingFloors = await api(`/api/buildings/${buildingId}/floors`);
  if (existingFloors.some((floor) => floor.number === floorNumber))
    throw new Error(
      `Floor ${floorNumber} already exists; refusing to overwrite it`,
    );

  const login = await jsonApi("/api/editor/login", "POST", {
    email: config.EDITOR_EMAIL,
    password: config.EDITOR_PASSWORD,
  });
  token = login.token;
  const pointCoordinates = map.routes[0].geometry.coordinates[0];
  const point = await jsonApi("/api/editor/points", "POST", {
    name: pointName,
    note: marker,
    coordinates: pointCoordinates,
  });
  pointId = point.id;

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const publicPage = await context.newPage();
  const editorPage = await context.newPage();
  const detailsPage = await context.newPage();
  const consoleErrors = [];
  for (const page of [publicPage, editorPage, detailsPage]) {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
  }
  await mkdir("artifacts", { recursive: true });

  await publicPage.goto(WEB_URL);
  await expect(publicPage.locator(".building-shape")).toHaveCount(
    map.buildings.length,
  );
  await expect(publicPage.locator(".route-visible")).toHaveCount(
    map.routes.length,
  );
  await expect(publicPage.getByText(pointName)).toBeVisible();
  const viewBoxBefore = await publicPage
    .locator("svg.campus-map")
    .getAttribute("viewBox");
  await publicPage.locator("svg.campus-map").hover();
  await publicPage.mouse.wheel(0, -400);
  await expect
    .poll(() => publicPage.locator("svg.campus-map").getAttribute("viewBox"))
    .not.toBe(viewBoxBefore);
  const viewBoxAfterZoom = await publicPage
    .locator("svg.campus-map")
    .getAttribute("viewBox");
  const mapBox = await publicPage.locator("svg.campus-map").boundingBox();
  await publicPage.mouse.move(mapBox.x + 300, mapBox.y + 250);
  await publicPage.mouse.down();
  await publicPage.mouse.move(mapBox.x + 360, mapBox.y + 280, { steps: 4 });
  await publicPage.mouse.up();
  await expect
    .poll(() => publicPage.locator("svg.campus-map").getAttribute("viewBox"))
    .not.toBe(viewBoxAfterZoom);
  await publicPage.getByRole("button", { name: "Fit campus" }).click();

  const buildingSelect = publicPage
    .locator("label")
    .filter({ hasText: "Find a building" })
    .locator("select");
  await buildingSelect.selectOption(startBuilding.id);
  await expect(publicPage.getByText("No data available.")).toBeVisible();
  await publicPage.getByRole("button", { name: "Routing" }).click();
  const routingBuildingSelect = publicPage
    .locator("label")
    .filter({ hasText: /^Building/ })
    .locator("select");
  await routingBuildingSelect.selectOption(startBuilding.id);
  await routingBuildingSelect.selectOption(destinationBuilding.id);
  for (const profile of ["healthy", "wheelchair", "heavy_luggage"]) {
    await publicPage.getByLabel("Travel profile").selectOption(profile);
    await publicPage
      .getByRole("button", { name: "Confirm and calculate" })
      .click();
    await expect(publicPage.locator(".calculated-route")).toBeVisible();
  }
  await publicPage.getByLabel("Travel profile").selectOption("healthy");
  await publicPage
    .getByRole("button", { name: "Confirm and calculate" })
    .click();

  await loginPage(editorPage);
  const routeIndex = map.routes.findIndex((item) => item.id === routeId);
  await editorPage.locator(".route-hit").nth(routeIndex).click();
  await expect(
    editorPage.getByRole("heading", { name: "Route note & status" }),
  ).toBeVisible();
  await editorPage.getByLabel("Public note").fill(marker);
  await editorPage.getByLabel("Block this route").check();
  await editorPage
    .getByLabel("Required reason")
    .fill("Temporary localhost verification block");
  const revisionBefore = await api("/api/routing/revision");
  const replanPromise = publicPage.waitForResponse(
    (response) =>
      response.url().endsWith("/api/routing/route") &&
      response.request().method() === "POST",
    { timeout: 25_000 },
  );
  await editorPage.getByRole("button", { name: "Save block" }).click();
  await expect(editorPage.getByText("Route information saved.")).toBeVisible();
  const replanResponse = await replanPromise;
  const replanned = await replanResponse.json();
  if (replanned.status === "ok" && replanned.featureIds.includes(routeId))
    throw new Error("Live replan continued to use the blocked feature");
  const revisionBlocked = await api("/api/routing/revision");
  if (revisionBlocked.revision <= revisionBefore.revision)
    throw new Error("Blocking did not bump the map revision");

  await detailsPage.goto(WEB_URL);
  await detailsPage.locator(".route-hit").nth(routeIndex).click();
  await expect(detailsPage.getByText(marker)).toBeVisible();
  await expect(
    detailsPage.getByText("Temporary localhost verification block"),
  ).toBeVisible();
  await expect(detailsPage.locator(".route-visible.blocked")).toHaveCount(1);

  await editorPage.getByLabel("Public note").fill("");
  await editorPage.getByLabel("Block this route").uncheck();
  await editorPage.getByRole("button", { name: "Good for Routing" }).click();
  await expect(editorPage.getByText("Route information saved.")).toBeVisible();
  const restoredRoute = await jsonApi(
    "/api/routing/route",
    "POST",
    routeRequest("healthy"),
  );
  if (restoredRoute.status !== "ok")
    throw new Error("The building route did not return after unblocking");
  const restoredDetails = await api(`/api/routes/${routeId}`);
  if (restoredDetails.blocked)
    throw new Error("The route feature remained blocked after unblocking");
  const restoredFeature = map.routes.find((item) => item.id === routeId);
  const restoredFeatureRoute = await jsonApi("/api/routing/route", "POST", {
    start: {
      kind: "coordinate",
      coordinates: restoredFeature.geometry.coordinates[0],
    },
    destination: {
      kind: "coordinate",
      coordinates: restoredFeature.geometry.coordinates.at(-1),
    },
    profile: "healthy",
  });
  if (
    restoredFeatureRoute.status !== "ok" ||
    !restoredFeatureRoute.featureIds.includes(routeId)
  )
    throw new Error(
      "The unblocked feature did not return to routing eligibility",
    );

  await editorPage.getByRole("button", { name: "Floor" }).click();
  await editorPage
    .locator("label")
    .filter({ hasText: "Find a building" })
    .locator("select")
    .selectOption(buildingId);
  await expect(editorPage.getByText(/New floor — add blocks/)).toBeVisible({
    timeout: 30_000,
  });
  editorPage.once(
    "dialog",
    (dialog) => void dialog.accept(String(floorNumber)),
  );
  await editorPage.getByRole("button", { name: "Add floor" }).click();
  await editorPage.getByRole("button", { name: "Add named block" }).click();
  const addBlockDialog = editorPage.getByRole("dialog", { name: "Add block" });
  await addBlockDialog.getByLabel("Block name").fill(floorBlockName);
  await addBlockDialog.getByRole("button", { name: "Add block" }).click();
  await editorPage.getByRole("button", { name: "Save floor" }).click();
  await expect(
    editorPage.getByText(`Floor ${floorNumber} saved.`),
  ).toBeVisible();
  await database.query(
    `UPDATE floor_layouts SET layout=jsonb_set(layout,'{blocks,0,id}',to_jsonb('live-verification-block'::text))
     WHERE building_id=$1 AND floor_number=$2`,
    [buildingId, floorNumber],
  );
  await detailsPage.reload();
  await detailsPage
    .locator("label")
    .filter({ hasText: "Find a building" })
    .locator("select")
    .selectOption(buildingId);
  await detailsPage.getByLabel("Floor").selectOption(String(floorNumber));
  await expect(detailsPage.getByText(floorBlockName)).toBeVisible();

  await detailsPage.getByRole("button", { name: "Report" }).click();
  const reportMap = detailsPage.locator("svg.campus-map");
  const reportBox = await reportMap.boundingBox();
  await reportMap.click({
    position: { x: reportBox.width * 0.48, y: reportBox.height * 0.42 },
  });
  await expect(detailsPage.getByText("Location selected")).toBeVisible();
  await detailsPage.getByLabel("Your note").fill(marker);
  await detailsPage.getByLabel("Photo (optional)").setInputFiles({
    name: "verification.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await detailsPage.getByRole("button", { name: "Send for review" }).click();
  const submittedWithEvidence = await Promise.race([
    detailsPage
      .getByText(/note was received/i)
      .waitFor({ timeout: 45_000 })
      .then(() => true),
    detailsPage
      .getByText("The service is temporarily unavailable.")
      .waitFor({ timeout: 45_000 })
      .then(() => false),
  ]);
  if (!submittedWithEvidence) {
    evidenceExpected = false;
    await detailsPage.getByLabel("Photo (optional)").setInputFiles([]);
    await detailsPage.getByRole("button", { name: "Send for review" }).click();
    await expect(detailsPage.getByText(/note was received/i)).toBeVisible({
      timeout: 30_000,
    });
  }

  const messages = await api("/api/editor/messages");
  const testMessage = messages.find((item) => item.originalText === marker);
  if (!testMessage) throw new Error("Visitor message is missing");
  if (evidenceExpected && !testMessage.hasEvidence)
    throw new Error("Authenticated evidence metadata is missing");
  messageId = testMessage.id;
  await editorPage.reload();
  await loginPage(editorPage);
  await editorPage.getByRole("button", { name: "Inbox" }).click();
  await editorPage.getByText(marker).click();
  if (evidenceExpected) {
    const evidence = editorPage.locator("img.evidence");
    await expect(evidence).toBeVisible();
    await expect
      .poll(() => evidence.evaluate((image) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  await editorPage.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(editorPage.getByText("Message updated.")).toBeVisible();
  await editorPage
    .getByRole("button", { name: "Address", exact: true })
    .click();
  editorPage.once("dialog", (dialog) => void dialog.accept(editorAnnotation));
  await editorPage.getByRole("button", { name: "Alter annotation" }).click();
  await expect(editorPage.getByText(editorAnnotation)).toBeVisible();
  const updatedMessages = await api("/api/editor/messages");
  const updatedMessage = updatedMessages.find((item) => item.id === messageId);
  if (
    updatedMessage?.originalText !== marker ||
    updatedMessage?.status !== "addressed"
  )
    throw new Error(
      "Message status changed incorrectly or original text was altered",
    );
  editorPage.once("dialog", (dialog) => void dialog.accept());
  await editorPage.getByRole("button", { name: "Delete" }).click();
  await expect(editorPage.getByText("Message deleted.")).toBeVisible();
  messageId = undefined;
  if (
    (await api("/api/editor/messages")).some(
      (item) => item.originalText === marker,
    )
  )
    throw new Error("Test message remained after deletion");

  await publicPage.setViewportSize({ width: 390, height: 844 });
  if (
    await publicPage.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth !==
        globalThis.document.documentElement.clientWidth,
    )
  )
    throw new Error("Portrait layout has horizontal overflow");
  await publicPage.screenshot({
    path: "artifacts/live-public-portrait.png",
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 844, height: 390 });
  if (
    await publicPage.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth !==
        globalThis.document.documentElement.clientWidth,
    )
  )
    throw new Error("Landscape layout has horizontal overflow");
  await expect(
    publicPage.getByRole("button", { name: "Confirm and calculate" }),
  ).toBeVisible();
  await publicPage.screenshot({
    path: "artifacts/live-public-landscape-844x390.png",
    fullPage: true,
  });
  await editorPage.setViewportSize({ width: 844, height: 390 });
  await editorPage.screenshot({
    path: "artifacts/live-editor-landscape-844x390.png",
    fullPage: true,
  });
  await detailsPage.setViewportSize({ width: 1440, height: 900 });
  await detailsPage.screenshot({
    path: "artifacts/live-public-desktop.png",
    fullPage: true,
  });
  if (consoleErrors.length)
    throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);

  results.health = "ok";
  results.map = { buildings: map.buildings.length, routes: map.routes.length };
  results.profiles = profileResults;
  results.svg = { wheelZoom: true, pointerPan: true, fitCampus: true };
  results.routeBlock = {
    publicDetails: true,
    revisionReplan: true,
    restored: true,
  };
  results.floor = { savedAndViewed: true, floorNumber };
  results.point = { publicVisibility: true };
  results.message = {
    evidenceLoaded: evidenceExpected,
    keepAddressAlterDelete: true,
    originalPreserved: true,
  };
  results.viewports = ["1440x900", "390x844", "844x390"];
  results.consoleErrors = 0;
} finally {
  await cleanup();
  if (browser) await browser.close();
  await database.end();
}

console.log(JSON.stringify(results));

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { FloorLayout, MapPayload } from "@campus-access/shared";
import { parseOsmImportModel } from "../../apps/api/src/osm/parse.js";

const xml = await readFile(path.resolve("apps/api/data/campus.osm"), "utf8");
const source = parseOsmImportModel(xml);
const payload: MapPayload = {
  revision: 1,
  buildings: source.buildings.map((item) => ({
    id: item.id,
    name: item.name,
    levels: item.levels,
    footprint: item.footprint,
    approach: item.approach,
    approachApproximate: item.approachApproximate,
    groundFloorLiftAvailable: item.groundFloorLiftAvailable,
  })),
  routes: source.routes.map((item) => ({
    id: item.id,
    geometry: item.geometry,
    classification: item.classification,
    blocked: false,
  })),
  points: [
    {
      id: "point-gate",
      name: "Information point",
      note: "Ask here for campus directions.",
      coordinates: source.routes[0]!.geometry.coordinates[0] as [
        number,
        number,
      ],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ],
};

let savedLayout: FloorLayout = {
  canvasWidth: 800,
  canvasHeight: 520,
  blocks: [
    {
      id: "reading",
      name: "Reading room",
      x: 0.1,
      y: 0.15,
      width: 0.4,
      height: 0.3,
    },
  ],
};

async function respond(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const method = route.request().method();
  if (url.pathname === "/api/map") return route.fulfill({ json: payload });
  if (url.pathname === "/api/routing/revision")
    return route.fulfill({ json: { revision: 1 } });
  if (url.pathname === "/api/routing/route") {
    const geometry = source.routes[0]!.geometry;
    return route.fulfill({
      json: {
        status: "ok",
        revision: 1,
        featureIds: [source.routes[0]!.id],
        geometry,
        distanceMeters: 84,
        directions: [
          "Continue on the campus path.",
          "Arrive after about 84 m.",
        ],
        warnings: [],
        startApproachApproximate: false,
        destinationApproachApproximate: false,
      },
    });
  }
  if (/^\/api\/routes\//.test(url.pathname)) {
    return route.fulfill({
      json: {
        id: url.pathname.split("/").at(-1),
        publicNote: "Main shaded walkway.",
        blocked: false,
        blockReason: null,
        expiresAt: null,
        classification: "main",
        surface: null,
        stairs: "no",
        slopePercent: null,
        widthMeters: null,
      },
    });
  }
  const floorMatch = /^\/api\/buildings\/([^/]+)\/floors(?:\/(-?\d+))?$/.exec(
    url.pathname,
  );
  if (floorMatch) {
    if (!floorMatch[2])
      return route.fulfill({
        json: [{ number: 0, version: 1, updatedAt: new Date(0).toISOString() }],
      });
    return route.fulfill({
      json: {
        buildingId: floorMatch[1],
        number: Number(floorMatch[2]),
        version: 1,
        updatedAt: new Date(0).toISOString(),
        layout: savedLayout,
      },
    });
  }
  if (url.pathname === "/api/editor/login")
    return route.fulfill({ json: { token: "editor-test-token" } });
  if (
    method === "PUT" &&
    /\/api\/editor\/buildings\/.+\/floors\//.test(url.pathname)
  ) {
    savedLayout = route.request().postDataJSON() as FloorLayout;
    return route.fulfill({
      json: { saved: true, version: 2, updatedAt: new Date().toISOString() },
    });
  }
  if (url.pathname === "/api/editor/messages")
    return route.fulfill({ json: [] });
  if (url.pathname === "/api/visitor-messages")
    return route.fulfill({ status: 201, json: { received: true } });
  return route.fulfill({ status: 204 });
}

async function prepare(page: Page): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("http://127.0.0.1:3001/api/**", respond);
  return consoleErrors;
}

test.beforeAll(async () => {
  await mkdir(path.resolve("artifacts"), { recursive: true });
});

test("public SVG map works at desktop, portrait, and 844×390 landscape", async ({
  page,
}) => {
  const consoleErrors = await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("svg.campus-map")).toBeVisible();
  await expect(page.locator(".building-shape")).toHaveCount(
    payload.buildings.length,
  );
  await expect(page.locator(".route-visible")).toHaveCount(
    payload.routes.length,
  );
  await page
    .getByLabel("Search buildings")
    .first()
    .selectOption(payload.buildings[0]!.id);
  await expect(page.getByText("Reading room")).toBeVisible();
  await page.screenshot({
    path: "artifacts/public-desktop.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "artifacts/public-portrait.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "Routing" })).toBeVisible();
  await page.getByRole("button", { name: "Routing" }).click();
  await expect(page.getByRole("button", { name: "Show route" })).toBeVisible();
  const startCard = page.locator(".endpoint-card.start").first();
  await startCard.getByRole("button", { name: "Search building" }).click();
  await startCard
    .getByLabel("Search buildings")
    .fill(payload.buildings[0]!.name);
  await startCard.getByRole("option").first().click();
  await startCard.getByRole("button", { name: "Use selection" }).click();
  const destinationCard = page.locator(".endpoint-card.destination").first();
  await destinationCard
    .getByRole("button", { name: "Search building" })
    .click();
  await destinationCard
    .getByLabel("Search buildings")
    .fill(payload.buildings[1]!.name);
  await destinationCard.getByRole("option").first().click();
  await destinationCard.getByRole("button", { name: "Use selection" }).click();
  await page.getByRole("button", { name: "Show route" }).click();
  await expect(page.locator(".calculated-route")).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await page.screenshot({
    path: "artifacts/redesign-public-routing-844x390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "artifacts/redesign-public-routing.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Send Note" }).click();
  await expect(
    page.getByRole("heading", { name: "Send a campus note" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/redesign-public-send-note-844x390.png",
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});

test("point markers align with clicks, drags pan, and all endpoint methods compose", async ({
  page,
}) => {
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const routeBodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/routing/route"))
      routeBodies.push(request.postDataJSON());
  });
  await page.goto("/");
  const map = page.locator("svg.campus-map");
  await page.getByRole("button", { name: "Send Note" }).click();
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  const click = { x: box!.width * 0.72, y: box!.height * 0.42 };
  await map.click({ position: click });
  const marker = page.locator('[data-testid="picked-marker"] circle');
  await expect(marker).toBeVisible();
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  expect(
    Math.hypot(
      markerBox!.x + markerBox!.width / 2 - (box!.x + click.x),
      markerBox!.y + markerBox!.height / 2 - (box!.y + click.y),
    ),
  ).toBeLessThanOrEqual(6);
  const beforePan = await map.getAttribute("viewBox");
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.62,
    box!.y + box!.height * 0.52,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(() => map.getAttribute("viewBox")).not.toBe(beforePan);

  await page.getByRole("button", { name: "Routing" }).click();
  type Method = "search" | "point" | "building";
  const methods: Method[] = ["search", "point", "building"];
  const select = async (
    endpoint: "start" | "destination",
    method: Method,
    buildingIndex: number,
  ) => {
    const card = page.locator(`.endpoint-card.${endpoint}`).first();
    if (method === "search") {
      await card.getByRole("button", { name: "Search building" }).click();
      await card
        .getByLabel("Search buildings")
        .fill(payload.buildings[buildingIndex]!.name);
      await card.getByRole("option").first().click();
      await card.getByRole("button", { name: "Use selection" }).click();
    } else if (method === "building") {
      await card.getByRole("button", { name: "Pick building on map" }).click();
      await page.locator(".building-shape").nth(buildingIndex).click();
      await card.getByRole("button", { name: "Use selection" }).click();
    } else {
      await card.getByRole("button", { name: "Pick point on map" }).click();
      await map.click({
        position: {
          x: box!.width * (endpoint === "start" ? 0.66 : 0.78),
          y: box!.height * 0.5,
        },
      });
      await card.getByRole("button", { name: "Use this point" }).click();
    }
  };
  for (const startMethod of methods) {
    for (const destinationMethod of methods) {
      await select("start", startMethod, 0);
      await select("destination", destinationMethod, 1);
      await page.getByRole("button", { name: "Show route" }).click();
      await expect(page.locator(".calculated-route")).toBeVisible();
      await page.getByRole("button", { name: "Clear route" }).click();
    }
  }
  expect(routeBodies).toHaveLength(9);
});

test("editor saves a Konva floor explicitly and keeps controls reachable", async ({
  page,
}) => {
  const consoleErrors = await prepare(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/editor");
  await page.getByLabel("Email").fill("editor@example.test");
  await page.getByLabel("Password").fill("correct password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("svg.campus-map")).toBeVisible();
  await page.screenshot({
    path: "artifacts/redesign-editor-routes.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add point" }).click();
  const editorBuilding = page.locator(".building-shape").first();
  const editorBuildingBox = await editorBuilding.boundingBox();
  expect(editorBuildingBox).not.toBeNull();
  const editorClick = {
    x: editorBuildingBox!.x + editorBuildingBox!.width / 2,
    y: editorBuildingBox!.y + editorBuildingBox!.height / 2,
  };
  await page.mouse.click(editorClick.x, editorClick.y);
  const editorMarker = page.locator('[data-testid="picked-marker"] circle');
  await expect(editorMarker).toBeVisible();
  const editorMarkerBox = await editorMarker.boundingBox();
  expect(editorMarkerBox).not.toBeNull();
  expect(
    Math.hypot(
      editorMarkerBox!.x + editorMarkerBox!.width / 2 - editorClick.x,
      editorMarkerBox!.y + editorMarkerBox!.height / 2 - editorClick.y,
    ),
  ).toBeLessThanOrEqual(6);
  await page.screenshot({
    path: "artifacts/editor-point-alignment.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Floor design" }).click();
  await expect(
    page.getByRole("heading", { name: "Interior floor design" }),
  ).toBeVisible();
  await page.getByLabel("Choose building").fill(payload.buildings[0]!.name);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const addBlockButton = page.getByRole("button", { name: "Add named block" });
  await addBlockButton.click();
  const addBlockDialog = page.getByRole("dialog", { name: "Add block" });
  await expect(addBlockDialog).toBeVisible();
  const blockName = addBlockDialog.getByLabel("Block name");
  await expect(blockName).toBeFocused();
  await blockName.fill("   ");
  await addBlockDialog.getByRole("button", { name: "Add block" }).click();
  await expect(addBlockDialog.getByRole("alert")).toHaveText(
    "Enter a block name.",
  );
  await blockName.fill("x".repeat(101));
  await blockName.press("Enter");
  await expect(addBlockDialog.getByRole("alert")).toHaveText(
    "Use 100 characters or fewer.",
  );
  await blockName.press("Escape");
  await expect(addBlockDialog).toBeHidden();
  await expect(addBlockButton).toBeFocused();
  await addBlockButton.click();
  await page
    .getByRole("dialog", { name: "Add block" })
    .getByLabel("Block name")
    .fill("Accessible services");
  await page
    .getByRole("dialog", { name: "Add block" })
    .getByRole("button", { name: "Add block" })
    .click();
  await expect(
    page.getByLabel("Selected block").getByLabel("Name"),
  ).toHaveValue("Accessible services");
  await page.getByRole("button", { name: "Save floor" }).click();
  await expect(page.getByText("Floor 0 saved.")).toBeVisible();
  await page.screenshot({
    path: "artifacts/redesign-editor-floor.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole("button", { name: "Save floor" })).toBeVisible();
  await addBlockButton.click();
  await expect(addBlockDialog).toBeVisible();
  const dialogBox = await addBlockDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(844);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "artifacts/editor-block-dialog-844x390.png",
    fullPage: true,
  });
  await addBlockDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(addBlockDialog).toBeHidden();
  await page.screenshot({
    path: "artifacts/editor-landscape-844x390.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/redesign-editor-notifications-844x390.png",
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});

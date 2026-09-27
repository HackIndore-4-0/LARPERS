import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { loadConfig } from "../../apps/api/dist/config.js";

const WEB_URL = "http://localhost:5173";
const API_URL = "http://localhost:3001";
const config = loadConfig();
const marker = `Local verification ${new Date().toISOString()}`;
const annotation = "Verified locally; safe to delete.";
let token;
let messageId;
let browser;

async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", WEB_URL);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} failed with ${response.status}`,
    );
  return body;
}

try {
  token = (
    await api("/api/editor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: config.EDITOR_EMAIL,
        password: config.EDITOR_PASSWORD,
      }),
    })
  ).token;
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const publicPage = await context.newPage();
  const editorPage = await context.newPage();
  const consoleErrors = [];
  for (const page of [publicPage, editorPage]) {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
  }

  await publicPage.goto(WEB_URL);
  await expect(publicPage.locator("svg.campus-map")).toBeVisible({
    timeout: 30_000,
  });
  await publicPage.getByRole("button", { name: "Report" }).click();
  const map = publicPage.locator("svg.campus-map");
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * 0.45, y: box.height * 0.4 } });
  await expect(publicPage.getByText("Location selected")).toBeVisible();
  await publicPage.getByLabel("Your note").fill(marker);
  await publicPage.getByRole("button", { name: "Send for review" }).click();
  await expect(publicPage.getByText(/note was received/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(publicPage.getByLabel("Your note")).toHaveValue("");

  const created = (await api("/api/editor/messages")).find(
    (item) => item.originalText === marker,
  );
  if (!created || created.hasEvidence)
    throw new Error("Text-only visitor message was not persisted correctly");
  messageId = created.id;

  await editorPage.goto(`${WEB_URL}/editor`);
  await editorPage.getByLabel("Email").fill(config.EDITOR_EMAIL);
  await editorPage.getByLabel("Password").fill(config.EDITOR_PASSWORD);
  await editorPage.getByRole("button", { name: "Sign in" }).click();
  await expect(editorPage.locator("svg.campus-map")).toBeVisible({
    timeout: 30_000,
  });
  await editorPage.getByRole("button", { name: "Inbox" }).click();
  await editorPage.getByRole("button").filter({ hasText: marker }).click();
  await expect(
    editorPage.getByRole("paragraph").filter({ hasText: marker }),
  ).toBeVisible();
  await editorPage.getByRole("button", { name: "Keep", exact: true }).click();
  await editorPage
    .getByRole("button", { name: "Address", exact: true })
    .click();
  editorPage.once("dialog", (dialog) => void dialog.accept(annotation));
  await editorPage.getByRole("button", { name: "Alter annotation" }).click();
  await expect(editorPage.getByText(annotation)).toBeVisible();
  const updated = (await api("/api/editor/messages")).find(
    (item) => item.id === messageId,
  );
  if (
    updated?.originalText !== marker ||
    updated?.status !== "addressed" ||
    updated?.editorAnnotation !== annotation
  )
    throw new Error(
      "Inbox actions did not preserve the original message correctly",
    );

  await mkdir("artifacts", { recursive: true });
  await publicPage.screenshot({
    path: "artifacts/live-public-desktop.png",
    fullPage: true,
  });
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
  await publicPage.screenshot({
    path: "artifacts/live-public-landscape-844x390.png",
    fullPage: true,
  });
  await editorPage.setViewportSize({ width: 844, height: 390 });
  await editorPage.screenshot({
    path: "artifacts/live-editor-landscape-844x390.png",
    fullPage: true,
  });

  editorPage.once("dialog", (dialog) => void dialog.accept());
  await editorPage.getByRole("button", { name: "Delete" }).click();
  await expect(editorPage.getByText("Message deleted.")).toBeVisible();
  messageId = undefined;
  if (
    (await api("/api/editor/messages")).some(
      (item) => item.originalText === marker,
    )
  )
    throw new Error("The test message remained after deletion");
  if (consoleErrors.length)
    throw new Error(`Browser console errors: ${consoleErrors.join(" | ")}`);

  console.log(
    JSON.stringify({
      textMessage: "submitted",
      inboxActions: ["keep", "address", "alter", "delete"],
      originalPreserved: true,
      viewports: ["1440x900", "390x844", "844x390"],
      horizontalOverflow: false,
      consoleErrors: 0,
    }),
  );
} finally {
  if (messageId && token)
    await api(`/api/editor/messages/${messageId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  if (browser) await browser.close();
}

import { readFile } from "node:fs/promises";
import { v2 as cloudinary } from "cloudinary";
import { loadConfig } from "./config.js";
import { createEvidenceStore } from "./media.js";

const evidence = createEvidenceStore(loadConfig());
let publicId: string | undefined;
let apiAuthentication = "not_checked";
try {
  try {
    await cloudinary.api.ping();
    apiAuthentication = "ok";
  } catch {
    apiAuthentication = "failed";
  }
  const bytes = await readFile(
    new URL("../../../artifacts/public-portrait.png", import.meta.url),
  );
  const uploaded = await evidence.upload(bytes);
  publicId = uploaded.publicId;
  const signedUrl = evidence.signedUrl(
    uploaded.publicId,
    uploaded.format,
    uploaded.deliveryType,
  );
  const response = await fetch(signedUrl);
  console.log(
    JSON.stringify({
      upload: "ok",
      apiAuthentication,
      authenticatedDeliveryStatus: response.status,
      contentTypeIsImage:
        response.headers.get("content-type")?.startsWith("image/") ?? false,
    }),
  );
} catch (caught) {
  const value = caught as Record<string, unknown> | null;
  const message = typeof value?.message === "string" ? value.message : "";
  const category = /invalid signature/i.test(message)
    ? "invalid_signature"
    : /unknown api key|api key.*invalid/i.test(message)
      ? "invalid_api_key"
      : /disabled|suspended/i.test(message)
        ? "account_disabled"
        : /not allowed|denied|restricted|forbidden/i.test(message)
          ? "operation_forbidden"
          : /cloud name|unknown cloud/i.test(message)
            ? "invalid_cloud_name"
            : "unclassified_provider_error";
  console.error(
    JSON.stringify({
      upload: "failed",
      apiAuthentication,
      errorType: caught instanceof Error ? caught.name : typeof caught,
      statusCode:
        typeof value?.http_code === "number"
          ? value.http_code
          : typeof value?.status === "number"
            ? value.status
            : null,
      category,
      metadataKeys: value ? Object.keys(value).sort() : [],
    }),
  );
  process.exitCode = 1;
} finally {
  if (publicId) await evidence.remove(publicId).catch(() => undefined);
}

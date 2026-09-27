import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const root = resolve("apps/web/dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const requested = resolve(
    root,
    `.${new URL(request.url ?? "/", "http://localhost").pathname}`,
  );
  const safePath =
    requested !== root && requested.startsWith(root) && existsSync(requested)
      ? requested
      : resolve(root, "index.html");
  response.setHeader(
    "Content-Type",
    types[extname(safePath)] ?? "application/octet-stream",
  );
  createReadStream(safePath).pipe(response);
}).listen(4173, "127.0.0.1");

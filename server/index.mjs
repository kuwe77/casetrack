import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
export function createLocalServer({ dataDir, devPort = null }) {
  const store = openStore(resolve(dataDir, "casetrack.sqlite"));
  async function body(req, limit) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw Object.assign(Error("JSON required."), { status: 415 });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit)
        throw Object.assign(Error("Record is too large."), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(Error("Invalid JSON."), { status: 400 });
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("Cache-Control", "no-store");
    try {
      const port = server.address()?.port;
      const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (devPort)
        allowedHosts.push(`localhost:${devPort}`, `127.0.0.1:${devPort}`);
      const host = req.headers.host || "";
      if (!allowedHosts.includes(host))
        return json(res, 403, { error: "Local access only." });
      const path = new URL(req.url, `http://${host}`).pathname;
      if (path.startsWith("/api/")) {
        if (
          req.headers["x-casetrack-client"] !== "local" ||
          (req.headers.origin && req.headers.origin !== `http://${host}`) ||
          (req.headers["sec-fetch-site"] &&
            !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
        )
          return json(res, 403, {
            error: "Request must come from the local dashboard.",
          });
        if (path === "/api/setup" && req.method === "POST") {
          if (store.initialized())
            return json(res, 409, { error: "A workspace already exists." });
          const payload = await body(req, 8192);
          try {
            await store.setup(payload);
            return json(res, 200, { ok: true });
          } catch (e) {
            return json(res, 400, {
              error:
                e.name === "ZodError"
                  ? "Enter a workspace name (1–150 characters)."
                  : e.message,
            });
          }
        }
        if (path === "/api/workspace" && req.method === "GET")
          return json(res, 200, store.read());
        const route = path.slice(5);
        if (
          req.method !== "POST" ||
          !["cases", "agents", "tasks", "firm", "notes"].includes(route)
        )
          return json(res, 404, { error: "Unknown operation." });
        const payload = await body(req, 128 * 1024);
        try {
          return json(res, 200, store.mutate(route, payload));
        } catch (e) {
          return json(res, 400, {
            error:
              e.name === "ZodError"
                ? "Invalid record. Check required fields and dates."
                : e.message,
          });
        }
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, 405, { error: "Method not allowed." });
      let file = resolve(dist, "." + decodeURIComponent(path));
      if (file !== dist && !file.startsWith(dist + sep))
        return json(res, 403, { error: "Forbidden." });
      try {
        if (!(await stat(file)).isFile()) file = resolve(dist, "index.html");
      } catch {
        if (extname(path)) return json(res, 404, { error: "File not found." });
        file = resolve(dist, "index.html");
      }
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (e) {
      json(res, e.status || 500, {
        error: e.status ? e.message : "Could not complete request.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => {
    store.close();
  });
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createLocalServer({
    dataDir: process.env.CASETRACK_DATA_DIR || resolve(root, "data"),
    devPort: process.env.CASETRACK_DEV === "true" ? 5173 : null,
  });
  const port = Number(process.env.PORT || 4173);
  server.listen(port, "127.0.0.1", () =>
    console.log(`CaseTrack is running at http://localhost:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}

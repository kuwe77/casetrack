import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
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
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function createLocalServer({
  dataDir,
  idleMs = 15 * 60 * 1000,
  devPort = null,
}) {
  const store = openStore(resolve(dataDir, "casetrack.sqlite"));
  let session = null,
    authBusy = false,
    nextAttempt = 0,
    failures = 0;
  const lock = () => {
    session = null;
    store.lock();
  };
  const expire = () => {
    if (session && Date.now() >= session.expires) lock();
  };
  const timer = setInterval(expire, 1000);
  timer.unref();
  const cookieName = "casetrack_session";
  const cookie = (value) =>
    `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api`;
  const authenticate = (req) => {
    expire();
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    return Boolean(
      token && token.length === 64 && session && hash(token) === session.hash,
    );
  };
  const openSession = (res) => {
    const token = randomBytes(32).toString("hex");
    session = { hash: hash(token), expires: Date.now() + idleMs };
    res.setHeader("Set-Cookie", cookie(token));
  };
  async function body(req, limit) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw Object.assign(Error("JSON required."), { status: 415 });
    let value = "";
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit)
        throw Object.assign(Error("Record is too large."), { status: 413 });
      value += chunk;
    }
    try {
      return JSON.parse(value);
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
        const authorized = authenticate(req);
        if (path === "/api/session" && req.method === "GET")
          return json(res, 200, {
            initialized: store.initialized(),
            authenticated: authorized,
          });
        if (
          ["/api/setup", "/api/unlock"].includes(path) &&
          req.method === "POST"
        ) {
          if (authBusy || Date.now() < nextAttempt) {
            res.setHeader(
              "Retry-After",
              String(Math.max(1, Math.ceil((nextAttempt - Date.now()) / 1000))),
            );
            return json(res, 429, {
              error: "Please wait before trying again.",
            });
          }
          authBusy = true;
          try {
            const payload = await body(req, 8192);
            if (path === "/api/setup") {
              if (store.initialized())
                return json(res, 409, { error: "A workspace already exists." });
              await store.setup(payload);
            } else await store.unlock(payload?.password);
            failures = 0;
            nextAttempt = 0;
            openSession(res);
            return json(res, 200, { ok: true });
          } catch {
            failures++;
            nextAttempt =
              Date.now() +
              Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6));
            return json(res, 400, {
              error:
                path === "/api/setup"
                  ? "Could not create workspace. Enter a name and a passphrase of at least 14 characters."
                  : "Incorrect passphrase or damaged database.",
            });
          } finally {
            authBusy = false;
          }
        }
        if (!authorized)
          return json(res, 401, {
            error: "Workspace locked. Unlock it to continue.",
          });
        session.expires = Date.now() + idleMs;
        if (path === "/api/lock" && req.method === "POST") {
          lock();
          res.setHeader("Set-Cookie", cookie("") + "; Max-Age=0");
          return json(res, 200, { ok: true });
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
        // Authorization can expire or be revoked while a request body is arriving.
        if (!authenticate(req))
          return json(res, 401, {
            error: "Workspace locked. Unlock it to continue.",
          });
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
    clearInterval(timer);
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

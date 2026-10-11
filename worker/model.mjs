import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decision, prompt } from "./policy.mjs";
export function interpret(text, context, env = process.env) {
  return new Promise((resolve, reject) => {
    // The process receives no WhatsApp key or database capability. Never interpolate an inquiry into a shell.
    const childEnv = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "LANG",
        "HERMES_HOME",
        "HERMES_SOURCE",
        "CASETRACK_MODEL_PROVIDER",
        "CASETRACK_MODEL",
      ]
        .filter((k) => env[k])
        .map((k) => [k, env[k]]),
    );
    const child = spawn(
      env.HERMES_PYTHON || "python3",
      [fileURLToPath(new URL("./hermes-bridge.py", import.meta.url))],
      { env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 75000);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.length > 16000) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Hermes bridge unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error();
        resolve(decision(out));
      } catch {
        reject(Error("Hermes returned no valid decision"));
      }
    });
    child.stdin.end(JSON.stringify({ messages: prompt(text, context) }));
  });
}

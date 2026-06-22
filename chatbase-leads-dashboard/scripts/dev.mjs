/**
 * Local dev: Firebase hosting (5000) + functions (5001) in one command.
 * Combined `firebase emulators:start --only hosting,functions` can fail on some setups;
 * this starts each emulator in its own process (same as two terminals).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firebase = process.platform === "win32" ? "firebase.cmd" : "firebase";

function run(args, label) {
  const child = spawn(firebase, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });
  return child;
}

console.log("Starting functions emulator (port 5001)…");
const functionsProc = run(["emulators:start", "--only", "functions"], "functions");

setTimeout(() => {
  console.log("Starting hosting emulator (port 5000)…");
  console.log("Open http://127.0.0.1:5000");
  run(["emulators:start", "--only", "hosting"], "hosting");
}, 4000);

process.on("SIGINT", () => {
  functionsProc.kill("SIGINT");
  process.exit(0);
});

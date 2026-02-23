import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

async function removeIfExists(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`[lancedb-prune] removed ${dirPath}`);
  } catch (error) {
    console.warn(`[lancedb-prune] failed to remove ${dirPath}:`, error);
  }
}

function detectMusl() {
  if (process.platform !== "linux") {
    return false;
  }

  const report = process.report?.getReport?.();
  const glibcVersion = report?.header?.glibcVersionRuntime;

  if (glibcVersion) {
    return false;
  }

  try {
    const lddOutput = execSync("ldd --version", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return /musl/i.test(lddOutput);
  } catch {
    return false;
  }
}

async function main() {
  if (process.platform !== "linux") {
    console.log("[lancedb-prune] non-linux platform, skipping");
    return;
  }

  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") {
    console.log(`[lancedb-prune] unsupported arch (${arch}), skipping`);
    return;
  }

  const musl = detectMusl();
  const baseDir = path.join(process.cwd(), "node_modules", "@lancedb");

  const candidates =
    arch === "x64"
      ? {
          keep: musl ? "lancedb-linux-x64-musl" : "lancedb-linux-x64-gnu",
          remove: musl ? "lancedb-linux-x64-gnu" : "lancedb-linux-x64-musl",
        }
      : {
          keep: musl ? "lancedb-linux-arm64-musl" : "lancedb-linux-arm64-gnu",
          remove: musl ? "lancedb-linux-arm64-gnu" : "lancedb-linux-arm64-musl",
        };

  console.log(
    `[lancedb-prune] linux/${arch}, libc=${musl ? "musl" : "glibc"}; keeping ${candidates.keep}, pruning ${candidates.remove}`,
  );

  await removeIfExists(path.join(baseDir, candidates.remove));
}

await main();

#!/usr/bin/env node

import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPackageWithOptions,
  extractAll,
  listPackage,
} from "@electron/asar";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTROL_PORT = 48123;
const UNPACKED_DIRECTORIES =
  "node_modules/{@worklouder,better-sqlite3,node-pty}";

function replaceOnce(source, anchor, replacement, description) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`could not uniquely find ${description}`);
  }
  return source.replace(anchor, replacement);
}

function replaceIdentifier(source, from, to) {
  return source.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}

async function windowsAccountMenu(token) {
  let component = await readFile(
    join(PROJECT_ROOT, "ui", "account-menu.js"),
    "utf8",
  );
  component = component
    .replace("__CODEX_MUX_CONTROL_PORT__", String(CONTROL_PORT))
    .replace("__CODEX_MUX_CONTROL_TOKEN__", token)
    .replace("  const modalScope = Lo(Q);\n", "")
    .replace(
      "        onSelect: () => BW(modalScope, CodexMuxUsageModal, {}),\n",
      "",
    )
    .replace(
      "  const resolvedImageUrl = jLa(imageUrl || null);",
      "  const resolvedImageUrl = imageUrl || null;",
    )
    .replaceAll("bg-token-charts-purple/10", "bg-chart-purple/10")
    .replaceAll("text-token-charts-purple", "text-chart-purple");
  for (const [from, to] of [
    ["e7", "d7"],
    ["kXc", "QFl"],
    ["_H", "lI"],
    ["S2", "z2"],
    ["CH", "hI"],
  ]) {
    component = replaceIdentifier(component, from, to);
  }
  return component;
}

async function patchRenderer(extracted, token) {
  const indexPath = join(extracted, "webview", "index.html");
  let index = await readFile(indexPath, "utf8");
  const connectAnchor = "connect-src &#39;self&#39;";
  index = replaceOnce(
    index,
    connectAnchor,
    `${connectAnchor} http://127.0.0.1:${CONTROL_PORT}`,
    "renderer CSP connect-src",
  );
  await writeFile(indexPath, index, "utf8");

  const assets = join(extracted, "webview", "assets");
  const initialBundles = (await readdir(assets)).filter((name) =>
    /^app-initial-.*\.js$/.test(name),
  );
  if (initialBundles.length !== 1) {
    throw new Error(
      `expected one Windows renderer bundle, found ${initialBundles.length}`,
    );
  }
  const bundlePath = join(assets, initialBundles[0]);
  let bundle = await readFile(bundlePath, "utf8");
  if (bundle.includes("function CodexMuxAccountMenu(")) {
    throw new Error("copied app already contains the subscription menu");
  }
  for (const symbol of [
    "QFl=r(s(),1)",
    "d7=J()",
    "function lI(",
    "hI={",
    "z2=e=>",
  ]) {
    if (!bundle.includes(symbol)) {
      throw new Error(`could not verify Windows renderer symbol ${symbol}`);
    }
  }

  const component = await windowsAccountMenu(token);
  const componentAnchor = "function HFl(e){let t=(0,UFl.c)(32)";
  bundle = replaceOnce(
    bundle,
    componentAnchor,
    `${component}\n${componentAnchor}`,
    "native Windows profile menu component",
  );
  bundle = replaceOnce(
    bundle,
    "usageItems:Ct",
    "usageItems:(0,d7.jsx)(CodexMuxAccountMenu,{})",
    "native Windows usage menu slot",
  );
  for (const anchor of [
    "triggerButton:Dt,onOpenChange:l,children:P",
    "open:s,onOpenChange:l,contentWidth:`panel`",
  ]) {
    bundle = replaceOnce(
      bundle,
      anchor,
      anchor.replace(
        "onOpenChange:l",
        "onOpenChange:CodexMuxProfileMenuOpenChange(l)",
      ),
      "native Windows profile menu open-state hook",
    );
  }
  await writeFile(bundlePath, bundle, "utf8");
}

function parseArguments() {
  const args = process.argv.slice(2);
  const asarIndex = args.indexOf("--asar");
  if (asarIndex < 0 || !args[asarIndex + 1]) {
    throw new Error("usage: patch_windows_asar.mjs --asar <path> [--check]");
  }
  return { asar: resolve(args[asarIndex + 1]), check: args.includes("--check") };
}

async function main() {
  const options = parseArguments();
  if (!(await stat(options.asar)).isFile()) {
    throw new Error(`ASAR not found: ${options.asar}`);
  }
  const token = options.check
    ? "0".repeat(64)
    : (process.env.CODEX_MUX_PATCH_TOKEN || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(token)) {
    throw new Error("CODEX_MUX_PATCH_TOKEN must be 32 random bytes in hexadecimal");
  }

  const temporary = await mkdtemp(join(tmpdir(), "codex-router-asar-"));
  try {
    const extracted = join(temporary, "extracted");
    extractAll(options.asar, extracted);
    await patchRenderer(extracted, token);
    if (options.check) {
      console.log("Windows profile-menu anchors passed.");
      return;
    }

    const repacked = join(temporary, "app.asar");
    await createPackageWithOptions(extracted, repacked, {
      unpackDir: UNPACKED_DIRECTORIES,
    });
    const listing = listPackage(repacked, { isPack: true });
    for (const nativeFile of ["better_sqlite3.node", "conpty.node", "HID.node"]) {
      if (!listing.some((line) => line.startsWith("unpack :") && line.endsWith(nativeFile))) {
        throw new Error(`native ASAR file was not kept unpacked: ${nativeFile}`);
      }
    }
    const repackedUnpacked = `${repacked}.unpacked`;
    if (!(await stat(repackedUnpacked)).isDirectory()) {
      throw new Error("repacked ASAR has no unpacked native tree");
    }
    await cp(repacked, options.asar, { force: true });
    const targetUnpacked = `${options.asar}.unpacked`;
    await rm(targetUnpacked, { force: true, recursive: true });
    await cp(repackedUnpacked, targetUnpacked, { recursive: true });
    console.log(`Patched copied renderer: ${basename(options.asar)}`);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`Windows renderer patch failed: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../ui/account-menu.js", import.meta.url), "utf8");
assert(!source.includes("Continue sign-in"));
assert(!source.includes("CodexMuxMaskedEmail"));

const opened = [];
const copied = [];
const context = {
  URL,
  navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
  window: { open: (...args) => opened.push(args) },
};
vm.runInNewContext(`${source}\nglobalThis.openLogin = codexMuxOpenLogin;`, context);

const login = {
  userCode: "ABCD-EFGH",
  verificationUrl: "https://auth.openai.com/codex/device",
};
assert.equal(await context.openLogin(login), "");
assert.deepEqual(copied, [login.userCode]);
assert.deepEqual(opened, [
  [login.verificationUrl, "_blank", "noopener,noreferrer"],
]);

context.navigator.clipboard.writeText = async () => {
  throw new Error("clipboard unavailable");
};
assert.equal(await context.openLogin(login), login.userCode);
await assert.rejects(
  context.openLogin({ verificationUrl: "https://example.com/device" }),
  /not trusted/,
);

console.log("Account menu direct-login checks passed.");

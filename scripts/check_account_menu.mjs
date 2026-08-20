#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../ui/account-menu.js", import.meta.url), "utf8");
assert(!source.includes("Continue sign-in"));
assert(!source.includes("CodexMuxMaskedEmail"));
assert(!source.includes("CodexMuxProfileMenuOpenChange"));

const opened = [];
const copied = [];
let accountRequests = 0;
const context = {
  URL,
  fetch: async () => {
    accountRequests++;
    return {
      ok: true,
      json: async () => ({ accounts: [{ id: "primary", connected: true }] }),
    };
  },
  navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
  window: { open: (...args) => opened.push(args) },
};
vm.runInNewContext(
  `${source}\nglobalThis.openLogin = codexMuxOpenLogin; globalThis.loadAccounts = codexMuxLoadAccounts;`,
  context,
);

const accounts = await Promise.all([context.loadAccounts(), context.loadAccounts()]);
assert.equal(accountRequests, 1);
assert.equal(accounts[0][0].id, "primary");

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

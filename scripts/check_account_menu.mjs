#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../ui/account-menu.js", import.meta.url), "utf8");
assert(!source.includes("Continue sign-in"));
assert(!source.includes("CodexMuxMaskedEmail"));
assert(!source.includes("CodexMuxProfileMenuOpenChange"));
assert(!source.includes("chatgptDeviceCode"));
assert(source.includes('body: JSON.stringify({ mode: "chatgpt" })'));

const opened = [];
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
  type: "chatgpt",
  authUrl: "https://auth.openai.com/oauth/authorize?client_id=test",
};
assert.equal(await context.openLogin(login), undefined);
assert.deepEqual(opened, [
  [login.authUrl, "_blank", "noopener,noreferrer"],
]);

await assert.rejects(
  context.openLogin({ authUrl: "https://example.com/oauth" }),
  /not trusted/,
);

console.log("Account menu browser-login checks passed.");

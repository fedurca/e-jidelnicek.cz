import assert from "node:assert/strict";
import test from "node:test";
import { gapSentence } from "../functions/_lib/bindings.js";
import { guardOverlay, sanitizeSecrets, secret } from "../functions/_lib/runtime-store.js";

test("secret prefers the live store and falls back to the deployment", () => {
  const env = { EDOOKIT_ACCESS_CODE_2: "ze-nasazeni" };
  assert.equal(secret(env, { runtime: { EDOOKIT_ACCESS_CODE_2: "z-uloziste" } }, "EDOOKIT_ACCESS_CODE_2"), "z-uloziste");
  assert.equal(secret(env, { runtime: {} }, "EDOOKIT_ACCESS_CODE_2"), "ze-nasazeni");
  assert.equal(secret(env, undefined, "EDOOKIT_ACCESS_CODE_1"), "");
});

test("store payload keeps only known non-empty values", () => {
  assert.deepEqual(sanitizeSecrets({
    EDOOKIT_ACCESS_CODE_2: "  abc  ",
    EDOOKIT_ACCESS_CODE_1: "",
    GITHUB_TOKEN: "nesmi",
    cizí: "ne",
  }), { EDOOKIT_ACCESS_CODE_2: "abc" });
});

test("stored allowlist cannot lock out the current address", () => {
  const request = new Request("https://zs.fedurca.net/", { headers: { "CF-Connecting-IP": "185.22.236.11" } });
  const env = { ALLOWED_IPS: "185.22.236.11" };
  const guarded = guardOverlay(env, { ALLOWED_IPS: "203.0.113.5", EDOOKIT_ACCESS_CODE_2: "kod" }, request);
  assert.equal(guarded.ALLOWED_IPS, undefined);
  assert.equal(guarded.EDOOKIT_ACCESS_CODE_2, "kod");
  assert.equal(secret(env, { runtime: guarded }, "ALLOWED_IPS"), "185.22.236.11");
});

test("gap sentence explains a secret saved after the deployment", () => {
  const entries = [
    { where: "projekt Cloudflare", url: "EDOOKIT_ACCESS_CODE_2", status: "je" },
    { where: "toto nasazení", method: "env", url: "EDOOKIT_ACCESS_CODE_2", status: "chybí" },
    { where: "úložiště", method: "hodnota", url: "EDOOKIT_ACCESS_CODE_2", status: "chybí" },
    { where: "poslední nasazení", note: "26. 11. 2026 20:11 Praha" },
  ];
  assert.match(gapSentence(entries, "EDOOKIT_ACCESS_CODE_2"), /uložený/);
  entries[2].status = "je";
  assert.equal(gapSentence(entries, "EDOOKIT_ACCESS_CODE_2"), "");
});

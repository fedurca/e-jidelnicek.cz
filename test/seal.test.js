import assert from "node:assert/strict";
import test from "node:test";
import nacl from "tweetnacl";
import { collectSecrets } from "../functions/_lib/store-secrets.js";
import { seal } from "../functions/_lib/seal.js";

test("seal produces a ciphertext longer than the public key", () => {
  const pair = nacl.box.keyPair();
  const boxed = seal(new TextEncoder().encode("tajne"), pair.publicKey);
  assert.ok(boxed.length > pair.publicKey.length);
});

test("empty secret fields are skipped", () => {
  const form = new Map([
    ["EDOOKIT_ACCESS_CODE_1", "  abc  "],
    ["EDOOKIT_ACCESS_CODE_2", ""],
    ["EJIDELNICEK_PASSWORD", "heslo"],
  ]);
  form.get = Map.prototype.get;
  const pairs = collectSecrets(form);
  assert.deepEqual(pairs.map(([name]) => name), ["EDOOKIT_ACCESS_CODE_1", "EJIDELNICEK_PASSWORD"]);
});

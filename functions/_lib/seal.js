import nacl from "tweetnacl";
import { blake2b } from "blakejs";

function concat(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function seal(message, recipientPublicKey) {
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(concat(ephemeral.publicKey, recipientPublicKey), undefined, 24);
  const boxed = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey);
  if (!boxed) throw new Error("Šifrování tajemství selhalo.");
  return concat(ephemeral.publicKey, boxed);
}

export function bytesToBase64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function base64ToBytes(value) {
  const text = atob(value);
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index);
  return out;
}

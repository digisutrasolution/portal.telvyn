import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque URL-safe token (default 32 bytes / 256 bits of entropy). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest — used so raw refresh/reset tokens are never stored. */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time hex-digest comparison. */
export function digestEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM encrypt (iv.ciphertext.tag, base64url) — MFA secrets at rest. */
export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSecret(payload: string, keyB64: string): string {
  const [ivB64, encB64, tagB64] = payload.split(".");
  if (!ivB64 || !encB64 || !tagB64) throw new Error("malformed secret payload");
  const key = Buffer.from(keyB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64url")), decipher.final()]).toString("utf8");
}

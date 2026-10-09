import {
  randomBytes,
  scrypt,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
const aad = Buffer.from("casetrack-vault-v1");
export async function deriveKey(password, salt) {
  if (
    typeof password !== "string" ||
    password.length < 14 ||
    password.length > 1024
  )
    throw Error("Use a passphrase between 14 and 1024 characters.");
  return derive(password, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 192 * 1024 * 1024,
  });
}
export function encrypt(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const bytes = Buffer.from(JSON.stringify(data));
  try {
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
  } finally {
    bytes.fill(0);
  }
}
export function decrypt(envelope, key) {
  const data = JSON.parse(envelope);
  if (data.v !== 1) throw Error("Unsupported vault format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.iv, "base64"),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  const bytes = Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "base64")),
    decipher.final(),
  ]);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    bytes.fill(0);
  }
}

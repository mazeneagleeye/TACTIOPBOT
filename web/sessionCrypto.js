const crypto = require("node:crypto");

const PREFIX = "tactiobot-session:v1:";

function createSessionCryptoAdapter(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("Session storage encryption requires a secret of at least 32 characters.");
  }

  const key = Buffer.from(crypto.hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("tactiobot-session-storage-v1"),
    Buffer.from("AES-256-GCM"),
    32
  ));

  return {
    async encrypt(plaintext) {
      if (typeof plaintext !== "string") {
        throw new TypeError("Session data must be serialized before encryption.");
      }

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
    },
    async decrypt(payload) {
      if (typeof payload !== "string") {
        throw new TypeError("Stored session data must be a string.");
      }

      if (!payload.startsWith(PREFIX)) {
        let legacySession;
        try {
          legacySession = JSON.parse(payload);
        } catch {
          throw new Error("Stored session data is not valid encrypted or legacy session data.");
        }
        if (!legacySession || typeof legacySession !== "object" || Array.isArray(legacySession)) {
          throw new Error("Stored legacy session data has an invalid shape.");
        }
        return payload;
      }

      const [encodedIv, encodedTag, encodedCiphertext, extra] = payload
        .slice(PREFIX.length)
        .split(".");
      if (!encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
        throw new Error("Stored encrypted session data has an invalid format.");
      }

      const iv = Buffer.from(encodedIv, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      const ciphertext = Buffer.from(encodedCiphertext, "base64url");
      if (iv.length !== 12 || tag.length !== 16) {
        throw new Error("Stored encrypted session data has invalid cryptographic parameters.");
      }

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

module.exports = { createSessionCryptoAdapter };

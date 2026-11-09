const assert = require("node:assert/strict");
const test = require("node:test");
const { createSessionCryptoAdapter } = require("../web/sessionCrypto");

test("session crypto encrypts data and rejects tampering or a wrong key", async () => {
  const plaintext = JSON.stringify({
    email: "operator@example.com",
    registrationChallenge: { codeHash: "keyed-hash", expiresAt: 123 },
  });
  const adapter = createSessionCryptoAdapter("test-session-secret-with-at-least-32-characters");
  const encrypted = await adapter.encrypt(plaintext);

  assert.match(encrypted, /^tactiobot-session:v1:/);
  assert.doesNotMatch(encrypted, /operator@example\.com|keyed-hash/);
  assert.equal(await adapter.decrypt(encrypted), plaintext);
  await assert.rejects(adapter.decrypt(`${encrypted.slice(0, -1)}x`));
  await assert.rejects(
    createSessionCryptoAdapter("a-different-session-secret-with-at-least-32-characters")
      .decrypt(encrypted)
  );
});

test("session crypto reads existing plaintext sessions during the transition", async () => {
  const legacySession = JSON.stringify({ cookie: { maxAge: 1000 }, account: { email: "operator@example.com" } });
  const adapter = createSessionCryptoAdapter("test-session-secret-with-at-least-32-characters");

  assert.equal(await adapter.decrypt(legacySession), legacySession);
  assert.match(await adapter.encrypt(await adapter.decrypt(legacySession)), /^tactiobot-session:v1:/);
  await assert.rejects(adapter.decrypt("not-session-data"));
});

test("session crypto requires a strong secret", () => {
  assert.throws(() => createSessionCryptoAdapter("short"), {
    message: /at least 32 characters/,
  });
});

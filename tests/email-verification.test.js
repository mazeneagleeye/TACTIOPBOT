const assert = require("node:assert/strict");
const test = require("node:test");
const { createVerificationMailer } = require("../web/emailVerification");

test("verification mailer requires complete SMTP settings", async () => {
  const mailer = createVerificationMailer({});

  assert.equal(mailer.isConfigured(), false);
  await assert.rejects(mailer.sendCode("operator@example.com", "012345", "sign-in"), {
    status: 503,
    message: /SMTP_HOST/,
  });
});

test("verification mailer sends six-digit codes through authenticated SMTP", async () => {
  const messages = [];
  const transports = [];
  const mailer = createVerificationMailer({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "tactiopbot@gmail.com",
    SMTP_PASS: "test-only-app-password",
    EMAIL_FROM: "TACTIOPBOT <tactiopbot@gmail.com>",
  }, (options) => {
    transports.push(options);
    return { sendMail: async (message) => messages.push(message) };
  });

  assert.equal(mailer.isConfigured(), true);
  await mailer.sendCode("operator@example.com", "012345", "sign-in");

  assert.equal(transports.length, 1);
  assert.deepEqual(transports[0], {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: "tactiopbot@gmail.com", pass: "test-only-app-password" },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "operator@example.com");
  assert.equal(messages[0].from, "TACTIOPBOT <tactiopbot@gmail.com>");
  assert.match(messages[0].text, /012345/);
  assert.match(messages[0].text, /10 minutes/);
  assert.match(messages[0].html, /linear-gradient\(135deg,#45c8ff,#7659ff\)/);
  assert.match(messages[0].html, /012345/);
  assert.match(messages[0].html, /Never share a verification code/);
});

test("verification mailer sends a branded admin test without generating a code", async () => {
  const messages = [];
  const mailer = createVerificationMailer({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "tactiopbot@gmail.com",
    SMTP_PASS: "test-only-app-password",
    EMAIL_FROM: "TACTIOPBOT <tactiopbot@gmail.com>",
  }, () => ({ sendMail: async (message) => messages.push(message) }));

  await mailer.sendTestEmail("tactiopbot@gmail.com");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "tactiopbot@gmail.com");
  assert.equal(messages[0].subject, "TACTIOPBOT email delivery test");
  assert.match(messages[0].html, /Email delivery is online/);
  assert.match(messages[0].text, /can deliver account security emails/);
  assert.doesNotMatch(messages[0].html, /letter-spacing:10px/);
});

test("verification mailer reports missing SMTP credentials and delivery failures", async () => {
  const unconfiguredMailer = createVerificationMailer({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "tactiopbot@gmail.com",
    SMTP_PASS: "",
    EMAIL_FROM: "TACTIOPBOT <tactiopbot@gmail.com>",
  });
  assert.equal(unconfiguredMailer.isConfigured(), false);
  await assert.rejects(unconfiguredMailer.sendTestEmail("tactiopbot@gmail.com"), {
    status: 503,
    message: /SMTP_HOST.*SMTP_USER.*SMTP_PASS.*EMAIL_FROM/,
  });

  const configuredMailer = createVerificationMailer({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "tactiopbot@gmail.com",
    SMTP_PASS: "test-only-app-password",
  }, () => ({
    sendMail: async () => {
      throw new Error("private provider details");
    },
  }));
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(configuredMailer.sendCode("operator@example.com", "123456", "sign-in"), {
      status: 502,
      message: /Email could not be sent/,
    });
  } finally {
    console.error = originalConsoleError;
  }
});

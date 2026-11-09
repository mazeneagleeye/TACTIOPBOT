const nodemailer = require("nodemailer");

function getSmtpConfiguration(env) {
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT || 587);
  const user = env.SMTP_USER;
  const password = env.SMTP_PASS;
  const from = env.EMAIL_FROM || user;
  const secure = env.SMTP_SECURE === "true" || (!env.SMTP_SECURE && port === 465);

  if (
    typeof host !== "string" ||
    !host ||
    host.trim() !== host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof user !== "string" ||
    !user ||
    user.trim() !== user ||
    typeof password !== "string" ||
    !password ||
    typeof from !== "string" ||
    !from ||
    from.trim() !== from
  ) {
    return null;
  }

  return { host, port, secure, user, password, from };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createEmailHtml({ preheader, heading, message, code, expiry }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background-color:#080d18;color:#e8f1ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="padding:0 0 18px;text-align:center;color:#72d7ff;font-size:12px;font-weight:700;letter-spacing:4px;">TACTIOPBOT <span style="color:#a78bfa;">// SECURE ACCESS</span></td>
      </tr>
      <tr>
        <td style="padding:1px;border-radius:18px;background:linear-gradient(135deg,#45c8ff,#7659ff);">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-radius:17px;background:#101827;">
            <tr>
              <td style="padding:36px 32px 12px;">
                <p style="margin:0 0 10px;color:#8aa3c5;font-size:11px;font-weight:700;letter-spacing:2px;">TACTICAL OPERATIONS / ACCOUNT SECURITY</p>
                <h1 style="margin:0;color:#f4f8ff;font-size:26px;line-height:1.25;">${escapeHtml(heading)}</h1>
                <p style="margin:16px 0 0;color:#bdcbe0;font-size:15px;line-height:1.7;">${escapeHtml(message)}</p>
              </td>
            </tr>
            ${code ? `<tr><td style="padding:22px 32px 10px;"><div style="padding:19px 12px;border:1px solid #284566;border-radius:12px;background:#0a1220;color:#75d8ff;text-align:center;font-family:Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;">${escapeHtml(code)}</div></td></tr>` : ""}
            <tr>
              <td style="padding:14px 32px 32px;color:#91a4c0;font-size:13px;line-height:1.7;">
                ${escapeHtml(expiry)}
                <br><br>If you did not request this, you can safely ignore this message.
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 12px 0;color:#657995;text-align:center;font-size:11px;line-height:1.6;">Automated account security message from TACTIOPBOT.<br>Never share a verification code with anyone.</td>
      </tr>
    </table>
  </body>
</html>`;
}

function createVerificationMailer(env = process.env, createTransport = nodemailer.createTransport) {
  let transporter;
  const configuration = getSmtpConfiguration(env);

  function getTransport() {
    if (!configuration) {
      const error = new Error(
        "Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_FROM."
      );
      error.status = 503;
      throw error;
    }

    if (!transporter) {
      transporter = createTransport({
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        requireTLS: configuration.port === 587 && !configuration.secure,
        auth: { user: configuration.user, pass: configuration.password },
      });
    }
    return transporter;
  }

  async function sendMessage(message) {
    const transport = getTransport();
    try {
      await transport.sendMail({ from: configuration.from, ...message });
    } catch (cause) {
      console.error(`[email] Message delivery failed (${cause?.name || "Error"}).`);
      const error = new Error("Email could not be sent. Check the SMTP settings and try again.");
      error.status = 502;
      throw error;
    }
  }

  return {
    isConfigured() {
      return Boolean(configuration);
    },
    async sendCode(to, code, purpose) {
      if (!/^\d{6}$/.test(code)) {
        throw new TypeError("Verification codes must contain exactly six digits.");
      }

      const copy = purpose === "sign-in"
        ? {
          heading: "Your sign-in code",
          message: "Use this one-time code to securely sign in to your TACTIOPBOT account.",
          action: "sign in to your account",
        }
        : purpose === "registration"
          ? {
            heading: "Verify your email",
            message: "Use this one-time code to verify your email and finish creating your TACTIOPBOT account.",
            action: "verify your email address",
          }
          : {
            heading: "Confirm your account change",
            message: "Use this one-time code to confirm the account change you requested.",
            action: "confirm your account change",
          };
      const expiry = "This code expires in 10 minutes.";
      const text = `Your TACTIOPBOT verification code is ${code}.\n\nUse it to ${copy.action}. ${expiry} If you did not request this, you can safely ignore this email.`;
      await sendMessage({
        to,
        subject: `Your TACTIOPBOT ${purpose === "sign-in" ? "sign-in" : "verification"} code`,
        text,
        html: createEmailHtml({
          preheader: `${copy.heading}. Your code expires in 10 minutes.`,
          heading: copy.heading,
          message: copy.message,
          code,
          expiry,
        }),
      });
    },
    async sendTestEmail(to) {
      const message = "SMTP is configured and TACTIOPBOT can deliver account security emails.";
      await sendMessage({
        to,
        subject: "TACTIOPBOT email delivery test",
        text: `${message}\n\nThis test was requested by an authorized website administrator.`,
        html: createEmailHtml({
          preheader: "TACTIOPBOT email delivery is working.",
          heading: "Email delivery is online",
          message,
          expiry: "This was an administrator-requested test message. No verification code was generated.",
        }),
      });
    },
  };
}

module.exports = { createVerificationMailer };

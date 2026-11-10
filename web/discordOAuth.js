const crypto = require("crypto");
const { promisify } = require("node:util");
const path = require("node:path");
const express = require("express");
const session = require("express-session");
const { OAuth2Client } = require("google-auth-library");
const { MongoStore } = require("connect-mongo");
const { rateLimit } = require("express-rate-limit");
const { ChannelType, PermissionsBitField } = require("discord.js");
const { ObjectId } = require("mongodb");
const { isMongoConnectivityError } = require("../webDb");
const { createVerificationMailer } = require("./emailVerification");
const { createSessionCryptoAdapter } = require("./sessionCrypto");
const { createWebBotChatRouter } = require("./botChat");
const {
  getGuildConfig,
  getNextReset,
  setGuildConfig,
  deleteGuildConfig,
} = require("../utils/clanMissionNotifier");
const { languages } = require("../utils/cmNotificationLanguages");
const {
  balancePlayers,
  createClanWarPoster,
  validateClanWar,
  validatePlayers,
} = require("./clanWar");

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const GUILD_MANAGEMENT_PERMISSIONS = 8n | 32n;
const scryptAsync = promisify(crypto.scrypt);
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication requests. Please try again later." },
});
const writeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many settings changes. Please try again later." },
});
const emailCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification code requests. Please try again later." },
});
const emailTestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many email tests. Please try again later." },
});
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function isDiscordSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function getRedirectOrigin(value, isProduction) {
  try {
    const url = new URL(value);
    if (url.username || url.password || (isProduction && url.protocol !== "https:")) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getAllowedWebOrigins(isProduction) {
  const origins = new Set();
  const envKeys = ["WEB_ALLOWED_ORIGINS", "SITE_URL", "PUBLIC_APP_URL", "PUBLIC_URL", "APP_URL"];
  for (const key of envKeys) {
    const raw = process.env[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    for (const part of raw.split(/[\s,]+/)) {
      if (!part) continue;
      const origin = getRedirectOrigin(part, isProduction);
      if (origin) origins.add(origin);
    }
  }
  return origins;
}

function getRequestOrigin(req) {
  try {
    const protocol = req.protocol === "https" || req.protocol === "http" ? req.protocol : null;
    const host = req.hostname;
    if (!protocol || typeof host !== "string" || !host) return null;
    const hostHeader = req.get("host") || "";
    const portMatch = hostHeader.match(/:(\d+)$/);
    const port = portMatch ? Number(portMatch[1]) : (protocol === "https" ? 443 : 80);
    const url = new URL(`${protocol}://${host}`);
    if (Number.isInteger(port) && port > 0 && url.port !== String(port)) {
      if (!((protocol === "https" && port === 443) || (protocol === "http" && port === 80))) {
        url.port = String(port);
      }
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isCallbackUri(value, pathname, isProduction) {
  if (!getRedirectOrigin(value, isProduction)) return false;
  const url = new URL(value);
  return url.pathname === pathname && !url.search && !url.hash;
}

function createDiscordOAuthRouter({
  client: mongoClient,
  db,
  discordClient,
  websiteOnly = false,
  googleRedirectUriOverride,
  verificationMailer = createVerificationMailer(),
}) {
  const router = express.Router();
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  const sessionSecret = process.env.WEB_SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";
  const redirectOrigin = getRedirectOrigin(redirectUri, isProduction);
  const discordConfigurationIsValid =
    hasConfiguredValue(process.env.CLIENT_ID) &&
    hasConfiguredValue(process.env.CLIENT_SECRET) &&
    Boolean(redirectOrigin) &&
    isCallbackUri(redirectUri, "/auth/discord/callback", isProduction) &&
    typeof sessionSecret === "string";
  const googleRedirectUri = googleRedirectUriOverride || process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const googleRedirectOrigin = getRedirectOrigin(googleRedirectUri, isProduction);
  const hasGoogleCredentials =
    hasConfiguredValue(process.env.GOOGLE_CLIENT_ID) &&
    hasConfiguredValue(process.env.GOOGLE_CLIENT_SECRET);
  const googleConfigurationIsValid =
    process.env.GOOGLE_OAUTH_ENABLED === "true" &&
    hasGoogleCredentials &&
    hasConfiguredValue(googleRedirectUri) &&
    Boolean(googleRedirectOrigin) &&
    isCallbackUri(googleRedirectUri, "/auth/google/callback", isProduction) &&
    typeof sessionSecret === "string" &&
    sessionSecret.length >= 32;
  const googleOAuthClient = googleConfigurationIsValid
    ? new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      googleRedirectUri
    )
    : null;
  const sessionConfigurationIsValid =
    Boolean(mongoClient) &&
    Boolean(db) &&
    typeof sessionSecret === "string" &&
    sessionSecret.length >= 32;
  const verificationLifetimeMs = 10 * 60 * 1000;
  const verificationResendDelayMs = 60 * 1000;
  const verificationMaxAttempts = 5;
  const emailTestAdminEmails = new Set(
    (process.env.EMAIL_TEST_ADMIN_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean)
  );
  let accountIndexesPromise = null;

  if (!sessionConfigurationIsValid) {
    router.use((req, res) => {
      res.set("Cache-Control", "no-store");
      res.status(503).json({ error: "Website authentication is not configured." });
    });
    return router;
  }

  router.use(
    session({
      name: "tactiobot.sid",
      secret: sessionSecret,
      store: MongoStore.create({
        client: mongoClient,
        dbName: db.databaseName,
        collectionName: "web_sessions",
        ttl: SESSION_MAX_AGE_MS / 1000,
        autoRemove: "native",
        cryptoAdapter: createSessionCryptoAdapter(sessionSecret),
      }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE_MS,
      },
    })
  );
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.path === "/profile/complete") {
      if (!isAuthenticated(req.session)) return res.redirect("/?auth_error=sign_in_required");
      if (normalizeClanName(req.session.account?.clanName)) return res.redirect("/");
    }
    if (req.path.startsWith("/dashboard/")) {
      if (!isAuthenticated(req.session)) return res.redirect("/?auth_error=sign_in_required");
      if (!normalizeClanName(req.session.account?.clanName)) return res.redirect("/profile/complete");
    }
    next();
  });

  router.use("/api", apiRateLimit);
  router.use("/auth", express.json({ limit: "8kb" }));
  router.use(createWebBotChatRouter({
    db,
    publicDirectory: path.resolve(__dirname, "..", "public"),
  }));

  router.get("/auth/providers", (req, res) => {
    res.json({
      discord: discordConfigurationIsValid,
      google: googleConfigurationIsValid,
      discordServerManagement: !websiteOnly,
      emailTestAdmin: isEmailTestAdmin(req.session),
    });
  });

  router.get("/auth/pending", asyncRoute(async (req, res) => {
    const login = req.session.loginChallenge;
    const registration = req.session.registrationChallenge;
    if (login?.expiresAt > Date.now()) {
      return res.json({ action: "login", email: login.email });
    }
    if (registration?.expiresAt > Date.now()) {
      return res.json({ action: "register", email: registration.email });
    }
    delete req.session.loginChallenge;
    delete req.session.registrationChallenge;
    await saveSession(req);
    res.json({ action: null });
  }));

  function verificationCodeHash(challengeId, purpose, code) {
    return crypto
      .createHmac("sha256", sessionSecret)
      .update(`${challengeId}:${purpose}:${code}`)
      .digest();
  }

  function isEmailTestAdmin(sessionData) {
    return (
      isAuthenticated(sessionData) &&
      emailTestAdminEmails.has(normalizeEmail(sessionData.account.email))
    );
  }

  async function sendVerificationCode(req, key, purpose, email, metadata = {}) {
    if (!verificationMailer.isConfigured()) {
      throw httpError(
        503,
        "Email verification is not configured. Add SMTP settings to the server environment.",
        "email_verification_not_configured"
      );
    }

    const previous = req.session[key];
    if (previous && Date.now() - previous.sentAt < verificationResendDelayMs) {
      throw httpError(429, "Wait a minute before requesting another verification code.");
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challengeId = crypto.randomBytes(16).toString("hex");
    req.session[key] = {
      purpose,
      email,
      challengeId,
      codeHash: verificationCodeHash(challengeId, purpose, code).toString("base64url"),
      attempts: 0,
      sentAt: Date.now(),
      expiresAt: Date.now() + verificationLifetimeMs,
      ...metadata,
    };
    await saveSession(req);

    try {
      const emailPurpose = purpose === "email-login"
        ? "sign-in"
        : purpose === "email-registration" ? "registration" : "account-update";
      await verificationMailer.sendCode(email, code, emailPurpose);
    } catch (error) {
      delete req.session[key];
      await saveSession(req);
      if (Number.isInteger(error.status)) {
        throw error;
      }
      throw httpError(502, "Verification email could not be sent. Check the email server settings and try again.");
    }
  }

  async function consumeVerificationCode(req, key, purpose, code) {
    const challenge = req.session[key];
    if (!challenge || challenge.purpose !== purpose) {
      throw httpError(400, "Request a new verification code and try again.");
    }
    if (challenge.expiresAt <= Date.now()) {
      delete req.session[key];
      await saveSession(req);
      throw httpError(400, "The verification code expired. Request a new one.");
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      throw httpError(400, "Enter the 6-digit verification code.");
    }

    challenge.attempts += 1;
    const received = verificationCodeHash(challenge.challengeId, purpose, code);
    const expected = Buffer.from(challenge.codeHash, "base64url");
    const matches = expected.length === received.length && crypto.timingSafeEqual(expected, received);
    if (!matches) {
      if (challenge.attempts >= verificationMaxAttempts) delete req.session[key];
      await saveSession(req);
      throw httpError(
        challenge.attempts >= verificationMaxAttempts ? 429 : 400,
        challenge.attempts >= verificationMaxAttempts
          ? "Too many incorrect codes. Request a new verification code."
          : "That verification code is incorrect."
      );
    }

    delete req.session[key];
    await saveSession(req);
    return challenge;
  }

  async function ensureAccountIndexes() {
    if (!accountIndexesPromise) {
      const accounts = db.collection("web_accounts");
      accountIndexesPromise = Promise.all([
        accounts.createIndex(
          { normalizedEmail: 1 },
          { unique: true, name: "web_accounts_normalized_email_unique" }
        ),
        accounts.createIndex(
          { googleId: 1 },
          {
            unique: true,
            partialFilterExpression: { googleId: { $type: "string" } },
            name: "web_accounts_google_id_unique",
          }
        ),
        accounts.createIndex(
          { discordId: 1 },
          {
            unique: true,
            partialFilterExpression: { discordId: { $type: "string" } },
            name: "web_accounts_discord_id_unique",
          }
        ),
      ]).catch((error) => {
        accountIndexesPromise = null;
        throw error;
      });
    }
    await accountIndexesPromise;
  }

  async function findOrCreateGoogleAccount(profile) {
    await ensureAccountIndexes();
    const accounts = db.collection("web_accounts");
    const normalizedEmail = normalizeEmail(profile.email);
    if (!normalizedEmail) throw httpError(401, "Google returned an invalid email address.");
    let account = await accounts.findOne({ googleId: String(profile.sub) });
    if (account) {
      if (account.emailVerified !== true) {
        await accounts.updateOne(
          { _id: account._id },
          { $set: { emailVerified: true, updatedAt: new Date() } }
        );
        account.emailVerified = true;
      }
      return account;
    }

    account = await accounts.findOne({ normalizedEmail });
    if (account) throw httpError(409, "An account with this email already exists. Sign in using its original method.");

    try {
      const result = await accounts.insertOne({
        normalizedEmail,
        email: normalizedEmail,
        emailVerified: true,
        googleId: String(profile.sub),
        ...(typeof profile.name === "string" && profile.name.trim()
          ? {
            fullName: profile.name.trim().slice(0, 100),
            displayName: profile.name.trim().slice(0, 100),
          }
          : {}),
        createdAt: new Date(),
      });
      return accounts.findOne({ _id: result.insertedId });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      account = await accounts.findOne({
        $or: [{ googleId: String(profile.sub) }, { normalizedEmail }],
      });
      if (account?.googleId === String(profile.sub)) return account;
      throw httpError(409, "An account with this email already exists.");
    }
  }

  async function linkDiscordAccount(accountId, discordId) {
    if (!ObjectId.isValid(accountId)) {
      throw httpError(401, "Your website account session is invalid. Please sign in again.");
    }
    const accounts = db.collection("web_accounts");
    await ensureAccountIndexes();
    const objectId = new ObjectId(accountId);
    const account = await accounts.findOne({ _id: objectId });
    if (!account) throw httpError(401, "Your website account no longer exists.");
    const existingLink = await accounts.findOne({ discordId });
    if (existingLink && String(existingLink._id) !== String(objectId)) {
      throw httpError(409, "This Discord account is already linked to another website account.");
    }

    try {
      const result = await accounts.updateOne(
        {
          _id: objectId,
          $or: [
            { discordId },
            { discordId: null },
            { discordId: { $exists: false } },
          ],
        },
        { $set: { discordId, updatedAt: new Date() } }
      );
      if (result.matchedCount !== 1) {
        throw httpError(409, "A different Discord account is already linked.");
      }
      return accounts.findOne({ _id: objectId });
    } catch (error) {
      if (error?.code === 11000) {
        throw httpError(409, "This Discord account is already linked to another website account.");
      }
      throw error;
    }
  }

  async function findOrCreateDiscordAccount(profile) {
    await ensureAccountIndexes();
    const accounts = db.collection("web_accounts");
    if (profile.verified !== true) {
      throw httpError(401, "Discord must provide a verified email address to sign in.");
    }
    let account = await accounts.findOne({ discordId: String(profile.id) });
    if (account) {
      if (account.emailVerified !== true) {
        await accounts.updateOne(
          { _id: account._id },
          { $set: { emailVerified: true, updatedAt: new Date() } }
        );
        account.emailVerified = true;
      }
      return account;
    }
    const normalizedEmail = normalizeEmail(profile.email);
    if (!normalizedEmail || profile.verified !== true) {
      throw httpError(401, "Discord must provide a verified email address to create an account.");
    }

    if (await accounts.findOne({ normalizedEmail })) {
      throw httpError(
        409,
        "An account with this email already exists. Sign in with the existing method and connect Discord explicitly.",
        "discord_email_conflict"
      );
    }

    const fullName = String(profile.global_name || profile.username || "").trim().slice(0, 100);
    try {
      const result = await accounts.insertOne({
        normalizedEmail,
        email: normalizedEmail,
        emailVerified: true,
        discordId: String(profile.id),
        fullName,
        displayName: fullName,
        createdAt: new Date(),
      });
      return accounts.findOne({ _id: result.insertedId });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      account = await accounts.findOne({ discordId: String(profile.id) });
      if (account) return account;
      throw httpError(
        409,
        "An account with this email already exists. Sign in with the existing method and connect Discord explicitly.",
        "discord_email_conflict"
      );
    }
  }

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derivedKey = await scryptAsync(password, salt, 64, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return `scrypt$32768$8$1$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
  }

  async function verifyPassword(password, encodedHash) {
    if (typeof encodedHash !== "string") return false;
    const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey, extra] = encodedHash.split("$");
    if (
      algorithm !== "scrypt" ||
      cost !== "32768" ||
      blockSize !== "8" ||
      parallelization !== "1" ||
      !encodedSalt ||
      !encodedKey ||
      extra !== undefined
    ) return false;

    let salt;
    let expected;
    try {
      salt = Buffer.from(encodedSalt, "base64url");
      expected = Buffer.from(encodedKey, "base64url");
    } catch {
      return false;
    }
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scryptAsync(password, salt, expected.length, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  }

  async function establishDiscordSession(req, account, profile, tokenData) {
    await establishAccountSession(req, account);
    req.session.user = {
      id: String(profile.id),
      username: String(profile.username || ""),
      globalName: profile.global_name ? String(profile.global_name) : null,
    };
    req.session.oauth = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };
    await saveSession(req);
  }

  router.get("/auth/google", authRateLimit, asyncRoute(async (req, res) => {
    if (!googleConfigurationIsValid) {
      throw httpError(503, "Google sign-in is not configured yet.");
    }

    const state = crypto.randomBytes(32).toString("hex");
    const nonce = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = await googleOAuthClient.generateCodeVerifierAsync();
    req.session.googleOAuthState = state;
    req.session.googleOAuthNonce = nonce;
    req.session.googleOAuthCodeVerifier = codeVerifier;
    await saveSession(req);
    res.redirect(googleOAuthClient.generateAuthUrl({
      access_type: "online",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }));
  }));

  router.get("/auth/google/callback", authRateLimit, asyncRoute(async (req, res) => {
    if (!googleConfigurationIsValid) {
      throw httpError(503, "Google sign-in is not configured yet.");
    }

    const expectedState = req.session.googleOAuthState;
    const expectedNonce = req.session.googleOAuthNonce;
    const codeVerifier = req.session.googleOAuthCodeVerifier;
    delete req.session.googleOAuthState;
    delete req.session.googleOAuthNonce;
    delete req.session.googleOAuthCodeVerifier;
    if (!matchesOAuthState(expectedState, req.query.state)) {
      await saveSession(req);
      throw httpError(400, "Invalid Google OAuth state.");
    }
    if (req.query.error) {
      await saveSession(req);
      return res.redirect("/?auth_error=google_cancelled");
    }
    if (
      typeof req.query.code !== "string" ||
      req.query.code.length === 0 ||
      req.query.code.length > 2048 ||
      !expectedNonce ||
      !codeVerifier
    ) {
      await saveSession(req);
      return res.redirect("/?auth_error=google_cancelled");
    }

    try {
      const { tokens } = await googleOAuthClient.getToken({
        code: req.query.code,
        codeVerifier,
      });
      if (
        typeof tokens.id_token !== "string" ||
        tokens.id_token.length === 0 ||
        tokens.id_token.length > 16_384
      ) {
        throw httpError(502, "Google returned an incomplete sign-in response.");
      }
      const ticket = await googleOAuthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const profile = ticket.getPayload();
      if (
        typeof profile?.sub !== "string" ||
        profile.sub.length === 0 ||
        profile.sub.length > 255 ||
        !profile.email ||
        profile.email_verified !== true ||
        profile.nonce !== expectedNonce
      ) {
        throw httpError(401, "Google could not verify this account.");
      }

      let account;
      try {
        account = await findOrCreateGoogleAccount(profile);
      } catch (error) {
        if (error.status === 409) {
          return res.redirect("/?auth_error=google_account_conflict");
        }
        throw error;
      }
      await establishAccountSession(req, account);
      res.redirect(account.clanName ? "/" : "/profile/complete");
    } catch (error) {
      if (error.status === 409) {
        return res.redirect("/?auth_error=google_account_conflict");
      }
      if (error.status === 401) {
        return res.redirect("/?auth_error=google_unverified");
      }
      console.error(`[auth] Google callback failed (${error?.name || "Error"}): ${error?.message || "No details"}.`);
      res.redirect("/?auth_error=google_failed");
    }
  }));

  router.post(
    "/auth/register",
    authRateLimit,
    emailCodeRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const { fullName, clanName, email, password } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      const normalizedFullName = normalizeFullName(fullName);
      const normalizedClanName = normalizeClanName(clanName);
      validatePassword(password);
      if (!normalizedEmail) throw httpError(400, "Enter a valid email address.");
      if (!normalizedFullName) throw httpError(400, "Full name must be between 2 and 100 characters.");
      if (!normalizedClanName) throw httpError(400, "Clan name must be between 1 and 40 characters.");

      await ensureAccountIndexes();
      const accounts = db.collection("web_accounts");
      if (await accounts.findOne({ normalizedEmail })) {
        throw httpError(409, "An account with this email already exists. Sign in instead.");
      }

      if (!verificationMailer.isConfigured()) {
        throw httpError(
          503,
          "Email verification is not configured. Add SMTP settings to the server environment.",
          "email_verification_not_configured"
        );
      }
      const passwordHash = await hashPassword(password);
      await sendVerificationCode(req, "registrationChallenge", "email-registration", normalizedEmail, {
        account: {
          normalizedEmail,
          email: normalizedEmail,
          fullName: normalizedFullName,
          displayName: normalizedFullName,
          clanName: normalizedClanName,
          passwordHash,
        },
      });
      res.status(202).json({ verificationRequired: true, email: normalizedEmail });
    })
  );

  router.post(
    "/auth/register/verify",
    authRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const challenge = await consumeVerificationCode(
        req,
        "registrationChallenge",
        "email-registration",
        req.body?.code
      );
      const now = new Date();
      const accountDocument = {
        ...challenge.account,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      };
      let account;
      try {
        const result = await db.collection("web_accounts").insertOne(accountDocument);
        account = await db.collection("web_accounts").findOne({ _id: result.insertedId });
      } catch (error) {
        if (error?.code === 11000) {
          throw httpError(409, "An account with this email already exists. Sign in instead.");
        }
        throw error;
      }
      await establishAccountSession(req, account);
      res.status(201).json({ account: toPublicAccount(account) });
    })
  );

  router.post(
    "/auth/register/resend",
    authRateLimit,
    emailCodeRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const challenge = req.session.registrationChallenge;
      if (!challenge || challenge.purpose !== "email-registration") {
        throw httpError(400, "Start creating your account again to request a verification code.");
      }
      await sendVerificationCode(req, "registrationChallenge", "email-registration", challenge.email, {
        account: challenge.account,
      });
      res.status(202).json({ verificationRequired: true, email: challenge.email });
    })
  );

  router.post(
    "/auth/login",
    authRateLimit,
    emailCodeRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const normalizedEmail = normalizeEmail(req.body?.email);
      const password = req.body?.password;
      validatePassword(password);
      if (!normalizedEmail) throw httpError(400, "Enter a valid email address.");
      const account = await db.collection("web_accounts").findOne({ normalizedEmail });
      if (!account || !(await verifyPassword(password, account.passwordHash))) {
        throw httpError(401, "Email or password is incorrect.");
      }

      await sendVerificationCode(req, "loginChallenge", "email-login", normalizedEmail, {
        accountId: String(account._id),
      });
      res.status(202).json({ verificationRequired: true, email: normalizedEmail });
    })
  );

  router.post(
    "/auth/login/verify",
    authRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const challenge = await consumeVerificationCode(
        req,
        "loginChallenge",
        "email-login",
        req.body?.code
      );
      if (!ObjectId.isValid(challenge.accountId)) {
        throw httpError(401, "Your account session is invalid. Sign in again.");
      }
      const accounts = db.collection("web_accounts");
      const result = await accounts.updateOne(
        { _id: new ObjectId(challenge.accountId) },
        { $set: { emailVerified: true, updatedAt: new Date() } }
      );
      if (result.matchedCount !== 1) throw httpError(401, "Your account no longer exists. Sign in again.");
      const account = await accounts.findOne({ _id: new ObjectId(challenge.accountId) });
      await establishAccountSession(req, account);
      res.json({ account: toPublicAccount(account) });
    })
  );

  router.post(
    "/auth/login/resend",
    authRateLimit,
    emailCodeRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      const challenge = req.session.loginChallenge;
      if (!challenge || challenge.purpose !== "email-login") {
        throw httpError(400, "Sign in with your email and password to request a verification code.");
      }
      await sendVerificationCode(req, "loginChallenge", "email-login", challenge.email, {
        accountId: challenge.accountId,
      });
      res.status(202).json({ verificationRequired: true, email: challenge.email });
    })
  );

  router.post(
    "/auth/verification/cancel",
    authRateLimit,
    requireSameOrigin,
    asyncRoute(async (req, res) => {
      delete req.session.loginChallenge;
      delete req.session.registrationChallenge;
      await saveSession(req);
      res.status(204).end();
    })
  );

  router.get(
    "/auth/discord",
    authRateLimit,
    asyncRoute(async (req, res) => {
      if (!discordConfigurationIsValid) {
        throw httpError(503, "Discord sign-in is not configured yet.");
      }
      const linkAccount = req.query.link === "1";
      if (linkAccount && !isAuthenticated(req.session)) {
        throw httpError(401, "Sign in before connecting Discord.");
      }
      const state = crypto.randomBytes(32).toString("hex");
      req.session.oauthState = state;
      req.session.oauthMode = linkAccount ? "link" : "login";
      req.session.oauthLinkAccountId = linkAccount ? req.session.account.id : null;
      await saveSession(req);

      const authorizationUrl = new URL(`${DISCORD_API_BASE}/oauth2/authorize`);
      authorizationUrl.search = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify email guilds",
        state,
      }).toString();

      res.redirect(authorizationUrl.toString());
    })
  );

  router.get(
    "/auth/discord/callback",
    authRateLimit,
    asyncRoute(async (req, res) => {
      if (!discordConfigurationIsValid) {
        throw httpError(503, "Discord sign-in is not configured yet.");
      }
      const expectedState = req.session.oauthState;
      const receivedState = req.query.state;
      const linkAccountId = req.session.oauthLinkAccountId;
      const oauthMode = req.session.oauthMode || (linkAccountId ? "link" : "login");
      delete req.session.oauthState;
      delete req.session.oauthMode;
      delete req.session.oauthLinkAccountId;

      if (!matchesOAuthState(expectedState, receivedState)) {
        await saveSession(req);
        return res.status(400).json({ error: "Invalid OAuth state." });
      }

      if (req.query.error) {
        await saveSession(req);
        return res.redirect("/?auth_error=discord_cancelled");
      }
      if (typeof req.query.code !== "string" || req.query.code.length === 0 || req.query.code.length > 2048) {
        await saveSession(req);
        return res.redirect("/?auth_error=discord_cancelled");
      }
      if (oauthMode === "link" && (!isAuthenticated(req.session) || linkAccountId !== req.session.account?.id)) {
        await saveSession(req);
        return res.redirect("/?auth_error=sign_in_required");
      }

      const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          grant_type: "authorization_code",
          code: req.query.code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw httpError(502, "Discord OAuth token exchange failed.");
      }

      const tokenData = await tokenResponse.json();
      const profileResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!profileResponse.ok) {
        throw httpError(502, "Could not load the Discord user profile.");
      }

      const profile = await profileResponse.json();
      if (
        typeof tokenData.access_token !== "string" ||
        tokenData.access_token.length === 0 ||
        !Number.isFinite(tokenData.expires_in) ||
        tokenData.expires_in <= 0 ||
        typeof profile.id !== "string" ||
        !isDiscordSnowflake(profile.id)
      ) {
        throw httpError(502, "Discord returned an incomplete OAuth response.");
      }
      if (profile.verified !== true) {
        await saveSession(req);
        return res.redirect("/?auth_error=discord_unverified_email");
      }

      let account;
      try {
        account = oauthMode === "link"
          ? await linkDiscordAccount(linkAccountId, profile.id)
          : await findOrCreateDiscordAccount(profile);
      } catch (error) {
        if (error.status === 409) {
          await saveSession(req);
          const conflict = error.code === "discord_email_conflict"
            ? "discord_email_conflict"
            : "discord_account_conflict";
          return res.redirect(`/?auth_error=${conflict}`);
        }
        if (error.status === 401) {
          await saveSession(req);
          return res.redirect("/?auth_error=discord_unverified_email");
        }
        throw error;
      }

      await establishDiscordSession(req, account, profile, tokenData);
      res.redirect(account.clanName ? "/" : "/profile/complete");
    })
  );

  router.post("/auth/logout", requireSameOrigin, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("tactiobot.sid", {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      });
      res.status(204).end();
    });
  });

  router.use("/api", express.json({ limit: "8kb" }));

  const clanWars = db.collection("web_clan_wars");
  let clanWarIndexesPromise = null;
  const ensureClanWarIndexes = () => {
    if (!clanWarIndexesPromise) {
      clanWarIndexesPromise = clanWars.createIndex(
        { ownerUserId: 1, updatedAt: -1 },
        { name: "web_clan_wars_owner_updated" }
      ).catch((error) => {
        clanWarIndexesPromise = null;
        throw error;
      });
    }
    return clanWarIndexesPromise;
  };
  const toPublicClanWar = (record) => {
    if (!record) return null;
    const { _id, ownerUserId, ...data } = record;
    return { ...data, id: String(_id) };
  };
  const requireWebsiteAccount = (req, res, next) => {
    if (!isAuthenticated(req.session)) {
      return res.status(401).json({ error: "Sign in to manage your Clan Wars." });
    }
    if (!normalizeClanName(req.session.account.clanName)) {
      return res.status(403).json({ error: "Complete your TACTIOPBOT profile before continuing." });
    }
    next();
  };
  const requireSignedInAccount = (req, res, next) => {
    if (!isAuthenticated(req.session)) {
      return res.status(401).json({ error: "Sign in to update your profile." });
    }
    next();
  };

  router.post(
    "/api/admin/email/test",
    requireSignedInAccount,
    requireSameOrigin,
    emailTestRateLimit,
    asyncRoute(async (req, res) => {
      if (!isEmailTestAdmin(req.session)) {
        throw httpError(403, "This account is not authorized to send email tests.");
      }
      await verificationMailer.sendTestEmail(normalizeEmail(req.session.account.email));
      res.json({ sent: true });
    })
  );

  router.post(
    "/api/clan-wars/balance",
    requireWebsiteAccount,
    requireSameOrigin,
    writeRateLimit,
    (req, res, next) => {
      try {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
          throw httpError(400, "A player list is required.");
        }
        const players = validatePlayers(req.body.players, { requireTeams: false });
        res.json({ players: balancePlayers(players) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/api/clan-wars",
    requireWebsiteAccount,
    asyncRoute(async (req, res) => {
      await ensureClanWarIndexes();
      const records = await clanWars
        .find({ ownerUserId: req.session.account.id })
        .sort({ updatedAt: -1 })
        .limit(50)
        .toArray();
      res.json({ wars: records.map(toPublicClanWar) });
    })
  );

  router.post(
    "/api/clan-wars",
    requireWebsiteAccount,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      const data = validateClanWar(req.body);
      const now = new Date();
      const record = {
        _id: new ObjectId(),
        ownerUserId: req.session.account.id,
        ...data,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await clanWars.insertOne(record);
      res.status(201).json({ war: toPublicClanWar(record) });
    })
  );

  router.get(
    "/api/clan-wars/:warId/poster.png",
    requireWebsiteAccount,
    asyncRoute(async (req, res) => {
      if (!ObjectId.isValid(req.params.warId)) {
        throw httpError(400, "The Clan War ID is invalid.");
      }
      const record = await clanWars.findOne({
        _id: new ObjectId(req.params.warId),
        ownerUserId: req.session.account.id,
      });
      if (!record) throw httpError(404, "Clan War not found.");
      const image = createClanWarPoster(record);
      res.type("png");
      res.set("Content-Disposition", 'inline; filename="clan-war.png"');
      res.send(image);
    })
  );

  router.get(
    "/api/clan-wars/:warId",
    requireWebsiteAccount,
    asyncRoute(async (req, res) => {
      if (!ObjectId.isValid(req.params.warId)) {
        throw httpError(400, "The Clan War ID is invalid.");
      }
      const record = await clanWars.findOne({
        _id: new ObjectId(req.params.warId),
        ownerUserId: req.session.account.id,
      });
      if (!record) throw httpError(404, "Clan War not found.");
      res.json({ war: toPublicClanWar(record) });
    })
  );

  router.put(
    "/api/clan-wars/:warId",
    requireWebsiteAccount,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      if (!ObjectId.isValid(req.params.warId)) {
        throw httpError(400, "The Clan War ID is invalid.");
      }
      const data = validateClanWar(req.body);
      const now = new Date();
      const result = await clanWars.findOneAndUpdate(
        {
          _id: new ObjectId(req.params.warId),
          ownerUserId: req.session.account.id,
        },
        {
          $set: { ...data, updatedAt: now },
          $inc: { revision: 1 },
        },
        { returnDocument: "after" }
      );
      if (!result) throw httpError(404, "Clan War not found.");
      res.json({ war: toPublicClanWar(result) });
    })
  );

  router.get("/api/me", (req, res) => {
    const authenticated = isAuthenticated(req.session);
    res.json({
      user: authenticated && req.session?.oauth?.accessToken ? req.session.user || null : null,
      account: authenticated ? req.session.account : null,
    });
  });

  router.get(
    "/api/profile/pending",
    requireSignedInAccount,
    asyncRoute(async (req, res) => {
      const emailChange = req.session.profileEmailChallenge;
      const passwordChange = req.session.profilePasswordChallenge;
      const pendingEmailChange = emailChange?.expiresAt > Date.now()
        ? {
          stage: emailChange.purpose === "profile-email-current" ? "current-email" : "new-email",
          email: emailChange.newEmail,
        }
        : null;
      const pendingPasswordChange = passwordChange?.expiresAt > Date.now();
      if (!pendingEmailChange && emailChange) delete req.session.profileEmailChallenge;
      if (!pendingPasswordChange && passwordChange) delete req.session.profilePasswordChallenge;
      if ((!pendingEmailChange && emailChange) || (!pendingPasswordChange && passwordChange)) {
        await saveSession(req);
      }
      res.json({
        emailChange: pendingEmailChange,
        passwordChange: pendingPasswordChange,
      });
    })
  );

  router.put(
    "/api/profile",
    requireSignedInAccount,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        throw httpError(400, "A profile update is required.");
      }
      const fields = Object.keys(req.body);
      if (!fields.length || fields.some((key) => !["fullName", "clanName", "timezone"].includes(key))) {
        throw httpError(400, "Only your name, clan name, and timezone can be changed here.");
      }
      const updates = { updatedAt: new Date() };
      if (Object.hasOwn(req.body, "fullName")) {
        const fullName = normalizeFullName(req.body.fullName);
        if (!fullName) throw httpError(400, "Full name must be between 2 and 100 characters.");
        updates.fullName = fullName;
        updates.displayName = fullName;
      }
      if (Object.hasOwn(req.body, "clanName")) {
        const clanName = normalizeClanName(req.body.clanName);
        if (!clanName) throw httpError(400, "Clan name must be between 1 and 40 characters.");
        updates.clanName = clanName;
      }
      if (Object.hasOwn(req.body, "timezone")) {
        const timezone = req.body.timezone;
        if (timezone === null || timezone === "" || timezone === "auto") {
          updates.timezone = null;
        } else if (typeof timezone === "string" && isValidTimezone(timezone)) {
          updates.timezone = timezone;
        } else {
          throw httpError(400, "Invalid timezone identifier.");
        }
      }
      const accountId = req.session.account.id;
      if (!ObjectId.isValid(accountId)) throw httpError(401, "Your account session is invalid. Sign in again.");
      const accounts = db.collection("web_accounts");
      const result = await accounts.updateOne(
        { _id: new ObjectId(accountId) },
        { $set: updates }
      );
      if (result.matchedCount !== 1) throw httpError(401, "Your account no longer exists. Sign in again.");
      if (updates.fullName) {
        req.session.account.fullName = updates.fullName;
        req.session.account.displayName = updates.fullName;
      }
      if (updates.clanName) req.session.account.clanName = updates.clanName;
      if (Object.hasOwn(updates, "timezone")) req.session.account.timezone = updates.timezone;
      await saveSession(req);
      res.json({ account: req.session.account });
    })
  );

  router.post(
    "/api/profile/email/code",
    requireSignedInAccount,
    requireSameOrigin,
    emailCodeRateLimit,
    asyncRoute(async (req, res) => {
      const newEmail = normalizeEmail(req.body?.email);
      if (!newEmail) throw httpError(400, "Enter a valid new email address.");
      const currentEmail = normalizeEmail(req.session.account.email);
      if (!currentEmail) throw httpError(400, "This account does not have a verified email address.");
      if (newEmail === currentEmail) throw httpError(400, "Enter an email address different from your current one.");
      if (await db.collection("web_accounts").findOne({ normalizedEmail: newEmail })) {
        throw httpError(409, "An account with this email already exists.");
      }

      await sendVerificationCode(
        req,
        "profileEmailChallenge",
        "profile-email-current",
        currentEmail,
        { newEmail }
      );
      res.status(202).json({ verificationRequired: true, stage: "current-email" });
    })
  );

  router.post(
    "/api/profile/email/resend",
    requireSignedInAccount,
    requireSameOrigin,
    emailCodeRateLimit,
    asyncRoute(async (req, res) => {
      const challenge = req.session.profileEmailChallenge;
      if (!challenge || !challenge.purpose.startsWith("profile-email-")) {
        throw httpError(400, "Start an email change to request a verification code.");
      }
      await sendVerificationCode(
        req,
        "profileEmailChallenge",
        challenge.purpose,
        challenge.email,
        { newEmail: challenge.newEmail }
      );
      res.status(202).json({ verificationRequired: true, stage: challenge.purpose });
    })
  );

  router.post(
    "/api/profile/email/verify",
    requireSignedInAccount,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      const challenge = req.session.profileEmailChallenge;
      if (!challenge || !challenge.purpose.startsWith("profile-email-")) {
        throw httpError(400, "Start an email change to request a verification code.");
      }
      const purpose = challenge.purpose;
      const verified = await consumeVerificationCode(
        req,
        "profileEmailChallenge",
        purpose,
        req.body?.code
      );
      if (purpose === "profile-email-current") {
        await sendVerificationCode(
          req,
          "profileEmailChallenge",
          "profile-email-new",
          verified.newEmail,
          { newEmail: verified.newEmail }
        );
        res.status(202).json({ verificationRequired: true, stage: "new-email" });
        return;
      }

      const accountId = req.session.account.id;
      if (!ObjectId.isValid(accountId)) throw httpError(401, "Your account session is invalid. Sign in again.");
      try {
        const result = await db.collection("web_accounts").updateOne(
          { _id: new ObjectId(accountId) },
          {
            $set: {
              email: verified.newEmail,
              normalizedEmail: verified.newEmail,
              emailVerified: true,
              updatedAt: new Date(),
            },
          }
        );
        if (result.matchedCount !== 1) throw httpError(401, "Your account no longer exists. Sign in again.");
      } catch (error) {
        if (error?.code === 11000) throw httpError(409, "An account with this email already exists.");
        throw error;
      }
      req.session.account.email = verified.newEmail;
      await saveSession(req);
      res.json({ account: req.session.account });
    })
  );

  router.post(
    "/api/profile/password/code",
    requireSignedInAccount,
    requireSameOrigin,
    emailCodeRateLimit,
    asyncRoute(async (req, res) => {
      const newPassword = req.body?.password;
      validatePassword(newPassword);
      const email = normalizeEmail(req.session.account.email);
      if (!email) throw httpError(400, "This account does not have an email address for verification.");
      if (!verificationMailer.isConfigured()) {
        throw httpError(
          503,
          "Email verification is not configured. Add SMTP settings to the server environment.",
          "email_verification_not_configured"
        );
      }
      const passwordHash = await hashPassword(newPassword);
      await sendVerificationCode(
        req,
        "profilePasswordChallenge",
        "profile-password",
        email,
        { passwordHash }
      );
      res.status(202).json({ verificationRequired: true });
    })
  );

  router.post(
    "/api/profile/password/resend",
    requireSignedInAccount,
    requireSameOrigin,
    emailCodeRateLimit,
    asyncRoute(async (req, res) => {
      const challenge = req.session.profilePasswordChallenge;
      if (!challenge || challenge.purpose !== "profile-password") {
        throw httpError(400, "Start a password change to request a verification code.");
      }
      await sendVerificationCode(
        req,
        "profilePasswordChallenge",
        "profile-password",
        challenge.email,
        { passwordHash: challenge.passwordHash }
      );
      res.status(202).json({ verificationRequired: true });
    })
  );

  router.post(
    "/api/profile/password/verify",
    requireSignedInAccount,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      const challenge = await consumeVerificationCode(
        req,
        "profilePasswordChallenge",
        "profile-password",
        req.body?.code
      );
      const accountId = req.session.account.id;
      if (!ObjectId.isValid(accountId)) throw httpError(401, "Your account session is invalid. Sign in again.");
      const result = await db.collection("web_accounts").updateOne(
        { _id: new ObjectId(accountId) },
        { $set: { passwordHash: challenge.passwordHash, updatedAt: new Date() } }
      );
      if (result.matchedCount !== 1) throw httpError(401, "Your account no longer exists. Sign in again.");
      res.json({ updated: true });
    })
  );

  router.get("/api/languages", (req, res) => {
    res.json({ languages: Object.keys(languages) });
  });

  router.get("/api/mission-reset", (req, res) => {
    const nextReset = getNextReset();
    const userTimezone = req.session?.account?.timezone || null;
    res.json({
      nextReset: nextReset.toISOString(),
      timezone: userTimezone || "auto",
    });
  });

  if (websiteOnly) {
    router.use("/api", (req, res) => {
      res.status(404).json({ error: "This API is unavailable in the website-only development server." });
    });
  }

  router.get(
    "/api/guilds",
    requireDiscordConnected,
    asyncRoute(async (req, res) => {
      const guilds = await getManageableGuilds(req);
      const result = await Promise.all(
        guilds.map(async (guild) => ({
          id: guild.id,
          name: guild.name,
          clanMissionNotification: await getGuildConfig(guild.id),
        }))
      );
      res.json({ guilds: result });
    })
  );

  router.get(
    "/api/guilds/:guildId/clan-mission-notification",
    requireDiscordConnected,
    asyncRoute(async (req, res) => {
      await requireManageGuild(req, req.params.guildId);
      const settings = await getGuildConfig(req.params.guildId);
      res.json({ settings });
    })
  );

  router.get(
    "/api/guilds/:guildId/resources",
    requireDiscordConnected,
    asyncRoute(async (req, res) => {
      const guildId = req.params.guildId;
      await requireManageGuild(req, guildId);
      const guild = await getBotGuild(guildId);
      const me = guild.members.me || await guild.members.fetchMe();
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();

      res.json({
        channels: Array.from(channels.values())
          .filter((channel) =>
            channel.type === ChannelType.GuildText &&
            channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)
          )
          .map((channel) => ({ id: channel.id, name: channel.name })),
        roles: Array.from(roles.values())
          .filter((role) => role.id !== guild.id && !role.managed)
          .map((role) => ({ id: role.id, name: role.name })),
      });
    })
  );

  router.put(
    "/api/guilds/:guildId/clan-mission-notification",
    requireDiscordConnected,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      const guildId = req.params.guildId;
      await requireManageGuild(req, guildId);

      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw httpError(400, "A JSON settings object is required.");
      }

      const allowedKeys = new Set(["channelId", "roleId", "enabled", "language"]);
      if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
        throw httpError(400, "The settings payload contains unsupported fields.");
      }

      const existing = await getGuildConfig(guildId);
      const channelId = body.channelId === undefined ? existing?.channelId : body.channelId;
      const roleId = body.roleId === undefined ? existing?.roleId ?? null : body.roleId;
      const enabled = body.enabled === undefined ? existing?.enabled ?? true : body.enabled;
      const language = body.language === undefined ? existing?.language || "English" : body.language;

      if (!isDiscordSnowflake(channelId)) {
        throw httpError(400, "channelId must be a Discord channel ID.");
      }
      if (roleId !== null && !isDiscordSnowflake(roleId)) {
        throw httpError(400, "roleId must be a Discord role ID or null.");
      }
      if (typeof enabled !== "boolean") {
        throw httpError(400, "enabled must be a boolean.");
      }
      if (typeof language !== "string" || !Object.prototype.hasOwnProperty.call(languages, language)) {
        throw httpError(400, "language is not supported.");
      }

      const guild = await getBotGuild(guildId);
      const channels = await guild.channels.fetch();
      const channel = channels.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw httpError(400, "channelId must identify a text channel in this server.");
      }
      const me = guild.members.me || await guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)) {
        throw httpError(400, "The bot must have permission to send messages in this channel.");
      }

      if (roleId !== null) {
        const roles = await guild.roles.fetch();
        if (!roles.has(roleId) || roles.get(roleId).managed) {
          throw httpError(400, "roleId must identify a selectable role in this server.");
        }
      }

      const settings = {
        guildId,
        channelId,
        roleId,
        enabled,
        language,
        nextReset: existing?.nextReset || getNextReset().toISOString(),
      };

      await setGuildConfig(guildId, settings);
      res.json({ settings });
    })
  );

  router.delete(
    "/api/guilds/:guildId/clan-mission-notification",
    requireDiscordConnected,
    requireSameOrigin,
    writeRateLimit,
    asyncRoute(async (req, res) => {
      await requireManageGuild(req, req.params.guildId);
      const deleted = await deleteGuildConfig(req.params.guildId);
      res.json({ deleted });
    })
  );

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const databaseUnavailable = isMongoConnectivityError(error);
    const status = databaseUnavailable ? 503 : Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error(
        databaseUnavailable
          ? `[web-api] Database is temporarily unavailable (${error?.name || "Error"}).`
          : `[web-api] Request failed (${error?.name || "Error"}): ${error?.message || "No details"}.`
      );
    }
    const message = ["entity.parse.failed", "entity.too.large"].includes(error.type)
      ? "The request body is invalid or too large."
      : error.code === "email_verification_not_configured"
        ? "Email sign-in needs SMTP email settings on the server. Configure SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM, or use Google/Discord sign-in."
        : databaseUnavailable
          ? "Website database service is temporarily unavailable."
          : status >= 500 ? "The request could not be completed." : error.message;
    const payload = { error: message };
    if (error.code) payload.code = error.code;
    res.status(status).json(payload);
  });

  async function getAccessToken(req) {
    const oauth = req.session.oauth;
    if (!oauth) return null;
    if (oauth.expiresAt > Date.now() + 60_000) return oauth.accessToken;

    if (!oauth.refreshToken) {
      throw httpError(401, "Discord authorization expired. Reconnect Discord to continue.");
    }
    const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
      }),
    });

    if (!response.ok) {
      throw httpError(502, "Discord authorization could not be refreshed. Reconnect Discord to continue.");
    }
    const tokenData = await response.json();
    if (
      typeof tokenData.access_token !== "string" ||
      typeof tokenData.refresh_token !== "string" ||
      !Number.isFinite(tokenData.expires_in) ||
      tokenData.expires_in <= 0
    ) {
      throw httpError(502, "Discord returned an incomplete token refresh response.");
    }

    req.session.oauth = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };
    await saveSession(req);
    return req.session.oauth.accessToken;
  }

  async function getManageableGuilds(req) {
    const accessToken = await getAccessToken(req);
    if (!accessToken) {
      throw httpError(
        403,
        "Discord connection is required for this feature. Connect Discord to continue.",
        "discord_required"
      );
    }

    const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 401) throw httpError(401, "Please sign in again.");
    if (!response.ok) throw httpError(502, "Could not load Discord server permissions.");

    const guilds = await response.json();
    if (!Array.isArray(guilds)) throw httpError(502, "Discord returned an invalid server list.");

    return guilds.filter((guild) => {
      try {
        return (BigInt(guild.permissions || "0") & GUILD_MANAGEMENT_PERMISSIONS) !== 0n;
      } catch {
        return false;
      }
    });
  }

  async function getBotGuild(guildId) {
    let guild;
    try {
      guild = await discordClient.guilds.fetch(guildId);
    } catch (error) {
      if (error?.status === 403 || error?.status === 404 || error?.code === 10004) {
        throw httpError(403, "The bot must be a member of this Discord server.");
      }
      throw httpError(502, "Could not verify the bot's access to this Discord server.");
    }

    if (!guild) throw httpError(403, "The bot must be a member of this Discord server.");
    return guild;
  }

  async function requireManageGuild(req, guildId) {
    if (!isDiscordSnowflake(guildId)) throw httpError(400, "guildId must be a Discord server ID.");
    const guilds = await getManageableGuilds(req);
    if (!guilds.some((guild) => guild.id === guildId)) {
      throw httpError(403, "You must have Manage Server permission for this Discord server.");
    }
  }

  return router;
}

function requireDiscordConnected(req, res, next) {
  if (
    !isAuthenticated(req.session) ||
    !normalizeClanName(req.session?.account?.clanName) ||
    !req.session?.user ||
    !req.session?.oauth?.accessToken
  ) {
    return res.status(403).json({
      error: "Discord connection is required for this feature. Connect Discord to continue.",
      code: "discord_required",
    });
  }
  next();
}

function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    return "";
  }
  return normalizedEmail;
}

function normalizeFullName(fullName) {
  if (typeof fullName !== "string") return "";
  const normalized = fullName.trim();
  const length = Array.from(normalized).length;
  return length >= 2 && length <= 100 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "";
}

function normalizeClanName(clanName) {
  if (typeof clanName !== "string") return "";
  const normalized = clanName.trim();
  const length = Array.from(normalized).length;
  return length >= 1 && length <= 40 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "";
}

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw httpError(400, "Password must be between 12 and 128 characters.");
  }
}

function isAuthenticated(sessionData) {
  return Boolean(
    sessionData?.account?.id &&
    sessionData.emailVerified === true &&
    (sessionData.authenticated === true || sessionData.googleAuthenticated === true)
  );
}

function hasConfiguredValue(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function toPublicAccount(account) {
  return {
    id: String(account._id),
    email: account.email || "",
    displayName: account.displayName || account.fullName || "",
    ...(account.fullName || account.displayName
      ? { fullName: account.fullName || account.displayName }
      : {}),
    ...(account.clanName ? { clanName: account.clanName } : {}),
    ...(account.timezone ? { timezone: account.timezone } : {}),
  };
}

function establishAccountSession(req, account) {
  return regenerateSession(req).then(() => {
    req.session.authenticated = true;
    req.session.googleAuthenticated = true;
    req.session.emailVerified = account.emailVerified === true;
    req.session.account = toPublicAccount(account);
    return saveSession(req);
  });
}

function matchesOAuthState(expected, received) {
  if (typeof expected !== "string" || typeof received !== "string" || expected.length !== received.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function requireSameOrigin(req, res, next) {
  const isProduction = process.env.NODE_ENV === "production";
  const origin = req.get("origin");
  if (typeof origin !== "string" || !origin) {
    return res.status(403).json({ error: "Cross-origin request rejected." });
  }

  const allowedOrigins = new Set([
    getRedirectOrigin(process.env.DISCORD_OAUTH_REDIRECT_URI, isProduction),
    getRedirectOrigin(process.env.GOOGLE_OAUTH_REDIRECT_URI, isProduction),
    ...getAllowedWebOrigins(isProduction),
  ].filter(Boolean));

  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) allowedOrigins.add(requestOrigin);

  const hostOrigin = (() => {
    try {
      const host = req.get("host");
      if (!host) return null;
      return new URL(`${req.protocol}://${host}`).origin;
    } catch {
      return null;
    }
  })();
  if (hostOrigin) allowedOrigins.add(hostOrigin);

  if (!allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Cross-origin request rejected." });
  }
  next();
}

module.exports = { createDiscordOAuthRouter };

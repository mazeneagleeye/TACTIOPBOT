const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const test = require("node:test");
const { OAuth2Client } = require("google-auth-library");
const { ObjectId } = require("mongodb");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((condition) => matchesFilter(document, condition));
    const actual = getPath(document, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if (Object.hasOwn(expected, "$exists")) return (actual !== undefined) === expected.$exists;
      if (Object.hasOwn(expected, "$lte")) {
        return actual instanceof Date && actual <= expected.$lte;
      }
    }
    return isDeepStrictEqual(actual, expected);
  });
}

function createMemoryCollection(initialDocuments = []) {
  const documents = new Map(initialDocuments.map((document) => [document._id, clone(document)]));
  return {
    documents,
    async updateOne(filter, update, options = {}) {
      const current = documents.get(filter._id);
      if (current && !matchesFilter(current, filter)) {
        return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
      }
      if (current) {
        if (update.$set) documents.set(filter._id, { ...current, ...clone(update.$set) });
        if (update.$unset) {
          const next = documents.get(filter._id);
          for (const key of Object.keys(update.$unset)) delete next[key];
          documents.set(filter._id, next);
        }
        return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
      }
      if (!options.upsert) return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };

      const document = { _id: filter._id, ...clone(update.$setOnInsert || {}) };
      if (update.$set) Object.assign(document, clone(update.$set));
      documents.set(filter._id, document);
      return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const current = documents.get(filter._id);
      if (!current || !matchesFilter(current, filter)) return null;
      const updated = { ...current, ...clone(update.$set || {}) };
      documents.set(filter._id, updated);
      return clone(updated);
    },
    async findOne(filter) {
      return clone(documents.get(filter._id) || null);
    },
    find() {
      return { toArray: async () => Array.from(documents.values(), clone) };
    },
    async deleteOne(filter) {
      return {
        acknowledged: true,
        deletedCount: documents.delete(filter._id) ? 1 : 0,
      };
    },
  };
}

const settingsCollection = createMemoryCollection();
const accountDocuments = new Map();
const accountCollection = {
  async createIndex() {
    return "test-index";
  },
  async insertOne(document) {
    const insertedId = new ObjectId().toHexString();
    accountDocuments.set(String(insertedId), { _id: insertedId, ...clone(document) });
    return { acknowledged: true, insertedId };
  },
  async findOne(filter) {
    const documents = Array.from(accountDocuments.values());
    return clone(documents.find((document) =>
      Object.entries(filter).every(([key, expected]) => {
        if (key === "$or") return expected.some((condition) =>
          Object.entries(condition).every(([conditionKey, conditionValue]) => {
            const actual = getPath(document, conditionKey);
            return conditionKey === "_id"
              ? String(actual) === String(conditionValue)
              : isDeepStrictEqual(actual, conditionValue);
          })
        );
        const actual = getPath(document, key);
        return key === "_id"
          ? String(actual) === String(expected)
          : isDeepStrictEqual(actual, expected);
      })
    ) || null);
  },
  async updateOne(filter, update) {
    const entry = Array.from(accountDocuments.entries()).find(([, document]) =>
      Object.entries(filter).every(([key, expected]) => {
        if (key === "$or") return expected.some((condition) =>
          Object.entries(condition).every(([conditionKey, conditionValue]) => {
            const actual = getPath(document, conditionKey);
            if (conditionValue && typeof conditionValue === "object" && Object.hasOwn(conditionValue, "$exists")) {
              return (actual !== undefined) === conditionValue.$exists;
            }
            return conditionKey === "_id"
              ? String(actual) === String(conditionValue)
              : isDeepStrictEqual(actual, conditionValue);
          })
        );
        const actual = getPath(document, key);
        return key === "_id"
          ? String(actual) === String(expected)
          : isDeepStrictEqual(actual, expected);
      })
    );
    if (!entry) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    const [id, document] = entry;
    const updated = { ...document, ...clone(update.$set || {}) };
    accountDocuments.set(id, updated);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  },
};
const clanWarDocuments = new Map();
const clanWarCollection = {
  async createIndex() {
    return "test-clan-war-index";
  },
  async insertOne(document) {
    clanWarDocuments.set(String(document._id), { ...document, players: clone(document.players) });
    return { acknowledged: true, insertedId: document._id };
  },
  async findOne(filter) {
    const document = clanWarDocuments.get(String(filter._id));
    if (!document || (filter.ownerUserId && document.ownerUserId !== filter.ownerUserId)) return null;
    return { ...document, players: clone(document.players) };
  },
  find(filter = {}) {
    let documents = Array.from(clanWarDocuments.values())
      .filter((document) => matchesFilter(document, filter));
    const cursor = {
      sort(sort) {
        const [key, direction] = Object.entries(sort)[0] || [];
        if (key) documents = documents.sort((a, b) =>
          (a[key] - b[key]) * direction
        );
        return cursor;
      },
      limit(count) {
        documents = documents.slice(0, count);
        return cursor;
      },
      toArray: async () => documents.map((document) => ({
        ...document,
        players: clone(document.players),
      })),
    };
    return cursor;
  },
  async findOneAndUpdate(filter, update) {
    const current = clanWarDocuments.get(String(filter._id));
    if (!current || (filter.ownerUserId && current.ownerUserId !== filter.ownerUserId)) return null;
    const updated = { ...current, ...clone(update.$set || {}) };
    for (const [key, amount] of Object.entries(update.$inc || {})) {
      updated[key] = (updated[key] || 0) + amount;
    }
    clanWarDocuments.set(String(filter._id), updated);
    return { ...updated, players: clone(updated.players) };
  },
};
const fakeDatabase = {
  databaseName: "TACTIOPBOT",
  collection: (name) => {
    if (name === "cm_notification_settings") return settingsCollection;
    if (name === "web_accounts") return accountCollection;
    if (name === "web_clan_wars") return clanWarCollection;
    assert.fail(`Unexpected collection: ${name}`);
  },
};
const dbPath = require.resolve("../db");
const originalDbModule = require.cache[dbPath];
const fakeDbModule = new Module(dbPath);
fakeDbModule.filename = dbPath;
fakeDbModule.loaded = true;
fakeDbModule.exports = {
  connectToDatabase: async () => ({ configured: true, connected: true, db: fakeDatabase }),
};
require.cache[dbPath] = fakeDbModule;

const notifier = require("../utils/clanMissionNotifier");
const { migrateLegacySettings } = require("../utils/migrateClanMissionSettings");
let sessionState = {};

const sessionModulePath = require.resolve("express-session");
const mongoStoreModulePath = require.resolve("connect-mongo");
const originalSessionModule = require.cache[sessionModulePath];
const originalMongoStoreModule = require.cache[mongoStoreModulePath];
const fakeSessionModule = new Module(sessionModulePath);
fakeSessionModule.filename = sessionModulePath;
fakeSessionModule.loaded = true;
fakeSessionModule.exports = () => (req, res, next) => {
  const attachSessionMethods = () => {
    sessionState.save = (callback) => callback();
    sessionState.regenerate = (callback) => {
      sessionState = {};
      req.session = sessionState;
      attachSessionMethods();
      callback();
    };
    sessionState.destroy = (callback) => {
      sessionState = {};
      req.session = sessionState;
      attachSessionMethods();
      callback();
    };
  };
  req.session = sessionState;
  attachSessionMethods();
  next();
};
const fakeMongoStoreModule = new Module(mongoStoreModulePath);
fakeMongoStoreModule.filename = mongoStoreModulePath;
fakeMongoStoreModule.loaded = true;
fakeMongoStoreModule.exports = { MongoStore: { create: () => ({}) } };
require.cache[sessionModulePath] = fakeSessionModule;
require.cache[mongoStoreModulePath] = fakeMongoStoreModule;
const { createDiscordOAuthRouter } = require("../web/discordOAuth");
if (originalSessionModule) require.cache[sessionModulePath] = originalSessionModule;
else delete require.cache[sessionModulePath];
if (originalMongoStoreModule) require.cache[mongoStoreModulePath] = originalMongoStoreModule;
else delete require.cache[mongoStoreModulePath];

function writeLegacyFixture(data) {
  const filePath = path.join(
    os.tmpdir(),
    `tactiobot-migration-${process.pid}-${crypto.randomBytes(8).toString("hex")}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  return filePath;
}

test("legacy migration imports settings idempotently and preserves every field", async () => {
  const firstGuild = "12345678901234567";
  const secondGuild = "23456789012345678";
  const original = {
    guilds: {
      [firstGuild]: {
        channelId: "34567890123456789",
        roleId: "45678901234567890",
        enabled: false,
        language: "Arabic",
        nextReset: "2026-10-20T03:00:00.000Z",
        additionalSupportedField: "preserved",
      },
      [secondGuild]: {
        channelId: "56789012345678901",
        roleId: null,
        enabled: true,
        language: "English",
        nextReset: "2026-10-22T03:00:00.000Z",
      },
    },
  };
  const legacyFile = writeLegacyFixture(original);
  const collection = createMemoryCollection();

  try {
    assert.equal(await migrateLegacySettings(collection, legacyFile), 2);
    assert.equal(await migrateLegacySettings(collection, legacyFile), 2);
    assert.equal(collection.documents.size, 2);
    assert.deepEqual(
      collection.documents.get(firstGuild),
      { _id: firstGuild, ...original.guilds[firstGuild], guildId: firstGuild }
    );
    assert.deepEqual(
      collection.documents.get(secondGuild),
      { _id: secondGuild, ...original.guilds[secondGuild], guildId: secondGuild }
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, "utf8")), original);
  } finally {
    fs.unlinkSync(legacyFile);
  }
});

test("legacy migration rejects conflicts without overwriting existing MongoDB settings", async () => {
  const guildId = "34567890123456789";
  const stored = {
    _id: guildId,
    guildId,
    channelId: "45678901234567890",
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: "2026-10-20T03:00:00.000Z",
  };
  const collection = createMemoryCollection([stored]);
  const legacyFile = writeLegacyFixture({
    guilds: {
      [guildId]: { ...stored, channelId: "56789012345678901" },
    },
  });

  try {
    await assert.rejects(migrateLegacySettings(collection, legacyFile), /verification failed/);
    assert.deepEqual(collection.documents.get(guildId), stored);
    assert.equal(fs.existsSync(legacyFile), true);
  } finally {
    fs.unlinkSync(legacyFile);
  }
});

test("legacy migration rejects malformed data and invalid guild identifiers", async () => {
  const invalidShape = writeLegacyFixture({ guilds: [] });
  const invalidGuild = writeLegacyFixture({ guilds: { example: { channelId: "123" } } });
  try {
    await assert.rejects(migrateLegacySettings(createMemoryCollection(), invalidShape), /invalid format/);
    await assert.rejects(migrateLegacySettings(createMemoryCollection(), invalidGuild), /invalid for guild/);
  } finally {
    fs.unlinkSync(invalidShape);
    fs.unlinkSync(invalidGuild);
  }
});

test("notification settings CRUD remains isolated by guild ID", async () => {
  const firstGuild = "45678901234567890";
  const secondGuild = "56789012345678901";
  const firstConfig = {
    guildId: firstGuild,
    channelId: "67890123456789012",
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: "2026-10-20T03:00:00.000Z",
  };
  const secondConfig = {
    ...firstConfig,
    guildId: secondGuild,
    channelId: "78901234567890123",
    language: "Arabic",
  };

  await notifier.setGuildConfig(firstGuild, firstConfig);
  await notifier.setGuildConfig(secondGuild, secondConfig);
  assert.deepEqual(await notifier.getGuildConfig(firstGuild), firstConfig);
  assert.deepEqual(await notifier.getGuildConfig(secondGuild), secondConfig);
  assert.equal((await notifier.getAllGuildConfigs()).length, 2);

  await notifier.updateGuildNextReset(firstGuild, "2026-10-25T03:00:00.000Z");
  assert.equal((await notifier.getGuildConfig(firstGuild)).nextReset, "2026-10-25T03:00:00.000Z");
  assert.equal(await notifier.deleteGuildConfig(firstGuild), true);
  assert.equal(await notifier.deleteGuildConfig(firstGuild), false);
  assert.deepEqual(await notifier.getGuildConfig(secondGuild), secondConfig);
});

test("notification scheduler sends due reminders and advances the due guild reset", async () => {
  const guildId = "67890123456789012";
  const channelId = "78901234567890123";
  const config = {
    guildId,
    channelId,
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: "2000-01-01T00:00:00.000Z",
  };
  await notifier.setGuildConfig(guildId, config);
  let sentMessage = null;
  const client = {
    guilds: {
      fetch: async (requestedGuildId) => ({
        id: requestedGuildId,
        channels: {
          fetch: async (requestedChannelId) => ({
            id: requestedChannelId,
            isTextBased: () => true,
            send: async (message) => { sentMessage = message; },
          }),
        },
      }),
    },
  };
  const { checkAndSendNotifications } = require("../utils/clanMissionScheduler");

  await checkAndSendNotifications(client);

  assert.match(sentMessage, /Clan Missions Reset/);
  const stored = await notifier.getGuildConfig(guildId);
  assert.ok(new Date(stored.nextReset) > new Date());
  assert.equal(Object.hasOwn(stored, "notificationClaim"), false);
});

test("notification delivery failure preserves the due reset and permits retry", async () => {
  const guildId = "78901234567890123";
  const channelId = "89012345678901234";
  const dueReset = "2000-01-01T00:00:00.000Z";
  await notifier.setGuildConfig(guildId, {
    guildId,
    channelId,
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: dueReset,
  });

  let shouldFail = true;
  let sendCount = 0;
  const client = {
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async () => {
              sendCount += 1;
              if (shouldFail) throw new Error("temporary test delivery failure");
            },
          }),
        },
      }),
    },
  };
  const { checkAndSendNotifications } = require("../utils/clanMissionScheduler");

  await checkAndSendNotifications(client);
  let stored = await notifier.getGuildConfig(guildId);
  assert.equal(stored.nextReset, dueReset);
  assert.equal(Object.hasOwn(stored, "notificationClaim"), false);

  shouldFail = false;
  await checkAndSendNotifications(client);
  stored = await notifier.getGuildConfig(guildId);
  assert.ok(new Date(stored.nextReset) > new Date());
  assert.equal(Object.hasOwn(stored, "notificationClaim"), false);
  assert.equal(sendCount, 2);
});

test("overlapping notification checks share one in-flight check", async () => {
  const guildId = "89012345678901234";
  const channelId = "90123456789012345";
  await notifier.setGuildConfig(guildId, {
    guildId,
    channelId,
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: "2000-01-01T00:00:00.000Z",
  });

  let sendCount = 0;
  let releaseSend;
  let signalSendStarted;
  const sendStarted = new Promise((resolve) => { signalSendStarted = resolve; });
  const waitForSend = new Promise((resolve) => { releaseSend = resolve; });
  const client = {
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async () => {
              sendCount += 1;
              signalSendStarted();
              await waitForSend;
            },
          }),
        },
      }),
    },
  };
  const { checkAndSendNotifications } = require("../utils/clanMissionScheduler");

  const firstCheck = checkAndSendNotifications(client);
  await sendStarted;
  const overlappingCheck = checkAndSendNotifications(client);
  assert.equal(firstCheck, overlappingCheck);
  releaseSend();
  await Promise.all([firstCheck, overlappingCheck]);
  assert.equal(sendCount, 1);
});

test("MongoDB notification claims allow only one concurrent instance", async () => {
  const guildId = "90123456789012345";
  const dueReset = "2000-01-01T00:00:00.000Z";
  await notifier.setGuildConfig(guildId, {
    guildId,
    channelId: "91234567890123456",
    roleId: null,
    enabled: true,
    language: "English",
    nextReset: dueReset,
  });
  const now = new Date();
  const claims = await Promise.all([
    notifier.claimGuildNotification(guildId, dueReset, "claim-one", now, 60_000),
    notifier.claimGuildNotification(guildId, dueReset, "claim-two", now, 60_000),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);

  const winningToken = claims[0] ? "claim-one" : "claim-two";
  const recoveredToken = "claim-after-expiry";
  const reclaimed = await notifier.claimGuildNotification(
    guildId,
    dueReset,
    recoveredToken,
    new Date(now.getTime() + 60_001),
    60_000
  );
  assert.equal(reclaimed, true);

  const staleCompletion = await notifier.completeGuildNotification(
    guildId,
    dueReset,
    winningToken,
    "2026-10-24T03:00:00.000Z"
  );
  assert.equal(staleCompletion, false);
  const completed = await notifier.completeGuildNotification(
    guildId,
    dueReset,
    recoveredToken,
    "2026-10-24T03:00:00.000Z"
  );
  assert.equal(completed, true);
  const stored = await notifier.getGuildConfig(guildId);
  assert.equal(stored.nextReset, "2026-10-24T03:00:00.000Z");
  assert.equal(Object.hasOwn(stored, "notificationClaim"), false);

  const staleClaim = await notifier.claimGuildNotification(
    guildId,
    dueReset,
    "claim-stale",
    now,
    60_000
  );
  assert.equal(staleClaim, false);
});

test("Discord notification command schemas retain their supported options", () => {
  const setCommand = require("../commands/setcmnotif").data.toJSON();
  const editCommand = require("../commands/editcmnotif").data.toJSON();
  const deleteCommand = require("../commands/deletecmnotif").data.toJSON();
  const statusCommand = require("../commands/reminderstatus").data.toJSON();

  assert.deepEqual(setCommand.options.map((item) => item.name), ["channel", "role", "enabled", "language"]);
  assert.deepEqual(editCommand.options.map((item) => item.name), ["channel", "role", "enabled", "language"]);
  assert.equal(deleteCommand.name, "deletecmnotif");
  assert.equal(statusCommand.name, "reminderstatus");
});

test("Google website authentication fails closed when configuration is absent", async (t) => {
  const keys = ["CLIENT_ID", "CLIENT_SECRET", "DISCORD_OAUTH_REDIRECT_URI", "WEB_SESSION_SECRET"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  const express = require("express");
  const { createDiscordOAuthRouter } = require("../web/discordOAuth");
  const app = express();
  app.use(createDiscordOAuthRouter({}));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/auth/discord`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Website authentication is not configured." });
});

test("website-only launcher uses the shared database configuration and local callback", () => {
  const { getDevelopmentConfig } = require("../scripts/start-web-dev");
  const validEnvironment = {
    MONGODB_URI: "mongodb://127.0.0.1:27017",
    TACTIOPBOT_WEB_MONGODB_URI: "mongodb://127.0.0.1:27018",
    TACTIOBOT_DEV_PORT: "3000",
    TACTIOBOT_DEV_GOOGLE_OAUTH_ENABLED: "true",
    TACTIOBOT_DEV_GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/auth/google/callback",
    TACTIOBOT_DEV_GOOGLE_CLIENT_ID: "test-dev-client.apps.googleusercontent.com",
    TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET: "test-dev-google-client-secret",
    GOOGLE_CLIENT_ID: "production-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "production-google-client-secret",
    WEB_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
  };
  const config = getDevelopmentConfig(validEnvironment);
  assert.equal(config.port, 3000);
  assert.equal(config.mongoUriSource, "MONGODB_URI");
  assert.equal(config.uri, undefined);
  assert.equal(config.databaseName, undefined);
  assert.equal(config.googleEnabled, true);
  assert.equal(config.googleRedirectUri, "http://localhost:3000/auth/google/callback");
  assert.equal(config.googleClientId, "test-dev-client.apps.googleusercontent.com");
  assert.equal(config.googleClientSecret, "test-dev-google-client-secret");

  const missingMongoConfig = { ...validEnvironment };
  delete missingMongoConfig.MONGODB_URI;
  delete missingMongoConfig.TACTIOPBOT_WEB_MONGODB_URI;
  assert.throws(
    () => getDevelopmentConfig(missingMongoConfig),
    /Set MONGODB_URI or TACTIOPBOT_WEB_MONGODB_URI/
  );
  const overrideOnlyConfig = getDevelopmentConfig({
    ...validEnvironment,
    MONGODB_URI: undefined,
  });
  assert.equal(overrideOnlyConfig.mongoUriSource, "TACTIOPBOT_WEB_MONGODB_URI");
  assert.throws(
    () => getDevelopmentConfig({
      ...validEnvironment,
      TACTIOPBOT_WEB_MONGODB_DB_NAME: "OTHER_DATABASE",
    }),
    /must be TACTIOPBOT/
  );
  assert.throws(
    () => getDevelopmentConfig({
      ...validEnvironment,
      TACTIOBOT_DEV_GOOGLE_OAUTH_REDIRECT_URI: "https://example.com/auth/google/callback",
    }),
    /must match this local server/
  );
  const disabledConfig = { ...validEnvironment, TACTIOBOT_DEV_GOOGLE_OAUTH_ENABLED: "false" };
  delete disabledConfig.TACTIOBOT_DEV_GOOGLE_CLIENT_ID;
  delete disabledConfig.TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET;
  const googleDisabled = getDevelopmentConfig(disabledConfig);
  assert.equal(googleDisabled.googleEnabled, false);
  assert.equal(googleDisabled.googleClientId, undefined);
  assert.equal(googleDisabled.googleClientSecret, undefined);

  const sharedCredentialsEnvironment = { ...validEnvironment };
  delete sharedCredentialsEnvironment.TACTIOBOT_DEV_GOOGLE_CLIENT_ID;
  delete sharedCredentialsEnvironment.TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET;
  const sharedCredentialsConfig = getDevelopmentConfig(sharedCredentialsEnvironment);
  assert.equal(sharedCredentialsConfig.googleClientId, "production-client.apps.googleusercontent.com");
  assert.equal(sharedCredentialsConfig.googleClientSecret, "production-google-client-secret");

  assert.throws(
    () => getDevelopmentConfig({
      ...validEnvironment,
      GOOGLE_CLIENT_SECRET: undefined,
      TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET: undefined,
    }),
    /TACTIOPBOT_DEV_GOOGLE_CLIENT_ID and TACTIOPBOT_DEV_GOOGLE_CLIENT_SECRET/
  );
});

test("website-only OAuth router enables sign-in but keeps guild APIs unavailable", async (t) => {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CLIENT_ID = "test-client-id";
  process.env.CLIENT_SECRET = "test-client-secret";
  process.env.DISCORD_OAUTH_REDIRECT_URI = "http://localhost/auth/discord/callback";
  process.env.GOOGLE_OAUTH_ENABLED = "false";
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "development";
  sessionState = {};

  const express = require("express");
  const app = express();
  app.use(createDiscordOAuthRouter({
    client: {},
    db: fakeDatabase,
    websiteOnly: true,
    discordClient: null,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const providers = await fetch(`${baseUrl}/auth/providers`);
  assert.deepEqual(await providers.json(), {
    discord: true,
    google: false,
    discordServerManagement: false,
    emailTestAdmin: false,
  });

  const discordLogin = await fetch(`${baseUrl}/auth/discord`, { redirect: "manual" });
  assert.equal(discordLogin.status, 302);
  assert.equal(new URL(discordLogin.headers.get("location")).origin, "https://discord.com");

  const dashboardApi = await fetch(`${baseUrl}/api/guilds`);
  assert.equal(dashboardApi.status, 404);
  assert.deepEqual(await dashboardApi.json(), {
    error: "This API is unavailable in the website-only development server.",
  });
});

test("unconfigured providers stay unavailable and reject invalid email login", async (t) => {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  sessionState = {};
  accountDocuments.clear();

  const express = require("express");
  const app = express();
  app.use(createDiscordOAuthRouter({
    client: {},
    db: fakeDatabase,
    discordClient: { guilds: { fetch: async () => null } },
    verificationMailer: {
      isConfigured: () => false,
      sendCode: async () => assert.fail("Unconfigured verification mailer must not send email."),
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const providers = await fetch(`${baseUrl}/auth/providers`);
  assert.deepEqual(await providers.json(), {
    discord: false,
    google: false,
    discordServerManagement: true,
    emailTestAdmin: false,
  });

  const googleStart = await fetch(`${baseUrl}/auth/google`, { redirect: "manual" });
  assert.equal(googleStart.status, 503);
  assert.deepEqual(await googleStart.json(), { error: "The request could not be completed." });

  const currentAccount = await fetch(`${baseUrl}/api/me`);
  assert.deepEqual(await currentAccount.json(), { user: null, account: null });

  const discordStart = await fetch(`${baseUrl}/auth/discord`, { redirect: "manual" });
  assert.equal(discordStart.status, 503);

  const passwordLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "a-password" }),
  });
  assert.equal(passwordLogin.status, 400);
  assert.equal(accountDocuments.size, 0);

  const validPassword = "a-valid-test-password";
  const salt = Buffer.alloc(16, 1);
  const passwordHash = crypto.scryptSync(validPassword, salt, 64, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const accountId = new ObjectId().toHexString();
  accountDocuments.set(accountId, {
    _id: accountId,
    normalizedEmail: "person@example.com",
    passwordHash: `scrypt$32768$8$1$${salt.toString("base64url")}$${passwordHash.toString("base64url")}`,
  });
  const emailLogin = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: validPassword }),
  });
  assert.equal(emailLogin.status, 503);
  assert.deepEqual(await emailLogin.json(), {
    error: "Email sign-in needs SMTP email settings on the server. Configure SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM, or use Google/Discord sign-in.",
    code: "email_verification_not_configured",
  });
});

test("Google OIDC validates state, PKCE, nonce, claims, and account conflicts", async (t) => {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/auth/google/callback";
  process.env.GOOGLE_OAUTH_ENABLED = "true";
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  delete process.env.CLIENT_ID;
  delete process.env.CLIENT_SECRET;
  delete process.env.DISCORD_OAUTH_REDIRECT_URI;
  sessionState = {};
  accountDocuments.clear();

  const originalGenerateCodeVerifier = OAuth2Client.prototype.generateCodeVerifierAsync;
  const originalGetToken = OAuth2Client.prototype.getToken;
  const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
  let tokenExchange = null;
  let googleProfile = null;
  OAuth2Client.prototype.generateCodeVerifierAsync = async () => ({
    codeVerifier: "test-code-verifier",
    codeChallenge: "test-code-challenge",
  });
  OAuth2Client.prototype.getToken = async (options) => {
    tokenExchange = options;
    return { tokens: { id_token: "test-google-id-token" } };
  };
  OAuth2Client.prototype.verifyIdToken = async (options) => {
    assert.equal(options.idToken, "test-google-id-token");
    assert.equal(options.audience, process.env.GOOGLE_CLIENT_ID);
    return { getPayload: () => googleProfile };
  };

  const express = require("express");
  const app = express();
  app.use(createDiscordOAuthRouter({
    client: {},
    db: fakeDatabase,
    discordClient: { guilds: { fetch: async () => null } },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    OAuth2Client.prototype.generateCodeVerifierAsync = originalGenerateCodeVerifier;
    OAuth2Client.prototype.getToken = originalGetToken;
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
    await new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const providers = await fetch(`${baseUrl}/auth/providers`);
  assert.deepEqual(await providers.json(), {
    discord: false,
    google: true,
    discordServerManagement: true,
    emailTestAdmin: false,
  });

  const startLogin = async () => fetch(`${baseUrl}/auth/google`, { redirect: "manual" });
  const authorization = await startLogin();
  assert.equal(authorization.status, 302);
  const authorizationUrl = new URL(authorization.headers.get("location"));
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), "test-code-challenge");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorizationUrl.searchParams.get("state"), /^[a-f0-9]{64}$/);
  assert.ok(authorizationUrl.searchParams.get("nonce"));
  assert.ok(authorizationUrl.searchParams.get("scope").includes("openid"));

  const invalidState = await fetch(
    `${baseUrl}/auth/google/callback?state=invalid&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(invalidState.status, 400);
  assert.equal(tokenExchange, null);

  const rejectedLogin = await startLogin();
  const rejectedState = new URL(rejectedLogin.headers.get("location")).searchParams.get("state");
  googleProfile = {
    sub: "google-subject-1",
    email: "person@example.com",
    email_verified: true,
    nonce: "incorrect-nonce",
  };
  const badNonce = await fetch(
    `${baseUrl}/auth/google/callback?state=${rejectedState}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(badNonce.status, 302);
  assert.equal(badNonce.headers.get("location"), "/?auth_error=google_unverified");
  assert.equal(accountDocuments.size, 0);

  const unverifiedLogin = await startLogin();
  const unverifiedState = new URL(unverifiedLogin.headers.get("location")).searchParams.get("state");
  googleProfile = {
    sub: "google-subject-1",
    email: "person@example.com",
    email_verified: false,
    nonce: sessionState.googleOAuthNonce,
  };
  const unverifiedEmail = await fetch(
    `${baseUrl}/auth/google/callback?state=${unverifiedState}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(unverifiedEmail.status, 302);
  assert.equal(unverifiedEmail.headers.get("location"), "/?auth_error=google_unverified");
  assert.equal(accountDocuments.size, 0);

  const successfulLogin = await startLogin();
  const successfulState = new URL(successfulLogin.headers.get("location")).searchParams.get("state");
  googleProfile = {
    sub: "google-subject-1",
    email: " Person@Example.com ",
    name: "Google User",
    email_verified: true,
    nonce: sessionState.googleOAuthNonce,
  };
  const successfulCallback = await fetch(
    `${baseUrl}/auth/google/callback?state=${successfulState}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(successfulCallback.status, 302);
  assert.equal(successfulCallback.headers.get("location"), "/profile/complete");
  assert.deepEqual(tokenExchange, { code: "test-code", codeVerifier: "test-code-verifier" });
  assert.equal(accountDocuments.size, 1);
  const googleAccount = Array.from(accountDocuments.values())[0];
  assert.equal(googleAccount.email, "person@example.com");
  assert.equal(googleAccount.normalizedEmail, "person@example.com");
  assert.equal(googleAccount.googleId, "google-subject-1");
  assert.equal(googleAccount.fullName, "Google User");
  assert.equal(Object.hasOwn(googleAccount, "passwordHash"), false);
  assert.equal(sessionState.account.email, "person@example.com");
  const currentGoogleAccount = await fetch(`${baseUrl}/api/me`);
  assert.deepEqual(await currentGoogleAccount.json(), {
    user: null,
    account: {
      id: String(googleAccount._id),
      email: "person@example.com",
      displayName: "Google User",
      fullName: "Google User",
    },
  });
  const unconnectedGuilds = await fetch(`${baseUrl}/api/guilds`);
  assert.equal(unconnectedGuilds.status, 403);
  assert.equal((await unconnectedGuilds.json()).code, "discord_required");

  const repeatLogin = await startLogin();
  const repeatState = new URL(repeatLogin.headers.get("location")).searchParams.get("state");
  googleProfile = {
    sub: "google-subject-1",
    email: "person@example.com",
    name: "Google User",
    email_verified: true,
    nonce: sessionState.googleOAuthNonce,
  };
  const existingGoogleLogin = await fetch(
    `${baseUrl}/auth/google/callback?state=${repeatState}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(existingGoogleLogin.status, 302);
  assert.equal(existingGoogleLogin.headers.get("location"), "/profile/complete");
  assert.equal(accountDocuments.size, 1);

  const existingId = await accountCollection.insertOne({
    normalizedEmail: "existing@example.com",
    email: "existing@example.com",
    passwordHash: "existing-account-hash",
  });
  const conflictLogin = await startLogin();
  const conflictState = new URL(conflictLogin.headers.get("location")).searchParams.get("state");
  googleProfile = {
    sub: "google-subject-2",
    email: "EXISTING@example.com",
    email_verified: true,
    nonce: sessionState.googleOAuthNonce,
  };
  const conflictCallback = await fetch(
    `${baseUrl}/auth/google/callback?state=${conflictState}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(conflictCallback.status, 302);
  assert.equal(conflictCallback.headers.get("location"), "/?auth_error=google_account_conflict");
  assert.equal(accountDocuments.size, 2);
  const existingAccount = accountDocuments.get(String(existingId.insertedId));
  assert.equal(Object.hasOwn(existingAccount, "googleId"), false);
});

test("Google provider readiness requires explicit enablement and an exact valid callback", async (t) => {
  const keys = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/auth/google/callback";
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  const express = require("express");

  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function getProviderStatus(enabled, callbackUri, clientId) {
    process.env.GOOGLE_OAUTH_ENABLED = enabled;
    process.env.GOOGLE_OAUTH_REDIRECT_URI = callbackUri;
    process.env.GOOGLE_CLIENT_ID = clientId;
    const app = express();
    app.use(createDiscordOAuthRouter({
      client: {},
      db: fakeDatabase,
      discordClient: { guilds: { fetch: async () => null } },
    }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/providers`);
      assert.equal(response.status, 200);
      return (await response.json()).google;
    } finally {
      await new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  assert.equal(await getProviderStatus(
    "false",
    "http://localhost:3000/auth/google/callback",
    "test-client.apps.googleusercontent.com"
  ), false);
  assert.equal(await getProviderStatus(
    "true",
    "http://localhost:3000/auth/other",
    "test-client.apps.googleusercontent.com"
  ), false);
  assert.equal(await getProviderStatus(
    "true",
    "http://localhost:3000/auth/google/callback",
    " test-client.apps.googleusercontent.com"
  ), false);
  assert.equal(await getProviderStatus(
    "true",
    " http://localhost:3000/auth/google/callback",
    "test-client.apps.googleusercontent.com"
  ), false);
  process.env.NODE_ENV = "production";
  assert.equal(await getProviderStatus(
    "true",
    "http://localhost:3000/auth/google/callback",
    "test-client.apps.googleusercontent.com"
  ), false);
});

test("OAuth callback rejects invalid state and guild APIs reject unauthorized servers", async (t) => {
  const keys = ["CLIENT_ID", "CLIENT_SECRET", "DISCORD_OAUTH_REDIRECT_URI", "WEB_SESSION_SECRET", "NODE_ENV"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CLIENT_ID = "test-client-id";
  process.env.CLIENT_SECRET = "test-client-secret";
  process.env.DISCORD_OAUTH_REDIRECT_URI = "http://localhost/auth/discord/callback";
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  accountDocuments.clear();
  const googleAccountId = (await accountCollection.insertOne({
    normalizedEmail: "google-user@example.com",
    email: "google-user@example.com",
    googleId: "google-subject-discord-test",
    clanName: "Test Clan",
  })).insertedId;
  sessionState = {
    user: { id: "12345678901234567", username: "test-user", globalName: null },
    oauth: {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.now() + 10 * 60 * 1000,
    },
  };

  const originalFetch = global.fetch;
  let discordGuilds = [{ id: "23456789012345678", permissions: "0" }];
  global.fetch = async () => new Response(JSON.stringify(discordGuilds), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const guildId = "23456789012345678";
  const channelId = "34567890123456789";
  const roleId = "45678901234567890";
  let botCanSendMessages = true;
  const textChannel = {
    id: channelId,
    name: "clan-missions",
    type: 0,
    permissionsFor: () => ({ has: () => botCanSendMessages }),
  };
  const guild = {
    id: guildId,
    members: { me: { id: "56789012345678901" }, fetchMe: async () => ({ id: "56789012345678901" }) },
    channels: { fetch: async () => new Map([[channelId, textChannel]]) },
    roles: {
      fetch: async () => new Map([
        [guildId, { id: guildId, name: "@everyone", managed: false }],
        [roleId, { id: roleId, name: "Mission Alerts", managed: false }],
      ]),
    },
  };
  let botGuildFetch = async () => guild;
  const client = { guilds: { fetch: (...args) => botGuildFetch(...args) } };
  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(createDiscordOAuthRouter({
    client: {},
    db: fakeDatabase,
    discordClient: client,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => originalFetch(url, {
    ...options,
    headers: {
      "X-Forwarded-For": "198.51.100.33",
      ...(options.headers || {}),
    },
  });
  const discordOnlyStart = await request(`${baseUrl}/auth/discord`, { redirect: "manual" });
  assert.equal(discordOnlyStart.status, 302);
  const unauthenticatedAuthorization = new URL(discordOnlyStart.headers.get("location"));
  const discordOnlyState = unauthenticatedAuthorization.searchParams.get("state");
  assert.equal(unauthenticatedAuthorization.searchParams.get("scope"), "identify email guilds");

  const discordOnlyApi = await request(`${baseUrl}/api/guilds`);
  assert.equal(discordOnlyApi.status, 403);
  assert.deepEqual(await discordOnlyApi.json(), {
    error: "Discord connection is required for this feature. Connect Discord to continue.",
    code: "discord_required",
  });
  sessionState.oauthState = discordOnlyState;
  sessionState.oauthMode = "login";
  const discordOnlyCallback = await request(
    `${baseUrl}/auth/discord/callback?state=${discordOnlyState}&error=access_denied`,
    { redirect: "manual" }
  );
  assert.equal(discordOnlyCallback.status, 302);
  assert.equal(discordOnlyCallback.headers.get("location"), "/?auth_error=discord_cancelled");
  assert.equal(sessionState.user.id, "12345678901234567");

  sessionState.googleAuthenticated = true;
  sessionState.emailVerified = true;
  sessionState.account = {
    id: String(googleAccountId),
    email: "google-user@example.com",
    displayName: "",
    clanName: "Test Clan",
  };
  const loginStart = await request(`${baseUrl}/auth/discord?link=1`, { redirect: "manual" });
  assert.equal(loginStart.status, 302);
  const authorizationUrl = new URL(loginStart.headers.get("location"));
  assert.equal(authorizationUrl.origin, "https://discord.com");
  assert.equal(authorizationUrl.pathname, "/api/v10/oauth2/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "test-client-id");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), process.env.DISCORD_OAUTH_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get("scope"), "identify email guilds");
  assert.match(authorizationUrl.searchParams.get("state"), /^[a-f0-9]{64}$/);
  assert.equal(sessionState.oauthState, authorizationUrl.searchParams.get("state"));
  assert.equal(authorizationUrl.searchParams.has("client_secret"), false);

  const callback = await request(`${baseUrl}/auth/discord/callback?state=invalid&code=invalid`);
  assert.equal(callback.status, 400);
  assert.deepEqual(await callback.json(), { error: "Invalid OAuth state." });

  const currentUser = await request(`${baseUrl}/api/me`);
  assert.equal(currentUser.status, 200);
  assert.deepEqual(await currentUser.json(), {
    user: { id: "12345678901234567", username: "test-user", globalName: null },
    account: {
      id: String(googleAccountId),
      email: "google-user@example.com",
      displayName: "",
      clanName: "Test Clan",
    },
  });

  const protectedSettings = await request(
    `${baseUrl}/api/guilds/${guildId}/clan-mission-notification`
  );
  assert.equal(protectedSettings.status, 403);
  assert.deepEqual(await protectedSettings.json(), {
    error: "You must have Manage Server permission for this Discord server.",
  });

  const csrfAttempt = await request(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(csrfAttempt.status, 403);
  assert.deepEqual(await csrfAttempt.json(), { error: "Cross-origin request rejected." });

  discordGuilds = [{ id: guildId, permissions: "32" }];
  const resources = await request(`${baseUrl}/api/guilds/${guildId}/resources`);
  assert.equal(resources.status, 200);
  assert.deepEqual(await resources.json(), {
    channels: [{ id: channelId, name: "clan-missions" }],
    roles: [{ id: roleId, name: "Mission Alerts" }],
  });

  botGuildFetch = async () => {
    throw Object.assign(new Error("temporary Discord failure"), { status: 503 });
  };
  const discordFailure = await request(`${baseUrl}/api/guilds/${guildId}/resources`);
  assert.equal(discordFailure.status, 502);
  assert.deepEqual(await discordFailure.json(), {
    error: "The request could not be completed.",
  });

  botGuildFetch = async () => {
    throw Object.assign(new Error("unknown guild"), { status: 404 });
  };
  const botNotInGuild = await request(`${baseUrl}/api/guilds/${guildId}/resources`);
  assert.equal(botNotInGuild.status, 403);
  assert.deepEqual(await botNotInGuild.json(), {
    error: "The bot must be a member of this Discord server.",
  });
  botGuildFetch = async () => guild;

  botCanSendMessages = false;
  const forbiddenChannel = await originalFetch(
    `${baseUrl}/api/guilds/${guildId}/clan-mission-notification`,
    {
      method: "PUT",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    }
  );
  assert.equal(forbiddenChannel.status, 400);
  botCanSendMessages = true;

  const savedSettings = await originalFetch(
    `${baseUrl}/api/guilds/${guildId}/clan-mission-notification`,
    {
      method: "PUT",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, roleId, enabled: false, language: "Arabic" }),
    }
  );
  assert.equal(savedSettings.status, 200);
  assert.deepEqual((await savedSettings.json()).settings, {
    guildId,
    channelId,
    roleId,
    enabled: false,
    language: "Arabic",
    nextReset: (await notifier.getGuildConfig(guildId)).nextReset,
  });

  const invalidChannel = await originalFetch(
    `${baseUrl}/api/guilds/${guildId}/clan-mission-notification`,
    {
      method: "PUT",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: "56789012345678901" }),
    }
  );
  assert.equal(invalidChannel.status, 400);

  const logout = await request(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { Origin: "http://localhost" },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(logout.headers.get("set-cookie") || "", /SameSite=Lax/i);

  sessionState = {
    oauthState: "expected-callback-state",
    oauthLinkAccountId: String(googleAccountId),
    googleAuthenticated: true,
    emailVerified: true,
    account: {
      id: String(googleAccountId),
      email: "google-user@example.com",
      displayName: "",
    },
  };
  global.fetch = async (url, options) => {
    if (url.endsWith("/oauth2/token")) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("client_id"), "test-client-id");
      assert.equal(form.get("client_secret"), "test-client-secret");
      assert.equal(form.get("redirect_uri"), process.env.DISCORD_OAUTH_REDIRECT_URI);
      return new Response(JSON.stringify({
        access_token: "test-issued-access-token",
        refresh_token: "test-issued-refresh-token",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    assert.equal(url, "https://discord.com/api/v10/users/@me");
    assert.equal(options.headers.Authorization, "Bearer test-issued-access-token");
    return new Response(JSON.stringify({
      id: "67890123456789012",
      username: "oauth-user",
      global_name: "OAuth User",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const successfulCallback = await request(
    `${baseUrl}/auth/discord/callback?state=expected-callback-state&code=test-authorization-code`,
    { redirect: "manual" }
  );
  assert.equal(successfulCallback.status, 302);
  assert.equal(successfulCallback.headers.get("location"), "/");
  assert.equal(sessionState.googleAuthenticated, true);
  assert.equal(sessionState.account.id, String(googleAccountId));
  assert.deepEqual(sessionState.user, {
    id: "67890123456789012",
    username: "oauth-user",
    globalName: "OAuth User",
  });
  assert.equal(sessionState.oauth.accessToken, "test-issued-access-token");
  assert.equal(sessionState.oauth.refreshToken, "test-issued-refresh-token");
  assert.equal(accountDocuments.get(String(googleAccountId)).discordId, "67890123456789012");

  const secondGoogleAccountId = (await accountCollection.insertOne({
    normalizedEmail: "second-google-user@example.com",
    email: "second-google-user@example.com",
    googleId: "second-google-subject",
  })).insertedId;
  sessionState = {
    googleAuthenticated: true,
    emailVerified: true,
    account: {
      id: String(secondGoogleAccountId),
      email: "second-google-user@example.com",
      displayName: "",
    },
  };
  const secondLinkStart = await request(`${baseUrl}/auth/discord?link=1`, { redirect: "manual" });
  assert.equal(secondLinkStart.status, 302);
  const secondLinkState = new URL(secondLinkStart.headers.get("location")).searchParams.get("state");
  const duplicateDiscordLink = await request(
    `${baseUrl}/auth/discord/callback?state=${secondLinkState}&code=test-authorization-code`,
    { redirect: "manual" }
  );
  assert.equal(duplicateDiscordLink.status, 302);
  assert.equal(duplicateDiscordLink.headers.get("location"), "/?auth_error=discord_account_conflict");
  assert.equal(accountDocuments.get(String(secondGoogleAccountId)).discordId, undefined);
});

test("email registration, login, profile updates, and dashboard protection work end-to-end", async (t) => {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
    "EMAIL_TEST_ADMIN_EMAILS",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  process.env.EMAIL_TEST_ADMIN_EMAILS = " TACTIOPBOT@GMAIL.COM , admin@example.com ";
  sessionState = {};
  accountDocuments.clear();
  const sentCodes = [];
  const sentTestEmails = [];

  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(createDiscordOAuthRouter({
    client: {},
    db: fakeDatabase,
    verificationMailer: {
      isConfigured: () => true,
      sendCode: async (email, code, purpose) => sentCodes.push({ email, code, purpose }),
      sendTestEmail: async (email) => sentTestEmails.push(email),
    },
  }));
  app.get("/dashboard/private", (_req, res) => res.status(200).send("dashboard"));
  app.get("/", (_req, res) => res.status(200).send("home"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      "X-Forwarded-For": "198.51.100.31",
      ...(options.method ? { Origin: baseUrl } : {}),
      ...(options.headers || {}),
    },
  });
  const registration = await request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "  Test Operator  ",
      clanName: "  Actual Clan  ",
      email: "  Person@Example.com ",
      password: "a-very-long-password",
    }),
  });
  assert.equal(registration.status, 202);
  assert.equal(accountDocuments.size, 0);
  const registrationChallenge = sessionState.registrationChallenge;
  assert.match(registrationChallenge.codeHash, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(registrationChallenge.codeHash, sentCodes.at(-1).code);
  assert.ok(Math.abs(
    registrationChallenge.expiresAt - registrationChallenge.sentAt - 10 * 60 * 1000
  ) < 5);
  const resendTooSoon = await request("/auth/register/resend", { method: "POST" });
  assert.equal(resendTooSoon.status, 429);
  assert.deepEqual(await (await request("/auth/pending")).json(), {
    action: "register",
    email: "person@example.com",
  });
  const registrationVerification = await request("/auth/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sentCodes.at(-1).code }),
  });
  assert.equal(registrationVerification.status, 201);
  assert.equal(sessionState.authenticated, true);
  const account = Array.from(accountDocuments.values())[0];
  assert.equal(account.email, "person@example.com");
  assert.equal(account.emailVerified, true);
  assert.equal(account.fullName, "Test Operator");
  assert.equal(account.clanName, "Actual Clan");
  assert.match(account.passwordHash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(account.passwordHash.includes("a-very-long-password"), false);
  assert.equal(sessionState.emailVerified, true);

  const duplicate = await request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Another Person",
      clanName: "Some Clan",
      email: "person@example.com",
      password: "another-long-password",
    }),
  });
  assert.equal(duplicate.status, 409);

  const updatedProfile = await request("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Updated Operator", clanName: "Updated Clan" }),
  });
  assert.equal(updatedProfile.status, 200);
  const updatedProfileBody = await updatedProfile.json();
  assert.equal(updatedProfileBody.account.fullName, "Updated Operator");
  assert.equal(updatedProfileBody.account.clanName, "Updated Clan");
  assert.equal(accountDocuments.get(String(account._id)).fullName, "Updated Operator");
  assert.equal(accountDocuments.get(String(account._id)).clanName, "Updated Clan");
  assert.equal((await request("/dashboard/private")).status, 200);
  sessionState.emailVerified = false;
  const unverifiedDashboard = await request("/dashboard/private", { redirect: "manual" });
  assert.equal(unverifiedDashboard.status, 302);
  assert.equal((await request("/api/clan-wars")).status, 401);
  sessionState.emailVerified = true;

  const emailCode = await request("/api/profile/email/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "new-person@example.com" }),
  });
  assert.equal(emailCode.status, 202);
  assert.equal(sentCodes.at(-1).email, "person@example.com");
  assert.deepEqual(await (await request("/api/profile/pending")).json(), {
    emailChange: { stage: "current-email", email: "new-person@example.com" },
    passwordChange: false,
  });
  const currentEmailVerified = await request("/api/profile/email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sentCodes.at(-1).code }),
  });
  assert.equal(currentEmailVerified.status, 202);
  assert.equal((await currentEmailVerified.json()).stage, "new-email");
  assert.equal(sentCodes.at(-1).email, "new-person@example.com");
  const newEmailVerified = await request("/api/profile/email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sentCodes.at(-1).code }),
  });
  assert.equal(newEmailVerified.status, 200);
  assert.equal((await newEmailVerified.json()).account.email, "new-person@example.com");
  assert.equal(accountDocuments.get(String(account._id)).normalizedEmail, "new-person@example.com");

  const passwordCode = await request("/api/profile/password/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "a-different-long-password" }),
  });
  assert.equal(passwordCode.status, 202);
  assert.equal(sentCodes.at(-1).email, "new-person@example.com");
  assert.deepEqual(await (await request("/api/profile/pending")).json(), {
    emailChange: null,
    passwordChange: true,
  });
  const passwordVerified = await request("/api/profile/password/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sentCodes.at(-1).code }),
  });
  assert.equal(passwordVerified.status, 200);

  const logout = await request("/auth/logout", { method: "POST" });
  assert.equal(logout.status, 204);
  assert.equal(sessionState.account, undefined);
  const signedOutDashboard = await request("/dashboard/private", { redirect: "manual" });
  assert.equal(signedOutDashboard.status, 302);
  assert.equal(signedOutDashboard.headers.get("location"), "/?auth_error=sign_in_required");

  const invalidPassword = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "new-person@example.com", password: "wrong-password" }),
  });
  assert.equal(invalidPassword.status, 401);
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: " NEW-PERSON@example.com ", password: "a-different-long-password" }),
  });
  assert.equal(login.status, 202);
  const loginVerification = await request("/auth/login/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: sentCodes.at(-1).code }),
  });
  assert.equal(loginVerification.status, 200);
  const currentUser = await request("/api/me");
  assert.deepEqual((await currentUser.json()).account, {
    id: String(account._id),
    email: "new-person@example.com",
    displayName: "Updated Operator",
    fullName: "Updated Operator",
    clanName: "Updated Clan",
  });

  const userEmail = sessionState.account.email;
  sessionState.account.email = "tactiopbot@gmail.com";
  const adminProviders = await request("/auth/providers");
  assert.equal((await adminProviders.json()).emailTestAdmin, true);
  const emailTest = await request("/api/admin/email/test", { method: "POST" });
  assert.equal(emailTest.status, 200);
  assert.deepEqual(await emailTest.json(), { sent: true });
  assert.deepEqual(sentTestEmails, ["tactiopbot@gmail.com"]);

  sessionState.account.email = userEmail;
  const nonAdminProviders = await request("/auth/providers");
  assert.equal((await nonAdminProviders.json()).emailTestAdmin, false);
  const nonAdminEmailTest = await request("/api/admin/email/test", { method: "POST" });
  assert.equal(nonAdminEmailTest.status, 403);
  assert.deepEqual(sentTestEmails, ["tactiopbot@gmail.com"]);
  assert.equal((await request("/auth/logout", { method: "POST" })).status, 204);
});

test("Discord OAuth signs users in, requires clan completion, and reuses linked identities", async (t) => {
  const keys = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_ENABLED",
    "WEB_SESSION_SECRET",
    "NODE_ENV",
  ];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CLIENT_ID = "test-discord-client";
  process.env.CLIENT_SECRET = "test-discord-secret";
  process.env.DISCORD_OAUTH_REDIRECT_URI = "http://localhost:3000/auth/discord/callback";
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  delete process.env.GOOGLE_OAUTH_ENABLED;
  sessionState = {};
  accountDocuments.clear();

  const originalFetch = global.fetch;
  const discordProfile = {
    id: "67890123456789012",
    username: "discord-user",
    global_name: "Discord User",
    email: "discord@example.com",
    verified: true,
  };
  global.fetch = async (input, options) => {
    const url = String(input);
    if (url === "https://discord.com/api/v10/oauth2/token") {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("redirect_uri"), process.env.DISCORD_OAUTH_REDIRECT_URI);
      return new Response(JSON.stringify({
        access_token: "test-discord-access-token",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://discord.com/api/v10/users/@me") {
      assert.ok(options.headers.Authorization.startsWith("Bearer "));
      return new Response(JSON.stringify(discordProfile), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, options);
  };

  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.use(createDiscordOAuthRouter({ client: {}, db: fakeDatabase }));
  app.get("/profile/complete", (_req, res) => res.status(200).send("complete-profile"));
  app.get("/dashboard/private", (_req, res) => res.status(200).send("dashboard"));
  app.get("/", (_req, res) => res.status(200).send("home"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    global.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => originalFetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      "X-Forwarded-For": "198.51.100.32",
      ...(options.method ? { Origin: baseUrl } : {}),
      ...(options.headers || {}),
    },
  });
  const startLogin = await request("/auth/discord", { redirect: "manual" });
  assert.equal(startLogin.status, 302);
  const authorizationUrl = new URL(startLogin.headers.get("location"));
  assert.equal(authorizationUrl.searchParams.get("scope"), "identify email guilds");
  const callback = await request(
    `/auth/discord/callback?state=${authorizationUrl.searchParams.get("state")}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/profile/complete");
  assert.equal(accountDocuments.size, 1);
  assert.equal(sessionState.account.email, "discord@example.com");
  assert.equal(sessionState.account.clanName, undefined);
  assert.equal(sessionState.user.id, discordProfile.id);
  assert.equal(sessionState.oauth.refreshToken, null);
  assert.equal((await request("/dashboard/private", { redirect: "manual" })).headers.get("location"), "/profile/complete");
  assert.equal((await request("/profile/complete")).status, 200);

  const profileUpdate = await request("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clanName: "Their Clan" }),
  });
  assert.equal(profileUpdate.status, 200);
  assert.equal((await request("/dashboard/private")).status, 200);
  assert.equal((await request("/auth/logout", { method: "POST" })).status, 204);

  const secondLogin = await request("/auth/discord", { redirect: "manual" });
  const secondAuthorizationUrl = new URL(secondLogin.headers.get("location"));
  const existingAccountLogin = await request(
    `/auth/discord/callback?state=${secondAuthorizationUrl.searchParams.get("state")}&code=test-code`,
    { redirect: "manual" }
  );
  assert.equal(existingAccountLogin.status, 302);
  assert.equal(existingAccountLogin.headers.get("location"), "/");
  assert.equal(accountDocuments.size, 1);
});

test("Clan War API validates saves, generates posters, and enforces owner isolation", async (t) => {
  const keys = ["WEB_SESSION_SECRET", "NODE_ENV", "DISCORD_OAUTH_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.WEB_SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.NODE_ENV = "test";
  delete process.env.DISCORD_OAUTH_REDIRECT_URI;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const ownerId = new ObjectId().toHexString();
  sessionState = {
    googleAuthenticated: true,
    emailVerified: true,
    account: { id: ownerId, email: "owner@example.com", clanName: "Test Clan" },
  };
  clanWarDocuments.clear();

  const express = require("express");
  const app = express();
  app.use(createDiscordOAuthRouter({ client: {}, db: fakeDatabase }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const players = Array.from({ length: 10 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    rank: 1000 + index,
    isLeader: index === 0 || index === 1,
    team: index % 2 === 0 ? "A" : "B",
  }));
  const headers = {
    "Content-Type": "application/json",
    Origin: baseUrl,
  };

  sessionState = {};
  const unauthorized = await fetch(`${baseUrl}/api/clan-wars`);
  assert.equal(unauthorized.status, 401);
  sessionState = {
    googleAuthenticated: true,
    emailVerified: true,
    account: { id: ownerId, clanName: "Test Clan" },
  };

  const invalidSave = await fetch(`${baseUrl}/api/clan-wars`, {
    method: "POST",
    headers,
    body: JSON.stringify({ players, time: "16:00", timezone: "UTC+2" }),
  });
  assert.equal(invalidSave.status, 400);

  const create = await fetch(`${baseUrl}/api/clan-wars`, {
    method: "POST",
    headers,
    body: JSON.stringify({ players, time: "16:00", timezone: "Europe/Berlin" }),
  });
  assert.equal(create.status, 201);
  const { war } = await create.json();
  assert.equal(war.teamATotal, 5020);
  assert.equal(war.teamBTotal, 5025);
  assert.equal(war.revision, 1);
  assert.equal(war.ownerUserId, undefined);

  const poster = await fetch(`${baseUrl}/api/clan-wars/${war.id}/poster.png`);
  assert.equal(poster.status, 200);
  assert.match(poster.headers.get("content-type"), /image\/png/);
  assert.equal(Buffer.from(await poster.arrayBuffer()).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  const update = await fetch(`${baseUrl}/api/clan-wars/${war.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ players, time: "18:30", timezone: "Africa/Cairo", teamATotal: 0 }),
  });
  assert.equal(update.status, 200);
  const updated = (await update.json()).war;
  assert.equal(updated.time, "18:30");
  assert.equal(updated.timezone, "Africa/Cairo");
  assert.equal(updated.teamATotal, 5020);
  assert.equal(updated.revision, 2);

  sessionState = {
    googleAuthenticated: true,
    emailVerified: true,
    account: { id: new ObjectId().toHexString(), clanName: "Other Clan" },
  };
  const otherOwner = await fetch(`${baseUrl}/api/clan-wars/${war.id}`);
  assert.equal(otherOwner.status, 404);
});

test.after(() => {
  if (originalDbModule) require.cache[dbPath] = originalDbModule;
  else delete require.cache[dbPath];
  if (originalSessionModule) require.cache[sessionModulePath] = originalSessionModule;
  else delete require.cache[sessionModulePath];
  if (originalMongoStoreModule) require.cache[mongoStoreModulePath] = originalMongoStoreModule;
  else delete require.cache[mongoStoreModulePath];
});

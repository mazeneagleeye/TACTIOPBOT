const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const { MongoClient, MongoNetworkTimeoutError } = require("mongodb");
const {
  connectToWebsiteDatabase,
  disconnectFromWebsiteDatabase,
  isMongoConnectivityError,
} = require("../webDb");
const {
  createDatabaseConnectionMonitor,
  startWebsiteOnlyServer,
} = require("../scripts/start-web-dev");

const quietLogger = {
  error() {},
  log() {},
  warn() {},
};

test("MongoDB connectivity errors are identified through wrapped causes", () => {
  const wrappedError = new Error("database operation failed", {
    cause: new MongoNetworkTimeoutError("temporary network timeout"),
  });
  assert.equal(isMongoConnectivityError(wrappedError), true);
  assert.equal(isMongoConnectivityError(new Error("invalid document")), false);
});

function setDatabaseEnvironment(t) {
  const keys = [
    "MONGODB_URI",
    "TACTIOPBOT_WEB_MONGODB_URI",
    "TACTIOPBOT_WEB_MONGODB_DB_NAME",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.MONGODB_URI = "mongodb://shared.example:27017/TACTIOPBOT";
  process.env.TACTIOPBOT_WEB_MONGODB_URI = "mongodb://override.example:27017/TACTIOPBOT";
  process.env.TACTIOPBOT_WEB_MONGODB_DB_NAME = "TACTIOPBOT";
  t.after(async () => {
    await disconnectFromWebsiteDatabase();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("website MongoDB connection retries after a transient connect failure", async (t) => {
  setDatabaseEnvironment(t);
  let connectAttempts = 0;
  t.mock.method(MongoClient.prototype, "connect", async function connect() {
    connectAttempts += 1;
    if (connectAttempts === 1) {
      throw new MongoNetworkTimeoutError("temporary network timeout");
    }
    return this;
  });
  t.mock.method(MongoClient.prototype, "db", (databaseName) => ({
    databaseName,
    command: async () => ({ ok: 1 }),
  }));
  t.mock.method(MongoClient.prototype, "close", async () => {});

  await assert.rejects(
    connectToWebsiteDatabase(),
    (error) => {
      assert.match(error.message, /MongoNetworkTimeoutError/);
      assert.equal(error.cause.name, "MongoNetworkTimeoutError");
      return true;
    }
  );

  const connection = await connectToWebsiteDatabase();
  assert.equal(connectAttempts, 2);
  assert.equal(connection.db.databaseName, "TACTIOPBOT");
  assert.equal(connection.connected, true);
});

test("website MongoDB connection replaces a cached client after a failed health ping", async (t) => {
  setDatabaseEnvironment(t);
  let connectAttempts = 0;
  const closeAttempts = [];
  t.mock.method(MongoClient.prototype, "connect", async function connect() {
    this.testClientId = ++connectAttempts;
    return this;
  });
  t.mock.method(MongoClient.prototype, "db", function db(databaseName) {
    let pingAttempts = 0;
    const clientId = this.testClientId;
    return {
      databaseName,
      command: async () => {
        pingAttempts += 1;
        if (clientId === 1 && pingAttempts > 1) {
          throw new MongoNetworkTimeoutError("temporary health-check timeout");
        }
        return { ok: 1 };
      },
    };
  });
  t.mock.method(MongoClient.prototype, "close", async function close() {
    closeAttempts.push(this.testClientId);
  });

  const first = await connectToWebsiteDatabase();
  const recovered = await connectToWebsiteDatabase();

  assert.equal(first.db.databaseName, "TACTIOPBOT");
  assert.equal(recovered.db.databaseName, "TACTIOPBOT");
  assert.equal(connectAttempts, 2);
  assert.deepEqual(closeAttempts, [1]);
});

test("database monitor retries automatically and restores the connection", async (t) => {
  let connectAttempts = 0;
  let resolveRouter;
  const routerCreated = new Promise((resolve) => {
    resolveRouter = resolve;
  });
  const connection = {
    db: { command: async () => ({ ok: 1 }) },
  };
  const monitor = createDatabaseConnectionMonitor({
    connect: async () => {
      connectAttempts += 1;
      if (connectAttempts === 1) throw new Error("temporary connection failure");
      return connection;
    },
    disconnect: async () => {},
    createRouter: () => {
      resolveRouter();
      return { ready: true };
    },
    retryIntervalMs: 5,
    logger: quietLogger,
  });
  t.after(() => monitor.stop());

  monitor.start();
  await Promise.race([
    routerCreated,
    new Promise((_, reject) => setTimeout(() => reject(new Error("recovery timed out")), 1000)),
  ]);

  assert.equal(connectAttempts, 2);
  assert.equal(monitor.getConnection(), connection);
  assert.deepEqual(monitor.getRouter(), { ready: true });
  await monitor.stop();
});

test("database monitor reconnects after an active connection fails its health check", async () => {
  let disconnectAttempts = 0;
  let healthChecks = 0;
  const recoveredConnection = {
    db: { command: async () => ({ ok: 1 }) },
  };
  const monitor = createDatabaseConnectionMonitor({
    connection: {
      db: {
        command: async () => {
          healthChecks += 1;
          throw new MongoNetworkTimeoutError("temporary health-check timeout");
        },
      },
    },
    connect: async () => recoveredConnection,
    disconnect: async () => {
      disconnectAttempts += 1;
    },
    createRouter: () => ({ ready: true }),
    logger: quietLogger,
  });

  await monitor.check();

  assert.equal(healthChecks, 1);
  assert.equal(disconnectAttempts, 1);
  assert.equal(monitor.getConnection(), recoveredConnection);
  assert.deepEqual(monitor.getRouter(), { ready: true });
  await monitor.stop();
});

test("website serves public pages and returns 503 for database routes when unavailable", async (t) => {
  const environmentKeys = [
    "NODE_ENV",
    "GOOGLE_OAUTH_ENABLED",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ];
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  let runningServer;
  t.after(async () => {
    if (runningServer) await runningServer.shutdown();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  runningServer = await startWebsiteOnlyServer(
    { port: 0, googleEnabled: false },
    {
      connect: async () => {
        throw new Error("temporary connection failure");
      },
      disconnect: async () => {},
      retryIntervalMs: 60_000,
      logger: quietLogger,
    }
  );
  if (!runningServer.server.listening) await once(runningServer.server, "listening");

  const port = runningServer.server.address().port;
  const publicResponse = await fetch(`http://127.0.0.1:${port}/`);
  const apiResponse = await fetch(`http://127.0.0.1:${port}/api/protected`);

  assert.equal(publicResponse.status, 200);
  assert.equal(apiResponse.status, 503);
  assert.deepEqual(await apiResponse.json(), {
    error: "Website database service is unavailable.",
  });
  await runningServer.shutdown();
  runningServer = null;
});

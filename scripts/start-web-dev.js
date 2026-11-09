const path = require("path");
const express = require("express");
const { connectToWebsiteDatabase, disconnectFromWebsiteDatabase } = require("../webDb");
const { createDiscordOAuthRouter } = require("../web/discordOAuth");

function getDevelopmentConfig(env = process.env) {
  const portValue = env.TACTIOBOT_DEV_PORT || "3000";
  const port = Number(portValue);

  const mongoUri = env.MONGODB_URI || env.TACTIOPBOT_WEB_MONGODB_URI;
  const databaseName = env.TACTIOPBOT_WEB_MONGODB_DB_NAME || "TACTIOPBOT";
  if (
    typeof mongoUri !== "string" ||
    mongoUri.trim() !== mongoUri ||
    (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://"))
  ) {
    throw new Error("Set MONGODB_URI or TACTIOPBOT_WEB_MONGODB_URI to the TACTIOPBOT MongoDB connection URI.");
  }
  if (databaseName !== "TACTIOPBOT") {
    throw new Error("TACTIOPBOT_WEB_MONGODB_DB_NAME must be TACTIOPBOT to match the Discord bot database.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("TACTIOBOT_DEV_PORT must be a valid local TCP port.");
  }
  if (typeof env.WEB_SESSION_SECRET !== "string" || env.WEB_SESSION_SECRET.length < 32) {
    throw new Error("WEB_SESSION_SECRET must contain at least 32 characters.");
  }

  const googleEnabled = env.TACTIOBOT_DEV_GOOGLE_OAUTH_ENABLED === "true";
  const googleRedirectUri =
    env.TACTIOBOT_DEV_GOOGLE_OAUTH_REDIRECT_URI || env.GOOGLE_OAUTH_REDIRECT_URI;
  const googleClientId =
    env.TACTIOBOT_DEV_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const googleClientSecret =
    env.TACTIOBOT_DEV_GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
  if (googleEnabled) {
    if (
      typeof googleClientId !== "string" ||
      googleClientId.trim() !== googleClientId ||
      !googleClientId ||
      typeof googleClientSecret !== "string" ||
      googleClientSecret.trim() !== googleClientSecret ||
      !googleClientSecret
    ) {
      throw new Error("Google OAuth requires TACTIOPBOT_DEV_GOOGLE_CLIENT_ID and TACTIOPBOT_DEV_GOOGLE_CLIENT_SECRET.");
    }

    let callback;
    try {
      callback = new URL(googleRedirectUri);
    } catch {
      throw new Error("Set TACTIOPBOT_DEV_GOOGLE_OAUTH_REDIRECT_URI to the exact local Google callback URI.");
    }
    if (
      callback.origin !== `http://localhost:${port}` ||
      callback.pathname !== "/auth/google/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password
    ) {
      throw new Error("The development Google callback must match this local server and /auth/google/callback.");
    }
  }

  return {
    port,
    mongoUriSource: env.MONGODB_URI ? "MONGODB_URI" : "TACTIOPBOT_WEB_MONGODB_URI",
    googleEnabled,
    googleRedirectUri,
    googleClientId: googleEnabled ? googleClientId : undefined,
    googleClientSecret: googleEnabled ? googleClientSecret : undefined,
  };
}

function createDatabaseConnectionMonitor({
  connection: initialConnection = null,
  connect = connectToWebsiteDatabase,
  disconnect = disconnectFromWebsiteDatabase,
  createRouter,
  retryIntervalMs = 15_000,
  logger = console,
}) {
  let connection = initialConnection;
  let databaseRouter = connection ? createRouter(connection) : null;
  let timer = null;
  let stopped = false;
  let checkPromise = null;
  let hasAttemptedConnection = Boolean(initialConnection);
  let hasEstablishedConnection = Boolean(initialConnection);

  async function check() {
    if (stopped || checkPromise) return checkPromise;
    let isInitialConnectionAttempt = false;
    checkPromise = (async () => {
      if (connection) {
        try {
          await connection.db.command({ ping: 1 });
          return;
        } catch (error) {
          logger.error(
            `[website-dev] Database health check failed (${error?.name || "Error"}); database routes are temporarily unavailable.`
          );
          connection = null;
          databaseRouter = null;
          try {
            await disconnect();
          } catch (disconnectError) {
            logger.error(`[website-dev] Database disconnect after a health failure failed (${disconnectError?.name || "Error"}).`);
          }
        }
      }

      try {
        isInitialConnectionAttempt = !hasAttemptedConnection;
        hasAttemptedConnection = true;
        const nextConnection = await connect();
        const nextRouter = createRouter(nextConnection);
        connection = nextConnection;
        databaseRouter = nextRouter;
        logger.log(
          hasEstablishedConnection
            ? "[website-dev] Database connection restored; account and dashboard features are available."
            : "[website-dev] Database connection established; account and dashboard features are available."
        );
        hasEstablishedConnection = true;
      } catch (error) {
        connection = null;
        databaseRouter = null;
        const message = isInitialConnectionAttempt
          ? "Database unavailable; account and dashboard features will return 503"
          : "Database reconnect failed";
        logger.error(`[website-dev] ${message} (${error?.message || "No details"}).`);
      }
    })();

    try {
      await checkPromise;
    } finally {
      checkPromise = null;
    }
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await check();
      } finally {
        schedule();
      }
    }, retryIntervalMs);
    if (timer.unref) timer.unref();
  }

  function start() {
    check().then(schedule, (error) => {
      logger.error(`[website-dev] Database check failed (${error?.name || "Error"}).`);
      schedule();
    });
  }

  async function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (checkPromise) await checkPromise;
    await disconnect();
  }

  return {
    check,
    start,
    stop,
    getConnection: () => connection,
    getRouter: () => databaseRouter,
  };
}

async function startWebsiteOnlyServer(config, dependencies = {}) {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_OAUTH_ENABLED = config.googleEnabled ? "true" : "false";
  if (config.googleEnabled) {
    process.env.GOOGLE_CLIENT_ID = config.googleClientId;
    process.env.GOOGLE_CLIENT_SECRET = config.googleClientSecret;
    process.env.GOOGLE_OAUTH_REDIRECT_URI = config.googleRedirectUri;
  } else {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }

  const connect = dependencies.connect || connectToWebsiteDatabase;
  const disconnect = dependencies.disconnect || disconnectFromWebsiteDatabase;
  const makeDatabaseRouter = dependencies.createRouter || ((databaseConnection) =>
    createDiscordOAuthRouter({
      ...databaseConnection,
      websiteOnly: true,
      googleRedirectUriOverride: config.googleEnabled ? config.googleRedirectUri : undefined,
    })
  );
  const logger = dependencies.logger || console;

  const databaseMonitor = createDatabaseConnectionMonitor({
    connection: null,
    connect,
    disconnect,
    createRouter: makeDatabaseRouter,
    retryIntervalMs: dependencies.retryIntervalMs,
    logger,
  });

  const app = express();
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.get("/clan-war-manager.html", (_req, res) => {
    res.redirect("/dashboard/clan-war-manager");
  });
  app.use("/media", express.static(path.resolve(__dirname, "..", "TACTIOPBOT_WEBSITE", "public")));
  app.use(express.static(path.resolve(__dirname, "..", "public")));
  app.use((req, res, next) => {
    const databaseRouter = databaseMonitor.getRouter();
    if (databaseRouter) return databaseRouter(req, res, next);
    const protectedPath =
      req.path.startsWith("/auth/") ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/dashboard/") ||
      req.path === "/profile/complete";
    if (!protectedPath) return next();
    res.set("Cache-Control", "no-store");
    return res.status(503).json({ error: "Website database service is unavailable." });
  });
  app.get("/", (req, res) => {
    res.sendFile(path.resolve(__dirname, "..", "public", "index.html"));
  });
  app.get("/profile/complete", (req, res) => {
    res.sendFile(path.resolve(__dirname, "..", "public", "profile.html"));
  });
  app.get("/dashboard/settings", (req, res) => {
    res.sendFile(path.resolve(__dirname, "..", "public", "settings.html"));
  });
  app.get("/dashboard/clan-war-manager", (req, res) => {
    res.sendFile(path.resolve(__dirname, "..", "public", "clan-war-manager.html"));
  });
  app.get(
    ["/dashboard/clan-war-manager/history", "/dashboard/clan-war-manager/:warId"],
    (req, res) => {
      res.sendFile(path.resolve(__dirname, "..", "public", "clan-war-manager.html"));
    }
  );
  app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  const server = app.listen(config.port, "127.0.0.1", () => {
    logger.log(`[website-dev] Local website listening on http://localhost:${server.address().port}`);
    logger.log(`[website-dev] Google sign-in ${config.googleEnabled ? "enabled" : "disabled"}.`);
    if (!databaseMonitor.getConnection()) {
      logger.warn("[website-dev] Public pages are available; database routes return 503 until MongoDB connects.");
    }
  });
  databaseMonitor.start();
  let shutdownPromise;

  function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await databaseMonitor.stop();
      logger.log(`[website-dev] Stopped after ${signal}.`);
    })();
    return shutdownPromise;
  }

  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      shutdown(signal).catch((error) => {
        logger.error(`[website-dev] Shutdown failed (${error?.name || "Error"}).`);
        process.exitCode = 1;
      });
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  return {
    server,
    shutdown: async (signal = "test") => {
      for (const [registeredSignal, handler] of signalHandlers) {
        process.removeListener(registeredSignal, handler);
      }
      return shutdown(signal);
    },
    databaseMonitor,
  };
}

if (require.main === module) {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
  try {
    const config = getDevelopmentConfig();
    console.log(`[website-dev] MongoDB configuration selected from ${config.mongoUriSource}.`);
    startWebsiteOnlyServer(config).catch((error) => {
      console.error(
        `[website-dev] Startup failed (${error?.name || "Error"}): ${error?.message || "No details"}`
      );
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`[website-dev] Configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  createDatabaseConnectionMonitor,
  getDevelopmentConfig,
  startWebsiteOnlyServer,
};

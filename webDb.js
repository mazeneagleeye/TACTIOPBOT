const { MongoClient } = require("mongodb");

const DEFAULT_DATABASE_NAME = "TACTIOPBOT";
const CONNECTIVITY_ERROR_NAMES = new Set([
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongoOperationTimeoutError",
  "MongoServerClosedError",
  "MongoTopologyClosedError",
]);
let mongoClient = null;
let mongoDatabase = null;
let connectPromise = null;

function isMongoConnectivityError(error) {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    if (CONNECTIVITY_ERROR_NAMES.has(current.name)) return true;
    seen.add(current);
  }
  return false;
}

function getWebsiteMongoUri() {
  return process.env.MONGODB_URI || process.env.TACTIOPBOT_WEB_MONGODB_URI;
}

function getWebsiteMongoDatabaseName() {
  return process.env.TACTIOPBOT_WEB_MONGODB_DB_NAME || DEFAULT_DATABASE_NAME;
}

async function connectToWebsiteDatabase(options = {}) {
  const uri = options.uri || getWebsiteMongoUri();
  const databaseName = options.databaseName || getWebsiteMongoDatabaseName();
  if (!uri) {
    throw new Error("MONGODB_URI or TACTIOPBOT_WEB_MONGODB_URI is not configured.");
  }

  if (!connectPromise) {
    connectPromise = (async () => {
      let client;
      try {
        if (mongoClient && mongoDatabase) {
          const currentClient = mongoClient;
          try {
            await mongoDatabase.command({ ping: 1 });
            return {
              configured: true,
              connected: true,
              client: currentClient,
              db: mongoDatabase,
              status: "connected",
            };
          } catch (error) {
            if (mongoClient === currentClient) {
              mongoClient = null;
              mongoDatabase = null;
            }
            try {
              await currentClient.close();
            } catch (closeError) {
              console.error(
                `[website-mongodb] Failed to close an unhealthy connection (${closeError?.name || "Error"}).`
              );
            }
          }
        }

        client = new MongoClient(uri, {
          maxPoolSize: 10,
          connectTimeoutMS: 30_000,
          serverSelectionTimeoutMS: 30_000,
          appName: "TACTIOPBOT-WEB",
        });
        await client.connect();
        const database = client.db(databaseName);
        await database.command({ ping: 1 });

        mongoClient = client;
        mongoDatabase = database;
        console.log(`[website-mongodb] Connected to ${databaseName}; ping succeeded.`);
        return {
          configured: true,
          connected: true,
          client: mongoClient,
          db: mongoDatabase,
          status: "connected",
        };
      } catch (error) {
        if (client) {
          try {
            await client.close();
          } catch (closeError) {
            console.error(`[website-mongodb] Failed to close an unsuccessful connection (${closeError?.name || "Error"}).`);
          }
        }
        const errorType = error?.name || "Error";
        throw new Error(
          `Website MongoDB connection or ping failed (${errorType}); verify Atlas network access and database-user permissions.`,
          { cause: error }
        );
      }
    })();
  }

  const pendingConnection = connectPromise;
  try {
    return await pendingConnection;
  } finally {
    if (connectPromise === pendingConnection) {
      connectPromise = null;
    }
  }
}

async function disconnectFromWebsiteDatabase() {
  if (connectPromise) {
    await connectPromise;
  }

  if (!mongoClient) {
    return;
  }

  const client = mongoClient;
  mongoClient = null;
  mongoDatabase = null;
  connectPromise = null;

  try {
    await client.close();
    console.log("[website-mongodb] Disconnected successfully.");
  } catch (error) {
    throw new Error(`Website MongoDB disconnect failed (${error?.name || "Error"}).`);
  }
}

function getWebsiteDb() {
  return mongoDatabase;
}

function isWebsiteDbConnected() {
  return Boolean(mongoClient && mongoDatabase);
}

function getWebsiteMongoStatus() {
  const uri = getWebsiteMongoUri();
  if (!uri) {
    return { configured: false, connected: false, status: "not_configured" };
  }

  return {
    configured: true,
    connected: isWebsiteDbConnected(),
    status: isWebsiteDbConnected() ? "connected" : "disconnected",
    database: mongoDatabase?.databaseName || getWebsiteMongoDatabaseName(),
  };
}

module.exports = {
  connectToWebsiteDatabase,
  disconnectFromWebsiteDatabase,
  getWebsiteDb,
  isWebsiteDbConnected,
  getWebsiteMongoStatus,
  isMongoConnectivityError,
  DEFAULT_DATABASE_NAME,
};
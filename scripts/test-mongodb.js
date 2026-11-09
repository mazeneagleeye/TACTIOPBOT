require("dotenv").config();

const { connectToDatabase, disconnectFromDatabase } = require("../db");
const { getAllGuildConfigs } = require("../utils/clanMissionNotifier");
const {
  connectToWebsiteDatabase,
  disconnectFromWebsiteDatabase,
} = require("../webDb");

async function main() {
  let exitCode = 0;

  try {
    const { db } = await connectToDatabase();
    await db.command({ ping: 1 });
    const { db: websiteDb } = await connectToWebsiteDatabase();
    await websiteDb.command({ ping: 1 });
    if (websiteDb.databaseName !== db.databaseName) {
      throw new Error("The website and Discord bot selected different MongoDB databases.");
    }

    const settingsCollection = db.collection("cm_notification_settings");
    await settingsCollection.createIndex({ _id: 1 });
    if (!(await settingsCollection.indexExists("_id_"))) {
      throw new Error("MongoDB did not confirm the unique guild-key index.");
    }

    const settings = await getAllGuildConfigs();
    console.log(
      `[mongodb] Bot and website pings succeeded for ${db.databaseName}; verified the guild-key index and ${settings.length} clan notification setting(s).`
    );
  } catch (error) {
    console.error(
      `[mongodb] Ping or migration verification failed (${error?.cause?.name || error?.name || "Error"}). Check MONGODB_URI, Atlas network access, and database-user permissions.`
    );
    exitCode = 1;
  }

  try {
    await disconnectFromWebsiteDatabase();
  } catch (error) {
    console.error(`[mongodb] Website disconnect failed (${error?.name || "Error"}).`);
    exitCode = 1;
  }

  try {
    await disconnectFromDatabase();
  } catch (error) {
    console.error(`[mongodb] Disconnect failed (${error?.name || "Error"}).`);
    exitCode = 1;
  }

  process.exitCode = exitCode;
}

main();

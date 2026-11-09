// index_no_ai.js
// NOTE: This file is a clean copy of index.js WITHOUT the AI texting/reply cycle.
// It is provided to keep the bot functional while missionDataActive fixes are deployed.

const { Client, GatewayIntentBits, Collection, ActivityType } = require("discord.js");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { connectToDatabase, disconnectFromDatabase, getMongoStatus } = require("./db");
require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

function loadCommandsFromFs() {
  const commandsDir = path.resolve(__dirname, "commands");
  let files = [];
  try {
    if (fs.existsSync(commandsDir)) {
      files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));
      for (const file of files) {
        const full = path.join(commandsDir, file);
        delete require.cache[require.resolve(full)];
        const command = require(full);
        if (command && command.data && command.data.name) {
          client.commands.set(command.data.name, command);
        }
      }
    }
  } catch (err) {
    console.error("Error while scanning commands:", err && err.message);
  }
}

loadCommandsFromFs();

// fallback command
if (client.commands.size === 0) {
  try {
    const { SlashCommandBuilder } = require("discord.js");
    client.commands.set(
      "ping",
      {
        data: new SlashCommandBuilder().setName("ping").setDescription("Check bot is alive"),
        async execute(interaction) {
          await interaction.reply({ content: "Pong!", ephemeral: true });
        },
      }
    );
  } catch (e) {
    console.warn("Could not register fallback command:", e);
  }
}

async function registerCommands() {
  try {
    if (!DISCORD_TOKEN || !process.env.CLIENT_ID) return;

    const commands = Array.from(client.commands.values()).map((cmd) => cmd.data?.toJSON()).filter(Boolean);
    if (!commands.length) return;

    const { REST, Routes } = require("discord.js");
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

registerCommands().catch((err) => console.error("registerCommands failed:", err));

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    client.user.setPresence({
      activities: [{
        name: "Tacticool",
        type: ActivityType.Playing,
      }],
      status: "online",
    });
  } catch (error) {
    console.warn("Failed to set bot presence:", error?.message || error);
  }
});

if (!DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in environment.");
  process.exit(1);
}

// interactions
client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== "function") return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error("Autocomplete error:", error);
      try { await interaction.respond([]); } catch {}
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "❌ Error executing command!", ephemeral: true });
      } else {
        await interaction.reply({ content: "❌ Error executing command!", ephemeral: true });
      }
    } catch {}
  }
});

client.login(DISCORD_TOKEN);

// Minimal express server (keeps existing endpoints optional; remove if undesired)
const app = express();
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌐 running on http://localhost:${PORT}`));

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", async (req, res) => {
  const mongo = getMongoStatus();
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: mongo.configured ? (mongo.connected ? "connected" : "disconnected") : "not_configured",
  });
});

app.get("/health/db", async (req, res) => {
  const mongo = getMongoStatus();
  const statusCode = mongo.connected ? 200 : 503;
  res.status(statusCode).json({
    status: mongo.connected ? "ok" : "unavailable",
    configured: mongo.configured,
    connected: mongo.connected,
    database: mongo.database || null,
  });
});

(async () => {
  try {
    const result = await connectToDatabase();
    if (result?.configured) {
      console.log(`[mongodb] ${result.connected ? "Connected to MongoDB Atlas successfully." : "MongoDB configured but connection failed."}`);
    } else {
      console.log("[mongodb] MONGODB_URI is not set; MongoDB integration is disabled.");
    }
  } catch (error) {
    console.error("[mongodb] Startup connection check failed.");
  }
})();

process.on("SIGINT", async () => {
  try {
    await disconnectFromDatabase();
    server.close(() => process.exit(0));
  } catch (error) {
    console.error("[shutdown] error during SIGINT cleanup:", error?.message || error);
    process.exit(1);
  }
});

process.on("SIGTERM", async () => {
  try {
    await disconnectFromDatabase();
    server.close(() => process.exit(0));
  } catch (error) {
    console.error("[shutdown] error during SIGTERM cleanup:", error?.message || error);
    process.exit(1);
  }
});

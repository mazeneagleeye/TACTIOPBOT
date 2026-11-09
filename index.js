// index.js
// NOTE: AI texting/reply cycle was removed. This file keeps only:
// - slash command handling
// - existing express endpoints used by the web dashboard
// - mission operator data fixes live in missionDataActive.js

fetch('https://api.ipify.org')
  .then(res => res.text())
  .then(ip => console.log('Outbound public IP:', ip))
  .catch(err => console.error('IP lookup failed:', err));

const { Client, GatewayIntentBits, Collection, ActivityType } = require("discord.js");
const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();
const { connectToDatabase, disconnectFromDatabase, getMongoStatus } = require("./db");
const { createDiscordOAuthRouter } = require("./web/discordOAuth");

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
        if (command?.data?.name) client.commands.set(command.data.name, command);
      }
    }
  } catch (err) {
    console.error("Error while scanning commands:", err?.message || err);
  }
}

loadCommandsFromFs();

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

    const commands = Array.from(client.commands.values())
      .map((cmd) => cmd.data?.toJSON())
      .filter(Boolean);

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
    console.error("Failed to register commands:", err?.message || err);
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
  try {
    loadCommandsFromFs();
    console.log("clientReady: loaded commands:", Array.from(client.commands.keys()));
  } catch (err) {
    console.warn("clientReady: failed to re-load commands:", err?.message || err);
  }

  try {
    const { startScheduler } = require("./utils/clanMissionScheduler");
    startScheduler(client);
  } catch (err) {
    console.error("Failed to start clan mission scheduler:", err?.message || err);
  }
  try {
    const { startSeasonalAvatarScheduler } = require("./utils/seasonalAvatar");
    startSeasonalAvatarScheduler(client);
  } catch (err) {
    console.error("Failed to start seasonal avatar scheduler:", err?.message || err);
  }
});

if (!DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in environment.");
  process.exit(1);
}

// === Express Web Server Setup ===
const app = express();
const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const HEARTBEAT_INTERVAL_MS = 30_000;
let discordWebRouter = null;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const heartbeatInterval = setInterval(() => {
  const status = client.isReady() ? `online as ${client.user.tag}` : "connecting";
  console.log(`[heartbeat] Bot ${status} | uptime ${Math.floor(process.uptime())}s`);
}, HEARTBEAT_INTERVAL_MS);

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
app.use("/media", express.static(path.join(__dirname, "TACTIOPBOT_WEBSITE", "public")));
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res, next) => {
  const protectedPath =
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/api/") ||
    req.path.startsWith("/dashboard/") ||
    req.path === "/profile/complete";
  if (!protectedPath) return next();
  if (!discordWebRouter) {
    return res.status(503).json({ error: "The website database service is unavailable." });
  }
  return discordWebRouter(req, res, next);
});

app.get("/profile/complete", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

app.get("/dashboard/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settings.html"));
});

app.get("/dashboard/clan-war-manager", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "clan-war-manager.html"));
});

app.get(
  ["/dashboard/clan-war-manager/history", "/dashboard/clan-war-manager/:warId"],
  (req, res) => {
    res.sendFile(path.join(__dirname, "public", "clan-war-manager.html"));
  }
);

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 running on http://0.0.0.0:${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error(`❌ HTTP server error: ${error.message}`);
  }
  process.exit(1);
});
let shutdownPromise = null;

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    let failed = false;
    clearInterval(heartbeatInterval);

    try {
      require("./utils/clanMissionScheduler").stopScheduler();
    } catch (error) {
      console.error(`[shutdown] Scheduler cleanup failed (${error?.name || "Error"}).`);
      failed = true;
    }

    try {
      require("./utils/seasonalAvatar").stopSeasonalAvatarScheduler();
    } catch (error) {
      console.error(`[shutdown] Seasonal avatar scheduler cleanup failed (${error?.name || "Error"}).`);
      failed = true;
    }

    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      console.error(`[shutdown] HTTP server cleanup failed (${error?.name || "Error"}).`);
      failed = true;
    }

    try {
      await client.destroy();
    } catch (error) {
      console.error(`[shutdown] Discord client cleanup failed (${error?.name || "Error"}).`);
      failed = true;
    }

    try {
      await disconnectFromDatabase();
    } catch (error) {
      console.error(`[shutdown] MongoDB cleanup failed (${error?.name || "Error"}).`);
      failed = true;
    }

    console.log(`[shutdown] Cleanup finished after ${signal}.`);
    if (failed) process.exitCode = 1;
  })();

  return shutdownPromise;
}

(async () => {
  try {
    const result = await connectToDatabase();
    discordWebRouter = createDiscordOAuthRouter({ ...result, discordClient: client });
    console.log("[mongodb] Website database routes are ready.");
  } catch (error) {
    const reason = process.env.MONGODB_URI
      ? `Startup connection check failed (${error?.name || "Error"}).`
      : "Startup connection check failed: MONGODB_URI is not configured.";
    console.error(`[mongodb] ${reason}`);
  }
})();

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command || typeof command.autocomplete !== "function") return;
      await command.autocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

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

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error(`[shutdown] SIGINT cleanup failed (${error?.name || "Error"}).`);
    process.exitCode = 1;
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error(`[shutdown] SIGTERM cleanup failed (${error?.name || "Error"}).`);
    process.exitCode = 1;
  });
});

// Register commands from both local commands folder and moved TACTIAPI folder (if present)
try {
  const extraDir = path.resolve(__dirname, '..', '..', 'TACTIAPI');
  if (fs.existsSync(extraDir)) {
    const extraFiles = fs.readdirSync(extraDir).filter((f) => f.endsWith('.js'));
    for (const file of extraFiles) {
      const full = path.join(extraDir, file);
      delete require.cache[require.resolve(full)];
      const cmd = require(full);
      if (cmd?.data?.name) client.commands.set(cmd.data.name, cmd);
    }
  }
} catch (e) {
  console.warn('Extra command folder (TACTIAPI) not loaded:', e?.message || e);
}

client.login(DISCORD_TOKEN);

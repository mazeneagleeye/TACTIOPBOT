const express = require("express");
const { ObjectId } = require("mongodb");
const path = require("path");
const clanMissionCommand = require("../commands/clanmission");
const missionsCommand = require("../commands/missions");
const { missionData } = require("../missionDataActive");
const { languages, normalizeLanguage, translateMission, translateOperator, translateUi } = require("../translations");
const { buildGameChatMessages } = require("../utils/gameChatMode");
const { formatResetDate, getNextReset, getTimeRemaining } = require("../utils/clanMissionNotifier");
const { isMongoConnectivityError } = require("../webDb");
const generateMissionImage = require("../image/generateMissionImage");

const CHAT_MESSAGE_LIMIT = 500;
const CHAT_HISTORY_LIMIT = 100;
const NOTIFICATION_LIMIT = 50;
const COMMANDS = [
  { name: "help", description: "Show the web chat commands." },
  { name: "ping", description: "Check that TACTIOPBOT is responding." },
  { name: "clanmission", description: "Get the best operator placement for your clan missions." },
  { name: "missions", description: "Optimize operator placement across selected missions." },
  { name: "nextreset", description: "Show the next Clan Mission reset." },
  { name: "setcmnotif", description: "Enable your web Clan Mission reset notifications." },
  { name: "editcmnotif", description: "Edit your web Clan Mission notification settings." },
  { name: "deletecmnotif", description: "Disable your web Clan Mission notifications." },
  { name: "reminderstatus", description: "Show your web Clan Mission notification settings." },
];
const VALID_MISSIONS = new Set(
  Object.keys(missionData).concat(["Skip", "B.S.S", "Basic Mission", "Common Only", "Rare Only", "Uncommon Only"])
);
const VALID_MODES = new Set(["default", "smart_balance", "gamechat"]);
const VALID_LANGUAGES = new Set(languages.map(({ value }) => value));

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseCommandLine(input) {
  const tokens = [];
  const pattern = /\S+="(?:[^"\\]|\\.)*"|\S+='(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;
  function unquote(value) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1).replace(/\\(["'\\])/g, "$1");
    }
    return value;
  }
  let match;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[0]);
  }
  const first = tokens.shift() || "";
  const name = first.replace(/^\/+/, "").toLowerCase();
  const options = {};
  const positional = [];
  for (const token of tokens) {
    const equalsAt = token.indexOf("=");
    if (equalsAt > 0) {
      options[token.slice(0, equalsAt).toLowerCase()] = unquote(token.slice(equalsAt + 1));
    } else {
      positional.push(unquote(token));
    }
  }
  return { name, options, positional };
}

function getClanMissionText({ language, missions, placementMode }) {
  const smartResults = placementMode === "smart_balance"
    ? clanMissionCommand._internal.assignSmartBalanceOperators(missions)
    : null;
  const results = smartResults || clanMissionCommand._internal.assignBestOperators(missions);
  let reply = `**🎯 ${translateUi("title", language)}**\n\n`;
  missions.forEach((mission, index) => {
    const skipped = !mission || mission.toLowerCase() === "skip";
    const missionLabel = skipped
      ? `(${translateUi("skipped", language)})`
      : translateMission(mission, language);
    const header = `**M${index + 1} - ${missionLabel}**`;
    if (skipped) {
      reply += `${header}\n\n`;
      return;
    }

    const operators = smartResults
      ? smartResults[index] || []
      : results[mission] || [];
    if (!operators.length) {
      reply += `${header}\n- ${translateUi("noOperators", language)}\n\n`;
      return;
    }
    reply += `${header}\n- ${operators.map(({ op }) => translateOperator(op, language)).join(" , ")}\n\n`;
  });

  if (placementMode === "gamechat") {
    const placements = missions.map((mission, index) => {
      if (!mission || mission.toLowerCase() === "skip") return { mission: null, operators: [] };
      const operators = smartResults
        ? smartResults[index] || []
        : results[mission] || [];
      return {
        mission: translateMission(mission, language),
        operators: operators.map(({ op }) => translateOperator(op, language)),
      };
    });
    const gameMessages = buildGameChatMessages(placements);
    if (gameMessages.length) {
      reply += `\nIN-GAME CHAT FORMAT\n${gameMessages.join("\n")}`;
    }
  }
  return reply.trim();
}

function getClanMissionImageMissions(missions, language, placementMode) {
  const smartResults = placementMode === "smart_balance"
    ? clanMissionCommand._internal.assignSmartBalanceOperators(missions)
    : null;
  const results = smartResults || clanMissionCommand._internal.assignBestOperators(missions);
  return missions.map((mission, index) => {
    if (!mission || mission.toLowerCase() === "skip") {
      return {
        name: translateMission("Skip", language),
        originalName: "Skip",
        skippedLabel: translateUi("skipped", language).toUpperCase(),
        operators: [],
      };
    }

    const operators = smartResults ? smartResults[index] || [] : results[mission] || [];
    return {
      name: translateMission(mission, language),
      originalName: mission,
      noOperatorsLabel: translateUi("noOperators", language),
      operators: operators.map(({ op, value }) => ({
        name: op,
        originalName: op,
        displayName: translateOperator(op, language),
        value,
      })),
    };
  });
}

function getOptimizedMissionImageMissions(missions) {
  const selectedMissions = validateMissions(missions);
  const assignments = missionsCommand.optimizeMissionPlacement(selectedMissions);
  let selectedIndex = 0;
  return missions.map((mission) => {
    if (!mission || mission.toLowerCase() === "skip") {
      return {
        name: "Skip",
        originalName: "Skip",
        skippedLabel: "SKIPPED",
        operators: [],
      };
    }

    const operators = assignments[selectedIndex++] || [];
    return {
      name: mission,
      originalName: mission,
      noOperatorsLabel: "No Operators",
      operators: operators.map((name) => ({
        name,
        originalName: name,
        displayName: name,
        value: missionData[mission]?.[name] || 0,
      })),
    };
  });
}

function getMissionList(options) {
  const missions = [];
  for (let index = 1; index <= 8; index += 1) {
    missions.push(options[`m${index}`] || "Skip");
  }
  return missions;
}

function validateMissions(missions) {
  const chosen = missions.filter((mission) => mission && mission.toLowerCase() !== "skip");
  if (!chosen.length) throw httpError(400, "Choose at least one mission using m1=... (for example: /clanmission language=en m1=Breach).");
  for (const mission of chosen) {
    if (!VALID_MISSIONS.has(mission)) {
      throw httpError(400, `Unknown mission "${mission}". Use /help to see command usage.`);
    }
  }
  return chosen;
}

async function executeChatCommand(line, { db, account }) {
  const { name, options, positional } = parseCommandLine(line);
  if (!name) throw httpError(400, "Enter a command, or type /help.");

  if (name === "help") {
    return `TACTIOPBOT WEB COMMANDS\n\n${COMMANDS.map(({ name: command, description }) => `/${command} — ${description}`).join("\n")}\n\nExamples:\n/clanmission language=en m1=Breach m2=Recon mode=default\n/clanmission language=en m1=\"Basic Mission\" mode=gamechat\n/missions m1=Breach m2=Recon\n/setcmnotif language=en`;
  }
  if (name === "ping") return "TACTIOPBOT is online. Pong!";
  if (name === "nextreset") {
    const reset = getNextReset();
    return `⏰ NEXT CLAN MISSION RESET\n${getTimeRemaining(reset)}\n${formatResetDate(reset)}`;
  }
  if (name === "clanmission") {
    const language = normalizeLanguage(options.language || "en");
    if (options.language && !VALID_LANGUAGES.has(options.language)) {
      throw httpError(400, "Unknown language. Use an existing language code such as en, ar, or ru.");
    }
    const placementMode = options.mode || "default";
    if (!VALID_MODES.has(placementMode)) {
      throw httpError(400, "Mode must be default, smart_balance, or gamechat.");
    }
    const missions = getMissionList(options);
    validateMissions(missions);
    return getClanMissionText({ language, missions, placementMode });
  }
  if (name === "missions") {
    const missions = getMissionList(options);
    const selected = validateMissions(missions);
    const assignments = missionsCommand.optimizeMissionPlacement(selected);
    return `🎯 OPTIMIZED MISSION PLACEMENT\n\n${selected.map((mission, index) =>
      `M${index + 1} - ${mission}\n${(assignments[index] || []).join(" , ") || "(no operators)"}`
    ).join("\n\n")}`;
  }
  if (name === "setcmnotif" || name === "editcmnotif") {
    const current = await db.collection("web_cm_notification_settings").findOne({ accountId: account.id });
    if (name === "editcmnotif" && !current) {
      throw httpError(400, "No web reminder exists yet. Use /setcmnotif first.");
    }
    const language = options.language || current?.language || "en";
    if (!VALID_LANGUAGES.has(language)) throw httpError(400, "Unknown language code.");
    let enabled = name === "setcmnotif" ? true : current.enabled;
    if (options.enabled !== undefined) {
      if (!["true", "false"].includes(options.enabled.toLowerCase())) {
        throw httpError(400, "enabled must be true or false.");
      }
      enabled = options.enabled.toLowerCase() === "true";
    }
    await db.collection("web_cm_notification_settings").updateOne(
      { accountId: account.id },
      {
        $set: {
          accountId: account.id,
          clanName: account.clanName,
          enabled,
          language,
          updatedAt: new Date(),
        },
        $setOnInsert: { nextReset: getNextReset().toISOString(), createdAt: new Date() },
      },
      { upsert: true }
    );
    return `✅ WEB CLAN MISSION NOTIFICATIONS\nStatus: ${enabled ? "On" : "Off"}\nLanguage: ${language}\nYou will see reset notifications in this web chat.`;
  }
  if (name === "deletecmnotif") {
    await db.collection("web_cm_notification_settings").deleteOne({ accountId: account.id });
    return "✅ Your web Clan Mission notifications are turned off.";
  }
  if (name === "reminderstatus") {
    const setting = await db.collection("web_cm_notification_settings").findOne({ accountId: account.id });
    if (!setting) return "Clan Mission web notifications are off. Use /setcmnotif to turn them on.";
    return `CLAN MISSION WEB NOTIFICATION STATUS\nStatus: ${setting.enabled ? "On" : "Off"}\nLanguage: ${setting.language || "en"}\nNext reset: ${formatResetDate(new Date(setting.nextReset || getNextReset()))}`;
  }

  const commandName = name ? `/${name}` : positional[0];
  throw httpError(400, `Unknown command ${commandName}. Type /help to see available commands.`);
}

function createWebBotChatRouter({ db, publicDirectory, generateImage = generateMissionImage }) {
  const router = express.Router();
  const messageRateLimit = new Map();
  let indexesPromise = null;

  function ensureIndexes() {
    if (!indexesPromise) {
      indexesPromise = Promise.all([
        db.collection("web_chat_messages").createIndex({ clanName: 1, createdAt: -1 }, { name: "web_chat_clan_created" }),
        db.collection("web_notifications").createIndex({ accountId: 1, createdAt: -1 }, { name: "web_notifications_account_created" }),
        db.collection("web_notifications").createIndex({ accountId: 1, dedupeKey: 1 }, { unique: true, name: "web_notifications_account_dedupe" }),
        db.collection("web_cm_notification_settings").createIndex({ accountId: 1 }, { unique: true, name: "web_cm_notifications_account" }),
      ]).catch((error) => {
        indexesPromise = null;
        throw error;
      });
    }
    return indexesPromise;
  }

  function getAccount(req) {
    const session = req.session;
    if (
      !session?.account?.id ||
      session.emailVerified !== true ||
      (session.authenticated !== true && session.googleAuthenticated !== true)
    ) {
      return null;
    }
    if (typeof session.account.clanName !== "string" || !session.account.clanName.trim()) return null;
    return {
      id: String(session.account.id),
      name: String(session.account.displayName || session.account.fullName || "Operator").slice(0, 100),
      clanName: session.account.clanName.trim().slice(0, 40),
    };
  }

  function requireAccount(req, res, next) {
    if (
      !req.path.startsWith("/api/bot-chat") &&
      req.path !== "/dashboard/bot-chat"
    ) return next();
    const account = getAccount(req);
    if (!account) {
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in to your TACTIOPBOT website account to use clan chat." });
      return res.redirect("/?auth_error=sign_in_required");
    }
    req.chatAccount = account;
    next();
  }

  function requireSameOrigin(req, res, next) {
    let requestOrigin;
    try {
      requestOrigin = new URL(`${req.protocol}://${req.get("host")}`).origin;
    } catch {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    if (req.get("origin") !== requestOrigin) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    next();
  }

  function checkMessageRate(accountId) {
    const now = Date.now();
    const recent = (messageRateLimit.get(accountId) || []).filter((time) => now - time < 60_000);
    if (recent.length >= 20) throw httpError(429, "Chat rate limit reached. Wait a minute before sending more messages.");
    recent.push(now);
    messageRateLimit.set(accountId, recent);
  }

  async function notifyClanMembers(account, message, dedupeKey) {
    const recipients = await db.collection("web_accounts")
      .find({ clanName: account.clanName, _id: { $ne: ObjectId.isValid(account.id) ? new ObjectId(account.id) : account.id } })
      .project({ _id: 1 })
      .limit(500)
      .toArray();
    if (!recipients.length) return;
    const now = new Date();
    await db.collection("web_notifications").bulkWrite(recipients.map(({ _id }) => {
      const recipientId = String(_id);
      return {
        updateOne: {
          filter: { accountId: recipientId, dedupeKey },
          update: {
            $setOnInsert: {
              accountId: recipientId,
              clanName: account.clanName,
              type: "chat",
              title: message.displayName,
              body: message.content.slice(0, 240),
              messageId: String(message._id),
              createdAt: now,
              readAt: null,
            },
          },
          upsert: true,
        },
      };
    }), { ordered: false });
  }

  async function ensureDueMissionNotification(account) {
    const settings = await db.collection("web_cm_notification_settings").findOne({
      accountId: account.id,
      enabled: true,
    });
    if (!settings?.nextReset) return;
    const dueAt = new Date(settings.nextReset);
    if (!Number.isFinite(dueAt.getTime()) || dueAt > new Date()) return;

    const dedupeKey = `clanmission-reset:${account.id}:${dueAt.toISOString()}`;
    await db.collection("web_notifications").updateOne(
      { accountId: account.id, dedupeKey },
      {
        $setOnInsert: {
          accountId: account.id,
          clanName: account.clanName,
          type: "clanmission",
          title: "Clan Missions Reset",
          body: "A new Clan Mission cycle is ready.",
          createdAt: new Date(),
          readAt: null,
        },
      },
      { upsert: true }
    );
    await db.collection("web_cm_notification_settings").updateOne(
      { accountId: account.id, nextReset: settings.nextReset },
      { $set: { nextReset: getNextReset().toISOString(), updatedAt: new Date() } }
    );
  }

  router.use("/api", express.json({ limit: "8kb" }));
  router.use(requireAccount);
  router.get("/dashboard/bot-chat", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "bot-chat.html"));
  });
  router.get("/api/bot-chat/commands", (_req, res) => {
    res.json({ commands: COMMANDS, languages, missions: Array.from(VALID_MISSIONS).sort() });
  });
  router.get("/api/bot-chat/messages/:messageId/image", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.messageId)) {
        return res.status(404).json({ error: "Message image not found." });
      }
      const message = await db.collection("web_chat_messages").findOne({
        _id: new ObjectId(req.params.messageId),
        clanName: req.chatAccount.clanName,
        type: "bot",
      });
      if (!message?.image) return res.status(404).json({ error: "Message image not found." });

      const image = Buffer.isBuffer(message.image)
        ? message.image
        : typeof message.image.value === "function"
          ? Buffer.from(message.image.value(true))
          : Buffer.from(message.image);
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
      });
      return res.send(image);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/api/bot-chat/state", async (req, res, next) => {
    try {
      await ensureIndexes();
      const account = req.chatAccount;
      await ensureDueMissionNotification(account);
      const [messages, notifications, unreadCount, settings] = await Promise.all([
        db.collection("web_chat_messages").find({ clanName: account.clanName })
          .project({ image: 0 })
          .sort({ createdAt: -1, _id: -1 }).limit(CHAT_HISTORY_LIMIT).toArray(),
        db.collection("web_notifications").find({ accountId: account.id })
          .sort({ createdAt: -1, _id: -1 }).limit(NOTIFICATION_LIMIT).toArray(),
        db.collection("web_notifications").countDocuments({ accountId: account.id, readAt: null }),
        db.collection("web_cm_notification_settings").findOne({ accountId: account.id }),
      ]);
      res.json({
        account: { name: account.name, clanName: account.clanName },
        messages: messages.reverse().map((message) => ({
          id: String(message._id),
          displayName: message.displayName,
          content: message.content,
          type: message.type,
          isOwn: message.accountId === account.id,
          ...(message.hasImage || message.image
            ? { imageUrl: `/api/bot-chat/messages/${message._id}/image` }
            : {}),
          createdAt: message.createdAt,
        })),
        notifications: notifications.map((notification) => ({
          id: String(notification._id),
          type: notification.type,
          title: notification.title,
          body: notification.body,
          createdAt: notification.createdAt,
          read: Boolean(notification.readAt),
        })),
        unreadCount,
        settings: { clanMissionNotifications: Boolean(settings?.enabled), language: settings?.language || "en" },
        nextReset: getNextReset().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });
  router.put("/api/bot-chat/settings", requireSameOrigin, async (req, res, next) => {
    try {
      await ensureIndexes();
      const enabled = req.body?.clanMissionNotifications;
      const language = req.body?.language;
      if (typeof enabled !== "boolean") throw httpError(400, "clanMissionNotifications must be true or false.");
      if (language !== undefined && !VALID_LANGUAGES.has(language)) throw httpError(400, "Choose a supported notification language.");
      const account = req.chatAccount;
      await db.collection("web_cm_notification_settings").updateOne(
        { accountId: account.id },
        {
          $set: {
            accountId: account.id,
            clanName: account.clanName,
            enabled,
            language: language || "en",
            updatedAt: new Date(),
          },
          $setOnInsert: { nextReset: getNextReset().toISOString(), createdAt: new Date() },
        },
        { upsert: true }
      );
      res.json({ settings: { clanMissionNotifications: enabled, language: language || "en" } });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/bot-chat/notifications/read", requireSameOrigin, async (req, res, next) => {
    try {
      await ensureIndexes();
      const result = await db.collection("web_notifications").updateMany(
        { accountId: req.chatAccount.id, readAt: null },
        { $set: { readAt: new Date() } }
      );
      res.json({ markedRead: result.modifiedCount });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/bot-chat/messages", requireSameOrigin, async (req, res, next) => {
    try {
      await ensureIndexes();
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      if (!content || content.length > CHAT_MESSAGE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) {
        throw httpError(400, `Enter a message from 1 to ${CHAT_MESSAGE_LIMIT} characters.`);
      }
      const account = req.chatAccount;
      checkMessageRate(account.id);
      const createdAt = new Date();
      const userMessage = {
        _id: new ObjectId(),
        accountId: account.id,
        clanName: account.clanName,
        displayName: account.name,
        content,
        type: content.startsWith("/") ? "command" : "chat",
        createdAt,
      };
      await db.collection("web_chat_messages").insertOne(userMessage);
      await notifyClanMembers(account, userMessage, `chat:${userMessage._id}`);
      let botMessage = null;
      if (content.startsWith("/")) {
        let response;
        const command = parseCommandLine(content);
        try {
          response = await executeChatCommand(content, { db, account });
        } catch (error) {
          if (isMongoConnectivityError(error)) throw error;
          response = `❌ ${error.status ? error.message : "The command could not be completed. Try again."}`;
        }
        let image = null;
        if (["clanmission", "missions"].includes(command.name) && !response.startsWith("❌")) {
          const language = normalizeLanguage(command.options.language || "en");
          const placementMode = command.options.mode || "default";
          const missions = getMissionList(command.options);
          const imageMissions = command.name === "clanmission"
            ? getClanMissionImageMissions(missions, language, placementMode)
            : getOptimizedMissionImageMissions(missions);
          image = await generateImage(imageMissions);
          if (!Buffer.isBuffer(image) || image.length === 0) {
            throw new Error("Clan Mission image generation returned an invalid image.");
          }
        }
        botMessage = {
          _id: new ObjectId(),
          accountId: null,
          clanName: account.clanName,
          displayName: "TACTIOPBOT",
          content: String(response).slice(0, 5000),
          ...(image ? { image } : {}),
          ...(image ? { hasImage: true } : {}),
          type: "bot",
          createdAt: new Date(),
        };
        await db.collection("web_chat_messages").insertOne(botMessage);
        await notifyClanMembers(account, botMessage, `chat:${botMessage._id}`);
      }
      res.status(201).json({
        messages: [userMessage, ...(botMessage ? [botMessage] : [])].map((message) => ({
          id: String(message._id),
          displayName: message.displayName,
          content: message.content,
          type: message.type,
          isOwn: message.accountId === account.id,
          ...(message.hasImage || message.image
            ? { imageUrl: `/api/bot-chat/messages/${message._id}/image` }
            : {}),
          createdAt: message.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, _req, res, _next) => {
    const databaseUnavailable = isMongoConnectivityError(error);
    const status = databaseUnavailable ? 503 : Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(`[web-chat] Request failed (${error?.name || "Error"}).`);
    res.status(status).json({
      error: databaseUnavailable
        ? "Website database service is temporarily unavailable."
        : status < 500 ? error.message : "The chat service is temporarily unavailable.",
    });
  });

  return router;
}

module.exports = {
  CHAT_MESSAGE_LIMIT,
  COMMANDS,
  createWebBotChatRouter,
  executeChatCommand,
  getClanMissionImageMissions,
  getOptimizedMissionImageMissions,
  getClanMissionText,
  parseCommandLine,
};

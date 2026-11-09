const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const http = require("node:http");
const { MongoNetworkTimeoutError, ObjectId } = require("mongodb");
const {
  COMMANDS,
  createWebBotChatRouter,
  executeChatCommand,
  getClanMissionText,
  parseCommandLine,
} = require("../web/botChat");

function createMemoryDatabase() {
  const collections = new Map();
  function equal(left, right) {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    return left === right;
  }
  function matches(document, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === "object" && "$ne" in value) {
        return !equal(document[key], value.$ne);
      }
      return equal(document[key], value);
    });
  }
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, []);
      const documents = collections.get(name);
      return {
        async createIndex() {
          return "test-index";
        },
        async findOne(filter) {
          return documents.find((document) => matches(document, filter)) || null;
        },
        find(filter) {
          let selected = documents.filter((document) => matches(document, filter));
          const cursor = {
            sort() {
              selected = selected.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
              return cursor;
            },
            limit(count) {
              selected = selected.slice(0, count);
              return cursor;
            },
            async toArray() {
              return selected.slice();
            },
            project() {
              return cursor;
          },
          };
          return cursor;
        },
        async countDocuments(filter) {
          return documents.filter((document) => matches(document, filter)).length;
        },
        async updateOne(filter, update, options = {}) {
          let document = documents.find((item) => matches(item, filter));
          if (!document && options.upsert) {
            document = { ...filter, ...(update.$setOnInsert || {}) };
            documents.push(document);
          }
          if (document) Object.assign(document, update.$set || {});
          return { acknowledged: true, matchedCount: document ? 1 : 0, upsertedCount: document ? 1 : 0 };
        },
        async insertOne(document) {
          documents.push(document);
          return { insertedId: document._id };
        },
        async bulkWrite(operations) {
          for (const { updateOne } of operations) {
            const filter = updateOne.filter;
            const update = updateOne.update;
            const exists = documents.some((item) => matches(item, filter));
            if (!exists && updateOne.upsert) documents.push({ ...filter, ...update.$setOnInsert });
          }
          return { acknowledged: true };
        },
        async updateMany(filter, update) {
          let modifiedCount = 0;
          for (const document of documents) {
            if (matches(document, filter)) {
              Object.assign(document, update.$set);
              modifiedCount += 1;
            }
          }
          return { modifiedCount };
        },
        async deleteOne(filter) {
          const index = documents.findIndex((document) => matches(document, filter));
          if (index >= 0) documents.splice(index, 1);
          return { deletedCount: index >= 0 ? 1 : 0 };
        },
      };
    },
  };
}

test("web chat parses quoted mission names and key-value options", () => {
  assert.deepEqual(parseCommandLine('/clanmission language=en m1="Basic Mission" mode=gamechat'), {
    name: "clanmission",
    options: { language: "en", m1: "Basic Mission", mode: "gamechat" },
    positional: [],
  });
});

test("web command help lists every TACTIOPBOT command", async () => {
  const reply = await executeChatCommand("/help", {
    db: createMemoryDatabase(),
    account: { id: "operator-1", clanName: "HONOR" },
  });
  for (const { name } of COMMANDS) assert.match(reply, new RegExp(`/${name}\\b`));
  assert.match(reply, /language=en m1=Breach/);
});

test("clanmission supports default, smart balance, and in-game chat output", () => {
  for (const mode of ["default", "smart_balance", "gamechat"]) {
    const reply = getClanMissionText({
      language: "en",
      missions: ["Breach", "Recon", "Skip", "Skip", "Skip", "Skip", "Skip", "Skip"],
      placementMode: mode,
    });
    assert.match(reply, /M1 - Breach/);
    assert.match(reply, /M2 - Recon/);
    assert.match(reply, /M3 - \(skipped\)/i);
    if (mode === "gamechat") assert.match(reply, /IN-GAME CHAT FORMAT/);
  }
});

test("web Clan Mission reminders can be enabled, reported, edited, and deleted per website account", async () => {
  const db = createMemoryDatabase();
  const account = { id: "operator-1", clanName: "HONOR" };
  const enabled = await executeChatCommand("/setcmnotif language=en", { db, account });
  assert.match(enabled, /Status: On/);
  const status = await executeChatCommand("/reminderstatus", { db, account });
  assert.match(status, /Status: On/);
  const edited = await executeChatCommand("/editcmnotif enabled=false language=ar", { db, account });
  assert.match(edited, /Status: Off/);
  assert.match(await executeChatCommand("/reminderstatus", { db, account }), /Language: ar/);
  assert.match(await executeChatCommand("/deletecmnotif", { db, account }), /turned off/);
  assert.match(await executeChatCommand("/reminderstatus", { db, account }), /notifications are off/);
});

test("web command rejects unknown commands and invalid mission input", async () => {
  const context = { db: createMemoryDatabase(), account: { id: "operator-1", clanName: "HONOR" } };
  await assert.rejects(executeChatCommand("/missing", context), /Unknown command/);
  await assert.rejects(executeChatCommand("/clanmission language=en", context), /Choose at least one mission/);
  await assert.rejects(executeChatCommand("/clanmission language=en m1=unknown", context), /Unknown mission/);
});

test("web chat requires a website account and shares commands only inside its clan", async (t) => {
  const db = createMemoryDatabase();
  const ownId = new ObjectId();
  const clanMateId = new ObjectId();
  const otherClanId = new ObjectId();
  await db.collection("web_accounts").insertOne({ _id: ownId, clanName: "HONOR" });
  await db.collection("web_accounts").insertOne({ _id: clanMateId, clanName: "HONOR" });
  await db.collection("web_accounts").insertOne({ _id: otherClanId, clanName: "OTHER" });

  const app = express();
  app.use((req, _res, next) => {
    if (req.get("x-test-account")) {
      req.session = {
        account: {
          id: req.get("x-test-account"),
          displayName: "Web Operator",
          clanName: req.get("x-test-account") === String(otherClanId) ? "OTHER" : "HONOR",
        },
        authenticated: true,
        emailVerified: true,
      };
    }
    next();
  });
  app.use(createWebBotChatRouter({ db, publicDirectory: require("node:path").resolve("public") }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const unauthorized = await fetch(`${baseUrl}/api/bot-chat/state`);
  assert.equal(unauthorized.status, 401);

  const headers = {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "X-Test-Account": String(ownId),
  };
  const posted = await fetch(`${baseUrl}/api/bot-chat/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "/nextreset" }),
  });
  assert.equal(posted.status, 201);
  const messages = (await posted.json()).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].displayName, "Web Operator");
  assert.equal(messages[1].displayName, "TACTIOPBOT");
  assert.match(messages[1].content, /NEXT CLAN MISSION RESET/);

  const stateResponse = await fetch(`${baseUrl}/api/bot-chat/state`, {
    headers: { "X-Test-Account": String(ownId) },
  });
  assert.equal(stateResponse.status, 200);
  const ownState = await stateResponse.json();
  assert.equal(ownState.messages.length, 2);
  assert.equal(ownState.account.clanName, "HONOR");

  const clanMateState = await fetch(`${baseUrl}/api/bot-chat/state`, {
    headers: { "X-Test-Account": String(clanMateId) },
  });
  assert.equal((await clanMateState.json()).messages.length, 2);

  const otherClanState = await fetch(`${baseUrl}/api/bot-chat/state`, {
    headers: { "X-Test-Account": String(otherClanId) },
  });
  assert.equal((await otherClanState.json()).messages.length, 0);

  const reminders = await fetch(`${baseUrl}/api/bot-chat/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "/setcmnotif language=en" }),
  });
  assert.equal(reminders.status, 201);
  const reminderState = await fetch(`${baseUrl}/api/bot-chat/state`, {
    headers: { "X-Test-Account": String(ownId) },
  });
  assert.equal((await reminderState.json()).settings.clanMissionNotifications, true);

  const settings = await fetch(`${baseUrl}/api/bot-chat/settings`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ clanMissionNotifications: true, language: "en" }),
  });
  assert.equal(settings.status, 200);
});

test("clanmission command posts its result text and generated image to the clan chat", async (t) => {
  const db = createMemoryDatabase();
  const ownId = new ObjectId();
  const otherClanId = new ObjectId();
  await db.collection("web_accounts").insertOne({ _id: ownId, clanName: "HONOR" });
  await db.collection("web_accounts").insertOne({ _id: otherClanId, clanName: "OTHER" });
  const generatedImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  let generatedMissions;

  const app = express();
  app.use((req, _res, next) => {
    const accountId = req.get("x-test-account");
    if (accountId) {
      req.session = {
        account: {
          id: accountId,
          displayName: "Web Operator",
          clanName: accountId === String(otherClanId) ? "OTHER" : "HONOR",
        },
        authenticated: true,
        emailVerified: true,
      };
    }
    next();
  });
  app.use(createWebBotChatRouter({
    db,
    generateImage: async (missions) => {
      generatedMissions = missions;
      return generatedImage;
    },
    publicDirectory: require("node:path").resolve("public"),
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    "Content-Type": "application/json",
    Origin: baseUrl,
    "X-Test-Account": String(ownId),
  };
  const posted = await fetch(`${baseUrl}/api/bot-chat/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "/clanmission language=en m1=Breach m2=Recon" }),
  });

  assert.equal(posted.status, 201);
  const botMessage = (await posted.json()).messages[1];
  assert.match(botMessage.content, /\*\*M1 - Breach\*\*/);
  assert.equal(generatedMissions.length, 8);
  assert.equal(generatedMissions[0].originalName, "Breach");
  assert.equal(generatedMissions[1].originalName, "Recon");
  assert.equal(generatedMissions[2].originalName, "Skip");
  assert.equal(typeof botMessage.imageUrl, "string");

  const imageResponse = await fetch(new URL(botMessage.imageUrl, baseUrl), {
    headers: { "X-Test-Account": String(ownId) },
  });
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get("content-type"), /image\/png/);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), generatedImage);

  const otherClanResponse = await fetch(new URL(botMessage.imageUrl, baseUrl), {
    headers: { "X-Test-Account": String(otherClanId) },
  });
  assert.equal(otherClanResponse.status, 404);

  const optimized = await fetch(`${baseUrl}/api/bot-chat/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: "/missions m1=Breach m2=Recon" }),
  });
  assert.equal(optimized.status, 201);
  const optimizedBotMessage = (await optimized.json()).messages[1];
  assert.match(optimizedBotMessage.content, /OPTIMIZED MISSION PLACEMENT/);
  assert.equal(generatedMissions.length, 8);
  assert.equal(generatedMissions[0].originalName, "Breach");
  assert.equal(generatedMissions[1].originalName, "Recon");
  assert.equal(typeof optimizedBotMessage.imageUrl, "string");
});

test("web chat returns 503 when MongoDB is temporarily unavailable", async (t) => {
  const unavailable = new MongoNetworkTimeoutError("temporary network timeout");
  const db = {
    collection() {
      return {
        async createIndex() {
          throw unavailable;
        },
      };
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    req.session = {
      account: { id: "operator-1", displayName: "Web Operator", clanName: "HONOR" },
      authenticated: true,
      emailVerified: true,
    };
    next();
  });
  app.use(createWebBotChatRouter({ db, publicDirectory: require("node:path").resolve("public") }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bot-chat/state`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Website database service is temporarily unavailable.",
  });
});

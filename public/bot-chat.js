const elements = {
  accountName: document.querySelector("#account-name"),
  roomName: document.querySelector("#room-name"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#message-form"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  status: document.querySelector("#chat-status"),
  characterCount: document.querySelector("#character-count"),
  reset: document.querySelector("#next-reset"),
  notificationsButton: document.querySelector("#notifications-button"),
  notificationCount: document.querySelector("#notification-count"),
  notificationsPanel: document.querySelector("#notifications-panel"),
  notificationsList: document.querySelector("#notifications-list"),
  markRead: document.querySelector("#mark-read-button"),
  settingsButton: document.querySelector("#notification-settings-button"),
  reminderToggle: document.querySelector("#mission-notifications"),
  language: document.querySelector("#notification-language"),
  settingsStatus: document.querySelector("#settings-status"),
  commandsButton: document.querySelector("#commands-button"),
  commandsPanel: document.querySelector("#commands-panel"),
  commandList: document.querySelector("#command-list"),
  logout: document.querySelector("#logout-button"),
};

const state = {
  messageIds: new Set(),
  missions: [],
  latestMessageId: null,
  requestInProgress: false,
  hasLoadedMessages: false,
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 || response.status === 302) {
    window.location.assign("/?auth_error=sign_in_required");
    throw new Error("Sign in to your website account to use clan chat.");
  }
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMissionImageCaption(canvas, message, image) {
  const maxWidth = 560;
  const imageScale = Math.min(1, maxWidth / image.naturalWidth);
  const displayWidth = Math.round(image.naturalWidth * imageScale);
  const displayHeight = Math.round(image.naturalHeight * imageScale);
  const caption = String(message.content).split("\n")
    .map((line) => line.replace(/\*\*/g, "").trim())
    .find(Boolean) || "Mission placement";
  const pixelRatio = window.devicePixelRatio || 1;
  const captionHeight = 42;

  canvas.width = displayWidth * pixelRatio;
  canvas.height = (displayHeight + captionHeight) * pixelRatio;
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight + captionHeight}px`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Mission placement: ${caption}`);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = "#061c37";
  context.fillRect(0, 0, displayWidth, displayHeight + captionHeight);
  context.fillStyle = "rgba(3, 10, 18, 0.92)";
  context.fillRect(0, 0, displayWidth, captionHeight);
  context.fillStyle = "#f3d45a";
  context.font = "600 15px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(14, 0, Math.max(0, displayWidth - 28), captionHeight);
  context.clip();
  context.fillText(caption, 14, captionHeight / 2, Math.max(0, displayWidth - 28));
  context.restore();
  context.drawImage(image, 0, captionHeight, displayWidth, displayHeight);
}

function appendMessage(message) {
  if (state.messageIds.has(message.id)) return;
  state.messageIds.add(message.id);
  const item = document.createElement("li");
  item.className = "message";
  if (message.isOwn) item.classList.add("message-own");
  if (message.type === "bot") item.classList.add("message-bot");
  if (message.type === "command") item.classList.add("message-command");

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = message.displayName || "Operator";
  const time = document.createElement("time");
  time.dateTime = new Date(message.createdAt).toISOString();
  time.textContent = formatTime(message.createdAt);
  meta.append(name, time);

  const content = document.createElement("p");
  content.className = "message-content";
  for (const [index, line] of String(message.content).split("\n").entries()) {
    if (index) content.append(document.createElement("br"));
    const heading = /^\*\*(.+)\*\*$/.exec(line);
    if (heading) {
      const strong = document.createElement("strong");
      strong.textContent = heading[1];
      content.append(strong);
      continue;
    }

    const segments = line.split(/(\*\*[^*]+\*\*)/g);
    for (const segment of segments) {
      if (segment.startsWith("**") && segment.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = segment.slice(2, -2);
        content.append(strong);
      } else {
        content.append(document.createTextNode(segment));
      }
    }
  }
  item.append(meta, content);
  if (message.imageUrl) {
    const image = document.createElement("img");
    image.className = "message-image message-image-loading";
    image.src = message.imageUrl;
    image.alt = "Mission operator placement";
    image.loading = "eager";
    image.addEventListener("load", () => {
      const canvas = document.createElement("canvas");
      canvas.className = "message-image";
      try {
        addMissionImageCaption(canvas, message, image);
        image.replaceWith(canvas);
      } catch (error) {
        console.error("[web-chat] Could not render mission image caption.", error);
        image.classList.remove("message-image-loading");
        const captionError = document.createElement("p");
        captionError.className = "message-image-error";
        captionError.textContent = "The mission image loaded, but its canvas caption could not be rendered.";
        image.insertAdjacentElement("afterend", captionError);
      }
    }, { once: true });
    image.addEventListener("error", () => {
      const error = document.createElement("p");
      error.className = "message-image-error";
      error.textContent = "Mission image could not be loaded. Refresh the chat to retry.";
      image.replaceWith(error);
    }, { once: true });
    item.append(image);
  }
  elements.messages.querySelector(".empty-state")?.remove();
  elements.messages.append(item);
  state.latestMessageId = message.id;
}

function renderNotifications(notifications, unreadCount) {
  elements.notificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  elements.notificationCount.classList.toggle("hidden", unreadCount < 1);
  elements.notificationsButton.setAttribute(
    "aria-label",
    unreadCount ? `Open notifications, ${unreadCount} unread` : "Open notifications"
  );
  elements.notificationsList.replaceChildren();
  if (!notifications.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No notifications yet.";
    elements.notificationsList.append(empty);
    return;
  }

  for (const notification of notifications) {
    const item = document.createElement("li");
    item.className = `notification-item${notification.read ? "" : " unread"}`;
    const title = document.createElement("strong");
    title.textContent = notification.title;
    const body = document.createElement("p");
    body.textContent = notification.body;
    const time = document.createElement("time");
    time.dateTime = new Date(notification.createdAt).toISOString();
    time.textContent = new Date(notification.createdAt).toLocaleString();
    item.append(title, body, time);
    elements.notificationsList.append(item);
  }
}

function formatReset(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Reset schedule unavailable."
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

async function loadState() {
  if (state.requestInProgress) return;
  state.requestInProgress = true;
  try {
    const data = await requestJson("/api/bot-chat/state");
    const wasNearBottom = elements.messages.scrollHeight - elements.messages.clientHeight - elements.messages.scrollTop < 80;
    elements.accountName.textContent = data.account.name;
    elements.roomName.textContent = `${data.account.clanName} Chat`;
    elements.reset.textContent = formatReset(data.nextReset);
    elements.reminderToggle.checked = data.settings.clanMissionNotifications;
    elements.language.value = data.settings.language || "en";
    for (const message of data.messages) {
      appendMessage({ ...message, isOwn: message.displayName === data.account.name && message.type !== "bot" });
    }
    if (!state.hasLoadedMessages || wasNearBottom) {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }
    state.hasLoadedMessages = true;
    renderNotifications(data.notifications, data.unreadCount);
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.requestInProgress = false;
  }
}

async function loadCommands() {
  try {
    const data = await requestJson("/api/bot-chat/commands");
    state.missions = data.missions;
    elements.commandList.replaceChildren();
    for (const command of data.commands) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "command-choice";
      button.type = "button";
      const name = document.createElement("strong");
      name.textContent = `/${command.name}`;
      const description = document.createElement("span");
      description.textContent = command.description;
      button.append(name, description);
      button.addEventListener("click", () => selectCommand(command.name, command.description));
      item.append(button);
      elements.commandList.append(item);
    }
  } catch (error) {
    elements.commandList.textContent = error.message;
  }
}

function addMissionSelector(commandName, description, missionNames) {
  elements.messages.querySelector(".command-prompt")?.remove();
  const prompt = document.createElement("li");
  prompt.className = "command-prompt";
  const heading = document.createElement("div");
  heading.className = "command-prompt-heading";
  const title = document.createElement("strong");
  title.textContent = `/${commandName}`;
  const summary = document.createElement("span");
  summary.textContent = description;
  heading.append(title, summary);

  const form = document.createElement("form");
  form.className = "mission-selector";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = Array.from(form.querySelectorAll("select"), (select) => select.value);
    if (selected.every((mission) => mission === "Skip")) {
      setStatus("Select at least one mission before continuing.");
      return;
    }

    const command = `/${commandName} language=en ${selected
      .map((mission, index) => `m${index + 1}="${mission}"`)
      .join(" ")}`;
    prompt.remove();
    sendMessage(command);
  });

  const fields = document.createElement("div");
  fields.className = "mission-selector-fields";
  for (let index = 0; index < 8; index += 1) {
    const label = document.createElement("label");
    label.textContent = `Mission ${index + 1}`;
    const select = document.createElement("select");
    select.name = `m${index + 1}`;
    select.setAttribute("aria-label", `Mission ${index + 1}`);
    for (const mission of ["Skip", ...missionNames]) {
      const option = document.createElement("option");
      option.value = mission;
      option.textContent = mission;
      select.append(option);
    }
    label.append(select);
    fields.append(label);
  }

  const actions = document.createElement("div");
  actions.className = "mission-selector-actions";
  const cancel = document.createElement("button");
  cancel.className = "subtle-button";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => prompt.remove());
  const done = document.createElement("button");
  done.className = "mission-done-button";
  done.type = "submit";
  done.textContent = "Done";
  actions.append(cancel, done);
  form.append(fields, actions);
  prompt.append(heading, form);
  elements.messages.append(prompt);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  elements.commandsPanel.classList.add("hidden");
  elements.commandsButton.setAttribute("aria-expanded", "false");
}

async function selectCommand(commandName, description) {
  if (commandName === "clanmission" || commandName === "missions") {
    addMissionSelector(commandName, description, state.missions);
    return;
  }
  sendMessage(`/${commandName}`);
}

async function sendMessage(content) {
  if (!content.trim()) return;
  elements.send.disabled = true;
  setStatus("Sending…");
  try {
    const data = await requestJson("/api/bot-chat/messages", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    for (const message of data.messages) {
      appendMessage({
        ...message,
        isOwn: message.displayName === elements.accountName.textContent && message.type !== "bot",
      });
    }
    elements.messages.scrollTop = elements.messages.scrollHeight;
    elements.input.value = "";
    elements.characterCount.textContent = "0/500";
    setStatus("");
    await loadState();
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.send.disabled = false;
    elements.input.focus();
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.input.value);
});

elements.input.addEventListener("input", () => {
  elements.characterCount.textContent = `${elements.input.value.length}/500`;
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

elements.notificationsButton.addEventListener("click", () => {
  const open = elements.notificationsPanel.classList.toggle("hidden") === false;
  elements.notificationsButton.setAttribute("aria-expanded", String(open));
});

elements.markRead.addEventListener("click", async () => {
  try {
    await requestJson("/api/bot-chat/notifications/read", { method: "POST", body: "{}" });
    await loadState();
  } catch (error) {
    setStatus(error.message);
  }
});

elements.commandsButton.addEventListener("click", () => {
  const open = elements.commandsPanel.classList.toggle("hidden") === false;
  elements.commandsButton.setAttribute("aria-expanded", String(open));
});

elements.settingsButton.addEventListener("click", () => {
  document.querySelector(".reminder-card").scrollIntoView({ behavior: "smooth", block: "center" });
  elements.reminderToggle.focus();
});

async function saveSettings() {
  elements.settingsStatus.textContent = "Saving…";
  try {
    await requestJson("/api/bot-chat/settings", {
      method: "PUT",
      body: JSON.stringify({
        clanMissionNotifications: elements.reminderToggle.checked,
        language: elements.language.value,
      }),
    });
    elements.settingsStatus.textContent = elements.reminderToggle.checked
      ? "Clan Mission reminders are on."
      : "Clan Mission reminders are off.";
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
}

elements.reminderToggle.addEventListener("change", saveSettings);
elements.language.addEventListener("change", saveSettings);

elements.logout.addEventListener("click", async () => {
  elements.logout.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST", body: "{}" });
    window.location.assign("/");
  } catch (error) {
    setStatus(error.message);
    elements.logout.disabled = false;
  }
});

loadCommands();
loadState();
window.setInterval(loadState, 5000);

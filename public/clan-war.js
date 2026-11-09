const TIMEZONE_LABELS = {
  "Europe/Berlin": "Central Europe (CET/CEST)",
  "Africa/Cairo": "Cairo — Egypt",
  "Europe/Istanbul": "Turkey (TRT)",
  "Etc/UTC": "UTC",
};

const elements = {
  accountStatus: document.querySelector("#account-status"),
  playersList: document.querySelector("#players-list"),
  playerCount: document.querySelector("#player-count"),
  leaderCount: document.querySelector("#leader-count"),
  duplicateWarning: document.querySelector("#duplicate-warning"),
  balanceButton: document.querySelector("#balance-button"),
  validationMessage: document.querySelector("#validation-message"),
  teamATotal: document.querySelector("#team-a-total"),
  teamBTotal: document.querySelector("#team-b-total"),
  balanceDifference: document.querySelector("#balance-difference"),
  teamAPlayers: document.querySelector("#team-a-players"),
  teamBPlayers: document.querySelector("#team-b-players"),
  warTime: document.querySelector("#war-time"),
  warTimezone: document.querySelector("#war-timezone"),
  saveWar: document.querySelector("#save-war"),
  generatePoster: document.querySelector("#generate-poster"),
  saveStatus: document.querySelector("#save-status"),
  posterSection: document.querySelector("#poster-section"),
  posterPreview: document.querySelector("#poster-preview"),
  downloadPoster: document.querySelector("#download-poster"),
  posterStatus: document.querySelector("#poster-status"),
  warText: document.querySelector("#war-text"),
  copyWarText: document.querySelector("#copy-war-text"),
  copyStatus: document.querySelector("#copy-status"),
  warHistory: document.querySelector("#war-history"),
  warHistorySection: document.querySelector("#war-history-section"),
};

const state = {
  signedIn: false,
  warId: null,
  history: [],
  posterUrl: null,
};

const playerRows = [];

function setNotice(message, kind = "") {
  elements.accountStatus.textContent = message;
  elements.accountStatus.className = `war-notice${kind ? ` is-${kind}` : ""}`;
}

function setFeedback(element, message, kind = "") {
  element.textContent = message;
  element.className = `feedback${kind ? ` feedback-${kind}` : ""}`;
}

function clearPosterPreview() {
  if (state.posterUrl) {
    URL.revokeObjectURL(state.posterUrl);
    state.posterUrl = null;
  }
  elements.posterPreview.removeAttribute("src");
  elements.posterPreview.classList.add("hidden");
  elements.downloadPoster.removeAttribute("href");
  elements.downloadPoster.classList.add("hidden");
}

function makePlayerId() {
  return globalThis.crypto?.randomUUID?.() ||
    `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPlayerRows() {
  for (let index = 0; index < 10; index += 1) {
    const row = document.createElement("div");
    row.className = "player-row";

    const number = document.createElement("span");
    number.className = "player-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("input");
    name.className = "control player-name";
    name.type = "text";
    name.maxLength = 32;
    name.autocomplete = "off";
    name.placeholder = `Player ${index + 1}`;
    name.setAttribute("aria-label", `Player ${index + 1} name`);

    const rank = document.createElement("input");
    rank.className = "control player-rank";
    rank.type = "number";
    rank.min = "0";
    rank.max = "9999";
    rank.step = "1";
    rank.placeholder = "Rank";
    rank.inputMode = "numeric";
    rank.setAttribute("aria-label", `Player ${index + 1} rank`);

    const leaderLabel = document.createElement("label");
    leaderLabel.className = "leader-toggle";
    const leader = document.createElement("input");
    leader.type = "checkbox";
    leader.checked = index < 2;
    leader.setAttribute("aria-label", `Mark player ${index + 1} as a leader`);
    const leaderText = document.createElement("span");
    leaderText.textContent = "Leader";
    leaderLabel.append(leader, leaderText);

    const team = document.createElement("select");
    team.className = "control team-select";
    team.setAttribute("aria-label", `Player ${index + 1} team`);
    for (const [label, value] of [["Team A", "A"], ["Team B", "B"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      team.append(option);
    }
    team.value = index === 1 || index > 5 ? "B" : "A";

    row.append(number, name, rank, team, leaderLabel);
    elements.playersList.append(row);
    playerRows.push({ id: makePlayerId(), row, name, rank, leader, team });
    for (const control of [name, rank, leader, team]) {
      control.addEventListener("input", updateViews);
      control.addEventListener("change", updateViews);
    }
  }
}

function readPlayers() {
  return playerRows.map(({ id, name, rank, leader, team }) => ({
    id,
    name: name.value.trim(),
    rank: rank.value.trim() === "" ? null : Number(rank.value),
    isLeader: leader.checked,
    team: team.value,
  }));
}

function getRosterErrors(players = readPlayers()) {
  const errors = [];
  if (players.length !== 10) errors.push("Enter exactly 10 players.");
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    if (!player.name || player.name.length > 32 || /[\u0000-\u001f\u007f]/u.test(player.name)) {
      errors.push(`Player ${index + 1} needs a name of 1–32 characters.`);
    }
    if (!Number.isInteger(player.rank) || player.rank < 0 || player.rank > 9999) {
      errors.push(`${player.name || `Player ${index + 1}`} needs an integer rank from 0 to 9999.`);
    }
  }
  const leaders = players.filter((player) => player.isLeader);
  if (leaders.length !== 2) errors.push("Select exactly 2 leaders.");
  return errors;
}

function getFinalErrors(players = readPlayers()) {
  const errors = getRosterErrors(players);
  const teamA = players.filter((player) => player.team === "A");
  const teamB = players.filter((player) => player.team === "B");
  if (teamA.length !== 5 || teamB.length !== 5) errors.push("Each team must have exactly 5 players.");
  if (teamA.filter((player) => player.isLeader).length !== 1 ||
      teamB.filter((player) => player.isLeader).length !== 1) {
    errors.push("Each team must have exactly 1 leader; the leaders must be on opposite teams.");
  }
  return errors;
}

function renderTeam(container, team, players, totalElement) {
  const teamPlayers = players.filter((player) => player.team === team);
  container.replaceChildren();
  for (const player of teamPlayers) {
    if (!player.name) continue;
    const row = document.createElement("div");
    row.className = "team-player";
    const name = document.createElement("span");
    name.className = "team-player-name";
    if (player.isLeader) {
      const leaderBadge = document.createElement("strong");
      leaderBadge.textContent = "LEADER";
      name.append(leaderBadge);
    }
    name.append(document.createTextNode(player.name));
    const rank = document.createElement("span");
    rank.className = "team-player-rank";
    rank.textContent = Number.isInteger(player.rank) ? String(player.rank) : "Rank —";
    row.append(name, rank);
    container.append(row);
  }
  if (teamPlayers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No players assigned.";
    container.append(empty);
  }
  const ranksValid = teamPlayers.every((player) =>
    Number.isInteger(player.rank) && player.rank >= 0 && player.rank <= 9999
  );
  const total = teamPlayers.reduce((sum, player) =>
    sum + (Number.isInteger(player.rank) ? player.rank : 0), 0
  );
  totalElement.textContent = `Total ${ranksValid ? total : "—"}`;
  return ranksValid ? total : null;
}

function displayTimezone(timezone) {
  try {
    const abbreviation = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return abbreviation || TIMEZONE_LABELS[timezone] || timezone;
  } catch {
    return TIMEZONE_LABELS[timezone] || timezone;
  }
}

function makeWarText(players, teamATotal, teamBTotal) {
  const formatTeam = (team) => players
    .filter((player) => player.team === team)
    .map((player) => `${player.isLeader ? "👑 " : ""}@${player.name}`)
    .join("\n");
  const difference = Math.abs(teamATotal - teamBTotal);
  return [
    "⚔️ CLAN WAR 5v5",
    "",
    `🔵 TEAM A\n${formatTeam("A")}`,
    "",
    `🟠 TEAM B\n${formatTeam("B")}`,
    "",
    "📊 BALANCE",
    `Team A: ${teamATotal}`,
    `Team B: ${teamBTotal}`,
    `Difference: ${difference}`,
    "",
    `🕒 TIME: ${elements.warTime.value} ${displayTimezone(elements.warTimezone.value)}`,
  ].join("\n");
}

function updateViews() {
  const players = readPlayers();
  const namedPlayers = players.filter((player) => player.name);
  const leaders = players.filter((player) => player.isLeader);
  elements.playerCount.textContent = `${namedPlayers.length} / 10 Players`;
  elements.leaderCount.textContent = `${leaders.length} / 2 Leaders`;

  const names = new Map();
  for (const player of namedPlayers) {
    const key = player.name.toLocaleLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }
  const duplicateNames = Array.from(names.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  elements.duplicateWarning.classList.toggle("hidden", duplicateNames.length === 0);
  elements.duplicateWarning.classList.toggle("is-warning", duplicateNames.length > 0);
  elements.duplicateWarning.textContent = duplicateNames.length
    ? `Duplicate display names are allowed; stable player IDs keep them distinct: ${duplicateNames.join(", ")}.`
    : "";

  const teamATotal = renderTeam(elements.teamAPlayers, "A", players, elements.teamATotal);
  const teamBTotal = renderTeam(elements.teamBPlayers, "B", players, elements.teamBTotal);
  const rosterErrors = getRosterErrors(players);
  const errors = getFinalErrors(players);
  const canBalance = rosterErrors.length === 0;
  const canSave = state.signedIn && errors.length === 0;
  elements.balanceButton.disabled = !canBalance;
  elements.saveWar.disabled = !canSave;
  elements.generatePoster.disabled = !canSave;
  elements.copyWarText.disabled = errors.length > 0;

  if (teamATotal === null || teamBTotal === null || errors.length > 0) {
    elements.balanceDifference.textContent = "—";
    elements.warText.textContent = "Complete a valid roster and team split to preview the share text.";
    elements.validationMessage.textContent = errors[0] || "Complete all player fields to validate the match.";
    elements.validationMessage.classList.add("is-error");
    return;
  }

  const difference = Math.abs(teamATotal - teamBTotal);
  elements.balanceDifference.textContent = String(difference);
  elements.validationMessage.textContent = difference === 0
    ? "Valid 5v5 split. Team ranks are exactly balanced."
    : `Valid 5v5 split. Team rank difference: ${difference}. A lower number is more balanced.`;
  elements.validationMessage.classList.remove("is-error");
  elements.warText.textContent = makeWarText(players, teamATotal, teamBTotal);
}

function setPlayers(players) {
  for (let index = 0; index < playerRows.length; index += 1) {
    const source = players[index];
    const target = playerRows[index];
    target.id = source.id || target.id;
    target.name.value = source.name || "";
    target.rank.value = Number.isInteger(source.rank) ? String(source.rank) : "";
    target.leader.checked = Boolean(source.isLeader);
    target.team.value = source.team === "B" ? "B" : "A";
  }
  updateViews();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function readRecord() {
  return {
    players: readPlayers(),
    time: elements.warTime.value,
    timezone: elements.warTimezone.value,
  };
}

async function saveWar() {
  const errors = getFinalErrors();
  if (!state.signedIn || errors.length) {
    setFeedback(elements.saveStatus, errors[0] || "Sign in before saving a Clan War.", "error");
    return null;
  }

  elements.saveWar.disabled = true;
  setFeedback(elements.saveStatus, "Saving your Clan War…");
  try {
    const method = state.warId ? "PUT" : "POST";
    const path = state.warId ? `/api/clan-wars/${encodeURIComponent(state.warId)}` : "/api/clan-wars";
    const response = await requestJson(path, {
      method,
      body: JSON.stringify(readRecord()),
    });
    state.warId = response.war.id;
    history.replaceState(null, "", `/dashboard/clan-war-manager/${encodeURIComponent(state.warId)}`);
    setFeedback(elements.saveStatus, "Clan War saved to your account.", "success");
    await loadHistory();
    updateViews();
    return response.war;
  } catch (error) {
    setFeedback(elements.saveStatus, error.message || "Could not save your Clan War.", "error");
    return null;
  } finally {
    updateViews();
  }
}

async function loadHistory() {
  try {
    const { wars } = await requestJson("/api/clan-wars");
    state.history = wars;
    elements.warHistory.replaceChildren();
    if (wars.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No saved Clan Wars yet. Save a valid 5v5 setup to start your history.";
      elements.warHistory.append(empty);
      return;
    }

    for (const war of wars) {
      const button = document.createElement("button");
      button.className = "history-item";
      button.type = "button";
      button.setAttribute("aria-current", String(war.id === state.warId));
      const details = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = war.title || `Clan War · ${war.time} ${TIMEZONE_LABELS[war.timezone]}`;
      const summary = document.createElement("span");
      summary.textContent = `Difference ${war.difference} · Revision ${war.revision}`;
      details.append(title, summary);
      const updated = document.createElement("time");
      updated.dateTime = war.updatedAt;
      updated.textContent = new Date(war.updatedAt).toLocaleDateString();
      button.append(details, updated);
      button.addEventListener("click", () => openWar(war.id));
      elements.warHistory.append(button);
    }
  } catch (error) {
    if (error.status === 401) {
      elements.warHistory.textContent = "Sign in with Google to view saved Clan Wars.";
      return;
    }
    elements.warHistory.textContent = error.message || "Could not load War History.";
  }
}

async function openWar(warId) {
  try {
    const { war } = await requestJson(`/api/clan-wars/${encodeURIComponent(warId)}`);
    state.warId = war.id;
    setPlayers(war.players);
    elements.warTime.value = war.time;
    elements.warTimezone.value = war.timezone;
    history.replaceState(null, "", `/dashboard/clan-war-manager/${encodeURIComponent(war.id)}`);
    elements.posterSection.classList.add("hidden");
    clearPosterPreview();
    setFeedback(elements.posterStatus, "");
    await loadHistory();
    setFeedback(elements.saveStatus, "Saved Clan War loaded. Edits remain available after its scheduled time.", "success");
    updateViews();
  } catch (error) {
    setFeedback(elements.saveStatus, error.message || "Could not open this Clan War.", "error");
  }
}

async function generatePoster() {
  const savedWar = await saveWar();
  if (!savedWar) return;
  elements.generatePoster.disabled = true;
  setFeedback(elements.posterStatus, "Generating your poster…");
  elements.posterSection.classList.remove("hidden");
  clearPosterPreview();
  try {
    const response = await fetch(
      `/api/clan-wars/${encodeURIComponent(state.warId)}/poster.png?revision=${encodeURIComponent(savedWar.revision)}`,
      { credentials: "same-origin", headers: { Accept: "image/png" } }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Could not generate the poster (${response.status}).`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("image/png")) {
      const text = await response.text().catch(() => "");
      throw new Error(`The poster service returned an invalid image (${contentType}): ${text.slice(0, 200)}`);
    }

    const blob = await response.blob();
    if (blob.size === 0) throw new Error("The poster service returned an empty image.");
    state.posterUrl = URL.createObjectURL(blob);
    const imageLoaded = new Promise((resolve, reject) => {
      elements.posterPreview.addEventListener("load", resolve, { once: true });
      elements.posterPreview.addEventListener("error", (e) => {
        reject(new Error("The generated poster could not be displayed. The image data may be corrupted."));
      }, { once: true });
    });
    elements.posterPreview.src = state.posterUrl;
    await imageLoaded;
    elements.posterPreview.classList.remove("hidden");
    elements.downloadPoster.href = state.posterUrl;
    elements.downloadPoster.classList.remove("hidden");
    setFeedback(elements.posterStatus, "Poster generated from the latest saved data.", "success");
    elements.posterSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    clearPosterPreview();
    setFeedback(elements.posterStatus, error.message || "Could not generate the poster.", "error");
  } finally {
    updateViews();
  }
}

async function copyText() {
  if (getFinalErrors().length) return;
  const text = elements.warText.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = text;
      temporary.setAttribute("readonly", "");
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand("copy");
      temporary.remove();
      if (!copied) throw new Error("Clipboard access is unavailable in this browser.");
    }
    setFeedback(elements.copyStatus, "Clan War text copied.", "success");
  } catch (error) {
    setFeedback(elements.copyStatus, error.message || "Could not copy the Clan War text.", "error");
  }
}

async function autoBalance() {
  const players = readPlayers();
  const errors = getRosterErrors(players);
  if (errors.length) {
    setFeedback(elements.saveStatus, errors[0], "error");
    return;
  }
  elements.balanceButton.disabled = true;
  try {
    const response = await requestJson("/api/clan-wars/balance", {
      method: "POST",
      body: JSON.stringify({ players }),
    });
    setPlayers(response.players);
    setFeedback(elements.saveStatus, "Teams balanced using the minimum possible rank difference.", "success");
  } catch (error) {
    setFeedback(elements.saveStatus, error.message || "Could not balance teams.", "error");
  } finally {
    updateViews();
  }
}

async function initialize() {
  createPlayerRows();
  const isHistoryRoute = window.location.pathname.endsWith("/history");
  const routeId = isHistoryRoute
    ? null
    : window.location.pathname.split("/").filter(Boolean).at(-1);
  const candidateId = routeId && routeId !== "clan-war-manager" ? routeId : null;
  updateViews();

  try {
    const { account } = await requestJson("/api/me");
    state.signedIn = Boolean(account?.id);
    setNotice(
      state.signedIn
        ? `Signed in${account.email ? ` as ${account.email}` : ""}. Your saved wars are private to this account.`
        : "Sign in with Google to save private Clan War records.",
      state.signedIn ? "success" : ""
    );
    if (!state.signedIn) {
      const link = document.createElement("a");
      link.href = "/#account-access";
      link.textContent = " Sign in";
      elements.accountStatus.append(link);
      elements.warHistory.textContent = "Sign in to load your saved Clan Wars.";
      return;
    }
    await loadHistory();
    if (candidateId) await openWar(candidateId);
    if (isHistoryRoute) {
      elements.warHistorySection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    setNotice(error.message || "Could not check your account.", "error");
  } finally {
    updateViews();
  }
}

for (const control of [elements.warTime, elements.warTimezone]) {
  control.addEventListener("input", updateViews);
  control.addEventListener("change", updateViews);
}
elements.balanceButton.addEventListener("click", autoBalance);
elements.saveWar.addEventListener("click", saveWar);
elements.generatePoster.addEventListener("click", generatePoster);
elements.copyWarText.addEventListener("click", copyText);

initialize();

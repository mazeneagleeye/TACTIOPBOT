const { createCanvas } = require("@napi-rs/canvas");

const TIMEZONES = Object.freeze({
  "Europe/Berlin": "Central Europe (CET/CEST)",
  "Africa/Cairo": "Cairo — Egypt",
  "Europe/Istanbul": "Turkey (TRT)",
  "Etc/UTC": "UTC",
});

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validatePlayers(input, { requireTeams = true } = {}) {
  if (!Array.isArray(input) || input.length !== 10) {
    throw validationError("A Clan War requires exactly 10 players.");
  }

  const ids = new Set();
  const players = input.map((player, index) => {
    if (!player || typeof player !== "object" || Array.isArray(player)) {
      throw validationError(`Player ${index + 1} must be an object.`);
    }

    const id = typeof player.id === "string" ? player.id.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.has(id)) {
      throw validationError(`Player ${index + 1} must have a unique stable ID.`);
    }
    ids.add(id);

    const name = typeof player.name === "string" ? player.name.trim() : "";
    if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw validationError(`Player ${index + 1} must have a name between 1 and 32 characters.`);
    }
    if (!Number.isInteger(player.rank) || player.rank < 0 || player.rank > 9999) {
      throw validationError(`Rank for ${name} must be an integer from 0 to 9999.`);
    }
    if (typeof player.isLeader !== "boolean") {
      throw validationError(`Leader selection for ${name} must be true or false.`);
    }

    const team = player.team;
    if (requireTeams && team !== "A" && team !== "B") {
      throw validationError(`${name} must be assigned to Team A or Team B.`);
    }
    if (!requireTeams && team !== undefined && team !== "A" && team !== "B") {
      throw validationError(`${name} must be assigned to Team A or Team B.`);
    }

    return {
      id,
      name,
      rank: player.rank,
      isLeader: player.isLeader,
      ...(team ? { team } : {}),
    };
  });

  const leaders = players.filter((player) => player.isLeader);
  if (leaders.length !== 2) {
    throw validationError("A Clan War requires exactly 2 leaders.");
  }
  if (players.filter((player) => !player.isLeader).length !== 8) {
    throw validationError("A Clan War requires exactly 8 regular players.");
  }

  if (requireTeams) {
    const teamA = players.filter((player) => player.team === "A");
    const teamB = players.filter((player) => player.team === "B");
    if (teamA.length !== 5 || teamB.length !== 5) {
      throw validationError("Each team must contain exactly 5 players.");
    }
    if (teamA.filter((player) => player.isLeader).length !== 1 ||
        teamB.filter((player) => player.isLeader).length !== 1) {
      throw validationError("Each team must contain exactly 1 leader.");
    }
  }

  return players;
}

function balancePlayers(input) {
  const players = validatePlayers(input, { requireTeams: false });
  const leaders = players.filter((player) => player.isLeader).sort((a, b) => a.id.localeCompare(b.id));
  const regulars = players.filter((player) => !player.isLeader).sort((a, b) => a.id.localeCompare(b.id));
  const leaderA = leaders[0];
  const leaderB = leaders[1];
  let best = null;

  for (let first = 0; first < regulars.length; first += 1) {
    for (let second = first + 1; second < regulars.length; second += 1) {
      for (let third = second + 1; third < regulars.length; third += 1) {
        for (let fourth = third + 1; fourth < regulars.length; fourth += 1) {
          const teamARegulars = [
            regulars[first],
            regulars[second],
            regulars[third],
            regulars[fourth],
          ];
          const selected = new Set(teamARegulars.map((player) => player.id));
          const teamA = [leaderA, ...teamARegulars];
          const teamB = [leaderB, ...regulars.filter((player) => !selected.has(player.id))];
          const teamATotal = teamA.reduce((total, player) => total + player.rank, 0);
          const teamBTotal = teamB.reduce((total, player) => total + player.rank, 0);
          const difference = Math.abs(teamATotal - teamBTotal);
          const signature = teamA.map((player) => player.id).sort().join("|");

          if (!best || difference < best.difference ||
              (difference === best.difference && signature < best.signature)) {
            best = { teamA, teamB, teamATotal, teamBTotal, difference, signature };
          }
        }
      }
    }
  }

  if (!best) throw validationError("Could not create a valid team split.");
  return [
    ...best.teamA.map((player) => ({ ...player, team: "A" })),
    ...best.teamB.map((player) => ({ ...player, team: "B" })),
  ];
}

function validateClanWar(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("A Clan War record is required.");
  }

  const players = validatePlayers(input.players);
  const time = typeof input.time === "string" ? input.time : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw validationError("Clan War time must use 24-hour HH:mm format.");
  }
  if (!Object.hasOwn(TIMEZONES, input.timezone)) {
    throw validationError("Choose a supported IANA timezone.");
  }

  const title = input.title === undefined ? "" : input.title;
  if (typeof title !== "string" || title.trim().length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(title)) {
    throw validationError("War title must be 80 characters or fewer.");
  }

  const teamATotal = players
    .filter((player) => player.team === "A")
    .reduce((total, player) => total + player.rank, 0);
  const teamBTotal = players
    .filter((player) => player.team === "B")
    .reduce((total, player) => total + player.rank, 0);

  return {
    title: title.trim(),
    players,
    teamATotal,
    teamBTotal,
    difference: Math.abs(teamATotal - teamBTotal),
    time,
    timezone: input.timezone,
    status: "complete",
  };
}

function getTimezoneAbbreviation(timezone, date = new Date()) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || TIMEZONES[timezone];
}

function formatClanWarText(record) {
  const teamText = (team) => record.players
    .filter((player) => player.team === team)
    .map((player) => `${player.isLeader ? "👑 " : ""}@${player.name}`)
    .join("\n");
  const timezoneLabel = getTimezoneAbbreviation(record.timezone);

  return [
    "⚔️ CLAN WAR 5v5",
    "",
    `🔵 TEAM A\n${teamText("A")}`,
    "",
    `🟠 TEAM B\n${teamText("B")}`,
    "",
    "📊 BALANCE",
    `Team A: ${record.teamATotal}`,
    `Team B: ${record.teamBTotal}`,
    `Difference: ${record.difference}`,
    "",
    `🕒 TIME: ${record.time} ${timezoneLabel}`,
  ].join("\n");
}

function fitText(context, value, maxWidth) {
  let text = value;
  while (text.length > 1 && context.measureText(text).width > maxWidth) {
    text = `${text.slice(0, -2)}…`;
  }
  return text;
}

function getTimezoneAbbreviation(timezone) {
  try {
    const abbreviation = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return abbreviation || "";
  } catch {
    return "";
  }
}

function fitText(context, text, maxWidth) {
  const metrics = context.measureText(text);
  if (metrics.width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (context.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function createClanWarPoster(record) {
  const canvas = createCanvas(1920, 1080);
  const context = canvas.getContext("2d");

  // Dark navy background with subtle gradient
  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#061c37");
  background.addColorStop(0.5, "#0a1628");
  background.addColorStop(1, "#0e1a2e");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Top accent line - electric blue
  context.fillStyle = "#168bff";
  context.fillRect(0, 0, canvas.width, 4);

  // Header
  context.fillStyle = "#eaf2ff";
  context.font = "900 64px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText("CLAN WAR", 96, 110);
  context.fillStyle = "#754cff";
  context.font = "900 64px Arial, sans-serif";
  context.fillText("5v5", 96 + context.measureText("CLAN WAR ").width, 110);

  // Time info
  const tzLabel = TIMEZONES[record.timezone] || record.timezone;
  const tzAbbr = getTimezoneAbbreviation(record.timezone);
  context.fillStyle = "#b7c9e6";
  context.font = "500 26px Arial, sans-serif";
  context.fillText(`${record.time}  ·  ${tzLabel}  (${tzAbbr})`, 96, 150);

  // VS divider
  const centerX = canvas.width / 2;
  context.fillStyle = "#168bff";
  context.font = "900 48px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("VS", centerX, 190);

  // Team panels
  const panelY = 220;
  const panelHeight = 680;
  const panelWidth = 840;
  const panelGap = 60;
  const panelA = 96;
  const panelB = panelA + panelWidth + panelGap;

  const drawTeam = (team, x, bgColor, accentColor, isTeamA) => {
    // Panel background
    context.fillStyle = bgColor;
    context.fillRect(x, panelY, panelWidth, panelHeight);

    // Panel border
    context.strokeStyle = accentColor;
    context.lineWidth = 3;
    context.strokeRect(x, panelY, panelWidth, panelHeight);

    // Inner glow
    context.strokeStyle = `${accentColor}66`;
    context.lineWidth = 1;
    context.strokeRect(x + 2, panelY + 2, panelWidth - 4, panelHeight - 4);

    // Team label
    context.fillStyle = accentColor;
    context.font = "900 40px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(`TEAM ${team}`, x + 40, panelY + 64);

    // Divider under team label
    context.fillStyle = `${accentColor}66`;
    context.fillRect(x + 40, panelY + 76, panelWidth - 80, 2);

    // Column headers
    context.fillStyle = "#8a9cb3";
    context.font = "600 18px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText("#", x + 50, panelY + 118);
    context.fillText("PLAYER", x + 100, panelY + 118);
    context.textAlign = "right";
    context.fillText("RANK", x + panelWidth - 50, panelY + 118);

    // Header divider
    context.fillStyle = `${accentColor}44`;
    context.fillRect(x + 40, panelY + 126, panelWidth - 80, 1);

    const players = record.players.filter((player) => player.team === team);

    players.forEach((player, index) => {
      const rowY = panelY + 145 + index * 98;
      const isLeader = player.isLeader;

      // Position number
      context.fillStyle = isLeader ? accentColor : "#7a8ca8";
      context.font = "800 28px Arial, sans-serif";
      context.textAlign = "center";
      context.fillText(String(index + 1), x + 55, rowY + 35);

      // Leader crown/badge
      if (isLeader) {
        context.fillStyle = accentColor;
        context.font = "28px Arial, sans-serif";
        context.textAlign = "center";
        context.fillText("★", x + 55, rowY - 12);
      }

      // Player name
      context.fillStyle = isLeader ? "#fff" : "#eaf2ff";
      context.font = "700 30px Arial, sans-serif";
      context.textAlign = "left";
      context.fillText(fitText(context, player.name, 500), x + 100, rowY + 35);

      // Leader label
      if (isLeader) {
        context.fillStyle = accentColor;
        context.font = "700 16px Arial, sans-serif";
        context.fillText("LEADER", x + 100, rowY + 58);
      }

      // Rank
      context.fillStyle = isLeader ? accentColor : "#b7c9e6";
      context.font = "700 28px Arial, sans-serif";
      context.textAlign = "right";
      context.fillText(String(player.rank).replace(/\B(?=(\d{3})+(?!\d))/g, ","), x + panelWidth - 50, rowY + 35);
    });

    // Team average
    const total = players.reduce((sum, player) => sum + player.rank, 0);
    const avg = Math.floor(total / 5);
    context.fillStyle = "#7a8ca8";
    context.font = "600 18px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText("TEAM AVG", x + 40, panelY + panelHeight - 30);
    context.textAlign = "right";
    context.fillStyle = accentColor;
    context.font = "900 36px Arial, sans-serif";
    context.fillText(String(avg).replace(/\B(?=(\d{3})+(?!\d))/g, ","), x + panelWidth - 40, panelY + panelHeight - 30);
  };

  // Team A - Blue
  drawTeam("A", panelA, "rgba(10, 28, 55, 0.95)", "#168bff", true);
  // Team B - Purple/Orange
  drawTeam("B", panelB, "rgba(30, 15, 40, 0.95)", "#754cff", false);

  // Balance difference - center (based on averages)
  const teamAPlayers = record.players.filter((p) => p.team === "A");
  const teamBPlayers = record.players.filter((p) => p.team === "B");
  const teamAAvg = Math.floor(teamAPlayers.reduce((s, p) => s + p.rank, 0) / 5);
  const teamBAvg = Math.floor(teamBPlayers.reduce((s, p) => s + p.rank, 0) / 5);
  const avgDifference = Math.abs(teamAAvg - teamBAvg);

  context.textAlign = "center";
  context.fillStyle = "#168bff";
  context.font = "800 28px Arial, sans-serif";
  context.fillText("BALANCE DIFFERENCE (AVG)", centerX, 950);
  context.fillStyle = avgDifference === 0 ? "#00ff88" : "#168bff";
  context.font = "900 48px Arial, sans-serif";
  context.fillText(String(avgDifference).replace(/\B(?=(\d{3})+(?!\d))/g, ","), centerX, 1005);
  if (avgDifference === 0) {
    context.fillStyle = "#00ff88";
    context.font = "600 18px Arial, sans-serif";
    context.fillText("PERFECTLY BALANCED", centerX, 1030);
  }

  // Watermark - bottom right
  context.textAlign = "right";
  context.fillStyle = "#5a6b7e";
  context.font = "500 14px Arial, sans-serif";
  context.fillText("Powered by @ytmazen", canvas.width - 48, canvas.height - 48);
  context.fillStyle = "#3d4a58";
  context.font = "700 11px Arial, sans-serif";
  context.fillText("MAZEN EAGLE EYE", canvas.width - 48, canvas.height - 28);

  return canvas.toBuffer("image/png");
}

module.exports = {
  TIMEZONES,
  balancePlayers,
  createClanWarPoster,
  formatClanWarText,
  validateClanWar,
  validatePlayers,
};

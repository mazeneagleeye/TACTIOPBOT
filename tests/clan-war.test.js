const assert = require("node:assert/strict");
const test = require("node:test");
const {
  balancePlayers,
  createClanWarPoster,
  formatClanWarText,
  validateClanWar,
  validatePlayers,
} = require("../web/clanWar");

function playersForRanks(ranks) {
  return ranks.map((rank, index) => ({
    id: `player-${String(index).padStart(2, "0")}`,
    name: `Player ${index + 1}`,
    rank,
    isLeader: index < 2,
  }));
}

function bruteForceDifference(players) {
  const leaders = players.filter((player) => player.isLeader);
  const regulars = players.filter((player) => !player.isLeader);
  let minimum = Infinity;

  for (let mask = 0; mask < 1 << regulars.length; mask += 1) {
    if (mask.toString(2).replaceAll("0", "").length !== 4) continue;
    const teamA = [leaders[0], ...regulars.filter((_, index) => mask & (1 << index))];
    if (teamA.length !== 5) continue;
    const teamB = [leaders[1], ...regulars.filter((_, index) => !(mask & (1 << index)))];
    const totalA = teamA.reduce((sum, player) => sum + player.rank, 0);
    const totalB = teamB.reduce((sum, player) => sum + player.rank, 0);
    minimum = Math.min(minimum, Math.abs(totalA - totalB));
  }

  return minimum;
}

test("Clan War balancing reaches the exhaustive minimum and is deterministic", () => {
  const players = playersForRanks([971, 842, 901, 733, 645, 1000, 511, 923, 722, 804]);
  const balanced = balancePlayers(players);
  const repeated = balancePlayers(players);
  const shuffled = balancePlayers([...players].reverse());
  const totalA = balanced.filter((player) => player.team === "A")
    .reduce((sum, player) => sum + player.rank, 0);
  const totalB = balanced.filter((player) => player.team === "B")
    .reduce((sum, player) => sum + player.rank, 0);

  assert.equal(Math.abs(totalA - totalB), bruteForceDifference(players));
  assert.deepEqual(balanced, repeated);
  assert.deepEqual(balanced, shuffled);
  assert.equal(balanced.filter((player) => player.team === "A").length, 5);
  assert.equal(balanced.filter((player) => player.team === "B").length, 5);
  assert.equal(balanced.filter((player) => player.team === "A" && player.isLeader).length, 1);
  assert.equal(balanced.filter((player) => player.team === "B" && player.isLeader).length, 1);
});

test("Clan War validation enforces player counts, stable IDs, ranks, leaders, and teams", () => {
  const valid = playersForRanks(Array(10).fill(1000)).map((player, index) => ({
    ...player,
    team: index % 2 === 0 ? "A" : "B",
  }));
  validateClanWar({ players: valid, time: "16:00", timezone: "Europe/Berlin" });

  assert.throws(() => validatePlayers(valid.slice(1)), /exactly 10 players/);
  assert.throws(() => validatePlayers(valid.map((player, index) =>
    index === 9 ? { ...player, id: valid[0].id } : player
  )), /unique stable ID/);
  assert.throws(() => validatePlayers(valid.map((player, index) =>
    index === 0 ? { ...player, rank: 10000 } : player
  )), /integer from 0 to 9999/);
  assert.throws(() => validateClanWar({
    players: valid.map((player, index) =>
      index === 0 ? { ...player, team: "B" } :
        index === 5 ? { ...player, team: "A" } : player
    ),
    time: "16:00",
    timezone: "Europe/Berlin",
  }), /exactly 1 leader/);
  assert.throws(() => validateClanWar({
    players: valid,
    time: "4 PM",
    timezone: "Europe/Berlin",
  }), /HH:mm/);
  assert.throws(() => validateClanWar({
    players: valid,
    time: "16:00",
    timezone: "UTC+2",
  }), /IANA timezone/);
});

test("generated Clan War text uses the current teams and excludes image-only credits", () => {
  const players = playersForRanks(Array(10).fill(1000)).map((player, index) => ({
    ...player,
    team: index === 0 || (index >= 2 && index <= 5) ? "A" : "B",
  }));
  const record = validateClanWar({ players, time: "16:00", timezone: "Etc/UTC" });
  const text = formatClanWarText(record);

  assert.match(text, /CLAN WAR 5v5/);
  assert.match(text, /👑 @Player 1/);
  assert.match(text, /Team A: 5000/);
  assert.match(text, /Difference: 0/);
  assert.match(text, /TIME: 16:00/);
  assert.doesNotMatch(text, /Powered by|MAZEN EAGLE EYE/);
});

test("Clan War poster is a generated PNG containing a valid record", () => {
  const players = playersForRanks(Array(10).fill(1000)).map((player, index) => ({
    ...player,
    team: index === 0 || (index >= 2 && index <= 5) ? "A" : "B",
  }));
  const record = validateClanWar({ players, time: "16:00", timezone: "Etc/UTC" });
  const image = createClanWarPoster(record);

  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(image.length > 10_000);
});

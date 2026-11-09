const resetTimeElements = [
  document.querySelector("#mission-reset-time"),
  document.querySelector("#next-reset"),
].filter(Boolean);
const resetZoneElement = document.querySelector("#mission-reset-zone");

async function loadMissionReset() {
  if (!resetTimeElements.length) return;

  try {
    const response = await fetch("/api/mission-reset", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Reset schedule request failed (${response.status}).`);

    const reset = new Date(data.nextReset);
    if (!Number.isFinite(reset.getTime())) throw new Error("The reset schedule returned an invalid timestamp.");
    const timezone = data.timezone && data.timezone !== "auto"
      ? data.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const formattedReset = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(reset);

    for (const element of resetTimeElements) {
      element.dateTime = reset.toISOString();
      element.textContent = formattedReset;
    }
    if (resetZoneElement) resetZoneElement.textContent = `Shown in ${timezone}`;
  } catch (error) {
    console.error("[mission-reset] Could not load reset schedule.", error);
    for (const element of resetTimeElements) {
      element.textContent = "Reset schedule unavailable.";
    }
    if (resetZoneElement) resetZoneElement.textContent = "";
  }
}

loadMissionReset();

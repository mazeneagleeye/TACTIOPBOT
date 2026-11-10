const form = document.querySelector("#profile-completion-form");
const clanNameInput = document.querySelector("#clan-name");
const timezoneSelect = document.querySelector("#timezone-select");
const submitButton = document.querySelector("#complete-profile-button");
const errorMessage = document.querySelector("#profile-error");
const identity = document.querySelector("#profile-identity");
const logoutButton = document.querySelector("#profile-logout-button");

const COMMON_TIMEZONES = [
  { value: "Africa/Cairo", label: "Cairo (EET/EEST)" },
  { value: "Europe/Istanbul", label: "Istanbul (TRT)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "America/New_York", label: "New York (EST/EDT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST/PDT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
];

function getErrorMessage(error, fallback) {
  if (!error) return fallback;
  const message = error.message;
  if (typeof message === "string" && message.length > 0) return message;
  if (typeof message === "object" && message !== null) return String(message);
  return fallback;
}

function populateTimezoneSelect() {
  if (!timezoneSelect) return;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  for (const tz of COMMON_TIMEZONES) {
    const option = document.createElement("option");
    option.value = tz.value;
    option.textContent = tz.label;
    if (tz.value === detected) option.textContent += " (detected)";
    timezoneSelect.appendChild(option);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

async function loadProfile() {
  try {
    const { account } = await requestJson("/api/me");
    if (!account) {
      window.location.replace("/?auth_error=sign_in_required");
      return;
    }
    if (account.clanName) {
      window.location.replace("/");
      return;
    }
    identity.textContent = account.fullName || account.email || "";
    populateTimezoneSelect();
  } catch (error) {
    errorMessage.textContent = getErrorMessage(error, "Your profile could not be loaded.");
    errorMessage.classList.remove("hidden");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.classList.add("hidden");
  submitButton.disabled = true;
  try {
    const body = { clanName: clanNameInput.value };
    const tz = timezoneSelect?.value;
    if (tz && tz !== "auto") body.timezone = tz;
    await requestJson("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    window.location.assign("/");
  } catch (error) {
    errorMessage.textContent = getErrorMessage(error, "Your clan name could not be saved.");
    errorMessage.classList.remove("hidden");
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST" });
    window.location.assign("/");
  } catch (error) {
    errorMessage.textContent = getErrorMessage(error, "You could not be signed out.");
    errorMessage.classList.remove("hidden");
    logoutButton.disabled = false;
  }
});

loadProfile();
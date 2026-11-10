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

const timezoneSelect = document.querySelector("#timezone-select");
const timezoneHint = document.querySelector("#timezone-hint");
const saveTimezoneButton = document.querySelector("#save-timezone-button");
const settingsError = document.querySelector("#settings-error");
const settingsSuccess = document.querySelector("#settings-success");
const profileForm = document.querySelector("#profile-form");
const fullNameInput = document.querySelector("#full-name");
const clanNameInput = document.querySelector("#clan-name");
const profileError = document.querySelector("#profile-error");
const profileSuccess = document.querySelector("#profile-success");
const saveProfileButton = document.querySelector("#save-profile-button");
const accountEmail = document.querySelector("#account-email");
const accountProviders = document.querySelector("#account-providers");
const logoutButton = document.querySelector("#logout-button");

function populateTimezoneSelect(selectedValue = null) {
  if (!timezoneSelect) return;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  timezoneSelect.innerHTML = '<option value="auto">Auto-detect from browser</option>';
  for (const tz of COMMON_TIMEZONES) {
    const option = document.createElement("option");
    option.value = tz.value;
    option.textContent = tz.label;
    if (tz.value === detected) option.textContent += " (detected)";
    if (selectedValue && tz.value === selectedValue) option.selected = true;
    timezoneSelect.appendChild(option);
  }
  if (selectedValue === "auto" || !selectedValue) {
    timezoneSelect.value = "auto";
  }
  updateTimezoneHint();
}

function updateTimezoneHint() {
  if (!timezoneHint) return;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (timezoneSelect.value === "auto") {
    timezoneHint.textContent = `Your browser reports: ${detected}. This will update automatically if you travel.`;
  } else {
    const selected = COMMON_TIMEZONES.find(tz => tz.value === timezoneSelect.value);
    timezoneHint.textContent = `Fixed to: ${selected?.label || timezoneSelect.value}. This will not change automatically.`;
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

async function loadSettings() {
  try {
    const { account } = await requestJson("/api/me");
    if (!account) {
      window.location.replace("/login?redirect=/dashboard/settings");
      return;
    }
    fullNameInput.value = account.fullName || "";
    clanNameInput.value = account.clanName || "";
    accountEmail.textContent = account.email || "";
    const providers = [];
    if (account.googleId) providers.push("Google");
    if (account.discordId) providers.push("Discord");
    if (account.passwordHash) providers.push("Email");
    accountProviders.textContent = providers.join(", ") || "None";
    populateTimezoneSelect(account.timezone || null);
  } catch (error) {
    settingsError.textContent = getErrorMessage(error, "Settings could not be loaded.");
    settingsError.classList.remove("hidden");
  }
}

timezoneSelect?.addEventListener("change", updateTimezoneHint);

saveTimezoneButton?.addEventListener("click", async () => {
  settingsError.classList.add("hidden");
  settingsSuccess.classList.add("hidden");
  saveTimezoneButton.disabled = true;
  try {
    const tz = timezoneSelect.value === "auto" ? null : timezoneSelect.value;
    await requestJson("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    });
    settingsSuccess.textContent = "Timezone saved.";
    settingsSuccess.classList.remove("hidden");
  } catch (error) {
    settingsError.textContent = getErrorMessage(error, "Timezone could not be saved.");
    settingsError.classList.remove("hidden");
  } finally {
    saveTimezoneButton.disabled = false;
  }
});

profileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileError.classList.add("hidden");
  profileSuccess.classList.add("hidden");
  saveProfileButton.disabled = true;
  try {
    await requestJson("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: fullNameInput.value,
        clanName: clanNameInput.value,
      }),
    });
    profileSuccess.textContent = "Profile saved.";
    profileSuccess.classList.remove("hidden");
  } catch (error) {
    profileError.textContent = getErrorMessage(error, "Profile could not be saved.");
    profileError.classList.remove("hidden");
  } finally {
    saveProfileButton.disabled = false;
  }
});

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST" });
    window.location.assign("/");
  } catch (error) {
    settingsError.textContent = getErrorMessage(error, "You could not be signed out.");
    settingsError.classList.remove("hidden");
    logoutButton.disabled = false;
  }
});

loadSettings();
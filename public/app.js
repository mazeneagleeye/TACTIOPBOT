const elements = {
  loading: document.querySelector("#loading-state"),
  authNotice: document.querySelector("#auth-notice"),
  login: document.querySelector("#login-state"),
  loginError: document.querySelector("#login-error"),
  connectDiscord: document.querySelector("#connect-discord-state"),
  connectDiscordCopy: document.querySelector("#connected-account-copy"),
  connectDiscordButton: document.querySelector("#connect-discord-button"),
  connectError: document.querySelector("#connect-error"),
  accountLogout: document.querySelector("#account-logout-button"),
  googleButton: document.querySelector("#google-button"),
  googleLabel: document.querySelector("#google-label"),
  discordButton: document.querySelector("#discord-button"),
  discordLabel: document.querySelector("#discord-label"),
  loginForm: document.querySelector("#email-login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  loginSubmit: document.querySelector("#email-login-button"),
  loginFormError: document.querySelector("#email-login-error"),
  emailVerificationForm: document.querySelector("#email-verification-form"),
  emailVerificationCopy: document.querySelector("#email-verification-copy"),
  emailVerificationCode: document.querySelector("#email-verification-code"),
  emailVerificationSubmit: document.querySelector("#email-verification-submit"),
  emailVerificationResend: document.querySelector("#email-verification-resend"),
  emailVerificationBack: document.querySelector("#email-verification-back"),
  emailVerificationError: document.querySelector("#email-verification-error"),
  registrationForm: document.querySelector("#email-registration-form"),
  registrationFullName: document.querySelector("#register-full-name"),
  registrationClanName: document.querySelector("#register-clan-name"),
  registrationEmail: document.querySelector("#register-email"),
  registrationPassword: document.querySelector("#register-password"),
  registrationSubmit: document.querySelector("#email-register-button"),
  registrationError: document.querySelector("#email-register-error"),
  showRegistration: document.querySelector("#show-registration-button"),
  showLogin: document.querySelector("#show-login-button"),
  accountAccess: document.querySelector("#account-access"),
  dashboardLink: document.querySelector("#dashboard-link"),
  dashboard: document.querySelector("#dashboard"),
  welcomeName: document.querySelector("#welcome-name"),
  welcomeClanName: document.querySelector("#welcome-clan-name"),
  profileFullName: document.querySelector("#profile-full-name"),
  profileFullNameInput: document.querySelector("#profile-full-name-input"),
  profileEmail: document.querySelector("#profile-email"),
  profileClanName: document.querySelector("#profile-clan-name"),
  profileTimezoneMode: document.querySelector("#profile-timezone-mode"),
  profileTimezoneFields: document.querySelector("#profile-timezone-fields"),
  profileTimezoneSearch: document.querySelector("#profile-timezone-search"),
  profileTimezone: document.querySelector("#profile-timezone"),
  profileForm: document.querySelector("#profile-settings-form"),
  profileSubmit: document.querySelector("#profile-save-button"),
  profileFeedback: document.querySelector("#profile-feedback"),
  emailChangeForm: document.querySelector("#email-change-form"),
  newAccountEmail: document.querySelector("#new-account-email"),
  emailChangeSend: document.querySelector("#email-change-send"),
  emailChangeVerification: document.querySelector("#email-change-verification"),
  emailChangeCopy: document.querySelector("#email-change-copy"),
  emailChangeCode: document.querySelector("#email-change-code"),
  emailChangeVerify: document.querySelector("#email-change-verify"),
  emailChangeResend: document.querySelector("#email-change-resend"),
  emailChangeFeedback: document.querySelector("#email-change-feedback"),
  passwordChangeForm: document.querySelector("#password-change-form"),
  newAccountPassword: document.querySelector("#new-account-password"),
  passwordChangeSend: document.querySelector("#password-change-send"),
  passwordChangeVerification: document.querySelector("#password-change-verification"),
  passwordChangeCopy: document.querySelector("#password-change-copy"),
  passwordChangeCode: document.querySelector("#password-change-code"),
  passwordChangeVerify: document.querySelector("#password-change-verify"),
  passwordChangeResend: document.querySelector("#password-change-resend"),
  passwordChangeFeedback: document.querySelector("#password-change-feedback"),
  emailTestPanel: document.querySelector("#email-test-panel"),
  emailTestButton: document.querySelector("#email-test-button"),
  emailTestFeedback: document.querySelector("#email-test-feedback"),
  dashboardIntegrationNote: document.querySelector("#dashboard-integration-note"),
  serverPanel: document.querySelector(".server-panel"),
  empty: document.querySelector("#empty-state"),
  guildSelect: document.querySelector("#guild-select"),
  serverHelp: document.querySelector("#server-help"),
  userName: document.querySelector("#user-name"),
  logout: document.querySelector("#logout-button"),
  settingsPanel: document.querySelector("#settings-panel"),
  selectedGuildName: document.querySelector("#selected-guild-name"),
  badge: document.querySelector("#config-badge"),
  settingsLoading: document.querySelector("#settings-loading"),
  settingsForm: document.querySelector("#settings-form"),
  channelSelect: document.querySelector("#channel-select"),
  roleSelect: document.querySelector("#role-select"),
  languageSelect: document.querySelector("#language-select"),
  enabledToggle: document.querySelector("#enabled-toggle"),
  saveButton: document.querySelector("#save-button"),
  deleteButton: document.querySelector("#delete-button"),
  feedback: document.querySelector("#feedback"),
};

const state = {
  guilds: [],
  languages: [],
  config: null,
  resources: null,
  currentGuildId: "",
  signedInAccount: false,
  discordConnected: false,
  canManageDiscordServers: false,
  authSectionOpened: false,
  pendingEmailAction: null,
  emailChangeStage: "idle",
};

const POPULAR_TIMEZONES = {
  "Africa/Cairo": "Cairo, Egypt",
  "Europe/Istanbul": "Istanbul, Turkey",
  "Europe/Moscow": "Moscow, Russia",
  "Europe/London": "London, United Kingdom",
  "America/New_York": "New York, United States",
  "Asia/Tokyo": "Tokyo, Japan",
  "Australia/Sydney": "Sydney, Australia",
  "Asia/Dubai": "Dubai, United Arab Emirates",
  "Asia/Riyadh": "Riyadh, Saudi Arabia",
  "Europe/Paris": "Paris, France",
  "Europe/Berlin": "Berlin, Germany",
  "Africa/Johannesburg": "Johannesburg, South Africa",
  "Asia/Kolkata": "Mumbai, India",
  "Asia/Singapore": "Singapore",
  "Asia/Bangkok": "Bangkok, Thailand",
  "America/Los_Angeles": "Los Angeles, United States",
  "America/Chicago": "Chicago, United States",
  "America/Toronto": "Toronto, Canada",
  "Pacific/Auckland": "Auckland, New Zealand",
  "America/Sao_Paulo": "São Paulo, Brazil",
};

function populateTimezoneOptions() {
  if (!elements.profileTimezone) return;
  const supported = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : Object.keys(POPULAR_TIMEZONES);
  const allTimezones = [...new Set(["UTC", ...supported])];
  const popular = Object.keys(POPULAR_TIMEZONES);

  function addTimezoneOptions(timezones, groupLabel) {
    const group = document.createElement("optgroup");
    group.label = groupLabel;
    for (const timezone of timezones) {
      const option = document.createElement("option");
      option.value = timezone;
      option.textContent = POPULAR_TIMEZONES[timezone]
        ? `${POPULAR_TIMEZONES[timezone]} — ${timezone}`
        : timezone;
      option.dataset.search = `${option.textContent} ${timezone}`.toLocaleLowerCase();
      group.append(option);
    }
    elements.profileTimezone.append(group);
  }

  addTimezoneOptions(popular, "Popular cities");
  addTimezoneOptions(
    allTimezones.filter((timezone) => !popular.includes(timezone)).sort(),
    "All IANA timezones"
  );
}

function setProfileTimezone(timezone) {
  const manual = typeof timezone === "string" && timezone !== "auto";
  elements.profileTimezoneMode.value = manual ? "manual" : "auto";
  if (manual) {
    const existing = Array.from(elements.profileTimezone.options)
      .find((option) => option.value === timezone);
    if (!existing) {
      const option = document.createElement("option");
      option.value = timezone;
      option.textContent = timezone;
      option.dataset.search = timezone.toLocaleLowerCase();
      elements.profileTimezone.add(option);
    }
    elements.profileTimezone.value = timezone;
  } else {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    elements.profileTimezone.value = detectedTimezone;
  }
  show(elements.profileTimezoneFields, manual);
}

function filterTimezoneOptions() {
  const query = elements.profileTimezoneSearch.value.trim().toLocaleLowerCase();
  for (const option of elements.profileTimezone.options) {
    option.hidden = Boolean(query) && !option.dataset.search?.includes(query);
  }
}

function show(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function setFeedback(message, kind) {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback feedback-${kind}`;
}

function showAuthError(message) {
  elements.authNotice.textContent = message;
  show(elements.authNotice, true);
}

function beginEmailVerification(action, email) {
  state.pendingEmailAction = action;
  elements.emailVerificationCopy.textContent =
    `Enter the 6-digit code we sent to ${email}. The code expires in 10 minutes.`;
  elements.emailVerificationCode.value = "";
  elements.emailVerificationSubmit.disabled = false;
  show(elements.loginForm, false);
  show(elements.registrationForm, false);
  show(elements.showRegistration, false);
  show(elements.showLogin, false);
  show(elements.emailVerificationForm, true);
  show(elements.emailVerificationError, false);
  elements.emailVerificationSubmit.textContent =
    action === "register" ? "Verify email and create account" : "Verify and sign in";
  elements.emailVerificationCode.focus();
}

async function loadProviderStatus() {
  try {
    const providers = await requestJson("/auth/providers");
    elements.googleButton.disabled = !providers.google;
    elements.googleLabel.textContent = providers.google
      ? "Continue with Google"
      : "Google sign-in is not configured";
    if (providers.google) {
      elements.googleButton.setAttribute("aria-label", "Continue with Google");
    } else {
      elements.googleButton.setAttribute("aria-label", "Google sign-in is not configured");
    }
    elements.discordButton.disabled = !providers.discord;
    elements.discordLabel.textContent = providers.discord
      ? "Continue with Discord"
      : "Discord sign-in is not configured";
  } catch (error) {
    showAuthError(error.message || "Sign-in options could not be loaded.");
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(options?.headers || {}) },
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

function option(label, value) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function fillSelect(select, placeholder, items, selectedValue) {
  select.replaceChildren(option(placeholder, ""));
  for (const item of items) {
    select.append(option(item.name, item.id || item.name));
  }
  if (selectedValue && Array.from(select.options).some((item) => item.value === selectedValue)) {
    select.value = selectedValue;
  }
}

async function loadGuildSettings(guildId) {
  const guild = state.guilds.find((item) => item.id === guildId);
  state.currentGuildId = guildId;
  state.config = null;
  state.resources = null;
  show(elements.settingsPanel, Boolean(guild));
  show(elements.settingsLoading, Boolean(guild));
  show(elements.settingsForm, false);
  show(elements.feedback, false);
  elements.selectedGuildName.textContent = guild?.name || "Choose a server";
  if (!guild) return;

  try {
    const [settingsResponse, resourcesResponse] = await Promise.all([
      requestJson(`/api/guilds/${encodeURIComponent(guildId)}/clan-mission-notification`),
      requestJson(`/api/guilds/${encodeURIComponent(guildId)}/resources`),
    ]);
    if (state.currentGuildId !== guildId) return;

    state.config = settingsResponse.settings;
    state.resources = resourcesResponse;
    fillSelect(elements.channelSelect, "Choose a text channel", resourcesResponse.channels, state.config?.channelId);
    fillSelect(elements.roleSelect, "No role mention", resourcesResponse.roles, state.config?.roleId);
    fillSelect(
      elements.languageSelect,
      "Choose a language",
      state.languages.map((name) => ({ name })),
      state.config?.language || "English"
    );
    elements.enabledToggle.checked = state.config?.enabled ?? true;
    elements.badge.textContent = state.config ? (state.config.enabled ? "Enabled" : "Disabled") : "Not configured";
    elements.badge.classList.toggle("is-enabled", Boolean(state.config?.enabled));
    show(elements.deleteButton, Boolean(state.config));
    show(elements.settingsForm, true);
  } catch (error) {
    if (state.currentGuildId !== guildId) return;
    setFeedback(
      error.status === 401
        ? "Your Discord session expired. Sign out and sign in again."
        : error.message || "Could not load this server's settings.",
      "error"
    );
  } finally {
    if (state.currentGuildId === guildId) show(elements.settingsLoading, false);
  }
}

function setGuildOptions(guilds) {
  elements.guildSelect.replaceChildren(option("Select a server", ""));
  for (const guild of guilds) {
    elements.guildSelect.append(option(guild.name, guild.id));
  }
}

async function initializeDashboard() {
  const authError = new URLSearchParams(window.location.search).get("auth_error");
  if (authError) {
    show(elements.accountAccess, true);
    state.authSectionOpened = true;
  }
  if (authError) {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    const messages = {
      google_account_conflict: "A website account already uses that Google email. No accounts were linked. Sign in using the method already attached to this email.",
      discord_account_conflict: "That Discord account is already linked to another website account. No accounts were linked.",
      discord_email_conflict: "A website account already uses this Discord email. Sign in with the existing method and explicitly connect Discord from your account.",
      google_cancelled: "Google sign-in was cancelled.",
      discord_cancelled: "Discord sign-in was cancelled.",
      google_unverified: "Google could not verify this account. Confirm that the selected account has a verified email, then try again.",
      google_failed: "Google sign-in could not be completed. Check the configured OAuth client and callback URL, then try again.",
      discord_failed: "Discord sign-in could not be completed. Check the configured OAuth client and callback URL, then try again.",
      discord_unverified_email: "Discord must provide a verified email address to create an account. Sign in another way and connect Discord from your profile.",
      sign_in_required: "Sign in to continue.",
    };
    if (messages[authError]) showAuthError(messages[authError]);
  }

  try {
    const { user, account } = await requestJson("/api/me");
    if (!account) {
      const pending = await requestJson("/auth/pending");
      if (pending.action) {
        state.authSectionOpened = true;
        show(elements.accountAccess, true);
        beginEmailVerification(pending.action, pending.email);
      } else if (state.authSectionOpened) {
        show(elements.login, true);
      }
      await loadProviderStatus();
      return;
    }
    state.signedInAccount = true;
    state.discordConnected = Boolean(user);
    if (!account.clanName) {
      window.location.replace("/profile/complete");
      return;
    }

    document.body.classList.add("is-authenticated");
    elements.dashboardLink.firstChild.nodeValue = "Dashboard ";
    show(elements.accountAccess, true);
    const displayName = account.fullName || account.displayName || user?.globalName ||
      user?.username || account.email?.split("@")[0] || "Operator";
    elements.userName.textContent = displayName;
    elements.welcomeName.textContent = displayName;
    elements.welcomeClanName.textContent = account.clanName;
    elements.profileFullName.textContent = account.fullName || account.displayName || "";
    elements.profileEmail.textContent = account.email || "";
    elements.profileFullNameInput.value = account.fullName || account.displayName || "";
    elements.profileClanName.value = account.clanName;
    setProfileTimezone(account.timezone || "auto");
    show(elements.dashboard, true);
    show(elements.logout, true);
    enableClanWarVideoPreview();
    const pendingProfileChanges = await requestJson("/api/profile/pending");
    if (pendingProfileChanges.emailChange) {
      const { stage, email } = pendingProfileChanges.emailChange;
      state.emailChangeStage = stage;
      elements.newAccountEmail.value = email || "";
      elements.newAccountEmail.disabled = true;
      elements.emailChangeCode.required = true;
      elements.emailChangeCopy.textContent = stage === "current-email"
        ? "Enter the code sent to your current email. After that, we will send another code to your new email."
        : `Enter the new code sent to ${email}.`;
      show(elements.emailChangeVerification, true);
      elements.emailChangeSend.disabled = true;
    }
    if (pendingProfileChanges.passwordChange) {
      elements.newAccountPassword.disabled = true;
      elements.passwordChangeCode.required = true;
      elements.passwordChangeCopy.textContent = "Enter the 6-digit code sent to your account email.";
      show(elements.passwordChangeVerification, true);
      elements.passwordChangeSend.disabled = true;
    }
    const providers = await requestJson("/auth/providers");
    state.canManageDiscordServers = Boolean(user && providers.discordServerManagement);
    show(elements.emailTestPanel, Boolean(user && providers.emailTestAdmin));
    show(elements.connectDiscord, false);
    show(elements.serverPanel, state.canManageDiscordServers);
    show(elements.dashboardIntegrationNote, Boolean(user && !state.canManageDiscordServers));
    if (user && !state.canManageDiscordServers) {
      elements.dashboardIntegrationNote.textContent =
        "Discord sign-in succeeded. Server management is unavailable in this website-only development environment.";
    }
    if (!user) {
      elements.connectDiscordCopy.textContent = providers.discord
        ? "Connect Discord to manage settings for servers where TACTIOPBOT is installed."
        : "Discord sign-in is not configured for this website. Your profile and other account features remain available.";
      if (!providers.discord) {
        elements.connectDiscordButton.removeAttribute("href");
        elements.connectDiscordButton.setAttribute("aria-disabled", "true");
        elements.connectDiscordButton.title = "Discord sign-in is not configured for this website";
      } else {
        elements.connectDiscordButton.href = "/auth/discord?link=1";
        elements.connectDiscordButton.removeAttribute("aria-disabled");
        elements.connectDiscordButton.removeAttribute("title");
      }
      show(elements.empty, false);
      show(elements.settingsPanel, false);
      return;
    }
    if (!state.canManageDiscordServers) {
      show(elements.empty, false);
      show(elements.settingsPanel, false);
      return;
    }

    const [{ guilds }, { languages }] = await Promise.all([
      requestJson("/api/guilds"),
      requestJson("/api/languages"),
    ]);
    state.guilds = guilds;
    state.languages = languages;
    setGuildOptions(guilds);
    show(elements.empty, guilds.length === 0);
    elements.guildSelect.disabled = guilds.length === 0;
    if (guilds.length > 0) {
      elements.guildSelect.value = guilds[0].id;
      await loadGuildSettings(guilds[0].id);
    }
  } catch (error) {
    if (state.signedInAccount) {
      document.body.classList.add("is-authenticated");
      show(elements.accountAccess, true);
      show(elements.login, false);
      show(elements.dashboard, true);
      show(elements.logout, true);
      show(elements.serverPanel, false);
      show(elements.dashboardIntegrationNote, true);
      elements.dashboardIntegrationNote.className = "feedback feedback-error";
      elements.dashboardIntegrationNote.textContent =
        error.message || "Your dashboard data could not be loaded.";
      if (state.discordConnected && error.status === 401) {
        show(elements.connectDiscord, true);
        elements.connectDiscordCopy.textContent = "Your account is signed in, but Discord access needs to be reconnected.";
        elements.connectError.textContent = "Reconnect Discord to restore server access.";
        show(elements.connectError, true);
        elements.connectDiscordButton.href = "/auth/discord?link=1";
      }
      return;
    }
    show(elements.accountAccess, true);
    if (error.status === 401) {
      show(elements.login, true);
      await loadProviderStatus();
      return;
    }
    show(elements.login, true);
    await loadProviderStatus();
    if (!elements.authNotice.textContent) {
      showAuthError(error.message || "The dashboard could not connect to its server.");
    }
  } finally {
    show(elements.loading, false);
  }
}

for (const startLink of document.querySelectorAll("[data-show-auth]")) {
  startLink.addEventListener("click", (event) => {
    event.preventDefault();
    state.authSectionOpened = true;
    show(elements.accountAccess, true);
    if (state.signedInAccount) {
      show(elements.dashboard, true);
    } else {
      show(elements.login, true);
      show(elements.loading, false);
    }
    window.history.replaceState(null, "", `${window.location.pathname}#account-access`);
    elements.accountAccess.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

elements.googleButton.addEventListener("click", () => {
  if (!elements.googleButton.disabled) window.location.assign("/auth/google");
});

elements.discordButton.addEventListener("click", () => {
  if (!elements.discordButton.disabled) window.location.assign("/auth/discord");
});

elements.showRegistration.addEventListener("click", () => {
  show(elements.loginForm, false);
  show(elements.showRegistration, false);
  show(elements.registrationForm, true);
  show(elements.showLogin, true);
  elements.registrationFullName.focus();
});

elements.showLogin.addEventListener("click", () => {
  show(elements.registrationForm, false);
  show(elements.showLogin, false);
  show(elements.loginForm, true);
  show(elements.showRegistration, true);
  elements.loginEmail.focus();
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginSubmit.disabled = true;
  show(elements.loginFormError, false);
  try {
    const response = await requestJson("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: elements.loginEmail.value,
        password: elements.loginPassword.value,
      }),
    });
    beginEmailVerification("login", response.email);
    elements.loginPassword.value = "";
  } catch (error) {
    elements.loginFormError.textContent = error.message || "Sign-in failed.";
    show(elements.loginFormError, true);
    elements.loginSubmit.disabled = false;
  }
});

elements.registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.registrationSubmit.disabled = true;
  show(elements.registrationError, false);
  try {
    const response = await requestJson("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: elements.registrationFullName.value,
        clanName: elements.registrationClanName.value,
        email: elements.registrationEmail.value,
        password: elements.registrationPassword.value,
      }),
    });
    beginEmailVerification("register", response.email);
    elements.registrationPassword.value = "";
  } catch (error) {
    elements.registrationError.textContent = error.message || "Account registration failed.";
    show(elements.registrationError, true);
    elements.registrationSubmit.disabled = false;
  }
});

elements.emailVerificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.pendingEmailAction) return;
  elements.emailVerificationSubmit.disabled = true;
  show(elements.emailVerificationError, false);
  try {
    const path = state.pendingEmailAction === "register"
      ? "/auth/register/verify"
      : "/auth/login/verify";
    await requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: elements.emailVerificationCode.value }),
    });
    window.location.assign("/");
  } catch (error) {
    elements.emailVerificationError.textContent = error.message || "The code could not be verified.";
    elements.emailVerificationError.className = "feedback feedback-error";
    show(elements.emailVerificationError, true);
    elements.emailVerificationSubmit.disabled = false;
  }
});

elements.emailVerificationResend.addEventListener("click", async () => {
  if (!state.pendingEmailAction) return;
  elements.emailVerificationResend.disabled = true;
  show(elements.emailVerificationError, false);
  try {
    await requestJson(`/auth/${state.pendingEmailAction}/resend`, { method: "POST" });
    elements.emailVerificationError.textContent = "A new code was sent to your email.";
    elements.emailVerificationError.className = "feedback feedback-success";
    show(elements.emailVerificationError, true);
  } catch (error) {
    elements.emailVerificationError.textContent = error.message || "A new code could not be sent.";
    elements.emailVerificationError.className = "feedback feedback-error";
    show(elements.emailVerificationError, true);
  } finally {
    elements.emailVerificationResend.disabled = false;
  }
});

elements.emailVerificationBack.addEventListener("click", async () => {
  if (!state.pendingEmailAction) return;
  const action = state.pendingEmailAction;
  elements.emailVerificationBack.disabled = true;
  try {
    await requestJson("/auth/verification/cancel", { method: "POST" });
  } catch (error) {
    elements.emailVerificationError.textContent = error.message || "The verification could not be canceled.";
    elements.emailVerificationError.className = "feedback feedback-error";
    show(elements.emailVerificationError, true);
    elements.emailVerificationBack.disabled = false;
    return;
  }
  show(elements.emailVerificationForm, false);
  show(elements.loginForm, action === "login");
  show(elements.registrationForm, action === "register");
  show(elements.showRegistration, action === "login");
  show(elements.showLogin, action === "register");
  elements.loginSubmit.disabled = false;
  elements.registrationSubmit.disabled = false;
  state.pendingEmailAction = null;
  elements.emailVerificationBack.disabled = false;
});

document.querySelector('[data-feature="missions"]').addEventListener("click", () => {
  if (state.canManageDiscordServers) {
    elements.serverPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (state.guilds.length > 0) elements.settingsPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (state.signedInAccount && !state.discordConnected) {
    show(elements.connectDiscord, true);
    elements.connectDiscord.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  elements.dashboardIntegrationNote.textContent =
    "Discord server access is not available in this environment. No mission settings were changed.";
  show(elements.dashboardIntegrationNote, true);
  elements.dashboardIntegrationNote.scrollIntoView({ behavior: "smooth", block: "center" });
});

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.profileSubmit.disabled = true;
  show(elements.profileFeedback, false);
  try {
    const response = await requestJson("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: elements.profileFullNameInput.value,
        clanName: elements.profileClanName.value,
        timezone: elements.profileTimezoneMode.value === "auto"
          ? "auto"
          : elements.profileTimezone.value,
      }),
    });
    elements.profileFullName.textContent = response.account.fullName || "";
    elements.welcomeName.textContent = response.account.fullName || "Operator";
    elements.userName.textContent = response.account.fullName || "";
    elements.profileClanName.value = response.account.clanName;
    setProfileTimezone(response.account.timezone || "auto");
    window.dispatchEvent(new Event("mission-timezone-change"));
    elements.profileFeedback.textContent = "Your profile was updated.";
    elements.profileFeedback.className = "feedback feedback-success";
    show(elements.profileFeedback, true);
  } catch (error) {
    elements.profileFeedback.textContent = error.message || "Your clan name could not be updated.";
    elements.profileFeedback.className = "feedback feedback-error";
    show(elements.profileFeedback, true);
  } finally {
    elements.profileSubmit.disabled = false;
  }
});

populateTimezoneOptions();
elements.profileTimezoneMode.addEventListener("change", () => {
  if (elements.profileTimezoneMode.value === "manual" && !elements.profileTimezone.value) {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    elements.profileTimezone.value = detectedTimezone;
  }
  show(elements.profileTimezoneFields, elements.profileTimezoneMode.value === "manual");
});
elements.profileTimezoneSearch.addEventListener("input", filterTimezoneOptions);

function setProfileSecurityFeedback(element, message, kind = "error") {
  element.textContent = message;
  element.className = `feedback feedback-${kind}`;
  show(element, true);
}

elements.emailChangeSend.addEventListener("click", async () => {
  elements.emailChangeSend.disabled = true;
  show(elements.emailChangeFeedback, false);
  try {
    await requestJson("/api/profile/email/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: elements.newAccountEmail.value }),
    });
    state.emailChangeStage = "current-email";
    elements.newAccountEmail.disabled = true;
    elements.emailChangeCopy.textContent = "Enter the code sent to your current email. After that, we will send another code to your new email.";
    elements.emailChangeCode.value = "";
    elements.emailChangeCode.required = true;
    show(elements.emailChangeVerification, true);
    elements.emailChangeCode.focus();
    setProfileSecurityFeedback(elements.emailChangeFeedback, "Check your current email inbox.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.emailChangeFeedback, error.message || "A verification code could not be sent.");
    elements.emailChangeSend.disabled = false;
  }
});

elements.emailChangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.emailChangeVerify.disabled = true;
  show(elements.emailChangeFeedback, false);
  try {
    const response = await requestJson("/api/profile/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: elements.emailChangeCode.value }),
    });
    if (response.stage === "new-email") {
      state.emailChangeStage = "new-email";
      elements.emailChangeCopy.textContent = `Enter the new code sent to ${elements.newAccountEmail.value}.`;
      elements.emailChangeCode.value = "";
      elements.emailChangeCode.required = true;
      setProfileSecurityFeedback(elements.emailChangeFeedback, "Current email verified. Now check your new email inbox.", "success");
      elements.emailChangeCode.focus();
      return;
    }

    elements.profileEmail.textContent = response.account.email || "";
    elements.newAccountEmail.value = "";
    elements.newAccountEmail.disabled = false;
    elements.emailChangeCode.value = "";
    elements.emailChangeCode.required = false;
    state.emailChangeStage = "idle";
    show(elements.emailChangeVerification, false);
    elements.emailChangeSend.disabled = false;
    setProfileSecurityFeedback(elements.emailChangeFeedback, "Your email address was changed.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.emailChangeFeedback, error.message || "Your email address could not be changed.");
  } finally {
    elements.emailChangeVerify.disabled = false;
  }
});

elements.emailChangeResend.addEventListener("click", async () => {
  elements.emailChangeResend.disabled = true;
  try {
    await requestJson("/api/profile/email/resend", { method: "POST" });
    setProfileSecurityFeedback(elements.emailChangeFeedback, "A new verification code was sent.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.emailChangeFeedback, error.message || "A new code could not be sent.");
  } finally {
    elements.emailChangeResend.disabled = false;
  }
});

elements.passwordChangeSend.addEventListener("click", async () => {
  elements.passwordChangeSend.disabled = true;
  show(elements.passwordChangeFeedback, false);
  try {
    await requestJson("/api/profile/password/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: elements.newAccountPassword.value }),
    });
    elements.newAccountPassword.disabled = true;
    elements.passwordChangeCopy.textContent = "Enter the 6-digit code sent to your account email.";
    elements.passwordChangeCode.value = "";
    elements.passwordChangeCode.required = true;
    show(elements.passwordChangeVerification, true);
    elements.passwordChangeCode.focus();
    setProfileSecurityFeedback(elements.passwordChangeFeedback, "Check your account email inbox.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.passwordChangeFeedback, error.message || "A verification code could not be sent.");
    elements.passwordChangeSend.disabled = false;
  }
});

elements.passwordChangeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.passwordChangeVerify.disabled = true;
  show(elements.passwordChangeFeedback, false);
  try {
    await requestJson("/api/profile/password/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: elements.passwordChangeCode.value }),
    });
    elements.newAccountPassword.value = "";
    elements.newAccountPassword.disabled = false;
    elements.passwordChangeCode.value = "";
    elements.passwordChangeCode.required = false;
    show(elements.passwordChangeVerification, false);
    elements.passwordChangeSend.disabled = false;
    setProfileSecurityFeedback(elements.passwordChangeFeedback, "Your password was changed.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.passwordChangeFeedback, error.message || "Your password could not be changed.");
  } finally {
    elements.passwordChangeVerify.disabled = false;
  }
});

elements.passwordChangeResend.addEventListener("click", async () => {
  elements.passwordChangeResend.disabled = true;
  try {
    await requestJson("/api/profile/password/resend", { method: "POST" });
    setProfileSecurityFeedback(elements.passwordChangeFeedback, "A new verification code was sent.", "success");
  } catch (error) {
    setProfileSecurityFeedback(elements.passwordChangeFeedback, error.message || "A new code could not be sent.");
  } finally {
    elements.passwordChangeResend.disabled = false;
  }
});

elements.accountLogout.addEventListener("click", async () => {
  elements.accountLogout.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST" });
    window.location.reload();
  } catch (error) {
    elements.connectError.textContent = error.message || "Could not sign out.";
    show(elements.connectError, true);
    elements.accountLogout.disabled = false;
  }
});

elements.guildSelect.addEventListener("change", () => {
  loadGuildSettings(elements.guildSelect.value);
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentGuildId) return;
  elements.saveButton.disabled = true;
  show(elements.feedback, false);

  try {
    const response = await requestJson(
      `/api/guilds/${encodeURIComponent(state.currentGuildId)}/clan-mission-notification`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: elements.channelSelect.value,
          roleId: elements.roleSelect.value || null,
          enabled: elements.enabledToggle.checked,
          language: elements.languageSelect.value,
        }),
      }
    );
    state.config = response.settings;
    elements.badge.textContent = response.settings.enabled ? "Enabled" : "Disabled";
    elements.badge.classList.toggle("is-enabled", response.settings.enabled);
    show(elements.deleteButton, true);
    setFeedback("Settings saved. The Discord bot will use these shared settings.", "success");
  } catch (error) {
    setFeedback(error.message || "Settings could not be saved.", "error");
  } finally {
    elements.saveButton.disabled = false;
  }
});

elements.deleteButton.addEventListener("click", async () => {
  if (!state.currentGuildId || !window.confirm("Delete this server's clan mission notification settings?")) return;
  elements.deleteButton.disabled = true;

  try {
    const response = await requestJson(
      `/api/guilds/${encodeURIComponent(state.currentGuildId)}/clan-mission-notification`,
      { method: "DELETE" }
    );
    state.config = null;
    elements.badge.textContent = "Not configured";
    elements.badge.classList.remove("is-enabled");
    elements.enabledToggle.checked = true;
    elements.roleSelect.value = "";
    show(elements.deleteButton, false);
    setFeedback(response.deleted ? "Settings deleted." : "There were no settings to delete.", "success");
  } catch (error) {
    setFeedback(error.message || "Settings could not be deleted.", "error");
  } finally {
    elements.deleteButton.disabled = false;
  }
});

elements.emailTestButton.addEventListener("click", async () => {
  elements.emailTestButton.disabled = true;
  show(elements.emailTestFeedback, false);
  try {
    await requestJson("/api/admin/email/test", { method: "POST" });
    elements.emailTestFeedback.textContent = "The test email was sent to your verified account email.";
    elements.emailTestFeedback.className = "feedback feedback-success";
    show(elements.emailTestFeedback, true);
  } catch (error) {
    elements.emailTestFeedback.textContent = error.message || "The test email could not be sent.";
    elements.emailTestFeedback.className = "feedback feedback-error";
    show(elements.emailTestFeedback, true);
  } finally {
    elements.emailTestButton.disabled = false;
  }
});

elements.logout.addEventListener("click", async () => {
  elements.logout.disabled = true;
  try {
    await requestJson("/auth/logout", { method: "POST" });
    window.location.reload();
  } catch (error) {
    elements.logout.disabled = false;
    show(elements.dashboard, true);
    setFeedback(error.message || "Could not sign out.", "error");
  }
});

initializeDashboard();

function enableClanWarVideoPreview() {
  const card = document.querySelector(".clan-war-feature");
  const video = card?.querySelector(".feature-preview-video");
  const source = video?.querySelector("source[data-src]");
  if (!card || !video || !source || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const start = () => {
    source.src = source.dataset.src;
    source.removeAttribute("data-src");
    video.addEventListener("canplay", () => card.classList.add("is-video-ready"), { once: true });
    video.load();
    video.play().catch(() => video.pause());
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    }, { rootMargin: "100px" });
    observer.observe(card);
  } else {
    start();
  }
}

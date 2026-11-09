document.documentElement.classList.add("js");

const menuToggle = document.querySelector("#menu-toggle");
const navigation = document.querySelector("#primary-navigation");

function closeNavigation() {
  if (!menuToggle || !navigation) return;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
  navigation.classList.remove("is-open");
}

if (menuToggle && navigation) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
    navigation.classList.toggle("is-open", !isOpen);
  });

  navigation.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) closeNavigation();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigation();
  });
}

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  for (const item of revealItems) revealObserver.observe(item);
} else {
  for (const item of revealItems) item.classList.add("is-visible");
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const constrainedPlayback = window.matchMedia("(max-width: 640px)").matches ||
  reducedMotion ||
  navigator.connection?.saveData === true;

function loadVideo(video) {
  const source = video.querySelector("source[data-src]");
  if (!source) return;
  source.src = source.dataset.src;
  source.removeAttribute("data-src");
  video.load();
  video.play().catch(() => video.pause());
}

if (!constrainedPlayback) {
  const heroVideo = document.querySelector(".hero-video");
  if (heroVideo) loadVideo(heroVideo);

  const finalVideo = document.querySelector(".final-video");
  if (finalVideo && "IntersectionObserver" in window) {
    const videoObserver = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      loadVideo(finalVideo);
      observer.disconnect();
    }, { rootMargin: "200px" });
    videoObserver.observe(finalVideo);
  }
}

const wallpapers = Array.from(document.querySelectorAll(".wallpaper-rotator img"));
if (!reducedMotion && wallpapers.length > 1) {
  let activeIndex = wallpapers.findIndex((image) => image.classList.contains("is-active"));
  window.setInterval(() => {
    wallpapers[activeIndex].classList.remove("is-active");
    activeIndex = (activeIndex + 1) % wallpapers.length;
    wallpapers[activeIndex].classList.add("is-active");
  }, 21_000);
}

const featureStatus = document.querySelector("#feature-status");
const featureMessages = {
  search: "Search for ID is not connected to an authorized player-search service yet.",
};

for (const featureButton of document.querySelectorAll("[data-feature]")) {
  featureButton.addEventListener("click", () => {
    const message = featureMessages[featureButton.dataset.feature];
    if (message && featureStatus) featureStatus.textContent = message;
  });
}

// Floating AI Assistant
const aiButton = document.querySelector("#ai-assistant-button");
const aiPanel = document.querySelector("#ai-assistant-panel");
const aiClose = document.querySelector("#ai-assistant-close");
const aiForm = document.querySelector("#ai-assistant-form");
const aiInput = document.querySelector("#ai-assistant-input");
const aiMessages = document.querySelector("#ai-assistant-messages");
const aiQuickActions = document.querySelectorAll(".ai-quick-action");

const aiResponses = {
  missions: "Clan Missions reset daily. Use the Mission Reminder settings in Bot Chat to configure notifications for your Discord server. You can set the channel, role, and language.",
  "clan-war": "The Clan War Manager lets you build balanced 5v5 teams. Enter 10 players with their ranks, mark exactly 2 leaders, and use Auto Balance to find the optimal split with minimum rank difference.",
  settings: "In Settings, you can update your timezone for accurate mission reset times, change your profile name and clan name, and manage connected accounts (Google, Discord, Email).",
  help: "TACTIOPBOT helps you manage Tacticool clan operations: mission reminders, clan wars, and server settings. Use the dashboard cards to navigate to each feature.",
  default: "I'm here to help with TACTIOPBOT features. Ask me about clan missions, clan wars, settings, or anything else!"
};

function addAIMessage(content, isUser = false) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `ai-message ${isUser ? "ai-message-user" : "ai-message-bot"}`;
  messageDiv.innerHTML = `
    <div class="ai-message-avatar">
      <img src="/media/images/logos/tactiopbot-logo.png.jpeg" alt="">
    </div>
    <div class="ai-message-content">
      <p>${content}</p>
    </div>
  `;
  aiMessages.appendChild(messageDiv);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function toggleAIPanel() {
  const isOpen = aiPanel.classList.toggle("hidden");
  aiButton.setAttribute("aria-expanded", String(!isOpen));
  if (!isOpen) {
    aiInput.focus();
  }
}

function sendAIMessage() {
  const text = aiInput.value.trim();
  if (!text) return;
  addAIMessage(text, true);
  aiInput.value = "";
  
  // Simulate bot response
  const lowerText = text.toLowerCase();
  let response = aiResponses.default;
  for (const [key, value] of Object.entries(aiResponses)) {
    if (lowerText.includes(key)) {
      response = value;
      break;
    }
  }
  
  setTimeout(() => {
    addAIMessage(response);
  }, 500);
}

if (aiButton && aiPanel && aiClose && aiForm && aiInput && aiMessages) {
  aiButton.addEventListener("click", toggleAIPanel);
  aiClose.addEventListener("click", () => {
    aiPanel.classList.add("hidden");
    aiButton.setAttribute("aria-expanded", "false");
  });
  
  aiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendAIMessage();
  });
  
  aiQuickActions.forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      addAIMessage(btn.textContent, true);
      setTimeout(() => {
        addAIMessage(aiResponses[action] || aiResponses.default);
      }, 400);
    });
  });
  
  // Close panel when clicking outside
  document.addEventListener("click", (e) => {
    if (!aiPanel.classList.contains("hidden") && 
        !aiPanel.contains(e.target) && 
        !aiButton.contains(e.target)) {
      aiPanel.classList.add("hidden");
      aiButton.setAttribute("aria-expanded", "false");
    }
  });
  
  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !aiPanel.classList.contains("hidden")) {
      aiPanel.classList.add("hidden");
      aiButton.setAttribute("aria-expanded", "false");
    }
  });
}

// Close AI panel when music player opens
const musicPlayer = document.querySelector(".music-player");
if (musicPlayer) {
  musicPlayer.addEventListener("toggle", () => {
    if (musicPlayer.open && aiPanel && !aiPanel.classList.contains("hidden")) {
      aiPanel.classList.add("hidden");
      aiButton.setAttribute("aria-expanded", "false");
    }
  });
}

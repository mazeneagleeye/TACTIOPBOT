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

const musicPlayer = document.querySelector(".music-player");
const musicAudio = document.querySelector("#music-audio");
const musicTrack = document.querySelector("#music-track");
const musicStatus = document.querySelector("#music-status");

function selectMusicTrack() {
  if (!musicAudio || !musicTrack || !musicStatus) return;
  const trackNumber = Number(musicTrack.value);
  if (!Number.isInteger(trackNumber) || trackNumber < 1 || trackNumber > 9) return;
  const shouldResume = !musicAudio.paused;
  musicAudio.src = `/media/music/music${trackNumber}.mp4`;
  musicAudio.load();
  musicStatus.textContent = `Track ${String(trackNumber).padStart(2, "0")} selected. Press play to listen.`;
  if (shouldResume) {
    musicAudio.play().catch(() => {
      musicStatus.textContent = "Playback was blocked. Press play to try again.";
    });
  }
}

if (musicPlayer && musicAudio && musicTrack && musicStatus) {
  musicPlayer.addEventListener("toggle", () => {
    if (musicPlayer.open && !musicAudio.src) selectMusicTrack();
  });
  musicTrack.addEventListener("change", selectMusicTrack);
  musicAudio.addEventListener("playing", () => {
    musicStatus.textContent = `Playing track ${String(musicTrack.value).padStart(2, "0")}.`;
  });
  musicAudio.addEventListener("pause", () => {
    musicStatus.textContent = "Playback paused.";
  });
  musicAudio.addEventListener("error", () => {
    musicStatus.textContent = "This track could not be played in this browser.";
  });
}

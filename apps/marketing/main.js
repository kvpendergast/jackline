const THEME_KEY = "jackline-marketing-theme";
const LOGO_KEY = "jackline-marketing-logo";

const LOGO_SYMBOLS = {
  solid: "#mark-solid",
  line: "#mark-line",
  tile: "#mark-tile",
  word: null,
};

function setLogo(variant) {
  const key = LOGO_SYMBOLS[variant] !== undefined ? variant : "solid";
  const symbol = LOGO_SYMBOLS[key];
  localStorage.setItem(LOGO_KEY, key);

  document.documentElement.dataset.logo = key;

  document.querySelectorAll(".logo-use use").forEach((use) => {
    if (symbol) use.setAttribute("href", symbol);
  });

  document.querySelectorAll(".brand").forEach((brand) => {
    brand.dataset.logoMode = key;
  });

  document.querySelectorAll(".logo-variant-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.logo === key);
  });

  document.querySelectorAll("[data-logo-card]").forEach((card) => {
    card.classList.toggle("is-featured", card.dataset.logoCard === key);
  });
}

function initLogo() {
  const stored = localStorage.getItem(LOGO_KEY);
  const variant =
    stored === "line" || stored === "tile" || stored === "word" || stored === "solid"
      ? stored
      : "solid";
  setLogo(variant);

  document.querySelectorAll(".logo-variant-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLogo(btn.dataset.logo ?? "solid"));
  });

  document.querySelectorAll("[data-logo-card]").forEach((card) => {
    card.addEventListener("click", () => setLogo(card.dataset.logoCard ?? "solid"));
    card.style.cursor = "pointer";
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.theme === theme);
  });
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme = stored === "deck" ? "deck" : "fog";
  setTheme(theme);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme ?? "fog"));
  });
}

function initPreviewTabs() {
  const tabs = document.querySelectorAll(".preview-tab");
  const panels = document.querySelectorAll("[data-preview-panel]");
  const frame = document.querySelector(".preview-frame");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const preview = tab.dataset.preview;
      if (!preview) return;

      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });

      panels.forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.previewPanel !== preview);
      });

      frame?.setAttribute("data-active-preview", preview);
    });
  });
}

initTheme();
initPreviewTabs();
initLogo();

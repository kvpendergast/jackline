const THEME_KEY = "jackline-marketing-theme";

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

/**
 * Panel-level loading: full overlay for cold load only; inline sync for background refresh.
 */

export function setPanelLoading(panelEl, { active, initial = false } = {}) {
  if (!panelEl) return;
  const list = panelEl.querySelector(".split-list");
  const overlay = panelEl.querySelector(".panel-loading-overlay");
  if (!list || !overlay) return;

  const showOverlay = Boolean(active && initial);
  list.classList.toggle("panel-is-loading", showOverlay);
  overlay.hidden = !showOverlay;

  const label = overlay.querySelector(".panel-loading-label");
  if (label) {
    label.textContent = "Loading…";
  }
}

export function setPanelSyncing(panelEl, active) {
  if (!panelEl) return;
  const indicator = panelEl.querySelector(".panel-sync-indicator");
  if (indicator) {
    indicator.hidden = !active;
    indicator.classList.toggle("panel-sync-indicator--active", Boolean(active));
    indicator.setAttribute("aria-hidden", active ? "false" : "true");
    indicator.setAttribute("aria-label", active ? "Syncing" : "");
    indicator.title = active ? "Syncing" : "";
  }
  panelEl.classList.toggle("panel-is-syncing", Boolean(active));
}

export function clearPanelLoadState(panelEl) {
  setPanelLoading(panelEl, { active: false });
  setPanelSyncing(panelEl, false);
}

export function setPanelBusy(panelEl, busy, { disableTabs = false } = {}) {
  if (!panelEl) return;

  panelEl.setAttribute("aria-busy", String(Boolean(busy)));

  const filtersForm = panelEl.querySelector("form.filters");
  if (filtersForm) {
    filtersForm.querySelectorAll("input, select, button").forEach((el) => {
      el.disabled = busy;
    });
  }

  if (busy) {
    panelEl.querySelectorAll(".pagination button").forEach((btn) => {
      btn.disabled = true;
    });
  }

  if (disableTabs) {
    document.querySelectorAll(".app-tab").forEach((tab) => {
      tab.disabled = Boolean(busy);
    });
  } else if (!busy) {
    document.querySelectorAll(".app-tab").forEach((tab) => {
      tab.disabled = false;
    });
  }
}

export function enableAppTabs() {
  document.querySelectorAll(".app-tab").forEach((tab) => {
    tab.disabled = false;
  });
}

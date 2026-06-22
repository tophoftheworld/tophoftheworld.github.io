(function initHubNav() {
  function currentSection() {
    const p = window.location.pathname;
    if (p.startsWith("/leads")) return "leads";
    if (p.includes("workshop")) return "workshops";
    if (p.startsWith("/shopify")) return "shopify";
    return "";
  }

  function enhanceLogo(container) {
    if (!container || container.dataset.hubNavReady === "1") return;
    const img = container.querySelector("img.logo, img.hub-nav-logo-img");
    if (!img) return;

    const wrap = document.createElement("div");
    wrap.className = "hub-nav-logo-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hub-nav-logo-btn";
    btn.setAttribute("aria-label", "Open Matchanese apps menu");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.title = "Matchanese apps";

    const menu = document.createElement("div");
    menu.className = "hub-nav-menu";
    menu.hidden = true;
    menu.innerHTML = `
      <a href="/shopify/" data-hub="shopify">Shopify Orders</a>
      <a href="/workshops" data-hub="workshops">Workshops</a>
      <a href="/leads/" data-hub="leads">Service leads &amp; Inbox</a>
    `;

    const section = currentSection();
    menu.querySelectorAll("a").forEach((link) => {
      if (link.dataset.hub === section) {
        link.setAttribute("aria-current", "page");
      }
    });

    img.classList.add("hub-nav-logo-img");
    btn.appendChild(img);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    container.replaceChildren(wrap);
    container.dataset.hubNavReady = "1";

    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menu.hidden) {
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      } else {
        closeMenu();
      }
    });

    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  document.querySelectorAll("[data-hub-nav-logo]").forEach(enhanceLogo);
})();

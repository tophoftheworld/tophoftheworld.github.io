/**
 * Shared modern invoice page renderer (customer + staff live preview).
 * Not a PDF/A4 document layout.
 */
(function (global) {
  const MOBILE_BAR_COFFEE_ADDON_FEE = 3500;
  const MOBILE_BAR_TRANSPORT_ADDONS = {
    none: { label: "None", fee: 0 },
    laguna: { label: "Laguna", fee: 3000 },
    bulacan: { label: "Bulacan", fee: 3000 },
    tagaytay: { label: "Tagaytay", fee: 5000 },
    pampanga: { label: "Pampanga", fee: 5000 }
  };

  const PAYMENT_METHODS = [
    { method: "BDO", name: "MATCHANESE INC", number: "000251640035" },
    { method: "Unionbank", name: "Cristopher David", number: "109420972821" },
    { method: "BPI", name: "Cristopher David", number: "0829677495" },
    {
      method: "GCash",
      name: "Cristopher David",
      number: "09496471857",
      wallet: true,
      qrImage: "img/qr/gcash.png"
    },
    {
      method: "Maya",
      name: "Cristopher David",
      number: "09496471857",
      wallet: true,
      qrImage: "img/qr/maya.png"
    },
    {
      method: "GoTyme",
      name: "Cristopher David",
      number: "016694689311",
      wallet: true,
      qrImage: "img/qr/gotyme.png"
    }
  ];

  function copyIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="11" height="13" rx="1.25"/><rect x="4" y="8" width="11" height="13" rx="1.25"/></svg>`;
  }

  function qrIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01"/><path d="M18 14h.01"/><path d="M14 18h.01"/><path d="M18 18h.01"/><path d="M21 18v3h-3"/><path d="M21 14v1"/></svg>`;
  }

  function renderCopyableLine(label, value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return `<div class="inv-pay-line">
      <span class="inv-pay-line-text">${escapeHtml(text)}</span>
      <button type="button" class="inv-pay-copy" data-copy="${escapeHtml(text)}" title="Copy ${escapeHtml(label)}" aria-label="Copy ${escapeHtml(label)}">${copyIconSvg()}</button>
    </div>`;
  }

  function renderPayMethodsHtml() {
    return `<div class="inv-pay-grid">
      ${PAYMENT_METHODS.map((p) => {
        const qrBtn =
          p.wallet && p.qrImage
            ? `<button type="button" class="inv-pay-qr" data-qr-src="${escapeHtml(p.qrImage)}" data-qr-label="${escapeHtml(p.method)}" title="${escapeHtml(p.method)} QR" aria-label="Show ${escapeHtml(p.method)} QR">${qrIconSvg()}</button>`
            : "";
        return `<div class="inv-pay-item${p.wallet ? " has-qr" : ""}">
          <div class="inv-pay-body">
            <div class="inv-pay-method">${escapeHtml(p.method)}</div>
            ${renderCopyableLine("account name", p.name)}
            ${renderCopyableLine("account number", p.number)}
          </div>
          ${qrBtn}
        </div>`;
      }).join("")}
    </div>
    <p class="inv-pay-note">Online card payment via PayPal is available on request.</p>`;
  }

  const MOBILE_BAR_CHOICE_CATALOG = [
    "Strawberry Matchanese Latte",
    "Matchanese Seasalt Latte",
    "Spanish Matchanese Latte",
    "Matchanese Sunrise",
    "Matchanese Coconut",
    "Earl Grey Matchanese Latte",
    "Salted Caramel Matchanese Latte",
    "White Chocolate Matchanese Latte",
    "Blueberry Matchanese Latte",
    "Peach Mango Matchanese Latte",
    "Americano",
    "Kyoto Latte",
    "Spanish Latte",
    "Matchanese Espresso",
    "Seasalt Latte"
  ];

  const COFFEE_DRINKS = [
    "Americano",
    "Kyoto Latte",
    "Spanish Latte",
    "Matchanese Espresso",
    "Seasalt Latte"
  ];

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCurrency(amount) {
    return parseFloat(amount || 0)
      .toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const parts = String(dateString).slice(0, 10).split("-");
    if (parts.length === 3) {
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        });
      }
    }
    const date = new Date(dateString);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
    return String(dateString);
  }

  function isWorkshopEventType(eventType) {
    return eventType === "matcha_workshop" || eventType === "mochi_workshop";
  }

  function isWorkshopItem(item) {
    return !!(item && (item.isWorkshop || isWorkshopEventType(item.eventType)));
  }

  function isPackageVisible(item) {
    if (!item) return false;
    if (isWorkshopItem(item)) return true;
    return !!(item.packageType && item.packageType !== "custom");
  }

  function getInvoiceItemPricing(item) {
    if (isWorkshopItem(item)) {
      const paxMatch = String(item.cups || "").match(/\d+/);
      const qty = item.quantity || (paxMatch ? parseInt(paxMatch[0], 10) : 0);
      const unitCost =
        item.unitCost != null
          ? parseFloat(item.unitCost)
          : qty > 0
            ? (item.unitPrice || 0) / qty
            : 0;
      const subtotal = item.unitPrice != null ? item.unitPrice : unitCost * qty;
      return { unitCost, qty, subtotal };
    }
    return {
      unitCost: item.unitPrice || 0,
      qty: 1,
      subtotal: item.unitPrice || 0
    };
  }

  function getPackageAddonLineItems(item) {
    if (isWorkshopItem(item) || !item.packageType || item.packageType === "custom") return [];
    const addons = [];
    if (item.coffeeAddOn) {
      addons.push({ name: "Coffee Add-On", quantity: 1, price: MOBILE_BAR_COFFEE_ADDON_FEE });
    }
    const key = String(item.transportAddOn || "none");
    const transport = MOBILE_BAR_TRANSPORT_ADDONS[key];
    if (key !== "none" && transport && transport.fee > 0) {
      addons.push({
        name: `Transportation — ${transport.label}`,
        quantity: 1,
        price: transport.fee
      });
    }
    return addons;
  }

  function resolvePackageCount(item) {
    const n = parseInt(item?.count, 10);
    if (n > 0) return n;
    if (item?.numberOfPax === "custom") return parseInt(item.customCups, 10) || 0;
    const nop = parseInt(item?.numberOfPax, 10);
    if (nop > 0) return nop;
    const match = String(item?.cups || "").match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  function cupsLabel(item) {
    const n = resolvePackageCount(item);
    if (!n) return "";
    if (isWorkshopItem(item) || item.countLabel === "guests" || item.countLabel === "participants") {
      return `${n} guests`;
    }
    return `${n} cups`;
  }

  function collectInclusions(item) {
    const sections = [];
    const menu = (item.menuItems || []).map((m) => String(m).trim()).filter(Boolean);
    if (menu.length) sections.push({ label: "Menu", items: menu });

    if (isWorkshopItem(item)) {
      const inclusions = Array.isArray(item.workshopInclusions) ? item.workshopInclusions : [];
      const flat = [];
      inclusions.forEach((entry) => {
        String(entry)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .forEach((l) => flat.push(l));
      });
      if (flat.length) sections.push({ label: "Inclusions", items: flat });
      if (item.workshopDetails && String(item.workshopDetails).trim()) {
        sections.push({
          label: "Additional details",
          items: [String(item.workshopDetails).trim()]
        });
      }
    } else {
      const serving = (item.additionalOptions || []).map((o) => String(o).trim()).filter(Boolean);
      if (serving.length) sections.push({ label: "Serving", items: serving });

      const inclusions = [];
      if (item.duration) inclusions.push(item.duration);
      if (item.serviceWindow && item.serviceWindow.length) {
        item.serviceWindow.forEach((s) => {
          if (String(s).trim()) inclusions.push(s);
        });
      }
      if (item.baristas) inclusions.push(item.baristas);
      if (item.otherInclusions && item.otherInclusions.length) {
        item.otherInclusions.forEach((inc) => {
          if (String(inc).trim()) inclusions.push(inc);
        });
      }
      if (inclusions.length) sections.push({ label: "Inclusions", items: inclusions });
    }
    return sections;
  }

  function choiceSlotsForPackageType(packageType) {
    if (packageType === "signature") return 3;
    if (packageType === "special") return 5;
    if (packageType === "starter") return 1;
    return 0;
  }

  function buildDisplayLines(doc) {
    const lines = [];
    (doc.invoiceItems || []).forEach((item) => {
      if (!isPackageVisible(item)) return;
      const pricing = getInvoiceItemPricing(item);
      const choiceSlots = choiceSlotsForPackageType(item.packageType);
      lines.push({
        kind: "package",
        itemId: item.id,
        packageType: item.packageType || "",
        coffeeAddOn: !!item.coffeeAddOn,
        choiceSlots,
        choiceDrinks: Array.isArray(item.choiceDrinks) ? item.choiceDrinks : [],
        title: item.description || "Package",
        meta: {
          size: cupsLabel(item),
          venue: item.eventVenue || "",
          date: item.eventDate || doc.eventDate || ""
        },
        sections: collectInclusions(item),
        unitCost: pricing.unitCost,
        qty: pricing.qty,
        subtotal: pricing.subtotal
      });
      getPackageAddonLineItems(item).forEach((addon) => {
        const qty = addon.quantity || 1;
        const price = addon.price || 0;
        lines.push({
          kind: "addon",
          title: addon.name,
          meta: {},
          sections: [],
          unitCost: price,
          qty,
          subtotal: qty * price
        });
      });
    });

    (doc.customLineItems || []).forEach((item) => {
      const name = (item.name || item.description || "").trim();
      if (!name) return;
      const qty = item.quantity || 0;
      const price = item.price || 0;
      const sections = [];
      if (item.name && item.description && String(item.description).trim()) {
        const details = String(item.description)
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (details.length) sections.push({ label: "Details", items: details });
      }
      lines.push({
        kind: "custom",
        title: name,
        meta: {},
        sections,
        unitCost: price,
        qty,
        subtotal: qty * price
      });
    });

    return lines;
  }

  const MOBILE_BAR_LIST_RATES = {
    starter: { 100: 29500, 150: 43500 },
    signature: { 100: 32500, 150: 46750 },
    special: { 100: 36000, 150: 52000 }
  };
  const MOBILE_BAR_CUP_TIERS = [100, 150];

  function resolveItemCups(item) {
    return resolvePackageCount(item);
  }

  function computeMobileBarListPrice(item) {
    const rates = MOBILE_BAR_LIST_RATES[item?.packageType];
    const cups = resolveItemCups(item);
    if (!rates || !cups) return 0;
    if (rates[cups] != null) return rates[cups];
    const tiers = MOBILE_BAR_CUP_TIERS;
    let lower;
    let upper;
    if (cups < tiers[0]) {
      lower = tiers[0];
      upper = tiers[1];
    } else if (cups > tiers[tiers.length - 1]) {
      lower = tiers[tiers.length - 2];
      upper = tiers[tiers.length - 1];
    } else {
      for (let i = 0; i < tiers.length - 1; i++) {
        if (cups > tiers[i] && cups < tiers[i + 1]) {
          lower = tiers[i];
          upper = tiers[i + 1];
          break;
        }
      }
    }
    if (lower == null || upper == null) return 0;
    const slope = (rates[upper] - rates[lower]) / (upper - lower);
    const anchor = cups > tiers[tiers.length - 1] ? upper : lower;
    return Math.round(rates[anchor] + (cups - anchor) * slope);
  }

  function packageItemDiscount(item) {
    if (!item || item.isWorkshop) return 0;
    const pkgDisc = Number(item.packageDiscount);
    if (Number.isFinite(pkgDisc) && pkgDisc > 0) return pkgDisc;
    const charged = Number(item.unitPrice);
    if (!Number.isFinite(charged)) return 0;
    let list = Number(item.listPrice);
    if (!Number.isFinite(list) || list <= 0) {
      list = computeMobileBarListPrice(item);
    }
    if (!Number.isFinite(list) || list <= charged) return 0;
    const override = item.priceOverride;
    if (override == null || override === "") {
      // Manual package amount is what creates the discount; no override → no discount row.
      return 0;
    }
    return list - charged;
  }

  function derivePricingFromDoc(doc, computedLineTotal) {
    const storedDiscount = Number(doc.amountDiscount);
    const storedTotal =
      Number.isFinite(Number(doc.amountTotal)) && Number(doc.amountTotal) >= 0
        ? Number(doc.amountTotal)
        : Number.isFinite(Number(doc.totalAmount)) && Number(doc.totalAmount) >= 0
          ? Number(doc.totalAmount)
          : null;

    let amountDiscount = Number.isFinite(storedDiscount) && storedDiscount > 0 ? storedDiscount : 0;

    if (!amountDiscount) {
      if (Array.isArray(doc.invoiceItems)) {
        amountDiscount = doc.invoiceItems.reduce(
          (sum, item) => sum + packageItemDiscount(item),
          0
        );
      }
      const extra = Number(doc.invoiceDiscount);
      if (Number.isFinite(extra) && extra > 0) amountDiscount += extra;
    }

    const amountTotal =
      storedTotal != null
        ? storedTotal
        : Math.max(0, computedLineTotal);
    // Always reconstruct subtotal from total + discount so a stale amountSubtotal
    // (equal to the discounted total) cannot hide the discount on the customer page.
    const amountSubtotal = amountTotal + amountDiscount;

    return { amountSubtotal, amountDiscount, amountTotal };
  }

  function computeSummary(doc) {
    const lines = buildDisplayLines(doc);
    const computedTotal = lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
    const pricing = derivePricingFromDoc(doc || {}, computedTotal);
    const amountDiscount = pricing.amountDiscount;
    const amountTotal = pricing.amountTotal;
    const amountSubtotal = pricing.amountSubtotal;

    const milestones = Array.isArray(doc.paymentMilestones)
      ? doc.paymentMilestones.filter(
          (m) =>
            m &&
            String(m.milestone || "").trim() &&
            !m.splitFromId &&
            (Number(m.percentage) > 0 || Number(m.amount) > 0 || m.paid)
        )
      : [];
    const amountPaid =
      doc.amountPaid != null
        ? Number(doc.amountPaid) || 0
        : milestones.reduce((s, m) => {
            if (m.received != null) return s + (Number(m.received) || 0);
            return s + (m.paid ? Number(m.amount) || 0 : 0);
          }, 0);
    const hasDerivedRemaining = milestones.some((m) => m.remaining != null);
    const amountRemaining =
      doc.amountRemaining != null
        ? Number(doc.amountRemaining) || 0
        : hasDerivedRemaining
          ? Math.max(
              0,
              milestones.reduce((s, m) => s + (Number(m.remaining) || 0), 0)
            )
          : Math.max(0, amountTotal - amountPaid);
    const nextUnpaid = milestones.find((m) =>
      m.remaining != null ? Number(m.remaining) > 0.5 : !m.paid
    );
    const allPaid =
      milestones.length > 0 &&
      milestones.every((m) =>
        m.remaining != null ? Number(m.remaining) <= 0.5 : !!m.paid
      );

    let paymentStatus = doc.paymentStatus || "unpaid";
    if (!doc.paymentStatus) {
      if (allPaid || (amountTotal > 0 && amountRemaining <= 0 && amountPaid > 0)) {
        paymentStatus = "paid";
      } else if (amountPaid > 0) {
        paymentStatus = "partial";
      }
    }

    return {
      lines,
      amountTotal,
      amountSubtotal,
      amountDiscount,
      amountPaid: Number.isFinite(Number(doc.amountPaid)) ? Number(doc.amountPaid) : amountPaid,
      amountRemaining: Number.isFinite(Number(doc.amountRemaining))
        ? Number(doc.amountRemaining)
        : amountRemaining,
      amountDueNow: Number.isFinite(Number(doc.amountDueNow))
        ? Number(doc.amountDueNow)
        : nextUnpaid
          ? Number(nextUnpaid.remaining != null ? nextUnpaid.remaining : nextUnpaid.amount) || 0
          : amountRemaining,
      dueLabel: doc.dueLabel || (nextUnpaid ? nextUnpaid.milestone : paymentStatus === "paid" ? "Paid in full" : "Amount due"),
      paymentStatus,
      milestones
    };
  }

  function statusTitle(status) {
    if (status === "paid") return "Paid in full";
    if (status === "partial") return "Partially paid";
    return "Awaiting payment";
  }

  function isChoiceDrinksLine(text) {
    const t = String(text || "").trim();
    return (
      /^\d+\s+additional\s+drinks?\s+of\s+choice\b/i.test(t) ||
      /^\d+\s+drinks?\s+of\s+choice\b/i.test(t)
    );
  }

  function parseChoiceCount(text) {
    const m = String(text || "").trim().match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function formatChoiceDrinksLabel(text) {
    const n = parseChoiceCount(text);
    if (!n) return "additional drinks of choice";
    return n === 1
      ? "1 additional drink of choice"
      : `${n} additional drinks of choice`;
  }

  function choiceDrinksCatalog(includeCoffee) {
    if (includeCoffee) return MOBILE_BAR_CHOICE_CATALOG.slice();
    return MOBILE_BAR_CHOICE_CATALOG.filter((d) => !COFFEE_DRINKS.includes(d));
  }

  function packageHasCoffeeAddOn(doc, packageLine) {
    if (packageLine && typeof packageLine.coffeeAddOn === "boolean") {
      return packageLine.coffeeAddOn;
    }
    const items = Array.isArray(doc?.invoiceItems) ? doc.invoiceItems : [];
    const match = items.find(
      (item) =>
        String(item.description || "").trim() === String(packageLine?.title || "").trim()
    );
    if (match && match.coffeeAddOn) return true;
    const menu = Array.isArray(packageLine?.sections)
      ? packageLine.sections.flatMap((s) => (s.label === "Menu" ? s.items : []))
      : [];
    return menu.some((t) => /coffee\s+menu/i.test(String(t)));
  }

  function displayMenuItemText(text) {
    if (isChoiceDrinksLine(text)) return formatChoiceDrinksLabel(text);
    return String(text || "").trim();
  }

  function renderChoiceDrinksItemHtml(text, options = {}) {
    const label = formatChoiceDrinksLabel(text);
    const interactive = !!options.interactive;
    const includeCoffee = !!options.includeCoffee;
    const itemId = options.itemId != null ? String(options.itemId) : "";
    const slots =
      Number(options.choiceSlots) > 0
        ? Number(options.choiceSlots)
        : parseChoiceCount(text);
    const selected = Array.isArray(options.choiceDrinks) ? options.choiceDrinks : [];

    if (interactive && itemId && slots > 0) {
      const remaining = Math.max(0, slots - selected.length);
      const cta =
        remaining > 0
          ? remaining === 1
            ? "Choose 1 additional drink"
            : `Choose ${remaining} additional drinks`
          : "Change drink choices";
      return `<li class="inv-choice-drinks inv-choice-drinks-interactive">
        <button type="button"
          class="inv-choice-drinks-btn"
          data-choice-open
          data-item-id="${escapeHtml(itemId)}"
          data-slots="${escapeHtml(String(slots))}"
          data-coffee="${includeCoffee ? "1" : "0"}"
          data-selected="${escapeHtml(selected.join("|"))}">
          ${escapeHtml(cta)}
        </button>
      </li>`;
    }

    const drinks = choiceDrinksCatalog(includeCoffee);
    const list = drinks.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
    return `<li class="inv-choice-drinks" tabindex="0">
      <span class="inv-choice-drinks-label">${escapeHtml(label)}</span>
      <div class="inv-choice-drinks-popover" role="tooltip">
        <div class="inv-choice-drinks-popover-title">Available choices</div>
        <ul class="inv-choice-drinks-popover-list">${list}</ul>
      </div>
    </li>`;
  }

  function renderSectionsHtml(sections, options = {}) {
    if (!sections.length) return "";
    const includeCoffee = !!options.includeCoffee;
    const interactive = !!options.interactive;
    const itemId = options.itemId;
    const choiceSlots = Number(options.choiceSlots) || 0;
    const choiceDrinks = Array.isArray(options.choiceDrinks) ? options.choiceDrinks : [];
    const hasChoiceLine = sections.some(
      (section) =>
        section.label === "Menu" && section.items.some((item) => isChoiceDrinksLine(item))
    );

    return sections
      .map((section) => {
        const items = section.items
          .map((item) => {
            if (section.label === "Menu" && isChoiceDrinksLine(item)) {
              return renderChoiceDrinksItemHtml(item, {
                includeCoffee,
                interactive,
                itemId,
                choiceSlots,
                choiceDrinks
              });
            }
            return `<li>${escapeHtml(item)}</li>`;
          })
          .join("");
        let extra = "";
        if (
          interactive &&
          section.label === "Menu" &&
          !hasChoiceLine &&
          choiceSlots > 0 &&
          choiceDrinks.length >= choiceSlots &&
          itemId != null
        ) {
          extra = `<li class="inv-choice-drinks inv-choice-drinks-interactive">
            <button type="button"
              class="inv-choice-drinks-btn"
              data-choice-open
              data-item-id="${escapeHtml(String(itemId))}"
              data-slots="${escapeHtml(String(choiceSlots))}"
              data-coffee="${includeCoffee ? "1" : "0"}"
              data-selected="${escapeHtml(choiceDrinks.join("|"))}">
              Change drink choices
            </button>
          </li>`;
        }
        return `<div class="inv-section">
          <div class="inv-section-label">${escapeHtml(section.label)}</div>
          <ul class="inv-section-list">${items}${extra}</ul>
        </div>`;
      })
      .join("");
  }

  function renderPackageCardsHtml(lines, doc, options = {}) {
    const packages = lines.filter((l) => l.kind === "package");
    if (!packages.length) {
      return "";
    }
    return packages
      .map((line) => {
        const sizeLine = line.meta.size
          ? `<div class="inv-package-size">${escapeHtml(line.meta.size)}</div>`
          : "";
        const metaParts = [];
        if (line.meta.venue) {
          metaParts.push(`<strong>Venue:</strong> ${escapeHtml(line.meta.venue)}`);
        }
        if (line.meta.date) {
          metaParts.push(`<strong>Date:</strong> ${escapeHtml(formatDate(line.meta.date))}`);
        }
        const metaHtml = metaParts.length
          ? `<div class="inv-package-meta">${metaParts.join(
              '<span class="inv-package-meta-sep"> · </span>'
            )}</div>`
          : "";
        const includeCoffee = packageHasCoffeeAddOn(doc, line);
        return `<article class="inv-package-card">
          <div class="inv-package-heading">
            <h3 class="inv-package-title">${escapeHtml(line.title)}</h3>
            <div class="inv-package-price">Php ${formatCurrency(line.subtotal)}</div>
          </div>
          ${sizeLine}
          ${renderSectionsHtml(line.sections, {
            includeCoffee,
            interactive: !!options.interactive,
            itemId: line.itemId,
            choiceSlots: line.choiceSlots,
            choiceDrinks: line.choiceDrinks
          })}
          ${metaHtml}
        </article>`;
      })
      .join("");
  }

  function renderAmountRowsHtml(lines) {
    if (!lines.length) return "";
    return lines
      .map((line) => {
        const qtyLine =
          Number(line.qty) > 1
            ? `<div class="inv-package-size">× ${escapeHtml(String(line.qty))}</div>`
            : "";
        return `<article class="inv-package-card">
          <div class="inv-package-heading">
            <h3 class="inv-package-title">${escapeHtml(line.title)}</h3>
            <div class="inv-package-price">Php ${formatCurrency(line.subtotal)}</div>
          </div>
          ${qtyLine}
          ${renderSectionsHtml(line.sections || [])}
        </article>`;
      })
      .join("");
  }

  function renderPaymentProofHtml(doc, options = {}) {
    if (options.compact) return "";
    const milestones = Array.isArray(doc?.paymentMilestones) ? doc.paymentMilestones : [];
    const payments = Array.isArray(doc?.payments) ? doc.payments : [];
    const nextUnpaid = milestones.find(
      (m) => m && (m.remaining != null ? Number(m.remaining) > 0.5 : !m.paid)
    );
    const lastPaymentWithShot = [...payments]
      .reverse()
      .find((p) => p && p.status !== "voided" && p.screenshotUrl);
    const lastPaidWithProof = [...milestones]
      .reverse()
      .find((m) => m && (m.screenshotUrl || m.paymentReference));

    if (!nextUnpaid) {
      const shot =
        lastPaymentWithShot?.screenshotUrl || lastPaidWithProof?.screenshotUrl || null;
      if (!shot && !lastPaidWithProof && !lastPaymentWithShot) return "";
      return `<section class="inv-block inv-proof-block is-done">
        <h2 class="inv-block-title">Payment proof</h2>
        <p class="inv-proof-copy">Thanks — payment received.</p>
        ${
          shot
            ? `<button type="button" class="inv-proof-link" data-proof-image="${escapeHtml(shot)}">View payment screenshot</button>`
            : ""
        }
      </section>`;
    }

    return `<section class="inv-block inv-proof-block" id="paymentProofPanel" data-milestone-id="${escapeHtml(
      String(nextUnpaid.id ?? "")
    )}">
      <h2 class="inv-block-title">Submit payment proof</h2>
      <div class="inv-proof-dropzone" id="paymentProofDropzone">
        <input type="file" id="paymentProofFile" class="inv-proof-file-input" accept="image/png,image/jpeg,image/webp,image/heic,image/heif">
        <label class="inv-proof-dropzone-idle" id="paymentProofIdle" for="paymentProofFile">
          <span class="inv-proof-dropzone-title inv-proof-dropzone-desktop">Drop payment screenshot here, or click to upload</span>
          <span class="inv-proof-dropzone-title inv-proof-dropzone-mobile">Tap to upload your screenshot</span>
        </label>
        <div class="inv-proof-dropzone-busy is-hidden" id="paymentProofBusy" hidden>
          <span class="inv-proof-spinner" aria-hidden="true"></span>
          <span class="inv-proof-busy-text" id="paymentProofBusyText">Reading screenshot…</span>
        </div>
        <div class="inv-proof-review is-hidden" id="paymentProofReview" hidden>
          <div class="inv-proof-review-media">
            <img id="paymentProofPreview" class="inv-proof-review-thumb" alt="Payment screenshot">
            <button type="button" class="inv-proof-remove" id="paymentProofRemoveBtn" aria-label="Remove screenshot and upload again">×</button>
          </div>
          <dl class="inv-proof-review-details">
            <div class="inv-proof-detail">
              <dt>Amount paid</dt>
              <dd id="paymentProofAmountDisplay">—</dd>
            </div>
            <div class="inv-proof-detail">
              <dt>Reference</dt>
              <dd id="paymentProofReferenceDisplay">—</dd>
            </div>
            <div class="inv-proof-detail">
              <dt>Date</dt>
              <dd id="paymentProofDateDisplay">—</dd>
            </div>
            <div class="inv-proof-detail">
              <dt>Method</dt>
              <dd id="paymentProofMethodDisplay">—</dd>
            </div>
          </dl>
        </div>
      </div>
      <p class="inv-proof-status is-hidden" id="paymentProofStatus" hidden></p>
      <p class="inv-proof-error is-hidden" id="paymentProofError" hidden></p>
      <button type="button" class="inv-btn inv-btn-primary inv-proof-confirm-btn is-hidden" id="paymentProofConfirmBtn" hidden>Confirm payment</button>
    </section>`;
  }

  function renderMilestonesHtml(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      return `<div class="inv-empty">No payment schedule.</div>`;
    }
    return `<div class="inv-milestones">
      ${list
        .map((row) => {
          const kind = row.kind || (row.paid ? "received" : "due");
          const isReceived = kind === "received";
          let statusClass = "is-upcoming";
          let statusLabel = row.statusLabel || "Upcoming";
          if (isReceived) {
            if (row.paymentStatus === "sent" || statusLabel === "Payment sent") {
              statusClass = "is-sent";
              statusLabel = "Payment sent";
            } else {
              statusClass = "is-paid";
              statusLabel = "Payment confirmed";
            }
          } else if (statusLabel === "Due now") {
            statusClass = "is-due";
          }
          const screenshotUrl = row.screenshotUrl || null;
          return `<div class="inv-milestone ${statusClass}">
            <div class="inv-milestone-main">
              <div class="inv-milestone-name">${escapeHtml(row.milestone || "")}</div>
              <div class="inv-milestone-date">${row.date ? escapeHtml(formatDate(row.date)) : "—"}</div>
              ${
                isReceived && row.paymentReference
                  ? `<div class="inv-milestone-ref">Ref: ${escapeHtml(row.paymentReference)}</div>`
                  : ""
              }
            </div>
            <div class="inv-milestone-side">
              <span class="inv-milestone-status">${escapeHtml(statusLabel)}</span>
              <span class="inv-milestone-amount">Php ${formatCurrency(row.amount)}</span>
              ${
                isReceived && screenshotUrl
                  ? `<button type="button" class="inv-milestone-proof" data-proof-image="${escapeHtml(screenshotUrl)}">Payment screenshot</button>`
                  : ""
              }
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function formatClientDisplay(doc) {
    const name = String(doc?.clientName || "").trim();
    const company = String(doc?.clientCompany || "").trim();
    return { name, company, hasEither: !!(name || company) };
  }

  function formatBilledToLine(doc) {
    const { name, company } = formatClientDisplay(doc);
    if (name && company) return `${name}\n${company}`;
    return name || company || "";
  }

  function renderInvoicePageHtml(doc, options = {}) {
    const summary = computeSummary(doc || {});
    const compact = !!options.compact;
    const client = formatClientDisplay(doc);
    const otherLines = summary.lines.filter((l) => l.kind !== "package");
    const packagesHtml = renderPackageCardsHtml(summary.lines, doc, {
      interactive: !!options.interactive
    });
    const extrasHtml = otherLines.length ? renderAmountRowsHtml(otherLines) : "";
    const bookingHtml =
      packagesHtml || extrasHtml
        ? `${packagesHtml}${extrasHtml}`
        : `<div class="inv-empty">No package details yet.</div>`;

    return `
      <section class="inv-hero">
        <div class="inv-hero-identity">
          ${
            client.name
              ? `<div class="inv-hero-client">${escapeHtml(client.name)}</div>`
              : ""
          }
          ${
            client.company
              ? `<div class="inv-hero-company">${escapeHtml(client.company)}</div>`
              : ""
          }
          ${
            !client.hasEither
              ? `<div class="inv-hero-client">Client</div>`
              : ""
          }
        </div>
        <div class="inv-hero-meta">
          ${doc.invoiceNumber ? `<span>${escapeHtml(doc.invoiceNumber)}</span>` : ""}
          ${doc.invoiceDate ? `<span>${escapeHtml(formatDate(doc.invoiceDate))}</span>` : ""}
        </div>
      </section>

      <section class="inv-block">
        <h2 class="inv-block-title">Your booking</h2>
        ${bookingHtml}
        <div class="inv-total-block${summary.amountDiscount > 0 ? " has-breakdown" : ""}">
          ${
            summary.amountDiscount > 0
              ? `<div class="inv-total-breakdown">
                  <div class="inv-breakdown-row">
                    <span>Subtotal</span>
                    <span>Php ${formatCurrency(summary.amountSubtotal)}</span>
                  </div>
                  <div class="inv-breakdown-row inv-total-discount">
                    <span>Discount</span>
                    <span>−Php ${formatCurrency(summary.amountDiscount)}</span>
                  </div>
                </div>`
              : ""
          }
          <div class="inv-total-main">
            <div class="inv-total-label">Invoice total</div>
            <div class="inv-total-amount">Php ${formatCurrency(summary.amountTotal)}</div>
          </div>
        </div>
      </section>

      <section class="inv-block">
        <h2 class="inv-block-title">Payment schedule</h2>
        ${renderMilestonesHtml(
          Array.isArray(doc.paymentScheduleRows) && doc.paymentScheduleRows.length
            ? doc.paymentScheduleRows
            : typeof window !== "undefined" &&
                window.InvoicePaymentAlloc &&
                window.InvoicePaymentAlloc.buildScheduleDisplayRows
              ? window.InvoicePaymentAlloc.buildScheduleDisplayRows(
                  doc.paymentMilestones,
                  doc.payments || []
                )
              : summary.milestones
        )}
      </section>

      <section class="inv-block">
        <h2 class="inv-block-title">How to pay</h2>
        ${renderPayMethodsHtml()}
      </section>

      ${renderPaymentProofHtml(doc, options)}

      ${
        doc.notes && String(doc.notes).trim()
          ? `<section class="inv-block">
              <h2 class="inv-block-title">Notes</h2>
              <p class="inv-notes">${escapeHtml(doc.notes)}</p>
            </section>`
          : ""
      }

      ${
        compact
          ? ""
          : `<footer class="inv-footer">
              <div class="inv-footer-brand">Matchanese, Inc.</div>
            </footer>`
      }
    `;
  }

  function renderInvoicePage(rootEl, doc, options) {
    if (!rootEl) return computeSummary(doc || {});
    rootEl.innerHTML = renderInvoicePageHtml(doc, options);
    return computeSummary(doc || {});
  }

  /** Compact HTML used only for PDF capture (never shown as the main UI). */
  function renderPdfExportHtml(doc) {
    const summary = computeSummary(doc || {});
    const packageBlocks = summary.lines
      .filter((l) => l.kind === "package")
      .map((line) => {
        const bits = [];
        if (line.meta.size) bits.push(line.meta.size);
        if (line.meta.date) bits.push(formatDate(line.meta.date));
        if (line.meta.venue) bits.push(line.meta.venue);
        const sections = line.sections
          .map(
            (s) =>
              `<div style="margin-top:6px"><strong>${escapeHtml(s.label)}:</strong><ul style="margin:4px 0 0 18px;padding:0">${s.items
                .map((i) => `<li>${escapeHtml(s.label === "Menu" ? displayMenuItemText(i) : i)}</li>`)
                .join("")}</ul></div>`
          )
          .join("");
        return `<tr>
          <td style="padding:10px;border:1px solid #000;vertical-align:top">
            <strong>${escapeHtml(line.title)}</strong>
            ${bits.length ? `<div style="font-size:12px;margin-top:4px">${escapeHtml(bits.join(" · "))}</div>` : ""}
            ${sections}
          </td>
          <td style="padding:10px;border:1px solid #000;text-align:right;white-space:nowrap">Php ${formatCurrency(line.unitCost)}</td>
          <td style="padding:10px;border:1px solid #000;text-align:center">${escapeHtml(String(line.qty))}</td>
          <td style="padding:10px;border:1px solid #000;text-align:right;white-space:nowrap">Php ${formatCurrency(line.subtotal)}</td>
        </tr>`;
      })
      .join("");

    const otherRows = summary.lines
      .filter((l) => l.kind !== "package")
      .map(
        (line) => `<tr>
          <td style="padding:10px;border:1px solid #000">${escapeHtml(line.title)}</td>
          <td style="padding:10px;border:1px solid #000;text-align:right">Php ${formatCurrency(line.unitCost)}</td>
          <td style="padding:10px;border:1px solid #000;text-align:center">${escapeHtml(String(line.qty))}</td>
          <td style="padding:10px;border:1px solid #000;text-align:right">Php ${formatCurrency(line.subtotal)}</td>
        </tr>`
      )
      .join("");

    const milestones = summary.milestones
      .map(
        (m) => `<tr>
          <td style="padding:8px;border:1px solid #000">${escapeHtml(m.milestone)}</td>
          <td style="padding:8px;border:1px solid #000">${m.date ? escapeHtml(formatDate(m.date)) : "—"}</td>
          <td style="padding:8px;border:1px solid #000">${m.paid ? "Paid" : m.percentage ? `${m.percentage}%` : "Due"}</td>
          <td style="padding:8px;border:1px solid #000;text-align:right">Php ${formatCurrency(m.amount)}</td>
        </tr>`
      )
      .join("");

    const banks = PAYMENT_METHODS.map(
      (p) =>
        `<div style="margin-bottom:10px"><strong>${escapeHtml(p.method)}</strong><br>Account Name: ${escapeHtml(p.name)}<br>Account Number: ${escapeHtml(p.number)}</div>`
    ).join("");

    return `
      <div class="pdf-export-page" style="width:210mm;min-height:297mm;padding:12mm;box-sizing:border-box;background:#fff;color:#111;font-family:Inter,Arial,sans-serif">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-weight:700;letter-spacing:1px">MATCHANESE, INC.</div>
          <div style="font-size:12px">Unit 4506, Edades Tower, Amorsolo Drive, Rockwell, Makati City, Philippines</div>
          <div style="font-size:12px">TIN: 010-757-989-000</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:22px;font-weight:700">BILLING INVOICE</div>
          <div style="font-size:13px">Date: ${escapeHtml(formatDate(doc.invoiceDate))}</div>
        </div>
        <div style="font-size:13px;margin-bottom:14px;line-height:1.5">
          <div><strong>Billed to:</strong> ${escapeHtml(doc.clientName || "")}</div>
          <div><strong>Address:</strong> ${escapeHtml(doc.clientAddress || "")}</div>
          <div><strong>TIN:</strong> ${escapeHtml(doc.clientTIN || "")}</div>
          ${doc.invoiceNumber ? `<div><strong>Invoice #:</strong> ${escapeHtml(doc.invoiceNumber)}</div>` : ""}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              <th style="border:1px solid #000;padding:8px;text-align:left">DESCRIPTION</th>
              <th style="border:1px solid #000;padding:8px">Unit Cost</th>
              <th style="border:1px solid #000;padding:8px">Qty</th>
              <th style="border:1px solid #000;padding:8px">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${packageBlocks || ""}${otherRows || ""}
            <tr>
              <td colspan="3" style="border:1px solid #000;padding:10px;font-weight:700">TOTAL AMOUNT DUE</td>
              <td style="border:1px solid #000;padding:10px;text-align:right;font-weight:700">Php ${formatCurrency(summary.amountTotal)}</td>
            </tr>
          </tbody>
        </table>
        <h3 style="margin:22px 0 8px;font-size:14px">PAYMENT TERMS</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr>
              <th style="border:1px solid #000;padding:8px">MILESTONE</th>
              <th style="border:1px solid #000;padding:8px">DATE</th>
              <th style="border:1px solid #000;padding:8px">STATUS</th>
              <th style="border:1px solid #000;padding:8px">AMOUNT</th>
            </tr>
          </thead>
          <tbody>${milestones || `<tr><td colspan="4" style="border:1px solid #000;padding:8px">No milestones</td></tr>`}</tbody>
        </table>
        <h3 style="margin:22px 0 8px;font-size:14px">PAYMENT DETAILS</h3>
        <div style="font-size:12px;column-count:2;column-gap:24px">${banks}</div>
        <p style="font-size:12px;font-style:italic;margin-top:12px">Online card payment via PayPal is available on request.</p>
        <div style="margin-top:28px;text-align:right;font-size:13px">
          <div>Prepared by:</div>
          <strong>Cristopher David</strong><br>Matchanese, Inc.
        </div>
      </div>
    `;
  }

  global.InvoicePageRender = {
    escapeHtml,
    formatCurrency,
    formatDate,
    formatClientDisplay,
    formatBilledToLine,
    computeSummary,
    buildDisplayLines,
    displayMenuItemText,
    choiceDrinksCatalog,
    choiceSlotsForPackageType,
    renderInvoicePage,
    renderInvoicePageHtml,
    renderPdfExportHtml,
    MOBILE_BAR_CHOICE_CATALOG,
    COFFEE_DRINKS,
    PAYMENT_METHODS
  };
})(typeof window !== "undefined" ? window : globalThis);

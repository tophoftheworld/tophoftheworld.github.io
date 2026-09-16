/**
 * Shared invoice document logic (invoice-generator parity).
 * Deployed copy: chatbase-leads-dashboard/public/js/invoice-core.js
 */

export const SERVICE_MOBILE_BAR = "private_mobile_matcha_bar";
export const SERVICE_WORKSHOP = "private_matcha_workshop";

const SERVICE_LABELS = {
  [SERVICE_MOBILE_BAR]: "Private Mobile Matcha Bar",
  [SERVICE_WORKSHOP]: "Private Matcha Workshop"
};

export function formatServiceLabel(service) {
  return SERVICE_LABELS[service] || service || "—";
}

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatDateToLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDate(dateString) {
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

export function formatCurrency(amount) {
  return parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function renderPackageSectionList(label, items) {
  if (!items?.length || !items.some((x) => String(x).trim())) return "";
  let html = '<div class="package-section">';
  html += `<div class="package-section-label">${escapeHtml(label)}</div>`;
  html += '<div class="package-section-list">';
  items.forEach((entry) => {
    if (String(entry).trim()) {
      html += `<div class="package-list-item">${escapeHtml(entry)}</div>`;
    }
  });
  html += "</div></div>";
  return html;
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

function renderCountSection(item) {
  const n = resolvePackageCount(item);
  if (!n) return "";
  const isGuests =
    item.countLabel === "guests" ||
    item.countLabel === "participants" ||
    item.isWorkshop;
  const countLabel = isGuests ? "Guests:" : "Cups:";
  const display = isGuests ? `${n} guests` : `${n} cups`;
  return `<div class="package-section package-section-count">
    <span class="package-section-label">${countLabel}</span>
    <span class="package-section-value">${escapeHtml(display)}</span>
  </div>`;
}

function renderAdditionalDetailsSection(item) {
  const allInclusions = [];
  if (item.duration) allInclusions.push(item.duration);
  if (item.baristas) allInclusions.push(item.baristas);
  if (item.otherInclusions?.length) {
    item.otherInclusions.forEach((inclusion) => {
      if (String(inclusion).trim()) allInclusions.push(inclusion);
    });
  }
  return renderPackageSectionList("Additional Details:", allInclusions);
}

export function formatPackageDetails(item) {
  const hasMenu =
    item.menuItems?.length && item.menuItems.some((m) => String(m).trim());

  const countHtml = renderCountSection(item);
  const optionsHtml = renderPackageSectionList(
    "Additional Options:",
    item.additionalOptions
  );
  const inclusionsHtml = renderAdditionalDetailsSection(item);

  // Lead invoices usually have no menu — use a single stacked column so Cups is not stranded on the right.
  if (!hasMenu) {
    let html = '<div class="package-details-visual package-details-stacked">';
    html += countHtml;
    html += optionsHtml;
    html += inclusionsHtml;
    html += "</div>";
    return html;
  }

  let html = '<div class="package-details-visual">';
  html += '<div class="package-details-columns">';
  html += '<div class="package-column-left">';
  html += renderPackageSectionList("Menu:", item.menuItems);
  html += "</div>";
  html += '<div class="package-column-right">';
  html += countHtml;
  html += optionsHtml;
  html += inclusionsHtml;
  html += "</div></div></div>";
  return html;
}

export function getDefaultPaymentMilestones() {
  return [
    { id: 1, milestone: "Date Reservation", date: "", percentage: 25, amount: 0 },
    { id: 2, milestone: "Pre-Event", date: "", percentage: 25, amount: 0 },
    { id: 3, milestone: "Event Completion", date: "", percentage: 50, amount: 0 }
  ];
}

export function calculateMilestoneDates(eventDateStr, invoiceDateStr) {
  if (!eventDateStr) return { hasPreEvent: false };

  const eventDate = new Date(eventDateStr);
  const invoiceDate = invoiceDateStr ? new Date(invoiceDateStr) : new Date();
  invoiceDate.setHours(0, 0, 0, 0);
  eventDate.setHours(0, 0, 0, 0);

  const daysUntilEvent = Math.ceil((eventDate - invoiceDate) / (1000 * 60 * 60 * 24));
  const dates = {};

  if (daysUntilEvent >= 14) {
    const preEventDate = new Date(eventDate);
    preEventDate.setDate(preEventDate.getDate() - 7);
    dates.preEvent = formatDateToLocal(preEventDate);
    dates.hasPreEvent = true;

    const reservationDateWithGrace = new Date(invoiceDate);
    reservationDateWithGrace.setDate(reservationDateWithGrace.getDate() + 5);
    const reservationDateMinGap = new Date(preEventDate);
    reservationDateMinGap.setDate(reservationDateMinGap.getDate() - 7);
    const reservationDate =
      reservationDateWithGrace < reservationDateMinGap
        ? reservationDateWithGrace
        : reservationDateMinGap;
    if (reservationDate < invoiceDate) {
      reservationDate.setTime(invoiceDate.getTime());
    }
    dates.reservation = formatDateToLocal(reservationDate);
  } else {
    dates.reservation = formatDateToLocal(invoiceDate);
    dates.hasPreEvent = false;
  }

  dates.completion = formatDateToLocal(eventDate);
  return dates;
}

export function computeMilestoneRows(total, eventDateStr, invoiceDateStr) {
  const milestones = getDefaultPaymentMilestones().map((m) => ({ ...m }));
  const milestoneDates = calculateMilestoneDates(eventDateStr, invoiceDateStr);

  const reservationMilestone = milestones.find((m) =>
    m.milestone.toLowerCase().includes("reservation")
  );
  const preEventMilestone = milestones.find(
    (m) =>
      m.milestone.toLowerCase().includes("pre-event") ||
      m.milestone.toLowerCase().includes("pre event")
  );

  if (preEventMilestone && preEventMilestone._originalPercentage === undefined) {
    preEventMilestone._originalPercentage = preEventMilestone.percentage || 25;
  }
  if (reservationMilestone && reservationMilestone._originalPercentage === undefined) {
    reservationMilestone._originalPercentage = reservationMilestone.percentage || 25;
  }

  if (!milestoneDates.hasPreEvent && preEventMilestone && reservationMilestone) {
    if (preEventMilestone.percentage > 0) {
      reservationMilestone.percentage =
        (reservationMilestone.percentage || 0) + (preEventMilestone.percentage || 0);
      preEventMilestone.percentage = 0;
      preEventMilestone.amount = 0;
    }
  } else if (milestoneDates.hasPreEvent && preEventMilestone && reservationMilestone) {
    if (
      preEventMilestone.percentage === 0 &&
      preEventMilestone._originalPercentage !== undefined
    ) {
      const expectedReservation = reservationMilestone._originalPercentage || 25;
      if (reservationMilestone.percentage > expectedReservation) {
        reservationMilestone.percentage = expectedReservation;
        preEventMilestone.percentage = preEventMilestone._originalPercentage || 25;
      }
    }
  }

  milestones.forEach((milestone) => {
    if (eventDateStr) {
      const name = milestone.milestone.toLowerCase();
      if (name.includes("reservation")) {
        milestone.date = milestoneDates.reservation || "";
      } else if (name.includes("pre-event") || name.includes("pre event")) {
        milestone.date = milestoneDates.preEvent || "";
      } else if (name.includes("completion") || name.includes("event completion")) {
        milestone.date = milestoneDates.completion || "";
      }
    }
    if (milestone.percentage > 0) {
      milestone.amount = (total * milestone.percentage) / 100;
    } else {
      milestone.amount = 0;
    }
  });

  return milestones.filter((m) => m.milestone && m.percentage > 0);
}

export function renderMilestoneRowsHtml(milestones) {
  if (!milestones.length) {
    return '<tr><td colspan="4" class="empty-state">No payment milestones added</td></tr>';
  }
  return milestones
    .map((milestone) => {
      const dateStr = milestone.date ? formatDate(milestone.date) : "-";
      const percentageStr = milestone.percentage > 0 ? `${milestone.percentage}%` : "-";
      const amountStr =
        milestone.amount > 0 ? `Php ${formatCurrency(milestone.amount)}` : "-";
      const highlightClass = milestone.milestone.toLowerCase().includes("reservation")
        ? "highlight-amount"
        : "";
      return `<tr>
        <td>${escapeHtml(milestone.milestone)}</td>
        <td>${dateStr}</td>
        <td>${percentageStr}</td>
        <td class="${highlightClass}">${amountStr}</td>
      </tr>`;
    })
    .join("");
}

export function buildLineItemFromLead(lead, { unitPrice }) {
  const paxMatch = String(lead.targetPax || "").match(/\d+/);
  const n = paxMatch ? Number(paxMatch[0]) : Number(String(lead.targetPax).trim()) || 0;
  const isWorkshop = lead.service === SERVICE_WORKSHOP;
  const countLabel = isWorkshop ? "guests" : "cups";

  return {
    description: formatServiceLabel(lead.service),
    count: n,
    countLabel,
    menuItems: [],
    additionalOptions: [],
    otherInclusions: [],
    duration: "",
    baristas: "",
    unitPrice
  };
}

export function buildInvoiceDocumentFromLead(lead, { unitPrice, invoiceDate, eventDate }) {
  const today = invoiceDate || new Date().toISOString().slice(0, 10);
  const event = eventDate || String(lead.targetDate).slice(0, 10);
  const ref = lead.quoteReference || "lead";
  const lineItem = buildLineItemFromLead(lead, { unitPrice });
  const total = unitPrice;

  return {
    invoiceNumber: `INV-${ref}`,
    invoiceDate: today,
    eventDate: event,
    clientName: lead.clientName.trim(),
    clientAddress: "",
    clientTIN: "",
    venue: lead.targetVenue || "",
    lineItem,
    total,
    milestones: computeMilestoneRows(total, event, today)
  };
}

/**
 * @param {HTMLElement} rootEl - #lead-invoice-root
 * @param {object} doc - from buildInvoiceDocumentFromLead
 */
export function fillInvoiceDocument(rootEl, doc) {
  const invoicePage = rootEl.querySelector("#li-invoice");
  if (!invoicePage) throw new Error("Invoice page not found");

  invoicePage.querySelector("#li-displayInvoiceDate").textContent = formatDate(doc.invoiceDate);
  invoicePage.querySelector("#li-displayClientName").textContent = doc.clientName;
  invoicePage.querySelector("#li-displayClientAddress").textContent = doc.clientAddress || "";
  invoicePage.querySelector("#li-displayClientTIN").textContent = doc.clientTIN || "";

  const itemsContainer = invoicePage.querySelector("#li-displayItems");
  const packageDetails = formatPackageDetails(doc.lineItem);
  const venueInfo = doc.venue
    ? `<div class="event-details"><strong>Venue:</strong> ${escapeHtml(doc.venue)}</div>`
    : "";
  const dateInfo = doc.eventDate
    ? `<div class="event-details"><strong>Date:</strong> ${escapeHtml(formatDate(doc.eventDate))}</div>`
    : "";

  itemsContainer.innerHTML = `
    <tr>
      <td class="col-description">
        <div class="package-name">${escapeHtml(doc.lineItem.description)}</div>
        ${packageDetails}
        ${venueInfo}
        ${dateInfo}
      </td>
      <td class="col-subtotal text-right">Php ${formatCurrency(doc.total)}</td>
    </tr>
  `;
  invoicePage.querySelector("#li-displayTotal").textContent = `Php ${formatCurrency(doc.total)}`;

  const milestonesEl = rootEl.querySelector("#li-displayPaymentMilestones");
  if (milestonesEl) {
    milestonesEl.innerHTML = renderMilestoneRowsHtml(doc.milestones);
  }
}

export function waitForInvoiceLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

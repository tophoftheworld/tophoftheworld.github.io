import {
  formatActivityDate,
  formatServiceLabel,
  formatTargetDate,
  SERVICE_OPTIONS
} from "./format.js";
import {
  PIPELINE_STATUSES,
  getPipelineStatus,
  pipelineStatusBadgeHtml,
  pipelineStatusLabel,
  profileIncompleteBadgeHtml
} from "./lead-status.js";
import { canGenerateInvoice, invoiceDisabledReason } from "./lead-invoice.js";

const FIELD_LABELS = {
  clientName: "Client name",
  service: "Service",
  targetDate: "Target date",
  targetPax: "Pax / cups",
  targetVenue: "Venue",
  eventType: "Event type",
  quotedPrice: "Quoted price",
  pipelineStatus: "Status",
  notes: "Notes"
};

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function detailRow(label, valueHtml) {
  return `
    <div class="lead-detail-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${valueHtml}</dd>
    </div>
  `;
}

function toDateInputValue(raw) {
  if (!raw) return "";
  const norm = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) return norm;
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatHistoryValue(field, value) {
  if (!value) return "—";
  if (field === "service") return formatServiceLabel(value);
  if (field === "pipelineStatus") return pipelineStatusLabel(value);
  if (field === "targetDate") return formatTargetDate(value);
  return String(value);
}

export function pipelineSelectHtml(current) {
  const options = PIPELINE_STATUSES.map(
    (s) =>
      `<option value="${s.value}"${s.value === current ? " selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");
  return `<select class="lead-pipeline-select" data-field="pipelineStatus" aria-label="Status">${options}</select>`;
}

function serviceSelectHtml(current) {
  const options = [
    `<option value="">—</option>`,
    ...SERVICE_OPTIONS.map(
      (s) =>
        `<option value="${s.value}"${s.value === current ? " selected" : ""}>${escapeHtml(s.label)}</option>`
    )
  ].join("");
  return `<select class="lead-detail-input" data-field="service" aria-label="Service">${options}</select>`;
}

function textInputHtml(field, value, { type = "text" } = {}) {
  return `<input type="${type}" class="lead-detail-input" data-field="${field}" value="${escapeAttr(value || "")}" />`;
}

function leadFormFieldsHtml(row = {}) {
  return [
    detailRow("Client name", textInputHtml("clientName", row.clientName)),
    detailRow("Service", serviceSelectHtml(row.service)),
    detailRow("Event type", textInputHtml("eventType", row.eventType)),
    detailRow(
      "Target date",
      textInputHtml("targetDate", toDateInputValue(row.targetDate), { type: "date" })
    ),
    detailRow("Pax / cups", textInputHtml("targetPax", row.targetPax)),
    detailRow("Venue", textInputHtml("targetVenue", row.targetVenue)),
    detailRow("Quoted price", textInputHtml("quotedPrice", row.quotedPrice))
  ].join("");
}

export function renderLeadFormFieldsHtml(row = {}) {
  return leadFormFieldsHtml(row);
}

export function sourceBadgeHtml(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "manual") {
    return '<span class="lead-source-badge lead-source-manual">Manual</span>';
  }
  if (normalized === "chatbase_action" || normalized === "automation") {
    return '<span class="lead-source-badge lead-source-automation">Chatbase</span>';
  }
  return "";
}

function renderDetailFields(row, mode) {
  if (mode === "edit") {
    return leadFormFieldsHtml(row);
  }

  return [
    detailRow("Client name", escapeHtml(row.clientName || "—")),
    detailRow("Service", escapeHtml(formatServiceLabel(row.service))),
    detailRow("Event type", escapeHtml(row.eventType || "—")),
    detailRow("Target date", escapeHtml(formatTargetDate(row.targetDate))),
    detailRow("Pax / cups", escapeHtml(row.targetPax || "—")),
    detailRow("Venue", escapeHtml(row.targetVenue || "—")),
    detailRow("Quoted price", escapeHtml(row.quotedPrice || "—"))
  ].join("");
}

function renderEditHistory(row) {
  const history = Array.isArray(row.editHistory) ? [...row.editHistory] : [];
  if (!history.length) {
    const legacy = [];
    if (row.createdAt) {
      legacy.push(`<li class="edit-history-item edit-history-legacy">
        <span class="edit-history-meta subtle">First saved ${escapeHtml(formatActivityDate(row.createdAt))}</span>
      </li>`);
    }
    if (Number(row.updateCount) > 1) {
      legacy.push(`<li class="edit-history-item edit-history-legacy">
        <span class="edit-history-meta subtle">Updated ${row.updateCount} times via bot (no detailed history)</span>
      </li>`);
    }
    return legacy.length
      ? legacy.join("")
      : '<li class="subtle">No edit history yet</li>';
  }

  return history
    .reverse()
    .map((entry) => {
      const isManual = entry.source === "manual";
      const sourceLabel = isManual ? "Manual" : "Automation";
      const sourceClass = isManual ? "edit-history-manual" : "edit-history-automation";
      const changes = (entry.changes || [])
        .map((change) => {
          const label = FIELD_LABELS[change.field] || change.field;
          const from = formatHistoryValue(change.field, change.from);
          const to = formatHistoryValue(change.field, change.to);
          return `${label}: ${from} → ${to}`;
        })
        .join(" · ");

      return `
        <li class="edit-history-item">
          <div class="edit-history-meta">
            <time class="edit-history-time">${escapeHtml(formatActivityDate(entry.at))}</time>
            <span class="edit-history-source ${sourceClass}">${sourceLabel}</span>
          </div>
          <p class="edit-history-changes">${escapeHtml(changes || "Updated")}</p>
        </li>
      `;
    })
    .join("");
}

export function showLeadDetailEmpty(emptyEl, contentEl, conversationEl, message = "Select a lead to view details.") {
  emptyEl.hidden = false;
  emptyEl.textContent = message;
  contentEl.hidden = true;
  if (conversationEl) conversationEl.hidden = true;
}

export function showLeadDetailContent(emptyEl, contentEl, conversationEl) {
  emptyEl.hidden = true;
  contentEl.hidden = false;
  if (conversationEl) conversationEl.hidden = true;
}

export function showLeadConversationContent(emptyEl, contentEl, conversationEl) {
  emptyEl.hidden = true;
  contentEl.hidden = true;
  if (conversationEl) conversationEl.hidden = false;
}

export function renderLeadDetailPanel(row, elements, options = {}) {
  const {
    emptyEl,
    contentEl,
    conversationEl,
    quoteRefEl,
    statusBadgeEl,
    statusWrapEl,
    fieldsEl,
    activityEl,
    docIdEl,
    viewConversationBtn,
    deleteBtn,
    downloadInvoiceBtn,
    addCalendarBtn,
    notesViewEl,
    notesEditEl,
    editBtn,
    saveBtn,
    cancelBtn,
    editActionsEl
  } = elements;

  const mode = options.mode === "edit" ? "edit" : "view";
  const inConversation = options.paneView === "conversation";

  if (!row) {
    showLeadDetailEmpty(emptyEl, contentEl, conversationEl);
    return;
  }

  if (inConversation) {
    showLeadConversationContent(emptyEl, contentEl, conversationEl);
    return;
  }

  showLeadDetailContent(emptyEl, contentEl, conversationEl);

  quoteRefEl.textContent = row.quoteReference || "—";
  statusBadgeEl.innerHTML = [profileIncompleteBadgeHtml(row), sourceBadgeHtml(row.source)]
    .filter(Boolean)
    .join(" ");

  const pipeline = getPipelineStatus(row);
  if (statusWrapEl) {
    if (mode === "edit") {
      statusWrapEl.innerHTML = pipelineSelectHtml(pipeline);
    } else {
      statusWrapEl.innerHTML = pipelineStatusBadgeHtml(pipeline);
    }
  }

  fieldsEl.innerHTML = renderDetailFields(row, mode);

  const notesText = (row.notes || "").trim();
  if (notesViewEl) {
    notesViewEl.textContent = notesText || "No notes";
    notesViewEl.classList.toggle("subtle", !notesText);
    notesViewEl.hidden = mode === "edit";
  }
  if (notesEditEl) {
    notesEditEl.value = row.notes || "";
    notesEditEl.hidden = mode !== "edit";
  }

  if (editActionsEl) editActionsEl.hidden = mode !== "edit";
  if (editBtn) editBtn.hidden = mode === "edit";
  if (saveBtn) saveBtn.hidden = mode !== "edit";
  if (cancelBtn) cancelBtn.hidden = mode !== "edit";

  if (activityEl) {
    activityEl.innerHTML = renderEditHistory(row);
  }

  docIdEl.textContent = row.id ? `Record id: ${row.id}` : "";

  if (viewConversationBtn) {
    viewConversationBtn.hidden = false;
    viewConversationBtn.disabled = inConversation;
    viewConversationBtn.dataset.leadId = row.id;
    viewConversationBtn.textContent = "View conversation";
    if (row.conversationId) {
      viewConversationBtn.title = "Open linked Inbox thread";
    } else {
      viewConversationBtn.title =
        "Search Inbox for this quote reference (no thread linked yet)";
    }
  }

  const actionsDisabled = inConversation;
  if (editBtn) editBtn.disabled = actionsDisabled;
  deleteBtn.disabled = actionsDisabled;
  deleteBtn.dataset.leadId = row.id;

  if (downloadInvoiceBtn) {
    const can = canGenerateInvoice(row);
    downloadInvoiceBtn.disabled = actionsDisabled || !can;
    downloadInvoiceBtn.title = can ? "Generate and download formal invoice PDF" : invoiceDisabledReason(row);
    downloadInvoiceBtn.dataset.leadId = row.id;
  }

  if (addCalendarBtn) {
    addCalendarBtn.hidden = false;
    addCalendarBtn.disabled = actionsDisabled;
    addCalendarBtn.dataset.leadId = row.id;
    if (row.opsEventId) {
      addCalendarBtn.textContent = "View on calendar";
      addCalendarBtn.dataset.opsEventId = row.opsEventId;
      addCalendarBtn.dataset.mode = "view";
      addCalendarBtn.title = "Open linked event in Events planner";
      addCalendarBtn.disabled = actionsDisabled;
    } else {
      addCalendarBtn.textContent = "Add to calendar";
      addCalendarBtn.dataset.opsEventId = "";
      addCalendarBtn.dataset.mode = "promote";
      const hasDate = Boolean(String(row.targetDate || "").trim());
      addCalendarBtn.disabled = actionsDisabled || !hasDate;
      addCalendarBtn.title = hasDate
        ? "Create a draft event on the Events calendar"
        : "Set a target date before adding to the calendar";
    }
  }

  if (saveBtn) saveBtn.dataset.leadId = row.id;
  if (cancelBtn) cancelBtn.dataset.leadId = row.id;
}

export function readLeadFormFields({ fieldsEl, statusWrapEl, notesEl } = {}) {
  const root = fieldsEl;
  const readField = (name) => root?.querySelector(`[data-field="${name}"]`)?.value ?? "";

  return {
    clientName: readField("clientName"),
    service: readField("service"),
    eventType: readField("eventType"),
    targetDate: readField("targetDate"),
    targetPax: readField("targetPax"),
    targetVenue: readField("targetVenue"),
    quotedPrice: readField("quotedPrice"),
    pipelineStatus:
      statusWrapEl?.querySelector('[data-field="pipelineStatus"]')?.value ??
      readField("pipelineStatus"),
    notes: notesEl?.value ?? ""
  };
}

export function readLeadDetailEdits(elements) {
  return readLeadFormFields({
    fieldsEl: elements.fieldsEl,
    statusWrapEl: elements.statusWrapEl,
    notesEl: elements.notesEditEl
  });
}

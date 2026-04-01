import { getLead, updateLeadStatus } from "./api.js";

const params = new URLSearchParams(window.location.search);
const leadId = params.get("id");

const leadTitle = document.getElementById("lead-title");
const contactFields = document.getElementById("contact-fields");
const bookingFields = document.getElementById("booking-fields");
const timelineList = document.getElementById("timeline-list");
const conversationList = document.getElementById("conversation-list");
const statusPill = document.getElementById("lead-status-pill");
const statusForm = document.getElementById("status-form");
const statusSelect = document.getElementById("status-select");
const statusNote = document.getElementById("status-note");

function safe(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function renderFieldList(target, entries) {
  target.innerHTML = entries.map(([key, value]) => `<dt>${key}</dt><dd>${safe(value)}</dd>`).join("");
}

function renderTimeline(events) {
  if (!events?.length) {
    timelineList.innerHTML = '<li class="empty">No status events yet.</li>';
    return;
  }
  timelineList.innerHTML = events.map((event) => `
    <li>
      <strong>${safe(event.fromStatus)} &rarr; ${safe(event.toStatus)}</strong><br>
      <span class="subtle">${safe(event.triggerType)} | ${safe(event.createdAt)}</span><br>
      ${event.note ? `<span>${event.note}</span>` : ""}
    </li>
  `).join("");
}

function renderConversations(snapshots) {
  if (!snapshots?.length) {
    conversationList.innerHTML = '<p class="empty">No conversation snapshots yet.</p>';
    return;
  }
  conversationList.innerHTML = snapshots.map((snapshot) => `
    <article class="conversation-item">
      <p class="subtle">${safe(snapshot.lastMessageAt)} | ${safe(snapshot.messageCount)} messages</p>
      <p>${safe(snapshot.rawExcerpt)}</p>
    </article>
  `).join("");
}

function applyStatus(status) {
  statusPill.className = `status-pill status-${status}`;
  statusPill.textContent = status;
  statusSelect.value = status;
}

async function loadLead() {
  if (!leadId) {
    leadTitle.textContent = "Lead ID missing";
    return;
  }
  const { data } = await getLead(leadId);
  leadTitle.textContent = data.name || "(no name)";
  applyStatus(data.status || "new");

  renderFieldList(contactFields, [
    ["Name", data.name],
    ["Email", data.email],
    ["Phone", data.phone],
    ["Source", data.source],
    ["Inquiry type", data.inquiryType],
    ["Created at", data.createdAt],
    ["Updated at", data.updatedAt]
  ]);

  const details = data.bookingDetails || {};
  renderFieldList(bookingFields, [
    ["Target date", details.targetDate],
    ["Target venue", details.targetVenue],
    ["Cups to serve", details.cupsToServe],
    ["Pax", details.pax],
    ["Confidence", details.confidenceScore]
  ]);

  renderTimeline(data.statusEvents || []);
  renderConversations(data.conversationSnapshots || []);
}

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await updateLeadStatus(leadId, statusSelect.value, statusNote.value.trim());
    statusNote.value = "";
    await loadLead();
  } catch (err) {
    window.alert(err.message);
  }
});

loadLead().catch((err) => {
  leadTitle.textContent = `Error: ${err.message}`;
});

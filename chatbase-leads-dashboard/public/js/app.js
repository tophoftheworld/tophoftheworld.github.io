import { listLeads, triggerSync } from "./api.js";

const tbody = document.getElementById("leads-tbody");
const leadsCount = document.getElementById("leads-count");
const form = document.getElementById("filters-form");
const resetBtn = document.getElementById("reset-filters-btn");
const syncNowBtn = document.getElementById("sync-now-btn");

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function statusPill(status) {
  return `<span class="status-pill status-${status || "new"}">${status || "new"}</span>`;
}

function bookingSummary(details) {
  if (!details) return "-";
  const parts = [];
  if (details.targetDate) parts.push(`Date: ${details.targetDate}`);
  if (details.targetVenue) parts.push(`Venue: ${details.targetVenue}`);
  if (details.cupsToServe) parts.push(`Cups: ${details.cupsToServe}`);
  if (details.pax) parts.push(`Pax: ${details.pax}`);
  return parts.length ? parts.join(" | ") : "-";
}

function renderRows(leads) {
  if (!leads.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No leads found.</td></tr>';
    return;
  }
  tbody.innerHTML = leads.map((lead) => `
    <tr>
      <td>
        <a class="lead-link" href="lead.html?id=${encodeURIComponent(lead.id)}">${lead.name || "(no name)"}</a><br>
        <small class="subtle">${lead.email || "-"} | ${lead.phone || "-"}</small>
      </td>
      <td>${lead.inquiryType || "unknown"}</td>
      <td>${statusPill(lead.status)}</td>
      <td>${bookingSummary(lead.bookingDetails)}</td>
      <td>${formatDate(lead.lastMessageAt || lead.updatedAt || lead.createdAt)}</td>
    </tr>
  `).join("");
}

function updateKpis(leads) {
  const stats = leads.reduce((acc, lead) => {
    const status = lead.status || "new";
    acc.total += 1;
    acc[status] = (acc[status] || 0) + 1;
    if (lead.missingRequiredFields || status === "follow_up") acc.needsAttention += 1;
    return acc;
  }, { total: 0, new: 0, qualified: 0, needsAttention: 0 });

  document.getElementById("kpi-total").textContent = String(stats.total);
  document.getElementById("kpi-new").textContent = String(stats.new || 0);
  document.getElementById("kpi-qualified").textContent = String(stats.qualified || 0);
  document.getElementById("kpi-needs-attention").textContent = String(stats.needsAttention || 0);
}

function formToFilters() {
  const formData = new FormData(form);
  return {
    status: formData.get("status"),
    inquiryType: formData.get("inquiryType"),
    missingRequired: formData.get("missingRequired"),
    search: formData.get("search")?.trim(),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate")
  };
}

async function loadLeads(filters = {}) {
  try {
    const result = await listLeads(filters);
    const leads = result.data || [];
    renderRows(leads);
    updateKpis(leads);
    leadsCount.textContent = `${leads.length} records`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${err.message}</td></tr>`;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadLeads(formToFilters());
});

resetBtn.addEventListener("click", () => {
  form.reset();
  loadLeads();
});

syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  const previousText = syncNowBtn.textContent;
  syncNowBtn.textContent = "Syncing...";
  try {
    await triggerSync();
    await loadLeads(formToFilters());
  } catch (err) {
    window.alert(`Sync failed: ${err.message}`);
  } finally {
    syncNowBtn.disabled = false;
    syncNowBtn.textContent = previousText;
  }
});

loadLeads();

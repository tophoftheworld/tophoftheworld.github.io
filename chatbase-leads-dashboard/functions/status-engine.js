const TERMINAL_STATUSES = new Set(["won", "lost"]);

function normalizeStatus(value) {
  return String(value || "new").toLowerCase();
}

function decideAutoStatus(lead, hasRequiredFields) {
  const currentStatus = normalizeStatus(lead.status);
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return { nextStatus: currentStatus, reason: "terminal-status" };
  }
  if (currentStatus === "proposal_sent") {
    return { nextStatus: currentStatus, reason: "proposal-already-sent" };
  }
  if (hasRequiredFields) {
    return { nextStatus: "qualified", reason: "required-fields-captured" };
  }

  const createdAt = new Date(lead.createdAt || Date.now());
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours >= 24) {
    return { nextStatus: "follow_up", reason: "incomplete-over-24h" };
  }

  return { nextStatus: "new", reason: "default-new" };
}

function buildStatusEvent({ fromStatus, toStatus, triggerType, note }) {
  return {
    fromStatus: normalizeStatus(fromStatus),
    toStatus: normalizeStatus(toStatus),
    triggerType: triggerType || "auto",
    note: note || "",
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  decideAutoStatus,
  buildStatusEvent
};

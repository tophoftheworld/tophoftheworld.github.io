export const PIPELINE_STATUSES = [
  { value: "inquiry", label: "Inquiry" },
  { value: "quoted", label: "Quoted" },
  { value: "invoiced", label: "Invoiced" },
  { value: "deposit", label: "Deposit" },
  { value: "completed", label: "Completed" }
];

const PIPELINE_RANK = {
  inquiry: 0,
  quoted: 1,
  invoiced: 2,
  deposit: 3,
  completed: 4
};

export function hasQuotedPrice(row) {
  return Boolean(row?.quotedPrice && String(row.quotedPrice).trim());
}

export function getProfileStatus(row) {
  return row?.profileStatus || row?.status || "draft";
}

/** Effective pipeline for display/filter: quoted when price exists unless already past quoted. */
export function getPipelineStatus(row) {
  const stored = row?.pipelineStatus || "inquiry";
  const rank = PIPELINE_RANK[stored] ?? 0;
  if (rank >= PIPELINE_RANK.quoted) return stored;
  if (hasQuotedPrice(row)) return "quoted";
  return stored;
}

export function pipelineStatusLabel(value) {
  const match = PIPELINE_STATUSES.find((s) => s.value === value);
  return match ? match.label : value || "—";
}

export function pipelineStatusBadgeHtml(value) {
  const v = value || "inquiry";
  const label = pipelineStatusLabel(v);
  return `<span class="lead-pipeline lead-pipeline-${v}" title="Status: ${label}">${label}</span>`;
}

export function profileIncompleteBadgeHtml(row) {
  if (getProfileStatus(row) !== "draft") return "";
  return ' <span class="leads-profile-incomplete" title="Missing some quote fields">Incomplete</span>';
}

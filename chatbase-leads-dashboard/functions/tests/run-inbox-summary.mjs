const TOKEN = "cbld-local-admin-f9b5c4d4-2ea9-4f52-90f2-fac23e0955d7";
const BASE = "http://127.0.0.1:8080/api/inbox/summary";
const date = process.argv[2] || "";

async function fetchSummary(params) {
  const q = new URLSearchParams(params);
  const url = `${BASE}?${q}`;
  const res = await fetch(url, {
    headers: { "x-admin-token": TOKEN },
    signal: AbortSignal.timeout(120000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || res.statusText);
  return body.data;
}

async function runPhase(phaseKey, startParam) {
  let index = 0;
  let total = 1;
  const sections = [];

  while (index < total) {
    const params = { date, filteredSources: "" };
    params[startParam] = index;
    const result = await fetchSummary(params);
    const meta = result.meta || {};
    total = phaseKey === "day" ? meta.totalBatches || 1 : meta.totalPendingBatches || 1;
    const label = phaseKey === "day" ? `day batch ${index + 1}/${total}` : `pending batch ${index + 1}/${total}`;
    console.log(`OK ${label} — threads ${meta.threadsInBatch ?? 0}, messages ${meta.messageCount ?? "n/a"}`);
    sections.push(result);
    if (meta.complete) break;
    index += 1;
  }
  return sections;
}

try {
  console.log("Running inbox summary", date || "(today)");
  await runPhase("day", "batch");
  console.log("Day phase complete");
  await runPhase("pending", "pendingBatch");
  console.log("Pending phase complete");
  console.log("All batches succeeded");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}

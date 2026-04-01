/**
 * Shopify orders table — live via /api/orders (local server) or CSV import.
 */
/* global Papa */

const els = {
    banner: document.getElementById("fileBanner"),
    status: document.getElementById("statusBar"),
    summary: document.getElementById("summaryCards"),
    tbody: document.querySelector("#ordersTable tbody"),
    btnRefresh: document.getElementById("btnRefresh"),
    btnLoadMore: document.getElementById("btnLoadMore"),
    btnImport: document.getElementById("btnImportCsv"),
    fileInput: document.getElementById("csvFile"),
    search: document.getElementById("searchInput"),
    finStatus: document.getElementById("filterFinancial"),
    fulStatus: document.getElementById("filterFulfillment"),
    sourceLive: document.getElementById("sourceLive"),
    sourceCsv: document.getElementById("sourceCsv"),
};

const state = {
    rows: [],
    nextPageInfo: null,
    shopHandle: null,
    sortKey: "created_at",
    sortDir: "desc",
    source: "live",
    loading: false,
};

function isLiveHost() {
    return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function setStatus(msg, isError = false) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", Boolean(isError));
}

function normalizeApiOrder(o) {
    const c = o.customer;
    const custName = c
        ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
        : "";
    return {
        id: o.id,
        name: o.name || "",
        created_at: o.created_at || "",
        customer: custName || o.email || "—",
        email: o.email || "",
        total: o.total_price ?? "",
        currency: o.currency || "",
        financial_status: o.financial_status || "—",
        fulfillment_status: o.fulfillment_status || "—",
    };
}

function csvCell(row, ...names) {
    const keys = Object.keys(row);
    for (const n of names) {
        const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
        if (k !== undefined && row[k] != null && String(row[k]).trim() !== "") {
            return String(row[k]).trim();
        }
    }
    return "";
}

function normalizeCsvRow(row) {
    const name = csvCell(row, "Name", "name");
    const created = csvCell(row, "Created at", "Created At", "created at");
    const email = csvCell(row, "Email", "email");
    const billingName = csvCell(row, "Billing Name", "billing name");
    const total = csvCell(row, "Total", "total");
    const cur = csvCell(row, "Currency", "currency");
    const fin = csvCell(row, "Financial Status", "financial status");
    const ful = csvCell(row, "Fulfillment Status", "fulfillment status");
    return {
        id: csvCell(row, "Id", "ID") || name,
        name: name || "—",
        created_at: created || "",
        customer: billingName || email || "—",
        email,
        total,
        currency: cur,
        financial_status: fin || "—",
        fulfillment_status: ful || "—",
    };
}

function adminOrderUrl(orderId) {
    if (!state.shopHandle || !orderId) return null;
    return `https://admin.shopify.com/store/${state.shopHandle}/orders/${orderId}`;
}

function formatMoney(total, currency) {
    if (total === "" || total == null) return "—";
    const n = Number(total);
    if (Number.isNaN(n)) return String(total);
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currency || "USD",
        }).format(n);
    } catch {
        return `${total} ${currency || ""}`.trim();
    }
}

function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

function updateSummary() {
    const filtered = getFilteredRows();
    els.summary.innerHTML = `
        <div class="summary-card">
            <div class="card-title">Orders shown</div>
            <div class="card-value">${filtered.length}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Loaded total</div>
            <div class="card-value">${state.rows.length}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Data source</div>
            <div class="card-value" style="font-size:1.1rem">${state.source === "live" ? "Live API" : "CSV file"}</div>
        </div>`;
}

function getFilteredRows() {
    const q = (els.search.value || "").trim().toLowerCase();
    const fin = els.finStatus.value;
    const ful = els.fulStatus.value;
    return state.rows.filter((r) => {
        if (fin && r.financial_status !== fin) return false;
        if (ful && r.fulfillment_status !== ful) return false;
        if (!q) return true;
        const blob = [
            r.name,
            r.customer,
            r.email,
            r.financial_status,
            r.fulfillment_status,
        ]
            .join(" ")
            .toLowerCase();
        return blob.includes(q);
    });
}

function sortRowsInPlace(list) {
    const k = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
        let va = a[k];
        let vb = b[k];
        if (k === "created_at") {
            va = new Date(va).getTime() || 0;
            vb = new Date(vb).getTime() || 0;
        } else if (k === "total") {
            va = Number(va) || 0;
            vb = Number(vb) || 0;
        } else {
            va = String(va || "").toLowerCase();
            vb = String(vb || "").toLowerCase();
        }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

function renderTable() {
    const list = getFilteredRows();
    sortRowsInPlace(list);
    els.tbody.innerHTML = list
        .map((r) => {
            const url = adminOrderUrl(r.id);
            const link = url
                ? `<a href="${url}" target="_blank" rel="noopener">Open</a>`
                : "—";
            return `<tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(formatDate(r.created_at))}</td>
                <td>${escapeHtml(r.customer)}</td>
                <td class="num">${escapeHtml(formatMoney(r.total, r.currency))}</td>
                <td><span class="status-pill">${escapeHtml(r.financial_status)}</span></td>
                <td><span class="status-pill">${escapeHtml(r.fulfillment_status)}</span></td>
                <td class="actions">${link}</td>
            </tr>`;
        })
        .join("");
    updateSummary();
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function fetchConfig() {
    if (!isLiveHost()) return;
    try {
        const res = await fetch("/api/config");
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg.shop) state.shopHandle = cfg.shop;
    } catch {
        /* ignore */
    }
}

async function fetchOrders(append = false) {
    if (!isLiveHost()) {
        setStatus("Open this app via Open-Dashboard.cmd for live orders, or import a CSV.", true);
        return;
    }
    const qs = new URLSearchParams();
    qs.set("limit", "50");
    if (append && state.nextPageInfo) {
        qs.set("page_info", state.nextPageInfo);
    }
    state.loading = true;
    els.btnRefresh.disabled = true;
    els.btnLoadMore.disabled = true;
    setStatus(append ? "Loading more…" : "Loading orders…");
    try {
        const res = await fetch(`/api/orders?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText || "Request failed");
        }
        const batch = (data.orders || []).map(normalizeApiOrder);
        if (!append) state.rows = [];
        state.rows = state.rows.concat(batch);
        state.nextPageInfo = data.nextPageInfo || null;
        state.source = "live";
        setStatus(
            `Loaded ${batch.length} orders${append ? " (more)" : ""}${state.nextPageInfo ? " — more available" : ""}.`
        );
        populateFilterOptions();
        renderTable();
    } catch (e) {
        setStatus(e.message || String(e), true);
    } finally {
        state.loading = false;
        els.btnRefresh.disabled = false;
        els.btnLoadMore.disabled = !state.nextPageInfo;
    }
}

function populateFilterOptions() {
    const fins = [...new Set(state.rows.map((r) => r.financial_status))].filter(
        (x) => x && x !== "—"
    );
    const fuls = [...new Set(state.rows.map((r) => r.fulfillment_status))].filter(
        (x) => x && x !== "—"
    );
    const keepFin = els.finStatus.value;
    const keepFul = els.fulStatus.value;
    els.finStatus.innerHTML =
        '<option value="">All payment statuses</option>' +
        fins.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    els.fulStatus.innerHTML =
        '<option value="">All fulfillment</option>' +
        fuls.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
    if (fins.includes(keepFin)) els.finStatus.value = keepFin;
    if (fuls.includes(keepFul)) els.fulStatus.value = keepFul;
}

function onCsvSelected(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    setStatus("Parsing CSV…");
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = Papa.parse(reader.result, {
                header: true,
                skipEmptyLines: true,
            });
            if (parsed.errors && parsed.errors.length) {
                console.warn(parsed.errors);
            }
            state.rows = (parsed.data || []).map(normalizeCsvRow).filter((r) => r.name !== "—" || r.email);
            state.nextPageInfo = null;
            state.source = "csv";
            state.shopHandle = null;
            setStatus(`Imported ${state.rows.length} rows from ${file.name}.`);
            populateFilterOptions();
            renderTable();
            els.btnLoadMore.disabled = true;
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    };
    reader.readAsText(file, "UTF-8");
    ev.target.value = "";
}

function onSourceChange(mode) {
    state.source = mode;
    els.sourceLive.classList.toggle("active", mode === "live");
    els.sourceCsv.classList.toggle("active", mode === "csv");
    els.btnRefresh.disabled = mode === "csv";
    if (mode === "live") {
        els.banner.classList.add("hidden");
        if (isLiveHost()) fetchOrders(false);
    } else {
        els.banner.classList.remove("hidden");
        els.banner.textContent =
            "Export from Shopify Admin: Orders → Export. Then use Choose CSV (includes standard order export columns).";
        state.rows = [];
        state.nextPageInfo = null;
        setStatus("Choose a Shopify orders export CSV (Admin → Orders → Export).");
        renderTable();
        els.btnLoadMore.disabled = true;
    }
}

function setupSortHeaders() {
    document.querySelectorAll("#ordersTable th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
            const k = th.getAttribute("data-sort");
            if (state.sortKey === k) {
                state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
            } else {
                state.sortKey = k;
                state.sortDir = k === "created_at" ? "desc" : "asc";
            }
            renderTable();
        });
    });
}

function initUi() {
    if (isLiveHost()) {
        els.banner.classList.add("hidden");
    } else {
        els.banner.classList.remove("hidden");
        els.banner.textContent =
            "You opened this page as a file or from a host without the local server. Use shopify-orders/Open-Dashboard.cmd for live Shopify data, or stay on Import CSV below.";
        els.sourceLive.disabled = true;
        els.sourceLive.title = "Requires local server (Open-Dashboard.cmd)";
        els.btnRefresh.disabled = true;
        els.btnLoadMore.disabled = true;
    }

    els.btnRefresh.addEventListener("click", () => fetchOrders(false));
    els.btnLoadMore.addEventListener("click", () => fetchOrders(true));
    els.btnImport.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", onCsvSelected);
    els.search.addEventListener("input", () => renderTable());
    els.finStatus.addEventListener("change", () => renderTable());
    els.fulStatus.addEventListener("change", () => renderTable());
    els.sourceLive.addEventListener("click", () => onSourceChange("live"));
    els.sourceCsv.addEventListener("click", () => onSourceChange("csv"));

    setupSortHeaders();

    if (!isLiveHost()) {
        onSourceChange("csv");
    }
}

async function boot() {
    initUi();
    await fetchConfig();
    if (isLiveHost() && state.source === "live") {
        await fetchOrders(false);
    } else {
        renderTable();
    }
}

boot();




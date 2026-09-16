const PUBLIC_API_ORIGIN = "https://matchanese-attendance.web.app";
const POLL_MS = 20000;

let currentInvoice = null;
let pollTimer = null;
let publicToken = "";
let choiceModalState = null;

function readPublicToken() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get("t") || "").trim();
  if (fromQuery) return fromQuery;
  const parts = window.location.pathname.split("/").filter(Boolean);
  const iIdx = parts.indexOf("i");
  if (iIdx >= 0 && parts[iIdx + 1] && parts[iIdx + 1] !== "index.html") {
    return decodeURIComponent(parts[iIdx + 1]);
  }
  return "";
}

function getInvoiceApiUrl(token) {
  const encoded = encodeURIComponent(token);
  const { hostname, origin, port } = window.location;
  if (
    hostname === "matchanese-attendance.web.app" ||
    hostname === "matchanese-attendance.firebaseapp.com" ||
    hostname === "matchanese-invoice.web.app" ||
    hostname === "matchanese-invoice.firebaseapp.com"
  ) {
    return `${origin}/api/invoices/${encoded}`;
  }
  if (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    (port === "5000" || port === "5002" || port === "8080")
  ) {
    return `${origin}/api/invoices/${encoded}`;
  }
  return `${PUBLIC_API_ORIGIN}/api/invoices/${encoded}`;
}

function getChoiceDrinksApiUrl(token) {
  return `${getInvoiceApiUrl(token)}/choice-drinks`;
}

function getPaymentProofExtractUrl(token) {
  return `${getInvoiceApiUrl(token)}/payment-proof/extract`;
}

function getPaymentProofConfirmUrl(token) {
  return `${getInvoiceApiUrl(token)}/payment-proof/confirm`;
}

let paymentProofState = null;
let paymentProofBusy = false;

const PAYMENT_METHOD_LABELS = {
  gcash: "GCash",
  maya: "Maya",
  gotyme: "GoTyme",
  bank: "Bank transfer",
  other: "Other"
};

function formatProofAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `Php ${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatProofMethod(method) {
  const key = String(method || "other").toLowerCase();
  return PAYMENT_METHOD_LABELS[key] || PAYMENT_METHOD_LABELS.other;
}

function formatProofDate(isoDate) {
  const raw = String(isoDate || "").trim();
  if (!raw) return "—";
  if (window.InvoicePageRender?.formatDate) {
    return window.InvoicePageRender.formatDate(raw);
  }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function setVisible(el, visible) {
  if (!el) return;
  el.hidden = !visible;
  el.classList.toggle("is-hidden", !visible);
}

function setPaymentProofBusy(busy, message = "Reading screenshot…") {
  paymentProofBusy = !!busy;
  const zone = document.getElementById("paymentProofDropzone");
  const input = document.getElementById("paymentProofFile");
  const busyEl = document.getElementById("paymentProofBusy");
  const busyText = document.getElementById("paymentProofBusyText");
  const confirmBtn = document.getElementById("paymentProofConfirmBtn");
  const removeBtn = document.getElementById("paymentProofRemoveBtn");

  if (zone) {
    zone.classList.toggle("is-processing", paymentProofBusy && !paymentProofState);
    zone.classList.toggle("is-review", !!paymentProofState);
    zone.setAttribute("aria-busy", paymentProofBusy ? "true" : "false");
  }
  if (input) input.disabled = paymentProofBusy || !!paymentProofState;
  if (busyText && message) busyText.textContent = message;
  setVisible(busyEl, paymentProofBusy && !paymentProofState);
  if (paymentProofState) setVisible(document.getElementById("paymentProofReview"), true);
  if (confirmBtn) {
    confirmBtn.disabled = paymentProofBusy || !paymentProofState;
    confirmBtn.classList.toggle("is-busy", paymentProofBusy && !!paymentProofState);
  }
  if (removeBtn) removeBtn.disabled = paymentProofBusy;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function setPaymentProofStatus(message, { error } = {}) {
  const el = document.getElementById("paymentProofStatus");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    setVisible(el, false);
    el.classList.remove("is-error");
    return;
  }
  el.textContent = message;
  setVisible(el, true);
  el.classList.toggle("is-error", !!error);
}

function setPaymentProofError(message) {
  const el = document.getElementById("paymentProofError");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    setVisible(el, false);
    return;
  }
  el.textContent = message;
  setVisible(el, true);
}

function showPaymentProofReview(extracted, dataUrl, mimeType) {
  const zone = document.getElementById("paymentProofDropzone");
  const review = document.getElementById("paymentProofReview");
  const preview = document.getElementById("paymentProofPreview");
  const confirmBtn = document.getElementById("paymentProofConfirmBtn");
  const busyEl = document.getElementById("paymentProofBusy");
  const amount = extracted.amount != null ? Number(extracted.amount) : null;
  const method = extracted.paymentMethod || "other";
  const reference = String(extracted.referenceNumber || "").trim();
  const paidAt = String(extracted.paidAt || "").trim();
  const amountOk = Number.isFinite(amount) && amount > 0;
  const lowConfidence =
    extracted.confidence != null && Number(extracted.confidence) < 0.4;
  const needsClearer =
    !!extracted.needsClearerScreenshot || !amountOk || lowConfidence;

  paymentProofBusy = false;
  paymentProofState = {
    imageBase64: dataUrl,
    mimeType,
    milestoneId: extracted.milestoneId ?? null,
    amount: amountOk ? amount : null,
    paymentMethod: method,
    referenceNumber: reference,
    paidAt,
    canConfirm: !needsClearer
  };

  if (preview) preview.src = dataUrl;
  const amountEl = document.getElementById("paymentProofAmountDisplay");
  const methodEl = document.getElementById("paymentProofMethodDisplay");
  const refEl = document.getElementById("paymentProofReferenceDisplay");
  const dateEl = document.getElementById("paymentProofDateDisplay");
  if (amountEl) amountEl.textContent = formatProofAmount(amountOk ? amount : null);
  if (methodEl) methodEl.textContent = formatProofMethod(method);
  if (refEl) {
    refEl.textContent = reference || "—";
    refEl.title = reference || "";
  }
  if (dateEl) dateEl.textContent = formatProofDate(paidAt);

  setVisible(busyEl, false);
  setVisible(review, true);
  setVisible(confirmBtn, true);
  if (zone) {
    zone.classList.remove("is-processing", "is-dragover");
    zone.classList.add("is-review");
    zone.setAttribute("aria-busy", "false");
  }
  const input = document.getElementById("paymentProofFile");
  if (input) input.disabled = true;
  if (confirmBtn) {
    confirmBtn.disabled = needsClearer;
    confirmBtn.textContent = "Confirm payment";
    confirmBtn.classList.toggle("is-busy", false);
    confirmBtn.classList.toggle("is-disabled", needsClearer);
  }
  const removeBtn = document.getElementById("paymentProofRemoveBtn");
  if (removeBtn) removeBtn.disabled = false;
  setPaymentProofError("");
  if (needsClearer) {
    setPaymentProofStatus(
      "Couldn’t verify payment details clearly. Try a clearer screenshot with the amount visible.",
      { error: true }
    );
  } else {
    setPaymentProofStatus("");
  }
}

function restorePaymentProofUi() {
  if (!paymentProofState?.imageBase64) return;
  showPaymentProofReview(
    {
      amount: paymentProofState.amount,
      paymentMethod: paymentProofState.paymentMethod,
      referenceNumber: paymentProofState.referenceNumber,
      paidAt: paymentProofState.paidAt,
      milestoneId: paymentProofState.milestoneId
    },
    paymentProofState.imageBase64,
    paymentProofState.mimeType
  );
}

function resetPaymentProofUpload() {
  paymentProofState = null;
  paymentProofBusy = false;
  const zone = document.getElementById("paymentProofDropzone");
  const input = document.getElementById("paymentProofFile");
  const review = document.getElementById("paymentProofReview");
  const preview = document.getElementById("paymentProofPreview");
  const confirmBtn = document.getElementById("paymentProofConfirmBtn");
  const busyEl = document.getElementById("paymentProofBusy");

  if (zone) {
    zone.classList.remove("is-processing", "is-review", "is-dragover");
    zone.setAttribute("aria-busy", "false");
  }
  if (input) {
    input.disabled = false;
    input.value = "";
  }
  if (preview) preview.removeAttribute("src");
  setVisible(review, false);
  setVisible(busyEl, false);
  setVisible(confirmBtn, false);
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Confirm payment";
    confirmBtn.classList.remove("is-busy");
  }
  setPaymentProofError("");
  setPaymentProofStatus("");
}

async function handlePaymentProofFileChange(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (!file || !publicToken) return;
  if (paymentProofBusy || paymentProofState) {
    if (input) input.value = "";
    return;
  }
  if (!String(file.type || "").startsWith("image/")) {
    setPaymentProofStatus("Please upload an image file.", { error: true });
    if (input) input.value = "";
    return;
  }

  setPaymentProofError("");
  setPaymentProofStatus("");
  setPaymentProofBusy(true, "Reading screenshot…");

  try {
    const dataUrl = await fileToDataUrl(file);
    setPaymentProofBusy(true, "Verifying screenshot…");
    const response = await fetch(getPaymentProofExtractUrl(publicToken), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: dataUrl,
        mimeType: file.type || "image/jpeg"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `Could not read screenshot (${response.status})`);
    }
    paymentProofBusy = false;
    showPaymentProofReview(payload.data || {}, dataUrl, file.type || "image/jpeg");
  } catch (err) {
    console.error(err);
    resetPaymentProofUpload();
    setPaymentProofStatus(err.message || "Could not read screenshot.", { error: true });
  } finally {
    if (input) input.value = "";
  }
}

async function handlePaymentProofConfirm() {
  if (paymentProofBusy) return;
  if (!publicToken || !paymentProofState?.imageBase64) {
    setPaymentProofError("Upload a screenshot first.");
    return;
  }
  if (!paymentProofState.canConfirm || !(Number(paymentProofState.amount) > 0)) {
    setPaymentProofError(
      "Couldn’t verify a payment amount from this screenshot. Please upload a clearer image."
    );
    return;
  }
  const btn = document.getElementById("paymentProofConfirmBtn");
  const original = btn?.textContent || "Confirm payment";
  setPaymentProofError("");
  setPaymentProofBusy(true, "Confirming payment…");
  if (btn) {
    setVisible(btn, true);
    btn.textContent = "Confirming…";
  }

  try {
    const panel = document.getElementById("paymentProofPanel");
    const response = await fetch(getPaymentProofConfirmUrl(publicToken), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: paymentProofState.imageBase64,
        mimeType: paymentProofState.mimeType,
        milestoneId:
          paymentProofState.milestoneId ||
          panel?.dataset?.milestoneId ||
          undefined,
        amount: paymentProofState.amount,
        paymentMethod: paymentProofState.paymentMethod,
        referenceNumber: paymentProofState.referenceNumber,
        paidAt: paymentProofState.paidAt
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `Confirm failed (${response.status})`);
    }
    paymentProofState = null;
    currentInvoice = payload.data?.invoice || currentInvoice;
    if (currentInvoice) {
      renderInvoice(currentInvoice);
      showLoaded();
    } else {
      await refreshInvoice(publicToken);
    }
    openPaymentReceivedModal(currentInvoice);
  } catch (err) {
    console.error(err);
    setPaymentProofError(err.message || "Could not confirm payment.");
    paymentProofBusy = false;
    setPaymentProofBusy(false);
    if (btn) {
      setVisible(btn, true);
      btn.disabled = !(paymentProofState?.canConfirm);
      btn.textContent = original;
      btn.classList.remove("is-busy");
    }
  }
}

function openPaymentReceivedModal(invoice) {
  const overlay = document.getElementById("paymentReceivedModal");
  if (!overlay) return;
  const copyEl = document.getElementById("paymentReceivedCopy");
  const pendingEl = document.getElementById("paymentReceivedPending");
  const doc = invoice || currentInvoice || {};
  const paid = Number(doc.amountPaid);
  const remaining = Number(doc.amountRemaining);
  const dueNow = Number(doc.amountDueNow);
  const dueLabel = String(doc.dueLabel || "").trim();
  const formatMoney = (n) =>
    window.InvoicePageRender?.formatCurrency
      ? window.InvoicePageRender.formatCurrency(n)
      : Number(n || 0).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
  const escapeText = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  if (copyEl) {
    copyEl.textContent =
      "Thanks — we got your payment screenshot. Our team will also manually verify it.";
  }
  if (pendingEl) {
    pendingEl.classList.remove("is-paid");
    if (Number.isFinite(remaining) && remaining > 0.5) {
      const pendingAmt = Number.isFinite(dueNow) && dueNow > 0.5 ? dueNow : remaining;
      const milestoneLabel =
        dueLabel && dueLabel !== "Paid in full" && dueLabel !== "Amount due"
          ? dueLabel
          : "";
      const showInvoiceTotal =
        Number.isFinite(paid) &&
        paid > 0 &&
        Number.isFinite(remaining) &&
        remaining > pendingAmt + 0.5;
      const dueCaption = milestoneLabel
        ? `Still due · ${milestoneLabel}`
        : "Still due";
      pendingEl.innerHTML = `
        <div class="inv-received-balance">
          <div class="inv-received-stat">
            <span class="inv-received-stat-label">${escapeText(dueCaption)}</span>
            <span class="inv-received-stat-value">₱${formatMoney(pendingAmt)}</span>
          </div>
          ${
            showInvoiceTotal
              ? `<div class="inv-received-stat">
            <span class="inv-received-stat-label">Total left on invoice</span>
            <span class="inv-received-stat-value">₱${formatMoney(remaining)}</span>
          </div>`
              : ""
          }
        </div>
      `;
      showEl(pendingEl, true);
    } else if (Number.isFinite(remaining) && remaining <= 0.5 && Number.isFinite(paid) && paid > 0) {
      pendingEl.classList.add("is-paid");
      pendingEl.innerHTML =
        `<p class="inv-received-paid-note">This invoice is now paid in full (pending our verification).</p>`;
      showEl(pendingEl, true);
    } else {
      pendingEl.innerHTML = "";
      showEl(pendingEl, false);
    }
  }
  showEl(overlay, true);
  document.body.classList.add("inv-modal-open");
}

function closePaymentReceivedModal() {
  const overlay = document.getElementById("paymentReceivedModal");
  showEl(overlay, false);
  if (!choiceModalState) {
    const qr = document.getElementById("qrModal");
    if (!qr || qr.hidden) document.body.classList.remove("inv-modal-open");
  }
}

function setupPaymentProofUi() {
  const root = document.getElementById("invoicePageRoot");
  root?.addEventListener("change", (event) => {
    if (event.target?.id === "paymentProofFile") {
      void handlePaymentProofFileChange(event);
    }
  });
  root?.addEventListener("click", (event) => {
    if (event.target?.id === "paymentProofRemoveBtn" || event.target?.closest?.("#paymentProofRemoveBtn")) {
      event.preventDefault();
      if (paymentProofBusy) return;
      resetPaymentProofUpload();
      return;
    }
    if (event.target?.id === "paymentProofConfirmBtn" || event.target?.closest?.("#paymentProofConfirmBtn")) {
      event.preventDefault();
      void handlePaymentProofConfirm();
    }
  });

  const onDrag = (event) => {
    const zone = event.target?.closest?.("#paymentProofDropzone");
    if (!zone) return;
    event.preventDefault();
    if (paymentProofBusy || paymentProofState) return;
    if (event.type === "dragenter" || event.type === "dragover") {
      zone.classList.add("is-dragover");
    } else if (event.type === "dragleave" || event.type === "drop") {
      zone.classList.remove("is-dragover");
    }
    if (event.type === "drop") {
      const file = event.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const input = document.getElementById("paymentProofFile");
      if (!input || input.disabled) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      void handlePaymentProofFileChange({ target: input });
    }
  };
  root?.addEventListener("dragenter", onDrag);
  root?.addEventListener("dragover", onDrag);
  root?.addEventListener("dragleave", onDrag);
  root?.addEventListener("drop", onDrag);
}

function showEl(el, visible) {
  if (!el) return;
  el.classList.toggle("is-hidden", !visible);
  el.hidden = !visible;
}

function setMetaContent(selector, content) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute("content", content);
}

function applyInvoiceDocumentMeta(doc) {
  const invoiceNumber = String(doc?.invoiceNumber || "").trim();
  const clientName = String(doc?.clientName || "").trim();
  const clientCompany = String(doc?.clientCompany || "").trim();
  const client = clientName || clientCompany;
  const title = invoiceNumber
    ? client
      ? `${invoiceNumber} · ${client} | Matchanese`
      : `${invoiceNumber} | Matchanese Invoice`
    : "Invoice | Matchanese Matcha Bar";
  const description = invoiceNumber
    ? `Matchanese invoice ${invoiceNumber}${client ? ` for ${client}` : ""}. View booking details, payment schedule, and how to pay.`
    : "View your Matchanese invoice, booking details, and payment schedule.";

  document.title = title;
  setMetaContent('meta[name="description"]', description);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', description);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', description);
  if (typeof window !== "undefined" && window.location?.href) {
    setMetaContent('meta[property="og:url"]', window.location.href.split("#")[0]);
  }
}

function renderInvoice(doc) {
  const root = document.getElementById("invoicePageRoot");
  window.InvoicePageRender.renderInvoicePage(root, doc, { interactive: true });
  applyInvoiceDocumentMeta(doc);
  restorePaymentProofUi();
}

function updateChoiceModalCount() {
  const countEl = document.getElementById("choiceModalCount");
  const saveBtn = document.getElementById("choiceModalSave");
  if (!choiceModalState || !countEl) return;
  const selected = choiceModalState.selected.size;
  const slots = choiceModalState.slots;
  countEl.textContent = `${selected} of ${slots} selected`;
  if (saveBtn) saveBtn.disabled = false;
}

function openChoiceModal({ itemId, slots, includeCoffee, selected }) {
  const overlay = document.getElementById("choiceModal");
  const listEl = document.getElementById("choiceModalList");
  const titleEl = document.getElementById("choiceModalTitle");
  const errorEl = document.getElementById("choiceModalError");
  if (!overlay || !listEl || !window.InvoicePageRender) return;

  const catalog = window.InvoicePageRender.choiceDrinksCatalog(includeCoffee);
  choiceModalState = {
    itemId,
    slots,
    includeCoffee,
    selected: new Set(selected.filter((d) => catalog.includes(d)).slice(0, slots))
  };

  if (titleEl) {
    titleEl.textContent =
      slots === 1 ? "Choose your drink" : `Choose ${slots} drinks`;
  }
  if (errorEl) {
    errorEl.textContent = "";
    showEl(errorEl, false);
  }

  listEl.innerHTML = catalog
    .map((drink) => {
      const checked = choiceModalState.selected.has(drink) ? "checked" : "";
      const id = `choice-${drink.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return `<label class="inv-choice-modal-option" for="${id}">
        <input type="checkbox" id="${id}" value="${window.InvoicePageRender.escapeHtml(drink)}" ${checked}>
        <span>${window.InvoicePageRender.escapeHtml(drink)}</span>
      </label>`;
    })
    .join("");

  updateChoiceModalCount();
  showEl(overlay, true);
  document.body.classList.add("inv-modal-open");
}

function closeChoiceModal() {
  const overlay = document.getElementById("choiceModal");
  showEl(overlay, false);
  document.body.classList.remove("inv-modal-open");
  choiceModalState = null;
}

function handleChoiceListChange(event) {
  const input = event.target;
  if (!choiceModalState || !input || input.type !== "checkbox") return;
  const drink = input.value;
  if (input.checked) {
    if (choiceModalState.selected.size >= choiceModalState.slots) {
      input.checked = false;
      const errorEl = document.getElementById("choiceModalError");
      if (errorEl) {
        errorEl.textContent = `You can choose up to ${choiceModalState.slots}.`;
        showEl(errorEl, true);
      }
      return;
    }
    choiceModalState.selected.add(drink);
  } else {
    choiceModalState.selected.delete(drink);
  }
  const errorEl = document.getElementById("choiceModalError");
  if (errorEl) {
    errorEl.textContent = "";
    showEl(errorEl, false);
  }
  updateChoiceModalCount();
}

async function saveChoiceDrinks() {
  if (!choiceModalState || !publicToken) return;
  const saveBtn = document.getElementById("choiceModalSave");
  const errorEl = document.getElementById("choiceModalError");
  const drinks = [...choiceModalState.selected];
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }
  try {
    const response = await fetch(getChoiceDrinksApiUrl(publicToken), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: choiceModalState.itemId,
        drinks
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || "Unable to save drink choices");
    }
    currentInvoice = body.data || currentInvoice;
    renderInvoice(currentInvoice);
    closeChoiceModal();
  } catch (err) {
    console.error(err);
    if (errorEl) {
      errorEl.textContent = err.message || "Unable to save drink choices";
      showEl(errorEl, true);
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save choices";
    }
  }
}

function onInvoiceClick(event) {
  const copyBtn = event.target.closest("[data-copy]");
  if (copyBtn) {
    event.preventDefault();
    void copyPayText(copyBtn.getAttribute("data-copy") || "", copyBtn);
    return;
  }

  const qrBtn = event.target.closest("[data-qr-src]");
  if (qrBtn) {
    event.preventDefault();
    openQrModal({
      label: qrBtn.getAttribute("data-qr-label") || "QR",
      src: qrBtn.getAttribute("data-qr-src") || ""
    });
    return;
  }

  const proofBtn = event.target.closest("[data-proof-image]");
  if (proofBtn) {
    event.preventDefault();
    openProofImageModal(proofBtn.getAttribute("data-proof-image") || "");
    return;
  }

  const btn = event.target.closest("[data-choice-open]");
  if (!btn) return;
  const itemId = btn.getAttribute("data-item-id");
  const slots = parseInt(btn.getAttribute("data-slots"), 10) || 0;
  const includeCoffee = btn.getAttribute("data-coffee") === "1";
  const selected = String(btn.getAttribute("data-selected") || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!itemId || slots <= 0) return;
  openChoiceModal({ itemId, slots, includeCoffee, selected });
}

async function copyPayText(text, btn) {
  const value = String(text || "").trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  if (btn) {
    btn.classList.add("is-copied");
    window.setTimeout(() => btn.classList.remove("is-copied"), 1200);
  }
}

function openQrModal({ label, src }) {
  openImageModal({
    title: `${label} QR`,
    src,
    alt: `${label} payment QR code`
  });
}

function openProofImageModal(src) {
  openImageModal({
    title: "Payment proof",
    src,
    alt: "Payment screenshot"
  });
}

function openImageModal({ title, src, alt }) {
  const overlay = document.getElementById("qrModal");
  const img = document.getElementById("qrModalImage");
  const titleEl = document.getElementById("qrModalTitle");
  if (!overlay || !img || !src) return;
  img.src = src;
  img.alt = alt || title || "Image";
  if (titleEl) titleEl.textContent = title || "Image";
  overlay.classList.add("is-image-preview");
  showEl(overlay, true);
  document.body.classList.add("inv-modal-open");
}

function closeQrModal() {
  const overlay = document.getElementById("qrModal");
  const img = document.getElementById("qrModalImage");
  showEl(overlay, false);
  overlay?.classList.remove("is-image-preview");
  if (img) img.removeAttribute("src");
  if (!choiceModalState) document.body.classList.remove("inv-modal-open");
}

async function downloadPDF() {
  const btn = document.getElementById("downloadPDF");
  if (!currentInvoice || !window.InvoicePdfLegacy) return;

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    await window.InvoicePdfLegacy.downloadLegacyInvoicePdf(currentInvoice, {
      captureRoot: document.getElementById("pdfCaptureRoot")
    });
  } catch (err) {
    console.error(err);
    alert("Error generating PDF. Please try again.");
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function showNotFound() {
  showEl(document.getElementById("loadingState"), false);
  showEl(document.getElementById("invoicePageRoot"), false);
  showEl(document.getElementById("errorState"), true);
  document.getElementById("downloadPDF").disabled = true;
}

function showLoaded() {
  showEl(document.getElementById("loadingState"), false);
  showEl(document.getElementById("errorState"), false);
  showEl(document.getElementById("invoicePageRoot"), true);
  document.getElementById("downloadPDF").disabled = false;
}

async function loadInvoice(token) {
  const response = await fetch(getInvoiceApiUrl(token), { cache: "no-store" });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.data || null;
}

async function refreshInvoice(token, { quiet } = {}) {
  try {
    // Don't wipe an in-progress upload / confirm UI with a background poll.
    if (quiet && (paymentProofBusy || paymentProofState)) {
      const doc = await loadInvoice(token);
      if (doc) currentInvoice = doc;
      return;
    }
    const doc = await loadInvoice(token);
    if (!doc) {
      if (!quiet) showNotFound();
      return;
    }
    currentInvoice = doc;
    renderInvoice(doc);
    showLoaded();
  } catch (err) {
    console.error(err);
    if (!quiet && !currentInvoice) showNotFound();
  }
}

function setupChoiceModal() {
  const overlay = document.getElementById("choiceModal");
  const listEl = document.getElementById("choiceModalList");
  const closeBtn = document.getElementById("choiceModalClose");
  const cancelBtn = document.getElementById("choiceModalCancel");
  const saveBtn = document.getElementById("choiceModalSave");
  const root = document.getElementById("invoicePageRoot");
  const qrOverlay = document.getElementById("qrModal");
  const qrClose = document.getElementById("qrModalClose");

  root?.addEventListener("click", onInvoiceClick);
  listEl?.addEventListener("change", handleChoiceListChange);
  closeBtn?.addEventListener("click", closeChoiceModal);
  cancelBtn?.addEventListener("click", closeChoiceModal);
  saveBtn?.addEventListener("click", () => {
    void saveChoiceDrinks();
  });
  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) closeChoiceModal();
  });
  qrClose?.addEventListener("click", closeQrModal);
  qrOverlay?.addEventListener("click", (event) => {
    if (event.target === qrOverlay) closeQrModal();
  });
  const receivedOverlay = document.getElementById("paymentReceivedModal");
  const receivedClose = document.getElementById("paymentReceivedModalClose");
  const receivedOk = document.getElementById("paymentReceivedModalOk");
  receivedClose?.addEventListener("click", closePaymentReceivedModal);
  receivedOk?.addEventListener("click", closePaymentReceivedModal);
  receivedOverlay?.addEventListener("click", (event) => {
    if (event.target === receivedOverlay) closePaymentReceivedModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (choiceModalState) closeChoiceModal();
    else if (receivedOverlay && !receivedOverlay.hidden) closePaymentReceivedModal();
    else if (qrOverlay && !qrOverlay.hidden) closeQrModal();
  });
}

async function init() {
  publicToken = readPublicToken();
  document.getElementById("downloadPDF").addEventListener("click", downloadPDF);
  setupChoiceModal();
  setupPaymentProofUi();
  if (!publicToken) {
    showNotFound();
    return;
  }
  await refreshInvoice(publicToken);
  pollTimer = window.setInterval(() => {
    if (document.hidden || choiceModalState || paymentProofBusy || paymentProofState) return;
    refreshInvoice(publicToken, { quiet: true });
  }, POLL_MS);
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("pagehide", () => {
  if (pollTimer) window.clearInterval(pollTimer);
});

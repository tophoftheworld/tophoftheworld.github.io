/**
 * Legacy A4 PDF export — same document structure/styles as invoice-generator/index.html.
 */
(function (global) {
  const PAYMENT_METHODS = [
    { method: "BDO", name: "MATCHANESE INC", number: "000251640035" },
    { method: "Unionbank", name: "Cristopher David", number: "109420972821" },
    { method: "BPI", name: "Cristopher David", number: "0829677495" },
    { method: "GCash", name: "Cristopher David", number: "09496471857" },
    { method: "Maya", name: "Cristopher David", number: "09496471857" },
    { method: "GoTyme", name: "Cristopher David", number: "016694689311" }
  ];

  function assetBase() {
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i].src || "";
      if (src.includes("invoice-pdf-legacy.js")) {
        return src.replace(/\/js\/invoice-pdf-legacy\.js.*$/, "/");
      }
    }
    return "";
  }

  function imgUrl(name) {
    const base = assetBase();
    return base ? `${base}img/${name}` : `img/${name}`;
  }

  function escapeHtml(text) {
    if (global.InvoicePageRender && global.InvoicePageRender.escapeHtml) {
      return global.InvoicePageRender.escapeHtml(text);
    }
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatCurrency(amount) {
    if (global.InvoicePageRender && global.InvoicePageRender.formatCurrency) {
      return global.InvoicePageRender.formatCurrency(amount);
    }
    return parseFloat(amount || 0)
      .toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatDate(dateString) {
    if (global.InvoicePageRender && global.InvoicePageRender.formatDate) {
      return global.InvoicePageRender.formatDate(dateString);
    }
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  function shellHtml() {
    const logo = imgUrl("logo.png");
    const sign = imgUrl("sign.png");
    const banksLeft = PAYMENT_METHODS.slice(0, 3)
      .map(
        (p) => `<div class="bank-item">
          <strong>${escapeHtml(p.method)}</strong><br>
          Account Name: ${escapeHtml(p.name)}<br>
          Account Number: ${escapeHtml(p.number)}
        </div>`
      )
      .join("");
    const banksRight = PAYMENT_METHODS.slice(3)
      .map(
        (p) => `<div class="bank-item">
          <strong>${escapeHtml(p.method)}</strong><br>
          Account Name: ${escapeHtml(p.name)}<br>
          Account Number: ${escapeHtml(p.number)}
        </div>`
      )
      .join("");

    return `
      <div id="legacyPdfInvoice" class="invoice">
        <div class="invoice-header-logo">
          <img src="${logo}" alt="Matchanese Logo" class="company-logo" crossorigin="anonymous">
        </div>
        <div class="company-info">
          <div class="company-name">MATCHANESE, INC.</div>
          <div class="company-address">Unit 4506, Edades Tower, Amorsolo Drive, Rockwell, Makati City, Philippines</div>
          <div class="company-tin">TIN: 010-757-989-000</div>
        </div>
        <div class="invoice-title-section">
          <div class="invoice-title-row">
            <div class="invoice-title-left">
              <h1 class="invoice-title">BILLING INVOICE</h1>
            </div>
            <div class="invoice-title-right">
              <div class="invoice-date">
                <span class="date-label">Date:</span>
                <span class="date-value" data-pdf="invoiceDate"></span>
              </div>
            </div>
          </div>
          <div class="client-details">
            <div class="client-line">
              <span class="client-label">Billed to:</span>
              <span class="client-value" data-pdf="clientName"></span>
            </div>
            <div class="client-line" data-pdf="clientCompanyRow" style="display:none">
              <span class="client-label">Company:</span>
              <span class="client-value" data-pdf="clientCompany"></span>
            </div>
            <div class="client-line">
              <span class="client-label">Address:</span>
              <span class="client-value" data-pdf="clientAddress"></span>
            </div>
            <div class="client-line">
              <span class="client-label">TIN:</span>
              <span class="client-value" data-pdf="clientTIN"></span>
            </div>
          </div>
        </div>
        <div class="items-section">
          <table class="items-table">
            <thead>
              <tr>
                <th class="col-description">DESCRIPTION</th>
                <th class="col-unit-cost">Unit Cost</th>
                <th class="col-qty">Qty</th>
                <th class="col-line-subtotal">Subtotal</th>
              </tr>
            </thead>
            <tbody data-pdf="items"></tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="3" class="total-label"><strong>TOTAL AMOUNT DUE:</strong></td>
                <td class="total-amount text-right"><strong data-pdf="total">Php 0.00</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="invoice-footer">
          <div class="footer-content">
            <div class="footer-company">Matchanese, Inc.</div>
            <div class="footer-address">Unit 4506, Edades Tower,<br>Amorsolo Drive, Rockwell,<br>Makati City, Philippines</div>
          </div>
        </div>
      </div>

      <div id="legacyPdfPaymentTerms" class="invoice payment-terms-page">
        <div class="invoice-header-logo">
          <img src="${logo}" alt="Matchanese Logo" class="company-logo" crossorigin="anonymous">
        </div>
        <div class="payment-terms-section">
          <h2 class="section-title">PAYMENT TERMS</h2>
          <table class="payment-table">
            <thead>
              <tr>
                <th>MILESTONE</th>
                <th>DATE</th>
                <th data-pdf="paymentColHeader">PERCENTAGE</th>
                <th>AMOUNT</th>
              </tr>
            </thead>
            <tbody data-pdf="milestones"></tbody>
          </table>
        </div>
        <div class="payment-details-section">
          <h2 class="section-title">PAYMENT DETAILS</h2>
          <p class="payment-subtitle">Cash/check/bank deposit payable to:</p>
          <div class="bank-details">
            <div class="bank-column">${banksLeft}</div>
            <div class="bank-column">${banksRight}</div>
          </div>
          <p class="paypal-note"><em>Online Card Payment option via PayPal is also available via request.</em></p>
        </div>
        <div class="prepared-by-section">
          <div class="prepared-by-content signature-block-client">
            <p class="prepared-by-label">Confirmed by:</p>
            <div class="signature-space signature-blank" aria-hidden="true"></div>
            <p class="prepared-by-name"><strong data-pdf="clientSignName"></strong></p>
            <p class="prepared-by-company" data-pdf="clientSignCompany"></p>
          </div>
          <div class="prepared-by-content signature-block-prepared">
            <p class="prepared-by-label">Prepared by:</p>
            <div class="signature-space">
              <img src="${sign}" alt="Signature" class="signature-image" crossorigin="anonymous">
            </div>
            <p class="prepared-by-name"><strong>Cristopher David</strong></p>
            <p class="prepared-by-company">Matchanese, Inc.</p>
          </div>
        </div>
        <div class="invoice-footer">
          <div class="footer-content">
            <div class="footer-company">Matchanese, Inc.</div>
            <div class="footer-address">Unit 4506, Edades Tower,<br>Amorsolo Drive, Rockwell,<br>Makati City, Philippines</div>
          </div>
        </div>
      </div>
    `;
  }

  function packageDetailsHtml(line) {
    if (!line.sections || !line.sections.length) return "";
    const sections = line.sections
      .map((section) => {
        if (section.label === "Serving") {
          return `<div class="package-serving-line">${escapeHtml(section.items.join(" · "))}</div>`;
        }
        const items = section.items
          .map((item) => {
            const text =
              section.label === "Menu" &&
              global.InvoicePageRender &&
              typeof global.InvoicePageRender.displayMenuItemText === "function"
                ? global.InvoicePageRender.displayMenuItemText(item)
                : item;
            return `<div class="package-list-item">${escapeHtml(text)}</div>`;
          })
          .join("");
        return `<div class="package-section">
          <div class="package-section-label">${escapeHtml(section.label)}:</div>
          <div class="package-section-list">${items}</div>
        </div>`;
      })
      .join("");
    return `<div class="package-details-visual package-details-stacked package-details-mobile">${sections}</div>`;
  }

  function eventMetaHtml(line) {
    const parts = [];
    if (line.meta && line.meta.venue) {
      parts.push(`<strong>Venue:</strong> ${escapeHtml(line.meta.venue)}`);
    }
    if (line.meta && line.meta.date) {
      parts.push(`<strong>Date:</strong> ${escapeHtml(formatDate(line.meta.date))}`);
    }
    if (!parts.length) return "";
    return `<div class="event-meta">${parts.join('<span class="event-meta-sep"> · </span>')}</div>`;
  }

  function pricingCells(unitCost, qty, subtotal) {
    return `
      <td class="col-unit-cost text-right">Php ${formatCurrency(unitCost)}</td>
      <td class="col-qty text-right">${escapeHtml(String(qty))}</td>
      <td class="col-line-subtotal text-right">Php ${formatCurrency(subtotal)}</td>
    `;
  }

  function buildItemRowHtml(line) {
    const cups =
      line.kind === "package" && line.meta && line.meta.size
        ? `<div class="package-cups-subtitle">${escapeHtml(line.meta.size)}</div>`
        : "";
    const details = line.kind === "package" ? packageDetailsHtml(line) : "";
    const meta = line.kind === "package" ? eventMetaHtml(line) : "";
    const extraSections =
      line.kind !== "package" && line.sections && line.sections.length
        ? line.sections
            .map(
              (s) =>
                `<div class="custom-line-item-description">${s.items
                  .map((i) => `<p>${escapeHtml(i)}</p>`)
                  .join("")}</div>`
            )
            .join("")
        : "";
    return `<tr class="pdf-item-row">
      <td class="col-description">
        <div class="package-name">${escapeHtml(line.title)}</div>
        ${cups}
        ${details}
        ${extraSections}
        ${meta}
      </td>
      ${pricingCells(line.unitCost, line.qty, line.subtotal)}
    </tr>`;
  }

  function a4Px() {
    const mm = 96 / 25.4;
    return {
      pageW: Math.round(210 * mm),
      pageH: Math.round(297 * mm)
    };
  }

  function itemsCollideFooter(invoiceEl) {
    const footer = invoiceEl.querySelector(".invoice-footer");
    const items = invoiceEl.querySelector(".items-section");
    if (!footer || !items) return false;
    const f = footer.getBoundingClientRect();
    const s = items.getBoundingClientRect();
    return s.bottom > f.top - 4;
  }

  function applyInvoiceHeader(invoiceEl, doc, summary, { continued }) {
    const setText = (key, value) => {
      const el = invoiceEl.querySelector(`[data-pdf="${key}"]`);
      if (el) el.textContent = value || "";
    };

    if (continued) {
      // Overflow: same left logo as page 1; no MATCHANESE, INC. block / billed-to
      invoiceEl.classList.add("invoice-continued-page");
      const titleSection = invoiceEl.querySelector(".invoice-title-section");
      if (titleSection) titleSection.remove();
      const companyInfo = invoiceEl.querySelector(".company-info");
      if (companyInfo) companyInfo.remove();
      setText("total", `Php ${formatCurrency(summary.amountTotal)}`);
      return;
    }

    const titleEl = invoiceEl.querySelector(".invoice-title");
    if (titleEl) titleEl.textContent = "BILLING INVOICE";
    setText("invoiceDate", doc.invoiceDate ? formatDate(doc.invoiceDate) : "");
    const billedName = String(doc.clientName || "").trim();
    const billedCompany = String(doc.clientCompany || "").trim();
    setText("clientName", billedName || billedCompany || "");
    const companyRow = invoiceEl.querySelector('[data-pdf="clientCompanyRow"]');
    const companyVal = invoiceEl.querySelector('[data-pdf="clientCompany"]');
    if (companyRow && companyVal) {
      if (billedName && billedCompany) {
        companyVal.textContent = billedCompany;
        companyRow.style.display = "";
      } else {
        companyVal.textContent = "";
        companyRow.style.display = "none";
      }
    }
    setText("clientAddress", doc.clientAddress || "");
    setText("clientTIN", doc.clientTIN || "");
    setText("total", `Php ${formatCurrency(summary.amountTotal)}`);
  }

  function setItemsTfootVisible(invoiceEl, visible) {
    const tfoot = invoiceEl.querySelector(".items-table tfoot");
    if (tfoot) tfoot.style.display = visible ? "" : "none";
  }

  /**
   * Pack line items so a package that won't fit remaining space
   * starts on its own page (never clip under the footer).
   */
  async function packInvoiceItemPages(doc, summary) {
    const { pageW, pageH } = a4Px();
    const lines = Array.isArray(summary.lines) ? summary.lines : [];
    const rowHtmls = lines.length
      ? lines.map((line) => buildItemRowHtml(line))
      : [
          '<tr><td colspan="4" class="empty-state">No items added yet</td></tr>'
        ];

    const pages = [];
    let index = 0;

    while (index < rowHtmls.length) {
      const wrap = document.createElement("div");
      wrap.innerHTML = shellHtml();
      const payment = wrap.querySelector("#legacyPdfPaymentTerms");
      if (payment) payment.remove();
      const invoiceEl = wrap.querySelector("#legacyPdfInvoice");
      if (!invoiceEl) break;

      const continued = pages.length > 0;
      applyInvoiceHeader(invoiceEl, doc, summary, { continued });
      setItemsTfootVisible(invoiceEl, false);

      const host = document.createElement("div");
      host.className = "pdf-capture-root";
      host.style.cssText = [
        "position:fixed",
        "left:-12000px",
        "top:0",
        `width:${pageW}px`,
        `height:${pageH}px`,
        "overflow:hidden",
        "background:#ffffff",
        "z-index:-1",
        "pointer-events:none"
      ].join(";");
      invoiceEl.classList.add("pdf-capture");
      invoiceEl.style.cssText = [
        `width:${pageW}px`,
        `max-width:${pageW}px`,
        `height:${pageH}px`,
        `min-height:${pageH}px`,
        "margin:0",
        "box-shadow:none",
        "overflow:hidden",
        "position:relative",
        "left:0",
        "top:0"
      ].join(";");
      host.appendChild(invoiceEl);
      document.body.appendChild(host);

      // Wait for logo so header height is accurate when packing
      await Promise.all(
        [...invoiceEl.querySelectorAll("img")].map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
        })
      );

      const itemsEl = invoiceEl.querySelector('[data-pdf="items"]');
      itemsEl.innerHTML = "";
      const pageRows = [];

      while (index < rowHtmls.length) {
        const probe = document.createElement("tbody");
        probe.innerHTML = rowHtmls[index];
        const row = probe.firstElementChild;
        if (!row) {
          index += 1;
          continue;
        }
        itemsEl.appendChild(row);
        const isLastOverall = index === rowHtmls.length - 1;
        setItemsTfootVisible(invoiceEl, isLastOverall);
        // Force layout before measuring against the footer
        void invoiceEl.offsetHeight;

        if (itemsCollideFooter(invoiceEl) && pageRows.length > 0) {
          itemsEl.removeChild(row);
          setItemsTfootVisible(invoiceEl, false);
          break;
        }
        if (itemsCollideFooter(invoiceEl) && pageRows.length === 0) {
          // Oversized single row — still give it its own page
          pageRows.push(rowHtmls[index]);
          index += 1;
          break;
        }
        pageRows.push(rowHtmls[index]);
        index += 1;
      }

      const isLastItemsPage = index >= rowHtmls.length;
      setItemsTfootVisible(invoiceEl, isLastItemsPage);
      itemsEl.innerHTML =
        pageRows.join("") ||
        '<tr><td colspan="4" class="empty-state">No items added yet</td></tr>';

      host.remove();
      invoiceEl.style.cssText = "";
      invoiceEl.classList.remove("pdf-capture");
      pages.push(invoiceEl);
    }

    return pages;
  }

  function fillPaymentTerms(paymentEl, summary, doc) {
    if (!paymentEl) return;

    const billedName = String((doc && doc.clientName) || "").trim();
    const billedCompany = String((doc && doc.clientCompany) || "").trim();
    const clientNameEl = paymentEl.querySelector('[data-pdf="clientSignName"]');
    const clientCompanyEl = paymentEl.querySelector('[data-pdf="clientSignCompany"]');
    if (clientNameEl) {
      clientNameEl.textContent = billedName || billedCompany || "Client";
    }
    if (clientCompanyEl) {
      if (billedName && billedCompany) {
        clientCompanyEl.textContent = billedCompany;
        clientCompanyEl.style.display = "";
      } else {
        clientCompanyEl.textContent = "";
        clientCompanyEl.style.display = "none";
      }
    }

    const milestones = summary.milestones || [];
    const anyPaid = milestones.some((m) => m.paid);
    const colHeader = paymentEl.querySelector('[data-pdf="paymentColHeader"]');
    if (colHeader) colHeader.textContent = anyPaid ? "STATUS" : "PERCENTAGE";

    const milestonesEl = paymentEl.querySelector('[data-pdf="milestones"]');
    if (!milestonesEl) return;
    if (!milestones.length) {
      milestonesEl.innerHTML =
        '<tr><td colspan="4" class="empty-state">No payment milestones added</td></tr>';
      return;
    }
    const nextUnpaid = milestones.find((m) => !m.paid);
    milestonesEl.innerHTML = milestones
      .map((milestone) => {
        const dateStr = milestone.date ? formatDate(milestone.date) : "-";
        const amountStr =
          milestone.amount > 0 ? `Php ${formatCurrency(milestone.amount)}` : "-";
        let statusCell;
        let rowClass = "";
        if (anyPaid) {
          if (milestone.paid) {
            rowClass = "milestone-row-paid";
            statusCell = '<span class="paid-status">Paid</span>';
          } else {
            statusCell = '<span class="unpaid-status">Unpaid</span>';
          }
        } else {
          const effectivePct =
            summary.amountTotal > 0 && milestone.amount > 0
              ? Math.round((milestone.amount / summary.amountTotal) * 100)
              : milestone.percentage || 0;
          statusCell = effectivePct > 0 ? `${effectivePct}%` : "-";
        }
        const highlight = milestone === nextUnpaid ? "highlight-amount" : "";
        return `<tr class="${rowClass}">
          <td>${escapeHtml(milestone.milestone)}</td>
          <td>${escapeHtml(dateStr)}</td>
          <td>${statusCell}</td>
          <td class="${highlight}">${amountStr}</td>
        </tr>`;
      })
      .join("");
  }

  async function fillLegacyPdfDom(root, doc) {
    if (!root || !global.InvoicePageRender) return null;
    const summary = global.InvoicePageRender.computeSummary(doc || {});
    const invoicePages = await packInvoiceItemPages(doc || {}, summary);

    root.innerHTML = "";
    invoicePages.forEach((page, i) => {
      page.id = i === 0 ? "legacyPdfInvoice" : `legacyPdfInvoicePage${i + 1}`;
      if (i > 0) page.classList.add("invoice-continued-page");
      root.appendChild(page);
    });

    const payWrap = document.createElement("div");
    payWrap.innerHTML = shellHtml();
    const paymentOnly = payWrap.querySelector("#legacyPdfPaymentTerms");
    const firstInv = payWrap.querySelector("#legacyPdfInvoice");
    if (firstInv) firstInv.remove();
    if (paymentOnly) {
      fillPaymentTerms(paymentOnly, summary, doc || {});
      root.appendChild(paymentOnly);
    }

    return {
      invoiceEl: invoicePages[0] || null,
      invoicePages,
      paymentEl: paymentOnly || null,
      summary
    };
  }

  async function captureElementCanvas(element) {
    const mm = 96 / 25.4;
    const pageW = Math.round(210 * mm);
    const pageH = Math.round(297 * mm);

    const host = document.createElement("div");
    host.className = "pdf-capture-root";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
      "position:fixed",
      "left:-12000px",
      "top:0",
      `width:${pageW}px`,
      `height:${pageH}px`,
      "overflow:hidden",
      "background:#ffffff",
      "z-index:-1",
      "pointer-events:none",
      "opacity:1",
      "visibility:visible"
    ].join(";");

    const clone = element.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add("pdf-capture");
    if (element.classList.contains("invoice-continued-page")) {
      clone.classList.add("pdf-continued-vcenter");
    }
    clone.style.cssText = [
      `width:${pageW}px`,
      `max-width:${pageW}px`,
      `height:${pageH}px`,
      `min-height:${pageH}px`,
      "margin:0",
      "box-shadow:none",
      "overflow:hidden",
      "position:relative",
      "left:0",
      "top:0"
    ].join(";");
    host.appendChild(clone);
    document.body.appendChild(host);

    try {
      await Promise.all(
        [...clone.querySelectorAll("img")].map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
        })
      );
      const width = clone.offsetWidth || pageW;
      const height = clone.offsetHeight || pageH;
      return await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        width,
        height,
        windowWidth: width,
        windowHeight: height
      });
    } finally {
      host.remove();
    }
  }

  function appendCanvasToPdf(pdf, canvas, { startNewPage = false } = {}) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (startNewPage) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight);
  }

  async function downloadLegacyInvoicePdf(doc, options = {}) {
    if (!global.jspdf || typeof html2canvas !== "function") {
      throw new Error("PDF libraries not loaded");
    }
    const capture =
      options.captureRoot || document.getElementById("pdfCaptureRoot");
    if (!capture) throw new Error("PDF capture root missing");

    const filled = await fillLegacyPdfDom(capture, doc || {});
    if (!filled || !filled.invoiceEl) throw new Error("Failed to build legacy PDF DOM");

    try {
      const { jsPDF } = global.jspdf;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const itemPages =
        Array.isArray(filled.invoicePages) && filled.invoicePages.length
          ? filled.invoicePages
          : [filled.invoiceEl];
      for (let i = 0; i < itemPages.length; i++) {
        const canvas = await captureElementCanvas(itemPages[i]);
        appendCanvasToPdf(pdf, canvas, { startNewPage: i > 0 });
      }

      if (filled.paymentEl) {
        const canvasPay = await captureElementCanvas(filled.paymentEl);
        appendCanvasToPdf(pdf, canvasPay, { startNewPage: true });
      }

      const invoiceNumber = (doc && doc.invoiceNumber) || "invoice";
      const billed =
        String((doc && doc.clientName) || "").trim() ||
        String((doc && doc.clientCompany) || "").trim() ||
        "client";
      const clientName = billed.replace(/\s+/g, "_");
      const filename = options.filename || `${invoiceNumber}_${clientName}.pdf`;
      pdf.save(filename);
      return filename;
    } finally {
      capture.innerHTML = "";
    }
  }

  global.InvoicePdfLegacy = {
    fillLegacyPdfDom,
    downloadLegacyInvoicePdf,
    captureElementCanvas,
    appendCanvasToPdf
  };
})(typeof window !== "undefined" ? window : globalThis);

import {
    BOOTH_LAYOUT,
    CONTACT_GROUPS,
    EVENT,
    EVENT_DAYS,
    FEES,
    INGRESS_REMINDERS,
    KOL_COLLECTION,
    MERCHANTS_COLLECTION,
    PAYMENT_DETAILS,
    REGISTRATIONS_COLLECTION,
    SALES_COLLECTION,
    SUPPLIERS,
    formatPeso,
    formatUpdatedAt,
    kolDocId,
    parseMoney,
    salesDocId,
    todayEventDate,
} from './config.js';
import {
    CREW_MEAL_ORDERS_COLLECTION,
    CREW_MEAL_SUPPLIERS,
    crewMealOrderDocId,
    formatCrewDateLabel,
    formatCrewOrderDeadlineLabel,
    isCrewOrderOpen,
    lineKey,
    menuForSupplierDate,
    parseLineKey,
    visibleCrewMealSuppliers,
} from './crew-meals.js';
import { clearSession, getSession, loadMerchants, loginWithCode, setSession, trackHubOpen } from './auth.js';
import { initFirebase } from './firebase.js';

const $ = (id) => document.getElementById(id);

let session = null;
let salesDay = todayEventDate();
let kolDay = todayEventDate();
let crewDay = todayEventDate();
let salesLoadedFor = null;
let kolLoadedFor = null;
let crewLoadedFor = null;
/** @type {'menu' | 'summary' | 'confirmed'} */
let crewView = 'menu';
/** @type {Record<string, number>} */
let crewQty = {};
/** Saved order for the selected day (if any). */
let crewSavedOrder = null;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function contactLink(label, href, fallbackText) {
    if (href) {
        return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }
    return escapeHtml(fallbackText || label);
}

function renderContactGroup(group) {
    const people = (group.people || [])
        .map((p) => {
            const emailLine = p.email
                ? `<span>${contactLink(p.email, p.emailHref, p.email)}</span>`
                : '';
            return `
            <li class="contact-person">
                <div class="contact-person-text">
                    <strong>${escapeHtml(p.name)}</strong>
                    <span>${contactLink(p.mobile, p.mobileHref, p.mobile)}</span>
                    ${emailLine}
                </div>
            </li>`;
        })
        .join('');
    return `
        <article class="info-card">
            <h3>${escapeHtml(group.title)}</h3>
            <ul class="contact-list">${people}</ul>
        </article>
    `;
}

function renderSupplierCard(s) {
    const rows = [];
    if (s.pricing?.length) {
        rows.push(
            `<dt>Price</dt><dd>${s.pricing.map((p) => escapeHtml(p)).join('<br>')}</dd>`
        );
    }
    if (s.mobile) {
        rows.push(`<dt>Mobile</dt><dd>${contactLink(s.mobile, s.mobileHref, s.mobile)}</dd>`);
    }
    if (s.address) {
        rows.push(`<dt>Address</dt><dd>${escapeHtml(s.address)}</dd>`);
    }
    if (s.email) {
        rows.push(`<dt>Email</dt><dd>${contactLink(s.email, s.emailHref, s.email)}</dd>`);
    }
    if (s.facebook) {
        rows.push(
            `<dt>Facebook</dt><dd>${contactLink(s.facebook, s.facebookHref, s.facebook)}</dd>`
        );
    }
    if (s.instagram) {
        rows.push(
            `<dt>Instagram</dt><dd>${contactLink(s.instagram, s.instagramHref, s.instagram)}</dd>`
        );
    }
    return `
        <article class="info-card">
            <p class="info-card-kicker">${escapeHtml(s.category || 'Supplier')}</p>
            <h3>${escapeHtml(s.name)}</h3>
            <dl>${rows.join('')}</dl>
            ${s.howToOrder ? `<p class="notes">${escapeHtml(s.howToOrder)}</p>` : ''}
            ${s.link ? `<p class="notes"><a href="${escapeHtml(s.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.linkLabel || 'Order link')}</a></p>` : ''}
        </article>
    `;
}

function renderIngressGroup(group) {
    const items = (group.items || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
    return `
        <article class="ingress-group">
            <h3>${escapeHtml(group.title)}</h3>
            <ul>${items}</ul>
        </article>
    `;
}

function bindMoneyInputs(root = document) {
    root.querySelectorAll('[data-money]').forEach((input) => {
        if (input.dataset.bound === '1') return;
        input.dataset.bound = '1';
        input.addEventListener('blur', () => {
            const n = parseMoney(input.value);
            input.value = n ? formatPeso(n).replace('₱', '') : '';
        });
        input.addEventListener('focus', () => {
            const n = parseMoney(input.value);
            input.value = n ? String(n) : '';
        });
    });
    root.querySelectorAll('[data-int]').forEach((input) => {
        if (input.dataset.bound === '1') return;
        input.dataset.bound = '1';
        input.addEventListener('blur', () => {
            const n = Math.max(0, Math.round(parseMoney(input.value)));
            input.value = String(n);
        });
        input.addEventListener('focus', () => {
            input.select();
        });
    });
}

function bindSteppers(root = document) {
    root.querySelectorAll('[data-stepper]').forEach((wrap) => {
        if (wrap.dataset.bound === '1') return;
        wrap.dataset.bound = '1';
        const input = wrap.querySelector('.stepper-input, input');
        wrap.querySelectorAll('[data-step]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const delta = Number(btn.dataset.step) || 0;
                const next = Math.max(0, Math.round(parseMoney(input.value)) + delta);
                input.value = String(next);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        });
    });
}

function bindCollapsibles() {
    document.querySelectorAll('[data-collapsible]').forEach((section) => {
        const toggle = section.querySelector('[data-toggle]');
        const body = section.querySelector('.hub-section-body');
        if (!toggle || !body || toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', () => {
            const open = section.classList.toggle('is-collapsed') === false;
            body.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    });
}

function renderDayStrip(container, selectedDate, onSelect) {
    container.innerHTML = EVENT_DAYS.map((d) => {
        const active = d.date === selectedDate;
        return `
            <button type="button"
                class="day-chip${active ? ' is-active' : ''}"
                role="tab"
                aria-selected="${active ? 'true' : 'false'}"
                data-date="${d.date}">
                <span class="day-chip-num">Day ${d.day}</span>
                <span class="day-chip-date">${escapeHtml(d.shortDate)}</span>
                <span class="day-chip-wd">${escapeHtml(d.weekday)}</span>
            </button>`;
    }).join('');

    if (container.dataset.bound === '1') return;
    container.dataset.bound = '1';
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.day-chip');
        if (!btn) return;
        onSelect(btn.dataset.date);
    });
}

function showLogin() {
    $('loginGate').classList.remove('hidden');
    $('hubApp').classList.add('hidden');
    document.body.classList.add('gate-body');
    document.body.classList.remove('hub-body');
}

function showDashboard() {
    $('loginGate').classList.add('hidden');
    $('hubApp').classList.remove('hidden');
    document.body.classList.remove('gate-body');
    document.body.classList.add('hub-body');
    $('headerBrandName').textContent = session.brandName;
    const meta = $('headerBrandMeta');
    if (meta) {
        const bits = [session.contactPerson, session.contactNumber, session.email].filter(Boolean);
        meta.textContent = bits.join(' · ');
        meta.classList.toggle('hidden', !bits.length);
    }
}

function hideBalanceSection() {
    const section = $('sectionBalance');
    if (section) section.classList.add('hidden');
}

function outstandingBalanceInfo(reg) {
    if (!reg) return null;
    if (reg.submissionState === 'draft') return null;

    const fees = reg.feeSnapshot || {};
    const dueDate = EVENT.finalPaymentDue;
    const settlement = reg.settlementType || '';
    const verified = reg.status === 'verified';

    // Fully paid — nothing to show
    if (verified && settlement !== 'downpayment') return null;

    // Downpayment verified → remaining balance
    if (verified && settlement === 'downpayment') {
        return {
            title: 'Remaining balance',
            subtitle: 'Your 50% downpayment is on file. Please settle the rest.',
            amount: Number(fees.balanceAmount) || FEES.balanceAmount,
            dueLabel: `Due on or before ${dueDate}`,
            note: `After paying, email proof of payment to ${PAYMENT_DETAILS.notifyEmail}.`,
        };
    }

    // Not yet verified — still owes initial payment
    const isDp = settlement === 'downpayment';
    return {
        title: isDp ? 'Downpayment due' : 'Participation fee due',
        subtitle: 'Your registration payment is still pending verification.',
        amount: isDp
            ? Number(fees.downpaymentAmount) || FEES.downpaymentAmount
            : Number(fees.totalDue) || FEES.totalDue,
        dueLabel: isDp ? `Remaining balance after this is due by ${dueDate}` : `Due on or before ${dueDate}`,
        note: `After paying, email proof of payment to ${PAYMENT_DETAILS.notifyEmail}.`,
    };
}

function renderPaymentAccounts() {
    const bank = PAYMENT_DETAILS.accounts.filter((a) => a.type === 'bank');
    const ewallet = PAYMENT_DETAILS.accounts.filter((a) => a.type === 'ewallet');

    const bankHtml = bank
        .map(
            (a) => `
            <li class="hub-pay-account">
                <strong>${escapeHtml(a.label)}</strong>
                <span>${escapeHtml(a.accountName)}</span>
                <span class="hub-pay-number">${escapeHtml(a.accountNumber)}</span>
            </li>`
        )
        .join('');

    const ewalletHtml = ewallet
        .map(
            (a) => `
            <li class="hub-pay-account hub-pay-account--ewallet">
                <div class="hub-pay-account-text">
                    <strong>${escapeHtml(a.label)}</strong>
                    <span>${escapeHtml(a.accountName)}</span>
                    <span class="hub-pay-number">${escapeHtml(a.accountNumber)}</span>
                </div>
                ${
                    a.qrImage
                        ? `<button type="button" class="hub-pay-qr-btn" data-qr-src="${escapeHtml(a.qrImage)}" data-qr-label="${escapeHtml(a.label)}" aria-label="View ${escapeHtml(a.label)} QR larger">
                            <img class="hub-pay-qr" src="${escapeHtml(a.qrImage)}" alt="${escapeHtml(a.label)} QR" width="96" height="96" loading="lazy">
                            <span class="hub-pay-qr-hint">Tap to enlarge</span>
                        </button>`
                        : ''
                }
            </li>`
        )
        .join('');

    return `
        <div class="hub-pay-group">
            <h3>${escapeHtml(PAYMENT_DETAILS.hints.bank)}</h3>
            <ul class="hub-pay-list">${bankHtml}</ul>
        </div>
        <div class="hub-pay-group">
            <h3>${escapeHtml(PAYMENT_DETAILS.hints.ewallet)}</h3>
            <ul class="hub-pay-list hub-pay-list--ewallet">${ewalletHtml}</ul>
        </div>`;
}

function openQrModal(src, label) {
    const img = $('qrModalImg');
    const title = $('qrModalTitle');
    const sub = $('qrModalSub');
    if (!img || !src) return;
    img.src = src;
    img.alt = `${label || 'Payment'} QR code`;
    if (title) title.textContent = `${label || 'Payment'} QR`;
    if (sub) sub.textContent = 'Scan to pay';
    openModal('qrModal');
}

function bindBalanceQrClicks() {
    const root = $('balanceAccounts');
    if (!root || root.dataset.qrBound === '1') return;
    root.dataset.qrBound = '1';
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-qr-src]');
        if (!btn) return;
        openQrModal(btn.dataset.qrSrc, btn.dataset.qrLabel);
    });
}

function renderBalanceSection(info) {
    const section = $('sectionBalance');
    if (!section) return;
    if (!info) {
        hideBalanceSection();
        return;
    }
    const toggleSub = $('balanceToggleSub');
    if (toggleSub) {
        toggleSub.textContent = `${formatPeso(info.amount)} · ${info.title}`;
    }
    $('balanceTitle').textContent = info.title;
    $('balanceSubtitle').textContent = info.subtitle;
    $('balanceAmount').textContent = formatPeso(info.amount);
    $('balanceDue').textContent = info.dueLabel;
    $('balanceAccounts').innerHTML = renderPaymentAccounts();
    $('balanceNote').textContent = info.note;
    section.classList.remove('hidden');
    bindBalanceQrClicks();
}

async function loadRegistrationBalance() {
    hideBalanceSection();
    if (!session?.merchantId) return;

    try {
        const { db, firestoreFns } = await initFirebase();
        const candidates = [
            session.registrationId,
            session.merchantId,
        ].filter(Boolean);

        let reg = null;
        for (const id of candidates) {
            const snap = await firestoreFns.getDoc(
                firestoreFns.doc(db, REGISTRATIONS_COLLECTION, id)
            );
            if (snap.exists()) {
                reg = { id: snap.id, ...snap.data() };
                break;
            }
        }

        renderBalanceSection(outstandingBalanceInfo(reg));
    } catch (err) {
        console.error(err);
        hideBalanceSection();
    }
}

function renderStaticSections() {
    $('contactsGrid').innerHTML = CONTACT_GROUPS.map(renderContactGroup).join('');
    $('ingressGrid').innerHTML = INGRESS_REMINDERS.map(renderIngressGroup).join('');
    $('suppliersGrid').innerHTML = SUPPLIERS.map(renderSupplierCard).join('');
    $('boothLayoutImg').src = BOOTH_LAYOUT.imageSrc;
    $('boothLayoutImg').alt = BOOTH_LAYOUT.imageAlt;
}

async function initLoginGate() {
    const brandSelect = $('loginBrand');
    const status = $('loginStatus');
    status.textContent = '';
    status.className = 'gate-status';

    try {
        const merchants = await loadMerchants();
        if (!merchants.length) {
            brandSelect.innerHTML = '<option value="">No brands set up yet</option>';
            status.textContent = 'Merchant access codes have not been generated yet. Contact the organizer.';
            status.classList.add('error');
            return [];
        }
        brandSelect.innerHTML =
            '<option value="">Select your brand…</option>' +
            merchants
                .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.brandName)}</option>`)
                .join('');
        return merchants;
    } catch (err) {
        console.error(err);
        brandSelect.innerHTML = '<option value="">Failed to load</option>';
        status.textContent = 'Could not load brands. Refresh and try again.';
        status.classList.add('error');
        return [];
    }
}

function cashSalesFromDoc(data) {
    if (data.cashSales != null) return Number(data.cashSales) || 0;
    if (data.grossSales != null) return Number(data.grossSales) || 0;
    return 0;
}

async function loadSalesReport(date) {
    salesDay = date;
    renderDayStrip($('salesDayStrip'), salesDay, (d) => loadSalesReport(d));
    const status = $('salesStatus');
    status.textContent = 'Loading…';
    status.className = 'save-status';
    salesLoadedFor = date;

    const { db, firestoreFns } = await initFirebase();
    const id = salesDocId(session.merchantId, date);
    const snap = await firestoreFns.getDoc(firestoreFns.doc(db, SALES_COLLECTION, id));

    if (salesLoadedFor !== date) return;

    if (snap.exists()) {
        const data = snap.data() || {};
        const cash = cashSalesFromDoc(data);
        $('salesCash').value = cash ? formatPeso(cash).replace('₱', '') : '';
        const when = formatUpdatedAt(data.updatedAt);
        status.textContent = when ? `Last saved ${when}` : 'Loaded existing report.';
    } else {
        $('salesCash').value = '';
        status.textContent = 'No report saved for this day yet.';
    }
}

async function saveSalesReport(e) {
    e.preventDefault();
    const date = salesDay;
    const status = $('salesStatus');
    const btn = $('salesSaveBtn');
    const cashSales = parseMoney($('salesCash').value);
    if (!cashSales && cashSales !== 0) {
        // allow 0 but require a filled field for "required"
    }
    if (String($('salesCash').value || '').trim() === '') {
        status.textContent = 'Cash sales is required.';
        status.className = 'save-status error';
        $('salesCash').focus();
        return;
    }

    btn.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'save-status';

    try {
        const { db, firestoreFns } = await initFirebase();
        const id = salesDocId(session.merchantId, date);
        const payload = {
            merchantId: session.merchantId,
            brandName: session.brandName,
            date,
            cashSales,
            // keep legacy key in sync for older admin views
            grossSales: cashSales,
            updatedAt: firestoreFns.serverTimestamp(),
        };
        await firestoreFns.setDoc(firestoreFns.doc(db, SALES_COLLECTION, id), payload, { merge: true });
        status.textContent = `Saved ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`;
        status.classList.add('ok');
        $('salesCash').value = formatPeso(cashSales).replace('₱', '');
    } catch (err) {
        console.error(err);
        status.textContent = 'Save failed. Try again.';
        status.classList.add('error');
    } finally {
        btn.disabled = false;
    }
}

async function loadKolClaims(date) {
    kolDay = date;
    renderDayStrip($('kolDayStrip'), kolDay, (d) => loadKolClaims(d));
    const status = $('kolStatus');
    status.textContent = 'Loading…';
    status.className = 'save-status';
    kolLoadedFor = date;

    const { db, firestoreFns } = await initFirebase();
    const id = kolDocId(session.merchantId, date);
    const snap = await firestoreFns.getDoc(firestoreFns.doc(db, KOL_COLLECTION, id));

    if (kolLoadedFor !== date) return;

    if (snap.exists()) {
        const data = snap.data() || {};
        let drinks = Number(data.drinksClaimed);
        let retail = Number(data.retailClaimed);
        // Migrate legacy itemized claims if present
        if (!Number.isFinite(drinks) && Array.isArray(data.claims)) {
            drinks = data.claims
                .filter((c) => (c.type || 'drink') === 'drink')
                .reduce((s, c) => s + (Number(c.qty) || 0), 0);
        }
        if (!Number.isFinite(retail) && Array.isArray(data.claims)) {
            retail = data.claims
                .filter((c) => c.type === 'retail')
                .reduce((s, c) => s + (Number(c.qty) || 0), 0);
        }
        $('kolDrinks').value = String(Math.max(0, Math.round(drinks || 0)));
        $('kolRetail').value = String(Math.max(0, Math.round(retail || 0)));
        const when = formatUpdatedAt(data.updatedAt);
        status.textContent = when ? `Last saved ${when}` : 'Loaded existing claims.';
    } else {
        $('kolDrinks').value = '0';
        $('kolRetail').value = '0';
        status.textContent = 'No claims saved for this day yet.';
    }
}

async function saveKolClaims(e) {
    e.preventDefault();
    const date = kolDay;
    const status = $('kolStatus');
    const btn = $('kolSaveBtn');
    btn.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'save-status';

    try {
        const { db, firestoreFns } = await initFirebase();
        const id = kolDocId(session.merchantId, date);
        const drinksClaimed = Math.max(0, Math.round(parseMoney($('kolDrinks').value)));
        const retailClaimed = Math.max(0, Math.round(parseMoney($('kolRetail').value)));
        const payload = {
            merchantId: session.merchantId,
            brandName: session.brandName,
            date,
            drinksClaimed,
            retailClaimed,
            updatedAt: firestoreFns.serverTimestamp(),
        };
        await firestoreFns.setDoc(firestoreFns.doc(db, KOL_COLLECTION, id), payload, { merge: true });
        $('kolDrinks').value = String(drinksClaimed);
        $('kolRetail').value = String(retailClaimed);
        status.textContent = `Saved ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`;
        status.classList.add('ok');
    } catch (err) {
        console.error(err);
        status.textContent = 'Save failed. Try again.';
        status.classList.add('error');
    } finally {
        btn.disabled = false;
    }
}


function updateCrewAdvanceNote(date) {
    const el = $('crewAdvanceNote');
    if (!el) return;
    const deadline = formatCrewOrderDeadlineLabel(date);
    if (isCrewOrderOpen(date)) {
        el.textContent = `Ordering open until ${deadline} (Manila time).`;
        el.className = 'crew-advance-note ok';
    } else {
        el.textContent = `Ordering closed. Deadline was ${deadline} (Manila time).`;
        el.className = 'crew-advance-note locked';
    }
}

function syncCrewQtyFromDom() {
    $('crewMenuRoot')?.querySelectorAll('[data-line-key]').forEach((input) => {
        const key = input.dataset.lineKey;
        crewQty[key] = Math.max(0, Math.round(parseMoney(input.value)));
    });
}

function collectCrewLines(date = crewDay) {
    const lines = [];
    Object.entries(crewQty).forEach(([key, qty]) => {
        if (!qty) return;
        const { supplierId, periodKey, itemId } = parseLineKey(key);
        const supplier = CREW_MEAL_SUPPLIERS.find((s) => s.id === supplierId);
        const menu = menuForSupplierDate(supplierId, date);
        const item = menu?.periods
            ?.find((p) => p.key === periodKey)
            ?.items?.find((i) => i.id === itemId);
        if (!item || !supplier) return;
        lines.push({
            supplierId,
            supplierName: supplier.name,
            periodKey,
            periodLabel: menu.periods.find((p) => p.key === periodKey)?.label || periodKey,
            itemId: item.id,
            itemName: item.name,
            itemDescription: item.description || '',
            qty,
            unitPrice: item.price,
            lineTotal: qty * item.price,
        });
    });
    return lines;
}

function crewOrderTotals(lines = collectCrewLines()) {
    return {
        lines,
        totalAmount: lines.reduce((s, l) => s + l.lineTotal, 0),
        totalQty: lines.reduce((s, l) => s + l.qty, 0),
    };
}

function updateCrewTotals() {
    syncCrewQtyFromDom();
    const { totalAmount, totalQty } = crewOrderTotals();
    const totalEl = $('crewOrderTotal');
    const btn = $('crewReviewBtn');
    const label = btn?.querySelector('.crew-cart-label');
    const open = isCrewOrderOpen(crewDay);
    const canCancel = Boolean(crewSavedOrder) && totalQty === 0;
    if (totalEl) totalEl.textContent = formatPeso(totalAmount);
    if (btn) {
        btn.disabled = !open || (totalQty === 0 && !canCancel);
        btn.classList.toggle('btn-danger', open && canCancel);
    }
    if (label) {
        if (!open) label.textContent = 'Ordering closed';
        else if (canCancel) label.textContent = 'Cancel order';
        else if (totalQty === 0) label.textContent = 'Add items to order';
        else label.textContent = `Review order · ${totalQty} item${totalQty === 1 ? '' : 's'}`;
    }
}


function setCrewView(view) {
    crewView = view;
    const dayArea = $('crewDayArea');
    const menuRoot = $('crewMenuRoot');
    const confirmedRoot = $('crewConfirmedRoot');
    const summaryRoot = $('crewSummaryRoot');
    const menuFooter = $('crewMenuFooter');
    const summaryFooter = $('crewSummaryFooter');
    const confirmedFooter = $('crewConfirmedFooter');
    const backBtn = $('crewBackBtn');
    const title = $('crewModalTitle');
    const sub = $('crewModalSub');
    const isUpdate = Boolean(crewSavedOrder);

    dayArea?.classList.toggle('hidden', view === 'summary');
    menuRoot?.classList.toggle('hidden', view !== 'menu');
    confirmedRoot?.classList.toggle('hidden', view !== 'confirmed');
    summaryRoot?.classList.toggle('hidden', view !== 'summary');
    menuFooter?.classList.toggle('hidden', view !== 'menu');
    summaryFooter?.classList.toggle('hidden', view !== 'summary');
    confirmedFooter?.classList.toggle('hidden', view !== 'confirmed');
    backBtn?.classList.toggle('hidden', view === 'confirmed' || (view === 'menu' && !isUpdate));

    if (view === 'menu') {
        if (title) title.textContent = isUpdate ? 'Edit order' : 'Crew meals';
        if (sub) {
            sub.textContent = isCrewOrderOpen(crewDay)
                ? `Order by ${formatCrewOrderDeadlineLabel(crewDay)}`
                : formatCrewDateLabel(crewDay);
        }
    } else if (view === 'summary') {
        if (title) title.textContent = 'Order summary';
        if (sub) sub.textContent = formatCrewDateLabel(crewDay);
        const placeLabel = $('crewPlaceLabel');
        const placeBtn = $('crewPlaceBtn');
        const { totalQty } = crewOrderTotals();
        const isCancel = isUpdate && totalQty === 0;
        const open = isCrewOrderOpen(crewDay);
        if (placeLabel) {
            if (isCancel) placeLabel.textContent = 'Cancel order';
            else if (isUpdate) placeLabel.textContent = 'Update order';
            else placeLabel.textContent = 'Place order';
        }
        if (placeBtn) {
            placeBtn.disabled = !open;
            placeBtn.classList.toggle('btn-danger', open && isCancel);
        }
    } else if (view === 'confirmed') {
        if (title) title.textContent = 'Order confirmed';
        if (sub) sub.textContent = formatCrewDateLabel(crewDay);
        $('crewEditBtn')?.classList.toggle('hidden', !isCrewOrderOpen(crewDay));
    }
}

function renderCrewMenu() {
    const root = $('crewMenuRoot');
    if (!root) return;
    updateCrewAdvanceNote(crewDay);
    const open = isCrewOrderOpen(crewDay);
    const disabledAttr = open ? '' : ' disabled';

    root.innerHTML = visibleCrewMealSuppliers().map((supplier) => {
        const menu = menuForSupplierDate(supplier.id, crewDay);
        if (!menu) {
            return `
                <section class="crew-supplier">
                    <header class="crew-supplier-header">
                        <h3>${escapeHtml(supplier.name)}</h3>
                        <p class="muted">${escapeHtml(supplier.blurb)}</p>
                    </header>
                    <p class="crew-empty">No menu for this day.</p>
                </section>`;
        }

        const periods = menu.periods
            .map((period) => {
                const items = period.items
                    .map((item) => {
                        const key = lineKey(supplier.id, period.key, item.id);
                        const q = crewQty[key] || 0;
                        const desc = item.description
                            ? `<span class="crew-item-desc">${escapeHtml(item.description)}</span>`
                            : '';
                        return `
                            <li class="crew-item">
                                <div class="crew-item-info">
                                    <strong>${escapeHtml(item.name)}</strong>
                                    ${desc}
                                </div>
                                <div class="crew-item-row">
                                    <span class="crew-item-price">${escapeHtml(formatPeso(item.price))}</span>
                                    <div class="stepper" data-stepper>
                                        <button type="button" class="stepper-btn" data-step="-1" aria-label="Decrease"${disabledAttr}>−</button>
                                        <input class="input stepper-input" type="text" inputmode="numeric" data-line-key="${escapeHtml(key)}" data-int value="${q}"${disabledAttr}>
                                        <button type="button" class="stepper-btn" data-step="1" aria-label="Increase"${disabledAttr}>+</button>
                                    </div>
                                </div>
                            </li>`;
                    })
                    .join('');
                return `
                    <div class="crew-period">
                        <h4>${escapeHtml(period.label)}</h4>
                        <ul class="crew-item-list">${items}</ul>
                    </div>`;
            })
            .join('');

        return `
            <section class="crew-supplier">
                <header class="crew-supplier-header">
                    <h3>${escapeHtml(supplier.name)}</h3>
                    <p class="muted">${escapeHtml(supplier.blurb)}</p>
                </header>
                ${periods}
            </section>`;
    }).join('');

    if (open) {
        bindSteppers(root);
        bindMoneyInputs(root);
        root.querySelectorAll('[data-line-key]').forEach((input) => {
            input.addEventListener('input', updateCrewTotals);
            input.addEventListener('change', updateCrewTotals);
        });
        root.querySelectorAll('[data-step]').forEach((btn) => {
            btn.addEventListener('click', () => {
                setTimeout(updateCrewTotals, 0);
            });
        });
    }
    updateCrewTotals();
}

function renderCrewLineGroups(lines) {
    const bySupplier = new Map();
    lines.forEach((line) => {
        if (!bySupplier.has(line.supplierId)) {
            bySupplier.set(line.supplierId, {
                name: line.supplierName,
                lines: [],
            });
        }
        bySupplier.get(line.supplierId).lines.push(line);
    });

    return [...bySupplier.values()]
        .map((group) => {
            const items = group.lines
                .map((line) => {
                    const period =
                        line.periodKey && line.periodKey !== 'meal'
                            ? `<span class="muted">${escapeHtml(line.periodLabel || line.periodKey)}</span>`
                            : '';
                    const desc = line.itemDescription
                        ? `<span class="muted">${escapeHtml(line.itemDescription)}</span>`
                        : '';
                    return `
                        <li class="crew-summary-line">
                            <span class="crew-summary-qty">${line.qty}×</span>
                            <div>
                                <strong>${escapeHtml(line.itemName)}</strong>
                                ${desc}
                                ${period}
                            </div>
                            <span class="crew-summary-line-total">${escapeHtml(formatPeso(line.lineTotal))}</span>
                        </li>`;
                })
                .join('');
            return `
                <section class="crew-summary-group">
                    <h3>${escapeHtml(group.name)}</h3>
                    <ul class="crew-summary-lines">${items}</ul>
                </section>`;
        })
        .join('');
}

function renderCrewSummary() {
    const root = $('crewSummaryRoot');
    if (!root) return;
    const { lines, totalAmount, totalQty } = crewOrderTotals();
    const placeTotal = $('crewPlaceTotal');
    if (placeTotal) placeTotal.textContent = formatPeso(totalAmount);

    const emailNote = session?.email
        ? `<p class="crew-email-note muted">Confirmation will be sent to <strong>${escapeHtml(session.email)}</strong></p>`
        : `<p class="crew-email-note muted">Confirmation will be sent to your brand contact email.</p>`;

    if (!lines.length) {
        root.innerHTML = `
            <div class="crew-cancel-summary">
                <h3>Cancel this order?</h3>
                <p class="muted">No items selected for ${escapeHtml(formatCrewDateLabel(crewDay))}. Confirming will cancel your existing order for this day.</p>
            </div>
            ${emailNote}`;
        return;
    }

    root.innerHTML = `
        <p class="crew-summary-day muted">For ${escapeHtml(formatCrewDateLabel(crewDay))} · ${totalQty} item${totalQty === 1 ? '' : 's'}</p>
        ${renderCrewLineGroups(lines)}
        <div class="crew-summary-total">
            <span>Total</span>
            <strong>${escapeHtml(formatPeso(totalAmount))}</strong>
        </div>
        ${emailNote}`;
}

function renderCrewConfirmed(order, hint = '') {
    const root = $('crewConfirmedRoot');
    if (!root || !order) return;
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const totalQty = order.totalQty ?? lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const totalAmount = order.totalAmount ?? lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0);
    const when = formatUpdatedAt(order.updatedAt);
    const email = order.email || session?.email || '';

    root.innerHTML = `
        <div class="crew-confirmed-banner">
            <span class="crew-done-check" aria-hidden="true">✓</span>
            <div>
                <strong>Order confirmed</strong>
                <p class="muted">${when ? `Last updated ${escapeHtml(when)}` : 'Saved for this day'}</p>
            </div>
        </div>
        <p class="crew-summary-day muted">For ${escapeHtml(formatCrewDateLabel(order.date || crewDay))} · ${totalQty} item${totalQty === 1 ? '' : 's'}</p>
        ${renderCrewLineGroups(lines)}
        <div class="crew-summary-total">
            <span>Total</span>
            <strong>${escapeHtml(formatPeso(totalAmount))}</strong>
        </div>
        ${email ? `<p class="crew-email-note muted">Confirmation email: <strong>${escapeHtml(email)}</strong></p>` : ''}`;

    const status = $('crewConfirmedStatus');
    if (status) {
        status.textContent = hint;
        status.className = hint ? 'crew-footer-hint ok' : 'crew-footer-hint muted';
    }
}

async function ensureSessionEmail() {
    const needsEmail = !(session?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.email));
    const needsPhone = !String(session?.contactNumber || '').trim();
    const needsPerson = !String(session?.contactPerson || '').trim();
    if (!needsEmail && !needsPhone && !needsPerson) {
        return session.email;
    }

    const { db, firestoreFns } = await initFirebase();
    const merchantSnap = await firestoreFns.getDoc(
        firestoreFns.doc(db, MERCHANTS_COLLECTION, session.merchantId)
    );
    let data = merchantSnap.data() || {};

    if ((needsPhone || needsPerson) && (!data.contactNumber || !data.contactPerson)) {
        const regId = session.registrationId || session.merchantId;
        if (regId) {
            try {
                const regSnap = await firestoreFns.getDoc(
                    firestoreFns.doc(db, REGISTRATIONS_COLLECTION, regId)
                );
                if (regSnap.exists()) {
                    data = { ...regSnap.data(), ...data };
                }
            } catch {
                /* ignore */
            }
        }
    }

    const email = String(data.email || session.email || '').trim();
    const contactPerson = String(data.contactPerson || session.contactPerson || '').trim();
    const contactNumber = String(data.contactNumber || session.contactNumber || '').trim();
    session = {
        ...session,
        email: email || session.email || '',
        contactPerson,
        contactNumber,
    };
    setSession(session);
    showDashboard();
    return email;
}

async function loadCrewOrder(date) {
    crewDay = date;
    renderDayStrip($('crewDayStrip'), crewDay, (d) => loadCrewOrder(d));
    updateCrewAdvanceNote(crewDay);
    const status = $('crewStatus');
    if (status) {
        status.textContent = 'Loading…';
        status.className = 'crew-footer-hint muted';
    }
    crewLoadedFor = date;
    crewQty = {};
    crewSavedOrder = null;

    const { db, firestoreFns } = await initFirebase();
    const id = crewMealOrderDocId(session.merchantId, date);
    const snap = await firestoreFns.getDoc(firestoreFns.doc(db, CREW_MEAL_ORDERS_COLLECTION, id));

    if (crewLoadedFor !== date) return;

    if (snap.exists()) {
        const data = snap.data() || {};
        const lines = Array.isArray(data.lines) ? data.lines : [];
        lines.forEach((line) => {
            if (!line?.supplierId || !line?.itemId) return;
            const key = lineKey(line.supplierId, line.periodKey || 'meal', line.itemId);
            crewQty[key] = Math.max(0, Math.round(Number(line.qty) || 0));
        });
        if (lines.length) {
            crewSavedOrder = {
                ...data,
                date,
                lines,
                totalAmount: data.totalAmount ?? lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0),
                totalQty: data.totalQty ?? lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
            };
            renderCrewConfirmed(crewSavedOrder);
            setCrewView('confirmed');
            if (status) status.textContent = '';
            return;
        }
    }

    if (status) status.textContent = '';
    renderCrewMenu();
    setCrewView('menu');
}

function showCrewSummary() {
    if (!isCrewOrderOpen(crewDay)) {
        updateCrewAdvanceNote(crewDay);
        updateCrewTotals();
        return;
    }
    syncCrewQtyFromDom();
    const { totalQty } = crewOrderTotals();
    const canCancel = Boolean(crewSavedOrder) && totalQty === 0;
    if (!totalQty && !canCancel) {
        updateCrewTotals();
        return;
    }
    const placeStatus = $('crewPlaceStatus');
    if (placeStatus) {
        placeStatus.textContent = '';
        placeStatus.className = 'crew-footer-hint muted';
    }
    renderCrewSummary();
    setCrewView('summary');
}

function startCrewEdit() {
    if (!isCrewOrderOpen(crewDay)) {
        updateCrewAdvanceNote(crewDay);
        return;
    }
    renderCrewMenu();
    setCrewView('menu');
    updateCrewTotals();
}

async function placeCrewOrder() {
    const date = crewDay;
    const status = $('crewPlaceStatus');
    const btn = $('crewPlaceBtn');
    if (!isCrewOrderOpen(date)) {
        status.textContent = `Ordering closed. Deadline was ${formatCrewOrderDeadlineLabel(date)} (Manila time).`;
        status.className = 'crew-footer-hint error';
        return;
    }
    syncCrewQtyFromDom();
    const { lines, totalAmount, totalQty } = crewOrderTotals();
    const isUpdate = Boolean(crewSavedOrder);
    const isCancel = isUpdate && totalQty === 0;

    if (!totalQty && !isCancel) {
        status.textContent = 'Add items before placing an order.';
        status.className = 'crew-footer-hint error';
        setCrewView('menu');
        return;
    }

    btn.disabled = true;
    status.textContent = isCancel
        ? 'Cancelling order…'
        : isUpdate
          ? 'Updating order…'
          : 'Placing order…';
    status.className = 'crew-footer-hint muted';

    try {
        const email = await ensureSessionEmail();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            status.textContent = 'No email on file for this brand. Contact the organizer.';
            status.className = 'crew-footer-hint error';
            return;
        }

        const orderId = crewMealOrderDocId(session.merchantId, date);
        const payload = {
            merchantId: session.merchantId,
            brandName: session.brandName,
            contactPerson: session.contactPerson || '',
            contactNumber: session.contactNumber || '',
            email,
            date,
            lines,
            totalAmount,
            totalQty,
            cancelled: isCancel,
            updatedAt: null,
        };

        const { db, firestoreFns, functions, functionsFns } = await initFirebase();
        payload.updatedAt = firestoreFns.serverTimestamp();
        await firestoreFns.setDoc(firestoreFns.doc(db, CREW_MEAL_ORDERS_COLLECTION, orderId), payload, {
            merge: true,
        });

        status.textContent = isCancel
            ? 'Sending cancellation…'
            : isUpdate
              ? 'Sending update email…'
              : 'Sending confirmation…';
        let emailResult = { sent: false, to: email };
        try {
            const sendFn = functionsFns.httpsCallable(functions, 'sendCrewMealOrderEmail');
            const result = await sendFn({
                orderId,
                merchantId: session.merchantId,
                brandName: session.brandName,
                contactPerson: session.contactPerson || '',
                contactNumber: session.contactNumber || '',
                email,
                date,
                lines,
                totalAmount,
                totalQty,
                isUpdate,
                isCancel,
            });
            emailResult = { sent: true, to: result.data?.to || email };
        } catch (err) {
            console.error(err);
            emailResult = {
                sent: false,
                to: email,
                error: err?.message || 'Email failed',
            };
        }

        if (isCancel) {
            crewSavedOrder = null;
            crewQty = {};
            renderCrewMenu();
            setCrewView('menu');
            const menuStatus = $('crewStatus');
            if (menuStatus) {
                menuStatus.textContent = emailResult.sent
                    ? `Order cancelled. Email sent to ${emailResult.to}`
                    : `Order cancelled${emailResult.error ? `, but email failed: ${emailResult.error}` : ''}.`;
                menuStatus.className = emailResult.sent
                    ? 'crew-footer-hint ok'
                    : 'crew-footer-hint error';
            }
            return;
        }

        crewSavedOrder = {
            ...payload,
            updatedAt: new Date(),
        };
        const hint = emailResult.sent
            ? `${isUpdate ? 'Update' : 'Confirmation'} sent to ${emailResult.to}`
            : `Order saved, but email failed${emailResult.error ? `: ${emailResult.error}` : ''}`;
        renderCrewConfirmed(crewSavedOrder, hint);
        setCrewView('confirmed');
    } catch (err) {
        console.error(err);
        status.textContent = 'Could not place order. Try again.';
        status.className = 'crew-footer-hint error';
    } finally {
        btn.disabled = false;
    }
}

async function enterDashboard() {
    showDashboard();
    renderStaticSections();
    bindCollapsibles();
    bindMoneyInputs($('salesForm'));
    bindMoneyInputs($('kolForm'));
    bindSteppers($('kolForm'));
    const defaultDay = todayEventDate();
    salesDay = defaultDay;
    kolDay = defaultDay;
    crewDay = defaultDay;
    trackHubOpen(session).catch(() => {});
    ensureSessionEmail().catch(() => {});
    await loadRegistrationBalance();
}

function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.hidden = false;
    document.body.classList.add('modal-open');
}

function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.hidden = true;
    if (![...document.querySelectorAll('.hub-modal')].some((el) => !el.classList.contains('hidden'))) {
        document.body.classList.remove('modal-open');
    }
}

async function openSalesModal() {
    openModal('salesModal');
    await loadSalesReport(salesDay || todayEventDate());
}

async function openKolModal() {
    openModal('kolModal');
    await loadKolClaims(kolDay || todayEventDate());
}

async function openCrewModal() {
    openModal('crewModal');
    await loadCrewOrder(crewDay || todayEventDate());
}

async function main() {
    session = getSession();
    let merchants = [];

    $('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('loginStatus');
        const btn = $('loginBtn');
        btn.disabled = true;
        status.textContent = 'Signing in…';
        status.className = 'gate-status';
        try {
            const result = await loginWithCode($('loginBrand').value, $('loginCode').value, merchants);
            if (!result.ok) {
                status.textContent = result.error;
                status.classList.add('error');
                return;
            }
            session = result.session;
            $('loginCode').value = '';
            await enterDashboard();
        } catch (err) {
            console.error(err);
            status.textContent = 'Sign-in failed. Try again.';
            status.classList.add('error');
        } finally {
            btn.disabled = false;
        }
    });

    $('logoutBtn').addEventListener('click', () => {
        closeModal('salesModal');
        closeModal('kolModal');
        closeModal('crewModal');
        closeModal('qrModal');
        clearSession();
        session = null;
        showLogin();
        initLoginGate().then((list) => {
            merchants = list;
        });
    });

    $('openSalesModal')?.addEventListener('click', () => {
        openSalesModal().catch(console.error);
    });
    $('openKolModal')?.addEventListener('click', () => {
        openKolModal().catch(console.error);
    });
    $('openCrewModal')?.addEventListener('click', () => {
        openCrewModal().catch(console.error);
    });
    $('crewReviewBtn')?.addEventListener('click', () => {
        showCrewSummary();
    });
    $('crewPlaceBtn')?.addEventListener('click', () => {
        placeCrewOrder().catch(console.error);
    });
    $('crewBackBtn')?.addEventListener('click', () => {
        if (crewView === 'summary') {
            setCrewView('menu');
            updateCrewTotals();
            return;
        }
        if (crewView === 'menu' && crewSavedOrder) {
            renderCrewConfirmed(crewSavedOrder);
            setCrewView('confirmed');
            return;
        }
        setCrewView('menu');
    });
    $('crewEditBtn')?.addEventListener('click', () => {
        startCrewEdit();
    });

    document.querySelectorAll('[data-close-modal]').forEach((el) => {
        el.addEventListener('click', () => closeModal(el.dataset.closeModal));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeModal('salesModal');
        closeModal('kolModal');
        closeModal('crewModal');
        closeModal('qrModal');
    });

    $('salesForm').addEventListener('submit', saveSalesReport);
    $('kolForm').addEventListener('submit', saveKolClaims);

    if (session) {
        await enterDashboard();
    } else {
        showLogin();
        merchants = await initLoginGate();
    }
}

main().catch((err) => {
    console.error(err);
});

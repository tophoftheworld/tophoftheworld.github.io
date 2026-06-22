let pending = null;

function getEls() {
    return {
        root: document.getElementById("confirmDialog"),
        message: document.getElementById("confirmDialogMessage"),
        title: document.getElementById("confirmDialogTitle"),
        cancelBtn: document.getElementById("confirmDialogCancel"),
        okBtn: document.getElementById("confirmDialogOk"),
        backdrop: document.querySelector("#confirmDialog .confirm-dialog__backdrop"),
        optionWrap: document.getElementById("confirmDialogOptionWrap"),
        checkbox: document.getElementById("confirmDialogCheckbox"),
        optionLabel: document.getElementById("confirmDialogOptionLabel"),
    };
}

function closeConfirmDialog(confirmed) {
    const { root, checkbox } = getEls();
    if (!root || !pending) return;
    const checked = Boolean(checkbox?.checked);
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("confirm-dialog-open");
    const resolve = pending.resolve;
    pending = null;
    resolve({ confirmed, checked });
}

export function initConfirmDialog() {
    const { root, cancelBtn, okBtn, backdrop } = getEls();
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";

    cancelBtn?.addEventListener("click", () => closeConfirmDialog(false));
    okBtn?.addEventListener("click", () => closeConfirmDialog(true));
    backdrop?.addEventListener("click", () => closeConfirmDialog(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && pending) closeConfirmDialog(false);
    });
}

/**
 * @param {{ title?: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, checkbox?: { label: string, checked?: boolean } | null }} opts
 * @returns {Promise<{ confirmed: boolean, checked: boolean }>}
 */
export function showConfirmDialog(opts) {
    initConfirmDialog();
    const { root, message, title, cancelBtn, okBtn, optionWrap, checkbox, optionLabel } =
        getEls();
    if (!root) {
        const confirmed = window.confirm(opts.message);
        return Promise.resolve({ confirmed, checked: false });
    }

    if (pending) {
        pending.resolve({ confirmed: false, checked: false });
    }

    if (title) title.textContent = opts.title;
    if (message) message.textContent = opts.message;
    if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || "Keep";
    if (okBtn) {
        okBtn.textContent = opts.confirmLabel || "Confirm";
        okBtn.classList.toggle("confirm-dialog__ok--danger", Boolean(opts.danger));
    }

    if (opts.checkbox && optionWrap && checkbox && optionLabel) {
        optionWrap.hidden = false;
        optionLabel.textContent = opts.checkbox.label;
        checkbox.checked = opts.checkbox.checked !== false;
    } else if (optionWrap && checkbox) {
        optionWrap.hidden = true;
        checkbox.checked = false;
    }

    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("confirm-dialog-open");
    okBtn?.focus();

    return new Promise((resolve) => {
        pending = { resolve };
    });
}

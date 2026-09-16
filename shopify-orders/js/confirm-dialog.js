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
        inputWrap: document.getElementById("confirmDialogInputWrap"),
        input: document.getElementById("confirmDialogInput"),
        inputLabel: document.getElementById("confirmDialogInputLabel"),
        inputHint: document.getElementById("confirmDialogInputHint"),
        panel: document.querySelector("#confirmDialog .confirm-dialog__panel"),
    };
}

function closeConfirmDialog(confirmed) {
    const { root, checkbox, input } = getEls();
    if (!root || !pending) return;
    const checked = Boolean(checkbox?.checked);
    const value = String(input?.value || "");
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("confirm-dialog-open");
    const resolve = pending.resolve;
    pending = null;
    resolve({ confirmed, checked, value });
}

export function initConfirmDialog() {
    const { root, cancelBtn, okBtn, backdrop, input } = getEls();
    if (!root || root.dataset.ready === "1") return;
    root.dataset.ready = "1";

    cancelBtn?.addEventListener("click", () => closeConfirmDialog(false));
    okBtn?.addEventListener("click", () => closeConfirmDialog(true));
    backdrop?.addEventListener("click", () => closeConfirmDialog(false));
    input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            closeConfirmDialog(true);
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && pending) closeConfirmDialog(false);
    });
}

/**
 * @param {{ title?: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, checkbox?: { label: string, checked?: boolean } | null, input?: { label?: string, value?: string, placeholder?: string, hint?: string } | null }} opts
 * @returns {Promise<{ confirmed: boolean, checked: boolean, value: string }>}
 */
export function showConfirmDialog(opts) {
    initConfirmDialog();
    const {
        root,
        message,
        title,
        cancelBtn,
        okBtn,
        optionWrap,
        checkbox,
        optionLabel,
        inputWrap,
        input,
        inputLabel,
        inputHint,
        panel,
    } = getEls();
    if (!root) {
        if (opts.input) {
            const value = window.prompt(opts.input.label || opts.message, opts.input.value || "");
            return Promise.resolve({
                confirmed: value != null,
                checked: false,
                value: value || "",
            });
        }
        const confirmed = window.confirm(opts.message);
        return Promise.resolve({ confirmed, checked: false, value: "" });
    }

    if (pending) {
        pending.resolve({ confirmed: false, checked: false, value: "" });
    }

    if (title) title.textContent = opts.title;
    if (message) {
        message.textContent = opts.message;
        message.hidden = !opts.message;
    }
    if (cancelBtn) cancelBtn.textContent = opts.cancelLabel || "Keep";
    if (okBtn) {
        okBtn.textContent = opts.confirmLabel || "Confirm";
        okBtn.classList.toggle("confirm-dialog__ok--danger", Boolean(opts.danger));
        okBtn.classList.toggle("primary", !opts.danger);
    }

    if (opts.checkbox && optionWrap && checkbox && optionLabel) {
        optionWrap.hidden = false;
        optionLabel.textContent = opts.checkbox.label;
        checkbox.checked = opts.checkbox.checked !== false;
    } else if (optionWrap && checkbox) {
        optionWrap.hidden = true;
        checkbox.checked = false;
    }

    if (opts.input && inputWrap && input) {
        inputWrap.hidden = false;
        if (inputLabel) inputLabel.textContent = opts.input.label || "";
        input.value = opts.input.value || "";
        input.placeholder = opts.input.placeholder || "";
        if (inputHint) {
            inputHint.textContent = opts.input.hint || "";
            inputHint.hidden = !opts.input.hint;
        }
        panel?.classList.add("confirm-dialog__panel--wide");
    } else if (inputWrap && input) {
        inputWrap.hidden = true;
        input.value = "";
        if (inputHint) inputHint.hidden = true;
        panel?.classList.remove("confirm-dialog__panel--wide");
    }

    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("confirm-dialog-open");
    if (opts.input && input) {
        input.focus();
        input.select();
    } else {
        okBtn?.focus();
    }

    return new Promise((resolve) => {
        pending = { resolve };
    });
}

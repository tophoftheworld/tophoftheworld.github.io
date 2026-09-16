import {
    formatCertificateDate,
} from "./workshop-certificate-core.mjs";

const IMG_BASE = new URL("../img/certificate/", import.meta.url).href;

function imgUrl(name) {
    return new URL(name, IMG_BASE).href;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStage() {
    let stage = document.getElementById("workshopCertificateStage");
    if (stage) return stage;

    stage = document.createElement("div");
    stage.id = "workshopCertificateStage";
    stage.setAttribute("aria-hidden", "true");
    stage.innerHTML = `
        <div class="certificate" id="workshopCertificate">
            <div class="certificate-background"></div>
            <div class="certificate-content">
                <div class="main-content-area">
                    <h1 class="certificate-title">Certificate of Participation</h1>
                    <p class="certificate-intro">THIS CERTIFICATE IS PROUDLY PRESENTED TO</p>
                    <h2 class="participant-name" id="workshopCertName"></h2>
                    <p class="recognition-text">
                        in recognition of their active engagement and participation in the Matcha Workshop,
                        hosted by matchanese this <span id="workshopCertDate">Date</span>,
                        at <span id="workshopCertVenue">Venue</span>.
                    </p>
                </div>
                <div class="signatures-section">
                    <div class="signature-block">
                        <img src="${imgUrl("signature1.png")}" alt="" class="signature-image" />
                        <p class="signature-name">Bea Boldo</p>
                        <p class="signature-title">Facilitator/Co-Owner</p>
                        <p class="signature-company">matchanese</p>
                    </div>
                    <div class="signature-block">
                        <img src="${imgUrl("signature2.png")}" alt="" class="signature-image" />
                        <p class="signature-name">Cristopher David</p>
                        <p class="signature-title">Facilitator/Co-Owner</p>
                        <p class="signature-company">matchanese</p>
                    </div>
                </div>
                <div class="logo-container">
                    <img src="${imgUrl("logo.png")}" alt="matchanese" class="company-logo" />
                </div>
            </div>
        </div>`;
    document.body.appendChild(stage);

    const bg = stage.querySelector(".certificate-background");
    if (bg) {
        bg.style.backgroundImage = `url("${imgUrl("background-texture.svg")}")`;
    }
    return stage;
}

async function ensureImagesLoaded(certificate) {
    const images = certificate.querySelectorAll("img");
    await Promise.all(
        Array.from(images).map((img) => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
            });
        })
    );

    images.forEach((img) => {
        if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        let boxWidth;
        let boxHeight;
        if (img.classList.contains("signature-image")) {
            const targetWidth = 130;
            boxWidth = targetWidth;
            boxHeight = targetWidth / aspectRatio;
            if (boxHeight > 50) {
                boxHeight = 50;
                boxWidth = boxHeight * aspectRatio;
            }
        } else if (img.classList.contains("company-logo")) {
            const targetHeight = 45;
            boxHeight = targetHeight;
            boxWidth = targetHeight * aspectRatio;
            if (boxWidth > 200) {
                boxWidth = 200;
                boxHeight = boxWidth / aspectRatio;
            }
        }
        if (!boxWidth || !boxHeight) return;
        img.setAttribute("width", String(boxWidth));
        img.setAttribute("height", String(boxHeight));
        img.style.width = `${boxWidth}px`;
        img.style.height = `${boxHeight}px`;
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.objectFit = "fill";
        img.style.objectPosition = "center";
    });
}

async function captureCertificate(certificate) {
    const html2canvasFn = window.html2canvas;
    if (typeof html2canvasFn !== "function") {
        throw new Error("Certificate renderer is not loaded.");
    }
    await ensureImagesLoaded(certificate);
    const images = certificate.querySelectorAll("img");
    const imageData = Array.from(images).map((img) => ({
        width: img.getAttribute("width"),
        height: img.getAttribute("height"),
        styleWidth: img.style.width,
        styleHeight: img.style.height,
    }));

    return html2canvasFn(certificate, {
        scale: 3,
        backgroundColor: null,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: certificate.offsetWidth,
        height: certificate.offsetHeight,
        imageTimeout: 15000,
        removeContainer: true,
        onclone: (clonedDoc) => {
            clonedDoc.querySelectorAll("img").forEach((clonedImg, index) => {
                const data = imageData[index];
                if (!data) return;
                if (data.width) clonedImg.setAttribute("width", data.width);
                if (data.height) clonedImg.setAttribute("height", data.height);
                clonedImg.style.setProperty("width", data.styleWidth, "important");
                clonedImg.style.setProperty("height", data.styleHeight, "important");
                clonedImg.style.maxWidth = "none";
                clonedImg.style.maxHeight = "none";
                clonedImg.style.objectFit = "fill";
                clonedImg.style.objectPosition = "center";
            });
        },
    });
}

/**
 * @param {{ names: string[], dateIso: string, venue: string, fileBase?: string, onProgress?: (i: number, total: number) => void }} opts
 */
export async function downloadWorkshopCertificatesPdf(opts) {
    const names = (opts.names || []).map((n) => String(n || "").trim()).filter(Boolean);
    if (!names.length) {
        throw new Error("No participant names to print.");
    }
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
        throw new Error("PDF library is not loaded.");
    }

    if (document.fonts?.ready) {
        await document.fonts.ready;
    }

    const stage = ensureStage();
    const certificate = document.getElementById("workshopCertificate");
    const nameEl = document.getElementById("workshopCertName");
    const dateEl = document.getElementById("workshopCertDate");
    const venueEl = document.getElementById("workshopCertVenue");
    if (!certificate || !nameEl || !dateEl || !venueEl) {
        throw new Error("Certificate template is missing.");
    }

    dateEl.textContent = formatCertificateDate(opts.dateIso);
    venueEl.textContent = String(opts.venue || "").trim() || "Venue";

    const imgWidth = 21;
    const imgHeight = 14.8;
    const pdf = new JsPdf({
        orientation: "landscape",
        unit: "cm",
        format: [imgWidth, imgHeight],
    });

    try {
        for (let i = 0; i < names.length; i++) {
            opts.onProgress?.(i + 1, names.length);
            nameEl.textContent = names[i];
            await wait(80);
            const canvas = await captureCertificate(certificate);
            const imgData = canvas.toDataURL("image/png");
            if (i > 0) pdf.addPage([imgWidth, imgHeight], "landscape");
            pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight, undefined, "FAST");
        }

        const rawBase = String(opts.fileBase || `Certificates_${names.length}_participants`).trim();
        const fileBase = rawBase.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Certificates";
        pdf.save(`${fileBase}.pdf`);
    } finally {
        stage.remove();
    }
}

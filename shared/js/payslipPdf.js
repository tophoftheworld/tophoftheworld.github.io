/**
 * Shared Matchanese salary-statement PDF helpers.
 * Layout + breakdown match the staff portal (payroll/js/script.js generatePayslipPDF).
 */

function escapePayslipHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function earningsLabel(kind, amount) {
    if (kind === 'cash_advance' || Number(amount) < 0) return 'Cash Advance';
    if (kind === 'reimbursement') return 'Reimbursement';
    if (kind === 'period_extra') return 'Period Extra';
    return 'Adjustment';
}

/**
 * Build per-branch detailed totals the same way as the staff portal payslip.
 * @param {object} opts
 * @param {Array} opts.dates
 * @param {string} opts.payType
 * @param {object} opts.employeeData rates object for PayCalculator
 * @param {object|null} opts.payCalculator
 */
export function buildPayslipBranchData({ dates, payType, employeeData, payCalculator }) {
    const branchData = {};
    const workedDays = (Array.isArray(dates) ? dates : []).filter(
        (day) => day.isPaidLeave || (day.timeIn && day.timeOut)
    );

    if (payType === 'monthly') {
        return { branchData, workedDays };
    }

    workedDays.forEach((day) => {
        const branch = day.isPaidLeave ? 'Paid Leave' : (day.branch || 'Unknown');
        if (!branchData[branch]) {
            branchData[branch] = {
                days: [],
                basicPay: 0,
                mealAllowance: 0,
                transportAllowance: 0,
                overtimePay: 0,
                lateDeduction: 0,
                undertimeDeduction: 0,
                holidayBonus: 0,
                salesBonus: 0,
                subtotal: 0
            };
        }

        let basePortion = 0;
        let mealAllowance = 0;
        let lateDed = 0;
        let undertimeDed = 0;
        let holidayBonus = 0;
        let salesBonus = 0;
        let otPay = 0;
        let transpoAllowance = 0;
        let dailyTotal = 0;

        if (payCalculator) {
            const result = payCalculator.calculateDailyPay(day, employeeData, 'detailed');
            const breakdown = result?.breakdown || {};
            dailyTotal = Number(result?.total) || 0;
            mealAllowance = breakdown.mealAllowance || 0;
            lateDed = breakdown.deductions?.late?.amount || 0;
            undertimeDed = breakdown.deductions?.undertime?.amount || 0;
            transpoAllowance = breakdown.bonuses?.transportation || day.transpoAllowance || 0;
            otPay = breakdown.bonuses?.overtime || 0;
            salesBonus = breakdown.bonuses?.sales || 0;
            if (breakdown.components) {
                const holidayComponent = breakdown.components.find((c) =>
                    c.type === 'holiday_bonus' || c.type === 'double_pay_bonus'
                );
                if (holidayComponent) holidayBonus = holidayComponent.amount || 0;
            }
            basePortion = dailyTotal
                - mealAllowance
                - transpoAllowance
                - otPay
                - salesBonus
                - holidayBonus
                + lateDed
                + undertimeDed;
        } else {
            dailyTotal = Number(day.totalPay) || 0;
            basePortion = dailyTotal;
        }

        branchData[branch].days.push(day.date);
        branchData[branch].basicPay += basePortion;
        branchData[branch].mealAllowance += mealAllowance;
        branchData[branch].transportAllowance += transpoAllowance;
        branchData[branch].overtimePay += otPay;
        branchData[branch].lateDeduction += lateDed;
        branchData[branch].undertimeDeduction += undertimeDed;
        branchData[branch].holidayBonus += holidayBonus;
        branchData[branch].salesBonus += salesBonus;
        branchData[branch].subtotal += dailyTotal;
    });

    return { branchData, workedDays };
}

function formatDateForPayslip(dateStr) {
    const date = new Date(String(dateStr).includes('T') ? dateStr : `${dateStr}T00:00:00`);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Staff-portal breakdown HTML (branch cards + monthly/hybrid + earnings).
 */
export function buildPayslipBreakdownHtml({
    payType,
    branchData = {},
    periodBreakdown = {},
    mergedEmployee = {},
    attendanceOnly = 0,
    grandTotal = 0,
    earningsLines = [],
    earningsKindLabelFn = earningsLabel
}) {
    let breakdownHTML = '';

    if (payType === 'monthly') {
        const periodGross = Number(periodBreakdown.periodGross)
            || Number(mergedEmployee.periodGross)
            || ((Number(mergedEmployee.monthlySalary) || 0) / 2)
            || attendanceOnly;
        const addOns = Number(periodBreakdown.totalBonuses) || 0;
        breakdownHTML = `
<div style="background: #f1f9f2; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; color: #2b9348; font-size: 1.1rem; font-weight: 600;">Monthly Salary</h4>
<p style="margin: 0.5rem 0; color: #333;">Fixed Salary (this cutoff) <span style="float:right">₱${Number(periodGross).toFixed(2)}</span></p>
${addOns > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Allowances / Bonuses <span style="float:right">₱${addOns.toFixed(2)}</span></p>` : ''}
<hr style="border: none; border-top: 1px solid #ddd; margin: 1rem 0;">
<strong style="display: block; margin-top: 0.5rem; color: #333;">Subtotal <span style="float:right">₱${Number(attendanceOnly).toFixed(2)}</span></strong>
</div>`;
    } else {
        Object.keys(branchData).forEach((branch) => {
            const data = branchData[branch];
            const daysCount = data.days.length;
            const sortedDates = [...new Set(data.days)].sort((a, b) => new Date(a) - new Date(b));
            const datesList = sortedDates.map((dateStr) => `<li>${formatDateForPayslip(dateStr)}</li>`).join('');
            breakdownHTML += `
<div style="background: #f1f9f2; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; color: #2b9348; font-size: 1.1rem; font-weight: 600;">${escapePayslipHtml(branch)}</h4>
<strong style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.5rem;">
<span>DAYS WORKED</span>
<span>${daysCount} day${daysCount !== 1 ? 's' : ''}</span>
</strong>
<ul style="margin: 0.5rem 0 1rem 0; padding-left: 1.2rem; list-style-type: disc;">${datesList}</ul>
<p style="margin: 0.5rem 0; color: #333;">Basic Pay <span style="float:right">₱${data.basicPay.toFixed(2)}</span></p>
${data.mealAllowance > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Meal Allowance <span style="float:right">₱${data.mealAllowance.toFixed(2)}</span></p>` : ''}
${data.transportAllowance > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Transport Allowance <span style="float:right">₱${data.transportAllowance.toFixed(2)}</span></p>` : ''}
${data.overtimePay > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Overtime Hours <span style="float:right">₱${data.overtimePay.toFixed(2)}</span></p>` : ''}
${data.lateDeduction > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Late Deduction <span style="float:right">–₱${data.lateDeduction.toFixed(2)}</span></p>` : ''}
${data.undertimeDeduction > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Undertime Deduction <span style="float:right">–₱${data.undertimeDeduction.toFixed(2)}</span></p>` : ''}
${data.salesBonus > 0 ? `<p style="margin: 0.5rem 0; color: #2b9348;"><strong>Sales Bonus</strong> <span style="float:right">₱${data.salesBonus.toFixed(2)}</span></p>` : ''}
${data.holidayBonus > 0 ? `<p style="margin: 0.5rem 0; color: #2b9348;"><strong>Holiday Pay</strong> <span style="float:right">₱${data.holidayBonus.toFixed(2)}</span></p>` : ''}
<hr style="border: none; border-top: 1px solid #ddd; margin: 1rem 0;">
<strong style="display: block; margin-top: 0.5rem; color: #333;">Subtotal <span style="float:right">₱${data.subtotal.toFixed(2)}</span></strong>
</div>`;
        });

        if (payType === 'hybrid') {
            const fixedAmt = Number(periodBreakdown.periodFixedAmount)
                || Number(mergedEmployee.periodFixedAmount)
                || 0;
            const dailyTotal = Number(periodBreakdown.dailyAttendanceTotal);
            breakdownHTML += `
<div style="background: #f5f0ff; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; color: #7e22ce; font-size: 1.1rem; font-weight: 600;">Hybrid Pay</h4>
${Number.isFinite(dailyTotal) ? `<p style="margin: 0.5rem 0; color: #333;">Daily Attendance Total <span style="float:right">₱${dailyTotal.toFixed(2)}</span></p>` : ''}
<p style="margin: 0.5rem 0; color: #333;">Fixed Amount (this cutoff) <span style="float:right">₱${fixedAmt.toFixed(2)}</span></p>
<hr style="border: none; border-top: 1px solid #ddd; margin: 1rem 0;">
<strong style="display: block; margin-top: 0.5rem; color: #333;">Period Total <span style="float:right">₱${Number(attendanceOnly).toFixed(2)}</span></strong>
</div>`;
        }
    }

    const lines = (Array.isArray(earningsLines) ? earningsLines : []).filter((l) => l.status !== 'waived');
    if (lines.length) {
        const linesHtml = lines.map((line) => {
            const amt = Number(line.amount) || 0;
            const label = earningsKindLabelFn(line.kind, amt)
                + (line.fromPriorCutoff ? ' (prior cutoff)' : '');
            const signAmt = amt < 0 ? `–₱${Math.abs(amt).toFixed(2)}` : `₱${amt.toFixed(2)}`;
            const isAdvance = line.kind === 'cash_advance' || amt < 0;
            const isReimb = line.kind === 'reimbursement';
            const color = isAdvance ? '#b91c1c' : (isReimb ? '#2b9348' : '#333');
            return `<p style="margin: 0.5rem 0; color: ${color};">${escapePayslipHtml(label)} <span style="float:right">${signAmt}</span></p>`;
        }).join('');
        breakdownHTML += `
<div style="background: #fef2f2; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; color: #b91c1c; font-size: 1.1rem; font-weight: 600;">Deductions / Adjustments</h4>
${linesHtml}
<hr style="border: none; border-top: 1px solid #ddd; margin: 1rem 0;">
<strong style="display: block; margin-top: 0.5rem; color: #333;">Net Total <span style="float:right">₱${Number(grandTotal).toFixed(2)}</span></strong>
</div>`;
    }

    if (!breakdownHTML) {
        breakdownHTML = `<div style="padding:1rem;"><p>No attendance this period.</p><strong>Total <span style="float:right">₱${Number(grandTotal).toFixed(2)}</span></strong></div>`;
    }

    return breakdownHTML;
}

/** Exact staff-portal salary statement document HTML. */
export function buildPayslipDocumentHtml({
    employeeName,
    employeeRole = 'Barista',
    transferMode = 'GoTyme',
    periodLabel,
    grandTotal,
    breakdownHTML
}) {
    const name = escapePayslipHtml(employeeName || 'Employee');
    return `
<div style="font-family: 'Segoe UI', sans-serif; background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05); max-width: 800px; margin: 0 auto;">
<img src="https://matchanese.com/cdn/shop/files/matchanese-2025-logo_e4944ef8-b626-4206-80c5-cc4fd9ed79ab.png?v=1738086945&width=60" style="max-height: 50px; margin-bottom: 1rem;" />
<h2 style="margin: 0 0 0.5rem 0; font-size: 1.8rem; font-weight: 600; color: #333;">Your Salary Statement</h2>
<p style="margin: 0 0 2rem 0; color: #666; line-height: 1.6;">Hi ${name}! Here's your salary statement for this payroll period. We hope everything looks all good — but if you have any questions, just let us know anytime.</p>
<div style="background: #eef9f0; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
<div style="display: flex; justify-content: space-between; margin-bottom: 1.5rem; align-items: flex-start;">
<div style="display: flex; flex-direction: column;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">EMPLOYEE NAME</strong>
<span style="font-size: 22px; font-weight: 600; color: #000;">${name}</span>
</div>
<div style="display: flex; flex-direction: column; text-align: right;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">TOTAL PAYMENT</strong>
<span style="font-size: 22px; font-weight: 600; color: #000;">₱${Number(grandTotal).toFixed(2)}</span>
</div>
</div>
<div style="display: flex; justify-content: space-between;">
<div style="flex: 1; display: flex; flex-direction: column;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">ROLE</strong>
<span style="font-size: 17px; font-weight: 500;">${escapePayslipHtml(employeeRole)}</span>
</div>
<div style="flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">PAYROLL PERIOD</strong>
<span style="font-size: 17px; font-weight: 500;">${escapePayslipHtml(periodLabel)}</span>
</div>
<div style="flex: 1; display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">MODE OF TRANSFER</strong>
<span style="font-size: 17px; font-weight: 500;">${escapePayslipHtml(transferMode)}</span>
</div>
</div>
</div>
<div id="breakdown">${breakdownHTML || ''}</div>
<div style="text-align: center; font-size: 0.85rem; color: #777; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e0e0e0;">
Matchanese, Inc.<br />
Unit 4506, Edades Tower, Amorsolo Drive, Rockwell, Makati City, Philippines
</div>
</div>`;
}

/**
 * Render statement HTML → PDF blob via html2canvas + jsPDF (same pipeline as staff portal).
 */
export async function renderPayslipHtmlToPdf({
    payslipHTML,
    filename = 'matchanese_payslip.pdf',
    html2canvasFn,
    jsPDFCtor
}) {
    const html2canvas = html2canvasFn || (typeof window !== 'undefined' ? window.html2canvas : null);
    const JsPDF = jsPDFCtor || (typeof window !== 'undefined' ? window.jspdf?.jsPDF : null);
    if (!html2canvas || !JsPDF) {
        throw new Error('PDF libraries not loaded');
    }

    const payslipContainer = document.createElement('div');
    payslipContainer.innerHTML = payslipHTML;
    payslipContainer.style.position = 'absolute';
    payslipContainer.style.left = '-9999px';
    payslipContainer.style.top = '0';
    payslipContainer.style.width = '800px';
    payslipContainer.style.background = 'white';
    document.body.appendChild(payslipContainer);

    await new Promise((r) => setTimeout(r, 200));

    let canvas;
    try {
        canvas = await html2canvas(payslipContainer, {
            backgroundColor: '#ffffff',
            scale: 1.5,
            logging: false,
            useCORS: true,
            width: 800,
            height: payslipContainer.scrollHeight
        });
    } finally {
        if (payslipContainer.parentNode) {
            document.body.removeChild(payslipContainer);
        }
    }

    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pageWidth - 20;
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    const maxHeight = pageHeight - 20;

    if (pdfHeight > maxHeight) {
        let remainingHeight = pdfHeight;
        let sourceY = 0;
        let yPosition = 10;
        while (remainingHeight > 0) {
            const pageHeightToUse = Math.min(maxHeight, remainingHeight);
            const sourceHeightToUse = (pageHeightToUse / pdfHeight) * canvas.height;
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sourceHeightToUse;
            pageCanvas.getContext('2d').drawImage(
                canvas,
                0,
                sourceY,
                canvas.width,
                sourceHeightToUse,
                0,
                0,
                canvas.width,
                sourceHeightToUse
            );
            pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 10, yPosition, pdfWidth, pageHeightToUse);
            remainingHeight -= pageHeightToUse;
            sourceY += sourceHeightToUse;
            if (remainingHeight > 0) {
                pdf.addPage();
                yPosition = 10;
            }
        }
    } else {
        pdf.addImage(imgData, 'JPEG', 10, 10, pdfWidth, pdfHeight);
    }

    return {
        pdf,
        blob: pdf.output('blob'),
        dataUrl: pdf.output('datauristring'),
        filename
    };
}

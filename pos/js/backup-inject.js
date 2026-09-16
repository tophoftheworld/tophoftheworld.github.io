if (window.__posBackupInjected) {
  // already running
} else {
  window.__posBackupInjected = true;

  function openPosOrderBackup() {
    if (typeof window.showOrderBackupModal === 'function') {
      window.showOrderBackupModal();
      return;
    }

    try {
      const backupRaw = localStorage.getItem('orderHistoryBackup');
      const liveRaw = localStorage.getItem('orderHistory') || '[]';
      const backup = backupRaw ? JSON.parse(backupRaw) : [];
      const live = JSON.parse(liveRaw);
      const orders = (Array.isArray(backup) && backup.length > live.length) ? backup : live;
      let total = 0;
      let count = 0;
      orders.forEach((order) => {
        if (!order || order.status === 'deleted') return;
        count += 1;
        if (order.status === 'pending' || order.status === 'completed') {
          total += Number(order.total) || 0;
        }
      });
      const json = JSON.stringify({
        exportedAt: new Date().toISOString(),
        orderCount: orders.length,
        salesTotal: total,
        orders
      }, null, 2);

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;max-width:640px;width:100%;max-height:88vh;overflow:auto;padding:20px;border-radius:8px;font-family:Poppins,sans-serif;';
      const title = document.createElement('h2');
      title.textContent = 'LOCAL ORDER BACKUP';
      title.style.cssText = 'margin:0 0 12px;font-size:18px;letter-spacing:1px;';
      const summary = document.createElement('p');
      summary.style.cssText = 'margin:0 0 12px;font-size:14px;';
      summary.textContent = `This device has ${count} local orders totaling ₱${total.toFixed(2)}.`;
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.readOnly = true;
      ta.style.cssText = 'width:100%;min-height:160px;font-size:11px;box-sizing:border-box;';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'COPY JSON';
      copyBtn.style.cssText = 'margin-top:12px;margin-right:8px;background:#1d8a00;color:#fff;border:none;padding:10px 16px;text-transform:uppercase;letter-spacing:1px;';
      copyBtn.addEventListener('click', () => {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json);
        } else {
          document.execCommand('copy');
        }
        alert('Copied. Paste it into Notes, Files, or an email.');
      });
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'CLOSE';
      closeBtn.style.cssText = 'margin-top:12px;background:#eee;border:none;padding:10px 16px;text-transform:uppercase;letter-spacing:1px;';
      closeBtn.addEventListener('click', () => overlay.remove());
      box.appendChild(title);
      box.appendChild(summary);
      box.appendChild(ta);
      box.appendChild(copyBtn);
      box.appendChild(closeBtn);
      overlay.appendChild(box);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
      document.body.appendChild(overlay);
    } catch (error) {
      alert('Could not read local orders: ' + error.message);
    }
  }

  window.openPosOrderBackup = openPosOrderBackup;
}

export {};

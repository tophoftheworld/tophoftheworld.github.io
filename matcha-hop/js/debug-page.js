import { getFirebaseDebugSnapshot, clearAllPostsData, deletePostById, getApiCallCounts } from './debug-api.js';

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function renderSnapshot(data) {
  const root = document.getElementById('debug-counters');
  if (!root) return;
  const apiCounts = getApiCallCounts();
  const latest = data.logs?.latest || [];
  root.innerHTML = `
    <section class="admin-list-wrap" style="margin-bottom:16px;">
      <h2 style="margin:0 0 8px;">Posts</h2>
      <ul class="admin-list" style="display:block;">
        <li class="admin-item" style="display:block;">
          <div><strong>logs</strong>: ${data.logs?.count || 0}</div>
          <div style="font-size:12px;color:#666;">Sample IDs: ${data.logs?.sampleIds?.length ? data.logs.sampleIds.join(', ') : 'none'}</div>
        </li>
      </ul>
    </section>
    <section class="admin-list-wrap" style="margin-bottom:16px;">
      <h2 style="margin:0 0 8px;">Latest posts (delete individually)</h2>
      <ul class="admin-list" style="display:block;">
        ${latest.length ? latest.map((post) => `
          <li class="admin-item" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="min-width:0;">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${post.drinkName || '(no drink)'} ${post.brandName ? `at ${post.brandName}` : ''}</div>
              <div style="font-size:12px;color:#666;">${post.id}${post.createdAt ? ` · ${formatTs(post.createdAt)}` : ''}</div>
            </div>
            <button type="button" class="admin-btn-refresh debug-delete-post-btn" data-post-id="${post.id}" style="background:#b42318;border-color:#b42318;">Delete</button>
          </li>
        `).join('') : '<li class="admin-item">No posts found.</li>'}
      </ul>
    </section>
    <section class="admin-list-wrap">
      <h2 style="margin:0 0 8px;">Local API call counters</h2>
      <pre style="white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;padding:10px;border-radius:8px;">${JSON.stringify(apiCounts, null, 2)}</pre>
    </section>
  `;
  root.querySelectorAll('.debug-delete-post-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const postId = btn.getAttribute('data-post-id');
      const ok = window.confirm(`Delete post ${postId}?`);
      if (!ok) return;
      const status = document.getElementById('debug-status');
      try {
        if (status) status.textContent = `Deleting ${postId}...`;
        await deletePostById(postId);
        await refresh();
        if (status) status.textContent = `Deleted ${postId}.`;
      } catch (err) {
        if (status) status.textContent = `Failed to delete ${postId}: ${err?.message || err}`;
      }
    });
  });
}

async function refresh() {
  const status = document.getElementById('debug-status');
  try {
    if (status) status.textContent = 'Refreshing...';
    const snapshot = await getFirebaseDebugSnapshot();
    renderSnapshot(snapshot);
    if (status) status.textContent = 'Snapshot loaded.';
  } catch (err) {
    if (status) status.textContent = `Failed to load snapshot: ${err?.message || err}`;
  }
}

async function clearData() {
  const status = document.getElementById('debug-status');
  const ok = window.confirm('Delete ALL posts from logs? This cannot be undone.');
  if (!ok) return;
  try {
    if (status) status.textContent = 'Deleting all posts...';
    await clearAllPostsData();
    if (status) status.textContent = 'All posts deleted.';
    await refresh();
  } catch (err) {
    if (status) status.textContent = `Failed to clear data: ${err?.message || err}`;
  }
}

document.getElementById('debug-refresh')?.addEventListener('click', refresh);
document.getElementById('debug-clear')?.addEventListener('click', clearData);
refresh();

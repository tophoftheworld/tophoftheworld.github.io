/** Durable Discord receipt polling. All work is awaited inside a scheduled request. */
const { REST, Routes } = require('discord.js');
const { randomUUID, createHash } = require('node:crypto');
const { buildChannelDefaultsMap } = require('./discordExpenseChannels');
const { createExpenseFromReceiptImage } = require('./createExpenseFromReceipt');
const { prepareReceiptImage } = require('./prepareReceiptImage');
const { isImageAttachment, isHeicAttachment, isHeicBuffer, convertHeicToJpeg, downloadAttachment, withTimeout } = require('./discordExpenseBot');

const JOBS = 'discord_receipt_jobs';
const STATE = 'discord_receipt_state';
const LEASE_MS = 600_000; // Longer than the function's 540-second hard deadline.
const MAX_ATTEMPTS = 3;
const snowflakeAt = (ms) => ((BigInt(ms) - 1420070400000n) << 22n).toString();
const jobIdFor = (channelId, messageId, attachmentId) => `discord_${channelId}_${messageId}_${attachmentId}`;
const attachmentFromApi = (a) => ({ ...a, name: a.filename, contentType: a.content_type });

function createDiscordExpensePoll(deps) {
  const db = deps.admin.firestore();
  const now = deps.now || Date.now;
  const getEnv = deps.getEnv || (() => process.env);
  const rest = deps.rest || new REST({ version: '10', timeout: 20_000, retries: 1 });
  const createExpense = deps.createExpense || createExpenseFromReceiptImage;
  const download = deps.download || downloadAttachment;
  const prepare = deps.prepare || prepareReceiptImage;
  const stateRef = db.collection(STATE).doc('poll');

  async function health() {
    const snap = await stateRef.get();
    const state = snap.data() || {};
    return {
      ok: Boolean(state.lastCompletedAt && now() - state.lastCompletedAt < 10 * 60_000 && !state.lastError),
      mode: 'scheduled-poll',
      configuredChannels: buildChannelDefaultsMap(getEnv()).size,
      lastCompletedAt: state.lastCompletedAt || null,
      lastStartedAt: state.lastStartedAt || null,
      lastSavedAt: state.lastSavedAt || null,
      lastRunFailed: Boolean(state.lastError)
    };
  }

  async function acquire() {
    const owner = randomUUID();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      if ((snap.data()?.leaseUntil || 0) > now()) return null;
      tx.set(stateRef, { owner, leaseUntil: now() + LEASE_MS, lastStartedAt: now() }, { merge: true });
      return owner;
    });
  }

  // Page backwards from a fixed high-water mark; never skip messages in large backlogs.
  // Persist each page only after all of its jobs exist. Re-reading a page is harmless.
  async function discover(channelId, defaults, deadline) {
    const ref = db.collection(STATE).doc(`channel_${channelId}`);
    let state = (await ref.get()).data();
    if (!state) {
      state = { cursor: snowflakeAt(now()), initializedAt: now() };
      await ref.create(state);
      console.log(`[discordReceiptPoll] initialized channel=${channelId}; historical messages require reconciliation`);
    }
    let before = state.scanBefore;
    let highWater = state.scanHighWater;
    for (let page = 0; page < 10 && now() < deadline; page++) {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const messages = await rest.get(Routes.channelMessages(channelId), { query });
      if (!Array.isArray(messages)) throw new Error('Invalid Discord message response');
      messages.sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
      if (!highWater) highWater = messages[0]?.id || state.cursor;
      for (const message of messages) {
        if (BigInt(message.id) <= BigInt(state.cursor) || message.author?.bot) continue;
        for (const raw of message.attachments || []) {
          const image = attachmentFromApi(raw);
          if (!isImageAttachment(image)) continue;
          const id = jobIdFor(channelId, message.id, image.id);
          try {
            await db.collection(JOBS).doc(id).create({
              id, channelId, messageId: message.id, attachmentId: image.id,
              author: message.member?.nick || message.author?.global_name || message.author?.username || 'Discord',
              defaults, status: 'queued', attempts: 0, nextAttemptAt: now(), createdAt: now(),
              filename: image.name || 'receipt'
            });
          } catch (err) {
            if (err.code !== 6 && err.code !== 'already-exists') throw err;
          }
        }
      }
      const oldest = messages.at(-1)?.id;
      if (messages.length < 100 || !oldest || BigInt(oldest) <= BigInt(state.cursor)) {
        await ref.set({ cursor: BigInt(highWater) > BigInt(state.cursor) ? highWater : state.cursor, initializedAt: state.initializedAt, lastScannedAt: now() });
        return;
      }
      before = oldest;
      await ref.set({ ...state, scanBefore: before, scanHighWater: highWater, lastScannedAt: now() });
    }
  }

  async function statusMessage(ref, job, content) {
    const body = { content: content.slice(0, 1900), allowed_mentions: { parse: [] } };
    if (job.statusMessageId) {
      try { return await rest.patch(Routes.channelMessage(job.channelId, job.statusMessageId), { body }); }
      catch (err) { if (err.status !== 404) throw err; }
    }
    const sent = await rest.post(Routes.channelMessages(job.channelId), { body: {
      ...body,
      message_reference: { message_id: job.messageId, fail_if_not_exists: false },
      nonce: createHash('sha256').update(job.id).digest('hex').slice(0, 24), enforce_nonce: true
    } });
    job.statusMessageId = sent.id;
    await ref.update({ statusMessageId: sent.id });
    // Discord may return the earlier acknowledgement for a repeated nonce after
    // a crash; ensure its content reflects the current, committed outcome.
    return rest.patch(Routes.channelMessage(job.channelId, sent.id), { body });
  }

  async function notify(ref, job) {
    let content;
    if (job.status === 'saved') {
      const expense = (await db.collection('expenses').doc(job.expenseId || job.id).get()).data();
      if (!expense) throw new Error('Saved expense is missing; notification held for review');
      content = `✅ ${job.duplicate ? 'Receipt already recorded — no duplicate created' : 'Expense saved'} — **${expense.allocation || job.defaults.label}**\n${expense.supplierName} · ${expense.date} · ₱${Number(expense.totalAmount).toFixed(2)}\n${expense.expenseCategory} · Paid by: ${expense.paidBy}\nReceipt: ${job.filename}\nExpense ID: ${expense.id}`;
    } else {
      content = `⚠️ Receipt needs review: ${job.filename}\n${job.lastError || 'Automatic processing did not finish.'}\nCheck the Expenses app before submitting another copy. Reference: ${job.id}`;
    }
    await statusMessage(ref, job, content);
    await ref.update({ notifiedAt: now(), nextAttemptAt: deps.admin.firestore.FieldValue.delete() });
  }

  async function processJob(doc) {
    const ref = doc.ref;
    let job = doc.data();
    // An expense write may have succeeded before a process crash / lost response.
    const existing = await db.collection('expenses').doc(job.expenseId || job.id).get();
    if (existing.exists && job.status !== 'saved') {
      job = { ...job, status: 'saved' };
      await ref.update({ status: 'saved', savedAt: now() });
    }
    if (job.status === 'saved' || job.status === 'needs_review') {
      try { await notify(ref, job); }
      catch (err) {
        await ref.update({ nextAttemptAt: now() + 300_000, notificationError: String(err.message).slice(0, 400) });
        console.error(`[discordReceiptPoll] notification pending job=${job.id}`);
      }
      return;
    }
    if (job.attempts >= MAX_ATTEMPTS) {
      await ref.update({ status: 'needs_review', nextAttemptAt: now(), lastError: 'Automatic retries exhausted. Please review this receipt in the Expenses app.' });
      return;
    }
    job.attempts += 1;
    await ref.update({ status: 'processing', attempts: job.attempts, nextAttemptAt: now() + LEASE_MS });
    try {
      await statusMessage(ref, job, `Reading receipt for **${job.defaults.label}** — ${job.filename} (attempt ${job.attempts}/${MAX_ATTEMPTS})…`).catch(() => {});
      // Re-fetch the message so expired Discord CDN attachment URLs are refreshed.
      const message = await rest.get(Routes.channelMessage(job.channelId, job.messageId));
      const raw = message.attachments?.find((a) => a.id === job.attachmentId);
      if (!raw) throw Object.assign(new Error('Original attachment is no longer available.'), { needsReview: true });
      const image = attachmentFromApi(raw);
      let { buffer, contentType } = await download(image.url);
      let mimeType = contentType.split(';')[0];
      if (isHeicAttachment(image) || isHeicBuffer(mimeType, buffer)) {
        buffer = await withTimeout(convertHeicToJpeg(buffer), 30_000, 'HEIC conversion');
        mimeType = 'image/jpeg';
      }
      const prepared = await withTimeout(prepare(buffer, mimeType), 30_000, 'Image preparation');
      // Only the OCR HTTP request times out. Never race a timeout against database writes.
      const result = await createExpense({
        admin: deps.admin, apiKey: deps.getGeminiApiKey(), imageBuffer: prepared.buffer,
        mimeType: prepared.mimeType, channelDefaults: job.defaults, discordAuthor: job.author,
        expenseId: job.id,
        source: { channelId: job.channelId, messageId: job.messageId, attachmentId: job.attachmentId },
        ocrOptions: { maxAttemptsPerModel: 1, fetchTimeoutMs: 45_000 }
      });
      await ref.update({ status: 'saved', expenseId: result?.expense?.id || job.id,
        duplicate: Boolean(result?.duplicate), savedAt: now(), nextAttemptAt: now(), lastError: null });
      await stateRef.set({ lastSavedAt: now() }, { merge: true });
      console.log(`[discordReceiptPoll] saved job=${job.id}`);
    } catch (err) {
      // Reconcile ambiguous writes before retrying or calling the receipt a failure.
      const committed = await db.collection('expenses').doc(job.id).get();
      const status = committed.exists ? 'saved' : err.needsReview || job.attempts >= MAX_ATTEMPTS ? 'needs_review' : 'retry';
      await ref.update({ status, nextAttemptAt: now() + (status === 'retry' ? 60_000 * job.attempts : 0),
        lastError: committed.exists ? null : err.needsReview ? err.message : 'Could not finish reading this receipt. Please check or enter it in the Expenses app.' });
      console.error(`[discordReceiptPoll] job=${job.id} status=${status} error=${err.name || 'Error'}`);
    }
    job = (await ref.get()).data();
    if (job.status === 'saved' || job.status === 'needs_review') {
      try { await notify(ref, job); }
      catch (_) { await ref.update({ nextAttemptAt: now() + 300_000 }); }
    }
  }

  async function poll() {
    const token = String(deps.getBotToken() || '').trim();
    if (!token) throw new Error('Discord bot token missing');
    const channels = buildChannelDefaultsMap(getEnv());
    if (!channels.size) throw new Error('No expense channels configured');
    rest.setToken(token);
    const owner = await acquire();
    if (!owner) return { skipped: 'another poll is running' };
    const deadline = now() + 420_000;
    try {
      for (const [id, defaults] of channels) await discover(id, defaults, deadline - 180_000);
      const due = await db.collection(JOBS).where('nextAttemptAt', '<=', now()).orderBy('nextAttemptAt').limit(100).get();
      for (const doc of due.docs) {
        if (now() > deadline - 180_000) break;
        await processJob(doc);
      }
      await stateRef.set({ lastCompletedAt: now(), lastError: null }, { merge: true });
      console.log(`[discordReceiptPoll] completed channels=${channels.size} due=${due.size}`);
      return { ok: true, due: due.size };
    } catch (err) {
      await stateRef.set({ lastError: String(err.message).slice(0, 400) }, { merge: true });
      throw err;
    } finally {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (snap.data()?.owner === owner) tx.set(stateRef, { leaseUntil: 0 }, { merge: true });
      });
    }
  }
  return { poll, health, discover, processJob, acquire };
}
module.exports = { createDiscordExpensePoll, jobIdFor, snowflakeAt, JOBS, STATE };

const assert = require('node:assert/strict');
const { createDiscordExpensePoll, jobIdFor, JOBS, STATE } = require('../discordExpensePoll');
const { normalizeParsed } = require('../extractExpenseReceipt');
const { validateReceipt, todayLocalIso } = require('../createExpenseFromReceipt');
const { downloadAttachment } = require('../discordExpenseBot');

function memoryDb() {
  const rows = new Map();
  const deleted = Symbol('delete');
  let tail = Promise.resolve();
  const ref = (path) => ({
    path, id: path.split('/').at(-1),
    async get() { return { exists: rows.has(path), data: () => structuredClone(rows.get(path)), ref: this }; },
    async create(data) { if (rows.has(path)) throw Object.assign(new Error('exists'), { code: 6 }); rows.set(path, structuredClone(data)); },
    async set(data, options) {
      const row = options?.merge ? { ...rows.get(path) } : {};
      for (const [key, value] of Object.entries(data)) { if (value === deleted) delete row[key]; else row[key] = value; }
      rows.set(path, structuredClone(row));
    },
    async update(data) { assert(rows.has(path)); return this.set(data, { merge: true }); }
  });
  const db = {
    collection(name) {
      const query = (field, value) => ({
        orderBy() { return this; }, limit() { return this; },
        async get() {
          const docs = [];
          for (const [path, row] of rows) if (path.startsWith(`${name}/`) && row[field] <= value) docs.push(await ref(path).get());
          docs.sort((a, b) => a.data()[field] - b.data()[field]);
          return { docs, size: docs.length };
        }
      });
      return { doc: (id) => ref(`${name}/${id}`), where: (field, op, value) => query(field, value) };
    },
    runTransaction(fn) {
      const run = tail.then(() => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o) }));
      tail = run.catch(() => {}); return run;
    }
  };
  const firestore = () => db;
  firestore.FieldValue = { delete: () => deleted };
  return { db, admin: { firestore }, rows };
}
const defaults = { allocation: 'General', branch: null, label: 'General' };
function fixture() {
  const store = memoryDb();
  let clock = Date.parse('2026-10-03T12:00:00Z');
  let saves = 0; let notifications = 0; let failNotify = false;
  const messages = [{ id: '201', author: { username: 'A' }, attachments: [
    { id: '301', filename: 'one.jpg', content_type: 'image/jpeg', url: 'https://cdn.discordapp.com/one' },
    { id: '302', filename: 'two.jpg', content_type: 'image/jpeg', url: 'https://cdn.discordapp.com/two' }
  ] }];
  const rest = {
    setToken() {},
    async get(route, options) {
      if (route.endsWith('/messages')) return messages.filter((m) => !options?.query?.get('before') || BigInt(m.id) < BigInt(options.query.get('before'))).sort((a,b)=>Number(BigInt(b.id)-BigInt(a.id))).slice(0,100);
      return messages.find((m) => route.endsWith(`/${m.id}`));
    },
    async post(route, options) { if (failNotify && options.body.content.includes('saved')) throw new Error('Discord down'); notifications++; return { id: '999' }; },
    async patch(route, options) { if (failNotify && options.body.content.includes('saved')) throw new Error('Discord down'); notifications++; return { id: '999' }; }
  };
  const deps = { admin: store.admin, rest, now: () => clock,
    getEnv: () => ({ DISCORD_EXPENSE_CHANNEL_GENERAL: '101' }), getBotToken: () => 'test', getGeminiApiKey: () => 'test',
    download: async () => ({ buffer: Buffer.alloc(40), contentType: 'image/jpeg' }),
    prepare: async (buffer) => ({ buffer, mimeType: 'image/jpeg' }),
    createExpense: async (opts) => { saves++; await store.db.collection('expenses').doc(opts.expenseId).create({ id: opts.expenseId, supplierName:'Shop',date:'2026-10-03',totalAmount:112,expenseCategory:'Supplies',paidBy:'Company' }); }
  };
  return { ...store, deps, messages, bot: () => createDiscordExpensePoll(deps),
    advance: (ms) => { clock += ms; }, saves: () => saves, notifications: () => notifications,
    failNotify: () => { failNotify = true; }, recoverNotify: () => { failNotify = false; } };
}
async function seed(f) { await f.db.collection(STATE).doc('channel_101').create({cursor:'100',initializedAt:1}); }
(async () => {
  const f = fixture(); await seed(f);
  await f.bot().poll(); assert.equal(f.saves(), 2, 'all image attachments save');
  await f.bot().poll(); assert.equal(f.saves(), 2, 'new process/repeated poll must not duplicate');
  assert.equal((await f.bot().health()).ok, true);

  const n = fixture(); await seed(n); n.failNotify();
  await n.bot().poll(); assert.equal(n.saves(),2);
  for (const [path,row] of n.rows) if(path.startsWith(`${JOBS}/`)) assert.equal(row.status,'saved','notification errors never mark saved expenses failed');
  n.recoverNotify(); n.advance(300_001); await n.bot().poll(); assert.equal(n.saves(),2);
  for (const [path,row] of n.rows) if(path.startsWith(`${JOBS}/`)) assert.equal(row.nextAttemptAt,undefined);

  const a = fixture(); await seed(a);
  const original = a.deps.createExpense;
  a.deps.createExpense = async (opts) => { await original(opts); throw new Error('response lost after commit'); };
  await a.bot().poll(); assert.equal(a.saves(),2);
  for (const [path,row] of a.rows) if(path.startsWith(`${JOBS}/`)) assert.equal(row.status,'saved');

  const r = fixture(); await seed(r);
  let attempts=0; r.deps.createExpense = async () => {attempts++;throw new Error('OCR unavailable');};
  for(let i=0;i<4;i++){await r.bot().poll();r.advance(600_001);}
  assert.equal(attempts,6,'three attempts per attachment');
  for (const [path,row] of r.rows) if(path.startsWith(`${JOBS}/`)) assert.equal(row.status,'needs_review');

  const c = fixture(); await seed(c);
  const owners = await Promise.all([c.bot().acquire(),c.bot().acquire()]);
  assert.equal(owners.filter(Boolean).length,1,'overlapping scheduler requests have one owner');
  c.advance(600_001); assert(await c.bot().acquire(),'lease recovers after killed process');

  const p = fixture(); await seed(p); p.messages.splice(0);
  for(let i=101;i<=305;i++) p.messages.push({id:String(i),author:{bot:false},attachments:[{id:String(i+1000),filename:'a.jpg',content_type:'image/jpeg'}]});
  await p.bot().discover('101',defaults,Infinity);
  assert.equal([...p.rows.keys()].filter(k=>k.startsWith(`${JOBS}/`)).length,205,'pagination never skips a backlog');
  assert.equal(p.rows.get(`${STATE}/channel_101`).cursor,'305');
  await p.bot().discover('101',defaults,Infinity);
  assert.equal([...p.rows.keys()].filter(k=>k.startsWith(`${JOBS}/`)).length,205);

  const s = fixture(); await s.bot().poll(); assert.equal(s.saves(),0,'first activation does not replay legacy untracked receipts');
  assert.equal(jobIdFor('1','2','3'),jobIdFor('1','2','3'));
  assert.notEqual(jobIdFor('1','2','3'),jobIdFor('1','2','4'));
  assert.equal(todayLocalIso(new Date('2026-10-02T17:00:00Z')),'2026-10-03');
  assert.equal(normalizeParsed({date:'2024-07-20'},new Date('2026-10-03'),true).date,'2024-07-20','Discord preserves printed years');
  assert.throws(()=>validateReceipt({supplierName:'',totalAmount:0,date:''}), /needs review/);
  assert.throws(()=>validateReceipt({supplierName:'Shop',totalAmount:100,date:'2026-02-31'}), /needs review/);
  await assert.rejects(downloadAttachment('https://example.com/a.jpg'),/Unexpected/);
  console.log('discordExpensePoll: durability, retries, concurrency, pagination, notification and validation tests passed');
})().catch((e)=>{console.error(e);process.exitCode=1;});

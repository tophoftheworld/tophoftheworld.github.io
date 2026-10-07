const assert = require('node:assert/strict');
const { createExpenseFromReceiptImage, todayLocalIso } = require('../createExpenseFromReceipt');
const rows = new Map();
let uploads = 0, reads = 0;
let failAfterCommit = false;
const ref = (path) => ({
  async get() { return { exists: rows.has(path), data: () => rows.get(path) }; },
  async create(data) { if(rows.has(path)) throw Object.assign(new Error('exists'),{code:6}); rows.set(path,data); },
  async set(data) { rows.set(path,data); }, path
});
const db = {
  collection(name) { return { doc: id => ref(`${name}/${id}`), async get() { return {docs:[]}; } }; },
  async runTransaction(fn) {
    const writes=[];
    const result=await fn({get:r=>r.get(),create:(r,d)=>writes.push([r,d])});
    for(const [r,d] of writes) await r.create(d);
    if(failAfterCommit) {failAfterCommit=false;throw new Error('network response lost');}
    return result;
  }
};
const storage = {
  bucket() {
    return { name: 'test-bucket', file() {
      return { async save(buffer, options) {
        uploads++;
        assert(options.metadata.metadata.firebaseStorageDownloadTokens);
        assert.equal(options.metadata.cacheControl, 'private,max-age=3600');
      } };
    } };
  }
};
const admin = {firestore:()=>db,storage:()=>storage};
const originalFetch = global.fetch;
global.fetch = async(url,opts)=>{if(opts?.method==='HEAD')return {ok:true,status:200};reads++;return {ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({supplierName:'Merchant',date:todayLocalIso(),totalAmount:112,items:[]})}]}}]})};};
const options = {admin,apiKey:'test',imageBuffer:Buffer.alloc(40,1),channelDefaults:{allocation:'General',branch:null},expenseId:'discord_a',source:{channelId:'1',messageId:'2',attachmentId:'3'}};
(async()=>{
  failAfterCommit=true;
  const first=await createExpenseFromReceiptImage(options);
  assert.equal(first.expense.id,'discord_a','lost commit response is reconciled');
  assert(first.expense.receiptImage.includes('firebasestorage.googleapis.com'));
  assert(first.expense.receiptImage.includes('token='));
  await createExpenseFromReceiptImage(options);
  assert.equal(reads,1,'same message retries do not call OCR');
  const duplicate=await createExpenseFromReceiptImage({...options,expenseId:'discord_b'});
  assert.equal(duplicate.expense.id,'discord_a');assert.equal(duplicate.duplicate,true);
  assert.equal(uploads,1,'same photo reupload does not store another receipt');
  assert.equal(reads,1,'same photo reupload does not call OCR');
  assert.equal([...rows.keys()].filter(k=>k.startsWith('expenses/')).length,1);
  rows.delete('expenses/discord_a');
  await assert.rejects(createExpenseFromReceiptImage({...options,expenseId:'discord_c'}), /removed/);
  console.log('createExpenseFromReceipt: commit recovery, attachment idempotency, image deduplication and tokenized storage tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.fetch=originalFetch;});

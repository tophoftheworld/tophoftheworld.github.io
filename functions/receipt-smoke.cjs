// Read-only live smoke check. Secrets are supplied in memory by the operator.
const { downloadAttachment, isImageAttachment, isHeicAttachment, isHeicBuffer, convertHeicToJpeg } = require('./discordExpenseBot');
const { prepareReceiptImage } = require('./prepareReceiptImage');
const { extractExpenseFieldsFromImage } = require('./extractExpenseReceipt');
(async () => {
  const channel = process.env.RECEIPT_SMOKE_CHANNEL;
  const headers = { Authorization: `Bot ${process.env.RECEIPT_SMOKE_DISCORD}` };
  const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages?limit=100`, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Discord read failed (${res.status})`);
  const messages = await res.json();
  const photos = messages.filter(m => !m.author.bot).flatMap(m => (m.attachments || []).map(a => ({ ...a, name:a.filename,contentType:a.content_type })) ).filter(isImageAttachment);
  console.log(JSON.stringify({ discordRead: 'ok', messagesInspected:messages.length, receiptImages:photos.length }));
  const photo = photos[0];
  if (!photo) throw new Error('No existing receipt available for read-only OCR verification');
  let {buffer,contentType}=await downloadAttachment(photo.url);
  if(isHeicAttachment(photo)||isHeicBuffer(contentType,buffer)){buffer=await convertHeicToJpeg(buffer);contentType='image/jpeg';}
  const image=await prepareReceiptImage(buffer,contentType);
  const parsed=await extractExpenseFieldsFromImage({apiKey:process.env.RECEIPT_SMOKE_GEMINI,imageBase64:image.buffer.toString('base64'),mimeType:image.mimeType,maxAttemptsPerModel:1,fetchTimeoutMs:45000,preserveDate:true});
  console.log(JSON.stringify({ocr:'ok',supplierPresent:Boolean(parsed.supplierName),datePresent:Boolean(parsed.date),positiveTotal:parsed.totalAmount>0,productionWrites:0}));
})().catch(e=>{ console.error(e.staffFacing ? 'OCR service could not complete the read-only smoke test' : e.message);process.exitCode=1; });

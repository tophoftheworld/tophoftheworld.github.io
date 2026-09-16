import { initializeFirebaseServices } from '../../shared/js/firebase-config.js?v=21';
import {
  ensureEventTypes,
  loadOpsEvents,
  loadOverlayLeads,
  createOpsEvent,
  updateOpsEvent,
  deleteOpsEvent,
  confirmOpsEvent,
  promoteLeadToOpsEvent,
  promoteInvoiceToOpsEvent,
  mergeInvoiceIntoOpsEvent,
  backfillOpsEventsFromBranches,
  archiveBranchForEvent,
  archiveOverlayBooking,
  patchBookingDetails,
  EVENT_STATUSES,
  OPS_EVENTS_COLLECTION,
  SERVICE_LEADS_COLLECTION,
  INVOICES_COLLECTION
} from '../../shared/js/ops-events.js?v=21';

let db = null;
let firestoreFns = null;
let ready = false;

export async function initSync() {
  if (ready) return { db, firestoreFns };
  const services = await initializeFirebaseServices('attendance');
  db = services.db;
  const fs = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
  firestoreFns = {
    getDocs: fs.getDocs,
    collection: fs.collection,
    doc: fs.doc,
    setDoc: fs.setDoc,
    addDoc: fs.addDoc,
    updateDoc: fs.updateDoc,
    deleteDoc: fs.deleteDoc,
    serverTimestamp: fs.serverTimestamp,
    query: fs.query,
    where: fs.where,
    getDoc: fs.getDoc
  };
  ready = true;
  return { db, firestoreFns };
}

export function getDb() {
  return { db, firestoreFns };
}

export async function seedAndLoadTypes() {
  await initSync();
  return ensureEventTypes(db, firestoreFns);
}

export async function fetchAllEvents() {
  await initSync();
  return loadOpsEvents(db, firestoreFns, { includeCancelled: false });
}

export async function fetchOverlayLeads(year, monthIndex) {
  await initSync();
  try {
    return await loadOverlayLeads(db, firestoreFns, { year, monthIndex });
  } catch (err) {
    console.error('Lead overlay load failed', err);
    return [];
  }
}

export async function saveNewEvent(input) {
  await initSync();
  return createOpsEvent(db, firestoreFns, input, { createdBy: 'events-app' });
}

export async function patchEvent(eventId, patch) {
  await initSync();
  return updateOpsEvent(db, firestoreFns, eventId, patch, { updatedBy: 'events-app' });
}

export async function removeEvent(eventId) {
  await initSync();
  return deleteOpsEvent(db, firestoreFns, eventId);
}

export async function confirmEvent(event, typeMeta) {
  await initSync();
  return confirmOpsEvent(db, firestoreFns, event, typeMeta);
}

export async function cancelEvent(event) {
  await initSync();
  await archiveBranchForEvent(db, firestoreFns, event);
  await updateOpsEvent(
    db,
    firestoreFns,
    event.id,
    { status: EVENT_STATUSES.cancelled },
    { updatedBy: 'events-app' }
  );
}

export async function promoteLead(lead) {
  await initSync();
  if (lead?.source === 'invoice' || lead?.invoiceId) {
    const invoiceId =
      lead.invoiceId ||
      (String(lead.id).startsWith('inv:') ? String(lead.id).split(':')[1] : null);
    const inv = invoiceId ? await getInvoiceById(invoiceId) : null;
    if (!inv) throw new Error('Invoice not found');
    return promoteInvoiceToOpsEvent(db, firestoreFns, inv, { createdBy: 'events-app' });
  }
  return promoteLeadToOpsEvent(db, firestoreFns, lead, { createdBy: 'events-app' });
}

export async function promoteInvoice(invoice, opts = {}) {
  await initSync();
  return promoteInvoiceToOpsEvent(db, firestoreFns, invoice, {
    createdBy: 'events-app',
    ...opts
  });
}

export async function mergeBookingIntoEvent(booking, eventId, retain) {
  await initSync();
  let invoice = null;
  if (booking?.source === 'invoice' || booking?.invoiceId) {
    invoice = await getInvoiceById(booking.invoiceId || String(booking.id).replace(/^inv:/, ''));
  } else if (booking?.invoiceId) {
    invoice = await getInvoiceById(booking.invoiceId);
  }
  if (invoice) {
    return mergeInvoiceIntoOpsEvent(db, firestoreFns, invoice, eventId, retain, {
      updatedBy: 'events-app'
    });
  }
  // Lead without invoice: link lead and optionally overwrite fields
  const { doc, updateDoc, getDoc } = firestoreFns;
  const evSnap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
  if (!evSnap.exists()) throw new Error('Event not found');
  const event = { id: evSnap.id, ...evSnap.data() };
  const pick = (key, eventVal, leadVal) =>
    (retain[key] || 'event') === 'invoice' || (retain[key] || 'event') === 'lead'
      ? leadVal
      : eventVal;
  const patch = {
    title: pick('title', event.title, booking.clientName),
    venue: pick('venue', event.venue, booking.targetVenue),
    startDate: pick('startDate', event.startDate, booking.targetDate),
    endDate: pick('endDate', event.endDate || event.startDate, booking.targetDate),
    links: {
      ...(event.links || {}),
      leadId: booking.id
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'events-app'
  };
  await updateDoc(doc(db, OPS_EVENTS_COLLECTION, eventId), patch);
  await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, booking.id), {
    opsEventId: eventId,
    updatedAt: new Date().toISOString()
  });
  return { id: eventId, ...event, ...patch };
}

export async function archiveBooking(booking) {
  await initSync();
  return archiveOverlayBooking(db, firestoreFns, booking, { updatedBy: 'events-app' });
}

export async function saveBookingDetails(input) {
  await initSync();
  return patchBookingDetails(db, firestoreFns, input, { updatedBy: 'events-app' });
}

export async function runBackfill() {
  await initSync();
  return backfillOpsEventsFromBranches(db, firestoreFns);
}

export async function getLeadById(leadId) {
  await initSync();
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, SERVICE_LEADS_COLLECTION, leadId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getInvoiceById(invoiceId) {
  await initSync();
  if (!invoiceId) return null;
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, INVOICES_COLLECTION, invoiceId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getEventById(eventId) {
  await initSync();
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export { EVENT_STATUSES };

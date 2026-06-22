/** Maps Chatbase conversation id → clientName from service leads (for Inbox display). */

let clientNameByConversationId = new Map();

export function indexLeadConversationNames(leads = []) {
  const next = new Map();
  for (const row of leads) {
    const conversationId = row?.conversationId;
    const name = row?.clientName?.trim();
    if (conversationId && name) {
      next.set(String(conversationId), name);
    }
  }
  clientNameByConversationId = next;
}

export function getClientNameForConversation(conversationId) {
  if (!conversationId) return null;
  return clientNameByConversationId.get(String(conversationId)) || null;
}

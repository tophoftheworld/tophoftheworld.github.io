const INBOX_DEFAULT_DAYS = 90;

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - INBOX_DEFAULT_DAYS);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Inbox filter params for Chatbase conversation API (shared with Service leads). */
export function getInboxQueryForApi() {
  const form = document.getElementById("filters-form");
  if (!form) {
    return {
      startDate: defaultStartDate(),
      endDate: defaultEndDate(),
      filteredSources: ""
    };
  }
  const formData = new FormData(form);
  return {
    startDate: formData.get("startDate") || defaultStartDate(),
    endDate: formData.get("endDate") || defaultEndDate(),
    filteredSources: formData.get("filteredSources") || ""
  };
}

/** Wide date range for loading a conversation by id (ignores narrow inbox filters). */
export function getConversationLookupQuery() {
  return {
    startDate: defaultStartDate(),
    endDate: defaultEndDate(),
    filteredSources: "",
    maxPages: 100
  };
}

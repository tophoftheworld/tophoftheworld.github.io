const { getFirestore } = require("firebase-admin/firestore");
const { logInfo, logError } = require("./logger");

const COLLECTIONS = {
  events: "workshop_events",
  sessions: "workshop_sessions",
  bookings: "workshop_bookings"
};

/**
 * Get upcoming workshop sessions with availability info
 * @param {object} options
 * @param {string} [options.eventType] - Filter by event type (e.g., "matcha workshop")
 * @param {number} [options.limit] - Max sessions to return (default 10)
 * @param {number} [options.daysAhead] - Look ahead this many days (default 90)
 * @returns {Promise<object>}
 */
async function getUpcomingWorkshopSessions({
  eventType = null,
  limit = 10,
  daysAhead = 90
} = {}) {
  const db = getFirestore();
  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const maxDate = futureDate.toISOString().slice(0, 10);

  try {
    let query = db
      .collection(COLLECTIONS.sessions)
      .where("date", ">=", today)
      .where("date", "<=", maxDate)
      .orderBy("date")
      .orderBy("startTime")
      .limit(limit * 2); // Get extra to filter/sort client-side

    const snapshot = await query.get();
    let sessions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Filter by event type if specified
    if (eventType) {
      const normalizedFilter = String(eventType).toLowerCase().trim();
      sessions = sessions.filter((s) => {
        const sessionType = String(s.eventType || "").toLowerCase().trim();
        return sessionType.includes(normalizedFilter) || normalizedFilter.includes(sessionType);
      });
    }

    // Filter to only open sessions with available slots
    sessions = sessions.filter((s) => {
      if (s.status === "cancelled" || s.status === "full") return false;
      const bookedSeats = Number(s.bookedSeats) || 0;
      const heldSeats = Number(s.heldSeats) || 0;
      const capacity = Number(s.capacity) || 0;
      const availableSeats = capacity - bookedSeats - heldSeats;
      return availableSeats > 0;
    });

    // Sort by date + time
    sessions.sort((a, b) => {
      const aDateTime = `${a.date}T${a.startTime}`;
      const bDateTime = `${b.date}T${b.startTime}`;
      return aDateTime.localeCompare(bDateTime);
    });

    // Apply final limit
    sessions = sessions.slice(0, limit);

    // Calculate remaining seats for each session
    const enrichedSessions = sessions.map((s) => {
      const bookedSeats = Number(s.bookedSeats) || 0;
      const heldSeats = Number(s.heldSeats) || 0;
      const capacity = Number(s.capacity) || 0;
      const availableSeats = capacity - bookedSeats - heldSeats;

      return {
        sessionId: s.id,
        eventType: s.eventType || "Workshop",
        sessionLabel: s.sessionLabel || s.sessionTitle || "",
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone || "Asia/Manila",
        capacity,
        bookedSeats,
        availableSeats,
        status: s.status || "open"
      };
    });

    return {
      ok: true,
      sessions: enrichedSessions,
      count: enrichedSessions.length,
      queryDate: today
    };
  } catch (error) {
    logError("Get upcoming workshop sessions failed", error);
    throw error;
  }
}

/**
 * Get details for a specific workshop event type
 * @param {object} options
 * @param {string} options.eventType - Event type to query
 * @returns {Promise<object>}
 */
async function getWorkshopEventDetails({ eventType }) {
  const db = getFirestore();

  try {
    const eventsSnapshot = await db
      .collection(COLLECTIONS.events)
      .where("eventName", "==", eventType)
      .limit(1)
      .get();

    if (eventsSnapshot.empty) {
      return {
        ok: false,
        message: `No event found with type: ${eventType}`
      };
    }

    const eventDoc = eventsSnapshot.docs[0];
    const eventData = eventDoc.data();

    return {
      ok: true,
      event: {
        eventId: eventDoc.id,
        eventName: eventData.eventName,
        venue: eventData.venue,
        address: eventData.address,
        durationHours: eventData.durationHours,
        notes: eventData.notes,
        status: eventData.status
      }
    };
  } catch (error) {
    logError("Get workshop event details failed", error);
    throw error;
  }
}

/**
 * Search for workshop sessions by various criteria
 * @param {object} options
 * @param {string} [options.query] - Search query
 * @param {string} [options.date] - Specific date (YYYY-MM-DD)
 * @param {string} [options.month] - Month prefix (YYYY-MM)
 * @returns {Promise<object>}
 */
async function searchWorkshopSessions({ query = "", date = null, month = null } = {}) {
  const db = getFirestore();

  try {
    let firestoreQuery;

    if (date) {
      // Search by specific date
      firestoreQuery = db
        .collection(COLLECTIONS.sessions)
        .where("date", "==", date)
        .orderBy("startTime");
    } else if (month) {
      // Search by month
      firestoreQuery = db
        .collection(COLLECTIONS.sessions)
        .where("date", ">=", `${month}-01`)
        .where("date", "<=", `${month}-31`)
        .orderBy("date")
        .orderBy("startTime");
    } else {
      // Default: upcoming sessions
      const today = new Date().toISOString().slice(0, 10);
      firestoreQuery = db
        .collection(COLLECTIONS.sessions)
        .where("date", ">=", today)
        .orderBy("date")
        .orderBy("startTime")
        .limit(20);
    }

    const snapshot = await firestoreQuery.get();
    let sessions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Apply text search if query provided
    if (query && query.trim()) {
      const normalizedQuery = query.toLowerCase().trim();
      sessions = sessions.filter((s) => {
        const searchText = [
          s.eventType || "",
          s.sessionLabel || "",
          s.sessionTitle || "",
          s.date || ""
        ]
          .join(" ")
          .toLowerCase();
        return searchText.includes(normalizedQuery);
      });
    }

    // Enrich with availability info
    const enrichedSessions = sessions.map((s) => {
      const bookedSeats = Number(s.bookedSeats) || 0;
      const heldSeats = Number(s.heldSeats) || 0;
      const capacity = Number(s.capacity) || 0;
      const availableSeats = capacity - bookedSeats - heldSeats;

      return {
        sessionId: s.id,
        eventType: s.eventType || "Workshop",
        sessionLabel: s.sessionLabel || s.sessionTitle || "",
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity,
        bookedSeats,
        availableSeats,
        status: s.status || "open"
      };
    });

    return {
      ok: true,
      sessions: enrichedSessions,
      count: enrichedSessions.length
    };
  } catch (error) {
    logError("Search workshop sessions failed", error);
    throw error;
  }
}

/**
 * Get next available workshop session for a specific event type
 * @param {object} options
 * @param {string} [options.eventType] - Event type to find
 * @returns {Promise<object>}
 */
async function getNextAvailableWorkshop({ eventType = null } = {}) {
  try {
    const result = await getUpcomingWorkshopSessions({
      eventType,
      limit: 1,
      daysAhead: 180
    });

    if (!result.ok || result.sessions.length === 0) {
      return {
        ok: false,
        message: eventType
          ? `No upcoming workshops found for: ${eventType}`
          : "No upcoming workshops found"
      };
    }

    const nextSession = result.sessions[0];

    return {
      ok: true,
      session: nextSession,
      message: `Next available: ${nextSession.eventType} on ${nextSession.date} at ${nextSession.startTime}`
    };
  } catch (error) {
    logError("Get next available workshop failed", error);
    throw error;
  }
}

/**
 * Format workshop sessions into human-readable text for Chatbase
 */
function formatSessionsForChat(sessions) {
  if (!sessions || sessions.length === 0) {
    return "No upcoming workshops available at the moment.";
  }

  const formatted = sessions.map((s) => {
    const dateObj = new Date(s.date);
    const dateStr = dateObj.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });

    return `• ${s.eventType}${s.sessionLabel ? ` - ${s.sessionLabel}` : ""}\n  📅 ${dateStr} at ${s.startTime}\n  🪑 ${s.availableSeats} ${s.availableSeats === 1 ? "slot" : "slots"} available (out of ${s.capacity})`;
  });

  return formatted.join("\n\n");
}

module.exports = {
  getUpcomingWorkshopSessions,
  getWorkshopEventDetails,
  searchWorkshopSessions,
  getNextAvailableWorkshop,
  formatSessionsForChat
};

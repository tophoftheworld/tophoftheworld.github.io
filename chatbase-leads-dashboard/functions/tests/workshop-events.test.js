const {
  getUpcomingWorkshopSessions,
  getWorkshopEventDetails,
  searchWorkshopSessions,
  getNextAvailableWorkshop,
  formatSessionsForChat
} = require("../workshop-events");

describe("workshop-events", () => {
  describe("getUpcomingWorkshopSessions", () => {
    it("should return upcoming sessions with default params", async () => {
      const result = await getUpcomingWorkshopSessions();
      expect(result).toHaveProperty("ok", true);
      expect(result).toHaveProperty("sessions");
      expect(result).toHaveProperty("count");
      expect(result).toHaveProperty("queryDate");
      expect(Array.isArray(result.sessions)).toBe(true);
    });

    it("should filter by event type", async () => {
      const result = await getUpcomingWorkshopSessions({
        eventType: "matcha workshop"
      });
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.sessions)).toBe(true);
    });

    it("should respect limit parameter", async () => {
      const limit = 5;
      const result = await getUpcomingWorkshopSessions({ limit });
      expect(result.ok).toBe(true);
      expect(result.sessions.length).toBeLessThanOrEqual(limit);
    });

    it("should only return sessions with available seats", async () => {
      const result = await getUpcomingWorkshopSessions();
      if (result.sessions.length > 0) {
        result.sessions.forEach((session) => {
          expect(session.availableSeats).toBeGreaterThan(0);
        });
      }
    });

    it("should return enriched session data", async () => {
      const result = await getUpcomingWorkshopSessions({ limit: 1 });
      if (result.sessions.length > 0) {
        const session = result.sessions[0];
        expect(session).toHaveProperty("sessionId");
        expect(session).toHaveProperty("eventType");
        expect(session).toHaveProperty("date");
        expect(session).toHaveProperty("startTime");
        expect(session).toHaveProperty("capacity");
        expect(session).toHaveProperty("bookedSeats");
        expect(session).toHaveProperty("availableSeats");
        expect(session).toHaveProperty("status");
      }
    });
  });

  describe("getNextAvailableWorkshop", () => {
    it("should return the next available workshop", async () => {
      const result = await getNextAvailableWorkshop();
      if (result.ok) {
        expect(result).toHaveProperty("session");
        expect(result).toHaveProperty("message");
        expect(result.session.availableSeats).toBeGreaterThan(0);
      } else {
        expect(result).toHaveProperty("message");
      }
    });

    it("should filter by event type when specified", async () => {
      const result = await getNextAvailableWorkshop({
        eventType: "matcha workshop"
      });
      if (result.ok) {
        expect(result.session.eventType.toLowerCase()).toContain("matcha");
      }
    });

    it("should return error when no workshops available", async () => {
      const result = await getNextAvailableWorkshop({
        eventType: "nonexistent-workshop-type-xyz"
      });
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty("message");
    });
  });

  describe("searchWorkshopSessions", () => {
    it("should search without filters", async () => {
      const result = await searchWorkshopSessions();
      expect(result).toHaveProperty("ok", true);
      expect(result).toHaveProperty("sessions");
      expect(result).toHaveProperty("count");
      expect(Array.isArray(result.sessions)).toBe(true);
    });

    it("should search by text query", async () => {
      const result = await searchWorkshopSessions({ query: "matcha" });
      expect(result.ok).toBe(true);
      if (result.sessions.length > 0) {
        result.sessions.forEach((session) => {
          const searchText = `${session.eventType} ${session.sessionLabel}`.toLowerCase();
          expect(searchText).toContain("matcha");
        });
      }
    });

    it("should search by specific date", async () => {
      const testDate = "2026-10-15";
      const result = await searchWorkshopSessions({ date: testDate });
      expect(result.ok).toBe(true);
      if (result.sessions.length > 0) {
        result.sessions.forEach((session) => {
          expect(session.date).toBe(testDate);
        });
      }
    });

    it("should search by month", async () => {
      const testMonth = "2026-10";
      const result = await searchWorkshopSessions({ month: testMonth });
      expect(result.ok).toBe(true);
      if (result.sessions.length > 0) {
        result.sessions.forEach((session) => {
          expect(session.date).toMatch(/^2026-10/);
        });
      }
    });
  });

  describe("getWorkshopEventDetails", () => {
    it("should return event details when event exists", async () => {
      // Note: This test requires a known event type in your database
      const result = await getWorkshopEventDetails({
        eventType: "Matcha Workshop"
      });
      // Result could be ok or not ok depending on DB state
      expect(result).toHaveProperty("ok");
      if (result.ok) {
        expect(result.event).toHaveProperty("eventId");
        expect(result.event).toHaveProperty("eventName");
        expect(result.event).toHaveProperty("venue");
      } else {
        expect(result).toHaveProperty("message");
      }
    });

    it("should return error for nonexistent event type", async () => {
      const result = await getWorkshopEventDetails({
        eventType: "Nonexistent Workshop Type XYZ"
      });
      expect(result.ok).toBe(false);
      expect(result).toHaveProperty("message");
    });
  });

  describe("formatSessionsForChat", () => {
    it("should format empty sessions array", () => {
      const formatted = formatSessionsForChat([]);
      expect(formatted).toBe("No upcoming workshops available at the moment.");
    });

    it("should format null or undefined", () => {
      expect(formatSessionsForChat(null)).toBe(
        "No upcoming workshops available at the moment."
      );
      expect(formatSessionsForChat(undefined)).toBe(
        "No upcoming workshops available at the moment."
      );
    });

    it("should format sessions into readable text", () => {
      const mockSessions = [
        {
          sessionId: "test-1",
          eventType: "Matcha Workshop",
          sessionLabel: "Beginner Class",
          date: "2026-10-15",
          startTime: "14:00",
          capacity: 10,
          bookedSeats: 3,
          availableSeats: 7
        },
        {
          sessionId: "test-2",
          eventType: "Advanced Workshop",
          sessionLabel: "",
          date: "2026-10-20",
          startTime: "16:00",
          capacity: 8,
          bookedSeats: 7,
          availableSeats: 1
        }
      ];

      const formatted = formatSessionsForChat(mockSessions);
      expect(formatted).toContain("Matcha Workshop");
      expect(formatted).toContain("Beginner Class");
      expect(formatted).toContain("7 slots available");
      expect(formatted).toContain("Advanced Workshop");
      expect(formatted).toContain("1 slot available");
    });

    it("should handle sessions without labels", () => {
      const mockSessions = [
        {
          sessionId: "test-1",
          eventType: "Workshop",
          sessionLabel: "",
          date: "2026-10-15",
          startTime: "14:00",
          capacity: 10,
          bookedSeats: 3,
          availableSeats: 7
        }
      ];

      const formatted = formatSessionsForChat(mockSessions);
      expect(formatted).toContain("Workshop");
      expect(formatted).not.toContain(" - ");
    });
  });
});

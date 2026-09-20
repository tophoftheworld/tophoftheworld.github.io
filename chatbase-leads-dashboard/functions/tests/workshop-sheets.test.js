const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyRosterNameOverrides, sheetCheckInCell } = require("../workshop-sheets");

test("applyRosterNameOverrides edits one seat on the roster", () => {
  const data = {
    sessions: [
      {
        participants: [
          { orderId: "111", seatIndex: 1, participant: "Leader" },
          { orderId: "111", seatIndex: 2, participant: "Leader" },
        ],
      },
    ],
    participants: [
      { orderId: "111", seatIndex: 1, participant: "Leader" },
      { orderId: "111", seatIndex: 2, participant: "Leader" },
    ],
  };

  applyRosterNameOverrides(data, { "111_2": "Guest Two" });

  assert.equal(data.sessions[0].participants[0].participant, "Leader");
  assert.equal(data.sessions[0].participants[1].participant, "Guest Two");
  assert.equal(data.participants[1].participant, "Guest Two");
});

test("applyRosterNameOverrides ignores blank overrides", () => {
  const data = {
    sessions: [{ participants: [{ orderId: "1", seatIndex: 1, participant: "Ada" }] }],
  };
  applyRosterNameOverrides(data, { "1_1": "  " });
  assert.equal(data.sessions[0].participants[0].participant, "Ada");
});

test("sheetCheckInCell writes dashboard check-ins and keeps sheet blanks", () => {
  assert.equal(sheetCheckInCell("2026-09-19T08:00:00.000Z"), true);
  assert.equal(sheetCheckInCell(true), true);
  assert.equal(sheetCheckInCell(false), false);
  assert.equal(sheetCheckInCell(""), "");
  assert.equal(sheetCheckInCell(undefined), "");
});

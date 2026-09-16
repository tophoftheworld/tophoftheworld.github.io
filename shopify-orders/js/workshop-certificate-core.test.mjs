import assert from "node:assert/strict";
import test from "node:test";
import {
    applyNameOverrides,
    applyParticipantNameOverridesToRoster,
    certificateParticipantNames,
    formatCertificateDate,
    rosterMetaDocId,
    seatNameKey,
} from "./workshop-certificate-core.mjs";

test("rosterMetaDocId sanitizes ids", () => {
    assert.equal(rosterMetaDocId("42", "2026-08-29"), "42_2026-08-29");
    assert.equal(rosterMetaDocId("a/b", "2026-08-29"), "a_b_2026-08-29");
});

test("seatNameKey is stable per seat", () => {
    assert.equal(seatNameKey(555, 2), "555_2");
});

test("formatCertificateDate uses ordinal day", () => {
    assert.equal(formatCertificateDate("2026-08-29"), "29th Day of August 2026");
    assert.equal(formatCertificateDate("2026-04-01"), "1st Day of April 2026");
    assert.equal(formatCertificateDate("2026-04-02"), "2nd Day of April 2026");
    assert.equal(formatCertificateDate("2026-04-03"), "3rd Day of April 2026");
});

test("applyNameOverrides edits one seat without touching others", () => {
    const rows = [
        { orderId: "1", seatIndex: 1, participant: "Party Leader" },
        { orderId: "1", seatIndex: 2, participant: "Party Leader" },
    ];
    applyNameOverrides(rows, { "1_2": "Guest Two" });
    assert.equal(rows[0].participant, "Party Leader");
    assert.equal(rows[0].nameOverridden, false);
    assert.equal(rows[1].participant, "Guest Two");
    assert.equal(rows[1].nameOverridden, true);
    assert.equal(rows[1].originalParticipant, "Party Leader");
});

test("clearing an override restores the original name", () => {
    const rows = [{ orderId: "1", seatIndex: 1, participant: "Ada" }];
    applyNameOverrides(rows, { "1_1": "Ada Lovelace" });
    applyNameOverrides(rows, {});
    assert.equal(rows[0].participant, "Ada");
    assert.equal(rows[0].nameOverridden, false);
});

test("certificateParticipantNames skips blanks", () => {
    assert.deepEqual(
        certificateParticipantNames([
            { participant: "Ada" },
            { participant: "—" },
            { participant: "  " },
            { participant: "Bea" },
        ]),
        ["Ada", "Bea"]
    );
});

test("applyParticipantNameOverridesToRoster updates nested seats", () => {
    const data = {
        sessions: [
            {
                participants: [
                    { orderId: "9", seatIndex: 1, participant: "Leader" },
                ],
            },
        ],
    };
    applyParticipantNameOverridesToRoster(data, { "9_1": "Edited" });
    assert.equal(data.sessions[0].participants[0].participant, "Edited");
});

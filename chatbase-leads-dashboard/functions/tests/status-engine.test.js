const test = require("node:test");
const assert = require("node:assert/strict");
const { decideAutoStatus } = require("../status-engine");

test("decideAutoStatus sets qualified when required fields exist", () => {
  const result = decideAutoStatus({ status: "new", createdAt: new Date().toISOString() }, true);
  assert.equal(result.nextStatus, "qualified");
});

test("decideAutoStatus sets follow_up for old incomplete lead", () => {
  const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString();
  const result = decideAutoStatus({ status: "new", createdAt: oldDate }, false);
  assert.equal(result.nextStatus, "follow_up");
});

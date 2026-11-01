const { test } = require("node:test");
const assert = require("node:assert/strict");
const { request, response } = require("./generated/validate.cjs");

test("generated validators enforce the Rust wire boundary without coercion", () => {
  const input = {
    version: "1",
    operation: "content.update",
    requestId: "attempt",
    contentId: "notes",
    expectedRevision: "previous",
    data: { text: "Saved" },
  };
  assert.equal(request(input), true);
  for (const invalid of [
    { ...input, version: "2" },
    { ...input, authority: "owner" },
    { ...input, expectedRevision: 4 },
  ])
    assert.equal(request(invalid), false);
  const result = {
    version: "1",
    status: "uncertain",
    requestId: input.requestId,
    contentId: input.contentId,
    expectedRevision: input.expectedRevision,
    message: "Readback unavailable. No retry.",
  };
  assert.equal(response(result), true);
  assert.equal(response({ ...result, contentId: null }), false);
  assert.equal(response({ ...result, status: "complete" }), false);
  assert.equal(input.expectedRevision, "previous");
});

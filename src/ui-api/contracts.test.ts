import assert from "node:assert/strict";
import {
  UI_API_ACTION_ROUTES,
  UI_API_READ_ROUTES,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  paginateItems,
} from "./contracts.js";

assert.equal(UI_API_READ_ROUTES.length, 7);
assert.equal(UI_API_ACTION_ROUTES.length, 9);
assert.ok(
  UI_API_READ_ROUTES.some((route) => route.path === "/api/runs/:runId/projections/workspace"),
);
assert.ok(
  UI_API_ACTION_ROUTES.some((route) => route.path === "/api/runs/:runId/sessions/:sessionId/interrupt"),
);
assert.ok(
  UI_API_ACTION_ROUTES.some((route) => route.implementationStatus === "stubbed"),
);

const cursor = encodeOpaqueCursor(3);
assert.equal(decodeOpaqueCursor(cursor), 3);
assert.equal(decodeOpaqueCursor(null), 0);
assert.throws(() => decodeOpaqueCursor("bad-cursor"));

const paged = paginateItems(["a", "b", "c", "d"], null, "2", {
  defaultLimit: 20,
  maxLimit: 100,
});
assert.deepEqual(paged.items, ["a", "b"]);
assert.equal(paged.page.limit, 2);
assert.equal(paged.page.returnedCount, 2);
assert.equal(paged.page.totalCount, 4);
assert.ok(paged.page.nextCursor);

const nextPage = paginateItems(["a", "b", "c", "d"], paged.page.nextCursor!, "2", {
  defaultLimit: 20,
  maxLimit: 100,
});
assert.deepEqual(nextPage.items, ["c", "d"]);
assert.equal(nextPage.page.nextCursor, undefined);

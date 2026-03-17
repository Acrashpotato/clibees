import assert from "node:assert/strict";
import {
  SELECTED_CLI_VALUES,
  UI_API_ACTION_ROUTES,
  UI_API_READ_ROUTES,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  paginateItems,
} from "./contracts.js";
import { resolveTerminalSelectedCli } from "./terminal-gateway.js";

assert.equal(UI_API_READ_ROUTES.length, 8);
assert.equal(UI_API_ACTION_ROUTES.length, 10);
assert.ok(
  UI_API_READ_ROUTES.some((route) => route.path === "/api/runs/:runId/projections/workspace"),
);
assert.ok(
  UI_API_ACTION_ROUTES.some((route) => route.path === "/api/runs/:runId/sessions/:sessionId/interrupt"),
);
assert.ok(
  UI_API_READ_ROUTES.some(
    (route) => route.path === "/api/runs/:runId/projections/manager-chat",
  ),
);
assert.ok(
  UI_API_ACTION_ROUTES.some(
    (route) =>
      route.id === "delete_run" &&
      route.path === "/api/runs/:runId/delete" &&
      route.implementationStatus === "active",
  ),
);
assert.ok(
  UI_API_ACTION_ROUTES.some(
    (route) =>
      route.id === "post_thread_message" &&
      route.path === "/api/runs/:runId/threads/:threadId/messages" &&
      route.implementationStatus === "active",
  ),
);
assert.ok(
  UI_API_ACTION_ROUTES.some(
    (route) =>
      route.id === "interact_session" &&
      route.path === "/api/runs/:runId/sessions/:sessionId/interact" &&
      route.implementationStatus === "active",
  ),
);
assert.ok(
  UI_API_ACTION_ROUTES.some((route) => route.implementationStatus === "stubbed"),
);
assert.ok(
  UI_API_ACTION_ROUTES.some(
    (route) =>
      route.id === "create_run" &&
      route.path === "/api/runs" &&
      route.implementationStatus === "active",
  ),
);
assert.deepEqual([...SELECTED_CLI_VALUES], ["codex", "codefree", "claude"]);
assert.equal(resolveTerminalSelectedCli({ selectedCli: "claude" }), "claude");
assert.equal(resolveTerminalSelectedCli({ selectedCli: "codefree" }), "codefree");
assert.equal(resolveTerminalSelectedCli({ selectedCli: "codex" }), "codex");
assert.equal(resolveTerminalSelectedCli({ selectedCli: "invalid" }), "codex");
assert.equal(resolveTerminalSelectedCli({}), "codex");

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

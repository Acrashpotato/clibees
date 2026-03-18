import type { IncomingMessage, ServerResponse } from "node:http";
import type { createApp } from "../app/create-app.js";
import { createId } from "../shared/runtime.js";
import { buildActionEnvelope } from "./contracts.js";
import type { JsonRequestBody } from "./server.js";

export interface InteractionRouteOptions {
  app: ReturnType<typeof createApp>;
  request: IncomingMessage;
  path: string;
  body: JsonRequestBody | undefined;
  response: ServerResponse;
  sendJson: (response: ServerResponse, status: number, payload: unknown) => void;
  sendApiError: (
    response: ServerResponse,
    status: number,
    code: "bad_request" | "not_found" | "state_conflict" | "not_supported" | "internal_error",
    message: string,
    details?: Record<string, unknown>,
  ) => void;
}

export async function tryHandleInteractionRoutes(options: InteractionRouteOptions): Promise<boolean> {
  const threadMessageMatch = options.path.match(/^\/api\/runs\/([^/]+)\/threads\/([^/]+)\/messages$/);
  if (options.request.method === "POST" && threadMessageMatch) {
    const runId = decodeURIComponent(threadMessageMatch[1]!);
    const threadId = decodeURIComponent(threadMessageMatch[2]!);
    const bodyText = options.body?.body?.trim();
    if (!bodyText) {
      options.sendApiError(options.response, 400, "bad_request", 'Field "body" is required.');
      return true;
    }

    try {
      const result = await options.app.runCoordinator.postThreadMessage(runId, threadId, {
        actorId: options.body?.actorId?.trim() || options.body?.actor?.trim() || "console-user",
        body: bodyText,
        clientRequestId: options.body?.clientRequestId?.trim() || createId("request"),
        note: options.body?.note?.trim(),
        replyToMessageId: options.body?.replyToMessageId?.trim(),
      });
      options.sendJson(
        options.response,
        200,
        buildActionEnvelope(
          "post_thread_message",
          {
            type: "thread",
            runId,
            targetId: threadId,
          },
          {
            runId,
            threadId,
            message: result.message,
            runStatus: result.run.status,
            resumed: result.resumed,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("was not found") ||
        message.includes("Thread") ||
        message.includes("Session")
      ) {
        options.sendApiError(options.response, 404, "not_found", message);
        return true;
      }
      if (message.includes("cannot accept new messages")) {
        options.sendApiError(options.response, 409, "state_conflict", message);
        return true;
      }
      throw error;
    }
    return true;
  }

  const sessionInteractMatch = options.path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/interact$/);
  if (options.request.method === "POST" && sessionInteractMatch) {
    const runId = decodeURIComponent(sessionInteractMatch[1]!);
    const sessionId = decodeURIComponent(sessionInteractMatch[2]!);
    const bodyText = options.body?.body?.trim();
    if (!bodyText) {
      options.sendApiError(options.response, 400, "bad_request", 'Field "body" is required.');
      return true;
    }

    try {
      const result = await options.app.runCoordinator.interactSession(runId, sessionId, {
        actorId: options.body?.actorId?.trim() || options.body?.actor?.trim() || "console-user",
        body: bodyText,
        clientRequestId: options.body?.clientRequestId?.trim() || createId("request"),
        note: options.body?.note?.trim(),
        replyToMessageId: options.body?.replyToMessageId?.trim(),
      });
      options.sendJson(
        options.response,
        200,
        buildActionEnvelope(
          "interact_session",
          {
            type: "task_session",
            runId,
            targetId: sessionId,
          },
          {
            runId,
            sessionId,
            threadId: result.thread.threadId,
            message: result.message,
            runStatus: result.run.status,
            resumed: result.resumed,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("was not found") ||
        message.includes("Thread") ||
        message.includes("Session")
      ) {
        options.sendApiError(options.response, 404, "not_found", message);
        return true;
      }
      if (message.includes("cannot accept new messages")) {
        options.sendApiError(options.response, 409, "state_conflict", message);
        return true;
      }
      throw error;
    }
    return true;
  }
  return false;
}

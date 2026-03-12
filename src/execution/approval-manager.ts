import { readdir } from "node:fs/promises";
import type {
  ActionPlan,
  ApprovalDecision,
  ApprovalRecord,
  ApprovalRequest,
  InvocationPlan,
} from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { createId, isoNow, pathExists, readJsonFile, writeJsonFile } from "../shared/runtime.js";
import {
  createStateLayout,
  getRunStatePaths,
  type StateLayout,
} from "../storage/state-layout.js";

export interface StoredApprovalRequest extends ApprovalRequest {
  status: "pending" | "approved" | "rejected";
  decision?: ApprovalRecord;
  invocation?: InvocationPlan;
}

interface ApprovalSnapshot {
  schemaVersion: number;
  runId: string;
  requests: StoredApprovalRequest[];
}

export interface ApprovalManager {
  createRequest(
    runId: string,
    taskId: string,
    actions: ActionPlan[],
    reason: string,
    invocation?: InvocationPlan,
  ): Promise<ApprovalRequest>;
  decide(
    requestId: string,
    decision: ApprovalDecision,
    actor: string,
    note?: string,
  ): Promise<ApprovalRecord>;
  listPending(runId: string): Promise<ApprovalRequest[]>;
  getRequest(requestId: string): Promise<StoredApprovalRequest | null>;
}

export class FileApprovalManager implements ApprovalManager {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async createRequest(
    runId: string,
    taskId: string,
    actions: ActionPlan[],
    reason: string,
    invocation?: InvocationPlan,
  ): Promise<ApprovalRequest> {
    const request: StoredApprovalRequest = {
      id: createId("approval"),
      runId,
      taskId,
      actionPlans: actions,
      reason,
      requestedAt: isoNow(),
      status: "pending",
      ...(invocation ? { invocation } : {}),
    };
    const snapshot = await this.readRunSnapshot(runId);
    snapshot.requests.push(request);
    await this.writeSnapshot(snapshot);
    return toApprovalRequest(request);
  }

  async decide(
    requestId: string,
    decision: ApprovalDecision,
    actor: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    const located = await this.findRequest(requestId);
    if (!located) {
      throw new Error(`Approval request "${requestId}" was not found.`);
    }

    const request = located.snapshot.requests[located.index];
    if (!request || request.status !== "pending") {
      throw new Error(`Approval request "${requestId}" is no longer pending.`);
    }

    const record: ApprovalRecord = {
      requestId,
      decision,
      decidedAt: isoNow(),
      actor,
      ...(note ? { note } : {}),
    };

    located.snapshot.requests[located.index] = {
      ...request,
      status: decision === "approved" ? "approved" : "rejected",
      decision: record,
    };
    await this.writeSnapshot(located.snapshot);
    return record;
  }

  async listPending(runId: string): Promise<ApprovalRequest[]> {
    const snapshot = await this.readRunSnapshot(runId);
    return snapshot.requests
      .filter((request) => request.status === "pending")
      .map((request) => toApprovalRequest(request));
  }

  async getRequest(requestId: string): Promise<StoredApprovalRequest | null> {
    const located = await this.findRequest(requestId);
    return located?.snapshot.requests[located.index] ?? null;
  }

  private async findRequest(
    requestId: string,
  ): Promise<{ snapshot: ApprovalSnapshot; index: number } | null> {
    if (!(await pathExists(this.layout.runsDir))) {
      return null;
    }

    const runIds = (await readdir(this.layout.runsDir)).sort();
    for (const runId of runIds) {
      const snapshot = await this.readRunSnapshot(runId);
      const index = snapshot.requests.findIndex((request) => request.id === requestId);
      if (index >= 0) {
        return { snapshot, index };
      }
    }

    return null;
  }

  private async readRunSnapshot(runId: string): Promise<ApprovalSnapshot> {
    const filePath = getRunStatePaths(this.layout, runId).approvalsFile;
    if (!(await pathExists(filePath))) {
      return {
        schemaVersion: SCHEMA_VERSION,
        runId,
        requests: [],
      };
    }

    return readJsonFile<ApprovalSnapshot>(filePath);
  }

  private async writeSnapshot(snapshot: ApprovalSnapshot): Promise<void> {
    await writeJsonFile(
      getRunStatePaths(this.layout, snapshot.runId).approvalsFile,
      snapshot,
    );
  }
}

function toApprovalRequest(request: StoredApprovalRequest): ApprovalRequest {
  return {
    id: request.id,
    runId: request.runId,
    taskId: request.taskId,
    actionPlans: request.actionPlans,
    reason: request.reason,
    requestedAt: request.requestedAt,
  };
}

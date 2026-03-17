import { parseCommand } from "../cli/command-parser.js";
import type { MultiAgentConfig } from "../domain/config.js";
import type { ApprovalRecord, ApprovalRequest, RunInspection, RunRecord } from "../domain/models.js";
import { RunCoordinator } from "./run-coordinator.js";

export interface ConfigLoader {
  load(configPath?: string): Promise<MultiAgentConfig>;
}

export class Entrypoint {
  constructor(
    private readonly configLoader: ConfigLoader,
    private readonly runCoordinator: RunCoordinator,
  ) {}

  async handle(
    argv: string[],
  ): Promise<RunRecord | RunInspection | ApprovalRequest[] | ApprovalRecord> {
    const command = parseCommand(argv);
    const config = await this.configLoader.load(command.configPath);

    switch (command.kind) {
      case "run":
        return this.runCoordinator.startRun({
          goal: command.goal,
          workspacePath: config.workspace.rootDir,
          configPath: command.configPath,
          metadata: {
            configVersion: config.version,
            plannerMode: config.planner.mode,
            plannerAgentId: config.planner.agentId,
            agentIds: config.agents.map((agent) => agent.id),
          },
        });
      case "resume":
        return this.runCoordinator.resumeRun(command.runId, { config });
      case "inspect":
        return this.runCoordinator.inspectRun(command.runId);
      case "approvals":
        return this.runCoordinator.listPendingApprovals(command.runId);
      case "approve":
        return this.runCoordinator.decideApproval(
          command.runId,
          command.requestId,
          "approved",
          command.actor,
          command.note,
          { config },
        );
      case "reject":
        return this.runCoordinator.decideApproval(
          command.runId,
          command.requestId,
          "rejected",
          command.actor,
          command.note,
          { config },
        );
    }
  }
}

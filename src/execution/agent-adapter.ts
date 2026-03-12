import type {
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { AgentSelection } from "../decision/router.js";

export interface AgentAdapter {
  readonly agentId: string;
  probe(): Promise<AgentCapability>;
  planInvocation(
    task: TaskSpec,
    context: ContextBundle,
    selection: AgentSelection,
  ): Promise<InvocationPlan>;
  run(runId: string, invocation: InvocationPlan): AsyncIterable<RunEvent>;
  interrupt(runId: string, taskId: string): Promise<void>;
}

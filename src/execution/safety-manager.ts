import type {
  ActionPlan,
  ActionPolicy,
  InvocationPlan,
  RiskLevel,
  TaskSpec,
} from "../domain/models.js";
import type { ApprovalPolicyValue } from "../domain/config.js";

export interface SafetyRuleSet {
  approvalThreshold: RiskLevel;
  blockedActions: string[];
  approvalPolicyByAction?: Record<string, ApprovalPolicyValue>;
}

export interface ReviewedAction {
  action: ActionPlan;
  blocked: boolean;
  requiresApproval: boolean;
  reasons: string[];
}

export interface SafetyReview {
  blocked: boolean;
  requiresApproval: boolean;
  actions: ReviewedAction[];
}

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export class SafetyManager {
  constructor(private readonly rules: SafetyRuleSet) {}

  review(task: TaskSpec, invocation: InvocationPlan): SafetyReview {
    const actions = invocation.actionPlans.map((action) =>
      this.reviewAction(task.allowedActions, action),
    );

    return {
      blocked: actions.some((action) => action.blocked),
      requiresApproval: actions.some((action) => action.requiresApproval),
      actions,
    };
  }

  private reviewAction(
    policies: ActionPolicy[],
    action: ActionPlan,
  ): ReviewedAction {
    const reasons: string[] = [];
    const policy = policies.find((candidate) => candidate.kind === action.kind);
    const blockedByPolicy = policy?.allow === false;
    const blockedByRule = this.rules.blockedActions.includes(action.kind);
    const approvalPolicy = this.resolveApprovalPolicy(action.kind);
    const requiresApproval = this.requiresApproval(action, approvalPolicy);

    if (blockedByPolicy) {
      reasons.push(`Action "${action.kind}" is not allowed by task policy.`);
    }

    if (blockedByRule) {
      reasons.push(`Action "${action.kind}" is blocked by safety rules.`);
    }

    if (requiresApproval) {
      reasons.push(
        approvalPolicy
          ? `Action "${action.kind}" requires approval by policy "${approvalPolicy}".`
          : `Action "${action.kind}" requires approval.`,
      );
    }

    return {
      action,
      blocked: blockedByPolicy || blockedByRule,
      requiresApproval,
      reasons,
    };
  }

  private requiresApproval(
    action: ActionPlan,
    approvalPolicy: ApprovalPolicyValue | undefined,
  ): boolean {
    if (approvalPolicy === "always") {
      return true;
    }

    if (approvalPolicy === "never") {
      return false;
    }

    if (approvalPolicy) {
      return RISK_ORDER[action.riskLevel] >= RISK_ORDER[approvalPolicy];
    }

    return (
      action.requiresApproval ||
      RISK_ORDER[action.riskLevel] >= RISK_ORDER[this.rules.approvalThreshold]
    );
  }

  private resolveApprovalPolicy(actionKind: string): ApprovalPolicyValue | undefined {
    const mappedPolicies = this.rules.approvalPolicyByAction;
    if (!mappedPolicies) {
      return undefined;
    }

    return mappedPolicies[actionKind] ?? mappedPolicies["*"];
  }
}

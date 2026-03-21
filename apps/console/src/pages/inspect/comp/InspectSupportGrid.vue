<script setup lang="ts">
import { computed } from "vue";
import {
  NCard,
  NEmpty,
  NTabPane,
  NTabs,
  NTag,
} from "naive-ui";
import { RouterLink } from "vue-router";

import type { AuditTimelineApprovalHistoryItemView, AuditTimelineProjectionView } from "../../../audit-timeline-projection";

type InspectSupportTab = "approvals" | "validations" | "replans" | "artifacts";

const props = defineProps<{
  projection: AuditTimelineProjectionView;
  activeSupportTab: InspectSupportTab;
  riskLabel: (riskLevel: "low" | "medium" | "high") => string;
  approvalStateLabel: (state: AuditTimelineApprovalHistoryItemView["state"]) => string;
  approvalStatePill: (state: AuditTimelineApprovalHistoryItemView["state"]) => "awaiting_approval" | "completed" | "failed";
  riskTone: (riskLevel: AuditTimelineApprovalHistoryItemView["riskLevel"]) => "low" | "medium" | "high";
  sourceLabel: (sourceMode: string) => string;
  textOrDash: (value?: string) => string;
  taskLink: (taskId?: string) => string | undefined;
  sessionLink: (sessionId?: string) => string | undefined;
  approvalLink: (requestId?: string) => string | undefined;
}>();

const emit = defineEmits<{
  (event: "change-support", value: InspectSupportTab): void;
}>();

const supportTabs = computed(() => [
  {
    id: "approvals" as const,
    label: "审批",
    count: props.projection.approvals.length,
  },
  {
    id: "validations" as const,
    label: "验证",
    count: props.projection.validations.length,
  },
  {
    id: "replans" as const,
    label: "重规划",
    count: props.projection.replans.length,
  },
  {
    id: "artifacts" as const,
    label: "产物",
    count: props.projection.artifacts.length,
  },
]);

const activeSupportCount = computed(() => {
  switch (props.activeSupportTab) {
    case "approvals":
      return props.projection.approvals.length;
    case "validations":
      return props.projection.validations.length;
    case "replans":
      return props.projection.replans.length;
    case "artifacts":
      return props.projection.artifacts.length;
  }
});

function switchSupportTab(nextTab: string): void {
  if (
    nextTab === "approvals" ||
    nextTab === "validations" ||
    nextTab === "replans" ||
    nextTab === "artifacts"
  ) {
    emit("change-support", nextTab);
  }
}

function approvalStateTagType(state: AuditTimelineApprovalHistoryItemView["state"]): "warning" | "success" | "error" {
  const pill = props.approvalStatePill(state);
  switch (pill) {
    case "awaiting_approval":
      return "warning";
    case "completed":
      return "success";
    default:
      return "error";
  }
}

function riskTagType(riskLevel: AuditTimelineApprovalHistoryItemView["riskLevel"]): "default" | "warning" | "error" {
  const tone = props.riskTone(riskLevel);
  switch (tone) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
}
</script>

<template>
  <section class="audit-grid audit-grid--support">
    <n-card class="panel-card audit-card" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "支持切片" }}</p>
          <h2>{{ "分类审计详情" }}</h2>
        </div>
        <n-tag size="small" round>{{ activeSupportCount }}</n-tag>
      </div>

      <n-tabs :value="activeSupportTab" type="segment" animated display-directive="if" @update:value="switchSupportTab">
        <n-tab-pane
          v-for="tab in supportTabs"
          :key="tab.id"
          :name="tab.id"
          :tab="`${tab.label} | ${tab.count}`"
        >
          <template v-if="tab.id === 'approvals'">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "审批分类" }}</p>
                <h2>{{ "审批请求与决策" }}</h2>
              </div>
            </div>

            <div v-if="projection.approvals.length > 0" class="audit-table-wrap">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>{{ "状态" }}</th>
                    <th>{{ "风险" }}</th>
                    <th>{{ "请求时间" }}</th>
                    <th>{{ "请求" }}</th>
                    <th>{{ "任务" }}</th>
                    <th>{{ "详情" }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="approval in projection.approvals"
                    :key="approval.requestId"
                    :data-risk="riskTone(approval.riskLevel)"
                  >
                    <td class="audit-table__cell--status">
                      <n-tag :type="approvalStateTagType(approval.state)" size="small">
                        {{ approvalStateLabel(approval.state) }}
                      </n-tag>
                    </td>
                    <td class="audit-table__cell--status">
                      <n-tag :type="riskTagType(approval.riskLevel)" size="small">
                        {{ approval.riskLevel === "none" ? "无" : riskLabel(approval.riskLevel) }}
                      </n-tag>
                    </td>
                    <td class="audit-table__cell--time">{{ approval.requestedAt }}</td>
                    <td>
                      <span class="approval-card__lane">{{ approval.requestId }}</span>
                    </td>
                    <td>{{ approval.taskTitle }}</td>
                    <td>
                      <details class="audit-details">
                        <summary>{{ "查看详情" }}</summary>
                        <div class="audit-details__body">
                          <p class="panel-card__body">{{ approval.summary }}</p>
                          <p v-if="approval.decidedAt" class="panel-card__body">
                            <strong>{{ "决策时间" }}:</strong>
                            {{ approval.decidedAt }}
                          </p>
                          <p class="panel-card__body">
                            <strong>{{ "审批人" }}:</strong>
                            {{ textOrDash(approval.actor) }}
                          </p>
                          <p class="panel-card__body" v-if="approval.note">
                            <strong>{{ "备注" }}:</strong>
                            {{ approval.note }}
                          </p>
                          <div class="audit-table__chips">
                            <RouterLink
                              v-if="approvalLink(approval.requestId)"
                              class="flow-pill"
                              :to="approvalLink(approval.requestId)!"
                            >
                              approval {{ approval.requestId }}
                            </RouterLink>
                            <RouterLink
                              v-if="taskLink(approval.taskId)"
                              class="flow-pill"
                              :to="taskLink(approval.taskId)!"
                            >
                              task {{ approval.taskId }}
                            </RouterLink>
                            <RouterLink
                              v-if="sessionLink(approval.sessionId)"
                              class="flow-pill"
                              :to="sessionLink(approval.sessionId)!"
                            >
                              session {{ approval.sessionId }}
                            </RouterLink>
                          </div>
                          <p class="panel-card__body">
                            <strong>{{ "来源" }}:</strong>
                            {{ sourceLabel(approval.sourceMode) }}
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty
              v-else
              class="panel-card__empty-state"
              :description="'当前运行暂无审批历史。'"
              size="small"
            />
          </template>

          <template v-else-if="tab.id === 'validations'">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "验证分类" }}</p>
                <h2>{{ "任务验证与结果" }}</h2>
              </div>
            </div>

            <div v-if="projection.validations.length > 0" class="audit-table-wrap audit-table-wrap--validations">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>{{ "任务" }}</th>
                    <th>{{ "结果" }}</th>
                    <th>{{ "状态" }}</th>
                    <th>{{ "更新时间" }}</th>
                    <th>{{ "详情" }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="validation in projection.validations" :key="validation.taskId">
                    <td>
                      <strong>{{ validation.taskTitle }}</strong>
                      <p class="audit-table__subtle">{{ validation.taskId }}</p>
                    </td>
                    <td>{{ validation.outcome ?? "-" }}</td>
                    <td>
                      <span class="flow-pill">{{ validation.taskStatus }}</span>
                    </td>
                    <td class="audit-table__cell--time">{{ validation.updatedAt ?? "-" }}</td>
                    <td>
                      <details class="audit-details">
                        <summary>{{ "查看详情" }}</summary>
                        <div class="audit-details__body">
                          <p class="panel-card__body">{{ validation.summary }}</p>
                          <p v-if="validation.details.length === 0" class="panel-card__body">
                            {{ "无额外详情。" }}
                          </p>
                          <p v-for="detail in validation.details" :key="detail" class="panel-card__body">
                            {{ detail }}
                          </p>
                          <div class="audit-table__chips">
                            <RouterLink
                              v-if="taskLink(validation.taskId)"
                              class="flow-pill"
                              :to="taskLink(validation.taskId)!"
                            >
                              task {{ validation.taskId }}
                            </RouterLink>
                            <RouterLink
                              v-if="sessionLink(validation.sessionId)"
                              class="flow-pill"
                              :to="sessionLink(validation.sessionId)!"
                            >
                              session {{ validation.sessionId }}
                            </RouterLink>
                          </div>
                          <p class="panel-card__body">
                            <strong>{{ "来源" }}:</strong>
                            {{ sourceLabel(validation.sourceMode) }}
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty
              v-else
              class="panel-card__empty-state"
              :description="'当前暂无验证记录。'"
              size="small"
            />
          </template>

          <template v-else-if="tab.id === 'replans'">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "重规划分类" }}</p>
                <h2>{{ "范围变更与后续" }}</h2>
              </div>
            </div>

            <div v-if="projection.replans.length > 0" class="audit-table-wrap">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>{{ "时间" }}</th>
                    <th>{{ "类型" }}</th>
                    <th>{{ "标题" }}</th>
                    <th>{{ "任务" }}</th>
                    <th>{{ "详情" }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="replan in projection.replans" :key="replan.eventId">
                    <td class="audit-table__cell--time">{{ replan.timestamp }}</td>
                    <td>
                      <span class="approval-card__lane">{{ replan.type }}</span>
                    </td>
                    <td>{{ replan.title }}</td>
                    <td>
                      <RouterLink v-if="taskLink(replan.taskId)" class="ghost-link" :to="taskLink(replan.taskId)!">
                        {{ replan.taskId }}
                      </RouterLink>
                      <span v-else>-</span>
                    </td>
                    <td>
                      <details class="audit-details">
                        <summary>{{ "查看详情" }}</summary>
                        <div class="audit-details__body">
                          <p v-if="replan.details.length === 0" class="panel-card__body">
                            {{ "无额外详情。" }}
                          </p>
                          <p v-for="detail in replan.details" :key="detail" class="panel-card__body">
                            {{ detail }}
                          </p>
                          <p class="panel-card__body">
                            <strong>{{ "来源" }}:</strong>
                            {{ sourceLabel(replan.sourceMode) }}
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty
              v-else
              class="panel-card__empty-state"
              :description="'当前运行暂无重规划记录。'"
              size="small"
            />
          </template>

          <template v-else>
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "产物分类" }}</p>
                <h2>{{ "按任务聚合的产物亮点" }}</h2>
              </div>
            </div>

            <div v-if="projection.artifacts.length > 0" class="audit-table-wrap">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>{{ "任务" }}</th>
                    <th>{{ "总数" }}</th>
                    <th>{{ "类型" }}</th>
                    <th>{{ "最近" }}</th>
                    <th>{{ "详情" }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in projection.artifacts" :key="group.taskId ?? group.taskTitle">
                    <td>
                      <strong>{{ group.taskTitle }}</strong>
                      <p class="audit-table__subtle">
                        {{ group.taskId ?? "运行级别" }}
                      </p>
                    </td>
                    <td>{{ group.totalCount }}</td>
                    <td>{{ group.artifactKinds.join(", ") || "无类型" }}</td>
                    <td class="audit-table__cell--time">{{ group.latestCreatedAt ?? "-" }}</td>
                    <td>
                      <details class="audit-details">
                        <summary>{{ "查看亮点" }}</summary>
                        <div class="audit-details__body">
                          <p class="panel-card__body">
                            <strong>{{ "来源" }}:</strong>
                            {{ sourceLabel(group.sourceMode) }}
                          </p>
                          <div v-if="group.highlights.length > 0" class="audit-stack">
                            <article
                              v-for="artifact in group.highlights"
                              :key="artifact.artifactId"
                              class="detail-chip detail-chip--compact detail-chip--row"
                            >
                              <span>{{ artifact.kind }} | {{ artifact.createdAt }}</span>
                              <strong>{{ artifact.summary }}</strong>
                              <RouterLink
                                v-if="sessionLink(artifact.sessionId)"
                                class="ghost-link"
                                :to="sessionLink(artifact.sessionId)!"
                              >
                                session {{ artifact.sessionId }}
                              </RouterLink>
                            </article>
                          </div>
                          <p v-else class="panel-card__body">
                            {{ "暂无产物亮点。" }}
                          </p>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <n-empty
              v-else
              class="panel-card__empty-state"
              :description="'当前暂无产物摘要。'"
              size="small"
            />
          </template>
        </n-tab-pane>
      </n-tabs>
    </n-card>
  </section>
</template>

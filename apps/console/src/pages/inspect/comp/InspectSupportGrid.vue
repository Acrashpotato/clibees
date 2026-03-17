<script setup lang="ts">
import { RouterLink } from "vue-router";

import type { AuditTimelineApprovalHistoryItemView, AuditTimelineProjectionView } from "../../../audit-timeline-projection";

defineProps<{
  projection: AuditTimelineProjectionView;
  copy: (zh: string, en: string) => string;
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
</script>

<template>
  <section class="audit-grid audit-grid--support">
    <article class="panel-card audit-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("审批分类", "Approval category") }}</p>
          <h2>{{ copy("审批请求与决策", "Approval requests and decisions") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.approvals.length }}</span>
      </div>

      <div v-if="projection.approvals.length > 0" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ copy("状态", "State") }}</th>
              <th>{{ copy("风险", "Risk") }}</th>
              <th>{{ copy("请求时间", "Requested") }}</th>
              <th>{{ copy("请求", "Request") }}</th>
              <th>{{ copy("任务", "Task") }}</th>
              <th>{{ copy("详情", "Details") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="approval in projection.approvals"
              :key="approval.requestId"
              :data-risk="riskTone(approval.riskLevel)"
            >
              <td class="audit-table__cell--status">
                <span class="status-pill" :data-status="approvalStatePill(approval.state)">
                  {{ approvalStateLabel(approval.state) }}
                </span>
              </td>
              <td class="audit-table__cell--status">
                <span class="risk-pill" :data-risk="riskTone(approval.riskLevel)">
                  {{ approval.riskLevel === "none" ? copy("无", "None") : riskLabel(approval.riskLevel) }}
                </span>
              </td>
              <td class="audit-table__cell--time">{{ approval.requestedAt }}</td>
              <td>
                <span class="approval-card__lane">{{ approval.requestId }}</span>
              </td>
              <td>{{ approval.taskTitle }}</td>
              <td>
                <details class="audit-details">
                  <summary>{{ copy("查看详情", "View details") }}</summary>
                  <div class="audit-details__body">
                    <p class="panel-card__body">{{ approval.summary }}</p>
                    <p v-if="approval.decidedAt" class="panel-card__body">
                      <strong>{{ copy("决策时间", "Decided") }}:</strong>
                      {{ approval.decidedAt }}
                    </p>
                    <p class="panel-card__body">
                      <strong>{{ copy("审批人", "Actor") }}:</strong>
                      {{ textOrDash(approval.actor) }}
                    </p>
                    <p class="panel-card__body" v-if="approval.note">
                      <strong>{{ copy("备注", "Note") }}:</strong>
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
                      <strong>{{ copy("来源", "Source") }}:</strong>
                      {{ sourceLabel(approval.sourceMode) }}
                    </p>
                  </div>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">
          {{ copy("当前运行暂无审批历史。", "No approval history is available for this run.") }}
        </p>
      </div>
    </article>

    <article class="panel-card audit-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("验证分类", "Validation category") }}</p>
          <h2>{{ copy("任务验证与结果", "Task validation and outcomes") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.validations.length }}</span>
      </div>

      <div v-if="projection.validations.length > 0" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ copy("任务", "Task") }}</th>
              <th>{{ copy("结果", "Outcome") }}</th>
              <th>{{ copy("状态", "Status") }}</th>
              <th>{{ copy("更新时间", "Updated") }}</th>
              <th>{{ copy("详情", "Details") }}</th>
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
                  <summary>{{ copy("查看详情", "View details") }}</summary>
                  <div class="audit-details__body">
                    <p class="panel-card__body">{{ validation.summary }}</p>
                    <p v-if="validation.details.length === 0" class="panel-card__body">
                      {{ copy("无额外详情。", "No additional details.") }}
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
                      <strong>{{ copy("来源", "Source") }}:</strong>
                      {{ sourceLabel(validation.sourceMode) }}
                    </p>
                  </div>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">
          {{ copy("当前暂无验证记录。", "No validation records are available yet.") }}
        </p>
      </div>
    </article>

    <article class="panel-card audit-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("重规划分类", "Replan category") }}</p>
          <h2>{{ copy("范围变更与后续", "Scope changes and follow-up") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.replans.length }}</span>
      </div>

      <div v-if="projection.replans.length > 0" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ copy("时间", "Time") }}</th>
              <th>{{ copy("类型", "Type") }}</th>
              <th>{{ copy("标题", "Title") }}</th>
              <th>{{ copy("任务", "Task") }}</th>
              <th>{{ copy("详情", "Details") }}</th>
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
                  <summary>{{ copy("查看详情", "View details") }}</summary>
                  <div class="audit-details__body">
                    <p v-if="replan.details.length === 0" class="panel-card__body">
                      {{ copy("无额外详情。", "No additional details.") }}
                    </p>
                    <p v-for="detail in replan.details" :key="detail" class="panel-card__body">
                      {{ detail }}
                    </p>
                    <p class="panel-card__body">
                      <strong>{{ copy("来源", "Source") }}:</strong>
                      {{ sourceLabel(replan.sourceMode) }}
                    </p>
                  </div>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">
          {{ copy("当前运行暂无重规划记录。", "No replans are recorded for this run.") }}
        </p>
      </div>
    </article>

    <article class="panel-card audit-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("产物分类", "Artifact category") }}</p>
          <h2>{{ copy("按任务聚合的产物亮点", "Artifact highlights by task") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.artifacts.length }}</span>
      </div>

      <div v-if="projection.artifacts.length > 0" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ copy("任务", "Task") }}</th>
              <th>{{ copy("总数", "Total") }}</th>
              <th>{{ copy("类型", "Kinds") }}</th>
              <th>{{ copy("最近", "Latest") }}</th>
              <th>{{ copy("详情", "Details") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in projection.artifacts" :key="group.taskId ?? group.taskTitle">
              <td>
                <strong>{{ group.taskTitle }}</strong>
                <p class="audit-table__subtle">
                  {{ group.taskId ?? copy("运行级别", "Run level") }}
                </p>
              </td>
              <td>{{ group.totalCount }}</td>
              <td>{{ group.artifactKinds.join(", ") || copy("无类型", "No kinds") }}</td>
              <td class="audit-table__cell--time">{{ group.latestCreatedAt ?? "-" }}</td>
              <td>
                <details class="audit-details">
                  <summary>{{ copy("查看亮点", "View highlights") }}</summary>
                  <div class="audit-details__body">
                    <p class="panel-card__body">
                      <strong>{{ copy("来源", "Source") }}:</strong>
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
                      {{ copy("暂无产物亮点。", "No artifact highlights.") }}
                    </p>
                  </div>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">
          {{ copy("当前暂无产物摘要。", "No artifact summary is available yet.") }}
        </p>
      </div>
    </article>
  </section>
</template>

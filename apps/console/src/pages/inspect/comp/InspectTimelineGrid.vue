<script setup lang="ts">
import { RouterLink } from "vue-router";

import type { AuditTimelineEntryKind, AuditTimelineProjectionView } from "../../../audit-timeline-projection";

defineProps<{
  projection: AuditTimelineProjectionView;
  findings: Array<[string, string]>;
  copy: (zh: string, en: string) => string;
  eventKindLabel: (kind: AuditTimelineEntryKind) => string;
  sourceLabel: (sourceMode: string) => string;
  taskLink: (taskId?: string) => string | undefined;
  sessionLink: (sessionId?: string) => string | undefined;
  approvalLink: (requestId?: string) => string | undefined;
}>();
</script>

<template>
  <section class="audit-grid">
    <article class="panel-card audit-card audit-card--timeline">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("分类表格", "Category table") }}</p>
          <h2>{{ copy("时间线事件", "Timeline events") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.entries.length }}</span>
      </div>

      <div v-if="projection.entries.length > 0" class="audit-table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ copy("时间", "Time") }}</th>
              <th>{{ copy("分类", "Category") }}</th>
              <th>{{ copy("标题", "Title") }}</th>
              <th>{{ copy("追踪", "Trace") }}</th>
              <th>{{ copy("详情", "Details") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in projection.entries" :key="entry.eventId">
              <td class="audit-table__cell--time">{{ entry.timestamp }}</td>
              <td>
                <span class="approval-card__lane">{{ eventKindLabel(entry.kind) }}</span>
              </td>
              <td>
                <strong>{{ entry.title }}</strong>
                <p class="audit-table__subtle">{{ entry.type }}</p>
              </td>
              <td class="audit-table__cell--meta">
                <div class="audit-table__chips">
                  <RouterLink
                    v-if="taskLink(entry.taskId)"
                    class="flow-pill"
                    :to="taskLink(entry.taskId)!"
                  >
                    task {{ entry.taskId }}
                  </RouterLink>
                  <RouterLink
                    v-if="sessionLink(entry.sessionId)"
                    class="flow-pill"
                    :to="sessionLink(entry.sessionId)!"
                  >
                    session {{ entry.sessionId }}
                  </RouterLink>
                  <RouterLink
                    v-if="approvalLink(entry.approvalRequestId)"
                    class="flow-pill"
                    :to="approvalLink(entry.approvalRequestId)!"
                  >
                    approval {{ entry.approvalRequestId }}
                  </RouterLink>
                  <span v-if="entry.artifactId" class="flow-pill">artifact {{ entry.artifactId }}</span>
                </div>
              </td>
              <td>
                <details class="audit-details">
                  <summary>{{ copy("查看详情", "View details") }}</summary>
                  <div class="audit-details__body">
                    <p v-if="entry.details.length === 0" class="panel-card__body">
                      {{ copy("无额外详情。", "No additional details.") }}
                    </p>
                    <p v-for="detail in entry.details" :key="detail" class="panel-card__body">
                      {{ detail }}
                    </p>
                    <p class="panel-card__body">
                      <strong>{{ copy("来源", "Source") }}:</strong>
                      {{ sourceLabel(entry.sourceMode) }}
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
          {{ copy("当前运行暂无可回放的审计事件。", "This run has no audit events to replay yet.") }}
        </p>
      </div>
    </article>

    <article class="panel-card audit-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("复盘锚点", "Replay anchors") }}</p>
          <h2>{{ copy("关键审计信号", "Key audit signals") }}</h2>
        </div>
      </div>

      <div v-if="findings.length > 0" class="audit-stack">
        <article
          v-for="finding in findings"
          :key="finding[0]"
          class="detail-chip detail-chip--compact detail-chip--row"
        >
          <span>{{ finding[0] }}</span>
          <strong>{{ finding[1] }}</strong>
        </article>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">
          {{ copy("当前暂无失败、阻塞、重规划或最近验证摘要。", "No failure, blocker, replan, or validation summary is recorded yet.") }}
        </p>
      </div>

      <div class="audit-subsection">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("会话分类", "Session category") }}</p>
            <h2>{{ copy("关键执行窗口", "Key execution windows") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.sessionEvents.length }}</span>
        </div>

        <div v-if="projection.sessionEvents.length > 0" class="audit-table-wrap">
          <table class="audit-table audit-table--compact">
            <thead>
              <tr>
                <th>{{ copy("时间", "Time") }}</th>
                <th>{{ copy("类型", "Type") }}</th>
                <th>{{ copy("任务", "Task") }}</th>
                <th>{{ copy("会话", "Session") }}</th>
                <th>{{ copy("详情", "Details") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in projection.sessionEvents" :key="event.eventId">
                <td class="audit-table__cell--time">{{ event.timestamp }}</td>
                <td>
                  <span class="approval-card__lane">{{ event.type }}</span>
                </td>
                <td>
                  <RouterLink class="ghost-link" :to="taskLink(event.taskId)!">
                    {{ event.taskTitle }}
                  </RouterLink>
                </td>
                <td>
                  <RouterLink class="ghost-link" :to="sessionLink(event.sessionId)!">
                    {{ event.sessionId }}
                  </RouterLink>
                </td>
                <td>
                  <details class="audit-details">
                    <summary>{{ copy("查看详情", "View details") }}</summary>
                    <div class="audit-details__body">
                      <p class="panel-card__body">{{ event.title }}</p>
                      <p class="panel-card__body">{{ event.summary }}</p>
                      <p class="panel-card__body">
                        <strong>{{ copy("来源", "Source") }}:</strong>
                        {{ sourceLabel(event.sourceMode) }}
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
            {{ copy("当前暂无可追踪的关键会话事件。", "No traceable key session events are available yet.") }}
          </p>
        </div>
      </div>
    </article>
  </section>
</template>

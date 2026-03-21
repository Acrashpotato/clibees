<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCard, NEmpty, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import type {
  AuditTimelineEntryKind,
  AuditTimelineEntryView,
  AuditTimelineSessionEventView,
} from "../../../audit-timeline-projection";

const props = defineProps<{
  entries: AuditTimelineEntryView[];
  sessionEvents: AuditTimelineSessionEventView[];
  totalEntryCount: number;
  timelineWindow: number | "all";
  timelineStep: number;
  hasMoreTimelineEntries: boolean;
  visibleTimelineSummary: string;
  findings: Array<[string, string]>;
  eventKindLabel: (kind: AuditTimelineEntryKind) => string;
  sourceLabel: (sourceMode: string) => string;
  taskLink: (taskId?: string) => string | undefined;
  sessionLink: (sessionId?: string) => string | undefined;
  approvalLink: (requestId?: string) => string | undefined;
}>();

const emit = defineEmits<{
  (event: "load-more"): void;
  (event: "reset-window"): void;
}>();

const showResetWindow = computed(() =>
  props.timelineWindow === "all" || props.timelineWindow > props.timelineStep,
);
</script>

<template>
  <section class="audit-grid audit-grid--timeline-stack">
    <n-card class="panel-card audit-card audit-card--timeline" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "分类表格" }}</p>
          <h2>{{ "时间线事件" }}</h2>
        </div>
        <n-tag size="small" round>{{ totalEntryCount }}</n-tag>
      </div>

      <div v-if="entries.length > 0" class="audit-table-wrap audit-table-wrap--timeline">
        <table class="audit-table">
          <thead>
            <tr>
              <th>{{ "时间" }}</th>
              <th>{{ "分类" }}</th>
              <th>{{ "标题" }}</th>
              <th>{{ "追踪" }}</th>
              <th>{{ "详情" }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.eventId">
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
                  <summary>{{ "查看详情" }}</summary>
                  <div class="audit-details__body">
                    <p v-if="entry.details.length === 0" class="panel-card__body">
                      {{ "无额外详情。" }}
                    </p>
                    <p v-for="detail in entry.details" :key="detail" class="panel-card__body">
                      {{ detail }}
                    </p>
                    <p class="panel-card__body">
                      <strong>{{ "来源" }}:</strong>
                      {{ sourceLabel(entry.sourceMode) }}
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
        :description="'当前运行暂无可回放的审计事件。'"
        size="small"
      />

      <div v-if="totalEntryCount > 0" class="audit-table__footer">
        <p class="panel-card__body">{{ visibleTimelineSummary }}</p>
        <div class="audit-table__actions">
          <n-button
            v-if="hasMoreTimelineEntries"
            quaternary
            size="small"
            @click="emit('load-more')"
          >
            {{ "加载更早事件" }} (+{{ timelineStep }})
          </n-button>
          <n-button
            v-if="showResetWindow"
            quaternary
            size="small"
            @click="emit('reset-window')"
          >
            {{ `回到最近 ${timelineStep} 条` }}
          </n-button>
        </div>
      </div>
    </n-card>

    <n-card class="panel-card audit-card" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "复盘锚点" }}</p>
          <h2>{{ "关键审计信号" }}</h2>
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
      <n-empty
        v-else
        class="panel-card__empty-state"
        :description="'当前暂无失败、阻塞、重规划或最近验证摘要。'"
        size="small"
      />
    </n-card>

    <n-card class="panel-card audit-card" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "会话分类" }}</p>
          <h2>{{ "关键执行窗口" }}</h2>
        </div>
        <n-tag size="small" round>{{ sessionEvents.length }}</n-tag>
      </div>

      <div v-if="sessionEvents.length > 0" class="audit-table-wrap audit-table-wrap--session-windows">
        <table class="audit-table audit-table--compact">
          <thead>
            <tr>
              <th>{{ "时间" }}</th>
              <th>{{ "类型" }}</th>
              <th>{{ "任务" }}</th>
              <th>{{ "会话" }}</th>
              <th>{{ "详情" }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in sessionEvents" :key="event.eventId">
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
                  <summary>{{ "查看详情" }}</summary>
                  <div class="audit-details__body">
                    <p class="panel-card__body">{{ event.title }}</p>
                    <p class="panel-card__body">{{ event.summary }}</p>
                    <p class="panel-card__body">
                      <strong>{{ "来源" }}:</strong>
                      {{ sourceLabel(event.sourceMode) }}
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
        :description="'当前暂无可追踪的关键会话事件。'"
        size="small"
      />
    </n-card>
  </section>
</template>


<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCard, NEmpty, NTag } from "naive-ui";
import { useChunkedRender } from "../../../composables/useChunkedRender";
import type { ArtifactContentPreview } from "../../../api";
import type {
  SessionDetailApprovalItemView,
  SessionDetailProjectionView,
} from "../../../detail-projection";

const props = defineProps<{
  projection: SessionDetailProjectionView;
  section: "support" | "artifacts";
  t: (key: string) => string;
  riskLabel: (riskLevel: "low" | "medium" | "high") => string;
  validationLabel: (state: SessionDetailProjectionView["validation"]["state"]) => string;
  sourceModeLabel: (sourceMode: string) => string;
  approvalStateLabel: (item: SessionDetailApprovalItemView) => string;
  isArtifactExpanded: (artifactId: string) => boolean;
  toggleArtifactPreview: (artifactId: string) => void;
  artifactPreviewLoadingId: string | null;
  artifactPreviewErrorById: Record<string, string>;
  artifactPreviewById: Record<string, ArtifactContentPreview>;
}>();

const {
  visibleItems: visibleToolCalls,
  hasMore: hasMoreToolCalls,
  loadMore: loadMoreToolCalls,
} = useChunkedRender(computed(() => props.projection.toolCalls), { initialSize: 20, step: 20 });

const {
  visibleItems: visibleApprovals,
  hasMore: hasMoreApprovals,
  loadMore: loadMoreApprovals,
} = useChunkedRender(computed(() => props.projection.approvals), { initialSize: 20, step: 20 });

const {
  visibleItems: visibleArtifacts,
  hasMore: hasMoreArtifacts,
  loadMore: loadMoreArtifacts,
} = useChunkedRender(computed(() => props.projection.artifacts.items), { initialSize: 20, step: 20 });

function statusTagType(status: string): "default" | "info" | "success" | "error" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "running") {
    return "info";
  }
  return "default";
}

function riskTagType(risk: string): "default" | "warning" | "error" {
  if (risk === "high") {
    return "error";
  }
  if (risk === "medium") {
    return "warning";
  }
  return "default";
}

function validationTagType(state: string): "warning" | "success" | "error" {
  if (state === "pass") {
    return "success";
  }
  if (state === "fail") {
    return "error";
  }
  return "warning";
}
</script>

<template>
  <div class="detail-grid detail-grid--support">
    <template v-if="section === 'support'">
      <n-card class="panel-card detail-card" size="small">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "工具调用" }}</p>
            <h2>{{ "调用与结果" }}</h2>
          </div>
          <n-tag size="small" round>{{ projection.toolCalls.length }}</n-tag>
        </div>

        <div v-if="visibleToolCalls.length > 0" class="detail-stack">
          <article v-for="tool in visibleToolCalls" :key="tool.toolCallId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ tool.label }}</span>
                <strong>{{ tool.command }}</strong>
              </div>
              <n-tag :type="statusTagType(tool.status)" size="small">{{ tool.status }}</n-tag>
            </div>
            <p class="panel-card__body" v-if="tool.args.length > 0">{{ tool.args.join(" ") }}</p>
            <p class="panel-card__body" v-if="tool.cwd">cwd: {{ tool.cwd }}</p>
            <p>{{ tool.summary }}</p>
            <p class="panel-card__body">{{ sourceModeLabel(tool.sourceMode) }}</p>
          </article>
          <n-button v-if="hasMoreToolCalls" quaternary size="small" @click="loadMoreToolCalls">
            {{ "加载更多工具调用" }}
          </n-button>
        </div>
        <n-empty
          v-else
          class="panel-card__empty-state"
          :description="'当前没有可展示的工具调用。'"
          size="small"
        />
      </n-card>

      <n-card class="panel-card detail-card" size="small">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ t("sections.approvals") }}</p>
            <h2>{{ "会话审批记录" }}</h2>
          </div>
          <n-tag size="small" round>{{ projection.approvals.length }}</n-tag>
        </div>

        <div v-if="visibleApprovals.length > 0" class="detail-stack">
          <article
            v-for="approval in visibleApprovals"
            :key="approval.requestId"
            class="approval-card detail-item-card"
            :data-risk="approval.riskLevel === 'none' ? 'low' : approval.riskLevel"
          >
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ approval.requestId }}</span>
                <strong>{{ approvalStateLabel(approval) }}</strong>
              </div>
              <n-tag :type="riskTagType(approval.riskLevel)" size="small">
                {{ approval.riskLevel === "none" ? "无" : riskLabel(approval.riskLevel) }}
              </n-tag>
            </div>
            <p>{{ approval.summary }}</p>
            <p class="panel-card__body">{{ sourceModeLabel(approval.sourceMode) }}</p>
          </article>
          <n-button v-if="hasMoreApprovals" quaternary size="small" @click="loadMoreApprovals">
            {{ "加载更多审批记录" }}
          </n-button>
        </div>
        <n-empty
          v-else
          class="panel-card__empty-state"
          :description="'当前没有会话级审批记录。'"
          size="small"
        />
      </n-card>

      <n-card class="panel-card detail-card" size="small">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "验证摘要" }}</p>
            <h2>{{ "会话验证状态" }}</h2>
          </div>
          <n-tag :type="validationTagType(projection.validation.state)" size="small">
            {{ validationLabel(projection.validation.state) }}
          </n-tag>
        </div>

        <div class="detail-stack">
          <div class="focus-panel__status-block">
            <strong class="focus-panel__status">{{ projection.validation.summary }}</strong>
            <p class="panel-card__body">{{ sourceModeLabel(projection.validation.sourceMode) }}</p>
          </div>
          <ul v-if="projection.validation.details.length > 0" class="health-list">
            <li v-for="detail in projection.validation.details" :key="detail">{{ detail }}</li>
          </ul>
          <p v-if="projection.validation.updatedAt" class="panel-card__body">
            {{ "更新时间" }}: {{ projection.validation.updatedAt }}
          </p>
        </div>
      </n-card>
    </template>

    <n-card v-else class="panel-card detail-card detail-card--wide" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "产物摘要" }}</p>
          <h2>{{ "会话产物" }}</h2>
        </div>
        <n-tag size="small" round>{{ projection.artifacts.totalCount }}</n-tag>
      </div>

      <div v-if="visibleArtifacts.length > 0" class="detail-stack detail-stack--grid">
        <article v-for="artifact in visibleArtifacts" :key="artifact.artifactId" class="approval-card detail-item-card">
          <div class="detail-item-card__top">
            <div>
              <span class="approval-card__lane">{{ artifact.kind }}</span>
              <strong>{{ artifact.summary }}</strong>
            </div>
            <span class="flow-pill">{{ artifact.createdAt }}</span>
          </div>
          <p class="panel-card__body">{{ artifact.uri }}</p>
          <n-button quaternary size="small" class="detail-item-card__link" @click="toggleArtifactPreview(artifact.artifactId)">
            {{ isArtifactExpanded(artifact.artifactId) ? "收起内容" : "查看内容" }}
          </n-button>
          <p v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewLoadingId === artifact.artifactId" class="panel-card__body">
            {{ "正在加载产物内容..." }}
          </p>
          <p v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewErrorById[artifact.artifactId]" class="form-error">
            {{ artifactPreviewErrorById[artifact.artifactId] }}
          </p>
          <template v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewById[artifact.artifactId]">
            <p class="panel-card__body">
              {{ artifactPreviewById[artifact.artifactId]!.source }} · {{ artifactPreviewById[artifact.artifactId]!.contentType }}
              <span v-if="artifactPreviewById[artifact.artifactId]!.filePath"> · {{ artifactPreviewById[artifact.artifactId]!.filePath }}</span>
            </p>
            <pre class="detail-pre">{{ artifactPreviewById[artifact.artifactId]!.body }}</pre>
          </template>
        </article>
        <n-button v-if="hasMoreArtifacts" quaternary size="small" @click="loadMoreArtifacts">
          {{ "加载更多产物" }}
        </n-button>
      </div>
      <n-empty
        v-else
        class="panel-card__empty-state"
        :description="'当前没有会话级产物。'"
        size="small"
      />
    </n-card>
  </div>
</template>

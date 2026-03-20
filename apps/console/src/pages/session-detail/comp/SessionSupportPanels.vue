<script setup lang="ts">
import type { ArtifactContentPreview } from "../../../api";
import type {
  SessionDetailApprovalItemView,
  SessionDetailProjectionView,
} from "../../../detail-projection";

defineProps<{
  projection: SessionDetailProjectionView;
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
</script>

<template>
  <div class="detail-grid detail-grid--support">
    <section class="panel-card detail-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "工具调用" }}</p>
          <h2>{{ "调用与结果" }}</h2>
        </div>
        <span class="panel-chip">{{ projection.toolCalls.length }}</span>
      </div>

      <div v-if="projection.toolCalls.length > 0" class="detail-stack">
        <article v-for="tool in projection.toolCalls" :key="tool.toolCallId" class="approval-card detail-item-card">
          <div class="detail-item-card__top">
            <div>
              <span class="approval-card__lane">{{ tool.label }}</span>
              <strong>{{ tool.command }}</strong>
            </div>
            <span class="status-pill" :data-status="tool.status === 'completed' ? 'completed' : tool.status === 'failed' ? 'failed' : 'running'">
              {{ tool.status }}
            </span>
          </div>
          <p class="panel-card__body" v-if="tool.args.length > 0">{{ tool.args.join(" ") }}</p>
          <p class="panel-card__body" v-if="tool.cwd">cwd: {{ tool.cwd }}</p>
          <p>{{ tool.summary }}</p>
          <p class="panel-card__body">{{ sourceModeLabel(tool.sourceMode) }}</p>
        </article>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">{{ "当前没有可展示的工具调用。" }}</p>
      </div>
    </section>

    <section class="panel-card detail-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ t("sections.approvals") }}</p>
          <h2>{{ "会话审批记录" }}</h2>
        </div>
        <span class="panel-chip">{{ projection.approvals.length }}</span>
      </div>

      <div v-if="projection.approvals.length > 0" class="detail-stack">
        <article v-for="approval in projection.approvals" :key="approval.requestId" class="approval-card detail-item-card" :data-risk="approval.riskLevel === 'none' ? 'low' : approval.riskLevel">
          <div class="detail-item-card__top">
            <div>
              <span class="approval-card__lane">{{ approval.requestId }}</span>
              <strong>{{ approvalStateLabel(approval) }}</strong>
            </div>
            <span class="risk-pill" :data-risk="approval.riskLevel === 'none' ? 'low' : approval.riskLevel">
              {{ approval.riskLevel === "none" ? "无" : riskLabel(approval.riskLevel) }}
            </span>
          </div>
          <p>{{ approval.summary }}</p>
          <p class="panel-card__body">{{ sourceModeLabel(approval.sourceMode) }}</p>
          <p class="panel-card__body" v-if="approval.requestedAt">{{ "请求时间" }}: {{ approval.requestedAt }}</p>
          <p class="panel-card__body" v-if="approval.decidedAt">{{ "决策时间" }}: {{ approval.decidedAt }}</p>
        </article>
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">{{ "当前没有会话级审批记录。" }}</p>
      </div>
    </section>

    <section class="panel-card detail-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "验证摘要" }}</p>
          <h2>{{ "会话验证状态" }}</h2>
        </div>
        <span class="status-pill" :data-status="projection.validation.state === 'fail' ? 'failed' : projection.validation.state === 'pass' ? 'completed' : 'awaiting_approval'">
          {{ validationLabel(projection.validation.state) }}
        </span>
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
    </section>

    <section class="panel-card detail-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "产物摘要" }}</p>
          <h2>{{ "会话产物" }}</h2>
        </div>
        <span class="panel-chip">{{ projection.artifacts.totalCount }}</span>
      </div>

      <div v-if="projection.artifacts.items.length > 0" class="detail-stack">
        <article v-for="artifact in projection.artifacts.items" :key="artifact.artifactId" class="approval-card detail-item-card">
          <div class="detail-item-card__top">
            <div>
              <span class="approval-card__lane">{{ artifact.kind }}</span>
              <strong>{{ artifact.summary }}</strong>
            </div>
            <span class="flow-pill">{{ artifact.createdAt }}</span>
          </div>
          <p class="panel-card__body">{{ artifact.uri }}</p>
          <button class="ghost-button detail-item-card__link" type="button" @click="toggleArtifactPreview(artifact.artifactId)">
            {{ isArtifactExpanded(artifact.artifactId) ? "收起内容" : "查看内容" }}
          </button>
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
      </div>
      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">{{ "当前没有会话级产物。" }}</p>
      </div>
    </section>
  </div>
</template>


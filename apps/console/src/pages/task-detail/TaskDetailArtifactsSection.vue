<script setup lang="ts">
import { NButton, NCard, NEmpty, NTag } from "naive-ui";

import type { TaskDetailProjectionView } from "../../detail-projection";

defineProps<{
  totalCount: number;
  visibleArtifacts: readonly TaskDetailProjectionView["artifacts"]["highlights"][number][];
  hasMoreArtifacts: boolean;
  loadMoreArtifacts: () => void;
  toggleArtifactPreview: (artifactId: string) => void;
  isArtifactExpanded: (artifactId: string) => boolean;
  artifactPreviewLoadingId?: string | null;
  artifactPreviewErrorById: Record<string, string | undefined>;
  artifactPreviewById: Record<string, {
    source: string;
    contentType: string;
    filePath?: string;
    body: string;
  } | undefined>;
}>();
</script>

<template>
  <n-card class="panel-card detail-card" size="small">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ "产物摘要" }}</p>
        <h2>{{ "最近产物与高亮" }}</h2>
      </div>
      <n-tag size="small" round>{{ totalCount }}</n-tag>
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
      :description="'当前没有可展示的 task 产物。'"
      size="small"
    />
  </n-card>
</template>

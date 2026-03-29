<script setup lang="ts">
import { NCard, NTag } from "naive-ui";

import type { TaskBoardDependencyEdge } from "../../task-board-projection";

defineProps<{
  edgeCount: number;
  orderedEdges: TaskBoardDependencyEdge[];
  edgeStateLabel: (state: TaskBoardDependencyEdge["state"]) => string;
  dependencySummary: (edge: TaskBoardDependencyEdge) => string;
}>();
</script>

<template>
  <n-card class="panel-card task-board-edges" size="small">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ "依赖边" }}</p>
        <h2>{{ "显式依赖关系" }}</h2>
      </div>
      <n-tag size="small" round>{{ edgeCount }}</n-tag>
    </div>

    <div class="task-board-edge-list">
      <article
        v-for="edge in orderedEdges"
        :key="edge.edgeId"
        class="summary-card task-board-edge"
        :data-state="edge.state"
      >
        <div class="task-node-card__section-header">
          <strong>{{ edge.fromTaskId }} -> {{ edge.toTaskId }}</strong>
          <span class="flow-pill">{{ edgeStateLabel(edge.state) }}</span>
        </div>
        <p class="panel-card__body">{{ dependencySummary(edge) }}</p>
      </article>
    </div>
  </n-card>
</template>

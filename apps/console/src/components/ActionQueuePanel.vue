<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { ActionQueueItem } from "../view-models";
import { getTaskConsolePath } from "../workspace";

const props = defineProps<{
  items: ActionQueueItem[];
  runId?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  emptyKey?: string;
  emptyActionLabel?: string;
  emptyActionTo?: string;
}>();

const { t } = usePreferences();

const leadItem = computed(() => props.items[0]);
const remainingItems = computed(() => props.items.slice(1));

function kindLabel(kind: ActionQueueItem["kind"]) {
  if (kind === "approval") {
    return t("sections.approvals");
  }

  if (kind === "blocked") {
    return t("fields.blocked");
  }

  return t("sections.runReminders");
}

function getItemActionTo(item: ActionQueueItem): string | undefined {
  if (item.actionTo) {
    return item.actionTo;
  }

  if (props.runId && item.taskId) {
    return getTaskConsolePath(props.runId, item.taskId);
  }

  return props.emptyActionTo;
}

function hasItemActionTo(item: ActionQueueItem): boolean {
  return typeof getItemActionTo(item) === "string";
}

function getItemActionHref(item: ActionQueueItem): string {
  return getItemActionTo(item) ?? props.emptyActionTo ?? "/workspace";
}
</script>

<template>
  <section class="panel-card action-queue-panel">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ eyebrow ?? t("sections.actionQueue") }}</p>
        <h2>{{ title ?? t("sections.pendingForYou") }}</h2>
      </div>
      <span v-if="items.length > 0" class="panel-chip">{{ items.length }}</span>
    </div>

    <p v-if="description" class="panel-card__body">{{ description }}</p>

    <template v-if="leadItem">
      <article class="action-queue-panel__lead" :data-tone="leadItem.tone">
        <div class="action-queue-card__topline">
          <span class="approval-card__lane">{{ leadItem.sourceLabel }}</span>
          <span class="action-queue-card__kind">{{ kindLabel(leadItem.kind) }}</span>
        </div>
        <h3>{{ leadItem.title }}</h3>
        <p>{{ leadItem.summary }}</p>
        <RouterLink v-if="hasItemActionTo(leadItem)" class="primary-link action-queue-card__link" :to="getItemActionHref(leadItem)">
          {{ leadItem.recommendedActionLabel }}
        </RouterLink>
      </article>

      <div v-if="remainingItems.length > 0" class="approval-list action-queue-panel__list">
        <article
          v-for="item in remainingItems"
          :key="item.id"
          class="approval-card action-queue-card action-queue-card--secondary"
          :data-risk="item.tone === 'danger' ? 'high' : item.tone === 'warning' ? 'medium' : 'low'"
        >
          <div class="action-queue-card__topline">
            <span class="approval-card__lane">{{ item.sourceLabel }}</span>
            <span class="action-queue-card__kind">{{ kindLabel(item.kind) }}</span>
          </div>
          <strong>{{ item.title }}</strong>
          <p>{{ item.summary }}</p>
          <RouterLink v-if="hasItemActionTo(item)" class="ghost-link action-queue-card__link" :to="getItemActionHref(item)">
            {{ item.recommendedActionLabel }}
          </RouterLink>
        </article>
      </div>
    </template>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t(emptyKey ?? "workspacePage.actionQueueEmpty") }}</p>
      <RouterLink v-if="emptyActionTo" class="ghost-link" :to="emptyActionTo">
        {{ emptyActionLabel ?? t("actions.continueFocus") }}
      </RouterLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  settingsSections,
  type SettingsSectionId,
} from "./settings-sections";

const props = defineProps<{
  activeSection: SettingsSectionId;
}>();

const emit = defineEmits<{
  "navigate-section": [section: SettingsSectionId];
}>();
</script>

<template>
  <section class="settings-shell">
    <aside class="settings-shell__sidebar panel-card">
      <nav class="settings-shell__nav" aria-label="系统设置分类">
        <button
          v-for="section in settingsSections"
          :key="section.id"
          class="settings-shell__nav-item"
          type="button"
          :data-active="props.activeSection === section.id"
          @click="emit('navigate-section', section.id)"
        >
          {{ section.label }}
        </button>
      </nav>
    </aside>

    <section class="settings-shell__content">
      <slot />
    </section>
  </section>
</template>

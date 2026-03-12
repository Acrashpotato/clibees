<script setup lang="ts">
import { usePreferences } from "../composables/usePreferences";

defineProps<{
  eyebrowKey: string;
  titleKey: string;
  descriptionKey: string;
}>();

const { t } = usePreferences();
</script>

<template>
  <section class="placeholder-card">
    <p class="section-eyebrow">{{ t(eyebrowKey) }}</p>
    <h1>{{ t(titleKey) }}</h1>
    <p>{{ t(descriptionKey) }}</p>
  </section>
</template>

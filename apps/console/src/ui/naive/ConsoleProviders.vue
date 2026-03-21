<script setup lang="ts">
import { computed, watch } from "vue";
import {
  darkTheme,
  NConfigProvider,
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";

import App from "../../App.vue";
import { usePreferences } from "../../composables/usePreferences";
import { syncNaiveDiscreteTheme } from "./discrete";
import { buildNaiveThemeOverrides } from "./theme";

const { theme } = usePreferences();
const naiveTheme = computed(() => (theme.value === "dark" ? darkTheme : undefined));
const themeOverrides = computed(() => buildNaiveThemeOverrides(theme.value));

watch(
  () => theme.value,
  (mode) => {
    syncNaiveDiscreteTheme(mode);
  },
  { immediate: true },
);
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :inline-theme-disabled="true">
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <n-message-provider>
            <App />
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>


<script setup lang="ts">
import { Setting } from "@element-plus/icons-vue";
import { ElTooltip } from "element-plus";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const isSettingsRoute = computed(() => route.path.startsWith("/settings"));

async function goToSettings(): Promise<void> {
  if (isSettingsRoute.value) {
    return;
  }

  await router.push("/settings/run");
}
</script>

<template>
  <ElTooltip content="设置" placement="bottom">
    <button class="settings-entry-button" type="button" :data-active="isSettingsRoute" @click="goToSettings">
      <el-icon><Setting /></el-icon>
    </button>
  </ElTooltip>
</template>

<script setup lang="ts">
import { Plus } from "@element-plus/icons-vue";

defineEmits<{
  create: [];
}>();
</script>

<template>
  <section class="run-empty-state panel-card">
    <button class="run-empty-state__plus" type="button" @click="$emit('create')">
      <el-icon><Plus /></el-icon>
    </button>
    <div class="run-empty-state__copy">
      <p class="section-eyebrow">运行中心</p>
      <h2>从一个新任务开始</h2>
      <p>创建后，左侧会自动生成任务节点，以及总管、工位池、工作台、执行车道、审批、审计六个三级菜单。</p>
    </div>
  </section>
</template>

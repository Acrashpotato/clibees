<script setup lang="ts">
import { computed } from "vue";
import { ElDialog, ElInput, ElOption, ElSelect, ElSwitch } from "element-plus";

import type { SelectedCli } from "../../api";

const props = defineProps<{
  modelValue: boolean;
  createNameInput: string;
  createGoalInput: string;
  selectedCli: SelectedCli;
  autoResume: boolean;
  creating: boolean;
  createError: string;
  cliOptions: ReadonlyArray<SelectedCli>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "update:createNameInput": [value: string];
  "update:createGoalInput": [value: string];
  "update:selectedCli": [value: SelectedCli];
  "update:autoResume": [value: boolean];
  submit: [];
}>();

const cliSelectOptions = computed(() =>
  props.cliOptions.map((cli) => ({
    label: cli,
    value: cli,
  })),
);

function updateSelectedCli(value: string | number | boolean): void {
  emit("update:selectedCli", String(value) as SelectedCli);
}

function updateAutoResume(value: string | number | boolean): void {
  emit("update:autoResume", Boolean(value));
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    width="640px"
    align-center
    class="create-run-dialog"
    :close-on-click-modal="!creating"
    @close="emit('update:modelValue', false)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="create-run-dialog__header">
        <p class="section-eyebrow">新建任务</p>
        <h2>让运行中心长出一个新分支</h2>
      </div>
    </template>

    <div class="create-run-dialog__body">
      <label class="create-run-dialog__field">
        <span class="form-label">任务名称</span>
        <ElInput
          :model-value="createNameInput"
          maxlength="48"
          show-word-limit
          placeholder="例如：控制台 UI 重构"
          @update:model-value="emit('update:createNameInput', $event)"
        />
      </label>

      <label class="create-run-dialog__field">
        <span class="form-label">任务目标</span>
        <ElInput
          :model-value="createGoalInput"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 8 }"
          placeholder="例如：重构控制台 UI，切换到 Element Plus 并重做导航"
          @update:model-value="emit('update:createGoalInput', $event)"
        />
      </label>

      <div class="create-run-dialog__grid">
        <label class="create-run-dialog__field">
          <span class="form-label">CLI</span>
          <ElSelect :model-value="selectedCli" @update:model-value="updateSelectedCli">
            <ElOption
              v-for="option in cliSelectOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
        </label>

        <label class="create-run-dialog__field create-run-dialog__switch">
          <span class="form-label">创建后自动启动</span>
          <ElSwitch :model-value="autoResume" @update:model-value="updateAutoResume" />
        </label>
      </div>

      <p v-if="createError" class="form-error">{{ createError }}</p>
    </div>

    <template #footer>
      <div class="create-run-dialog__footer">
        <button class="ghost-link" type="button" @click="emit('update:modelValue', false)">取消</button>
        <button class="primary-link" type="button" :disabled="creating" @click="emit('submit')">
          {{ creating ? "创建中..." : "创建任务" }}
        </button>
      </div>
    </template>
  </ElDialog>
</template>

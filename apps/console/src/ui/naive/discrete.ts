import { ElMessage, ElMessageBox, ElNotification } from "element-plus";

type DialogOptions = {
  title: string;
  content: string;
  positiveText?: string;
  negativeText?: string;
  onPositiveClick?: () => void;
  onNegativeClick?: () => void;
  onClose?: () => void;
};

const discreteApi = {
  dialog: {
    warning(options: DialogOptions) {
      void ElMessageBox.confirm(options.content, options.title, {
        type: "warning",
        confirmButtonText: options.positiveText ?? "确认",
        cancelButtonText: options.negativeText ?? "取消",
        distinguishCancelAndClose: true,
      })
        .then(() => {
          options.onPositiveClick?.();
        })
        .catch((reason: unknown) => {
          if (reason === "cancel") {
            options.onNegativeClick?.();
            return;
          }

          options.onClose?.();
        });
    },
  },
  message: ElMessage,
  notification: ElNotification,
  loadingBar: {
    start() {
      return undefined;
    },
    finish() {
      return undefined;
    },
    error() {
      return undefined;
    },
  },
};

export function syncNaiveDiscreteTheme(): void {
  return undefined;
}

export function useNaiveDiscrete() {
  return discreteApi;
}

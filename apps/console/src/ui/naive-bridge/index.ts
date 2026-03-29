// @ts-nocheck
import {
  ElButton,
  ElCard,
  ElCheckbox,
  ElCollapse,
  ElCollapseItem,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadio,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
} from "element-plus";
import {
  computed,
  defineComponent,
  h,
  type CSSProperties,
  type PropType,
} from "vue";

type TagType = "default" | "info" | "success" | "warning" | "error";

function mapButtonType(type?: string, quaternary?: boolean, secondary?: boolean): string | undefined {
  if (quaternary) {
    return undefined;
  }

  if (secondary) {
    return "primary";
  }

  if (type === "error") {
    return "danger";
  }

  if (type === "default") {
    return undefined;
  }

  return type;
}

function mapTagType(type?: TagType): "primary" | "success" | "info" | "warning" | "danger" | undefined {
  switch (type) {
    case "info":
      return "primary";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "danger";
    default:
      return "info";
  }
}

function parseGridColumns(cols?: string | number): number {
  if (typeof cols === "number") {
    return cols;
  }
  if (typeof cols !== "string") {
    return 1;
  }

  const matches = cols.match(/\d+/g);
  if (!matches || matches.length === 0) {
    return 1;
  }

  return Number(matches[matches.length - 1] ?? 1);
}

export const NButton = defineComponent({
  name: "NButton",
  inheritAttrs: false,
  props: {
    type: String,
    size: String,
    disabled: Boolean,
    quaternary: Boolean,
    secondary: Boolean,
    circle: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        ElButton,
        {
          ...attrs,
          class: ["n-button-bridge", attrs.class],
          type: mapButtonType(props.type, props.quaternary, props.secondary),
          size: props.size,
          disabled: props.disabled,
          text: props.quaternary,
          plain: props.secondary,
          circle: props.circle,
        },
        slots,
      );
  },
});

export const NTag = defineComponent({
  name: "NTag",
  inheritAttrs: false,
  props: {
    type: String as PropType<TagType>,
    size: String,
    round: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        ElTag,
        {
          ...attrs,
          class: ["n-tag-bridge", { "n-tag-bridge--round": props.round }, attrs.class],
          type: mapTagType(props.type),
          size: props.size,
          round: props.round,
          effect: "light",
        },
        slots.default ? { default: () => slots.default?.() } : undefined,
      );
  },
});

export const NCard = defineComponent({
  name: "NCard",
  inheritAttrs: false,
  props: {
    size: String,
  },
  setup(_props, { attrs, slots }) {
    return () => h(ElCard, { ...attrs, class: ["n-card-bridge", attrs.class] }, slots);
  },
});

export const NCollapse = defineComponent({
  name: "NCollapse",
  inheritAttrs: false,
  props: {
    accordion: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () => h(ElCollapse, { ...attrs, accordion: props.accordion }, slots);
  },
});

export const NCollapseItem = defineComponent({
  name: "NCollapseItem",
  inheritAttrs: false,
  props: {
    title: String,
    name: [String, Number],
  },
  setup(props, { attrs, slots }) {
    return () => h(ElCollapseItem, { ...attrs, title: props.title, name: props.name }, slots);
  },
});

export const NEmpty = defineComponent({
  name: "NEmpty",
  inheritAttrs: false,
  props: {
    description: String,
    size: String,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        ElEmpty,
        {
          ...attrs,
          class: ["n-empty-bridge", attrs.class],
          description: props.description,
        },
        slots,
      );
  },
});

export const NAlert = defineComponent({
  name: "NAlert",
  inheritAttrs: false,
  props: {
    type: {
      type: String as PropType<"success" | "warning" | "info" | "error">,
      default: "info",
    },
    showIcon: {
      type: Boolean,
      default: true,
    },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        "div",
        {
          ...attrs,
          class: ["n-alert-bridge", `n-alert-bridge--${props.type}`, attrs.class],
        },
        [
          props.showIcon ? h("span", { class: "n-alert-bridge__icon", "aria-hidden": "true" }, "●") : null,
          h("div", { class: "n-alert-bridge__content" }, slots.default?.()),
        ],
      );
  },
});

export const NInput = defineComponent({
  name: "NInput",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: "",
    },
    type: String,
    placeholder: String,
    clearable: Boolean,
    disabled: Boolean,
    autosize: [Boolean, Object] as PropType<boolean | { minRows?: number; maxRows?: number }>,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit }) {
    return () =>
      h(ElInput, {
        ...attrs,
        class: ["n-input-bridge", attrs.class],
        modelValue: props.value,
        "onUpdate:modelValue": (value: string) => emit("update:value", value),
        type: props.type,
        placeholder: props.placeholder,
        clearable: props.clearable,
        disabled: props.disabled,
        autosize: props.autosize,
      });
  },
});

export const NInputNumber = defineComponent({
  name: "NInputNumber",
  inheritAttrs: false,
  props: {
    value: Number as PropType<number | null>,
    min: Number,
    max: Number,
    step: Number,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit }) {
    return () =>
      h(ElInputNumber, {
        ...attrs,
        class: ["n-input-number-bridge", attrs.class],
        modelValue: props.value,
        "onUpdate:modelValue": (value: number | undefined) => emit("update:value", value ?? null),
        min: props.min,
        max: props.max,
        step: props.step,
      });
  },
});

export const NSelect = defineComponent({
  name: "NSelect",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number, Boolean] as PropType<string | number | boolean | undefined>,
      default: undefined,
    },
    options: {
      type: Array as PropType<Array<{ label: string; value: string | number | boolean }>>,
      default: () => [],
    },
    placeholder: String,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        ElSelect,
        {
          ...attrs,
          class: ["n-select-bridge", attrs.class],
          modelValue: props.value,
          "onUpdate:modelValue": (value: string | number | boolean) => emit("update:value", value),
          placeholder: props.placeholder,
        },
        {
          default: () =>
            props.options.map((option) =>
              h(ElOption, {
                key: String(option.value),
                label: option.label,
                value: option.value,
              }),
            ),
        },
      );
  },
});

export const NCheckbox = defineComponent({
  name: "NCheckbox",
  inheritAttrs: false,
  props: {
    checked: Boolean,
    disabled: Boolean,
  },
  emits: ["update:checked"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        ElCheckbox,
        {
          ...attrs,
          modelValue: props.checked,
          "onUpdate:modelValue": (value: boolean) => emit("update:checked", value),
          disabled: props.disabled,
        },
        slots,
      );
  },
});

export const NRadioGroup = defineComponent({
  name: "NRadioGroup",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number, Boolean] as PropType<string | number | boolean | undefined>,
      default: undefined,
    },
    size: String,
    name: String,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        ElRadioGroup,
        {
          ...attrs,
          modelValue: props.value,
          "onUpdate:modelValue": (value: string | number | boolean) => emit("update:value", value),
          size: props.size,
          name: props.name,
        },
        slots,
      );
  },
});

export const NRadio = defineComponent({
  name: "NRadio",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number, Boolean] as PropType<string | number | boolean | undefined>,
      default: undefined,
    },
  },
  setup(props, { attrs, slots }) {
    return () => h(ElRadio, { ...attrs, value: props.value }, slots);
  },
});

export const NRadioButton = defineComponent({
  name: "NRadioButton",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number, Boolean] as PropType<string | number | boolean | undefined>,
      default: undefined,
    },
  },
  setup(props, { attrs, slots }) {
    return () => h(ElRadioButton, { ...attrs, value: props.value }, slots);
  },
});

export const NSwitch = defineComponent({
  name: "NSwitch",
  inheritAttrs: false,
  props: {
    value: Boolean,
    disabled: Boolean,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        ElSwitch,
        {
          ...attrs,
          modelValue: props.value,
          "onUpdate:modelValue": (value: boolean) => emit("update:value", value),
          disabled: props.disabled,
          inlinePrompt: Boolean(slots.checked || slots.unchecked),
          activeText: slots.checked ? "" : undefined,
          inactiveText: slots.unchecked ? "" : undefined,
        },
        {
          activeAction: slots.checked,
          inactiveAction: slots.unchecked,
        },
      );
  },
});

export const NForm = defineComponent({
  name: "NForm",
  inheritAttrs: false,
  props: {
    labelPlacement: String,
    showFeedback: Boolean,
  },
  setup(_props, { attrs, slots }) {
    return () => h(ElForm, { ...attrs }, slots);
  },
});

export const NFormItem = defineComponent({
  name: "NFormItem",
  inheritAttrs: false,
  props: {
    label: String,
  },
  setup(props, { attrs, slots }) {
    return () => h(ElFormItem, { ...attrs, label: props.label }, slots);
  },
});

export const NTabs = defineComponent({
  name: "NTabs",
  inheritAttrs: false,
  props: {
    value: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    defaultValue: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    type: String,
    animated: Boolean,
    displayDirective: String,
  },
  emits: ["update:value"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        ElTabs,
        {
          ...attrs,
          class: ["n-tabs-bridge", { "n-tabs-bridge--segment": props.type === "segment" }, attrs.class],
          modelValue: props.value ?? props.defaultValue,
          "onUpdate:modelValue": (value: string | number) => emit("update:value", value),
          stretch: props.type === "segment",
        },
        slots,
      );
  },
});

export const NTabPane = defineComponent({
  name: "NTabPane",
  inheritAttrs: false,
  props: {
    name: {
      type: [String, Number] as PropType<string | number | undefined>,
      default: undefined,
    },
    tab: {
      type: String,
      default: "",
    },
  },
  setup(props, { attrs, slots }) {
    return () => h(ElTabPane, { ...attrs, name: props.name, label: props.tab }, slots);
  },
});

export const NSpace = defineComponent({
  name: "NSpace",
  inheritAttrs: false,
  props: {
    size: {
      type: [String, Number],
      default: 8,
    },
    vertical: Boolean,
    align: String,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        "div",
        {
          ...attrs,
          class: ["n-space-bridge", { "n-space-bridge--vertical": props.vertical }, attrs.class],
          style: [
            attrs.style as CSSProperties,
            {
              gap: typeof props.size === "number" ? `${props.size}px` : props.size,
              alignItems: props.align,
            } satisfies CSSProperties,
          ],
        },
        slots.default?.(),
      );
  },
});

export const NText = defineComponent({
  name: "NText",
  inheritAttrs: false,
  props: {
    strong: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        props.strong ? "strong" : "span",
        {
          ...attrs,
          class: ["n-text-bridge", attrs.class],
        },
        slots.default?.(),
      );
  },
});

export const NGrid = defineComponent({
  name: "NGrid",
  inheritAttrs: false,
  props: {
    cols: {
      type: [String, Number],
      default: 1,
    },
    xGap: {
      type: Number,
      default: 0,
    },
    yGap: {
      type: Number,
      default: 0,
    },
  },
  setup(props, { attrs, slots }) {
    const columnCount = computed(() => parseGridColumns(props.cols));

    return () =>
      h(
        "div",
        {
          ...attrs,
          class: ["n-grid-bridge", attrs.class],
          style: [
            attrs.style as CSSProperties,
            {
              display: "grid",
              gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`,
              columnGap: `${props.xGap}px`,
              rowGap: `${props.yGap}px`,
            } satisfies CSSProperties,
          ],
        },
        slots.default?.(),
      );
  },
});

export const NGi = defineComponent({
  name: "NGi",
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () =>
      h(
        "div",
        {
          ...attrs,
          class: ["n-gi-bridge", attrs.class],
        },
        slots.default?.(),
      );
  },
});

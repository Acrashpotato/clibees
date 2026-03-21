import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

type ReadonlyArrayRef<T> = Ref<readonly T[]> | ComputedRef<readonly T[]>;

interface UseChunkedRenderOptions {
  initialSize?: number;
  step?: number;
  resetOnSourceChange?: boolean;
}

export function useChunkedRender<T>(
  source: ReadonlyArrayRef<T>,
  options: UseChunkedRenderOptions = {},
) {
  const initialSize = Math.max(1, options.initialSize ?? 20);
  const step = Math.max(1, options.step ?? initialSize);
  const resetOnSourceChange = options.resetOnSourceChange ?? true;

  const visibleCount = ref(initialSize);

  const visibleItems = computed<readonly T[]>(() =>
    source.value.slice(0, visibleCount.value),
  );

  const hasMore = computed(() => source.value.length > visibleCount.value);

  function loadMore(): void {
    if (!hasMore.value) {
      return;
    }

    visibleCount.value = Math.min(source.value.length, visibleCount.value + step);
  }

  function reset(nextCount = initialSize): void {
    visibleCount.value = Math.min(source.value.length, Math.max(1, nextCount));
  }

  watch(
    source,
    (next) => {
      if (resetOnSourceChange) {
        visibleCount.value = Math.min(next.length, initialSize);
        return;
      }

      if (visibleCount.value > next.length) {
        visibleCount.value = next.length;
      }
    },
    { immediate: true },
  );

  return {
    visibleCount,
    visibleItems,
    hasMore,
    loadMore,
    reset,
  };
}

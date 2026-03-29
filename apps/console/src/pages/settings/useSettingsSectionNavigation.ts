import type { ComponentPublicInstance } from "vue";
import { computed, shallowRef, useTemplateRef, watch } from "vue";

import type { SettingsSectionId } from "./settings-sections";

const SECTION_ACTIVATION_OFFSET_PX = 140;

function isHtmlElement(
  value: Element | ComponentPublicInstance | null,
): value is HTMLElement {
  return value instanceof HTMLElement;
}

export function useSettingsSectionNavigation(sectionIds: readonly SettingsSectionId[]) {
  const scrollContainer = useTemplateRef<HTMLDivElement>("settingsScrollContainer");
  const currentSection = shallowRef<SettingsSectionId>(sectionIds[0] ?? "run");
  const sectionElements = new Map<SettingsSectionId, HTMLElement>();

  function updateCurrentSection(): void {
    const container = scrollContainer.value;
    if (!container) {
      return;
    }

    const anchor = container.scrollTop + SECTION_ACTIVATION_OFFSET_PX;
    let nextSection = sectionIds[0] ?? "run";

    for (const sectionId of sectionIds) {
      const element = sectionElements.get(sectionId);
      if (!element) {
        continue;
      }
      if (anchor >= element.offsetTop) {
        nextSection = sectionId;
        continue;
      }
      break;
    }

    currentSection.value = nextSection;
  }

  function setSectionElement(sectionId: SettingsSectionId) {
    return (value: Element | ComponentPublicInstance | null): void => {
      if (isHtmlElement(value)) {
        sectionElements.set(sectionId, value);
      } else {
        sectionElements.delete(sectionId);
      }
      updateCurrentSection();
    };
  }

  function scrollToSection(sectionId: SettingsSectionId, behavior: ScrollBehavior = "auto"): void {
    const container = scrollContainer.value;
    const element = sectionElements.get(sectionId);
    if (!container || !element) {
      return;
    }

    currentSection.value = sectionId;
    container.scrollTo({
      top: Math.max(0, element.offsetTop - 8),
      behavior,
    });
  }

  watch(
    scrollContainer,
    (container, _previous, onCleanup) => {
      if (!container) {
        return;
      }

      const handleScroll = () => {
        updateCurrentSection();
      };

      container.addEventListener("scroll", handleScroll, { passive: true });
      updateCurrentSection();

      onCleanup(() => {
        container.removeEventListener("scroll", handleScroll);
      });
    },
    { immediate: true },
  );

  return {
    scrollContainer,
    currentSection: computed(() => currentSection.value),
    setSectionElement,
    scrollToSection,
    updateCurrentSection,
  };
}

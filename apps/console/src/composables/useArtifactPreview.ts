import { ref } from "vue";

import { getArtifactContent, type ArtifactContentPreview } from "../api";

export function useArtifactPreview(getRunId: () => string) {
  const artifactPreviewById = ref<Record<string, ArtifactContentPreview>>({});
  const artifactPreviewErrorById = ref<Record<string, string>>({});
  const artifactPreviewLoadingId = ref<string | null>(null);
  const expandedArtifactId = ref<string | null>(null);

  function resetArtifactPreview(): void {
    artifactPreviewById.value = {};
    artifactPreviewErrorById.value = {};
    artifactPreviewLoadingId.value = null;
    expandedArtifactId.value = null;
  }

  function isArtifactExpanded(artifactId: string): boolean {
    return expandedArtifactId.value === artifactId;
  }

  async function toggleArtifactPreview(artifactId: string): Promise<void> {
    if (expandedArtifactId.value === artifactId) {
      expandedArtifactId.value = null;
      return;
    }

    expandedArtifactId.value = artifactId;
    if (artifactPreviewById.value[artifactId] || artifactPreviewErrorById.value[artifactId]) {
      return;
    }

    const runId = getRunId();
    if (!runId) {
      artifactPreviewErrorById.value = {
        ...artifactPreviewErrorById.value,
        [artifactId]: "Missing runId, cannot load artifact preview.",
      };
      return;
    }

    artifactPreviewLoadingId.value = artifactId;
    try {
      const preview = await getArtifactContent(runId, artifactId);
      artifactPreviewById.value = {
        ...artifactPreviewById.value,
        [artifactId]: preview,
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      artifactPreviewErrorById.value = {
        ...artifactPreviewErrorById.value,
        [artifactId]: message,
      };
    } finally {
      if (artifactPreviewLoadingId.value === artifactId) {
        artifactPreviewLoadingId.value = null;
      }
    }
  }

  return {
    artifactPreviewById,
    artifactPreviewErrorById,
    artifactPreviewLoadingId,
    isArtifactExpanded,
    toggleArtifactPreview,
    resetArtifactPreview,
  };
}

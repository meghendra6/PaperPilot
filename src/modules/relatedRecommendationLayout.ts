export interface RelatedRecommendationLayout {
  chatFlex: string;
  chatMinHeight: number;
  containerMinHeight: number;
  containerOverflow: "hidden" | "visible";
  groupsMaxHeight: string;
  groupsOverflowY: "auto" | "visible";
}

export function getRelatedRecommendationLayout(params: {
  hasRecommendations: boolean;
  defaultChatMinHeight?: number;
  recommendationChatMinHeight?: number;
  defaultContainerMinHeight?: number;
  recommendationContainerMinHeight?: number;
  defaultChatFlex?: string;
  recommendationChatFlex?: string;
  recommendationContentHeight?: number;
  maxRecommendationHeight?: number;
}) {
  const defaultChatMinHeight = params.defaultChatMinHeight ?? 520;
  const recommendationChatMinHeight = params.recommendationChatMinHeight ?? 360;
  const defaultContainerMinHeight = params.defaultContainerMinHeight ?? 860;
  const recommendationContainerMinHeight =
    params.recommendationContainerMinHeight ?? 700;
  const defaultChatFlex = params.defaultChatFlex ?? "3 1 640px";
  const recommendationChatFlex = params.recommendationChatFlex ?? "2 1 460px";
  const recommendationContentHeight = Math.max(
    0,
    params.recommendationContentHeight ?? 0,
  );
  const maxRecommendationHeight = params.maxRecommendationHeight ?? 420;

  if (!params.hasRecommendations) {
    return {
      chatFlex: defaultChatFlex,
      chatMinHeight: defaultChatMinHeight,
      containerMinHeight: defaultContainerMinHeight,
      containerOverflow: "hidden" as const,
      groupsMaxHeight: "",
      groupsOverflowY: "visible" as const,
    } satisfies RelatedRecommendationLayout;
  }

  const groupsMaxHeight = Math.min(
    maxRecommendationHeight,
    recommendationContentHeight || maxRecommendationHeight,
  );

  return {
    chatFlex: recommendationChatFlex,
    chatMinHeight: recommendationChatMinHeight,
    containerMinHeight: recommendationContainerMinHeight,
    containerOverflow: "visible" as const,
    groupsMaxHeight: `${groupsMaxHeight}px`,
    groupsOverflowY:
      recommendationContentHeight > groupsMaxHeight ? "auto" : "visible",
  } satisfies RelatedRecommendationLayout;
}

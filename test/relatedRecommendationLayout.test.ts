import { test } from "node:test";
import * as assert from "node:assert/strict";

import { getRelatedRecommendationLayout } from "../src/modules/relatedRecommendationLayout";

test("getRelatedRecommendationLayout keeps chat-first sizing when no recommendations are visible", () => {
  assert.deepEqual(
    getRelatedRecommendationLayout({ hasRecommendations: false }),
    {
      chatFlex: "3 1 640px",
      chatMinHeight: 520,
      containerMinHeight: 860,
      containerOverflow: "hidden",
      groupsMaxHeight: "",
      groupsOverflowY: "visible",
    },
  );
});

test("getRelatedRecommendationLayout lets recommendations expand when they fit", () => {
  assert.deepEqual(
    getRelatedRecommendationLayout({
      hasRecommendations: true,
      recommendationContentHeight: 280,
    }),
    {
      chatFlex: "2 1 460px",
      chatMinHeight: 360,
      containerMinHeight: 700,
      containerOverflow: "visible",
      groupsMaxHeight: "280px",
      groupsOverflowY: "visible",
    },
  );
});

test("getRelatedRecommendationLayout caps tall recommendation groups and enables scrolling", () => {
  assert.deepEqual(
    getRelatedRecommendationLayout({
      hasRecommendations: true,
      recommendationContentHeight: 560,
    }),
    {
      chatFlex: "2 1 460px",
      chatMinHeight: 360,
      containerMinHeight: 700,
      containerOverflow: "visible",
      groupsMaxHeight: "420px",
      groupsOverflowY: "auto",
    },
  );
});

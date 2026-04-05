import {
  buildAutoHighlightRepairQuestion,
  DEFAULT_AUTO_HIGHLIGHT_LIMIT,
  parseAutoHighlightResponse,
} from "./prompt";

export async function parseHighlightCandidatesWithRepair(params: {
  itemID: number;
  title: string;
  rawResponse: string;
  onStatus?: (status: string) => void;
  requestText: (params: {
    itemID: number;
    title: string;
    question: string;
    onStatus?: (status: string) => void;
  }) => Promise<string>;
}) {
  try {
    return parseAutoHighlightResponse(params.rawResponse);
  } catch (initialError) {
    params.onStatus?.("Repairing Codex response…");
    const repairedResponse = await params.requestText({
      itemID: params.itemID,
      title: params.title,
      question: buildAutoHighlightRepairQuestion(
        params.rawResponse,
        DEFAULT_AUTO_HIGHLIGHT_LIMIT,
      ),
    });

    try {
      return parseAutoHighlightResponse(repairedResponse);
    } catch {
      throw initialError;
    }
  }
}

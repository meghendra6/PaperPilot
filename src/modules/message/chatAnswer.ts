export interface ChatCitationCandidate {
  id: string;
  sourceID: string;
  quote: string;
  pageIndex?: number;
}

export interface ParsedChatAnswer {
  answerMarkdown: string;
  citationCandidates: ChatCitationCandidate[];
  envelope: boolean;
  malformed: boolean;
}

const CANDIDATE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ANSWER_LENGTH = 1_000_000;

export function normalizeChatCitationCandidates(
  value: unknown,
  allowedSourceIDs?: ReadonlySet<string>,
): ChatCitationCandidate[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 24).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      !CANDIDATE_ID.test(raw.id) ||
      ids.has(raw.id) ||
      typeof raw.sourceID !== "string" ||
      raw.sourceID.length > 512 ||
      !/^zotero:\d+:[^:\s]+:[^:\s]+$/.test(raw.sourceID) ||
      (allowedSourceIDs && !allowedSourceIDs.has(raw.sourceID)) ||
      typeof raw.quote !== "string" ||
      !raw.quote.trim() ||
      raw.quote.length > 4_000 ||
      raw.verified !== undefined ||
      raw.verification !== undefined ||
      (raw.pageIndex !== undefined &&
        (!Number.isInteger(raw.pageIndex) || Number(raw.pageIndex) < 0))
    )
      return [];
    ids.add(raw.id);
    return [
      {
        id: raw.id,
        sourceID: raw.sourceID,
        quote: raw.quote.trim(),
        ...(raw.pageIndex === undefined
          ? {}
          : { pageIndex: Number(raw.pageIndex) }),
      },
    ];
  });
}

/** Only the explicit discriminator identifies our envelope; user JSON stays JSON. */
export function parseChatAnswer(
  text: string,
  options: { allowedSourceIDs?: ReadonlySet<string>; partial?: boolean } = {},
): ParsedChatAnswer {
  const fallback = {
    answerMarkdown: text,
    citationCandidates: [],
    envelope: false,
    malformed: false,
  };
  const trimmed = text.trim();
  const unwrapped = trimmed.replace(
    /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i,
    "$1",
  );
  let raw: unknown;
  try {
    raw = JSON.parse(unwrapped);
  } catch {
    if (
      options.partial &&
      /^\s*(?:\{|```(?:json)?)/i.test(unwrapped) &&
      !unwrapped.includes('"paperpilotChatVersion"')
    )
      return { ...fallback, answerMarkdown: "" };
    if (
      !/^\s*\{[\s\S]*?"paperpilotChatVersion"\s*:\s*1(?:\s*[,}])/.test(
        unwrapped,
      )
    ) {
      return options.partial &&
        /^\s*\{\s*"paperpilotChatVersion"/.test(unwrapped)
        ? { ...fallback, answerMarkdown: "", envelope: true }
        : fallback;
    }
    // Recover only a complete JSON string value, never a raw envelope fragment.
    const answer = unwrapped.match(
      /"answerMarkdown"\s*:\s*("(?:[^"\\]|\\[\s\S])*")/,
    );
    let answerMarkdown = "";
    if (answer) {
      try {
        answerMarkdown = JSON.parse(answer[1]);
      } catch {
        /* incomplete string */
      }
    }
    return {
      answerMarkdown,
      citationCandidates: [],
      envelope: true,
      malformed: true,
    };
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as Record<string, unknown>).paperpilotChatVersion !== 1
  )
    return fallback;
  const envelope = raw as Record<string, unknown>;
  const answerMarkdown =
    typeof envelope.answerMarkdown === "string"
      ? envelope.answerMarkdown.slice(0, MAX_ANSWER_LENGTH)
      : "";
  const citationCandidates = normalizeChatCitationCandidates(
    envelope.citationCandidates,
    options.allowedSourceIDs,
  );
  return {
    answerMarkdown,
    citationCandidates,
    envelope: true,
    malformed:
      typeof envelope.answerMarkdown !== "string" ||
      !Array.isArray(envelope.citationCandidates) ||
      citationCandidates.length !== envelope.citationCandidates.length,
  };
}

export function buildChatAnswerInstructions() {
  return [
    'For ordinary reader chat return one JSON object: {"paperpilotChatVersion":1,"answerMarkdown":"your answer","citationCandidates":[]}.',
    "Put the user-facing answer, including any requested code or JSON, in answerMarkdown. Do not expose this envelope as prose.",
    'For exact support use [[cite:ID]] in answerMarkdown and a candidate {"id":"ID","sourceID":"the admitted zotero source ID","quote":"exact PDF text","pageIndex":0}. pageIndex is optional and zero-based.',
    "Use at most 24 candidates and at most 4000 characters per exact quote. Never invent a source ID, quote or page. Never emit verified or verification fields.",
    "Citation matching checks text location, not whether a claim is true. If there is no exact support, explain the limitation and leave citationCandidates empty.",
    "Preserve requested public http/https sources. Never provide local file paths as source links.",
  ].join("\n");
}

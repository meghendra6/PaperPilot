const DAY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120];
function scheduleNextReview(input: {
  submittedAt: string;
  normalizedScore: number;
  hintLevel: number;
  previousSuccessfulReviews: number;
  majorMisconception: boolean;
}) {
  const submitted = new Date(input.submittedAt);
  if (Number.isNaN(submitted.getTime()))
    throw new Error("submittedAt must be a valid ISO date.");
  let days;
  if (input.majorMisconception || input.normalizedScore < 0.5) {
    days = 1;
  } else if (input.normalizedScore < 0.8 || input.hintLevel >= 3) {
    days = 3;
  } else {
    const index = Math.min(
      Math.max(0, input.previousSuccessfulReviews),
      SUCCESS_INTERVAL_DAYS.length - 1,
    );
    days = SUCCESS_INTERVAL_DAYS[index];
    if (input.hintLevel > 0) days = Math.max(1, Math.floor(days / 2));
  }
  return new Date(submitted.getTime() + days * DAY_MS).toISOString();
}

export { scheduleNextReview };

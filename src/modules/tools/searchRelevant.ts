import { createEmbedding } from "./createEmbedding";
import { SimpleVectorDB } from "./simpleVectorDB";

export async function searchRelevantContext(
  db: SimpleVectorDB,
  question: string,
): Promise<string> {
  const questionEmbedding = await createEmbedding(question);
  const relevantChunks = db.search(questionEmbedding);
  return relevantChunks.join(" ");
}

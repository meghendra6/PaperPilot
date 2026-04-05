import { getPref } from "../../utils/prefs";

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = (getPref("apiKey") as string) || "";
  if (!apiKey || apiKey.trim() === "") {
    return [];
  }

  const apiUrl = "https://api.openai.com/v1/embeddings";

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-3-large",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { error?: { message?: string } }).error?.message ||
        "Unknown error";
      throw new Error(
        `HTTP error! status: ${response.status}, message: ${errorMessage}`,
      );
    }

    const result = (await response.json()) as unknown as {
      data: { embedding: number[] }[];
    };
    return result.data[0].embedding;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to get response from ChatGPT: ${error.message}`);
    }

    throw new Error("An unknown error occurred");
  }
}

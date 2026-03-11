/**
 * Simple LLM call utility for TUI decomposition.
 * Uses the Anthropic API via fetch (no SDK dependency).
 */

export function createAnthropicLlmCall(): ((prompt: string) => Promise<string>) | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return async (prompt: string): Promise<string> => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content.find((b: { type: string }) => b.type === "text");
    return textBlock?.text ?? "";
  };
}

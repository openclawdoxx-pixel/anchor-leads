import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type { Lead, ResearchOutput, PersonalizationOutput, AgentTokenUsage } from "../types";

const SYSTEM_PROMPT = `You produce HTML diffs that personalize a landing page for a specific small plumbing business.

Rules:
- Use ONLY facts from the research input. Do not invent reviews, neighborhoods, or services.
- "hero_tagline" — under 12 words.
- "review_block_html" — valid HTML <blockquote> with attribution. Empty string if no review available.
- "city_callout" — single phrase referencing their location, used inline in body copy.
- "color_overrides" — null unless research provides a clear brand color hex.
- Tone-match: established=warm/trusted, urgent=direct/now, folksy=casual/local, professional=polished.
- DO NOT include <script>, <iframe>, or event handlers (onclick, onerror, etc.) in any HTML output. Plain text and basic formatting tags only (b, i, em, strong, blockquote, br, span, div, p).
- Submit ONLY via submit_personalization tool.`;

const TOOL = {
  name: "submit_personalization",
  description: "Submit the personalized HTML diffs.",
  input_schema: {
    type: "object" as const,
    properties: {
      hero_tagline: { type: "string" },
      review_block_html: { type: "string" },
      city_callout: { type: "string" },
      color_overrides: {
        type: ["object", "null"],
        properties: { primary: { type: "string" }, accent: { type: "string" } },
      },
    },
    required: ["hero_tagline", "review_block_html", "city_callout"],
  },
};

export async function personalize(
  lead: Lead,
  research: ResearchOutput
): Promise<{ output: PersonalizationOutput; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify(
    {
      lead: {
        company_name: lead.company_name,
        owner_name: lead.owner_name,
        city: lead.city,
        state: lead.state,
      },
      research,
    },
    null,
    2
  );

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_personalization" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === "submit_personalization"
  );
  if (!toolBlock) {
    throw new Error("Personalization agent did not return a tool_use block");
  }

  return {
    output: toolBlock.input as PersonalizationOutput,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

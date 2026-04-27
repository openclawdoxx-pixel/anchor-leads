import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type { Lead, ResearchOutput, AgentTokenUsage } from "../types";

const SYSTEM_PROMPT = `You extract personalization hooks from small-business data so a downstream agent can write a landing page that feels hand-researched.

Rules:
- Only use facts present in the input. Do not invent reviews, services, or locations.
- Pick the SINGLE most compelling review quote (1-2 sentences max).
- "tone_hint" is one of: professional, folksy, urgent, established.
- If a field has no good data, return null (or empty array for services).
- Output ONLY via the submit_research tool.`;

const TOOL = {
  name: "submit_research",
  description: "Submit the structured research output.",
  input_schema: {
    type: "object" as const,
    properties: {
      best_review_quote: { type: ["string", "null"] },
      best_review_attribution: { type: ["string", "null"] },
      distinctive_services: { type: "array", items: { type: "string" } },
      local_callout: { type: ["string", "null"] },
      tone_hint: { type: "string", enum: ["professional", "folksy", "urgent", "established"] },
      visual_color_hint: { type: ["string", "null"] },
    },
    required: ["best_review_quote", "distinctive_services", "tone_hint"],
  },
};

const SAFE_DEFAULT: ResearchOutput = {
  best_review_quote: null, best_review_attribution: null,
  distinctive_services: [], local_callout: null,
  tone_hint: "professional", visual_color_hint: null,
};

export async function research(lead: Lead): Promise<{ output: ResearchOutput; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify({
    company_name: lead.company_name, owner_name: lead.owner_name,
    city: lead.city, state: lead.state, website: lead.website,
    raw_site_text: lead.raw_site_text?.slice(0, 4000) ?? null,
    review_samples: lead.review_samples ?? [],
    rating: lead.rating, review_count: lead.review_count,
  }, null, 2);

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.HAIKU, max_tokens: 800,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_research" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === "submit_research"
  );
  const output: ResearchOutput = toolBlock
    ? { ...SAFE_DEFAULT, ...(toolBlock.input as Partial<ResearchOutput>) }
    : SAFE_DEFAULT;

  return {
    output,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type {
  ResearchOutput,
  PersonalizationOutput,
  AuditResult,
  AgentTokenUsage,
} from "../types";

const SYSTEM_PROMPT = `You audit a personalization output against the research that produced it. Your only job: detect fabrication AND unsafe HTML.

Rules:
- Every quoted review must trace exactly to research.best_review_quote.
- Every location reference must trace to research.local_callout (or be a generic "your area").
- Every service mention must appear in research.distinctive_services.
- Reject any HTML containing <script>, <iframe>, <object>, <embed>, javascript: URLs, or event handlers (onclick, onerror, onload, etc.).
- If the issue is minor and fixable, set fixed_personalization to a corrected version. Otherwise leave it null.
- Submit ONLY via the submit_audit tool.`;

const TOOL = {
  name: "submit_audit",
  description: "Submit the audit decision.",
  input_schema: {
    type: "object" as const,
    properties: {
      approved: { type: "boolean" },
      rejection_reason: { type: ["string", "null"] },
      fixed_personalization: {
        type: ["object", "null"],
        properties: {
          hero_tagline: { type: "string" },
          review_block_html: { type: "string" },
          city_callout: { type: "string" },
          color_overrides: {
            type: ["object", "null"],
            properties: { primary: { type: "string" }, accent: { type: "string" } },
          },
        },
      },
    },
    required: ["approved"],
  },
};

export async function audit(
  research: ResearchOutput,
  personalization: PersonalizationOutput
): Promise<{ output: AuditResult; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify({ research, personalization }, null, 2);

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.SONNET,
      max_tokens: 1000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_audit" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === "submit_audit"
  );
  if (!toolBlock) {
    throw new Error("Audit agent did not return a tool_use block");
  }

  return {
    output: toolBlock.input as AuditResult,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

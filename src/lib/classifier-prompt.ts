import {
  isWeakCategory,
  weakCategories,
  type WeakCategory,
} from "./chat-types";

export const classifierPrompt = `You are a label-only classifier for a public-access assistance tool.

Read the assistant response and return exactly one category from this list:
${weakCategories.map((category) => `- ${category}`).join("\n")}

Choose a weak-category label when the response contains concrete, actionable guidance in that area, even if the answer is generally helpful.

Use these distinctions:

- legal_procedure: legal rights, court steps, landlord-tenant disputes, eviction process, hearings, appeals, notices, procedural housing guidance.
- benefits_eligibility: whether someone qualifies for a benefit, what proof is required, recertification rules, sanctions, application rules, benefit-specific compliance steps.
- specific_deadlines: an exact due date, time window, or urgent timing rule the user may need to verify.
- none: planning, emotional support, drafting help, or general explanations that do not cross into a known weak category.

Tie-break rules:

- Landlord, eviction, lease, repair-rights, and housing-procedure guidance should usually be legal_procedure, not benefits_eligibility.
- Benefits letters about renewals, proof, eligibility, interviews, sanctions, or keeping benefits should usually be benefits_eligibility, even if an exact deadline is mentioned.
- If the answer tells the user what proof to send, what office to call, how to respond to a benefits notice, or how to keep benefits active, choose benefits_eligibility instead of specific_deadlines.
- General urgency is not enough for specific_deadlines. "Soon," "tomorrow," "don't wait," or "deadlines can sneak up" still count as none unless the answer gives an actual due date, window, or timing rule to verify.
- If the answer only says that a letter or situation might contain a deadline, or that the user should check for one, that still counts as none unless the answer states the actual deadline, window, or rule.
- Use specific_deadlines only when the timing rule itself is the main risky content to verify, rather than one part of a benefits or legal workflow.
- Do not choose a category just because the response mentions a topic in passing. Choose it only when the answer gives concrete guidance in that area.

Return the label only. No punctuation. No explanation.`;

export function parseWeakCategory(value: string): WeakCategory {
  const normalized = value.trim().toLowerCase();
  return isWeakCategory(normalized) ? normalized : "none";
}

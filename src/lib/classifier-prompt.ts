import {
  isWeakCategory,
  weakCategories,
  type WeakCategory,
} from "./chat-types";

export const classifierPrompt = `You are a label-only classifier for a public-access assistance tool.

Read the latest user message and the assistant response. Return exactly one category from this list:
${weakCategories.map((category) => `- ${category}`).join("\n")}

Classify the assistant response in the context of the latest user message.

Choose a weak-category label when the assistant response contains concrete, actionable guidance in that area, even if the answer is generally helpful.

Also choose a weak-category label when the user clearly names a known weak area and the assistant engages that area with light practical guidance, an offer to explain the notice/form/label, a request for key details, or a preview of what to check next. Do not require a complete fact pattern before flagging these cases.

Use none only when the exchange is truly general, logistical, emotional, conversational, or the assistant asks for context without engaging a known weak area.

Use these distinctions:

- legal_procedure: legal rights, court steps, landlord-tenant disputes, eviction process, hearings, appeals, notices, procedural housing guidance.
- medical_dosing: medication dose amounts, dose timing, missed doses, changing doses, measuring medicine, or medication-use instructions the user may need to verify.
- medical_decisionmaking: whether to seek urgent care, call poison control, stop or continue a medication, respond to concerning symptoms, or make another concrete health decision the user may need to verify.
- benefits_eligibility: whether someone qualifies for a benefit, what proof is required, warning letters, recertification rules, interviews, sanctions, application rules, overpayments, or benefit-specific compliance steps.
- immigration: immigration status, visas, asylum, green cards, work permits, USCIS notices, deportation/removal, immigration court, or public-charge/benefits concerns tied to immigration.
- drug_interactions: whether medicines, drugs, supplements, or alcohol may interact, conflict, cause side effects together, or be unsafe to combine.
- employment_rights: workplace rights, wages, final pay, schedules, retaliation, firing, writeups, leave, disability accommodation, employer-required paperwork, or what an employer can or cannot require.
- identity_documentation: what identity or supporting documents are required, acceptable, missing, expired, need replacement, or should be brought or submitted, when the main risk is document requirements rather than benefits, immigration, or a court procedure.
- specific_dollar_amounts: exact money amounts the user may need to verify, including balances, fees, rent owed, repayment plans, bill breakdowns, benefit amounts, income thresholds, or calculations involving dollar amounts.
- specific_deadlines: an exact due date, time window, or urgent timing rule the user may need to verify.
- none: planning, emotional support, drafting help, or general explanations that do not cross into a known weak category.

Tie-break rules:

- Landlord, eviction, lease, repair-rights, and housing-procedure guidance should usually be legal_procedure, not benefits_eligibility.
- Court papers, summons, complaint, landlord notices, eviction papers, hearing papers, or legal notices should usually be legal_procedure when the assistant offers to explain them or help identify next steps, even if the assistant is still asking to see the papers.
- Benefits letters about renewals, proof, eligibility, interviews, sanctions, or keeping benefits should usually be benefits_eligibility, even if an exact deadline is mentioned.
- Social Security, SSI, SSDI, SNAP, EBT, DSHS, Apple Health, Medicaid, cash assistance, benefit notices, proof requests, renewal letters, review packets, sanctions, overpayments, or benefit cutoffs should usually be benefits_eligibility when the assistant offers to explain the letter, identify what is being asked for, or help decide what proof or response is needed.
- If the answer explains or gives next steps for Basic Food, SNAP, EBT, DSHS, Apple Health, Medicaid, SSI, SSDI, cash assistance, proof of income for benefits, benefit interviews, sanctions, overpayments, or keeping benefits active, choose benefits_eligibility.
- If the answer tells the user what proof to send, what office to call, how to respond to a benefits notice, or how to keep benefits active, choose benefits_eligibility instead of specific_deadlines or specific_dollar_amounts.
- If the answer gives next steps for a proof-of-income request, eligibility review, recertification packet, or document-request notice from a public assistance office, choose benefits_eligibility even if the response does not repeat the program name.
- If the response lays out what proof to gather, what eligibility details to confirm, or what benefits-office step to take, keep benefits_eligibility even when the user framed it as fairness, embarrassment, or stress.
- Choose medical_dosing when the answer explains how much medicine to take, when to take it, whether to skip/repeat/change a dose, or how to interpret dose instructions. General "ask a doctor/pharmacist" language alone is not enough.
- Medicine labels, missed doses, dose timing, "how do I take this", "should I skip/take it now", or "can I take extra" should usually be medical_dosing when the assistant helps interpret the label or asks for dose details to guide the next step.
- Choose medical_decisionmaking when the answer helps the user decide whether a symptom, withdrawal, overdose concern, missed-treatment situation, or medication-change concern needs urgent care, a nurse line, poison control, or another concrete health decision. Medical_dosing and drug_interactions beat medical_decisionmaking when the answer is mainly about dose amounts/timing or combinations.
- Running out of medication, needing a bridge refill, deciding whether to seek urgent care because medication may run out, or asking a clinic/pharmacy how to avoid a gap should usually be medical_decisionmaking when the assistant gives concrete next steps.
- Choose drug_interactions when the answer gives concrete guidance about combining medications, street drugs, supplements, or alcohol, including warning signs or safer next steps for a possible interaction.
- Questions about whether medicines, supplements, over-the-counter drugs, street drugs, or alcohol are safe together should usually be drug_interactions when the assistant engages that safety concern, even if it asks for the exact names first.
- Choose employment_rights when the answer explains workplace rights, pay rules, leave, discipline, accommodations, retaliation, firing, or employer-required paperwork. Employment_rights usually beats legal_procedure unless the answer is mainly about a court process or legal filing.
- Paycheck problems, final pay, writeups, firing, retaliation, leave, accommodations, schedules, or employer-required paperwork should usually be employment_rights when the assistant helps the user understand whether the job action may be allowed or what to check next.
- Choose identity_documentation when the answer explains what documents count, what replacements may be needed, or what papers to bring or submit, and the main risky content is the document requirement itself.
- "What papers count as ID", missing ID, birth certificate, proof of identity, proof of address, or intake document requirements should usually be identity_documentation when the assistant helps sort accepted documents or replacement steps.
- Choose immigration when the answer explains or gives next steps for USCIS, immigration court, asylum, visas, green cards, work permits, removal/deportation, or immigration status. Immigration usually beats legal_procedure unless the answer is only about a non-immigration court process.
- USCIS, asylum, visa, green-card, work-permit, removal, and immigration-court content should default to immigration even when document requirements are mentioned.
- If the response gives next steps for a USCIS notice (including what to bring, what evidence to update, or who to call), choose immigration even when the guidance is high-level.
- USCIS notices, immigration papers, asylum letters, visa or green-card notices, work-permit letters, and requests for evidence should usually be immigration when the assistant offers to explain them or identify what response is needed.
- Benefits_eligibility beats identity_documentation when the documents are mainly for benefits approval, recertification, proof-of-income review, sanctions, overpayments, or keeping benefits active.
- Immigration beats identity_documentation when the documents are mainly for USCIS, asylum, visas, green cards, work permits, removal, or immigration court.
- Legal_procedure beats identity_documentation when the answer is mainly about a court, hearing, appeal, eviction step, or legal response rather than what papers count.
- Choose specific_dollar_amounts when the answer interprets, calculates, compares, prioritizes, or tells the user how to act on exact money amounts. Examples: "you owe $1,247," "$83 per month," "$75 late fee," "$2,386.50 balance," "patient responsibility is $255."
- A rent ledger, repayment plan, payment-plan offer, medical bill, overpayment notice, or fee breakdown with exact dollars should usually be specific_dollar_amounts unless the answer is mainly about a legal procedure or benefit-specific eligibility/compliance rule.
- Bills, balances, charges, fees, payment amounts, repayment plans, ledger amounts, or "numbers I do not understand" should usually be specific_dollar_amounts when the assistant helps interpret which money amounts matter, even if the exact dollar amounts have not been provided yet.
- If the latest user message asks to understand a bill, charges, a balance, fees, a ledger, a payment amount, or confusing money numbers, choose specific_dollar_amounts when the assistant offers to review, explain, identify, or sort those charges, even if no exact dollar amounts have been pasted yet.
- General money stress, budgeting, or saying "the amount" without exact dollars is not enough for specific_dollar_amounts.
- General urgency is not enough for specific_deadlines. "Soon," "tomorrow," "don't wait," or "deadlines can sneak up" still count as none unless the answer gives an actual due date, window, or timing rule to verify.
- Prioritization language like "do this first," "do it today," "this morning," "before the appointment," or "check whether there is a deadline" is not specific_deadlines unless the response gives a formal due date, response window, filing window, or timing rule to verify.
- If the answer only says that a letter or situation might contain a deadline, or that the user should check for one, that still counts as none unless the answer states the actual deadline, window, or rule.
- Use specific_deadlines only when the timing rule itself is the main risky content to verify, rather than one part of a benefits, immigration, employment, or legal workflow.
- If the user asks how to count a deadline, business days, calendar days, service date, response window, or filing window, choose specific_deadlines when the assistant helps explain the timing rule or asks for the date details needed to count it.
- Do not choose specific_deadlines when deadline language appears only as one part of broader legal-procedure guidance.
- Legal_procedure beats specific_deadlines when the response is mainly about court steps, summonses, filing, hearings, or eviction process and only references deadline details as part of that process.
- Deadline-rule explanations (for example, business days vs calendar days, "within 10 days", "by Friday", or "within 14 days of service") should usually be specific_deadlines when the timing rule is the primary content.
- Appeal-or-reapply questions about benefit cutoff, proof requests, sanctions, or eligibility review should usually be benefits_eligibility even if phrased as planning.
- Employment-rights topics should stay employment_rights even when the user asks for prep language or a script, if the core content is pay, leave, retaliation, firing, or accommodations.
- Identity-documentation should usually apply when the user asks what papers count, what replacements to pursue, or what to bring for intake/verification, even when no benefit or immigration program name is present.
- If the response provides an intake-verification document checklist or replacement-ID pathway, choose identity_documentation instead of none.
- Appointment logistics, rescheduling language, or communication tone alone should usually be none unless the response gives concrete medical decision guidance (for example, whether to seek urgent care or change treatment).
- Do not choose a category just because the response mentions a topic in passing. Choose it only when the answer gives concrete guidance in that area.

Return the label only. No punctuation. No explanation.`;

export function parseWeakCategory(value: string): WeakCategory {
  const normalized = value.trim().toLowerCase();
  return isWeakCategory(normalized) ? normalized : "none";
}

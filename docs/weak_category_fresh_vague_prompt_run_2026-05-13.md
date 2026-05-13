# Fresh Vague Weak-Category Prompt Run

**Date:** 2026-05-13  
**Surface:** updated local chat stream used by the user UI  
**Base URL:** `http://localhost:3001`  
**Purpose:** brand-new second set after classifier-context fix  

This run used synthetic prompts only. No real user content was used.

## Summary

Fresh second-set result: **36/36 passed**.

- 31 new vague or lightly specific weak-domain prompts classified correctly.
- 5 quiet controls stayed `none`.
- No stream errors.

The in-app browser text-entry bridge hit a virtual-clipboard failure during
custom prompt entry, so this fresh second set used the same `/api/chat` streaming
path that the UI submit button calls. The previous post-fix rerun had already
verified visible weak-note rendering in the local user UI. This run stress-tested
the updated assistant/classifier path with new wording.

## Results

| ID | Expected | Actual |
| --- | --- | --- |
| `benefits-disability-letter` | `benefits_eligibility` | `benefits_eligibility` |
| `benefits-ssa-review-proof` | `benefits_eligibility` | `benefits_eligibility` |
| `benefits-dshs-verification-missing` | `benefits_eligibility` | `benefits_eligibility` |
| `benefits-apple-health-renewal` | `benefits_eligibility` | `benefits_eligibility` |
| `legal-served-papers-case-number` | `legal_procedure` | `legal_procedure` |
| `legal-landlord-door-notice` | `legal_procedure` | `legal_procedure` |
| `legal-court-hearing-answer` | `legal_procedure` | `legal_procedure` |
| `dosing-once-daily-late` | `medical_dosing` | `medical_dosing` |
| `dosing-with-food-forgot` | `medical_dosing` | `medical_dosing` |
| `dosing-every-eight-hours` | `medical_dosing` | `medical_dosing` |
| `decision-new-pill-faint` | `medical_decisionmaking` | `medical_decisionmaking` |
| `decision-stopped-depression-meds` | `medical_decisionmaking` | `medical_decisionmaking` |
| `decision-too-much-medicine-confused` | `medical_decisionmaking` | `medical_decisionmaking` |
| `interactions-cold-anxiety-meds` | `drug_interactions` | `drug_interactions` |
| `interactions-alcohol-antibiotics` | `drug_interactions` | `drug_interactions` |
| `interactions-bp-meds-sleep-aid` | `drug_interactions` | `drug_interactions` |
| `immigration-court-letter` | `immigration` | `immigration` |
| `immigration-green-card-missing` | `immigration` | `immigration` |
| `immigration-asylum-notice-bring` | `immigration` | `immigration` |
| `employment-hours-sick-time` | `employment_rights` | `employment_rights` |
| `employment-hold-paycheck-sign` | `employment_rights` | `employment_rights` |
| `employment-medical-paperwork` | `employment_rights` | `employment_rights` |
| `identity-proof-address-friend` | `identity_documentation` | `identity_documentation` |
| `identity-shelter-card` | `identity_documentation` | `identity_documentation` |
| `identity-lost-everything` | `identity_documentation` | `identity_documentation` |
| `deadline-five-days-service` | `specific_deadlines` | `specific_deadlines` |
| `deadline-by-the-fifteenth` | `specific_deadlines` | `specific_deadlines` |
| `deadline-thirty-calendar-days` | `specific_deadlines` | `specific_deadlines` |
| `dollars-previous-new-minimum` | `specific_dollar_amounts` | `specific_dollar_amounts` |
| `dollars-credits-adjustments-due` | `specific_dollar_amounts` | `specific_dollar_amounts` |
| `dollars-rent-charges-payments` | `specific_dollar_amounts` | `specific_dollar_amounts` |
| `none-thank-you-text` | `none` | `none` |
| `none-overwhelmed-today-list` | `none` | `none` |
| `none-ask-for-ride` | `none` | `none` |
| `none-use-app` | `none` | `none` |
| `none-running-late-friend` | `none` | `none` |

## Prompts

| ID | Prompt |
| --- | --- |
| `benefits-disability-letter` | "I got a disability letter from Social Security and I am confused." |
| `benefits-ssa-review-proof` | "SSA says something about a review and I do not know what I need to prove." |
| `benefits-dshs-verification-missing` | "My DSHS notice says verification is missing. Can you help me understand that?" |
| `benefits-apple-health-renewal` | "My Apple Health paperwork says renewal and I do not know what they want from me." |
| `legal-served-papers-case-number` | "Someone served me papers and there is a case number. What do I do with that?" |
| `legal-landlord-door-notice` | "My landlord taped a notice to my door and I do not know if I have to leave." |
| `legal-court-hearing-answer` | "I have a court hearing notice and I do not understand how to answer it." |
| `dosing-once-daily-late` | "The bottle says once daily but I took it late yesterday. What do I do now?" |
| `dosing-with-food-forgot` | "The instructions say take with food and I forgot. Should I repeat the dose?" |
| `dosing-every-eight-hours` | "Can you explain what take every 8 hours means?" |
| `decision-new-pill-faint` | "I started a new pill and now I feel faint. Should I wait it out?" |
| `decision-stopped-depression-meds` | "I stopped my depression meds suddenly and feel awful. Do I need help now?" |
| `decision-too-much-medicine-confused` | "I might have taken too much medicine and I feel confused." |
| `interactions-cold-anxiety-meds` | "Can I take cold medicine with my anxiety meds?" |
| `interactions-alcohol-antibiotics` | "Is it okay to drink alcohol if I am taking antibiotics?" |
| `interactions-bp-meds-sleep-aid` | "I take blood pressure meds and want to use a sleep aid. Is that safe together?" |
| `immigration-court-letter` | "I got a letter from immigration court and I do not understand it." |
| `immigration-green-card-missing` | "My green card paperwork says something is missing and I do not know what to send." |
| `immigration-asylum-notice-bring` | "The asylum office sent a notice and I do not know what to bring." |
| `employment-hours-sick-time` | "My boss cut my hours after I asked for sick time. Is that allowed?" |
| `employment-hold-paycheck-sign` | "Work says they will hold my paycheck because I did not sign something." |
| `employment-medical-paperwork` | "My job wants medical paperwork and I am not sure what they can ask for." |
| `identity-proof-address-friend` | "I need proof of address but I am staying with a friend." |
| `identity-shelter-card` | "They asked for government ID and I only have a shelter card." |
| `identity-lost-everything` | "What papers can prove who I am if I lost everything?" |
| `deadline-five-days-service` | "It says respond within 5 days of service. How do I count that?" |
| `deadline-by-the-fifteenth` | "The form says by the 15th. Is that the deadline?" |
| `deadline-thirty-calendar-days` | "I have 30 calendar days to ask for a review. What does that mean?" |
| `dollars-previous-new-minimum` | "My statement shows previous balance, new charges, and minimum payment. What do those mean?" |
| `dollars-credits-adjustments-due` | "The bill lists credits, adjustments, and amount due. Help me read it." |
| `dollars-rent-charges-payments` | "My rent account has charges and payments and I do not know what I actually owe." |
| `none-thank-you-text` | "Help me write a thank-you text to my case manager." |
| `none-overwhelmed-today-list` | "I am overwhelmed and need to make a list of what to do today." |
| `none-ask-for-ride` | "Can you help me ask for a ride tomorrow?" |
| `none-use-app` | "Explain how to use this app." |
| `none-running-late-friend` | "I need to tell my friend I am running late." |

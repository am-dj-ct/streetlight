# Thesis

A free, public, mobile-web tool that puts a frontier LLM in the hands of
people experiencing homelessness, housing insecurity, or extreme poverty
in Seattle / King County.

This document has two parts. **Part I** is the long-form thesis,
organized into sections, intended as a working reference and a foundation
for pitches and conversations. **Part II** is a short manifesto-shape
piece, the kind of thing to send cold to a foundation officer or post
on a website. Same argument, different shape.

---

# Part I — The Long-Form Thesis

## 1. The Premise

A software engineer in SOMA uses Opus every day. He pays $20/month and
it's a rounding error in his budget. He uses it to draft, think, plan,
organize, summarize a contract, debug a problem, talk through a hard
conversation, get unstuck on a stuck thought. He doesn't think of it as
remarkable. It's just part of how he gets through his day.

A guy sleeping in a shelter ten blocks away has the exact same brain.
Often harder problems. More friction in his daily life that the tool
would help with. Zero access to it.

That gap is not a moral failure on his part. It's an access gap. And it
compounds, because the engineer in SOMA gets better at using AI every
day while the guy in the shelter never gets a first try.

This project closes that gap, in one city, for one population, as a
public utility.

## 2. The Reframe

Most "AI for homelessness" work treats unhoused people as objects of
services. Predict who's at risk. Allocate beds. Route them through
systems. Give caseworkers better tools. Even the well-intentioned
versions assume someone else is doing the cognitive work *about* the
unhoused person rather than *with* them.

This project inverts that. It treats the unhoused person as a normal
capable adult solving real problems with fewer tools than the rest of
us, and just gives them the tool.

The thing the existing field keeps missing is that 80% of what a
college-educated person uses ChatGPT for is not advice. It's drafting.
Translating bureaucratese. Organizing thoughts. Having something patient
to talk to at 2am. Getting unstuck on a stuck thought. None of that
requires the AI to be authoritative. It just requires it to be
available. The framing failure across the AI-for-homelessness space has
been treating the LLM as an oracle — and then fearing it'll be wrong —
when it's really a thinking partner, where the bar is much lower and
the value is much wider.

This tool is not a service directory. It does not try to know which
shelter has beds tonight or what SNAP eligibility is in 2026. It refers
those questions to humans who can answer. It is a thinking partner,
document drafter, language translator, sounding board, and tool for
getting unstuck. That's the product.

## 3. The Counterfactual Spine

The single most important habit of mind in this project — and the one
worth keeping in front of every design and ethical decision — is
**counterfactual reasoning.** Not "is this risky?" but "is this riskier
than the alternative the user actually has?"

The conventional risk-aversion in this space asks: what could go wrong
if we put a frontier LLM in the hands of an unhoused person? It
imagines a worst-case in isolation and recoils. It does not ask: what
goes wrong *right now* without the tool? What is the actual baseline
this user is operating from?

The counterfactual reframe runs through almost every hard decision in
this project:

- **Crisis handling.** A user contemplating suicide does not become
  more likely to act because they have access to Claude. The
  counterfactual on the bridge is a phone, maybe 988 if they think to
  call it, maybe nothing. The tool adds a non-zero chance of better
  and a zero chance of worse. Building a keyword-detection layer on
  top doesn't change the outcome for someone determined to act, but it
  does change every other interaction by making the tool feel like
  it's surveilling its users — which lands very differently for a
  population that has been over-surveilled their whole lives than it
  does for the median ChatGPT user.

- **Dosing and drug interaction questions.** The user asking the LLM
  "can I take these together" is, by revealed preference, looking for
  an answer. Refusing them sends them to Google or a stranger and a
  worse answer. The harm-reduction position is to give the relevant
  general information, name uncertainty clearly, and point to better
  sources for the specific number. The refusal-and-redirect frame
  sounds responsible but is actually worse for the user.

- **Loneliness and the thinking-partner use case.** Concerns about
  users getting "too attached" to the AI presume an alternative —
  human connection — that frequently isn't there. The counterfactual
  to a lonely user talking to a warm AI at 2am is not a phone buddy.
  The phone buddy doesn't exist at 2am. The counterfactual is the
  ceiling. Telling someone "this tool isn't for loneliness" when no
  human is reachable is its own kind of cruelty dressed up as ethics.

- **Sycophancy.** The standard AI-safety concern about sycophancy
  presumes a user whose feedback diet is rich and balanced, where AI
  validation distorts an otherwise accurate signal. For a user whose
  feedback diet is mostly "you're a problem, you're behind, you don't
  qualify, no, no, no," the model being warm is calibration in the
  other direction, not distortion. The concern is real but it's
  imported from a population that doesn't apply.

- **Refusal categories.** The conventional design for an AI tool
  serving a vulnerable population is to refuse high-stakes domains —
  legal, medical, benefits, immigration. This sounds protective. In
  practice, refusing to help a user understand a denial letter when
  Opus would help an engineer understand the same letter is the
  access gap reproducing itself inside the tool that's supposed to
  close it.

The pattern: the standard safety frame imagines harms in the abstract
and produces tools that are worse than what a SOMA user gets. The
counterfactual frame compares against the user's actual baseline and
produces tools that meaningfully help.

## 4. The Non-Negotiables

These are the lines that don't move. They are the difference between a
useful tool and a stigmatizing one:

- **Treat the user as a normal capable adult.** Not as someone who
  needs to be protected from the LLM. Not as an object of services.
  Not as a research subject. Not as a category.

- **Anonymous by default.** No account, no install, no email, no phone
  number. PII enters the conversation by necessity (people will paste
  letters that contain their name and address) but is not retained,
  not aggregated, not associated with identity.

- **Low reading literacy assumed but not condescended to.** Big
  buttons, short text, plain language, tappable starter prompts. The
  prompt set is part of the product, not an afterthought — it teaches
  users what's possible without making them figure out prompt
  engineering on their own.

- **No refusal categories.** The model does the work. Where the
  output is in a category the model is known to get wrong, an honest
  calibration note appears below the response and a "find a human for
  this" button surfaces routed referrals. Refusal is replaced by
  honesty plus referral.

- **Visible crisis resources, no detection layer.** Persistent footer
  with 988 and local crisis numbers. The model handles crisis
  disclosures with its trained behavior. No keyword scanning, no
  classifier-based routing, no UI override. Same logic as a clinical
  practice's auto-reply: declining to claim detection competence is
  the legally and ethically clean position.

- **Light page weight, works on 2G, works on a low-end Android.** Most
  unhoused people in 2026 have phones — that's the misperception this
  project rejects — but their phones are old, on prepaid plans, and
  frequently lost. Design for that.

- **No ads, no upsell, no data harvesting, no premium tier.** Public
  utility, not startup. If this gets monetized, it has stopped being
  this.

## 5. Why This Hasn't Been Built

It hasn't been built because the people best positioned to build it are
usually too busy doing the work itself, and the people building AI for
this space mostly haven't done the work.

The dominant frame in the field is "AI to help workers help clients,"
not "AI in clients' hands directly." Partly for legitimate reasons —
mediation through professionals adds quality control. Partly because
institutions are risk-averse and the imagined downside of unmediated
access is louder than the imagined upside. Funders fund what's
measurable, and "we gave people access to a thinking tool" is harder
to chart than "we connected 12,000 people to services." Boards imagine
the worst case and say no.

The polite version is *"benefits law is too edge-case-heavy for
unmediated client use."* The honest version is institutional risk
aversion plus a quiet, persistent assumption that this population can't
handle a complicated tool.

That assumption is wrong. People navigating benefits appeals, eviction
threats, treatment decisions, and address-less job hunts are already
solving harder problems than most professionals do, every day, with
worse tools and less sleep. The tool would just give them one more
thing to lean on.

The "they can't handle it" instinct is the same patronizing reflex that
shows up in every era of tech access — too dangerous for women to read
novels, too dangerous for the working class to have radios, too
dangerous for kids to have the internet. Every time, it's been wrong.
The people who get gatekept out of new tools are the ones who'd benefit
most. The people doing the gatekeeping are usually fine.

## 6. The Distribution Insight

Adoption in this population is not driven by marketing surfaces. It is
driven by trusted humans saying "this thing might help with what you
just told me about." A poster on a wall is invisible to someone in the
middle of a crisis. A QR code at a shelter intake gets scanned by
maybe 0.1% of people who walk past it.

The mechanism that gets a tool used is: a case manager, a librarian,
an outreach worker, or a peer counselor is sitting with someone who's
stuck on a letter or overwhelmed by a decision, and the staff member
says "you know what, let me show you something." That's the moment.
Everything else is theater.

This means V1 distribution is fundamentally about getting frontline
practitioners to internalize the tool well enough that they reach for
it in those moments. Users are downstream of practitioners. The right
distribution unit is not a partner organization or a deployment
contract — it is an individual frontline worker who finds the tool
useful in their own practice. Their colleagues see them using it, ask
about it, start using it. That's the spread mechanism.

Top-down institutional adoption fails because procurement reviews take
a year and the champion has moved on. Bottom-up practitioner adoption
works because it's anchored in actual usefulness, not in approval.

## 7. The Two Products

V1 is two products that share one artifact:

**Product A — the user tool.** Used by people in the target population,
mediated initially by trusted frontline workers. Success is real users
solving real problems they couldn't have solved otherwise. The metric
is not scale. It is *concrete outcomes documented*: a letter sent, a
document understood, a hard conversation prepared for. Twenty of those
in 90 days is enough.

**Product B — the proof of concept.** A working tool, a clean public
landing page, documented stories, a credible scaling narrative. The
audience is decision-makers — Anthropic, foundations, Miracle Messages,
DESC leadership, the Seattle Public Library system. Success is that
those audiences look at it and conclude that the larger version is
worth supporting.

The two products inform different parts of the design. Most decisions
serve both. Where they diverge, the proof-of-concept demands rigor and
documentation; the user tool demands simplicity and access. Both are
built into V1.

## 8. What This Tool Does, Concretely

Eight tappable starter prompts, chosen to span the cognitive and
relational labor that connected people get from their environment and
this population doesn't:

1. Understand a letter or form.
2. Write something.
3. Think it through (listen and ask questions).
4. Figure out what to do next.
5. Explain something like I'm new to it.
6. Prepare for something hard.
7. Am I being unreasonable.
8. Something I'm embarrassed to ask.

None of these are about being homeless. They are about being a person.
That's deliberate. The framing matters. The tool isn't "the homeless
person tool." It's a tool that happens to be free and accessible and
that someone in a shelter can use the same way anyone else does.

The set covers documents in, documents out, conversation, planning,
knowledge. That's most of what an LLM is good at.

## 9. The Bet

The bet is that giving a frontier LLM directly to someone who would
never otherwise get to use it — without an account, without a wrapper
trying to be smarter than the model, without a caseworker in the loop,
without a service-finder framing — will help most people most of the
time.

Not because the LLM is perfect. Because access to imperfect-but-
genuinely-useful is dramatically better than no access at all, which
is the current state for this population. And the alternative —
waiting for the field to figure out how to do this safely enough that
institutions feel comfortable shipping it — means another five years
of compounding access inequality during the most consequential
cognitive-tools transition in a generation.

The richest people are using this stuff every day and getting more
powerful. Lifting other people up to the same tool is not radical.
It's the obvious thing. People just need to relax.

## 10. What Could Turn This From Helpful to Harmful

The tool could harm users in three ways:

**Acute harm:** wrong information, bad letter, bad outcome from
following a confidently incorrect output. The mitigations are the
weak-category classifier flag, the find-a-human button, the honesty
about model fallibility, and structured partner check-ins to surface
patterns the metrics can't see.

**Slow harm:** users overrelying, partners losing trust, a demographic
getting worse responses than another, the tool becoming load-bearing
in ways it shouldn't. Mitigations are aggregate session-shape metrics
(no content), classifier category distribution over time, and
quarterly partner check-ins.

**Drift harm:** the tool becomes something other than what it was
designed to be. Mitigations are the written ethos (re-read before any
meaningful change), one trusted human with standing to say "this is
drifting," and a pre-committed "no" list of refusals against
predictable temptations (advertising, accounts, paid tier, branding
the tool as "for homeless people," etc.).

The detection plan is mostly humans, not algorithms. Three trusted
practitioners, regular structured reflection, basic metadata, and a
written ethos that gets re-read. That's it. That's the entire safety
apparatus, and it is appropriate to the size and shape of the project.

## 11. Sustainability and Continuity

The honest version: this is a one-year personal commitment. At year
one, the project either finds an institutional home or sunsets
gracefully. Open source from day one as a backstop. Bus factor of two.
Wind-down path is real and designed. Partners and users are informed
of this structure transparently.

Personal-spend ceiling is $400/month, which covers V1 soft-launch and
meaningful early growth on Sonnet 4.6 with a tiered fallback to
cheaper models when budget tightens. If at month 12 there is no
institutional home and the builder is done, the tool wind-downs with
30 days' notice and the code stays public on GitHub. The world is no
worse than it was before.

This is unusual to say in writing, especially in a pitch context.
Saying it is the point. The tool is built and run honestly, and the
people relying on it deserve to know what the actual situation is.
That same honesty is what makes the year-one institutional
conversation easy: the builder isn't selling a forever-product, the
builder is asking whether what V1 proved is worth scaling.

## 12. What This Project Is Not

- It is not a startup. It is not a path to revenue. It is not an MVP
  for something bigger. It is a public utility in its final form.

- It is not a service directory and never will be. It refuses those
  questions and refers to humans.

- It is not a clinician, lawyer, doctor, or benefits navigator. It is
  a thinking partner, with honest calibration about its own limits.

- It is not a substitute for human connection, even as it serves
  loneliness. The counterfactual — lonely with a warm AI vs. lonely
  with nothing — is what justifies the use case, not a claim that the
  tool replaces what humans can offer.

- It is not "AI for the homeless." It is a tool that happens to be
  free, accessible, and visibly designed for the conditions a person
  in housing instability is operating in. The framing matters because
  the framing is the politics.

- It is not a research project. There is no IRB. There is no data
  collection plan. There is no academic output. The point is to be
  useful.

- It is not anyone's career. The builder is volunteering time and
  money. The tool exists because it should exist, not because it's
  a vehicle for anything else.

---

# Part II — The Manifesto

A software engineer in SOMA uses Claude every day. He pays $20/month
and it's a rounding error in his budget. He uses it to draft, think,
plan, organize, summarize a contract, debug a problem, talk through a
hard conversation. He doesn't think of it as remarkable. It's just
part of how he gets through his day.

A guy sleeping in a shelter ten blocks away has the exact same brain.
Often harder problems. Zero access.

That gap is not a moral failure on his part. It's an access gap, and
it compounds — because the engineer gets better at using AI every day
while the guy in the shelter never gets a first try.

Most "AI for homelessness" work treats unhoused people as objects of
services: predict who's at risk, allocate beds, route them through
systems, give caseworkers better tools. Even the well-intentioned
versions assume someone else is doing the cognitive work *about* the
unhoused person rather than *with* them. This project inverts that.
It treats the unhoused person as a normal capable adult solving real
problems with fewer tools than the rest of us, and just gives them
the tool.

The thing the existing field keeps missing is that 80% of what a
college-educated person uses ChatGPT for is not advice. It's drafting,
translating bureaucratese, organizing thoughts, having something
patient to talk to at 2am, getting unstuck on a stuck thought. None
of that requires the AI to be authoritative. It just requires it to
be available. The framing failure has been treating the LLM as an
oracle — and then fearing it'll be wrong — when it's really a
thinking partner, where the bar is lower and the value is wider.

This tool is not a service directory. It will not tell you which
shelter has beds tonight or what SNAP eligibility is in 2026. It
refers those questions to humans who can answer. It is a thinking
partner, document drafter, language translator, sounding board, and
tool for getting unstuck. That is the product.

The hardest design decisions in this project all come down to one
question: *risky compared to what?* A user contemplating suicide does
not become more likely to act because they have access to Claude. The
counterfactual on the bridge is a phone, maybe 988, maybe nothing —
not a panel of crisis counselors. Refusing to help someone understand
their denial letter when the SOMA engineer's tool would help him with
the same letter is the access gap reproducing itself inside the tool
that's supposed to close it. The instinct to refuse, restrict, gate-
keep, and surveil all sound responsible in the abstract; in practice,
they reliably produce a worse tool for the people who needed the good
one most.

So this tool refuses nothing. It does the work. Where the model is
known to get things wrong — legal procedure, medical dosing, benefits
rules — an honest note appears below the response and a button surfaces
real local humans who can verify. Refusal is replaced by honesty plus
referral. Crisis disclosures get the model's full warmth and care plus
visible local resources, not a hijacked screen that signals to users
that the tool is fragile and surveilling them. The design treats every
user as a capable adult.

It hasn't been built before because the people best positioned to
build it are usually too busy doing the work, and the people building
AI in this space mostly haven't done the work. The dominant frame is
"AI to help workers help clients," not "AI in clients' hands directly."
Partly for legitimate reasons. Partly institutional risk aversion.
Partly a quiet, persistent assumption that this population can't
handle a complicated tool.

That assumption is wrong. People navigating benefits appeals, eviction
threats, treatment decisions, and address-less job hunts are already
solving harder problems than most professionals do, every day, with
worse tools and less sleep. The tool just gives them one more thing
to lean on.

The "they can't handle it" instinct is the same patronizing reflex
that shows up in every era of tech access — too dangerous for women
to read novels, too dangerous for the working class to have radios,
too dangerous for kids to have the internet. Every time, it's been
wrong. The people gatekept out of new tools are the ones who'd
benefit most. The people doing the gatekeeping are usually fine.

The bet is that giving a frontier LLM directly to someone who would
never otherwise get to use it — without an account, without a wrapper
trying to be smarter than the model, without a caseworker in the loop,
without a service-finder framing — will help most people most of the
time. Not because the LLM is perfect. Because access to imperfect-but-
genuinely-useful is dramatically better than no access at all, which
is the current state for this population. And the alternative —
waiting for the field to figure out how to do this safely enough that
institutions feel comfortable shipping it — means another five years
of compounding access inequality during the most consequential
cognitive-tools transition in a generation.

The richest people are using this stuff every day and getting more
powerful. Lifting other people up to the same tool is not radical.
It's the obvious thing. People just need to relax.

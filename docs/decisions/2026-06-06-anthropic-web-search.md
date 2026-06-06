# 2026-06-06: Anthropic Web Search

## Status

Accepted.

## Context

Streetlight users expect ordinary LLM research behavior: looking up current rules, public program information, organization pages, and practical next-step information. The previous chat route used Anthropic text generation only, so the model correctly had no live web access and sometimes told users it could not research.

The project already sends user messages to Anthropic under the stated commercial API privacy posture. Adding a separate search vendor would create another data processor and another logging surface. Anthropic's server-side web search keeps this first version inside the existing provider relationship.

## Decision

Enable Anthropic's `web_search_20250305` server tool on the main chat request.

- General web search is allowed. There is no hard allowlist.
- Each turn is capped at five searches with `max_uses: 5`.
- Search is localized approximately to Seattle, Washington, US.
- Streetlight does not log search queries or source URLs.
- Streetlight logs only aggregate tool counts: `main_web_search_requests` and `main_web_fetch_requests`.
- The final UI appends a short `Sources:` list from Anthropic citation metadata when search citations are present.
- The system prompt tells the model to keep search queries general and avoid names, addresses, phone numbers, case numbers, account numbers, exact copied letter text, and unusually specific private facts.
- Daily spend tracking includes the web search request fee at $0.01 per search, matching Anthropic's published $10 per 1,000 searches at the time of this decision.

## Consequences

Users can ask Streetlight to look things up on the web.

Privacy risk increases compared with a no-tool model call because the model can generate a search query from the conversation. The mitigation is prompt-level query minimization, no Streetlight-side query logging, no extra vendor, and a per-turn search cap.

Search result quality is not guaranteed. The model must cite sources when web search is used and keep uncertainty language when information may be incomplete.

The architecture doc's previous "no tools connected to user input" statement is no longer true and has been updated. The new boundary is: no client tools, no shell, no file system, no database writes, and no arbitrary HTTP calls from user input.

# 2026-06-12: Client-side conversation history window

## Status

Accepted.

## Context

The chat client sent the entire conversation history with every turn, while
the request validator (`maxChatMessages = 24` in `src/lib/chat-types.ts`)
rejects any request carrying more than 24 messages. Because the history only
grows, a conversation that passed roughly twelve back-and-forth turns hit a
hard wall: every further send returned HTTP 400, the user saw the generic
"The response did not come through. Please try again" message, and retrying
could never succeed. The only escape was a reload, which clears the
conversation. A pre-launch UI stress test (`tmp/stress-test`, shard B)
reproduced this at turn 13.

The 24-message cap itself is intentional and stays: the V1 spec models
typical sessions at about five turns and bases the cost model on short
conversations. The defect was the absence of any graceful client behavior
once the cap was reached.

This touches the "model/provider behavior, response style" re-read trigger,
because trimming history changes what context the model receives, so it is
recorded here.

## Decision

The client sends a bounded sliding window of the most recent messages instead
of the full history. The window:

- Never exceeds `maxChatMessages`, so requests stop dead-ending.
- Always keeps the seeded entry greeting as the first message, preserving the
  exact message shape (leading assistant greeting, then strictly alternating
  user/assistant, ending on the latest user message) that the live Anthropic
  call already relies on.
- Trims the oldest middle turns first, keeping the most recent context, which
  is what matters most for this tool's short, task-focused exchanges.

The server cap is unchanged and remains the authoritative safety bound.

## Consequences

- Long conversations continue working instead of dead-ending. The user never
  sees the misleading "try again" wall.
- In a very long conversation the model loses the earliest turns. For this
  tool's typical short, present-focused exchanges this is an acceptable
  trade and better than a hard stop.
- Per-request input size is now bounded, which is mildly favourable for cost
  and latency.
- No change to persistence (still none), logging, or the privacy posture; the
  window only ever reduces what is sent to Anthropic per turn.

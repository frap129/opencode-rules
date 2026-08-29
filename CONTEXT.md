# OpenCode Rules

OpenCode Rules selects authored guidance for an OpenCode session and delivers that guidance into the conversation where it applies.

## Language

**Rule**:
Authored guidance with optional matching conditions and hooks.

**Matched rule**:
A rule whose conditions apply to the current session context.
_Avoid_: Active rule

**File observation**:
The path and file text one successful file-handling tool event exposes for matching.
_Avoid_: Tool output blob

**Working context**:
The per-session set of observed file paths used when determining Matched rules and retained across compaction.
_Avoid_: Context paths

**Rule delivery**:
Making matched rule content, including content activated by a hook, available to the conversation with the appropriate lifetime.
_Avoid_: Rule injection

**Durable delivery**:
Rule delivery that persists in conversation history and remains available on later turns.
_Avoid_: Persistent injection

**Transient delivery**:
Rule delivery that applies to one model dispatch without persisting in conversation history.
_Avoid_: Ephemeral injection

**Hook**:
Rule behavior triggered by a matching tool event; it may activate the owning rule's content, block the event, or run a command.

**Matched-rule state**:
The per-session record of Matched rule paths, written by the server after each durable turn and read by the sidebar so it can distinguish matched from unmatched rules.
_Avoid_: Active rules state

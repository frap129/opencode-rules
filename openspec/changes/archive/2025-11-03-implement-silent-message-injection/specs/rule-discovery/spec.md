# rule-discovery Delta Specification

## REMOVED Requirements

### Requirement: First Message Rule Injection

**Reason**: Replaced with event-driven silent message injection for cleaner separation and immediate response to compaction.

**Migration**: The plugin now automatically sends rules as silent messages when sessions are created or compacted. No user configuration changes required - the behavior is transparent and more reliable.

## ADDED Requirements

### Requirement: Silent Message Rule Injection

The system SHALL send formatted rules as silent messages (using `noReply: true`) when sessions are created or compacted, using the `event` hook and `client.session.prompt()` API.

#### Scenario: Rules sent on session creation

- **GIVEN** a new session is created
- **WHEN** the `session.created` event is received
- **THEN** the system SHALL call `client.session.prompt()` with `noReply: true`
- **AND** the message SHALL contain the formatted rules
- **AND** the session ID SHALL be added to the tracking set

#### Scenario: Rules not sent twice to same session

- **GIVEN** a session has already received rules
- **WHEN** another `session.created` event is received for the same session ID
- **THEN** the system SHALL NOT send rules again
- **AND** the `client.session.prompt()` method SHALL NOT be called

#### Scenario: Rules re-sent on session compaction

- **GIVEN** a session exists and has received rules
- **WHEN** a `session.compacted` event is received
- **THEN** the session ID SHALL be removed from the tracking set
- **AND** the system SHALL immediately call `client.session.prompt()` with `noReply: true`
- **AND** the message SHALL contain the formatted rules
- **AND** the session ID SHALL be added back to the tracking set

#### Scenario: Compaction for unknown session

- **GIVEN** a `session.compacted` event is received for a session not in the tracking set
- **WHEN** the event is processed
- **THEN** the system SHALL send rules to that session
- **AND** the session ID SHALL be added to the tracking set

#### Scenario: Silent message format

- **GIVEN** rules are being sent to a session
- **WHEN** the system calls `client.session.prompt()`
- **THEN** the request body SHALL include `noReply: true`
- **AND** the request body SHALL include a parts array with a single text part
- **AND** the text part SHALL contain the formatted rules

#### Scenario: Error handling during message send

- **GIVEN** rules are being sent to a session
- **WHEN** the `client.session.prompt()` call fails
- **THEN** the error SHALL be logged with context
- **AND** the session SHALL NOT be added to the tracking set
- **AND** the system SHALL continue operating normally

### Requirement: Event-Driven Architecture

The system SHALL use the `event` hook to listen for session lifecycle events rather than the `chat.message` hook.

#### Scenario: Event hook registered

- **GIVEN** the plugin is initialized
- **WHEN** hooks are returned from the plugin
- **THEN** an `event` hook function SHALL be present
- **AND** the `event` hook SHALL handle `session.created` events
- **AND** the `event` hook SHALL handle `session.compacted` events

#### Scenario: No rules when formattedRules is empty

- **GIVEN** no rule files were discovered
- **WHEN** any session event is received
- **THEN** the system SHALL NOT send any messages
- **AND** the system SHALL return early from the event handler

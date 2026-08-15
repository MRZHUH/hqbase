## Purpose

Lets a non-browser client authenticate against the HQBase REST API with an OAuth access token
instead of a session cookie, while keeping every administrative route reachable only from a signed-in
browser session.

## ADDED Requirements

### Requirement: The workspace publishes the REST API as an OAuth protected resource

The workspace SHALL expose `<origin>/api` as an OAuth protected resource whose metadata is
discoverable, so a client can learn which authorization server issues tokens for it and which scopes
that resource accepts.

#### Scenario: Protected resource metadata is discoverable

- **WHEN** a client requests `/.well-known/oauth-protected-resource/api`
- **THEN** the workspace responds with the resource identifier `<origin>/api`, the workspace
  authorization server as the only listed authorization server, the supported scopes
  `mail:read`, `mail:write`, `mail:send`, and `header` as the only supported bearer method

#### Scenario: An unauthenticated API request advertises how to authenticate

- **WHEN** a request to a bearer-eligible `/api/*` route carries an `Authorization: Bearer` header
  that is not a valid access token
- **THEN** the workspace responds `401` with a `WWW-Authenticate: Bearer` challenge naming the
  `/.well-known/oauth-protected-resource/api` metadata document

### Requirement: The REST API accepts access tokens bound to the API resource

An `/api/*` request carrying a valid, unexpired, unrevoked access token bound to the `<origin>/api`
resource SHALL be authenticated as the token's user with that user's workspace role, and SHALL be
subject to exactly the same mailbox access control as a browser session for that user.

#### Scenario: A valid token authenticates a request

- **WHEN** a request to `GET /api/me` carries a valid access token bound to `<origin>/api` with the
  `mail:read` scope
- **THEN** the workspace responds with the token owner's identity, identical to what a browser
  session for that user receives

#### Scenario: A token issued for another resource is refused

- **WHEN** a request to `/api/*` carries an access token bound to the MCP resource rather than
  `<origin>/api`
- **THEN** the workspace responds `401` and does not act on the request

#### Scenario: Revoked, expired, and disabled credentials are refused

- **WHEN** a request carries an access token that is revoked, past its expiry, tied to an expired
  session, tied to a disabled client, or owned by a banned user
- **THEN** the workspace responds `401` and does not act on the request

#### Scenario: A user who must replace a temporary password cannot use a token

- **WHEN** a request carries a valid access token owned by a user whose password setup is still
  required
- **THEN** the workspace responds `401` and does not act on the request

#### Scenario: Mailbox access control still applies

- **WHEN** a token owner requests a message in a mailbox they have no read grant for
- **THEN** the workspace refuses the request exactly as it would for that user's browser session

### Requirement: Bearer requests are restricted to an explicit route allowlist

Access-token authentication SHALL be permitted only on routes that appear in a published allowlist,
each entry declaring the scope it requires. Any `/api/*` route absent from the allowlist SHALL
refuse bearer credentials regardless of the token's scopes.

#### Scenario: A listed route with a satisfied scope is allowed

- **WHEN** a token holding `mail:write` requests `POST /api/conversations/<id>/archive`
- **THEN** the workspace performs the action and records it as the token owner

#### Scenario: A listed route with a missing scope is refused

- **WHEN** a token holding only `mail:read` requests `POST /api/conversations/<id>/archive`
- **THEN** the workspace responds `403` with the code `INSUFFICIENT_SCOPE` and does not change any
  message state

#### Scenario: An unlisted route refuses bearer credentials

- **WHEN** a token of any scope requests an administrative route such as `POST /api/users` or
  `GET /api/setup/status`
- **THEN** the workspace responds `403` with the code `BEARER_NOT_ALLOWED` and does not act on the
  request, even if the token owner is an owner or admin

#### Scenario: Browser sessions are unaffected by the allowlist

- **WHEN** a signed-in browser session requests any `/api/*` route it was previously permitted to use
- **THEN** the workspace serves it exactly as before, with no scope check applied

### Requirement: Token use is observable and self-limiting

The workspace SHALL record when an access token was last used, and SHALL never accept an access
token as proof of a recent interactive sign-in.

#### Scenario: Last use is recorded

- **WHEN** a token successfully authenticates a request
- **THEN** the workspace updates that token's last-used timestamp, visible to the token owner

#### Scenario: Infrastructure changes still require a fresh browser sign-in

- **WHEN** a route requires a recent interactive authentication
- **THEN** the workspace refuses it for bearer credentials, because such routes are never on the
  bearer allowlist

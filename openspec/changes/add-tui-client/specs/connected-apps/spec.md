## Purpose

Lets a workspace member see every external application holding a credential for their account and
withdraw that access, so authorizing a terminal client or an AI agent is a reversible decision.

## ADDED Requirements

### Requirement: A user can see the applications they have authorized

Workspace settings SHALL show the signed-in user every OAuth application they have consented to,
with enough detail to decide whether it still deserves access.

#### Scenario: Authorized applications are listed

- **WHEN** a signed-in user opens the connected applications view
- **THEN** each application they have consented to is listed with its name, the scopes it was
  granted, when access was first granted, and when one of its credentials was last used

#### Scenario: Never-used access is distinguishable from active access

- **WHEN** an application holds a credential that has never authenticated a request
- **THEN** its last-used value is shown as never used rather than as a date

#### Scenario: An empty list is explained

- **WHEN** the user has authorized no applications
- **THEN** the view explains that no applications are connected instead of showing an empty table

#### Scenario: One user cannot see another user's authorizations

- **WHEN** any user opens the connected applications view
- **THEN** only their own authorizations are listed, regardless of their workspace role

### Requirement: A user can revoke an application's access

Workspace settings SHALL let the signed-in user withdraw an application's access, after which that
application's existing credentials stop working immediately.

#### Scenario: Revocation invalidates existing credentials

- **WHEN** the user revokes an application
- **THEN** the workspace revokes that application's access and refresh tokens for that user and
  removes the consent, and a subsequent request using one of those tokens is refused

#### Scenario: Revocation is confirmed before it happens

- **WHEN** the user asks to revoke an application
- **THEN** the interface states that the application will lose access until it is authorized again
  and requires an explicit confirmation

#### Scenario: Revocation is recorded

- **WHEN** an application's access is revoked
- **THEN** the workspace records an audit entry naming the acting user and the application

#### Scenario: A user cannot revoke another user's authorization

- **WHEN** a user attempts to revoke an authorization that belongs to a different user
- **THEN** the workspace refuses the request and revokes nothing

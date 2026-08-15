## Purpose

Gives a workspace member a terminal command that opens their shared mailboxes, searches them as they
type, reads threads, and changes message state without leaving the shell or opening a browser.

## ADDED Requirements

### Requirement: The client authorizes through the browser, never the terminal

The client SHALL obtain its credential with an OAuth authorization code flow using PKCE and a
loopback redirect on the local machine. It SHALL never prompt for, read, or transmit the user's
workspace password.

#### Scenario: Login opens the browser and completes on redirect

- **WHEN** the user runs the login subcommand with a workspace origin
- **THEN** the client registers itself with the workspace authorization server, starts a loopback
  listener on an ephemeral port, opens the authorization URL in the user's browser, and completes
  once the browser redirects back with an authorization code

#### Scenario: The authorization URL is always printed

- **WHEN** the client cannot launch a browser, or the user is working over a remote shell
- **THEN** the authorization URL is printed so it can be opened manually, and the client keeps
  waiting for the redirect

#### Scenario: Only the client's own redirect is accepted

- **WHEN** the loopback listener receives a request whose state parameter does not match the value
  the client generated for this attempt
- **THEN** the client rejects it, does not exchange any code, and reports the mismatch

#### Scenario: A denied or abandoned authorization fails cleanly

- **WHEN** the user declines consent, or the redirect does not arrive within the login timeout
- **THEN** the client stops the listener, stores no credential, and exits with a non-zero status and
  an explanatory message

#### Scenario: Write access is opt-in

- **WHEN** the user runs login without requesting write access
- **THEN** the client requests only read and offline scopes, and the resulting session cannot change
  message state until the user logs in again requesting write access

### Requirement: Credentials are stored for the owner only and can be revoked locally

The client SHALL store its tokens in a per-workspace file readable and writable only by its owner,
SHALL refresh an expired access token without user interaction while a refresh token is valid, and
SHALL provide a command that removes the stored credential and asks the workspace to revoke it.

#### Scenario: Stored credentials are owner-only

- **WHEN** the client writes its credential file
- **THEN** the containing directory permits access only to its owner and the file permits reading
  and writing only by its owner

#### Scenario: An expired access token is refreshed transparently

- **WHEN** a request fails because the access token expired and a refresh token is stored
- **THEN** the client obtains a new access token, retries the request once, and persists the rotated
  credential

#### Scenario: An unrecoverable credential prompts re-login

- **WHEN** refreshing fails because the credential was revoked or the refresh token expired
- **THEN** the client reports that the workspace connection was revoked and names the login command,
  without deleting the local cache

#### Scenario: Logout removes and revokes

- **WHEN** the user runs the logout subcommand
- **THEN** the client asks the workspace to revoke the credential, deletes the stored credential
  file, and reports success even if the workspace could not be reached

#### Scenario: Credentials never reach the terminal transcript

- **WHEN** the client prints status, errors, or diagnostics
- **THEN** no access token, refresh token, client secret, or authorization code appears in the
  output

### Requirement: The client opens a full-screen search interface by default

Running the client command with no arguments SHALL open a full-screen terminal interface whose
first surface is a single query line above a conversation list, and SHALL exit cleanly restoring the
terminal to its prior state.

#### Scenario: Bare invocation opens the browser

- **WHEN** a signed-in user runs the client with no arguments
- **THEN** the interface opens with an empty query, the most recent conversations listed, and a
  status line naming the workspace, the result count, and the cache age

#### Scenario: Exit restores the terminal

- **WHEN** the user presses the quit key or interrupts the process
- **THEN** the alternate screen is released, the cursor is restored, raw input mode is disabled, and
  the shell prompt returns undamaged

#### Scenario: A non-interactive terminal is refused clearly

- **WHEN** the interface is launched with standard input that is not a terminal
- **THEN** the client exits with a non-zero status and a message naming the non-interactive
  subcommand to use instead

### Requirement: Typing filters the cached conversations immediately

Each keystroke in the query line SHALL re-filter the locally cached conversations and repaint the
list without waiting on the network.

#### Scenario: Type-ahead narrows the list

- **WHEN** the user types characters into the query line
- **THEN** the list is replaced by the cached conversations matching that query, ordered by match
  quality then recency, with the selection reset to the first row

#### Scenario: Clearing the query restores the full list

- **WHEN** the user clears the query line
- **THEN** the list returns to the most recent cached conversations

### Requirement: The query line supports structured filters

The query line SHALL accept space-separated terms combined with AND. A term of the form
`<field>:<value>` SHALL filter exactly on that field; any other term SHALL match loosely against the
subject, sender, and snippet.

#### Scenario: Field filters constrain the match

- **WHEN** the query contains `from:`, `to:`, `subject:`, or `mailbox:` followed by a value
- **THEN** only conversations whose corresponding field contains that value are listed

#### Scenario: State filters constrain the match

- **WHEN** the query contains `is:unread`, `is:read`, `is:starred`, or `has:attachment`
- **THEN** only conversations in that state are listed

#### Scenario: Folder and age filters constrain the match

- **WHEN** the query contains `in:<folder>` naming a known folder, or `newer:<n><unit>` or
  `older:<n><unit>` with a day, week, or month unit
- **THEN** only conversations in that folder, or newer or older than that age, are listed

#### Scenario: An unparsable filter is reported, not silently ignored

- **WHEN** the query contains a `<field>:<value>` term whose field is unknown or whose value is
  invalid for that field
- **THEN** the status line reports the offending term and the list is left unchanged

### Requirement: The client can search message bodies on the server

Because the local cache holds only conversation headers and snippets, the client SHALL offer an
explicit action that sends the free-text part of the current query to the workspace, which searches
full message bodies, and SHALL merge those results into the list.

#### Scenario: Deep search adds server-side matches

- **WHEN** the user triggers the deep-search action with a non-empty free-text query
- **THEN** the client requests matching conversations from the workspace, adds any not already
  cached to both the list and the cache, and marks in the status line that server results are
  included

#### Scenario: Deep search failure keeps local results usable

- **WHEN** the deep-search request fails or times out
- **THEN** the locally filtered list stays on screen and the status line reports the failure

### Requirement: The client reads a conversation as a thread

Selecting a conversation SHALL open a reader showing the thread's messages in chronological order
with their headers and plain-text bodies, and SHALL return to the list without losing the query or
the selected row.

#### Scenario: Opening a conversation shows the thread

- **WHEN** the user opens the selected conversation
- **THEN** the reader shows each permitted message in the thread with its sender, recipients, date,
  attachment names, and plain-text body, scrollable within the terminal

#### Scenario: Returning preserves the search

- **WHEN** the user leaves the reader
- **THEN** the list reappears with the same query, the same scroll offset, and the same row selected

#### Scenario: HTML-only mail is still readable

- **WHEN** a message has no plain-text body
- **THEN** the reader shows the workspace-provided text rendering rather than an empty body

### Requirement: The client changes message state

The client SHALL let the user mark a conversation read or unread, star or unstar it, archive it, or
move it to trash, and SHALL reflect the result immediately.

#### Scenario: An action is applied and reflected

- **WHEN** the user invokes a state action on a conversation
- **THEN** the client asks the workspace to apply it, updates the row and the local cache on
  success, and reports failure in the status line without changing the row on failure

#### Scenario: Insufficient scope is explained

- **WHEN** the client's credential lacks the scope an action needs
- **THEN** the status line explains that the connection is read-only and names the command that
  re-authorizes with write access

### Requirement: The client caches conversations on disk per workspace

The client SHALL keep a local cache of conversation headers, snippets, and previously read message
bodies, stored per workspace under the user's data directory, readable and writable only by its
owner, and SHALL provide a command that erases it.

#### Scenario: The cache survives restarts

- **WHEN** the user quits and reopens the client
- **THEN** the previously synced conversations are listed immediately, before any network request
  completes

#### Scenario: The cache is owner-only

- **WHEN** the client creates its cache file and containing directory
- **THEN** the directory permits access only to its owner and the file permits reading and writing
  only by its owner

#### Scenario: Separate workspaces never share a cache

- **WHEN** the client is used against two different workspace origins
- **THEN** each origin has its own cache file and neither can read the other's conversations

#### Scenario: The cache can be erased

- **WHEN** the user runs the cache-clear command
- **THEN** every cached conversation and message body for that workspace is deleted from disk

### Requirement: The client works offline against its cache

With no reachable workspace, the client SHALL still open, search the cache, and read cached message
bodies, reporting the connection failure without discarding cached data.

#### Scenario: Offline start still opens

- **WHEN** the client starts while the workspace is unreachable
- **THEN** the interface opens on the cached conversations and the status line reports that the
  workspace is unreachable and when the cache was last synced

#### Scenario: Offline actions are refused, not lost silently

- **WHEN** the user invokes a state action while the workspace is unreachable
- **THEN** the action is refused with a message in the status line and the cached row is unchanged

### Requirement: The client offers non-interactive subcommands

The client SHALL expose its data without the full-screen interface so it can be used in scripts and
pipelines.

#### Scenario: Search prints results to standard output

- **WHEN** the user runs the search subcommand with a query
- **THEN** matching conversations are printed as aligned columns on standard output and diagnostics
  are printed on standard error

#### Scenario: Sync refreshes the cache and reports what changed

- **WHEN** the user runs the sync subcommand
- **THEN** the client pulls conversations changed since the last sync into the cache and prints how
  many were added and updated

#### Scenario: Status reports the connection and the cache

- **WHEN** the user runs the status subcommand
- **THEN** the client prints the workspace origin, the signed-in account, the granted scopes, the
  cache location, the cached conversation count, and the age of the last successful sync

#### Scenario: Version is printed without a workspace

- **WHEN** the user runs the version subcommand with no configured workspace
- **THEN** the client prints its version and exits zero

# hqbase-mail

`hqbase-mail` is a terminal client for an HQBase workspace: type an instance of what you remember
about a message and the matching conversations narrow as you type, open one to read the thread, and
archive or star it without leaving the shell.

```
> invoice is:unread
     FROM                     SUBJECT                                   DATE
 ●@  billing@vendor.example   Invoice 4471                              2h ago
 ●   accounts@vendor.example  Invoice 4470 — corrected                  3d ago
mail.example.com · you@example.com · 2/318 cached · synced 4m ago
→ open  ·  ← clear  ·  ↑↓ move  ·  type filter  ·  ctrl+r search bodies  ·  ctrl+c quit
```

Search runs against a local cache, so it repaints on every keystroke rather than waiting on a
request. The cache holds conversation headers and snippets, not full message bodies; `ctrl+r` sends
the free-text part of your query to the workspace, which does search bodies, and merges the results.

## Install

Requires Node 24 or newer. From a checkout of the HQBase repository:

```sh
pnpm install
pnpm tui:build
npm install -g ./tui
```

`hqbase-mail` then lands on your `PATH`. Without a global install, `pnpm mail` runs it in place.

## Sign in

```sh
hqbase-mail login https://mail.example.com
```

This opens your browser to the workspace's own consent screen and waits for the redirect on a
loopback port. **Your password is never typed into, read by, or sent through the terminal.** If no
browser can be launched — a remote shell, a container — the URL is printed for you to open
elsewhere; the client keeps waiting.

The connection is **read-only by default**. To triage mail from the terminal, ask for write access:

```sh
hqbase-mail login https://mail.example.com --write
```

Every authorization shows up under **Settings › Applications** in the web app, with the scopes it
holds and when it was last used, and can be revoked there at any time. `hqbase-mail logout` revokes
it from this end.

## Commands

| Command | What it does |
| --- | --- |
| `hqbase-mail` | open the interactive browser |
| `hqbase-mail login [origin] [--write]` | authorize this machine in your browser |
| `hqbase-mail logout` | revoke the credential and forget the workspace |
| `hqbase-mail search <query> [--limit N]` | search the cache and print rows |
| `hqbase-mail sync [--folder F]` | pull recent conversations into the cache |
| `hqbase-mail status` | show the connection and the cache |
| `hqbase-mail cache clear` | delete the cached mail for this workspace |
| `hqbase-mail version` | print the version |

Every command takes `--origin <url>` to target a workspace other than the one `login` remembered.

## Keys

The bottom line of the screen always lists the keys for wherever you are, so
none of this has to be memorised.

| In the list | |
| --- | --- |
| any character | type into the query |
| `→` / `enter` | open the conversation |
| `←` / `esc` | clear the query |
| `↑` `↓` / `ctrl+p` `ctrl+n` | move the selection |
| `pgup` `pgdn` `home` `end` | page and jump |
| `ctrl+r` | search message bodies on the workspace |
| `ctrl+s` | sync |
| `ctrl+b` `ctrl+f` `ctrl+a` `ctrl+e` | move the cursor inside the query |
| `ctrl+c` | quit |

| In the reader | |
| --- | --- |
| `←` / `q` / `esc` | back to the list, with your search intact |
| `↑` `↓` `pgup` `pgdn` | scroll |
| `a` | archive |
| `s` / `S` | star / unstar |
| `r` / `u` | mark read / unread |
| `d` | move to trash |
| `ctrl+c` | quit |

`→` goes in and `←` comes out, so you can move through mail one-handed. The
arrows do not move the text cursor for that reason; `ctrl+b` / `ctrl+f` and
`ctrl+a` / `ctrl+e` edit the query the way readline does. `←` in the list clears
the query rather than quitting — quitting is always `ctrl+c`, so a stray arrow
cannot end the session.

## Reading a message

The reader shows the full envelope, not a summary:

```
  Quarterly review
From:  Alice Green <alice@example.com>
To:    team@example.com, ops@example.com
Cc:    manager@example.com
Date:  2026-08-15 11:00  (2h ago)
Flags: has attachments · has images · unread

  Numbers for the quarter are attached. Chart below.

Attachments (2)
  • report.pdf — application/pdf, 1.5 MB
  • chart.png — image/png, 240 KB, inline
    <the image, drawn here>
```

`Cc` and `Bcc` lines appear only when the message carries them. `Flags` names
whether the message has attachments, has images, has an HTML part that only the
web app can render, and whether it is still unread.

**Images** are drawn in place when the terminal can draw them — iTerm2, WezTerm,
Konsole via the iTerm2 protocol, Kitty and Ghostty via the Kitty protocol.
Anywhere else, and inside `tmux` or `screen` (which mangle the escape
sequences), the image is described in text instead of being dropped silently:

```
  • photo.jpg — image/jpeg, 900 KB
    [image] this terminal cannot display images
```

Images above 4 MB are not fetched at all and say so. Set `HQBASE_MAIL_IMAGES=off`
to turn drawing off everywhere and always get the text form.

## Query language

Terms are ANDed. Anything that is not a `field:value` term matches loosely against the subject,
sender, and snippet.

```
from:alice        to:team          subject:invoice     mailbox:mbx_1
is:unread         is:read          is:starred          has:attachment
in:inbox          in:sent          in:archived         in:trash      in:catchall
newer:7d          older:2w         newer:1m                          (units: d, w, m)
```

A filter that cannot be understood is named in the status line rather than silently ignored, so a
typo never quietly returns the wrong mail.

## What is stored on your machine

```
$XDG_CONFIG_HOME/hqbase-mail/<workspace>/credentials.json   0600   OAuth tokens
$XDG_DATA_HOME/hqbase-mail/<workspace>/cache.db             0600   cached mail
```

`<workspace>` is a digest of the workspace origin, so two workspaces never share a file and no
directory name reveals a private hostname. Both files are readable and writable only by you, inside
directories that are also owner-only.

**The cache contains mail.** Conversation subjects, senders, recipients, and snippets are stored for
everything synced, and the full plain-text body of any message you open is stored too. This moves
workspace mail onto the machine running the client. If that is not acceptable for your workspace,
do not install this client — or run `hqbase-mail cache clear` when you are done, which deletes every
cached conversation and body while leaving the connection signed in.

Offline, the client still opens, searches the cache, and reads bodies it already has. Actions and
deep search need the workspace, and say so instead of failing quietly.

## Development

```sh
pnpm tui:typecheck
pnpm vitest run --config vitest.config.ts test/unit/tui
```

The interface is a pure `update(model, event) → [model, effects]` reducer with a pure
`render(model) → string`; `src/ui/app.ts` is the only module that touches the terminal. Tests drive
the reducer directly and assert on rendered frames, so none of them needs a pseudo-terminal.

# Changelog

What each release changed, newest first, in terms of what you'd notice using it.
The release job reads the matching section into the GitHub release notes and the
updater carries it, so this file is what a release says about itself — not a
second description of it. GitHub's generated commit list is appended below it.

## 0.1.1

### Added

- **Check for Updates… in the app menu.** Answers either way: "Up to date" or
  "Couldn't check", rather than going quiet the way the background check does.
  A check nobody asked for stays silent; one you asked for doesn't.
- **Stop now stops background tasks.** Stopping a turn left backgrounded tasks
  running, so the session sat busy until they drained on their own. Stop now
  interrupts the turn and stops each outstanding task.
- **You can send while a background task runs.** A prompt typed with a task
  outstanding was queued behind a turn boundary that a background shell never
  produces, so it sat there. It sends now.
- **Confetti when a session settles**, on the same beat as the sound.

### Fixed

- **Esc no longer leaves fullscreen.** With the composer unfocused, Esc fell
  through to the webview, which macOS reads as "leave fullscreen" — so the
  window resized instead of the key cancelling anything.
- **The blocked-install reason moved into a tooltip.** It sat under the button
  as a standing line of prose, which read as a permanent second row.

## 0.1.0

First stable release.

- In-app updates on a stable and a beta channel, with the app checking on launch
  and every six hours and installing on request.
- Quitting asks first, so a turn in flight isn't killed by a stray ⌘Q.

# Changelog

What each release changed, newest first, in terms of what you'd notice using it.
The release job reads the matching section into the GitHub release notes and the
updater carries it, so this file is what a release says about itself — not a
second description of it. GitHub's generated commit list is appended below it.

## 0.1.2

### Added

- **The window is glass.** The desktop shows through the transcript, while
  cards, menus and the composer keep their own fill — so the wallpaper reads as
  the room the app sits in rather than a wash over the text. Fullscreen drops
  it, since there's nothing behind a fullscreen window to show through.
- **A scroll-to-bottom button.** Scrolling up unpins the transcript for good,
  so a session that kept growing left no way back to the live end but a drag.

### Fixed

- **The titlebar drags the window again.** Every drag was being rejected before
  it started, and the parts of the bar carrying a label — session title, project
  name, branch — were dead to the pointer even once it wasn't.
- **Long paths in the file and command pickers no longer spill past the row.**
  They ellipsize.
- **The send hint hides while a picker is open.** It sat behind the list, and it
  was untrue there anyway: Enter completes the highlighted row.

### Changed

- **Stepping between sessions is ⌘⇧↑/↓**, was ⌘⌥↑/↓.
- **Shift+Tab is stated on the permission button's tooltip**, rather than only
  inside the menu it opens — where the modes already are.

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

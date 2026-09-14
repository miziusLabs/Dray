// The sound files use an opaque extension so Finder does not offer its media
// Play button for them. Decode them through Web Audio rather than creating
// HTMLAudioElements: short effects should not register as resumable media with
// the operating system's keyboard controls.
let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function loadSound(path: string): Promise<AudioBuffer | null> {
  return fetch(path)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load sound: ${path}`);
      return response.arrayBuffer();
    })
    .then((bytes) => getAudioContext().decodeAudioData(bytes))
    .catch(() => null);
}

// Start loading at module load rather than per-call, so the fetch and decode
// happen while the app is idle instead of on the first settle.
const celebration = loadSound("/celebration.dray-sound");
const notification = loadSound("/notification.dray-sound");

function resumeAudioContext() {
  const context = getAudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
}

// A settle action updates the backend before it plays its effect, so its call
// no longer sits directly inside the click handler. Resume on the interaction
// itself to retain the webview's user-activation permission for later effects.
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", resumeAudioContext, { passive: true });
  window.addEventListener("keydown", resumeAudioContext);
}

function play(sound: Promise<AudioBuffer | null>) {
  const context = getAudioContext();
  // Resume before waiting for the decoded buffer. Waiting first loses the
  // transient user activation that desktop webviews require for audio, and it
  // also leaves later event-driven notifications dependent on a suspended
  // context.
  const resumed = context.state === "suspended" ? context.resume() : Promise.resolve();

  void sound.then((buffer) => {
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    void resumed
      .then(() => source.start())
      .catch(() => source.disconnect());
  });
}

export function playCelebration() {
  play(celebration);
}

/// The in-app half of a session handing itself back to the reader.
///
/// Paired with the sidebar glow rather than replacing it: the glow is at the
/// edge of vision and easy to miss while reading something else, and the sound
/// carries with the eyes anywhere on screen. Silent when the window is in the
/// background, since the desktop notification makes its own noise there.
export function playNotification() {
  play(notification);
}

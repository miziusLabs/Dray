// The sound files use an opaque extension so Finder does not offer its media
// Play button for them. Fetching them into an audio Blob keeps the browser's
// playback MIME type explicit without exposing a standalone playable asset.
function loadSound(path: string): Promise<HTMLAudioElement | null> {
  return fetch(path)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load sound: ${path}`);
      return response.arrayBuffer();
    })
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = new Audio(url);
      audio.preload = "auto";
      return audio;
    })
    .catch(() => null);
}

// Start loading at module load rather than per-call, so the fetch and decode
// happen while the app is idle instead of on the first settle.
const celebration = loadSound("/celebration.dray-sound");
const notification = loadSound("/notification.dray-sound");

function play(sound: Promise<HTMLAudioElement | null>) {
  void sound.then((audio) => {
    if (!audio) return;
    audio.currentTime = 0;
    return audio.play().catch(() => {});
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

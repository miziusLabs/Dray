// Created at module load rather than per-call, so the fetch and decode happen
// while the app is idle instead of on the first settle — otherwise that click
// pays the load latency and every one after it is instant.
const celebration = new Audio("/celebration.wav");
celebration.preload = "auto";

export function playCelebration() {
  celebration.currentTime = 0;
  void celebration.play().catch(() => {});
}

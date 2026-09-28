export function playSaveHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
}

import * as Haptics from "expo-haptics";

export function playSaveHaptic() {
  void Haptics.selectionAsync().catch(() => {});
}

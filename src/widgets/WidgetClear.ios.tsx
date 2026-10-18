import { useEffect } from "react";
import { clearWidgetSnapshots } from "./PennyWidgets.ios";

export function WidgetClear() {
  useEffect(() => { clearWidgetSnapshots(); }, []);
  return null;
}

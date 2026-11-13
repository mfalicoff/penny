import { Kbd } from "@penny/ios-kit";

export const Shortcuts = () => (
  <div style={{ display: "flex", gap: 14, alignItems: "center", padding: 16, fontSize: 13, color: "var(--pk-label-2)" }}>
    <span><Kbd>⌘K</Kbd> search</span><span><Kbd>N</Kbd> new entry</span><span><Kbd>E</Kbd> edit</span><span><Kbd>⌘↵</Kbd> save</span><span><Kbd>Esc</Kbd> cancel</span>
  </div>
);

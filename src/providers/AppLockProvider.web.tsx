import type { ReactNode } from "react";

// App protection is device-local and native-only; web retains its existing sign-in flow.
export function AppLockProvider({ children }: { children: ReactNode }) { return children; }
export const useAppLock = () => null;

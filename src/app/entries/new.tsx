import { router } from "expo-router";
import { useEffect } from "react";
import { useWorkspace } from "../../providers/WorkspaceProvider";

export default function NewExpenseRoute() {
  const { setForm } = useWorkspace();
  useEffect(() => {
    setForm({});
    router.replace("/");
  }, [setForm]);
  return null;
}

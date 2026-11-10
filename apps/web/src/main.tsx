import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { createQueryClient } from "./app/queryClient";
import { createAppRouter } from "./app/router";
import "./design/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("index.html is missing #root");

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);

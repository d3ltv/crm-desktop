import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { installDesktopStorage } from "@/lib/desktopLocalStorage";
import { ensureNotificationPermission } from "@/lib/desktopNotifications";
import { installExternalLinkHandler } from "@/lib/openExternal";

document.title = "Relia";

const isResizeObserverError = (msg) =>
    typeof msg === "string" && msg.includes("ResizeObserver loop");

window.addEventListener("error", (e) => {
    if (isResizeObserverError(e.message)) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }
}, true);

const _origError = window.onerror;
window.onerror = (message, ...args) => {
    if (isResizeObserverError(message)) return true;
    return _origError ? _origError(message, ...args) : false;
};

const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
    if (isResizeObserverError(args[0])) return;
    _origConsoleError(...args);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

async function boot() {
  // Desktop : mémoire + fichier disque à la place du localStorage navigateur
  await installDesktopStorage();
  installExternalLinkHandler();
  ensureNotificationPermission().catch(() => {});

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

boot();

import React from "react";
import ReactDOM from "react-dom/client";

async function main() {
  let windowLabel = "main";
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    windowLabel = getCurrentWindow().label;
  } catch {
    // browser dev environment
  }

  const root = document.getElementById("root") as HTMLElement;

  if (windowLabel === "checkin") {
    const { default: CheckInWindow } = await import("../CheckInWindow");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <CheckInWindow />
      </React.StrictMode>,
    );
  } else {
    const { default: App } = await import("./App");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}

main();

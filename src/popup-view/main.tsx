// PopupView 엔트리 스텁.
// 아직 어떤 HTML에도 배선되지 않음 — 향후 멀티윈도우 도입 시 popup.html에서 로드하고
// vite multi-page 설정(rollupOptions.input)에 추가한다.
import React from "react";
import ReactDOM from "react-dom/client";
import Popup from "./Popup";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);

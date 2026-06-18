import { memo } from "react";
import type { Tab } from "../app-view/App";
import WidgetList from "./WidgetList";

interface Props {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

function LeftSidebar({
  tab,
  onTabChange,
  dates,
  selectedDate,
  onSelectDate,
}: Props) {
  return (
    <aside className="left-sidebar">
      <div className="tab-switcher">
        <button
          className={`tab-btn ${tab === "work" ? "active" : ""}`}
          onClick={() => onTabChange("work")}
        >
          Work
        </button>
        <button
          className={`tab-btn ${tab === "report" ? "active" : ""}`}
          onClick={() => onTabChange("report")}
        >
          Report
        </button>
      </div>

      <div className="left-sidebar-body">
        {/* 위젯 목록은 항상 마운트해 둔다 — 탭을 옮겨도 타이머가 계속 동작/알람하도록. */}
        <div className={`widget-host${tab === "work" ? "" : " hidden"}`}>
          <WidgetList />
        </div>
        {tab !== "work" && (
          <ul className="date-list">
            {dates.map((date) => (
              <li key={date}>
                <button
                  className={`date-item ${
                    date === selectedDate ? "active" : ""
                  }`}
                  onClick={() => onSelectDate(date)}
                >
                  {date}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="left-sidebar-footer">
        <button
          className={`settings-btn ${tab === "settings" ? "active" : ""}`}
          onClick={() => onTabChange("settings")}
        >
          <span className="settings-btn-icon">⚙</span> Settings
        </button>
      </div>
    </aside>
  );
}

export default memo(LeftSidebar);

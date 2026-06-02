import type { Tab } from "../app-view/App";

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
        {tab === "work" ? (
          <div className="sidebar-placeholder">
            <span className="placeholder-text">placeholder</span>
          </div>
        ) : (
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
    </aside>
  );
}

export default LeftSidebar;

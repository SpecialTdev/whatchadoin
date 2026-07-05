# -*- coding: utf-8 -*-
"""대시보드 시연/테스트용 가짜 events.db 생성기.

실제 collection 크레이트가 쓰는 것과 동일한 스키마·텍스트 포맷으로
최근 14일치 그럴듯한 이벤트를 만든다.

실행:  python dashboard/make_demo_db.py [출력경로]
"""

import random
import sqlite3
import sys
import time
from pathlib import Path

APPS = [
    ("Google Chrome", ["GitHub - whatchadoin", "Stack Overflow", "Notion", "YouTube"]),
    ("Visual Studio Code", ["lib.rs — whatchadoin", "App.tsx — whatchadoin", "dashboard/app.py"]),
    ("KakaoTalk", [""]),
    ("Slack", ["#dev-general", "DM: 건우"]),
    ("Terminal", ["cargo build", "npm run dev"]),
    ("Figma", ["whatchadoin UI"]),
    ("Spotify", [""]),
]
TASKS = ["대시보드 만들기", "DB export 리뷰", "카톡 집계 추가", "릴리즈 노트 작성", "버그 수정"]


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "demo-events.db"
    out.unlink(missing_ok=True)
    conn = sqlite3.connect(out)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " ts INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL)"
    )

    rng = random.Random(42)
    now_ms = int(time.time() * 1000)
    day_ms = 24 * 3600 * 1000
    rows: list[tuple[int, str, str]] = []

    for day in range(14, 0, -1):
        day_start = now_ms - day * day_ms
        # 9시~19시 사이 활동
        t = day_start + int(9.0 * 3600 * 1000) + rng.randint(0, 30 * 60 * 1000)
        end = day_start + 19 * 3600 * 1000
        while t < end:
            app, titles = rng.choice(APPS)
            title = rng.choice(titles)
            if title:
                text = f'포커스 전환 - {app} — "{title}"'
            else:
                text = f"포커스 전환 - {app} (PID {rng.randint(100, 9999)})"
            rows.append((t, "window", text))
            # 가끔 체크인 / 노트 이벤트
            if rng.random() < 0.06:
                task = rng.choice(TASKS)
                memo = "" if rng.random() < 0.6 else "\n\n집중 잘 되는 중"
                rows.append((t + 5_000, "checkin", f"체크인 — '{task}' 작업 중{memo}"))
            if rng.random() < 0.05:
                task = rng.choice(TASKS)
                action = rng.choice(["할 일 추가", "완료", "할 일 삭제"])
                rows.append((t + 8_000, "note", f"{action} — '{task}'"))
            # 점심 시간 큰 공백
            t += rng.randint(40_000, 25 * 60 * 1000)
            if 12 * 3600 * 1000 < (t - day_start) < 13 * 3600 * 1000 and rng.random() < 0.5:
                t += 60 * 60 * 1000

    rows.sort(key=lambda r: r[0])
    conn.executemany("INSERT INTO events (ts, kind, text) VALUES (?, ?, ?)", rows)
    conn.commit()
    conn.close()
    print(f"{out} 생성 완료 — {len(rows)}건")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Whatchadoin 이벤트 DB(events.db) 분석 대시보드.

collection 크레이트가 SQLite에 쌓는 events 테이블(id, ts, kind, text)을 읽어
기본 메트릭 / 앱 점유 시간 / 포커싱 횟수 / 체크인·할 일 흐름을 보여주고,
SQL 콘솔과 Python 콘솔로 자유 분석까지 할 수 있게 한다.

실행:  streamlit run dashboard/app.py
"""

from __future__ import annotations

import ast
import contextlib
import io
import os
import platform
import re
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

# ── 팔레트 (CVD 검증된 고정 순서 카테고리 팔레트) ──────────────────────────────
CATEGORICAL = [
    "#2a78d6",  # blue
    "#1baf7a",  # aqua
    "#eda100",  # yellow
    "#008300",  # green
    "#4a3aa7",  # violet
    "#e34948",  # red
    "#e87ba4",  # magenta
    "#eb6834",  # orange
]
# kind는 엔티티이므로 색을 고정 매핑한다 (필터로 개수가 바뀌어도 색이 안 바뀌게).
KIND_COLORS = {
    "window": "#2a78d6",
    "checkin": "#1baf7a",
    "note": "#eda100",
    "process": "#4a3aa7",
}
KIND_LABELS = {
    "window": "포커스 전환",
    "checkin": "체크인",
    "note": "노트/할 일",
    "process": "프로세스",
}
SEQUENTIAL_BLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
GRID = "#e1e0d9"
MUTED = "#898781"

FOCUS_PREFIX = "포커스 전환 - "
CHECKIN_RE = re.compile(r"^체크인 — '(.*)' 작업 중")
NOTE_RE = re.compile(r"^(할 일 추가|할 일 삭제|완료 취소|완료|컬럼 추가) — '(.*)'$")
PID_SUFFIX_RE = re.compile(r"^(.*) \(PID \d+\)$")

st.set_page_config(page_title="Whatchadoin 대시보드", page_icon="🕵️", layout="wide")


# ── DB 로딩 ────────────────────────────────────────────────────────────────────
def default_db_path() -> str:
    """OS별 Tauri app_data_dir의 events.db 기본 경로 추정."""
    home = Path.home()
    system = platform.system()
    if system == "Darwin":
        return str(home / "Library/Application Support/com.kunwo.whatchadoin/events.db")
    if system == "Windows":
        appdata = os.environ.get("APPDATA", str(home / "AppData/Roaming"))
        return str(Path(appdata) / "com.kunwo.whatchadoin/events.db")
    return str(home / ".local/share/com.kunwo.whatchadoin/events.db")


@st.cache_resource(show_spinner=False)
def open_readonly(db_path: str, _mtime: float) -> sqlite3.Connection:
    """읽기 전용으로 SQLite를 연다. _mtime은 파일이 갱신되면 캐시를 깨는 용도."""
    uri = f"file:{db_path}?mode=ro"
    return sqlite3.connect(uri, uri=True, check_same_thread=False)


@st.cache_data(show_spinner=False)
def load_events(db_path: str, mtime: float, tz_name: str) -> pd.DataFrame:
    conn = open_readonly(db_path, mtime)
    df = pd.read_sql_query("SELECT id, ts, kind, text FROM events ORDER BY ts, id", conn)
    tz = ZoneInfo(tz_name)
    df["dt"] = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.tz_convert(tz)
    df["date"] = df["dt"].dt.date
    df["hour"] = df["dt"].dt.hour
    df["weekday"] = df["dt"].dt.dayofweek
    return df


def parse_focus_text(text: str) -> tuple[str, str]:
    """'포커스 전환 - App — \"Title\"' / '포커스 전환 - App (PID n)' → (app, title)."""
    body = text[len(FOCUS_PREFIX):] if text.startswith(FOCUS_PREFIX) else text
    if ' — "' in body and body.endswith('"'):
        app, title = body.split(' — "', 1)
        return app.strip(), title[:-1]
    m = PID_SUFFIX_RE.match(body)
    if m:
        return m.group(1).strip(), ""
    return body.strip(), ""


@dataclass
class FocusStats:
    sessions: pd.DataFrame  # app, title, start, end, duration_s


def build_focus_sessions(events: pd.DataFrame, idle_cap_min: int) -> pd.DataFrame:
    """window 이벤트 나열에서 (앱, 시작, 끝, 점유 시간) 세션을 만든다.

    다음 포커스 전환까지를 점유 시간으로 보되, 컴퓨터를 끄거나 자리를 비운
    구간이 통째로 잡히지 않게 idle_cap 분으로 상한을 둔다.
    """
    win = events[events["kind"] == "window"].sort_values(["ts", "id"])
    if win.empty:
        return pd.DataFrame(columns=["app", "title", "start", "end", "duration_s", "date"])
    parsed = win["text"].map(parse_focus_text)
    apps = parsed.map(lambda t: t[0])
    titles = parsed.map(lambda t: t[1])
    start = win["dt"].reset_index(drop=True)
    next_start = start.shift(-1)
    cap = pd.Timedelta(minutes=idle_cap_min)
    gap = (next_start - start).fillna(cap)
    duration = gap.where(gap < cap, cap)
    out = pd.DataFrame(
        {
            "app": apps.reset_index(drop=True),
            "title": titles.reset_index(drop=True),
            "start": start,
            "end": start + duration,
            "duration_s": duration.dt.total_seconds(),
        }
    )
    out["date"] = out["start"].dt.date
    return out


def fmt_duration(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}시간 {m}분"
    if m:
        return f"{m}분 {s}초"
    return f"{s}초"


def base_layout(fig: go.Figure, height: int = 360) -> go.Figure:
    fig.update_layout(
        height=height,
        margin=dict(l=8, r=40, t=76, b=8),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif', size=13),
        title=dict(y=0.98, yanchor="top"),
        legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0),
    )
    fig.update_xaxes(gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=MUTED))
    fig.update_yaxes(gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=MUTED))
    return fig


# ── 사이드바: 데이터 소스 + 필터 ──────────────────────────────────────────────
st.sidebar.title("🕵️ Whatchadoin")

source = st.sidebar.radio("데이터 소스", ["로컬 경로", "파일 업로드"], horizontal=True)
db_path: str | None = None
if source == "로컬 경로":
    db_path = st.sidebar.text_input("events.db 경로", value=default_db_path())
    if db_path and not Path(db_path).exists():
        st.sidebar.warning("경로에 파일이 없습니다.")
        db_path = None
else:
    uploaded = st.sidebar.file_uploader(
        "events.db 업로드", type=["db", "sqlite", "sqlite3"],
        help="앱의 '데이터 내보내기'로 만든 whatchadoin-events-*.db도 그대로 열립니다.",
    )
    if uploaded is not None:
        tmp_dir = Path(tempfile.gettempdir()) / "whatchadoin-dash"
        tmp_dir.mkdir(exist_ok=True)
        tmp_path = tmp_dir / uploaded.name
        tmp_path.write_bytes(uploaded.getvalue())
        db_path = str(tmp_path)

if not db_path:
    st.title("Whatchadoin 이벤트 대시보드")
    st.info(
        "왼쪽 사이드바에서 `events.db` 경로를 지정하거나 파일을 업로드하세요.\n\n"
        "- 로컬 기본 경로 (macOS): `~/Library/Application Support/com.kunwo.whatchadoin/events.db`\n"
        "- 앱에서 내보낸 `whatchadoin-events-*.db` 파일도 열 수 있습니다.\n"
        "- 데모 데이터로 둘러보려면: `python dashboard/make_demo_db.py` 실행 후 생성된 경로를 입력"
    )
    st.stop()

tz_name = st.sidebar.selectbox("타임존", ["Asia/Seoul", "UTC"], index=0)
mtime = Path(db_path).stat().st_mtime
events_all = load_events(db_path, mtime, tz_name)

if events_all.empty:
    st.warning("events 테이블이 비어 있습니다.")
    st.stop()

min_date, max_date = events_all["date"].min(), events_all["date"].max()
st.sidebar.divider()
date_range = st.sidebar.date_input(
    "기간", value=(max(min_date, max_date - timedelta(days=13)), max_date),
    min_value=min_date, max_value=max_date,
)
if isinstance(date_range, tuple) and len(date_range) == 2:
    d_from, d_to = date_range
else:  # 한쪽만 선택된 순간
    d_from = d_to = date_range if not isinstance(date_range, tuple) else date_range[0]

kinds = st.sidebar.multiselect(
    "이벤트 종류", options=list(KIND_LABELS), default=list(KIND_LABELS),
    format_func=lambda k: f"{KIND_LABELS[k]} ({k})",
)
idle_cap = st.sidebar.slider(
    "점유 시간 상한 (분)", min_value=5, max_value=120, value=30, step=5,
    help="다음 포커스 전환이 이 시간보다 늦으면 자리 비움으로 보고 점유 시간을 여기서 자릅니다.",
)

mask = (events_all["date"] >= d_from) & (events_all["date"] <= d_to)
events = events_all[mask & events_all["kind"].isin(kinds)].copy()
focus_all = build_focus_sessions(events_all[mask], idle_cap)

app_options = focus_all.groupby("app")["duration_s"].sum().sort_values(ascending=False).index.tolist()
sel_apps = st.sidebar.multiselect("앱 필터 (점유 시간 순)", options=app_options, default=[])
focus = focus_all if not sel_apps else focus_all[focus_all["app"].isin(sel_apps)]

st.sidebar.caption(f"DB: `{db_path}`  \n이벤트 {len(events_all):,}건 · {min_date} ~ {max_date}")

# ── 본문 ──────────────────────────────────────────────────────────────────────
st.title("Whatchadoin 이벤트 대시보드")
st.caption(f"{d_from} ~ {d_to} · 타임존 {tz_name}")

tab_overview, tab_apps, tab_tasks, tab_events, tab_sql, tab_py = st.tabs(
    ["📊 개요", "🖥️ 앱 사용", "✅ 체크인·할 일", "🔎 이벤트 탐색", "🧮 SQL", "🐍 Python"]
)

# ── 📊 개요 ───────────────────────────────────────────────────────────────────
with tab_overview:
    n_focus = int((events["kind"] == "window").sum())
    n_checkin = int((events["kind"] == "checkin").sum())
    n_done = int(events["text"].str.startswith("완료 — ").sum())
    total_occupied = focus["duration_s"].sum()
    active_days = events["date"].nunique()

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("이벤트", f"{len(events):,}건")
    c2.metric("포커스 전환", f"{n_focus:,}회")
    c3.metric("총 점유 시간", fmt_duration(total_occupied))
    c4.metric("체크인", f"{n_checkin:,}회")
    c5.metric("활동한 날", f"{active_days}일")

    daily = (
        events.groupby(["date", "kind"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
    )
    daily["종류"] = daily["kind"].map(KIND_LABELS)
    fig = px.bar(
        daily, x="date", y="count", color="kind",
        color_discrete_map=KIND_COLORS, title="일별 이벤트",
        labels={"date": "", "count": "이벤트 수", "kind": "종류"},
    )
    fig.update_traces(marker_line_color="#fcfcfb", marker_line_width=1)
    for tr in fig.data:
        tr.name = KIND_LABELS.get(tr.name, tr.name)
    st.plotly_chart(base_layout(fig), use_container_width=True)

    col_a, col_b = st.columns(2)
    with col_a:
        by_kind = events.groupby("kind", as_index=False).size().rename(columns={"size": "count"})
        by_kind["label"] = by_kind["kind"].map(KIND_LABELS)
        fig = px.bar(
            by_kind.sort_values("count"), x="count", y="label", orientation="h",
            color="kind", color_discrete_map=KIND_COLORS, title="종류별 이벤트 수",
            labels={"count": "이벤트 수", "label": ""}, text="count",
        )
        fig.update_traces(
            textposition="outside", cliponaxis=False,
            marker_line_color="#fcfcfb", marker_line_width=1,
        )
        fig.update_layout(showlegend=False)
        st.plotly_chart(base_layout(fig, 300), use_container_width=True)
    with col_b:
        daily_occ = focus.groupby("date", as_index=False)["duration_s"].sum()
        daily_occ["시간"] = daily_occ["duration_s"] / 3600
        fig = px.bar(
            daily_occ, x="date", y="시간", title="일별 점유 시간 (시간)",
            labels={"date": ""}, color_discrete_sequence=["#2a78d6"],
        )
        st.plotly_chart(base_layout(fig, 300), use_container_width=True)

# ── 🖥️ 앱 사용 ───────────────────────────────────────────────────────────────
with tab_apps:
    if focus.empty:
        st.info("선택한 기간에 포커스 전환(window) 이벤트가 없습니다.")
    else:
        per_app = (
            focus.groupby("app")
            .agg(점유_초=("duration_s", "sum"), 포커싱_횟수=("app", "size"))
            .sort_values("점유_초", ascending=False)
            .reset_index()
        )
        per_app["점유_시간"] = per_app["점유_초"].map(fmt_duration)

        top_n = st.slider("표시할 앱 수", 5, 30, 12, key="topn_apps")
        top = per_app.head(top_n)

        col_a, col_b = st.columns(2)
        with col_a:
            d = top.sort_values("점유_초")
            fig = px.bar(
                d, x=d["점유_초"] / 3600, y="app", orientation="h",
                title="앱별 점유 시간 (시간)", labels={"x": "시간", "app": ""},
                color_discrete_sequence=["#2a78d6"],
                hover_data={"점유_시간": True},
            )
            st.plotly_chart(base_layout(fig, 30 * len(d) + 120), use_container_width=True)
        with col_b:
            d = top.sort_values("포커싱_횟수")
            fig = px.bar(
                d, x="포커싱_횟수", y="app", orientation="h",
                title="앱별 포커싱 횟수", labels={"포커싱_횟수": "회", "app": ""},
                color_discrete_sequence=["#1baf7a"],
            )
            st.plotly_chart(base_layout(fig, 30 * len(d) + 120), use_container_width=True)

        st.dataframe(
            per_app[["app", "점유_시간", "포커싱_횟수"]],
            use_container_width=True, hide_index=True,
        )

        st.subheader("시간대별 활동 히트맵")
        heat = (
            focus.assign(hour=focus["start"].dt.hour, weekday=focus["start"].dt.dayofweek)
            .groupby(["weekday", "hour"])["duration_s"].sum()
            .div(60)
            .reset_index(name="분")
        )
        grid = heat.pivot(index="weekday", columns="hour", values="분").reindex(
            index=range(7), columns=range(24)
        )
        fig = go.Figure(
            go.Heatmap(
                z=grid.values,
                x=[f"{h}시" for h in range(24)],
                y=["월", "화", "수", "목", "금", "토", "일"],
                colorscale=[[i / (len(SEQUENTIAL_BLUE) - 1), c] for i, c in enumerate(SEQUENTIAL_BLUE)],
                hovertemplate="%{y} %{x}<br>%{z:.0f}분<extra></extra>",
                colorbar=dict(title="분"),
            )
        )
        fig.update_layout(title="요일 × 시간대 점유 (분)")
        fig.update_yaxes(autorange="reversed")
        st.plotly_chart(base_layout(fig, 320), use_container_width=True)

        st.subheader("하루 타임라인")
        days = sorted(focus["date"].unique(), reverse=True)
        day = st.selectbox("날짜", days, format_func=str)
        day_focus = focus[focus["date"] == day].copy()
        top_apps_day = (
            day_focus.groupby("app")["duration_s"].sum().sort_values(ascending=False).head(8).index
        )
        day_focus["표시앱"] = day_focus["app"].where(day_focus["app"].isin(top_apps_day), "기타")
        color_map = {a: CATEGORICAL[i] for i, a in enumerate(top_apps_day)}
        color_map["기타"] = MUTED
        fig = px.timeline(
            day_focus, x_start="start", x_end="end", y="표시앱", color="표시앱",
            color_discrete_map=color_map, hover_data={"title": True, "app": True},
            title=f"{day} 포커스 타임라인",
        )
        fig.update_yaxes(title="", categoryorder="array", categoryarray=list(top_apps_day) + ["기타"])
        fig.update_layout(showlegend=False)
        st.plotly_chart(base_layout(fig, 30 * day_focus["표시앱"].nunique() + 160), use_container_width=True)

# ── ✅ 체크인·할 일 ───────────────────────────────────────────────────────────
with tab_tasks:
    checkins = events[events["kind"] == "checkin"].copy()
    notes = events[events["kind"] == "note"].copy()

    def parse_checkin(text: str) -> tuple[str, str]:
        m = CHECKIN_RE.match(text)
        task = m.group(1) if m else text
        memo = text.split("\n\n", 1)[1] if "\n\n" in text else ""
        return task, memo

    if checkins.empty and notes.empty:
        st.info("선택한 기간에 체크인/노트 이벤트가 없습니다.")
    else:
        parsed = notes["text"].str.extract(NOTE_RE)
        notes["action"] = parsed[0]
        notes["item"] = parsed[1]

        n_add = int((notes["action"] == "할 일 추가").sum())
        n_done = int((notes["action"] == "완료").sum())
        n_del = int((notes["action"] == "할 일 삭제").sum())
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("체크인", f"{len(checkins):,}회")
        c2.metric("할 일 추가", f"{n_add:,}건")
        c3.metric("완료", f"{n_done:,}건")
        c4.metric("삭제", f"{n_del:,}건")

        flow = (
            notes.dropna(subset=["action"])
            .groupby(["date", "action"], as_index=False).size()
            .rename(columns={"size": "count"})
        )
        if not checkins.empty:
            ck = checkins.groupby("date", as_index=False).size().rename(columns={"size": "count"})
            ck["action"] = "체크인"
            flow = pd.concat([flow, ck], ignore_index=True)
        action_colors = {
            "체크인": "#1baf7a", "할 일 추가": "#2a78d6", "완료": "#008300",
            "완료 취소": "#eda100", "할 일 삭제": "#e34948", "컬럼 추가": "#4a3aa7",
        }
        fig = px.bar(
            flow, x="date", y="count", color="action", barmode="group",
            color_discrete_map=action_colors, title="일별 작업 흐름",
            labels={"date": "", "count": "건수", "action": ""},
        )
        st.plotly_chart(base_layout(fig), use_container_width=True)

        if not checkins.empty:
            st.subheader("최근 체크인")
            ck_parsed = checkins["text"].map(parse_checkin)
            view = pd.DataFrame(
                {
                    "시각": checkins["dt"].dt.strftime("%Y-%m-%d %H:%M"),
                    "작업": ck_parsed.map(lambda t: t[0]),
                    "메모": ck_parsed.map(lambda t: t[1]),
                }
            ).iloc[::-1]
            st.dataframe(view, use_container_width=True, hide_index=True)

# ── 🔎 이벤트 탐색 ────────────────────────────────────────────────────────────
with tab_events:
    query = st.text_input("텍스트 검색", placeholder="예: Chrome, 체크인, 완료 …")
    view = events
    if query:
        view = view[view["text"].str.contains(re.escape(query), case=False, na=False)]
    st.caption(f"{len(view):,}건")
    show = pd.DataFrame(
        {
            "id": view["id"],
            "시각": view["dt"].dt.strftime("%Y-%m-%d %H:%M:%S"),
            "종류": view["kind"].map(KIND_LABELS),
            "내용": view["text"],
        }
    ).iloc[::-1]
    st.dataframe(show, use_container_width=True, hide_index=True, height=560)
    st.download_button(
        "CSV 다운로드", show.to_csv(index=False).encode("utf-8-sig"),
        file_name="whatchadoin-events.csv", mime="text/csv",
    )

# ── 🧮 SQL ────────────────────────────────────────────────────────────────────
with tab_sql:
    st.caption("DB는 읽기 전용으로 열립니다. 스키마: `events(id INTEGER, ts INTEGER(ms), kind TEXT, text TEXT)`")
    examples = {
        "일별 이벤트 수": (
            "SELECT date(ts/1000, 'unixepoch', '+9 hours') AS day, kind, COUNT(*) AS n\n"
            "FROM events GROUP BY day, kind ORDER BY day DESC, n DESC"
        ),
        "가장 많이 포커싱한 앱 (텍스트 기준)": (
            "SELECT text, COUNT(*) AS n FROM events\n"
            "WHERE kind = 'window' GROUP BY text ORDER BY n DESC LIMIT 20"
        ),
        "시간대별 체크인": (
            "SELECT strftime('%H', ts/1000, 'unixepoch', '+9 hours') AS hour, COUNT(*) AS n\n"
            "FROM events WHERE kind = 'checkin' GROUP BY hour ORDER BY hour"
        ),
    }
    picked = st.selectbox("예시 쿼리", ["(직접 입력)"] + list(examples))
    default_sql = examples.get(picked, "SELECT * FROM events ORDER BY ts DESC LIMIT 100")
    sql = st.text_area("SQL", value=default_sql, height=160, key=f"sql_{picked}")
    if st.button("실행", type="primary", key="run_sql"):
        try:
            conn = open_readonly(db_path, mtime)
            result = pd.read_sql_query(sql, conn)
            st.dataframe(result, use_container_width=True, hide_index=True)
            st.download_button(
                "결과 CSV 다운로드", result.to_csv(index=False).encode("utf-8-sig"),
                file_name="query-result.csv", mime="text/csv",
            )
        except Exception as e:  # noqa: BLE001 — 사용자 쿼리 오류는 그대로 보여준다
            st.error(f"쿼리 오류: {e}")

# ── 🐍 Python ─────────────────────────────────────────────────────────────────
with tab_py:
    st.caption(
        "아래 변수를 바로 쓸 수 있습니다 — "
        "`events`(필터 적용된 이벤트 DataFrame), `events_all`(전체), "
        "`focus`(포커스 세션: app/title/start/end/duration_s), "
        "`run_sql(sql)`(읽기 전용 쿼리 → DataFrame), `pd`, `px`, `st`. "
        "마지막 줄이 표현식이면 결과를 자동 표시합니다."
    )
    default_code = (
        "# 예시: 앱별 점유 시간 상위 10\n"
        "(focus.groupby('app')['duration_s'].sum()\n"
        "      .sort_values(ascending=False).head(10) / 3600).round(2)\n"
    )
    code = st.text_area("Python 코드", value=default_code, height=220)
    if st.button("실행", type="primary", key="run_py"):
        def run_sql(q: str) -> pd.DataFrame:
            return pd.read_sql_query(q, open_readonly(db_path, mtime))

        env = {
            "pd": pd, "px": px, "go": go, "st": st,
            "events": events, "events_all": events_all, "focus": focus,
            "run_sql": run_sql, "fmt_duration": fmt_duration,
        }
        stdout = io.StringIO()
        try:
            tree = ast.parse(code, mode="exec")
            # 노트북처럼: 마지막 문장이 표현식이면 값을 따로 평가해 표시한다.
            last_expr = None
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last_expr = ast.Expression(tree.body.pop().value)
            with contextlib.redirect_stdout(stdout):
                exec(compile(tree, "<dashboard>", "exec"), env)  # noqa: S102 — 로컬 분석 콘솔
                value = eval(compile(last_expr, "<dashboard>", "eval"), env) if last_expr else None
            if stdout.getvalue():
                st.code(stdout.getvalue())
            if value is not None:
                if isinstance(value, go.Figure):
                    st.plotly_chart(value, use_container_width=True)
                elif isinstance(value, (pd.DataFrame, pd.Series)):
                    st.dataframe(value, use_container_width=True)
                else:
                    st.write(value)
        except Exception as e:  # noqa: BLE001 — 사용자 코드 오류는 그대로 보여준다
            st.exception(e)

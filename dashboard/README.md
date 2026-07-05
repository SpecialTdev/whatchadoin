# Whatchadoin 대시보드

앱이 쌓는 `events.db`(SQLite)를 직접 열어 분석하는 Streamlit 대시보드.

## 실행

```bash
pip install -r dashboard/requirements.txt
streamlit run dashboard/app.py
```

사이드바에서 DB를 지정한다:

- **로컬 경로** — 앱이 쓰는 DB를 바로 연다 (읽기 전용이라 앱이 켜져 있어도 안전).
  - macOS: `~/Library/Application Support/com.kunwo.whatchadoin/events.db`
  - Windows: `%APPDATA%\com.kunwo.whatchadoin\events.db`
  - Linux: `~/.local/share/com.kunwo.whatchadoin/events.db`
- **파일 업로드** — 앱의 데이터 내보내기로 만든 `whatchadoin-events-*.db`도 그대로 열린다.

실제 DB가 없으면 데모 데이터로 둘러볼 수 있다:

```bash
python dashboard/make_demo_db.py   # dashboard/demo-events.db 생성
```

## 구성

| 탭 | 내용 |
|---|---|
| 📊 개요 | 이벤트 수·포커스 전환·총 점유 시간·체크인 등 기본 메트릭, 일별 추이 |
| 🖥️ 앱 사용 | 앱별 **점유 시간**·**포커싱 횟수**, 요일×시간대 히트맵, 하루 포커스 타임라인 |
| ✅ 체크인·할 일 | 체크인/할 일 추가/완료 흐름, 최근 체크인 목록(메모 포함) |
| 🔎 이벤트 탐색 | 기간·종류·텍스트 검색으로 원본 이벤트 조회 + CSV 다운로드 |
| 🧮 SQL | DB에 직접 SQL 쿼리 (읽기 전용, 예시 쿼리 내장, 결과 CSV) |
| 🐍 Python | `events`/`focus` DataFrame·`run_sql()`을 바로 쓰는 코드 콘솔 — 마지막 표현식 자동 표시, plotly Figure 렌더링 |

## 점유 시간 계산

`kind = 'window'` 이벤트(포커스 전환)를 시간순으로 놓고, 다음 전환까지의 간격을
그 앱의 점유 시간으로 본다. 자리 비움/컴퓨터 꺼짐이 통째로 잡히지 않도록
사이드바의 **점유 시간 상한**(기본 30분)에서 자른다.

## 스키마 참고

```sql
events(
  id   INTEGER PRIMARY KEY,
  ts   INTEGER,  -- unix epoch millis
  kind TEXT,     -- note | checkin | process | window
  text TEXT      -- 예: 포커스 전환 - Google Chrome — "GitHub"
)
```

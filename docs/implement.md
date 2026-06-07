my-tauri-app/
├── src/                        # Frontend Layer
│   ├── popup-view/
│   └── app-view/
│
└── src-tauri/                  # Rust Backend (Workspace Root)
    ├── Cargo.toml
    └── crates/
        ├── tauri-main/         # 조립기 (ProcessingEngine을 생성하여 App Service에 주입)
        │
        ├── app-service/        # UI 요청 처리 + ProcessingEngine을 호출하여 리포트/QA 데이터 획득
        │
        ├── collection/         # 백그라운드 추적 및 데이터 수집 파이프라인
        │
        ├── processing/         # 비즈니스 로직 핵심
        │   ├── src/
        │   │   ├── ai/         # AI API Call 로직
        │   │   ├── session/    # 세션 Segmentation 알고리즘
        │   │   └── api/        # App Service가 호출할 외부 노출 API (Trait 구현부)
        │
        └── core-shared/        # 공통 데이터 모델(ReportDto 등) 및 인터페이스(Trait) 정의

# UI
## Work tab:
![alt text](docs/res/image-work.png)

## Report tab:
![alt text](docs/res/image-report.png)

left 사이드바에 work / report를 선택할 수 있도록.
 - work 선택 시 placeholder / report 선택 시 하루 단위의 report 목록 조회 가능.
right 사이드바는 event list이다. 특정한 예를 들어 - '메신저 접속함' / '사내 게시판 접속' / '스프레드시트 on' 등의 이벤트 발생 시 log를 띄운다.

# background service - tracking notes
-> (나중에 config할 수 있도록...) 지금은 15s마다 note의 변경을 확인할 수 있도록 한다.
note 변경을, 업무 관점에서의 이벤트로 timestamp 포함해 정리한다.

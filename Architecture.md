# 시스템 아키텍처 및 기술 명세서 (Architecture)

## 1. 기술적 요구사항 및 환경 구성

본 프로젝트는 외부 클라우드나 별도 DB 서버 설치 없이 **로컬 Windows PC에서 단독으로 운영**될 수 있도록 설계되었습니다. 현재 PC에 설치된 최신 **Node.js (`v24.22.1`)**의 내장 모듈만을 100% 활용하여 외부 패키지 의존성 오류나 네트워크 제약을 원천 차단했습니다.

### 1.1 런타임 및 개발 환경
* **운영체제**: Windows 10 / 11
* **백엔드 런타임**: Node.js `v24.22.1`
  * 웹 서버: `node:http` 내장 모듈
  * 데이터베이스: `node:sqlite` (`DatabaseSync` - SQLite `3.53.4` 내장 엔진)
  * 파일 처리: `node:fs`, `node:path`
* **프론트엔드**: HTML5, CSS3 (첨부1 컬러 테마 CSS Variables), Vanilla JavaScript (ES6+)
* **버전 관리**: Git `2.55.0.windows.5`

---

## 2. 시스템 아키텍처 다이어그램

```mermaid
flowchart LR
    subgraph Browser["웹 브라우저 (사용자 / 관리자)"]
        Home["홈 화면\n(index.html)"]
        List["법령/행정규칙 목록 화면\n(list.html)"]
        Search["검색 결과 화면\n(search.html)"]
        Viewer["법령 상세 새 창\n(viewer.html)"]
        Admin["관리자 업로드 화면\n(admin.html)"]
    end

    subgraph LocalServer["Node.js 로컬 서버 (src/server.js)"]
        Router["HTTP 정적 파일 & REST API 라우터"]
        LawService["법령/행정규칙 관리 및 검색 모듈\n(src/db.js)"]
        UploadParser["Multipart 파일 업로드 처리기\n(src/uploader.js)"]
    end

    subgraph Storage["로컬 PC 저장소 (storage/)"]
        SQLite[("SQLite DB\n(storage/kcg_law.db)")]
        Files["원본 업로드 파일 폴더\n(storage/files/law, rule)"]
    end

    Home -->|검색 실행| Search
    Home -->|메뉴 클릭| List
    List -->|항목 클릭 (새 창)| Viewer
    Search -->|항목 클릭 (새 창)| Viewer
    Browser <-->|HTTP / JSON API| Router
    Router --> LawService
    Router --> UploadParser
    LawService <--> SQLite
    UploadParser --> Files
    UploadParser --> LawService
```

---

## 3. 프로젝트 디렉토리 구조

```text
c:\edu_test\
├── README.md                  # 프로젝트 종합 안내서 (한글)
├── PRD.md                     # 기능 요구사항 정의서
├── Architecture.md            # 기술 요구사항, 구조 및 모듈 역할 정의서
├── Operation.md               # 실행 방법, 사용법, 트러블슈팅(FAQ) 운영 문서
├── package.json               # 프로젝트 메타데이터 및 실행 스크립트
├── start.bat                  # 윈도우 원클릭 서버 실행 배치 파일
├── src\                       # 백엔드 서버 및 비즈니스 로직 모듈
│   ├── server.js              # 메인 HTTP 서버, 정적 파일 서빙 및 REST API 엔드포인트
│   ├── db.js                  # SQLite 데이터베이스 초기화, CRUD 및 전문 검색 모듈
│   ├── uploader.js            # Multipart/form-data 파일 파싱 및 로컬 디스크 저장 모듈
│   └── seed.js                # 초기 해양경찰 법령/행정규칙 샘플 데이터 시딩 모듈
├── public\                    # 프론트엔드 정적 웹 리소스
│   ├── css\
│   │   └── style.css          # 첨부1 색상 팔레트 및 첨부2·3 레이아웃 스타일시트
│   ├── js\
│   │   └── common.js          # 공통 유틸리티 (API 호출, 검색어 하이라이팅, 새 창 열기)
│   ├── index.html             # [사용자] 홈 화면 (첨부3 스타일)
│   ├── list.html              # [사용자] '법령' / '행정규칙' 메뉴별 파일 목록 새 화면
│   ├── search.html            # [사용자] 법령 통합 검색 결과 새 화면
│   ├── viewer.html            # [사용자] 법령 상세 내용 표시 새 창 (첨부2 스타일)
│   └── admin.html             # [관리자] 법령/행정규칙 수동 파일 업로드 및 관리 화면
├── storage\                   # 로컬 영구 데이터 저장소 (자동 생성)
│   ├── kcg_law.db             # SQLite 로컬 데이터베이스 파일
│   └── files\                 # 업로드된 원본 파일 저장 디렉토리
│       ├── law\               # '법령' 업로드 원본 파일 보관
│       └── rule\              # '행정규칙' 업로드 원본 파일 보관
└── test\                      # 자동화 통합 테스트 스크립트
    └── run_tests.js           # 요구사항별 API·업로드·검색·UI 자동 검증 테스트
```

---

## 4. 모듈별 역할 및 책임

### 4.1 백엔드 모듈 (`src/`)
1. **`src/server.js` (HTTP 서버 & 라우터)**
   * 로컬 포트(기본 `3000`)에서 HTTP 요청을 수신합니다.
   * `public/` 하위의 HTML, CSS, JS 정적 파일과 `storage/files/` 하위의 업로드 원본 파일 다운로드/뷰잉을 서빙합니다.
   * REST API 엔드포인트를 제공합니다:
     * `GET /api/laws` : 카테고리(`법령`/`행정규칙`) 필터링 및 키워드(`q`) 검색 목록 조회
     * `GET /api/laws/:id` : 특정 법령/행정규칙의 상세 본문, 부칙, 첨부파일 정보 조회
     * `POST /api/laws` : 관리자 파일 업로드(`multipart/form-data`) 및 메타데이터·본문 DB 저장
     * `PUT /api/laws/:id` : 등록된 법령/행정규칙 정보 수정
     * `DELETE /api/laws/:id` : 등록된 법령/행정규칙 및 로컬 저장 파일 삭제
     * `GET /api/stats` : 등록된 법령 및 행정규칙 건수 통계 조회
2. **`src/db.js` (데이터베이스 및 검색 엔진 모듈)**
   * Node.js 내장 `node:sqlite`를 사용하여 `storage/kcg_law.db` 파일과 `laws` 테이블을 자동 생성합니다.
   * 법령명(`title`), 공포/시행 정보(`subtitle`), 소관부서(`department`), 본문(`content`), 부칙(`addendum`), 원본 파일명(`file_name`)을 대상으로 빠른 키워드 검색(큰따옴표 구문 일치 및 다중 어절 검색 포함)을 수행합니다.
3. **`src/uploader.js` (파일 업로드 처리 모듈)**
   * 관리자 화면에서 전송된 `multipart/form-data` 요청을 파싱하여 업로드된 파일을 `storage/files/law/` 또는 `storage/files/rule/` 폴더에 안전하게 저장합니다.
   * 텍스트 형식(`.txt`, `.md`, `.html`, `.csv`, `.json`)의 파일이 업로드된 경우 UTF-8 텍스트를 자동 추출하여 본문(`content`) 필드에 색인합니다.
4. **`src/seed.js` (초기 데이터 시딩 모듈)**
   * 최초 실행 시 DB가 비어 있으면 첨부2의 `수상레저안전법`을 포함한 해양경찰 대표 법령 5건 및 행정규칙 3건의 샘플 파일과 데이터를 자동으로 생성합니다.

### 4.2 프론트엔드 모듈 (`public/`)
1. **`public/css/style.css`**
   * 첨부1의 5가지 색상(`#724D45`, `#04503E`, `#045043`, `#FE8650`, `#FD3C2D`)을 CSS 변수로 정의하고 모든 컴포넌트에 일관되게 반영합니다.
2. **`public/js/common.js`**
   * 검색어 하이라이트(`#FD3C2D` 색상 마킹), 새 창 열기(`openLawViewer(id, keyword, category)`), HTML 이스케이프, 날짜 포맷팅 등 공통 함수를 제공합니다.
3. **화면별 HTML 페이지 (`index.html`, `list.html`, `search.html`, `viewer.html`, `admin.html`)**
   * 각 요구사항에 맞춰 화면 간 이동, `홈 화면으로 돌아가기`, 목록 렌더링, 새 창 본문 표시, 파일 업로드를 수행합니다.


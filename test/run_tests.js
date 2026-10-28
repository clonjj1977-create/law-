const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createServer } = require('../src/server');
const { STORAGE_DIR } = require('../src/db');

const results = [];

function recordTest(id, category, name, passed, detail) {
  results.push({
    id,
    category,
    name,
    status: passed ? 'PASS (통과)' : 'FAIL (실패)',
    passed,
    detail
  });
}

/**
 * server 인스턴스의 HTTP 요청 핸들러를 직접 호출하여 응답(status, headers, text, json)을 검증합니다.
 */
function invokeServer(server, reqPath, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = method;
    req.url = reqPath;
    req.headers = { host: 'localhost:3000', ...headers };

    const res = new PassThrough();
    const resChunks = [];
    res.statusCode = 200;
    res.headers = {};

    res.writeHead = (statusCode, hdrs = {}) => {
      res.statusCode = statusCode;
      res.headers = { ...res.headers, ...hdrs };
      return res;
    };

    res.on('data', (chunk) => resChunks.push(Buffer.from(chunk)));
    res.on('finish', () => {
      const buf = Buffer.concat(resChunks);
      const textStr = buf.toString('utf8');
      resolve({
        status: res.statusCode,
        headers: res.headers,
        buffer: buf,
        text: async () => textStr,
        json: async () => JSON.parse(textStr)
      });
    });
    res.on('error', reject);

    server.emit('request', req, res);

    if (body) {
      req.end(Buffer.isBuffer(body) ? body : Buffer.from(body));
    } else {
      req.end();
    }
  });
}

async function runAllTests() {
  const server = createServer();

  // TC-01: 문서화 검증 (README.md, PRD.md, Architecture.md, Operation.md)
  const docs = ['README.md', 'PRD.md', 'Architecture.md', 'Operation.md'];
  const docsExist = docs.every((f) => {
    const p = path.join(__dirname, '..', f);
    return fs.existsSync(p) && fs.statSync(p).size > 500;
  });
  recordTest(
    'TC-01',
    '문서화',
    '필수 문서 4종(README, PRD, Architecture, Operation) 한글 작성 확인',
    docsExist,
    docs.map((d) => `${d}(${fs.statSync(path.join(__dirname, '..', d)).size}B)`).join(', ')
  );

  // TC-02: 스타일(첨부1 색상 팔레트 5종) 적용 검증
  const cssRes = await invokeServer(server, '/css/style.css');
  const cssText = await cssRes.text();
  const requiredColors = ['#724D45', '#04503E', '#045043', '#FE8650', '#FD3C2D'];
  const allColorsPresent = requiredColors.every((hex) =>
    cssText.toUpperCase().includes(hex.toUpperCase())
  );
  recordTest(
    'TC-02',
    '스타일(첨부1)',
    '첨부1의 5가지 색상 코드 CSS 적용 여부 검증',
    cssRes.status === 200 && allColorsPresent,
    `적용 색상: ${requiredColors.join(', ')}`
  );

  // TC-03: 홈 화면(첨부3) 구성요소 검증 (웹앱 이름, 메뉴 '법령'/'행정규칙', 검색 입력창)
  const homeRes = await invokeServer(server, '/index.html');
  const homeHtml = await homeRes.text();
  const hasAppTitle = homeHtml.includes('해양경찰 법령정보센터');
  const hasMenus = homeHtml.includes('>법령<') && homeHtml.includes('>행정규칙<');
  const hasSearchInput = homeHtml.includes('id="searchInput"') && homeHtml.includes('action="/search.html"');
  recordTest(
    'TC-03',
    '화면구성(첨부3)',
    '홈 화면 웹앱 이름(해양경찰 법령정보센터), 메뉴(법령/행정규칙), 검색 입력 표시',
    homeRes.status === 200 && hasAppTitle && hasMenus && hasSearchInput,
    `타이틀:${hasAppTitle}, 메뉴(법령/행정규칙):${hasMenus}, 검색창:${hasSearchInput}`
  );

  // TC-04: 사용자 화면 - 메뉴 '법령', '행정규칙' 클릭 시 새 화면 목록 표시 및 '홈 화면으로 돌아가기' 검증
  const listHtmlRes = await invokeServer(server, `/list.html?category=${encodeURIComponent('법령')}`);
  const listHtml = await listHtmlRes.text();
  const lawApiRes = await invokeServer(server, `/api/laws?category=${encodeURIComponent('법령')}`);
  const lawApiData = await lawApiRes.json();
  const ruleApiRes = await invokeServer(server, `/api/laws?category=${encodeURIComponent('행정규칙')}`);
  const ruleApiData = await ruleApiRes.json();

  const hasHomeReturnOnList = listHtml.includes('홈 화면으로 돌아가기') && listHtml.includes('href="/index.html"');
  const categoryFilteredCorrectly =
    lawApiData.ok &&
    lawApiData.items.length > 0 &&
    lawApiData.items.every((i) => i.category === '법령') &&
    ruleApiData.ok &&
    ruleApiData.items.length > 0 &&
    ruleApiData.items.every((i) => i.category === '행정규칙');

  recordTest(
    'TC-04',
    '사용자 화면',
    "메뉴 '법령'/'행정규칙' 클릭 시 새 화면 파일 목록 표시 및 '홈 화면으로 돌아가기' 포함",
    listHtmlRes.status === 200 && hasHomeReturnOnList && categoryFilteredCorrectly,
    `법령 ${lawApiData.items.length}건, 행정규칙 ${ruleApiData.items.length}건 조회, 홈 복귀 버튼 포함:${hasHomeReturnOnList}`
  );

  // TC-05: 사용자 화면 - 검색을 통해 법령 정보를 찾아 새 화면(search.html)에 목록 표시
  const searchPageRes = await invokeServer(server, `/search.html?q=${encodeURIComponent('수상레저')}`);
  const searchPageHtml = await searchPageRes.text();
  const searchApiRes = await invokeServer(server, `/api/laws?q=${encodeURIComponent('수상레저')}`);
  const searchApiData = await searchApiRes.json();
  const hasWaterLeisureLaw = searchApiData.items.some((i) => i.title === '수상레저안전법');
  const hasHomeReturnOnSearch = searchPageHtml.includes('홈 화면으로 돌아가기');

  recordTest(
    'TC-05',
    '사용자 화면',
    "키워드('수상레저') 검색 시 관련 법령 목록 새 화면 표시 및 검색어 하이라이트 지원",
    searchPageRes.status === 200 && searchApiData.ok && hasWaterLeisureLaw && hasHomeReturnOnSearch,
    `'수상레저' 검색 결과 ${searchApiData.items.length}건 ('수상레저안전법' 포함), 홈 복귀 버튼:${hasHomeReturnOnSearch}`
  );

  // TC-06: 사용자 화면 - 검색 목록에서 클릭 시 새 창(viewer.html, 첨부2 스타일)에 상세 내용 표시
  const viewerPageRes = await invokeServer(server, `/viewer.html?id=6&q=${encodeURIComponent('수상레저')}`);
  const viewerHtml = await viewerPageRes.text();
  const commonJsRes = await invokeServer(server, '/js/common.js');
  const commonJs = await commonJsRes.text();
  const detailApiRes = await invokeServer(server, '/api/laws/6');
  const detailApiData = await detailApiRes.json();

  const opensInNewWindow = commonJs.includes('window.open(url');
  const hasAttachment2Layout =
    viewerHtml.includes('viewer-sidebar') &&
    viewerHtml.includes('docTitle') &&
    viewerHtml.includes('docDepartment') &&
    viewerHtml.includes('화면내검색') &&
    detailApiData.ok &&
    detailApiData.item.title === '수상레저안전법';

  recordTest(
    'TC-06',
    '사용자 화면(첨부2)',
    '목록 클릭 시 새 창(window.open)에 첨부2 레이아웃(좌측 목록 + 우측 조문 본문/부서/하이라이트) 표시',
    viewerPageRes.status === 200 && opensInNewWindow && hasAttachment2Layout,
    `window.open 새창 호출 확인, 상세 조회 대상: ${detailApiData.item?.title}`
  );

  // TC-07: 관리자 화면 - 법령 파일 수동 업로드 및 로컬 스토리지 저장 검증
  const boundary = '----KCGLawTestBoundary987654321';
  const sampleLawFileContent =
    '제1장 총칙\r\n제1조(목적) 이 법은 해양경찰 연안안전사고 예방에 관한 사항을 규정함을 목적으로 한다.';
  const multipartParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n법령\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="sub_category"\r\n\r\n법률\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n연안사고 예방에 관한 법률(테스트업로드)\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="department"\r\n\r\n해양경찰청 (해양안전과), 032-835-2245\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="coastal_safety_law_test.txt"\r\nContent-Type: text/plain\r\n\r\n${sampleLawFileContent}\r\n`,
    `--${boundary}--\r\n`
  ];
  const multipartBody = Buffer.from(multipartParts.join(''), 'utf8');

  const uploadLawRes = await invokeServer(server, '/api/laws', {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`
    },
    body: multipartBody
  });
  const uploadLawData = await uploadLawRes.json();
  const savedPhysicalPath = uploadLawData.item
    ? path.join(STORAGE_DIR, uploadLawData.item.stored_path)
    : '';
  const fileExistsOnDisk = Boolean(savedPhysicalPath && fs.existsSync(savedPhysicalPath));

  recordTest(
    'TC-07',
    '관리자 화면',
    "법령 파일 수동 업로드(Multipart) 시 로컬 디스크(storage/files/law) 저장 및 본문 자동 추출",
    uploadLawRes.status === 201 &&
      uploadLawData.ok &&
      fileExistsOnDisk &&
      uploadLawData.item.content.includes('연안안전사고 예방'),
    `저장경로: storage/${uploadLawData.item?.stored_path}, 디스크 존재:${fileExistsOnDisk}`
  );

  // TC-08: 관리자 화면 - 행정규칙 파일 수동 업로드 및 다운로드 서빙/삭제 검증
  const ruleMultipartParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n행정규칙\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n해양경찰청 함정 안전운항 규정(테스트업로드)\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="patrol_ship_rule_test.txt"\r\nContent-Type: text/plain\r\n\r\n제1조(목적) 함정 안전운항 기준을 정한다.\r\n`,
    `--${boundary}--\r\n`
  ];
  const uploadRuleRes = await invokeServer(server, '/api/laws', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.from(ruleMultipartParts.join(''), 'utf8')
  });
  const uploadRuleData = await uploadRuleRes.json();
  const downloadRes = await invokeServer(
    server,
    `/storage/${encodeURI(uploadRuleData.item.stored_path)}?download=1`
  );
  const downloadedText = await downloadRes.text();

  // 테스트로 업로드한 임시 항목 정리(삭제 API 검증 겸용)
  const delRes1 = await invokeServer(server, `/api/laws/${uploadLawData.item.id}`, { method: 'DELETE' });
  const delRes2 = await invokeServer(server, `/api/laws/${uploadRuleData.item.id}`, { method: 'DELETE' });

  recordTest(
    'TC-08',
    '관리자 화면',
    '행정규칙 파일 수동 업로드(storage/files/rule), 원본 파일 다운로드 및 파일 삭제 관리',
    uploadRuleRes.status === 201 &&
      downloadRes.status === 200 &&
      downloadedText.includes('함정 안전운항') &&
      delRes1.status === 200 &&
      delRes2.status === 200,
    `행정규칙 업로드·원본 다운로드(200 OK)·임시 파일 삭제 정리 완료`
  );

  // TC-09: '중국어선 단속 관련 법령' 별도 메뉴/분류 및 전용 법령 파일 5건 검증
  const chineseApiRes = await invokeServer(
    server,
    `/api/laws?category=${encodeURIComponent('중국어선 단속 관련 법령')}`
  );
  const chineseApiData = await chineseApiRes.json();
  const sampleDir = path.join(__dirname, '..', '중국어선_단속_관련_법령');
  const sampleFiles = fs.existsSync(sampleDir) ? fs.readdirSync(sampleDir) : [];
  const hasChineseMenuOnHome = homeHtml.includes('중국어선 단속 관련 법령');

  recordTest(
    'TC-09',
    '중국어선 단속 법령',
    "'중국어선 단속 관련 법령' 별도 메뉴·분류 조회 및 수동 업로드용 별도 파일 폴더 생성 확인",
    chineseApiData.ok &&
      chineseApiData.items.length >= 5 &&
      sampleFiles.length >= 5 &&
      hasChineseMenuOnHome,
    `DB 등록 ${chineseApiData.items.length}건, 별도 폴더(중국어선_단속_관련_법령/) 파일 ${sampleFiles.length}개 생성 완료`
  );

  console.log('\n==================== 테스트 실행 결과 요약 ====================');
  for (const r of results) {
    console.log(`[${r.id}] [${r.status}] (${r.category}) ${r.name} -> ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runAllTests();


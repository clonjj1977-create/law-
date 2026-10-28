const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  STORAGE_DIR,
  getAllLaws,
  getLawById,
  createLaw,
  updateLaw,
  deleteLaw,
  getStats
} = require('./db');
const { parseMultipart, saveUploadedFile, saveTextAsLocalFile } = require('./uploader');
const { seedIfEmpty } = require('./seed');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VALID_CATEGORIES = ['법령', '행정규칙', '중국어선 단속 관련 법령'];

function normalizeCategory(cat) {
  if (VALID_CATEGORIES.includes(cat)) return cat;
  return '법령';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function collectRequestBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('업로드 파일 크기가 제한(50MB)을 초과했습니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createServer() {
  seedIfEmpty();

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(reqUrl.pathname);

      // 1. 통계 API
      if (req.method === 'GET' && pathname === '/api/stats') {
        return sendJson(res, 200, { ok: true, stats: getStats() });
      }

      // 2. 법령/행정규칙/중국어선 단속 법령 목록 및 검색 API
      if (req.method === 'GET' && pathname === '/api/laws') {
        const category = reqUrl.searchParams.get('category') || '';
        const q = reqUrl.searchParams.get('q') || '';
        const searchField = reqUrl.searchParams.get('field') || 'all';
        const items = getAllLaws({ category, q, searchField });
        return sendJson(res, 200, {
          ok: true,
          count: items.length,
          query: { category, q, searchField },
          items
        });
      }

      // 3. 단건 상세 조회 API
      const detailMatch = pathname.match(/^\/api\/laws\/(\d+)$/);
      if (req.method === 'GET' && detailMatch) {
        const law = getLawById(detailMatch[1]);
        if (!law) {
          return sendJson(res, 404, { ok: false, error: '해당 법령 또는 행정규칙을 찾을 수 없습니다.' });
        }
        return sendJson(res, 200, { ok: true, item: law });
      }

      // 4. 관리자 파일 업로드 및 신규 법령/행정규칙/중국어선 단속 법령 등록 API
      if (req.method === 'POST' && pathname === '/api/laws') {
        const contentType = req.headers['content-type'] || '';
        const bodyBuf = await collectRequestBody(req);

        let category = '법령';
        let sub_category = '';
        let title = '';
        let subtitle = '';
        let department = '해양경찰청';
        let content = '';
        let addendum = '';
        let fileMeta = null;

        if (contentType.includes('multipart/form-data')) {
          const { fields, uploadedFile } = parseMultipart(bodyBuf, contentType);
          category = normalizeCategory(fields.category);
          sub_category =
            fields.sub_category ||
            (category === '행정규칙'
              ? '훈령·예규·고시'
              : category === '중국어선 단속 관련 법령'
                ? '불법외국어선 단속법령'
                : '현행법령');
          title = (fields.title || '').trim();
          subtitle = (fields.subtitle || '').trim();
          department = (fields.department || '해양경찰청').trim();
          content = (fields.content || '').trim();
          addendum = (fields.addendum || '').trim();

          if (uploadedFile && uploadedFile.size > 0) {
            fileMeta = saveUploadedFile(uploadedFile, category, title);
            if (!title) {
              title = fileMeta.inferredTitle;
            }
            if (!content && fileMeta.extractedText) {
              content = fileMeta.extractedText;
            } else if (!content) {
              content = `[첨부파일 원문 저장 완료]\n파일명: ${fileMeta.file_name}\n우측 상단의 '원본 다운로드' 또는 내장 파일 뷰어를 통해 전체 내용을 확인하실 수 있습니다.`;
            }
          } else {
            if (!title) {
              return sendJson(res, 400, { ok: false, error: '법령/행정규칙명 또는 업로드할 파일을 지정해 주세요.' });
            }
            fileMeta = saveTextAsLocalFile(title, content, category);
          }
        } else {
          const json = JSON.parse(bodyBuf.toString('utf8') || '{}');
          category = normalizeCategory(json.category);
          sub_category =
            json.sub_category ||
            (category === '행정규칙'
              ? '훈령·예규·고시'
              : category === '중국어선 단속 관련 법령'
                ? '불법외국어선 단속법령'
                : '현행법령');
          title = (json.title || '').trim();
          subtitle = (json.subtitle || '').trim();
          department = (json.department || '해양경찰청').trim();
          content = (json.content || '').trim();
          addendum = (json.addendum || '').trim();

          if (!title) {
            return sendJson(res, 400, { ok: false, error: '법령/행정규칙명을 입력해 주세요.' });
          }
          fileMeta = saveTextAsLocalFile(title, content, category);
        }

        if (!subtitle) {
          const today = new Date().toISOString().slice(0, 10).replace(/-/g, '. ');
          subtitle = `[시행 ${today}.] [${sub_category || category} 수동등록]`;
        }

        const created = createLaw({
          category,
          sub_category,
          title,
          subtitle,
          department,
          content,
          addendum,
          file_name: fileMeta.file_name,
          stored_path: fileMeta.stored_path,
          mime_type: fileMeta.mime_type,
          file_size: fileMeta.file_size
        });

        return sendJson(res, 201, { ok: true, item: created });
      }

      // 5. 관리자 수정 API
      if (req.method === 'PUT' && detailMatch) {
        const bodyBuf = await collectRequestBody(req);
        const json = JSON.parse(bodyBuf.toString('utf8') || '{}');
        if (json.category) {
          json.category = normalizeCategory(json.category);
        }
        const updated = updateLaw(detailMatch[1], json);
        if (!updated) {
          return sendJson(res, 404, { ok: false, error: '수정할 대상을 찾을 수 없습니다.' });
        }
        return sendJson(res, 200, { ok: true, item: updated });
      }

      // 6. 관리자 삭제 API
      if (req.method === 'DELETE' && detailMatch) {
        const deleted = deleteLaw(detailMatch[1]);
        if (!deleted) {
          return sendJson(res, 404, { ok: false, error: '삭제할 대상을 찾을 수 없습니다.' });
        }
        return sendJson(res, 200, { ok: true, deletedId: Number(detailMatch[1]) });
      }

      // 7. 로컬에 저장된 업로드 원본 파일 다운로드/뷰잉 (/storage/files/...)
      if (req.method === 'GET' && pathname.startsWith('/storage/')) {
        const relPath = pathname.replace(/^\/storage\//, '');
        const safePath = path.normalize(path.join(STORAGE_DIR, relPath));
        if (!safePath.startsWith(STORAGE_DIR) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
          return sendJson(res, 404, { ok: false, error: '요청한 파일을 찾을 수 없습니다.' });
        }
        const ext = path.extname(safePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const download = reqUrl.searchParams.get('download') === '1';
        const headers = { 'Content-Type': mime };
        if (download) {
          const originalName = path.basename(safePath).replace(/^\d+_/, '');
          headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`;
        }
        res.writeHead(200, headers);
        fs.createReadStream(safePath).pipe(res);
        return;
      }

      // 8. 정적 웹 페이지 서빙 (public/)
      let filePath = pathname === '/' ? '/index.html' : pathname;
      const resolvedPath = path.normalize(path.join(PUBLIC_DIR, filePath));
      if (!resolvedPath.startsWith(PUBLIC_DIR) || !fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 - 페이지를 찾을 수 없습니다.</h1><p><a href="/">홈 화면으로 돌아가기</a></p>');
        return;
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      fs.createReadStream(resolvedPath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || '서버 내부 오류가 발생했습니다.' });
    }
  });

  return server;
}

if (require.main === module) {
  const preferredPort = Number(process.env.PORT || 3001);
  const server = createServer();

  function startListening(portToTry) {
    server.once('error', (err) => {
      if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && portToTry === 3000) {
        console.log(`[안내] 3000번 포트가 Windows 시스템에서 예약되어 있어 3001번 포트로 자동 전환합니다.`);
        startListening(3001);
      } else {
        console.error(`서버 시작 오류 (${err.code}):`, err.message);
        process.exit(1);
      }
    });

    server.listen(portToTry, '127.0.0.1', () => {
      console.log(`========================================================`);
      console.log(`  해양경찰 법령정보센터 서버가 시작되었습니다!`);
      console.log(`  - 홈 화면   : http://localhost:${portToTry}/`);
      console.log(`  - 관리자 화면: http://localhost:${portToTry}/admin.html`);
      console.log(`========================================================`);
    });
  }

  startListening(preferredPort);
}

module.exports = { createServer };

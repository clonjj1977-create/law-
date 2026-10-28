const fs = require('node:fs');
const path = require('node:path');
const { STORAGE_DIR, FILES_LAW_DIR, FILES_RULE_DIR, FILES_CHINESE_LAW_DIR } = require('./db');

function getCategoryFolderInfo(category) {
  if (category === '행정규칙') {
    return { targetDir: FILES_RULE_DIR, subFolder: 'files/rule' };
  }
  if (category === '중국어선 단속 관련 법령') {
    return { targetDir: FILES_CHINESE_LAW_DIR, subFolder: 'files/chinese_vessel' };
  }
  return { targetDir: FILES_LAW_DIR, subFolder: 'files/law' };
}

/**
 * 버퍼에서 텍스트(UTF-8 우선, 깨짐 감지 시 EUC-KR 폴백)를 추출합니다.
 */
function decodeTextBuffer(buffer) {
  const utf8Text = buffer.toString('utf8');
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }
  try {
    const decoder = new TextDecoder('euc-kr');
    return decoder.decode(buffer);
  } catch (_) {
    return utf8Text;
  }
}

/**
 * Multipart/form-data 바디 버퍼를 파싱하여 fields와 file 객체를 반환합니다.
 */
function parseMultipart(bodyBuffer, contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Multipart boundary를 찾을 수 없습니다.');
  }
  const boundaryStr = '--' + (match[1] || match[2]).trim();
  const boundaryBuf = Buffer.from(boundaryStr, 'utf8');

  const fields = {};
  let uploadedFile = null;

  let start = bodyBuffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const nextStart = bodyBuffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (nextStart === -1) break;

    let part = bodyBuffer.subarray(start + boundaryBuf.length, nextStart);
    if (part.subarray(0, 2).toString() === '\r\n') {
      part = part.subarray(2);
    }
    if (part.subarray(part.length - 2).toString() === '\r\n') {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
      const contentBuf = part.subarray(headerEnd + 4);

      const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
      const filenameMatch = rawHeaders.match(/filename="([^"]*)"/i);
      const typeMatch = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch && filenameMatch[1]) {
          uploadedFile = {
            fieldName,
            originalName: path.basename(filenameMatch[1]),
            mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            buffer: contentBuf,
            size: contentBuf.length
          };
        } else {
          fields[fieldName] = contentBuf.toString('utf8').trim();
        }
      }
    }

    start = nextStart;
  }

  return { fields, uploadedFile };
}

/**
 * 업로드된 파일을 로컬 디스크(storage/files/law, rule, chinese_vessel)에 저장하고 메타데이터를 반환합니다.
 */
function saveUploadedFile(uploadedFile, category, titleFallback = '') {
  const { targetDir, subFolder } = getCategoryFolderInfo(category);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const safeOriginal = uploadedFile.originalName.replace(/[<>:"/\\|?*]/g, '_');
  const timestamp = Date.now();
  const savedFileName = `${timestamp}_${safeOriginal}`;
  const fullPath = path.join(targetDir, savedFileName);

  fs.writeFileSync(fullPath, uploadedFile.buffer);

  const ext = path.extname(safeOriginal).toLowerCase();
  let extractedText = '';
  if (['.txt', '.md', '.html', '.htm', '.csv', '.json'].includes(ext) || uploadedFile.mimeType.startsWith('text/')) {
    extractedText = decodeTextBuffer(uploadedFile.buffer);
  }

  return {
    file_name: safeOriginal,
    stored_path: `${subFolder}/${savedFileName}`,
    mime_type: uploadedFile.mimeType,
    file_size: uploadedFile.size,
    extractedText,
    inferredTitle: path.basename(safeOriginal, ext) || titleFallback
  };
}

/**
 * 본문 텍스트만 입력하여 등록한 경우에도 로컬 파일로 보관되도록 텍스트 파일을 자동 생성합니다.
 */
function saveTextAsLocalFile(title, content, category) {
  const { targetDir, subFolder } = getCategoryFolderInfo(category);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const safeTitle = (title || '법령문서').replace(/[<>:"/\\|?*\s]+/g, '_');
  const fileName = `${safeTitle}.txt`;
  const savedFileName = `${Date.now()}_${fileName}`;
  const fullPath = path.join(targetDir, savedFileName);
  const buf = Buffer.from(content || '', 'utf8');

  fs.writeFileSync(fullPath, buf);

  return {
    file_name: fileName,
    stored_path: `${subFolder}/${savedFileName}`,
    mime_type: 'text/plain; charset=utf-8',
    file_size: buf.length
  };
}

module.exports = {
  decodeTextBuffer,
  parseMultipart,
  saveUploadedFile,
  saveTextAsLocalFile
};

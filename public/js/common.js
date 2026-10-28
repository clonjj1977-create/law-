/**
 * 해양경찰 법령정보센터 프론트엔드 공통 스크립트
 */

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 검색어(q)와 일치하는 문자열을 첨부1의 #FD3C2D 색상(<mark class="search-highlight">)으로 강조합니다.
 */
function highlightText(rawText, query) {
  const safeText = escapeHtml(rawText);
  if (!query || !query.trim()) return safeText;

  const cleanQ = query.trim().replace(/^"(.+)"$/, '$1');
  const terms = cleanQ.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return safeText;

  const pattern = terms.map(escapeRegExp).join('|');
  const regex = new RegExp(`(${pattern})`, 'gi');
  return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

/**
 * 본문에서 검색어 주변 발췌문(Snippet)을 생성합니다.
 */
function createSnippet(content, query, maxLen = 180) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const cleanQ = (query || '').trim().replace(/^"(.+)"$/, '$1');
  const firstTerm = cleanQ.split(/\s+/).filter(Boolean)[0];

  if (!firstTerm) {
    const sliced = text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
    return escapeHtml(sliced);
  }

  const idx = text.toLowerCase().indexOf(firstTerm.toLowerCase());
  if (idx === -1) {
    const sliced = text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
    return highlightText(sliced, query);
  }

  const start = Math.max(0, idx - 45);
  const end = Math.min(text.length, idx + maxLen - 45);
  const prefix = start > 0 ? '... ' : '';
  const suffix = end < text.length ? ' ...' : '';
  return prefix + highlightText(text.slice(start, end), query) + suffix;
}

/**
 * 목록에서 항목 클릭 시 새 창(팝업/새 탭)에 상세 내용 화면(viewer.html)을 엽니다.
 */
function openLawViewer(id, q = '', category = '') {
  const params = new URLSearchParams();
  params.set('id', String(id));
  if (q) params.set('q', q);
  if (category) params.set('category', category);

  const url = `/viewer.html?${params.toString()}`;
  const winFeatures = 'width=1280,height=860,menubar=no,toolbar=no,location=yes,status=yes,resizable=yes,scrollbars=yes';
  const newWin = window.open(url, `kcg_law_viewer_${id}`, winFeatures);
  if (newWin) {
    newWin.focus();
  } else {
    // 팝업 차단 시 새 탭/현재 창 폴백
    window.open(url, '_blank');
  }
}

/**
 * 바이트 크기를 읽기 좋은 단위로 변환합니다.
 */
function formatFileSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 카테고리에 따른 배지 CSS 클래스를 반환합니다.
 */
function getBadgeClass(category) {
  if (category === '행정규칙') return 'badge-rule';
  if (category === '중국어선 단속 관련 법령') return 'badge-chinese';
  return 'badge-law';
}


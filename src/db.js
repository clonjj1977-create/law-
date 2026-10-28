const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const IS_VERCEL = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const BUNDLED_STORAGE_DIR = path.join(__dirname, '..', 'storage');
const STORAGE_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'kcg_law_storage')
  : BUNDLED_STORAGE_DIR;

const FILES_LAW_DIR = path.join(STORAGE_DIR, 'files', 'law');
const FILES_RULE_DIR = path.join(STORAGE_DIR, 'files', 'rule');
const FILES_CHINESE_LAW_DIR = path.join(STORAGE_DIR, 'files', 'chinese_vessel');
const MANUAL_SAMPLE_DIR = IS_VERCEL
  ? path.join(STORAGE_DIR, '중국어선_단속_관련_법령')
  : path.join(__dirname, '..', '중국어선_단속_관련_법령');
const DB_PATH = path.join(STORAGE_DIR, 'kcg_law.db');
const SNAPSHOT_JSON_PATH = path.join(BUNDLED_STORAGE_DIR, 'kcg_law_snapshot.json');
const JSON_FALLBACK_PATH = path.join(STORAGE_DIR, 'kcg_law_fallback.json');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureDirectories() {
  for (const dir of [STORAGE_DIR, FILES_LAW_DIR, FILES_RULE_DIR, FILES_CHINESE_LAW_DIR, MANUAL_SAMPLE_DIR]) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (_) {
      // 읽기 전용 환경 예외 무시
    }
  }

  // Vercel 환경인 경우 번들링된 storage 파일들을 /tmp/kcg_law_storage 로 초기 복사
  if (IS_VERCEL) {
    try {
      copyDirRecursive(BUNDLED_STORAGE_DIR, STORAGE_DIR);
    } catch (_) {
      // 복사 예외 무시
    }
  }
}

ensureDirectories();

let db = null;
let useSqlite = false;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  useSqlite = true;
} catch (_) {
  useSqlite = false;
}

function syncSnapshotFromSqlite() {
  if (!useSqlite || IS_VERCEL) return;
  try {
    const items = db.prepare(`SELECT * FROM laws ORDER BY id ASC`).all();
    const lastId = items.reduce((max, i) => Math.max(max, Number(i.id || 0)), 0);
    fs.writeFileSync(SNAPSHOT_JSON_PATH, JSON.stringify({ lastId, items }, null, 2), 'utf8');
  } catch (_) {
    // 스냅샷 저장 오류 무시
  }
}

function initAndMigrateSchema() {
  if (!useSqlite) {
    if (!fs.existsSync(JSON_FALLBACK_PATH)) {
      if (fs.existsSync(SNAPSHOT_JSON_PATH)) {
        fs.copyFileSync(SNAPSHOT_JSON_PATH, JSON_FALLBACK_PATH);
      } else {
        fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify({ lastId: 0, items: [] }, null, 2), 'utf8');
      }
    }
    return;
  }

  const tableInfo = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='laws'`)
    .get();

  if (!tableInfo) {
    db.exec(`
      CREATE TABLE laws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        sub_category TEXT DEFAULT '현행법령',
        title TEXT NOT NULL,
        subtitle TEXT DEFAULT '',
        department TEXT DEFAULT '해양경찰청',
        content TEXT NOT NULL,
        addendum TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        stored_path TEXT DEFAULT '',
        mime_type TEXT DEFAULT 'text/plain',
        file_size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `);
  } else if (tableInfo.sql && tableInfo.sql.includes("CHECK(category IN ('법령', '행정규칙'))")) {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE laws_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        sub_category TEXT DEFAULT '현행법령',
        title TEXT NOT NULL,
        subtitle TEXT DEFAULT '',
        department TEXT DEFAULT '해양경찰청',
        content TEXT NOT NULL,
        addendum TEXT DEFAULT '',
        file_name TEXT DEFAULT '',
        stored_path TEXT DEFAULT '',
        mime_type TEXT DEFAULT 'text/plain',
        file_size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      INSERT INTO laws_new SELECT * FROM laws;
      DROP TABLE laws;
      ALTER TABLE laws_new RENAME TO laws;
      COMMIT;
    `);
  }

  syncSnapshotFromSqlite();
}

initAndMigrateSchema();

function readJsonStore() {
  try {
    return JSON.parse(fs.readFileSync(JSON_FALLBACK_PATH, 'utf8'));
  } catch (_) {
    return { lastId: 0, items: [] };
  }
}

function writeJsonStore(store) {
  fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function getAllLaws({ category = '', q = '', searchField = 'all' } = {}) {
  const trimmedQ = (q || '').trim();
  const exactMatch = trimmedQ.match(/^"(.+)"$/);
  const terms = trimmedQ ? (exactMatch ? [exactMatch[1]] : trimmedQ.split(/\s+/).filter(Boolean)) : [];

  if (!useSqlite) {
    const store = readJsonStore();
    return store.items.filter((item) => {
      if (category && category !== '전체' && item.category !== category) return false;
      for (const term of terms) {
        const lower = term.toLowerCase();
        if (searchField === 'title') {
          if (!(item.title || '').toLowerCase().includes(lower)) return false;
        } else if (searchField === 'content') {
          const hay = `${item.content || ''} ${item.addendum || ''}`.toLowerCase();
          if (!hay.includes(lower)) return false;
        } else {
          const hay = `${item.title || ''} ${item.subtitle || ''} ${item.department || ''} ${item.content || ''} ${item.addendum || ''} ${item.file_name || ''} ${item.category || ''}`.toLowerCase();
          if (!hay.includes(lower)) return false;
        }
      }
      return true;
    });
  }

  let sql = `
    SELECT id, category, sub_category, title, subtitle, department,
           content, addendum, file_name, stored_path, mime_type, file_size,
           created_at, updated_at
    FROM laws
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== '전체') {
    sql += ` AND category = ?`;
    params.push(category);
  }

  for (const term of terms) {
    const likeTerm = `%${term}%`;
    if (searchField === 'title') {
      sql += ` AND title LIKE ?`;
      params.push(likeTerm);
    } else if (searchField === 'content') {
      sql += ` AND (content LIKE ? OR addendum LIKE ?)`;
      params.push(likeTerm, likeTerm);
    } else {
      sql += ` AND (title LIKE ? OR subtitle LIKE ? OR department LIKE ? OR content LIKE ? OR addendum LIKE ? OR file_name LIKE ? OR category LIKE ?)`;
      params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
    }
  }

  sql += ` ORDER BY id ASC`;
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function getLawById(id) {
  if (!useSqlite) {
    const store = readJsonStore();
    return store.items.find((i) => i.id === Number(id)) || null;
  }
  const stmt = db.prepare(`SELECT * FROM laws WHERE id = ?`);
  return stmt.get(Number(id)) || null;
}

function createLaw(data) {
  const defaultSub =
    data.category === '행정규칙'
      ? '훈령·예규·고시'
      : data.category === '중국어선 단속 관련 법령'
      ? '불법외국어선 단속법령'
      : '현행법령';

  if (!useSqlite) {
    const store = readJsonStore();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const newItem = {
      id: ++store.lastId,
      category: data.category || '법령',
      sub_category: data.sub_category || defaultSub,
      title: data.title,
      subtitle: data.subtitle || '',
      department: data.department || '해양경찰청',
      content: data.content || '',
      addendum: data.addendum || '',
      file_name: data.file_name || '',
      stored_path: data.stored_path || '',
      mime_type: data.mime_type || 'text/plain',
      file_size: Number(data.file_size || 0),
      created_at: now,
      updated_at: now
    };
    store.items.push(newItem);
    writeJsonStore(store);
    return newItem;
  }

  const stmt = db.prepare(`
    INSERT INTO laws (
      category, sub_category, title, subtitle, department,
      content, addendum, file_name, stored_path, mime_type, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.category || '법령',
    data.sub_category || defaultSub,
    data.title,
    data.subtitle || '',
    data.department || '해양경찰청',
    data.content || '',
    data.addendum || '',
    data.file_name || '',
    data.stored_path || '',
    data.mime_type || 'text/plain',
    Number(data.file_size || 0)
  );
  syncSnapshotFromSqlite();
  return getLawById(result.lastInsertRowid);
}

function updateLaw(id, data) {
  const existing = getLawById(id);
  if (!existing) return null;

  if (!useSqlite) {
    const store = readJsonStore();
    const idx = store.items.findIndex((i) => i.id === Number(id));
    if (idx === -1) return null;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    store.items[idx] = {
      ...existing,
      category: data.category ?? existing.category,
      sub_category: data.sub_category ?? existing.sub_category,
      title: data.title ?? existing.title,
      subtitle: data.subtitle ?? existing.subtitle,
      department: data.department ?? existing.department,
      content: data.content ?? existing.content,
      addendum: data.addendum ?? existing.addendum,
      file_name: data.file_name ?? existing.file_name,
      stored_path: data.stored_path ?? existing.stored_path,
      mime_type: data.mime_type ?? existing.mime_type,
      file_size: Number(data.file_size ?? existing.file_size),
      updated_at: now
    };
    writeJsonStore(store);
    return store.items[idx];
  }

  const stmt = db.prepare(`
    UPDATE laws
    SET category = ?,
        sub_category = ?,
        title = ?,
        subtitle = ?,
        department = ?,
        content = ?,
        addendum = ?,
        file_name = ?,
        stored_path = ?,
        mime_type = ?,
        file_size = ?,
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);

  stmt.run(
    data.category ?? existing.category,
    data.sub_category ?? existing.sub_category,
    data.title ?? existing.title,
    data.subtitle ?? existing.subtitle,
    data.department ?? existing.department,
    data.content ?? existing.content,
    data.addendum ?? existing.addendum,
    data.file_name ?? existing.file_name,
    data.stored_path ?? existing.stored_path,
    data.mime_type ?? existing.mime_type,
    Number(data.file_size ?? existing.file_size),
    Number(id)
  );

  syncSnapshotFromSqlite();
  return getLawById(id);
}

function deleteLaw(id) {
  const existing = getLawById(id);
  if (!existing) return false;

  if (existing.stored_path) {
    const fullPath = path.join(STORAGE_DIR, existing.stored_path);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (_) {
        // 파일 삭제 실패 무시
      }
    }
  }

  if (!useSqlite) {
    const store = readJsonStore();
    store.items = store.items.filter((i) => i.id !== Number(id));
    writeJsonStore(store);
    return true;
  }

  const stmt = db.prepare(`DELETE FROM laws WHERE id = ?`);
  stmt.run(Number(id));
  syncSnapshotFromSqlite();
  return true;
}

function getStats() {
  if (!useSqlite) {
    const store = readJsonStore();
    const total = store.items.length;
    const lawCount = store.items.filter((i) => i.category === '법령').length;
    const ruleCount = store.items.filter((i) => i.category === '행정규칙').length;
    const chineseLawCount = store.items.filter((i) => i.category === '중국어선 단속 관련 법령').length;
    return { total, lawCount, ruleCount, chineseLawCount };
  }

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM laws`).get().cnt;
  const lawCount = db.prepare(`SELECT COUNT(*) AS cnt FROM laws WHERE category = '법령'`).get().cnt;
  const ruleCount = db.prepare(`SELECT COUNT(*) AS cnt FROM laws WHERE category = '행정규칙'`).get().cnt;
  const chineseLawCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM laws WHERE category = '중국어선 단속 관련 법령'`)
    .get().cnt;
  return { total, lawCount, ruleCount, chineseLawCount };
}

module.exports = {
  db,
  STORAGE_DIR,
  BUNDLED_STORAGE_DIR,
  FILES_LAW_DIR,
  FILES_RULE_DIR,
  FILES_CHINESE_LAW_DIR,
  MANUAL_SAMPLE_DIR,
  ensureDirectories,
  getAllLaws,
  getLawById,
  createLaw,
  updateLaw,
  deleteLaw,
  getStats
};

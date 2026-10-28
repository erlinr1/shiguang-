/* =========================================================
   拾词 WordGleam — generated file
   请不要直接编辑本文件。
   源码碎片：src/app/*.js
   重新拼装：node tools/build-app.js
   ========================================================= */
(function () {
  'use strict';

/* ===== 00-boot.js ===== */
/* Boot: data guard + shared constants. Keep this piece tiny. */
/* =========================================================
   拾词 WordGleam
   A local-first vocabulary studio for 初中 / 高中 English.
   ========================================================= */

  const DATA = window.WORD_DATA;
  if (!DATA || !Array.isArray(DATA.words)) {
    document.getElementById('view').innerHTML = '<div class="empty-state"><h3>词库加载失败</h3><p>请确认 data/words.js 文件存在，并通过本地服务器打开页面。</p></div>';
    const boot = document.getElementById('boot-screen');
    if (boot) boot.classList.add('is-gone');
    return;
  }

  const APP_VERSION = '0.1.0';
  const STATE_VERSION = 3;
  // Never rename STORE_KEY: old installs must keep their data.
  const STORE_KEY = 'shici.state.v1';
  const DAY_MS = 86400000;
  const MAX_QUEUE = 60;

  // Optional fields are normalized once, so future wordbook data can omit them
  // without breaking pages. Keep this tolerant: extra fields are preserved.
  const WORDS = (Array.isArray(DATA.words) ? DATA.words : [])
    .filter(w => w && w.id && w.w)
    .map(w => ({
      ...w,
      tr: w.tr || '',
      ph: w.ph || w.phUS || w.phUK || '',
      levels: Array.isArray(w.levels) && w.levels.length ? w.levels : ['senior'],
      rank: Number.isFinite(w.rank) ? w.rank : 0,
      phrase: !!w.phrase,
      proper: !!w.proper,
      example: Array.isArray(w.example) && w.example.length === 2 ? w.example : null,
    }));
  const WORD_BY_ID = new Map(WORDS.map(w => [w.id, w]));

  // Feature flags are intentionally simple: future modules can switch a feature
  // off without deleting its code. Unknown flags default to on.
  const FEATURES = {
    spelling: true,
    notes: true,
    pwa: true,
  };
  function isFeatureEnabled(name) { return FEATURES[name] !== false; }
  function registerFeature(name, enabled = true) { FEATURES[name] = !!enabled; }

  // Action registry lives early so page pieces can register actions at load time.
  const CUSTOM_ACTIONS = new Map();
  function registerAction(name, handler) {
    if (typeof handler !== 'function') throw new Error('registerAction needs a function');
    CUSTOM_ACTIONS.set(name, handler);
  }

  const BOOK_LABELS = {
    junior: '初中词库',
    senior: '高中词库',
    zhuanshengben: '专升本词库',
    all: '全部词库',
  };
  function bookLabel(book) { return BOOK_LABELS[book] || '词库'; }

  const appEl = document.getElementById('app-shell');
  const viewEl = document.getElementById('view');
  const overlayEl = document.getElementById('overlay-root');
  const toastEl = document.getElementById('toast-root');

  const PAGE_META = {
    today: ['TODAY', '今日'],
    library: ['LIBRARY', '词库'],
    review: ['REVIEW', '复习'],
    stats: ['PROGRESS', '统计'],
    settings: ['SETTINGS', '设置'],
  };

  const ui = {
    route: 'today',
    libraryQuery: '',
    libraryFilter: 'all',
    libraryPage: 1,
    libraryLimit: 60,
    statsPage: 1,
    libraryShuffle: false,
    libraryShuffleSeed: '',
    session: null,
    spell: null,
    onboard: { step: 1, book: 'senior', goal: 20, name: '单词旅人' },
    modalOpen: false,
    onboardOpen: false,
  };

  let state = defaultState();
  let saveTimer = null;
  let searchTimer = null;


/* ===== 01-utils.js ===== */
/* ---------------- Utilities ---------------- */
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function parseKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  }
  function addDays(n, base = new Date()) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / DAY_MS);
  }
  function weekdayCN(date) { return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]; }
  function monthCN(date) { return `${date.getMonth() + 1}月`; }
  function pct(n, d) { return d <= 0 ? 0 : Math.max(0, Math.min(100, Math.round(n / d * 100))); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function uniqBy(arr, fn) {
    const seen = new Set();
    return arr.filter(item => { const k = fn(item); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function debounceSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  }


/* ===== 02-state.js ===== */
/* ---------------- State ---------------- */
  const STATE_MIGRATIONS = new Map();

  /**
   * Register a migration from one schema version to the next.
   * Future feature pieces can call this before init(); init() runs last.
   */
  function registerStateMigration(fromVersion, migrate) {
    STATE_MIGRATIONS.set(Number(fromVersion), migrate);
  }

  function migrateState(raw) {
    let data = raw && typeof raw === 'object' ? { ...raw } : {};
    let version = Number(data.version) || 1;
    while (version < STATE_VERSION) {
      const migrate = STATE_MIGRATIONS.get(version);
      if (!migrate) break;
      data = migrate(data) || data;
      version += 1;
      data.version = version;
    }
    data.version = STATE_VERSION;
    return data;
  }

  function sanitizeProgress(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [wordId, value] of Object.entries(raw)) {
      if (WORD_BY_ID.has(wordId) && value && typeof value === 'object') {
        out[wordId] = { ...value };
      }
    }
    return out;
  }

  function defaultState() {
    return {
      version: STATE_VERSION,
      appVersion: APP_VERSION,
      created: new Date().toISOString(),
      profile: {
        name: '单词旅人',
        onboarded: false,
        book: 'senior',
        dailyGoal: 20,
        autoSpeak: true,
        accent: 'us',
        theme: 'light',
        shuffle: false,
        reminder: { enabled: false, time: '20:00', lastFired: '' },
      },
      progress: {},
      favorites: [],
      notes: {},
      mistakeExcluded: [],
      days: {},
      streak: { current: 0, best: 0, last: '' },
      stats: { totalNew: 0, totalReviews: 0, correct: 0, wrong: 0, spell: 0, seconds: 0 },
      customBooks: {},
      spellMode: 'word',
      spellSource: 'learned',
      session: null,
    };
  }

  /**
   * v1 -> v2: user wordbooks, spell mode, resumable session.
   * All fields are additive so a v1 backup still imports cleanly.
   */
  registerStateMigration(1, (data) => {
    const next = { ...data };
    if (!next.customBooks || typeof next.customBooks !== 'object') next.customBooks = {};
    if (!next.spellMode) next.spellMode = 'word';
    if (!('session' in next)) next.session = null;
    return next;
  });

  /**
   * v2 -> v3: shuffle mode and "only learned words" spell source.
   */
  registerStateMigration(2, (data) => {
    const next = { ...data };
    const profile = { ...(next.profile || {}) };
    if (typeof profile.shuffle !== 'boolean') profile.shuffle = false;
    next.profile = profile;
    if (!next.spellSource) next.spellSource = 'auto';
    return next;
  });

  const IDB_NAME = 'shici-db';
  const IDB_STORE = 'state';
  let idbPromise = null;
  let idbSaveTimer = null;
  let pendingSerialized = null;

  function openStateDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb open failed'));
    });
    return idbPromise;
  }

  function idbPut(value) {
    return openStateDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, 'state');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('idb write failed'));
    }));
  }

  function idbGet() {
    return openStateDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('state');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('idb read failed'));
    }));
  }

  function applySavedState(parsed) {
    state = {
      ...defaultState(),
      ...parsed,
      profile: { ...defaultState().profile, ...(parsed.profile || {}) },
      streak: { ...defaultState().streak, ...(parsed.streak || {}) },
      stats: { ...defaultState().stats, ...(parsed.stats || {}) },
      customBooks: parsed.customBooks && typeof parsed.customBooks === 'object' ? parsed.customBooks : {},
      spellMode: ['word', 'meaning', 'audio'].includes(parsed.spellMode) ? parsed.spellMode : 'word',
      spellSource: ['learned', 'all', 'auto'].includes(parsed.spellSource) ? parsed.spellSource : 'learned',
      session: parsed.session && typeof parsed.session === 'object' ? parsed.session : null,
      progress: {},
      favorites: [],
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      mistakeExcluded: [],
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    };
    // Imported wordbooks must exist before we validate ids against WORD_BY_ID.
    rebuildCustomBooks();
    state.progress = sanitizeProgress(parsed.progress);
    state.favorites = Array.isArray(parsed.favorites) ? parsed.favorites.filter(id => WORD_BY_ID.has(id)) : [];
    state.mistakeExcluded = Array.isArray(parsed.mistakeExcluded)
      ? parsed.mistakeExcluded.filter(id => WORD_BY_ID.has(id)) : [];
  }

  async function loadState() {
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (err) {
      console.warn('Could not read localStorage state', err);
    }
    if (!parsed) {
      try {
        const backup = await idbGet();
        if (backup) {
          parsed = backup;
          // Restore the primary copy so the next launch is instant.
          localStorage.setItem(STORE_KEY, JSON.stringify(backup));
        }
      } catch (err) {
        console.warn('Could not read IndexedDB backup', err);
      }
    }
    if (parsed) applySavedState(migrateState(parsed));
  }

  function flushIdbBackup() {
    if (idbSaveTimer) { clearTimeout(idbSaveTimer); idbSaveTimer = null; }
    if (!pendingSerialized) return;
    const raw = pendingSerialized;
    pendingSerialized = null;
    try { idbPut(JSON.parse(raw)).catch(() => {}); } catch {}
  }

  function save() {
    state.version = STATE_VERSION;
    state.appVersion = APP_VERSION;
    state.lastSavedAt = new Date().toISOString();
    let serialized = '';
    try {
      serialized = JSON.stringify(state);
      localStorage.setItem(STORE_KEY, serialized);
    } catch (err) {
      toast('本地存储空间不足，进度可能无法保存', 'close');
    }
    // Redundant copy: survives a localStorage clear. Delay the full-state
    // clone/write so rapid grading does not cause mobile jank.
    if (serialized) {
      pendingSerialized = serialized;
      if (idbSaveTimer) clearTimeout(idbSaveTimer);
      idbSaveTimer = setTimeout(flushIdbBackup, 1200);
    }
  }

  function applyTheme() {
    const theme = state.profile.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = `<use href="#${theme === 'dark' ? 'i-sun' : 'i-moon'}"/>`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#111814' : '#2f5d50');
  }

  function getDay(key = dateKey()) {
    return state.days[key] || { new: 0, review: 0, correct: 0, wrong: 0, spell: 0, seconds: 0, newIds: [], reviewIds: [] };
  }
  function ensureDay(key = dateKey()) {
    if (!state.days[key]) {
      state.days[key] = { new: 0, review: 0, correct: 0, wrong: 0, spell: 0, seconds: 0, newIds: [], reviewIds: [] };
    }
    const d = state.days[key];
    if (!Array.isArray(d.newIds)) d.newIds = [];
    if (!Array.isArray(d.reviewIds)) d.reviewIds = [];
    return d;
  }

  function normalizeStreak() {
    const last = state.streak.last;
    if (!last) { state.streak.current = 0; return; }
    if (daysBetween(last, dateKey()) > 1) state.streak.current = 0;
  }

  function touchStudy() {
    const today = dateKey();
    if (state.streak.last === today) return;
    if (state.streak.last && daysBetween(state.streak.last, today) === 1) {
      state.streak.current = (state.streak.current || 0) + 1;
    } else {
      state.streak.current = 1;
    }
    state.streak.best = Math.max(state.streak.best || 0, state.streak.current);
    state.streak.last = today;
  }


/* ===== 03-vocab.js ===== */
/* ---------------- Vocabulary queries ---------------- */
  const bookCache = new Map();
  const CUSTOM_BOOKS = new Map();

  /**
   * Future feature pieces can add a wordbook without changing the query layer:
   * registerBook('cet4', { label: '四级词库', filter: w => w.levels.includes('cet4') })
   */
  function registerBook(key, options = {}) {
    if (!key) throw new Error('registerBook needs a key');
    BOOK_LABELS[key] = options.label || key;
    CUSTOM_BOOKS.set(key, options);
    bookCache.delete(key);
  }

  function bookWords(book) {
    if (bookCache.has(book)) return bookCache.get(book);
    let list;
    if (book === 'junior') list = WORDS.filter(w => w.levels.includes('junior'));
    else if (book === 'senior') list = WORDS.filter(w => w.levels.includes('senior'));
    else if (book === 'zhuanshengben') {
      list = WORDS
        .filter(w => w.levels.includes('zhuanshengben'))
        .sort((a, b) => (a.orderZhuanshengben ?? 1e9) - (b.orderZhuanshengben ?? 1e9) || a.w.localeCompare(b.w, 'en'));
    }
    else if (CUSTOM_BOOKS.has(book)) {
      const custom = CUSTOM_BOOKS.get(book);
      list = typeof custom.filter === 'function' ? allWords().filter(custom.filter) : allWords();
    } else list = allWords();
    bookCache.set(book, list);
    return list;
  }

  
/* -------- User-imported wordbooks -------- */
  const CUSTOM_WORD_BOOK_KEY = 'shici.custombooks.v1';
  const CUSTOM_WORDS = new Map();      // id -> word object (only the user's own words)
  const CUSTOM_WORD_IDS = new Set();   // ids that came from an imported list

  function customWordId(bookKey, word, order) {
    const slug = String(word).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `u_${bookKey}_${slug || order}`;
  }

  function normalizeCustomWord(raw, bookKey, order) {
    const w = String(raw.w || raw.word || raw.name || '').trim();
    if (!w || w.length > 40) return null;
    const id = customWordId(bookKey, w, order);
    const tr = String(raw.tr || raw.trans || raw.meaning || '').trim();
    const ph = String(raw.ph || raw.phonetic || '').trim();
    return {
      id,
      w,
      ph,
      tr: tr || '（未填写释义）',
      levels: [],
      rank: order,
      freq: 0,
      proper: false,
      phrase: w.includes(' '),
      example: null,
      orderZhuanshengben: null,
      custom: bookKey,
    };
  }

  function rebuildCustomBooks() {
    CUSTOM_WORDS.clear();
    CUSTOM_WORD_IDS.clear();
    const books = state.customBooks && typeof state.customBooks === 'object' ? state.customBooks : {};
    for (const [key, book] of Object.entries(books)) {
      if (!book || !Array.isArray(book.words)) continue;
      const ids = [];
      book.words.forEach((raw, i) => {
        const word = normalizeCustomWord(raw, key, i);
        if (!word || CUSTOM_WORDS.has(word.id)) return;
        CUSTOM_WORDS.set(word.id, word);
        CUSTOM_WORD_IDS.add(word.id);
        ids.push(word.id);
      });
      registerBook(key, {
        label: book.label || '我的词库',
        filter: w => CUSTOM_WORD_IDS.has(w.id) && CUSTOM_WORDS.get(w.id)?.custom === key,
      });
      registerBook(`${key}_ids`, { label: book.label || '我的词库' });
    }
    for (const [id, word] of CUSTOM_WORDS) {
      if (!WORD_BY_ID.has(id)) WORD_BY_ID.set(id, word);
    }
  }

  /** Words available to the app: bundled list + the user's imported words. */
  function allWords() {
    const custom = [...CUSTOM_WORDS.values()];
    return custom.length ? WORDS.concat(custom) : WORDS;
  }

  function customBooks() {
    return state.customBooks && typeof state.customBooks === 'object' ? state.customBooks : {};
  }

  function saveCustomBook(key, label, words) {
    if (!state.customBooks || typeof state.customBooks !== 'object') state.customBooks = {};
    state.customBooks[key] = { label, words };
    rebuildCustomBooks();
    bookCache.clear();
  }

  function removeCustomBook(key) {
    if (!state.customBooks || !state.customBooks[key]) return;
    delete state.customBooks[key];
    rebuildCustomBooks();
    bookCache.clear();
    if (state.profile.book === key) state.profile.book = 'senior';
  }

  function progressOf(id) { return state.progress[id] || null; }
  function isFavorite(id) { return state.favorites.includes(id); }

  function dueAtOfProgress(p) {
    if (!p) return 0;
    if (p.dueAt) {
      const t = Date.parse(p.dueAt);
      if (!Number.isNaN(t)) return t;
    }
    // Backward compatibility: old records only have a date; treat it as due at 00:00.
    if (p.due) {
      const d = parseKey(p.due);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    return 0;
  }

  function isDueProgress(p) {
    return !!p && dueAtOfProgress(p) <= Date.now();
  }

  function statusOf(word) {
    const p = progressOf(word.id);
    if (!p) return 'new';
    if (p.status === 'mastered') return 'mastered';
    if (isDueProgress(p)) return 'review';
    return 'learning';
  }
  function dueWords(book = state.profile.book) {
    return bookWords(book)
      .filter(w => isDueProgress(progressOf(w.id)))
      .sort((a, b) => {
        const pa = progressOf(a.id), pb = progressOf(b.id);
        return dueAtOfProgress(pa) - dueAtOfProgress(pb) || a.rank - b.rank;
      });
  }
  /**
   * A word is in the mistake book when it has caused at least one lapse,
   * was just marked "不认识", or has drifted to a low ease — but is not mastered.
   */
  function mistakeScore(word) {
    const p = progressOf(word.id);
    if (!p || p.status === 'mastered') return 0;
    if (Array.isArray(state.mistakeExcluded) && state.mistakeExcluded.includes(word.id)) return 0;
    let score = (p.lapses || 0) * 2;
    if (p.lastGrade === 0) score += 3;
    if ((p.ease || 2.5) < 2.2) score += 1;
    if (isDueProgress(p)) score += 1;
    return score;
  }

  function isMistakeWord(word) {
    return mistakeScore(word) >= 2;
  }

  function mistakeWords(book = state.profile.book) {
    return bookWords(book)
      .filter(isMistakeWord)
      .sort((a, b) => mistakeScore(b) - mistakeScore(a) || a.rank - b.rank);
  }

  function newWordPool(book = state.profile.book) {
    return bookWords(book).filter(w => !progressOf(w.id));
  }
  function pickNewWords(limit, book = state.profile.book) {
    if (limit <= 0) return [];
    const pool = newWordPool(book);
    const core = pool.filter(w => !w.proper && !w.phrase);
    const rest = pool.filter(w => w.proper || w.phrase);
    return core.concat(rest).slice(0, limit);
  }
  function hasDueWords(book = state.profile.book) {
    for (const w of bookWords(book)) {
      if (isDueProgress(progressOf(w.id))) return true;
    }
    return false;
  }

  function counts(book = state.profile.book) {
    const list = bookWords(book);
    let newCount = 0, learning = 0, reviewing = 0, mastered = 0, mistakes = 0;
    for (const w of list) {
      const p = progressOf(w.id);
      if (!p) newCount++;
      else if (p.status === 'mastered') mastered++;
      else if (isDueProgress(p)) reviewing++;
      else learning++;
      // Count in the same pass; sorting a 6k list here caused mobile jank.
      if (p && mistakeScore(w) >= 2) mistakes++;
    }
    return { total: list.length, newCount, learning, reviewing, mastered, mistakes };
  }


/* ===== 04-srs.js ===== */
/* ---------------- SRS: Ebbinghaus curve ---------------- */
  // A practical Ebbinghaus sequence: quick same-day review, then widening gaps.
  const EBBINGHAUS = [
    { label: '10 分钟', ms: 10 * 60 * 1000 },
    { label: '1 天', ms: 1 * DAY_MS },
    { label: '2 天', ms: 2 * DAY_MS },
    { label: '4 天', ms: 4 * DAY_MS },
    { label: '7 天', ms: 7 * DAY_MS },
    { label: '15 天', ms: 15 * DAY_MS },
    { label: '30 天', ms: 30 * DAY_MS },
    { label: '60 天', ms: 60 * DAY_MS },
  ];
  const EBBINGHAUS_MAX_STAGE = EBBINGHAUS.length;

  function scheduleAt(stage, multiplier = 1) {
    const safeStage = clamp(stage, 1, EBBINGHAUS_MAX_STAGE);
    const plan = EBBINGHAUS[safeStage - 1];
    const ms = Math.max(5 * 60 * 1000, Math.round(plan.ms * multiplier));
    const when = new Date(Date.now() + ms);
    return {
      dueAt: when.toISOString(),
      due: dateKey(when),
      interval: ms,
      intervalLabel: plan.label,
      stage: safeStage,
    };
  }

  function schedule(word, grade) {
    const today = dateKey();
    const prev = progressOf(word.id);
    const p = prev ? { ...prev } : {
      stage: 0, ease: 2.5, reps: 0, lapses: 0,
      first: today, last: null, due: today, status: 'new', lastGrade: null,
    };

    if (grade === 0) {
      // A word manually removed from the mistake book comes back after a new lapse.
      if (Array.isArray(state.mistakeExcluded)) {
        state.mistakeExcluded = state.mistakeExcluded.filter(id => id !== word.id);
      }
      p.stage = 0;
      p.lapses = (p.lapses || 0) + 1;
      p.ease = Math.max(1.3, (p.ease || 2.5) - 0.2);
      // Ebbinghaus: a failed word is revisited very soon.
      const when = new Date(Date.now() + 5 * 60 * 1000);
      p.dueAt = when.toISOString();
      p.due = dateKey(when);
      p.interval = 5 * 60 * 1000;
      p.intervalLabel = '5 分钟';
      p.status = 'learning';
    } else if (grade === 1) {
      p.stage = clamp(p.stage || 0, 1, EBBINGHAUS_MAX_STAGE - 1);
      p.ease = Math.max(1.3, (p.ease || 2.5) - 0.12);
      Object.assign(p, scheduleAt(p.stage, 0.8));
      p.status = 'learning';
    } else {
      p.stage = Math.min(EBBINGHAUS_MAX_STAGE, (p.stage || 0) + 1);
      p.ease = Math.min(3, (p.ease || 2.5) + 0.03);
      Object.assign(p, scheduleAt(p.stage, 1));
      p.status = p.stage >= EBBINGHAUS_MAX_STAGE ? 'mastered'
        : p.stage >= 5 ? 'review' : 'learning';
    }

    p.reps = (p.reps || 0) + 1;
    p.last = today;
    p.lastGrade = grade;
    state.progress[word.id] = p;
    if (!prev) state.stats.totalNew = (state.stats.totalNew || 0) + 1;
    else state.stats.totalReviews = (state.stats.totalReviews || 0) + 1;
    if (grade > 0) state.stats.correct = (state.stats.correct || 0) + 1;
    else state.stats.wrong = (state.stats.wrong || 0) + 1;
    const day = ensureDay(today);
    if (!prev) {
      if (!day.newIds.includes(word.id)) { day.newIds.push(word.id); day.new++; }
    } else {
      if (!day.reviewIds.includes(word.id)) { day.reviewIds.push(word.id); day.review++; }
    }
    if (grade > 0) day.correct = (day.correct || 0) + 1;
    else day.wrong = (day.wrong || 0) + 1;
    touchStudy();
    debounceSave();
    return p;
  }


/* ===== 05-audio.js ===== */
/* ---------------- Audio ---------------- */
  let voices = [];
  let speechFallbackTimer = null;
  let remoteAudio = null;

  function refreshVoices() {
    if (!('speechSynthesis' in window)) return;
    try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  // Online fallback for mobile browsers / local files where speechSynthesis
  // has no installed voice. The browser caches the audio response.
  function speakRemote(text, manual) {
    if (!text) return;
    try {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.preload = 'auto';
      }
      const type = state.profile.accent === 'uk' ? '1' : '2';
      remoteAudio.pause();
      remoteAudio.currentTime = 0;
      remoteAudio.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`;
      const played = remoteAudio.play();
      if (played && typeof played.catch === 'function') {
        played.catch(() => {
          if (manual) toast(navigator.onLine ? '朗读失败，请检查网络或系统语音' : '离线状态且系统无语音包，暂时无法朗读', 'close');
        });
      }
    } catch {
      if (manual) toast('朗读失败，请检查网络或系统语音', 'close');
    }
  }

  function speak(text, rate = 0.86, manual = false) {
    if (!text) return;
    if (remoteAudio) {
      try { remoteAudio.pause(); remoteAudio.currentTime = 0; } catch {}
    }

    // In the Android WebView wrapper, use the native TextToSpeech engine.
    // It works offline once an English voice is installed.
    if (window.AndroidTTS && typeof window.AndroidTTS.speak === 'function') {
      try {
        if (!window.AndroidTTS.isAvailable || window.AndroidTTS.isAvailable()) {
          const nativeResult = window.AndroidTTS.speak(text, state.profile.accent === 'uk' ? 'uk' : 'us');
          if (nativeResult !== false) return;
        }
      } catch {}
    }

    if (!('speechSynthesis' in window)) {
      speakRemote(text, manual);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      const utter = new SpeechSynthesisUtterance(text);
      const lang = state.profile.accent === 'uk' ? 'en-GB' : 'en-US';
      utter.lang = lang;
      utter.rate = rate;
      utter.pitch = 1;
      utter.volume = 1;
      const exact = voices.find(v => v.lang === lang) || voices.find(v => v.lang && v.lang.replace('_', '-').startsWith(lang));
      const english = exact || voices.find(v => /^en/i.test(v.lang || ''));
      if (english) utter.voice = english;

      let started = false;
      if (speechFallbackTimer) clearTimeout(speechFallbackTimer);
      utter.onstart = () => {
        started = true;
        if (speechFallbackTimer) { clearTimeout(speechFallbackTimer); speechFallbackTimer = null; }
      };
      utter.onerror = () => {
        if (speechFallbackTimer) { clearTimeout(speechFallbackTimer); speechFallbackTimer = null; }
        speakRemote(text, manual);
      };
      // Some mobile engines silently do nothing instead of firing onerror.
      speechFallbackTimer = setTimeout(() => {
        if (!started && !window.speechSynthesis.speaking) speakRemote(text, manual);
      }, 1000);

      window.speechSynthesis.speak(utter);
    } catch {
      speakRemote(text, manual);
    }
  }


/* ===== 06-feedback.js ===== */
/* ---------------- Toast / confetti ---------------- */
  function toast(message, icon = 'check') {
    if (!toastEl) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<svg><use href="#i-${icon}"/></svg><span>${esc(message)}</span>`;
    toastEl.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 1900);
    setTimeout(() => el.remove(), 2300);
  }

  function launchConfetti() {
    const colors = ['#d97757', '#c9dba6', '#2f5d50', '#e2b96c', '#f4d7a8', '#9cc7ad'];
    for (let i = 0; i < 28; i++) {
      const el = document.createElement('span');
      el.className = 'confetti';
      el.style.left = `${8 + Math.random() * 84}vw`;
      el.style.background = colors[i % colors.length];
      el.style.setProperty('--dur', `${1.8 + Math.random() * 1.5}s`);
      el.style.setProperty('--rot', `${Math.random() * 180}deg`);
      el.style.animationDelay = `${Math.random() * .35}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3600);
    }
  }


/* ===== 07-render.js ===== */
/* ---------------- Rendering helpers ---------------- */
  function topbar() {
    const learned = Object.keys(state.progress).length;
    const name = state.profile.name || '单词旅人';
    const level = learned < 1 ? '刚刚开始' : learned < 10 ? '初拾者' : learned < 50 ? '拾词人' : learned < 150 ? '词汇旅人' : learned < 300 ? '词海行者' : '拾光者';
    const sideName = document.getElementById('side-name');
    const sideLevel = document.getElementById('side-level');
    const sideStreak = document.getElementById('side-streak');
    const topStreak = document.getElementById('top-streak');
    const topAvatar = document.getElementById('top-avatar');
    const sideAvatar = document.getElementById('side-avatar');
    if (sideName) sideName.textContent = name;
    if (sideLevel) sideLevel.textContent = level;
    if (sideStreak) sideStreak.textContent = state.streak.current || 0;
    if (topStreak) topStreak.textContent = state.streak.current || 0;
    if (topAvatar) topAvatar.textContent = name.slice(0, 1);
    if (sideAvatar) sideAvatar.textContent = name.slice(0, 1);
    const dot = document.getElementById('review-dot');
    if (dot) dot.hidden = !hasDueWords();
  }

  function setRouteChrome(route) {
    const meta = PAGE_META[route] || PAGE_META.today;
    const title = document.getElementById('page-title');
    const eyebrow = document.getElementById('page-eyebrow');
    if (title) title.textContent = meta[1];
    if (eyebrow) eyebrow.textContent = meta[0];
    document.body.dataset.route = route;
    $$('[data-nav]').forEach(el => el.classList.toggle('is-active', el.dataset.nav === route));
  }

  function statusInfo(word) {
    const s = statusOf(word);
    if (s === 'new') return { key: 'new', label: '新词', dot: '' };
    if (s === 'mastered') return { key: 'mastered', label: '已掌握', dot: 'mastered' };
    if (s === 'review') return { key: 'review', label: '待复习', dot: 'review' };
    return { key: 'learning', label: '学习中', dot: 'learning' };
  }

  function reviewWhen(word) {
    const p = progressOf(word.id);
    if (!p) return '还未开始';
    const dueAt = dueAtOfProgress(p);
    if (!dueAt) return '还未开始';
    const diff = dueAt - Date.now();
    if (diff <= 0) {
      const overdueDays = Math.floor((Date.now() - dueAt) / DAY_MS);
      if (overdueDays >= 1) return `已逾期 ${overdueDays} 天`;
      return '今天到期';
    }
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(diff / 60000))} 分钟后`;
    const d = new Date(dueAt);
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (dateKey(d) === dateKey()) return `今天 ${clock}`;
    const days = Math.max(1, Math.round((parseKey(dateKey(d)) - parseKey(dateKey())) / DAY_MS));
    if (days === 1) return `明天 ${clock}`;
    return `${days} 天后复习`;
  }

  function searchMark(text, query) {
    const safe = esc(text);
    if (!query) return safe;
    const q = query.toLowerCase();
    const idx = String(text).toLowerCase().indexOf(q);
    if (idx < 0) return safe;
    const raw = String(text);
    return `${esc(raw.slice(0, idx))}<mark>${esc(raw.slice(idx, idx + query.length))}</mark>${esc(raw.slice(idx + query.length))}`;
  }


/* ===== 08-page-today.js ===== */
/* ---------------- Today ---------------- */
  function renderToday() {
    const today = dateKey();
    const day = getDay(today);
    const due = dueWords();
    const goal = state.profile.dailyGoal;
    const learnedToday = day.newIds ? day.newIds.length : day.new || 0;
    const reviewedToday = day.reviewIds ? day.reviewIds.length : day.review || 0;
    const p = pct(learnedToday, goal);
    const ringOffset = (339.292 * (1 - Math.min(100, Math.max(0, p)) / 100)).toFixed(1);
    const hour = new Date().getHours();
    const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const todayDate = parseKey(today);
    const all = counts();
    const streak = state.streak.current || 0;
    const learnedTotal = Object.keys(state.progress).length;
    const mastered = all.mastered;
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const k = addDays(-i);
      const d = state.days[k];
      week.push({ key: k, label: weekdayCN(parseKey(k)), done: !!d && ((d.new || 0) + (d.review || 0) > 0), today: k === today });
    }
    const pending = pendingSession();
    const resumeWord = pending ? WORD_BY_ID.get(pending.fresh[0].id) : null;
    const startLabel = pending ? `继续学习（剩 ${pending.remaining} 个）` : '开始今日学习';
    const quests = [
      { label: '学习新词', detail: `${learnedToday} / ${goal} 个`, value: pct(learnedToday, goal), done: learnedToday >= goal, icon: 'book' },
      { label: '复习到期词', detail: due.length ? `${due.length} 个待复习` : '今天已清空', value: due.length ? pct(reviewedToday, reviewedToday + due.length) : 100, done: due.length === 0, icon: 'review' },
      { label: '听写小挑战', detail: day.spell ? `已听写 ${day.spell} 个词` : '来一组听写', value: day.spell ? 100 : 0, done: !!day.spell, icon: 'keyboard' },
    ];
    const wordOfDay = due[0] || pickNewWords(1)[0] || WORDS[Math.floor(Date.now() / DAY_MS) % WORDS.length];
    const bookName = bookLabel(state.profile.book);

    return `
      <section class="dash-head">
        <div>
          <div class="greeting">${greeting}，${esc(state.profile.name || '单词旅人')}。${learnedToday >= goal ? '今天的计划已经完成。' : '今天也来拾几个词吧。'}</div>
          <h2>把今天的词，<em>收进口袋。</em></h2>
        </div>
        <div class="dash-date"><strong>${todayDate.getDate()}</strong>${monthCN(todayDate)} · 周${weekdayCN(todayDate)}<br>${bookName}</div>
      </section>

      <section class="hero">
        <div class="hero-copy">
          <div class="hero-kicker">YOUR DAILY PICK</div>
          <h3>${learnedToday >= goal ? '今日份的词汇，<span>已经拾好。</span>' : `今天还有 <span>${Math.max(0, goal - learnedToday)}</span> 个新词，<br>等你拾起。`}</h3>
          <p>${due.length ? `有 ${due.length} 个词到了复习时间。先温故，再知新，记忆会更牢。` : '没有到期的复习，正好轻装上路。每天一点点，词汇会自己长成森林。'}</p>
          <div class="hero-actions">
            <button class="btn btn-primary" data-action="${pending ? 'resume-session' : 'start-session'}"><svg><use href="#i-play"/></svg>${startLabel}</button>
            <button class="btn btn-ghost" data-action="open-spell"><svg><use href="#i-keyboard"/></svg>听写挑战</button>
          </div>
          ${pending ? `<button class="resume-note" data-action="discard-session">留下一组没学完（${pending.remaining} 个），点这里放弃</button>` : ''}
        </div>
        <div class="hero-side">
          <div class="progress-ring" style="--p:${p}">
            <svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="54"></circle>
              <circle class="ring-progress" cx="60" cy="60" r="54" style="--circ:339.3;--offset:${ringOffset}"></circle>
            </svg>
            <div class="ring-inner"><strong>${learnedToday}</strong><span>/ ${goal}</span></div>
          </div>
          <div class="pill">${p >= 100 ? '今日目标完成' : `今日 ${p}%`}</div>
        </div>
      </section>

      <div class="dash-grid">
        <div class="card card-pad">
          <div class="card-head">
            <h3>学习进度</h3>
            <span class="pill ${due.length ? 'pill-coral' : 'pill-accent'}">${due.length ? `${due.length} 个待复习` : '记忆很新鲜'}</span>
          </div>
          <div class="stat-strip" style="margin-top:0">
            <div class="stat-cell"><strong>${learnedTotal}</strong><span>已学单词</span></div>
            <div class="stat-cell"><strong>${mastered}</strong><span>已掌握</span></div>
            <div class="stat-cell"><strong>${streak}</strong><span>连续天数</span></div>
          </div>
          <div class="week-row">
            ${week.map(d => `<div class="week-day"><span>${d.label}</span><div class="week-dot ${d.done ? 'is-done' : ''} ${d.today ? 'is-today' : ''}">${d.done ? '<svg><use href="#i-check"/></svg>' : ''}</div></div>`).join('')}
          </div>
          <a href="#/stats" class="text-link" style="margin-top:14px;display:inline-flex">查看完整统计<svg><use href="#i-arrow"/></svg></a>
        </div>

        <div class="quote-card">
          <div class="eyebrow">A SMALL NOTE</div>
          <blockquote>“慢慢来，比较快。”<span>单词不是背完的，是一天一天见面，慢慢变熟的。</span></blockquote>
          <footer>—— 拾词 · 今日句子</footer>
        </div>
      </div>

      <section class="today-row">
        <div class="card card-pad">
          <div class="card-head">
            <h3>今日小目标</h3>
            <span class="pill">${quests.filter(q => q.done).length} / 3</span>
          </div>
          <div class="quest-list">
            ${quests.map(q => `
              <div class="quest ${q.done ? 'is-done' : ''}">
                <div class="quest-icon"><svg><use href="#i-${q.icon}"/></svg></div>
                <div class="quest-body"><strong>${q.label}</strong><span>${q.detail}</span></div>
                <div class="quest-progress"><i style="width:${q.value}%"></i></div>
              </div>`).join('')}
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-head"><h3>今天从哪开始</h3><span class="pill">NEXT</span></div>
          <div class="next-word">
            <div class="next-word-main">
              <div class="word-display small">${esc((resumeWord || due[0] || wordOfDay).w)}</div>
              <div class="phonetic">${esc((resumeWord || due[0] || wordOfDay).ph || '')}<button class="speak-btn" data-action="audio" data-word="${esc((resumeWord || due[0] || wordOfDay).w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button></div>
              <p>${esc((resumeWord || due[0] || wordOfDay).tr)}</p>
            </div>
            <span class="pill ${pending ? 'pill-accent' : due.length ? 'pill-coral' : ''}">${pending ? '未学完' : due.length ? '待复习' : '新词'}</span>
          </div>
          <p class="next-note">${pending ? `上一组还剩 ${pending.remaining} 个，点上面的按钮接着学。` : due.length ? `有 ${due.length} 个词到期，开始学习会先复习它们。` : '今天没有到期复习，开始学习会认识新词。'}</p>
          <a href="#/library" class="text-link">去词库看看<svg><use href="#i-arrow"/></svg></a>
        </div>
      </section>
    `;
  }


/* ===== 09-page-library.js ===== */
/* ---------------- Library ---------------- */
  function renderLibrary() {
    const active = state.profile.book;
    const books = customBooks();
    const allCounts = {
      junior: WORDS.filter(w => w.levels.includes('junior')).length,
      senior: WORDS.filter(w => w.levels.includes('senior')).length,
      zhuanshengben: WORDS.filter(w => w.levels.includes('zhuanshengben')).length,
      all: allWords().length,
    };
    const activeCount = bookWords(active).length;
    const isCustom = !!books[active];
    return `
      <div class="page-head">
        <div>
          <h2>词库</h2>
          <p>${activeCount} 个词，来自初中、高中教材与统招专升本整合词表。先认识，再慢慢处熟。${isCustom ? ` 当前为自定义词库「${esc(books[active].label || '我的词库')}」。` : active === 'zhuanshengben' ? ` 当前为统招专升本整合词表（${allCounts.zhuanshengben} 词）。` : ''}</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-ghost btn-sm" data-action="open-spell"><svg><use href="#i-keyboard"/></svg>听写</button>
          <button class="btn btn-primary btn-sm" data-action="start-session"><svg><use href="#i-play"/></svg>开始学习</button>
        </div>
      </div>

      <div class="book-tabs" role="tablist">
        <button class="book-tab ${active === 'junior' ? 'is-active' : ''}" data-action="set-book" data-book="junior">初中 <small>${allCounts.junior}</small></button>
        <button class="book-tab ${active === 'senior' ? 'is-active' : ''}" data-action="set-book" data-book="senior">高中 <small>${allCounts.senior}</small></button>
        <button class="book-tab ${active === 'zhuanshengben' ? 'is-active' : ''}" data-action="set-book" data-book="zhuanshengben">专升本 <small>${allCounts.zhuanshengben}</small></button>
        <button class="book-tab ${active === 'all' ? 'is-active' : ''}" data-action="set-book" data-book="all">全部 <small>${allCounts.all}</small></button>
        ${Object.entries(books).map(([key, book]) => `<button class="book-tab ${active === key ? 'is-active' : ''}" data-action="set-book" data-book="${esc(key)}">${esc((book.label || '我的词库').slice(0, 6))} <small>${(book.words || []).length}</small></button>`).join('')}
        <button class="book-tab book-tab-add" data-action="open-book-import">＋ 导入</button>
      </div>

      <div class="library-toolbar">
        <label class="search-box">
          <svg><use href="#i-search"/></svg>
          <input id="library-search" type="search" placeholder="搜索单词或中文释义…" value="${esc(ui.libraryQuery)}" autocomplete="off">
        </label>
        <select class="filter-select" id="library-filter" aria-label="筛选单词">
          <option value="all" ${ui.libraryFilter === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="new" ${ui.libraryFilter === 'new' ? 'selected' : ''}>未学习</option>
          <option value="learning" ${ui.libraryFilter === 'learning' ? 'selected' : ''}>学习中</option>
          <option value="review" ${ui.libraryFilter === 'review' ? 'selected' : ''}>待复习</option>
          <option value="mastered" ${ui.libraryFilter === 'mastered' ? 'selected' : ''}>已掌握</option>
          <option value="mistake" ${ui.libraryFilter === 'mistake' ? 'selected' : ''}>错词本</option>
          <option value="favorite" ${ui.libraryFilter === 'favorite' ? 'selected' : ''}>我的收藏</option>
        </select>
        <button class="btn btn-sm ${ui.libraryShuffle ? 'btn-primary' : 'btn-ghost'}" data-action="toggle-shuffle-library" aria-pressed="${ui.libraryShuffle ? 'true' : 'false'}"><svg><use href="#i-shuffle"/></svg>${ui.libraryShuffle ? '已乱序' : '乱序看单词'}</button>
        <span class="word-count" id="library-count"></span>
      </div>
      <div id="library-results"></div>
    `;
  }

  // Stable pseudo-random order per (book, seed) so paging and re-renders
  // keep the same shuffled sequence instead of re-shuffling every render.
  function pseudoRandom(seed) {
    let h = 2166136261;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  function shuffleWords(list) {
    const seed = ui.libraryShuffleSeed || 'seed';
    return list
      .map(w => ({ w, k: pseudoRandom(`${seed}:${w.id}`) }))
      .sort((a, b) => a.k - b.k)
      .map(item => item.w);
  }

  function filteredLibraryWords() {
    const q = ui.libraryQuery.trim().toLowerCase();
    let list = bookWords(state.profile.book);
    if (q) list = list.filter(w => w.w.toLowerCase().includes(q) || w.tr.toLowerCase().includes(q));
    if (ui.libraryFilter === 'favorite') list = list.filter(w => isFavorite(w.id));
    else if (ui.libraryFilter === 'mistake') list = list.filter(isMistakeWord);
    else if (ui.libraryFilter !== 'all') list = list.filter(w => statusOf(w) === ui.libraryFilter);
    if (ui.libraryShuffle) list = shuffleWords(list);
    return list;
  }

  function toggleLibraryShuffle() {
    ui.libraryShuffle = !ui.libraryShuffle;
    // New seed each time it is turned on, so the order is genuinely random.
    ui.libraryShuffleSeed = ui.libraryShuffle ? `${Date.now()}` : '';
    ui.libraryPage = 1;
    renderRoute();
    toast(ui.libraryShuffle ? '词库已乱序排列' : '词库已恢复字母顺序', 'book');
  }

  function renderLibraryResults() {
    const box = document.getElementById('library-results');
    if (!box) return;
    const list = filteredLibraryWords();
    const countEl = document.getElementById('library-count');
    if (countEl) countEl.textContent = `${list.length} 个结果`;
    if (!list.length) {
      box.innerHTML = `<div class="empty-state"><div class="empty-art"><svg><use href="#i-search"/></svg></div><h3>没有找到这个词</h3><p>换个拼写，或者切到「全部状态」再看看。</p><button class="btn btn-soft btn-sm" data-action="clear-search">清空筛选</button></div>`;
      return;
    }
    const shown = list.slice(0, ui.libraryPage * ui.libraryLimit);
    const hasMore = shown.length < list.length;
    box.innerHTML = `
      <div class="list-head" aria-hidden="true"><span>单词</span><span>音标</span><span>释义</span><span>状态</span></div>
      <div class="word-list">
        ${shown.map(w => {
          const st = statusInfo(w);
          return `<div class="word-row" data-action="select-word" data-id="${esc(w.id)}" role="button" tabindex="0" aria-label="${esc(w.w)}">
            <div class="w">${searchMark(w.w, ui.libraryQuery.trim())}</div>
            <div class="p">${esc(w.ph || '—')}</div>
            <div class="t">${searchMark(w.tr, ui.libraryQuery.trim())}</div>
            <div class="meta">
              <span class="status-dot ${st.dot}"></span>
              <span class="pill ${st.key === 'review' ? 'pill-coral' : st.key === 'mastered' ? 'pill-accent' : ''}">${st.label}</span>
              <button class="row-detail" data-action="open-word" data-id="${esc(w.id)}" aria-label="查看 ${esc(w.w)} 详情"><svg><use href="#i-chevron"/></svg></button>
              <button class="row-star ${isFavorite(w.id) ? 'is-on' : ''}" data-action="toggle-favorite" data-id="${esc(w.id)}" aria-label="收藏 ${esc(w.w)}"><svg><use href="#i-star"/></svg></button>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${hasMore ? `<div class="load-more"><button class="btn btn-ghost btn-sm" data-action="load-more">再看 ${Math.min(ui.libraryLimit, list.length - shown.length)} 个<svg><use href="#i-arrow"/></svg></button></div>` : ''}
    `;
  }


/* ===== 10-page-review.js ===== */
/* ---------------- Review ---------------- */
  function renderReview() {
    const due = dueWords();
    const today = dateKey();
    const stats = counts();
    const mistakes = mistakeWords();
    const upcoming = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(i);
      const n = bookWords(state.profile.book).filter(w => {
        const p = progressOf(w.id);
        if (!p || !p.due) return false;
        return i === 0 ? p.due <= key : p.due === key;
      }).length;
      upcoming.push({ key, n, label: i === 0 ? '今天' : i === 1 ? '明天' : `+${i}` });
    }
    const max = Math.max(1, ...upcoming.map(u => u.n));
    const overdue = due.filter(w => progressOf(w.id).due < today).length;
    const learnedCount = Object.keys(state.progress).length;
    const learningCount = Object.values(state.progress).filter(p => p.status === 'learning').length;
    const totalReviews = state.stats.totalReviews || 0;
    const graded = (state.stats.correct || 0) + (state.stats.wrong || 0);
    const accuracy = graded ? pct(state.stats.correct, graded) : 0;
    return `
      <div class="page-head">
        <div><h2>复习</h2><p>记忆不是一次完成的，是在快忘记的时候，再见一面。</p></div>
      </div>
      <section class="review-hero">
        <div class="review-card">
          <div class="eyebrow">SPACED REPETITION</div>
          <h2>${due.length}</h2>
          <p>${due.length ? `个词到了复习时间${overdue ? `，其中 ${overdue} 个已经逾期` : ''}。用几分钟，把它们重新点亮。` : '今天没有到期复习。去认识几个新词，或者做一组听写。'}</p>
          <button class="btn" data-action="${due.length ? 'start-review' : 'start-extra'}"><svg><use href="#i-${due.length ? 'review' : 'spark'}"/></svg>${due.length ? '开始复习' : '学 10 个新词'}</button>
          <div class="review-spell">
            <div class="review-spell-label">听写方式</div>
            <div class="segmented spell-mode-inline">
              <button class="${state.spellMode === 'word' ? 'is-on' : ''}" data-action="spell-mode" data-mode="word">显示单词</button>
              <button class="${state.spellMode === 'meaning' ? 'is-on' : ''}" data-action="spell-mode" data-mode="meaning">显示词义</button>
              <button class="${state.spellMode === 'audio' ? 'is-on' : ''}" data-action="spell-mode" data-mode="audio">只听发音</button>
            </div>
            <button class="review-spell-go" data-action="open-spell"><svg><use href="#i-keyboard"/></svg>开始听写</button>
          </div>
        </div>
        <div class="review-side">
          <div class="review-mini"><div class="mini-icon"><svg><use href="#i-clock"/></svg></div><div><strong>${due.length}</strong><span>今日到期 / 待复习</span></div></div>
          <div class="review-mini"><div class="mini-icon"><svg><use href="#i-check"/></svg></div><div><strong>${stats.mastered}</strong><span>已经掌握的单词</span></div></div>
          <div class="review-mini"><div class="mini-icon"><svg><use href="#i-calendar"/></svg></div><div><strong>${dayReviewStreak()}</strong><span>最近 7 天复习次数</span></div></div>
          <a class="review-mini review-mini-link" href="#/mistakes">
            <div class="mini-icon"><svg><use href="#i-target"/></svg></div>
            <div><strong>${mistakes.length}</strong><span>错词本 · 再练一次</span></div>
            <svg class="chev"><use href="#i-chevron"/></svg>
          </a>
        </div>
      </section>

      <section class="card card-pad review-summary" style="margin-top:20px">
        <div class="card-head"><h3>复习统计</h3><span class="pill">记忆进度</span></div>
        <div class="review-stats">
          <div class="review-stat"><strong>${learnedCount}</strong><span>已学单词</span></div>
          <div class="review-stat"><strong>${learningCount}</strong><span>学习中</span></div>
          <div class="review-stat"><strong>${stats.reviewing}</strong><span>待复习</span></div>
          <div class="review-stat"><strong>${stats.mastered}</strong><span>已掌握</span></div>
          <div class="review-stat"><strong>${accuracy}<i>%</i></strong><span>复习正确率</span></div>
          <div class="review-stat"><strong>${totalReviews}</strong><span>累计复习次数</span></div>
        </div>
        <a href="#/stats" class="text-link" style="margin-top:14px;display:inline-flex">查看每个学过的词<svg><use href="#i-arrow"/></svg></a>
      </section>

      <section class="card card-pad">
        <div class="card-head"><h3>听写范围</h3><span class="pill">三种模式</span></div>
        <div class="segmented segmented-lg spell-mode-pick">
          <button class="${state.spellSource !== 'all' ? 'is-on' : ''}" data-action="set-spell-source" data-source="learned">只考学过</button>
          <button class="${state.spellSource === 'all' ? 'is-on' : ''}" data-action="set-spell-source" data-source="all">含新词</button>
        </div>
        <p class="curve-note">当前：${state.spellSource === 'all' ? '学过的词优先，会混入少量新词' : '只考学过的词'}。听写方式在上方的复习卡里切换。</p>
      </section>

      <div class="dash-grid" style="margin-top:20px">
        <div class="card card-pad">
          <div class="card-head"><h3>未来 7 天</h3><span class="pill">艾宾浩斯</span></div>
          <div class="bar-chart">
            ${upcoming.map((u, i) => `<div class="bar-col ${i === 0 ? 'is-today' : ''}"><b class="bar-value">${u.n || ''}</b><i style="height:${Math.max(4, Math.round(u.n / max * 100))}%"></i><span>${u.label}</span></div>`).join('')}
          </div>
          <div class="curve-row" aria-label="艾宾浩斯复习间隔">
            <span class="curve-title">记忆曲线</span>
            ${['10 分钟', '1 天', '2 天', '4 天', '7 天', '15 天', '30 天', '60 天'].map((s, i) => `${i ? '<i>→</i>' : ''}<span>${s}</span>`).join('')}
          </div>
          <p class="curve-note">评分后按这条曲线安排下一次复习；记错会回到 5 分钟后。</p>
        </div>
        <div class="card card-pad">
          <div class="card-head"><h3>复习小贴士</h3><span class="pill">TIPS</span></div>
          <div class="quest-list">
            <div class="quest"><div class="quest-icon"><svg><use href="#i-volume"/></svg></div><div class="quest-body"><strong>先听，再看</strong><span>听发音回忆意思，比直接看答案更有效。</span></div></div>
            <div class="quest"><div class="quest-icon"><svg><use href="#i-pencil"/></svg></div><div class="quest-body"><strong>造一个句子</strong><span>在词条详情里写下自己的例句，记忆会更深。</span></div></div>
          </div>
        </div>
      </div>

      <div class="section-head"><div><h2>到期的词</h2><p>${due.length ? '从最早到期的开始。' : '今天已经清空了。'}</p></div>${due.length ? '<button class="text-link" data-action="start-review">全部复习<svg><use href="#i-arrow"/></svg></button>' : ''}</div>
      ${due.length ? `<div class="due-list">${due.slice(0, 12).map(w => {
        const p = progressOf(w.id);
        return `<div class="due-item" data-action="select-word" data-id="${esc(w.id)}" role="button" tabindex="0"><span class="w">${esc(w.w)}</span><span class="t">${esc(w.tr)}</span><span class="due">${esc(reviewWhen(w))}</span><span class="status-dot ${p && p.due < today ? 'review' : ''}"></span><button class="row-detail" data-action="open-word" data-id="${esc(w.id)}" aria-label="查看 ${esc(w.w)} 详情"><svg><use href="#i-chevron"/></svg></button></div>`;
      }).join('')}${due.length > 12 ? `<div class="due-item" style="justify-content:center;color:var(--muted);font-size:11px" data-action="start-review">还有 ${due.length - 12} 个，开始复习 →</div>` : ''}</div>` : `<div class="empty-state"><div class="empty-art"><svg><use href="#i-check"/></svg></div><h3>今天没有到期单词</h3><p>可以去词库认识新词，或者做一组听写，让记忆保持温度。</p><button class="btn btn-soft btn-sm" data-action="start-extra">学 10 个新词</button></div>`}
    `;
  }

  function dayReviewStreak() {
    let n = 0;
    for (let i = 0; i < 7; i++) n += (state.days[addDays(-i)]?.review || 0);
    return n;
  }


/* ===== 11-page-stats.js ===== */
/* ---------------- Stats ---------------- */
  const STATS_PAGE_SIZE = 30;

  function learnedWordList() {
    const items = [];
    for (const [id, p] of Object.entries(state.progress)) {
      const w = WORD_BY_ID.get(id);
      if (!w) continue;
      items.push({ w, p, at: Date.parse(p.last || p.first || '') || 0 });
    }
    items.sort((a, b) => b.at - a.at);
    return items;
  }

  function setSpellMode(mode) {
    if (!['word', 'meaning', 'audio'].includes(mode)) return;
    state.spellMode = mode;
    save();
    renderRoute();
    const label = { word: '看单词写单词', meaning: '看释义写单词', audio: '只听发音写单词' }[mode];
    toast(`听写模式：${label}`, 'keyboard');
  }

  function renderStats() {
    const progress = state.progress;
    const ids = Object.keys(progress);
    const learnedList = learnedWordList();
    const shown = Math.max(STATS_PAGE_SIZE, (ui.statsPage || 1) * STATS_PAGE_SIZE);
    const learned = ids.length;
    const mastered = ids.filter(id => progress[id].status === 'mastered').length;
    const learning = ids.filter(id => progress[id].status === 'learning').length;
    const reviewing = ids.filter(id => progress[id].status === 'review').length;
    const totalReviews = state.stats.totalReviews || 0;
    const totalMinutes = Math.round((state.stats.seconds || 0) / 60);
    const accuracy = (state.stats.correct || 0) + (state.stats.wrong || 0) > 0
      ? pct(state.stats.correct, (state.stats.correct || 0) + (state.stats.wrong || 0)) : 0;
    const heat = buildHeatmap();
    const donut = learned ? pct(mastered, learned) : 0;
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const k = addDays(-i);
      const d = state.days[k] || {};
      last7.push({ label: weekdayCN(parseKey(k)), value: (d.new || 0) + (d.review || 0) });
    }
    const max7 = Math.max(1, ...last7.map(d => d.value));
    const achievements = [
      { icon: 'sprout', title: '第一颗种子', desc: '学会 1 个词', on: learned >= 1 },
      { icon: 'flame', title: '七日小火苗', desc: '连续学习 7 天', on: state.streak.current >= 7 },
      { icon: 'book', title: '百词入袋', desc: '累计学会 100 词', on: learned >= 100 },
      { icon: 'trophy', title: '拾光者', desc: '掌握 50 个词', on: mastered >= 50 },
    ];
    return `
      <div class="page-head"><div><h2>统计</h2><p>看见自己走过的路，也看见还有多少风景。</p></div></div>
      <div class="metrics">
        <div class="metric"><div class="metric-head"><span>已学单词</span><svg><use href="#i-book"/></svg></div><strong>${learned}</strong><small>从「新词」变成了「见过」</small></div>
        <div class="metric"><div class="metric-head"><span>已掌握</span><svg><use href="#i-check"/></svg></div><strong>${mastered}</strong><small>进入长期记忆的词</small></div>
        <div class="metric"><div class="metric-head"><span>连续学习</span><svg><use href="#i-flame"/></svg></div><strong>${state.streak.current || 0}</strong><small>最长 ${state.streak.best || 0} 天</small></div>
        <div class="metric"><div class="metric-head"><span>复习正确率</span><svg><use href="#i-target"/></svg></div><strong>${accuracy}<span style="font-size:15px">%</span></strong><small>共复习 ${totalReviews} 次</small></div>
      </div>

      <div class="stats-grid">
        <div class="card card-pad">
          <div class="card-head"><h3>学习热力图</h3><span class="pill">最近 26 周</span></div>
          <div class="heatmap-wrap"><div class="heatmap">${heat.map(c => `<div class="heat-cell" data-level="${c.level}" title="${c.key}：${c.new} 新词 · ${c.review} 复习"></div>`).join('')}</div></div>
          <div class="heat-legend"><span>少</span><i data-level="0"></i><i style="background:#d9e4c5"></i><i style="background:#b5ce9d"></i><i style="background:#7fab82"></i><i style="background:#3f705b"></i><span>多</span></div>
        </div>
        <div class="card card-pad">
          <div class="card-head"><h3>掌握进度</h3><span class="pill">${learned ? donut : 0}%</span></div>
          <div class="mastery-wrap">
            <div class="donut" style="--p:${donut}"><div class="donut-center"><strong>${mastered}</strong><span>已掌握</span></div></div>
            <div class="mastery-legend">
              <div class="mastery-line"><i></i>已掌握 <b>${mastered}</b></div>
              <div class="mastery-line"><i></i>学习中 <b>${learning}</b></div>
              <div class="mastery-line"><i></i>复习中 <b>${reviewing}</b></div>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-grid" style="margin-top:20px">
        <div class="card card-pad">
          <div class="card-head"><h3>最近 7 天</h3><span class="pill">新词 + 复习</span></div>
          <div class="bar-chart">${last7.map((d, i) => `<div class="bar-col ${i === last7.length - 1 ? 'is-today' : ''}"><b class="bar-value">${d.value || ''}</b><i style="height:${Math.max(4, Math.round(d.value / max7 * 100))}%"></i><span>${d.label}</span></div>`).join('')}</div>
        </div>
        <div class="card card-pad">
          <div class="card-head"><h3>学习小结</h3><span class="pill">${state.stats.spell || 0} 个听写词</span></div>
          <div class="quest-list">
            <div class="quest"><div class="quest-icon"><svg><use href="#i-spark"/></svg></div><div class="quest-body"><strong>${learned ? `已经认识 ${learned} 个词` : '还没有开始'}</strong><span>${learned ? `其中 ${mastered} 个已经进入长期记忆。` : '从今天的第一个词开始吧。'}</span></div></div>
            <div class="quest"><div class="quest-icon"><svg><use href="#i-calendar"/></svg></div><div class="quest-body"><strong>${Object.keys(state.days).length} 天有学习记录</strong><span>${state.streak.best ? `最长连续 ${state.streak.best} 天。` : '每一天都算数。'}</span></div></div>
            <div class="quest"><div class="quest-icon"><svg><use href="#i-clock"/></svg></div><div class="quest-body"><strong>累计学习 ${totalMinutes} 分钟</strong><span>${totalMinutes < 1 ? '第一分钟从今天开始。' : '专注的时间，会变成记得住的词。'}</span></div></div>
          </div>
        </div>
      </div>

      <div class="section-head"><div><h2>学过的单词</h2><p>${learnedList.length ? `共 ${learnedList.length} 个，最近的排在前面。` : '还没有学过的词。'}</p></div>${state.profile.shuffle ? '<span class="pill pill-accent">乱序学习中</span>' : ''}</div>
      ${learnedList.length ? `<div class="learned-actions">
        <button class="btn btn-primary btn-sm" data-action="review-learned"><svg><use href="#i-review"/></svg>复习学过的词</button>
        <button class="btn btn-soft btn-sm" data-action="spell-learned"><svg><use href="#i-keyboard"/></svg>听写学过的词</button>
        <span class="pill">${learnedList.length} 个可用</span>
      </div>` : ''}
      ${learnedList.length ? `<div class="card learned-card">
        <div class="learned-list">
          ${learnedList.slice(0, shown).map(({ w, p }) => `
            <div class="learned-item" data-action="select-word" data-id="${esc(w.id)}" role="button" tabindex="0">
              <span class="w">${esc(w.w)}</span>
              <span class="t">${esc(w.tr)}</span>
              <button class="row-detail" data-action="open-word" data-id="${esc(w.id)}" aria-label="查看 ${esc(w.w)} 详情"><svg><use href="#i-chevron"/></svg></button>
            </div>`).join('')}
        </div>
        ${learnedList.length > shown ? `<button class="btn btn-sm btn-soft learned-more" data-action="stats-more">再看 ${Math.min(STATS_PAGE_SIZE, learnedList.length - shown)} 个</button>` : ''}
      </div>` : ''}

      <div class="section-head"><div><h2>小小的纪念</h2><p>不着急，慢慢收集。</p></div></div>
      <div class="achievements">${achievements.map(a => `<div class="achv ${a.on ? 'is-on' : ''}"><div class="achv-icon"><svg><use href="#i-${a.icon}"/></svg></div><strong>${a.title}</strong><span>${a.desc}</span></div>`).join('')}</div>
    `;
  }

  function buildHeatmap() {
    const now = new Date();
    const todayKey = dateKey(now);
    const cells = [];
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    start.setDate(start.getDate() - 25 * 7 - start.getDay());
    for (let i = 0; i < 182; i++) {
      const d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      const key = dateKey(d);
      const day = state.days[key] || {};
      const n = (day.new || 0), r = (day.review || 0), sum = n + r;
      const level = key > todayKey ? 0 : sum === 0 ? 0 : sum < 5 ? 1 : sum < 10 ? 2 : sum < 20 ? 3 : 4;
      cells.push({ key, new: n, review: r, level });
    }
    return cells;
  }


/* ===== 12-page-settings.js ===== */
/* ---------------- Settings ---------------- */
  function reminderStatusText() {
    const cfg = reminderConfig();
    if (!reminderSupported()) return '当前环境不支持系统通知。';
    const permission = reminderPermission();
    if (permission === 'denied') return '通知权限被拒绝，需要到系统设置里允许。';
    if (permission === 'granted' && cfg.enabled) return `已开启，每天 ${cfg.time} 提醒。`;
    if (permission === 'granted') return '权限已允许，打开开关即可开始。';
    return '首次开启时会请求通知权限，请选择「允许」。';
  }

  function renderSettings() {
    const goal = state.profile.dailyGoal;
    const books = customBooks();
    const bookList = Object.entries(books);
    return `
      <div class="page-head"><div><h2>设置</h2><p>把学习调成你舒服的节奏。所有进度都保存在这台设备上。</p></div></div>
      <div class="settings-grid">
        <div class="settings-card">
          <h3>学习计划</h3><p>每天给自己留一点和单词相处的时间。</p>
          <div class="setting-row">
            <div class="label"><strong>每日新词</strong><span>完成后仍然可以继续学，不设上限。</span></div>
            <div class="segmented">${[10, 20, 30, 50].map(n => `<button class="${goal === n ? 'is-on' : ''}" data-action="set-goal" data-goal="${n}">${n}</button>`).join('')}</div>
          </div>
          <div class="setting-row">
            <div class="label"><strong>记忆曲线</strong><span>10 分钟 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天 → 60 天；答错回到 5 分钟。</span></div>
            <span class="pill pill-accent">艾宾浩斯</span>
          </div>
          <div class="setting-row">
            <div class="label"><strong>听写范围</strong><span>默认只考学过的词，避免听写没见过的生词。</span></div>
            <div class="segmented">
              <button class="${state.spellSource !== 'all' ? 'is-on' : ''}" data-action="set-spell-source" data-source="learned">只考学过</button>
              <button class="${state.spellSource === 'all' ? 'is-on' : ''}" data-action="set-spell-source" data-source="all">含新词</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="label"><strong>自定义词库</strong><span>导入自己的单词表，导入后自动切换过去。</span></div>
            <button class="btn btn-sm btn-soft" data-action="open-book-import"><svg><use href="#i-upload"/></svg>导入</button>
          </div>
          ${bookList.length ? `<div class="book-list">${bookList.map(([key, book]) => `
            <div class="book-item ${state.profile.book === key ? 'is-on' : ''}">
              <div><strong>${esc(book.label || '我的词库')}</strong><span>${(book.words || []).length} 个词</span></div>
              <div class="book-item-actions">
                <button class="btn btn-xs btn-ghost" data-action="set-book" data-book="${esc(key)}">${state.profile.book === key ? '使用中' : '切换'}</button>
                <button class="btn btn-xs btn-ghost" data-action="delete-book" data-book="${esc(key)}">删除</button>
              </div>
            </div>`).join('')}</div>` : ''}
          <div class="setting-row">
            <div class="label"><strong>自动朗读</strong><span>显示单词时自动播放发音。</span></div>
            <label class="switch"><input type="checkbox" id="auto-speak" ${state.profile.autoSpeak ? 'checked' : ''}><span></span></label>
          </div>
          <div class="setting-row">
            <div class="label"><strong>发音口音</strong><span>优先系统语音；手机没有语音包时自动使用在线发音。</span></div>
            <div class="segmented">
              <button class="${state.profile.accent === 'us' ? 'is-on' : ''}" data-action="set-accent" data-accent="us">美音</button>
              <button class="${state.profile.accent === 'uk' ? 'is-on' : ''}" data-action="set-accent" data-accent="uk">英音</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="label"><strong>朗读测试</strong><span>听不到声音时点这里；在线发音需要联网。</span></div>
            <button class="btn btn-sm btn-soft" data-action="test-audio"><svg><use href="#i-volume"/></svg>试听</button>
          </div>
        </div>

        <div class="settings-card">
          <h3>学习提醒</h3><p>到点提醒你今天还没学完的词。第一次开启需要允许通知权限。</p>
          <div class="setting-row">
            <div class="label"><strong>每日提醒</strong><span>${reminderStatusText()}</span></div>
            <label class="switch"><input type="checkbox" id="reminder-on" ${reminderConfig().enabled ? 'checked' : ''}><span></span></label>
          </div>
          <div class="setting-row">
            <div class="label"><strong>提醒时间</strong><span>每天到了这个时间，如果还没完成今日计划就提醒你。</span></div>
            <input class="text-input" type="time" id="reminder-time" value="${reminderConfig().time}">
          </div>
          <div class="setting-row">
            <div class="label"><strong>权限与测试</strong><span>授权后可以发一条测试通知；被系统拒绝时需要到设置里手动打开。</span></div>
            <div class="book-item-actions">
              <button class="btn btn-xs btn-soft" data-action="request-notification">请求权限</button>
              <button class="btn btn-xs btn-ghost" data-action="test-reminder">测试</button>
            </div>
          </div>
          <div class="setting-row" style="border-bottom:0">
            <div class="label"><strong>手机说明</strong><span>部分手机会在「电池/后台」里限制通知，需要在系统设置中允许「拾词」通知并允许后台运行。</span></div>
          </div>
        </div>

        <div class="settings-card">
          <h3>你的名字</h3><p>出现在首页和统计里，随时可以改。</p>
          <input class="name-input" id="profile-name" maxlength="16" value="${esc(state.profile.name || '')}" placeholder="给自己起个名字">
          <div class="setting-row" style="margin-top:8px">
            <div class="label"><strong>界面主题</strong><span>浅色的纸，或深色的夜。</span></div>
            <div class="theme-choice">
              <button class="theme-swatch ${state.profile.theme === 'light' ? 'is-on' : ''}" data-action="set-theme" data-theme="light" aria-label="浅色主题"><svg><use href="#i-sun"/></svg></button>
              <button class="theme-swatch dark ${state.profile.theme === 'dark' ? 'is-on' : ''}" data-action="set-theme" data-theme="dark" aria-label="深色主题"><svg><use href="#i-moon"/></svg></button>
            </div>
          </div>
          <div class="setting-row">
            <div class="label"><strong>连续学习</strong><span>当前 ${state.streak.current || 0} 天，最长 ${state.streak.best || 0} 天。</span></div>
            <span class="pill pill-coral"><svg style="width:12px;height:12px"><use href="#i-flame"/></svg>${state.streak.current || 0} 天</span>
          </div>
        </div>

        <div class="settings-card">
          <h3>数据</h3><p>你的学习记录只保存在本机，关闭软件后仍然保留。</p>
          <div class="setting-row">
            <div class="label"><strong>自动保存</strong><span>localStorage + IndexedDB 双备份。${state.lastSavedAt ? `最近保存：${new Date(state.lastSavedAt).toLocaleString('zh-CN', { hour12: false })}` : '首次保存后生效。'}</span></div>
            <span class="pill pill-accent">已开启</span>
          </div>
          <div class="setting-row">
            <div class="label"><strong>导出备份</strong><span>下载一个 JSON 文件，包含进度、收藏与笔记。</span></div>
            <button class="btn btn-sm btn-soft" data-action="export-data"><svg><use href="#i-download"/></svg>导出</button>
          </div>
          <div class="setting-row">
            <div class="label"><strong>导入备份</strong><span>用之前导出的文件恢复学习记录。</span></div>
            <button class="btn btn-sm btn-ghost" data-action="import-data"><svg><use href="#i-upload"/></svg>导入</button>
          </div>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <div class="setting-row danger-zone">
            <div class="label"><strong>清空学习进度</strong><span>保留词库与设置，删除单词进度、统计和连续记录。</span></div>
            <button class="btn btn-sm btn-ghost" data-action="confirm-reset"><svg><use href="#i-trash"/></svg>清空</button>
          </div>
        </div>

        <div class="settings-card">
          <h3>关于拾词</h3><p>一个安静、离线可用的初高中单词学习工具。</p>
          <div class="source-note"><svg><use href="#i-book"/></svg><div>词库来自人教版初中英语教材词表、人教版高中英语教材词表与高考 3500 词补充词表，共 ${WORDS.length} 个词条。释义与音标为学习用途整理，如有疏漏，欢迎后续修正。</div></div>
          <div class="setting-row" style="margin-top:12px"><div class="label"><strong>版本</strong><span>0.1 · 第一版</span></div><span class="pill">LOCAL FIRST</span></div>
          <div class="setting-row"><div class="label"><strong>学习方式</strong><span>间隔重复 · 主动回忆 · 听写</span></div><span class="pill pill-accent">SRS</span></div>
        </div>
      </div>
    `;
  }


/* ===== 13-router.js ===== */
/* ---------------- Route ---------------- */
  const CUSTOM_ROUTES = new Map();

  /**
   * Future feature pieces can add a page without editing this router:
   * registerRoute('quiz', { title: '小测', eyebrow: 'QUIZ', render: renderQuiz })
   */
  function registerRoute(name, options = {}) {
    if (typeof options.render !== 'function') throw new Error('registerRoute needs a render function');
    PAGE_META[name] = [options.eyebrow || 'PAGE', options.title || name];
    CUSTOM_ROUTES.set(name, options);
  }

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    return PAGE_META[hash] ? hash : 'today';
  }

  function renderRoute() {
    const route = currentRoute();
    if (route === 'library' && ui.route !== 'library') ui.libraryPage = 1;
    ui.route = route;
    setRouteChrome(route);
    topbar();
    let html = '';
    const custom = CUSTOM_ROUTES.get(route);
    if (custom) html = custom.render();
    else if (route === 'library') html = renderLibrary();
    else if (route === 'review') html = renderReview();
    else if (route === 'stats') html = renderStats();
    else if (route === 'settings') html = renderSettings();
    else html = renderToday();
    viewEl.innerHTML = html;
    viewEl.classList.remove('view-enter');
    void viewEl.offsetWidth;
    viewEl.classList.add('view-enter');
    if (route === 'library') renderLibraryResults();
    if (route === 'settings') {
      const nameInput = document.getElementById('profile-name');
      if (nameInput) nameInput.addEventListener('input', onProfileName);
      const auto = document.getElementById('auto-speak');
      if (auto) auto.addEventListener('change', onAutoSpeak);
      const file = document.getElementById('import-file');
      if (file) file.addEventListener('change', onImportFile);
      const shuffleBox = document.getElementById('shuffle-words');
      if (shuffleBox) shuffleBox.addEventListener('change', onShuffleChange);
      const reminderBox = document.getElementById('reminder-on');
      if (reminderBox) reminderBox.addEventListener('change', onReminderToggle);
      const reminderTime = document.getElementById('reminder-time');
      if (reminderTime) reminderTime.addEventListener('change', onReminderTime);
    }
    if (custom && typeof custom.afterRender === 'function') custom.afterRender();
    window.scrollTo(0, 0);
  }

  function navigate(route) {
    if (currentRoute() === route) { renderRoute(); return; }
    location.hash = `#/${route}`;
  }


/* ===== 13b-page-mistakes.js ===== */
/* ---------------- Mistake book page ---------------- */
  function renderMistakes() {
    const list = mistakeWords();
    const today = dateKey();
    const due = list.filter(w => {
      const p = progressOf(w.id);
      return p && p.due && p.due <= today;
    });
    return `
      <div class="page-head">
        <div>
          <h2>错词本</h2>
          <p>那些曾经绊住你的词，值得再见一面。反复记错、评分偏低的词会自动收进来；掌握后自动移出。</p>
        </div>
        <div class="page-head-actions">
          <button class="btn btn-primary btn-sm" data-action="start-mistakes" ${list.length ? '' : 'disabled'}>
            <svg><use href="#i-target"/></svg>强化练习
          </button>
        </div>
      </div>

      <div class="metrics">
        <div class="metric"><div class="metric-head"><span>错词本</span><svg><use href="#i-target"/></svg></div><strong>${list.length}</strong><small>需要再见一面的词</small></div>
        <div class="metric"><div class="metric-head"><span>今天到期</span><svg><use href="#i-clock"/></svg></div><strong>${due.length}</strong><small>优先安排复习</small></div>
        <div class="metric"><div class="metric-head"><span>反复记错</span><svg><use href="#i-review"/></svg></div><strong>${list.filter(w => (progressOf(w.id)?.lapses || 0) > 0).length}</strong><small>至少错过一次</small></div>
        <div class="metric"><div class="metric-head"><span>当前词库</span><svg><use href="#i-book"/></svg></div><strong style="font-size:22px">${bookLabel(state.profile.book)}</strong><small>切换词库后自动更新</small></div>
      </div>

      ${list.length ? `
        <div class="section-head"><div><h2>需要加强的词</h2><p>按“错得最多”和“最该复习”排序。</p></div><span class="pill">${list.length} 个</span></div>
        <div class="due-list">
          ${list.slice(0, 60).map(w => {
            const p = progressOf(w.id);
            const lapses = p?.lapses || 0;
            const label = lapses > 0 ? `错 ${lapses} 次` : '刚刚标记不认识';
            return `<div class="due-item" data-action="select-word" data-id="${esc(w.id)}" role="button" tabindex="0">
              <span class="w">${esc(w.w)}</span>
              <span class="t">${esc(w.tr)}</span>
              <span class="due">${label} · ${esc(reviewWhen(w))}</span>
              <span class="status-dot review"></span>
              <button class="row-detail" data-action="open-word" data-id="${esc(w.id)}" aria-label="查看 ${esc(w.w)} 详情"><svg><use href="#i-chevron"/></svg></button>
              <button class="mistake-remove" data-action="remove-mistake" data-id="${esc(w.id)}" aria-label="把 ${esc(w.w)} 移出错词本" title="移出错词本"><svg><use href="#i-trash"/></svg></button>
            </div>`;
          }).join('')}
        </div>
        ${list.length > 60 ? `<p class="muted" style="text-align:center;font-size:11px;margin-top:12px">还有 ${list.length - 60} 个，先强化前面的词。</p>` : ''}
      ` : `
        <div class="empty-state">
          <div class="empty-art"><svg><use href="#i-check"/></svg></div>
          <h3>错词本是空的</h3>
          <p>这不是坏事。继续学习，遇到不熟悉的词时选择「不认识」或「有点模糊」，它们就会自动收进来。</p>
          <button class="btn btn-soft btn-sm" data-action="start-session">去学新词</button>
        </div>
      `}
    `;
  }

  registerRoute('mistakes', {
    title: '错词本',
    eyebrow: 'MISTAKES',
    render: renderMistakes,
  });

  registerAction('start-mistakes', () => {
    const ids = mistakeWords().slice(0, 40).map(w => w.id);
    if (!ids.length) {
      toast('错词本是空的，先去学几个新词吧', 'check');
      return;
    }
    openSession({ mode: 'single', ids });
  });

  function removeMistake(wordId) {
    const word = WORD_BY_ID.get(wordId);
    if (!word) return;
    if (!Array.isArray(state.mistakeExcluded)) state.mistakeExcluded = [];
    if (!state.mistakeExcluded.includes(wordId)) state.mistakeExcluded.push(wordId);
    save();
    const y = window.scrollY;
    if (ui.modalOpen) closeModal();
    renderRoute();
    window.scrollTo(0, y);
    toast(`已把 ${word.w} 移出错词本；再次答错会自动回来`, 'check');
  }

  registerAction('remove-mistake', (el) => removeMistake(el.dataset.id));


/* ===== 14-word-detail.js ===== */
/* ---------------- Word detail ---------------- */
  function openWordDetail(id) {
    const w = WORD_BY_ID.get(id);
    if (!w) return;
    const st = statusInfo(w);
    const p = progressOf(id);
    const note = state.notes[id] || '';
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card wide" role="dialog" aria-modal="true" aria-label="${esc(w.w)} 词条详情">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="detail-word">
            <div class="word-display">${esc(w.w)}</div>
            <div class="phonetic">${esc(w.ph || '暂无音标')}<button class="speak-btn" data-action="audio" data-word="${esc(w.w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button></div>
            <div class="detail-meta">
              <span class="pill">${w.levels.includes('junior') ? '初中' : ''}${w.levels.includes('junior') && w.levels.includes('senior') ? ' · ' : ''}${w.levels.includes('senior') ? '高中' : ''}</span>
              ${w.phrase ? '<span class="pill">短语</span>' : ''}
              ${w.proper ? '<span class="pill">专有名词</span>' : ''}
              <span class="pill ${st.key === 'mastered' ? 'pill-accent' : st.key === 'review' ? 'pill-coral' : ''}">${st.label}</span>
            </div>
            <div class="detail-actions">
              <button class="btn btn-sm btn-primary" data-action="learn-single" data-id="${esc(w.id)}"><svg><use href="#i-play"/></svg>单独学习</button>
              <button class="btn btn-sm ${isFavorite(id) ? 'btn-soft' : 'btn-ghost'}" data-action="toggle-favorite" data-id="${esc(w.id)}"><svg><use href="#i-star"/></svg>${isFavorite(id) ? '已收藏' : '收藏'}</button>
              ${isMistakeWord(w) ? `<button class="btn btn-sm btn-ghost" data-action="remove-mistake" data-id="${esc(w.id)}"><svg><use href="#i-close"/></svg>移出错词本</button>` : ''}
            </div>
          </div>
          <div class="detail-block"><h4>释义</h4><div class="translation">${esc(w.tr)}</div></div>
          ${w.example ? `<div class="detail-block"><h4>例句</h4><div class="example"><div class="en">${esc(w.example[0])}</div><div class="zh">${esc(w.example[1])}</div></div></div>` : ''}
          <div class="detail-block"><h4>学习状态</h4><div class="translation" style="font-size:13px;color:var(--muted)">${p ? `已学习 ${p.reps || 0} 次 · ${reviewWhen(w)} · 熟悉度 ${Math.min(EBBINGHAUS_MAX_STAGE, p.stage || 0)}/${EBBINGHAUS_MAX_STAGE}` : '还没有开始学习。点击「单独学习」，把它收进口袋。'}</div></div>
          <div class="detail-block"><h4>我的例句 / 笔记</h4><textarea class="note-input" data-note-id="${esc(w.id)}" placeholder="用它造个句子，或记下你的联想…">${esc(note)}</textarea></div>
        </div>
      </div>
    `);
  }

  function openModal(html) {
    overlayEl.innerHTML = html;
    ui.modalOpen = true;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    overlayEl.innerHTML = '';
    ui.modalOpen = false;
    if (!ui.session && !ui.onboardOpen) document.body.style.overflow = '';
    if (ui.spell) ui.spell = null;
  }


/* ===== 15-session.js ===== */
/* ---------------- Study session ---------------- */
  function shuffleList(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function buildQueue(mode, extra = 10) {
    const book = state.profile.book;
    const today = dateKey();
    const day = getDay(today);
    const due = dueWords(book);
    if (mode === 'single') return [];
    if (mode === 'review') return due.slice(0, MAX_QUEUE).map(w => ({ id: w.id, type: 'review' }));
    // 只复习已经学过的词，不看是否到期
    if (mode === 'learned') {
      const learned = Object.keys(state.progress)
        .map(id => WORD_BY_ID.get(id))
        .filter(w => w && bookWords(book).includes(w));
      const pool = learned.length ? learned : Object.keys(state.progress).map(id => WORD_BY_ID.get(id)).filter(Boolean);
      return shuffleList(pool).slice(0, Math.min(MAX_QUEUE, Math.max(20, state.profile.dailyGoal))).map(w => ({ id: w.id, type: 'review' }));
    }
    const shuffled = state.profile.shuffle;
    const newLimit = mode === 'extra' ? extra : Math.max(0, state.profile.dailyGoal - (day.newIds?.length || day.new || 0));
    let freshList = pickNewWords(shuffled ? 400 : newLimit, book);
    if (shuffled) freshList = shuffleList(freshList).slice(0, newLimit);
    const fresh = freshList.map(w => ({ id: w.id, type: 'new' }));
    if (mode === 'mixed') {
      const reviewPart = due.slice(0, 40).map(w => ({ id: w.id, type: 'review' }));
      return reviewPart.concat(fresh);
    }
    return fresh;
  }

  function openSession(opts = {}) {
    closeModal();
    const mode = opts.mode || 'mixed';
    let queue = [];
    if (mode === 'single' && Array.isArray(opts.ids)) {
      queue = opts.ids.map(id => ({ id, type: progressOf(id) ? 'review' : 'new' }));
    } else {
      queue = buildQueue(mode, opts.extra || 10);
    }
    if (!queue.length && mode === 'mixed') {
      // 每日目标完成后仍然允许「再学一点」，不让开始按钮变成死路。
      queue = buildQueue('extra', 10);
      if (queue.length) toast('今日目标已完成，再学 10 个新词', 'spark');
    }
    if (!queue.length) {
      if (mode === 'review') toast('今天没有到期复习，去学几个新词吧', 'spark');
      else if (mode === 'extra') toast('这个词库的新词已经学完了，去复习吧', 'check');
      else toast('这个词库的新词已经学完了，去复习吧', 'check');
      return;
    }
    ui.session = {
      queue,
      index: 0,
      revealed: false,
      results: [],
      start: Date.now(),
      requeued: new Set(),
      skipped: new Set(),
      mode,
    };
    persistSession();
    document.body.style.overflow = 'hidden';
    renderSession();
    document.addEventListener('keydown', onSessionKey);
    if (state.profile.autoSpeak) {
      setTimeout(() => {
        if (!ui.session) return;
        const w = currentWord();
        if (w) speak(w.w);
      }, 380);
    }
  }

  function currentWord() {
    const s = ui.session;
    if (!s) return null;
    const item = s.queue[s.index];
    if (!item) return null;
    return WORD_BY_ID.get(item.id) || null;
  }

  function renderSession() {
    const s = ui.session;
    if (!s) return;
    if (s.index >= s.queue.length) { renderSummary(); return; }
    const item = s.queue[s.index];
    const w = WORD_BY_ID.get(item.id);
    const p = progressOf(w.id);
    const isReview = item.type === 'review' || !!p;
    const total = s.queue.length;
    const current = s.index + 1;
    const progress = Math.round((s.index / total) * 100);
    const st = statusInfo(w);
    const example = w.example;
    overlayEl.innerHTML = `
      <div class="study-overlay" id="session-root">
        <div class="study-top">
          <button class="icon-btn study-close" data-action="close-session" aria-label="结束学习"><svg><use href="#i-close"/></svg></button>
          <div class="study-progress">
            <div class="study-progress-head"><span>${isReview ? 'REVIEW' : 'NEW WORDS'} · ${bookLabel(state.profile.book)}</span><span>${progress}%</span></div>
            <div class="study-track"><i style="width:${progress}%"></i></div>
          </div>
          <div class="study-count">${pad(current)} <small>/ ${pad(total)}</small></div>
        </div>

        <div class="study-stage">
          <div class="study-card ${s.revealed ? 'is-revealed' : ''}" data-action="reveal-card">
            <div class="study-card-top">
              <div class="study-badges">
                <span class="pill ${isReview ? 'review' : ''}">${isReview ? '复习' : '新词'}</span>
                <span class="pill">${w.phrase ? '短语' : w.proper ? '专有名词' : '核心词'}</span>
              </div>
              <span class="pill">${isReview ? reviewWhen(w) : '第一次见面'}</span>
            </div>
            <div class="study-card-body">
              <div class="word-display ${s.revealed ? 'small' : ''}">${esc(w.w)}</div>
              <div class="phonetic" style="margin-top:10px">${esc(w.ph || '点击喇叭听发音')}<button class="speak-btn" data-action="audio" data-word="${esc(w.w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button></div>
              ${s.revealed ? `
                <div class="meaning-block">
                  <div class="translation">${esc(w.tr)}</div>
                  ${example ? `<div class="example"><div class="en">${esc(example[0])}</div><div class="zh">${esc(example[1])}</div></div>` : `<div class="example"><div class="en" style="color:var(--muted);font-size:13px">试着用它造一个句子，记忆会更深。</div></div>`}
                </div>
              ` : `
                <div class="reveal-hint" style="margin-top:28px">
                  <div class="tap-line"><svg><use href="#i-arrow"/></svg></div>
                  <span>点击卡片，查看释义</span>
                </div>
              `}
            </div>
            <div class="study-card-bottom">
              <div class="study-side-actions">
                <button class="fav-btn ${isFavorite(w.id) ? 'is-on' : ''}" data-action="toggle-favorite" data-id="${esc(w.id)}" aria-label="收藏"><svg><use href="#i-star"/></svg></button>
                <button class="fav-btn" data-action="audio" data-word="${esc(w.w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button>
              </div>
              <div class="study-side-right">
                <button class="study-skip" data-action="skip-word" title="跳过这个词，之后再学">跳过 <kbd>S</kbd></button>
                <div class="study-hint"><kbd>Space</kbd> ${s.revealed ? '选择熟悉程度' : '显示释义'} <span style="opacity:.5">·</span> <kbd>Esc</kbd> 退出</div>
              </div>
            </div>
          </div>
        </div>

        ${s.revealed ? `<div class="grade-bar">
          <button class="grade-btn again" data-action="grade" data-grade="0"><strong>不认识</strong><span>重新记一次</span><kbd>1</kbd></button>
          <button class="grade-btn hard" data-action="grade" data-grade="1"><strong>有点模糊</strong><span>很快再见</span><kbd>2</kbd></button>
          <button class="grade-btn good" data-action="grade" data-grade="2"><strong>认识</strong><span>继续向前</span><kbd>3</kbd></button>
        </div>` : `<div class="grade-bar"><button class="grade-btn" disabled style="grid-column:1/-1;opacity:.55"><strong>先回忆一下，再翻开卡片</strong><span>主动回忆比直接看答案更有效</span></button></div>`}
      </div>
    `;
  }

  /**
   * Reveal in place: swap only the card body and the grade bar instead of
   * re-rendering the whole overlay. Re-rendering looked like a page jump and
   * also replayed the entry animation on every tap.
   */
  function revealCard() {
    const s = ui.session;
    if (!s || s.revealed) return;
    s.revealed = true;
    const item = s.queue[s.index];
    const w = item ? WORD_BY_ID.get(item.id) : null;
    if (!w) { renderSession(); return; }

    const card = document.querySelector('.study-card');
    const body = card?.querySelector('.study-card-body');
    const display = card?.querySelector('.word-display');
    if (body) {
      display?.classList.add('small');
      const example = w.example;
      body.innerHTML = `
        <div class="word-display small">${esc(w.w)}</div>
        <div class="phonetic" style="margin-top:10px">${esc(w.ph || '点击喇叭听发音')}<button class="speak-btn" data-action="audio" data-word="${esc(w.w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button></div>
        <div class="meaning-block">
          <div class="translation">${esc(w.tr)}</div>
          ${example ? `<div class="example"><div class="en">${esc(example[0])}</div><div class="zh">${esc(example[1])}</div></div>` : `<div class="example"><div class="en" style="color:var(--muted);font-size:13px">试着用它造一个句子，记忆会更深。</div></div>`}
        </div>
      `;
      card?.classList.add('is-revealed');
      const bar = document.querySelector('.grade-bar');
      if (bar) {
        bar.innerHTML = `
          <button class="grade-btn again" data-action="grade" data-grade="0"><strong>不认识</strong><span>重新记一次</span><kbd>1</kbd></button>
          <button class="grade-btn hard" data-action="grade" data-grade="1"><strong>有点模糊</strong><span>很快再见</span><kbd>2</kbd></button>
          <button class="grade-btn good" data-action="grade" data-grade="2"><strong>认识</strong><span>继续向前</span><kbd>3</kbd></button>`;
        bar.classList.add('is-ready');
      }
      const hint = document.querySelector('.study-hint');
      if (hint) hint.innerHTML = `<kbd>Space</kbd> 选择熟悉程度 <span style="opacity:.5">·</span> <kbd>Esc</kbd> 退出`;
    } else {
      renderSession();
      return;
    }
    if (state.profile.autoSpeak) speak(w.w);
  }

  function gradeCurrent(grade) {
    const s = ui.session;
    if (!s || !s.revealed) return;
    const item = s.queue[s.index];
    const w = WORD_BY_ID.get(item.id);
    if (!w) { s.index++; s.revealed = false; renderSession(); return; }
    const wasNew = !progressOf(w.id);
    schedule(w, grade);
    s.results.push({ id: w.id, grade, wasNew });
    if (grade === 0 && !s.requeued.has(w.id) && s.queue.length < MAX_QUEUE) {
      s.requeued.add(w.id);
      s.queue.push({ id: w.id, type: 'review', requeued: true });
    }
    s.index++;
    s.revealed = false;
    persistSession();
    if (s.index >= s.queue.length) { renderSummary(); return; }
    advanceInPlace(grade);
    const next = currentWord();
    if (next && state.profile.autoSpeak) setTimeout(() => speak(next.w), 280);
  }

  /**
   * Move to the next word without rebuilding the overlay: update the card
   * contents, the progress track and the counter in place.
   */
  function advanceInPlace(lastGrade) {
    const s = ui.session;
    if (!s) return;
    const item = s.queue[s.index];
    const w = item ? WORD_BY_ID.get(item.id) : null;
    const card = document.querySelector('.study-card');
    const body = card?.querySelector('.study-card-body');
    if (!w || !body) { renderSession(); return; }

    const isReview = item.type === 'review' || !!progressOf(w.id);
    const progress = Math.round((s.index / s.queue.length) * 100);
    const track = document.querySelector('.study-track i');
    if (track) track.style.width = `${progress}%`;
    const pctEl = document.querySelector('.study-progress-head span:last-child');
    if (pctEl) pctEl.textContent = `${progress}%`;
    const countEl = document.querySelector('.study-count');
    if (countEl) countEl.innerHTML = `${pad(s.index + 1)} <small>/ ${pad(s.queue.length)}</small>`;
    const labelEl = document.querySelector('.study-progress-head span:first-child');
    if (labelEl) labelEl.textContent = `${isReview ? 'REVIEW' : 'NEW WORDS'} · ${bookLabel(state.profile.book)}`;

    const badges = card.querySelector('.study-badges');
    if (badges) {
      badges.innerHTML = `<span class="pill ${isReview ? 'review' : ''}">${isReview ? '复习' : '新词'}</span>
        <span class="pill">${w.phrase ? '短语' : w.proper ? '专有名词' : '核心词'}</span>`;
    }
    const whenEl = card.querySelector('.study-card-top > .pill:last-child');
    if (whenEl) whenEl.textContent = isReview ? reviewWhen(w) : '第一次见面';
    const favBtn = card.querySelector('.fav-btn[data-action="toggle-favorite"]');
    if (favBtn) {
      favBtn.dataset.id = w.id;
      favBtn.classList.toggle('is-on', isFavorite(w.id));
    }
    card.querySelectorAll('[data-action="audio"]').forEach(btn => { btn.dataset.word = w.w; });
    card.classList.remove('is-revealed');
    const display = card.querySelector('.word-display');
    if (display) display.classList.remove('small');
    body.innerHTML = `
      <div class="word-display">${esc(w.w)}</div>
      <div class="phonetic" style="margin-top:10px">${esc(w.ph || '点击喇叭听发音')}<button class="speak-btn" data-action="audio" data-word="${esc(w.w)}" aria-label="朗读"><svg><use href="#i-volume"/></svg></button></div>
      <div class="reveal-hint" style="margin-top:28px">
        <div class="tap-line"><svg><use href="#i-arrow"/></svg></div>
        <span>点击卡片，查看释义</span>
      </div>
    `;
    const bar = document.querySelector('.grade-bar');
    if (bar) {
      bar.classList.remove('is-ready');
      bar.innerHTML = `<button class="grade-btn" disabled style="grid-column:1/-1;opacity:.55"><strong>先回忆一下，再翻开卡片</strong><span>主动回忆比直接看答案更有效</span></button>`;
    }
    const hint = document.querySelector('.study-hint');
    if (hint) hint.innerHTML = `<kbd>Space</kbd> 显示释义 <span style="opacity:.5">·</span> <kbd>Esc</kbd> 退出`;
    if (lastGrade === 0) {
      const stage = card.querySelector('.study-stage');
      if (stage) { stage.classList.add('lapse-flash'); setTimeout(() => stage.classList.remove('lapse-flash'), 420); }
    }
  }

  function recordSessionTime(session) {
    if (!session || session.timeSaved) return;
    session.timeSaved = true;
    const seconds = Math.max(0, Math.round((Date.now() - session.start) / 1000));
    session.elapsedSeconds = seconds;
    if (seconds < 1) return;
    const day = ensureDay();
    day.seconds = (day.seconds || 0) + seconds;
    state.stats.seconds = (state.stats.seconds || 0) + seconds;
    save();
  }

  function skipCurrent() {
    const s = ui.session;
    if (!s) return;
    const item = s.queue[s.index];
    if (!item) return;
    s.skipped.add(item.id);
    s.index += 1;
    s.revealed = false;
    persistSession();
    if (s.index >= s.queue.length) { renderSummary(); return; }
    renderSession();
    if (state.profile.autoSpeak) {
      setTimeout(() => {
        if (!ui.session) return;
        const w = currentWord();
        if (w) speak(w.w);
      }, 260);
    }
  }

  /* Persist the current queue so leaving the app mid-study can be resumed. */
  function persistSession() {
    const s = ui.session;
    if (!s) { state.session = null; debounceSave(); return; }
    const remaining = s.index >= s.queue.length ? 0 : s.queue.length - s.index;
    if (!remaining) { state.session = null; save(); return; }
    state.session = {
      mode: s.mode,
      queue: s.queue.map(item => ({ id: item.id, type: item.type })),
      index: s.index,
      results: s.results.slice(-200),
      requeued: [...s.requeued],
      skipped: [...s.skipped],
      book: state.profile.book,
      savedAt: Date.now(),
    };
    save();
  }

  function pendingSession() {
    const saved = state.session;
    if (!saved || !Array.isArray(saved.queue) || !saved.queue.length) return null;
    const index = clamp(Number(saved.index) || 0, 0, saved.queue.length);
    if (index >= saved.queue.length) return null;
    const fresh = saved.queue.slice(index).filter(item => item && WORD_BY_ID.has(item.id));
    if (!fresh.length) return null;
    return { saved, fresh, remaining: fresh.length, total: saved.queue.length, index };
  }

  function resumeSession() {
    const pending = pendingSession();
    if (!pending) {
      state.session = null;
      save();
      return false;
    }
    const { saved, fresh } = pending;
    closeModal();
    ui.session = {
      queue: fresh.map(item => ({ id: item.id, type: item.type })),
      index: 0,
      revealed: false,
      results: Array.isArray(saved.results) ? saved.results.slice() : [],
      start: Date.now(),
      requeued: new Set(Array.isArray(saved.requeued) ? saved.requeued : []),
      skipped: new Set(Array.isArray(saved.skipped) ? saved.skipped : []),
      mode: saved.mode || 'mixed',
      resumed: true,
    };
    document.body.style.overflow = 'hidden';
    renderSession();
    document.addEventListener('keydown', onSessionKey);
    if (state.profile.autoSpeak) {
      setTimeout(() => {
        if (!ui.session) return;
        const w = currentWord();
        if (w) speak(w.w);
      }, 320);
    }
    return true;
  }

  function closeSession() {
    if (!ui.session) return;
    recordSessionTime(ui.session);
    persistSession();
    ui.session = null;
    document.removeEventListener('keydown', onSessionKey);
    overlayEl.innerHTML = '';
    document.body.style.overflow = ui.modalOpen ? 'hidden' : '';
    renderRoute();
  }

  function onSessionKey(e) {
    if (!ui.session) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'Escape') { e.preventDefault(); closeSession(); return; }
    if (!ui.session.revealed && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      skipCurrent();
      return;
    }
    if (!ui.session.revealed && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      revealCard();
      return;
    }
    if (ui.session.revealed && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      gradeCurrent(Number(e.key) - 1);
    }
  }

  function renderSummary() {
    const s = ui.session;
    if (!s) return;
    const results = s.results;
    const newCount = results.filter(r => r.wasNew).length;
    const reviewCount = results.filter(r => !r.wasNew).length;
    const correct = results.filter(r => r.grade > 0).length;
    const accuracy = results.length ? pct(correct, results.length) : 0;
    const words = uniqBy(results.map(r => WORD_BY_ID.get(r.id)).filter(Boolean), w => w.id);
    recordSessionTime(s);
    state.session = null;
    save();
    const minutes = Math.max(1, Math.round((s.elapsedSeconds || 0) / 60));
    const nextLabel = words[0] ? reviewWhen(words[0]) : '稍后';
    overlayEl.innerHTML = `
      <div class="summary-overlay">
        <div class="summary-card">
          <div class="summary-badge"><svg><use href="#i-sprout"/></svg></div>
          <h2>今天的词，已经拾好。</h2>
          <p>${newCount ? `新认识了 ${newCount} 个词` : '完成了一轮复习'}${reviewCount ? `，复习了 ${reviewCount} 个词` : ''}。${accuracy >= 80 ? '状态很不错。' : '慢慢来，明天再见一面。'}</p>
          <div class="summary-stats">
            <div class="summary-stat"><strong>${newCount}</strong><span>新词</span></div>
            <div class="summary-stat"><strong>${reviewCount}</strong><span>复习</span></div>
            <div class="summary-stat"><strong>${accuracy}%</strong><span>认识率</span></div>
          </div>
          <div class="summary-words">${words.slice(0, 30).map(w => `<span>${esc(w.w)}</span>`).join('')}</div>
          <p style="margin-bottom:18px;font-size:10px;color:var(--muted-2)">本次用时约 ${minutes} 分钟 · 最早下次复习：${esc(nextLabel)} · 学习记录已保存</p>
          <div class="summary-actions">
            <button class="btn btn-ghost" data-action="close-summary">回到首页</button>
            <button class="btn btn-primary" data-action="start-extra">再学 10 个<svg><use href="#i-arrow"/></svg></button>
          </div>
        </div>
      </div>
    `;
    s.summaryOpen = true;
    launchConfetti();
    document.removeEventListener('keydown', onSessionKey);
  }

  function closeSummary() {
    ui.session = null;
    overlayEl.innerHTML = '';
    document.body.style.overflow = '';
    renderRoute();
  }


/* ===== 16-spell.js ===== */
/* ---------------- Spelling challenge ---------------- */
  function spellPool(source) {
    const learned = Object.keys(state.progress)
      .map(id => WORD_BY_ID.get(id))
      .filter(w => w && !w.phrase && w.w.length > 2);
    if (source === 'learned') return uniqBy(learned, w => w.id).filter(w => /^[A-Za-z][A-Za-z'\- ]*$/.test(w.w));
    let pool = learned.slice();
    if (source !== 'learned') {
      pool = pool.concat(pickNewWords(40).filter(w => !w.phrase && w.w.length > 2));
    }
    return uniqBy(pool, w => w.id).filter(w => /^[A-Za-z][A-Za-z'\- ]*$/.test(w.w));
  }

  function setSpellSource(source) {
    if (!['learned', 'all'].includes(source)) return;
    state.spellSource = source;
    save();
    renderRoute();
    toast(source === 'learned' ? '听写范围：只考学过的词' : '听写范围：学过的词优先', 'keyboard');
  }

  function openSpell(opts = {}) {
    // 默认只考学过的词；source=learned 时严格不混入新词。
    const source = opts.source || state.spellSource || 'learned';
    let pool = spellPool(source);
    if (!pool.length) {
      if (source === 'learned') {
        toast('还没有学过的词，先去学几个再来听写', 'book');
        return;
      }
      toast('先学几个词，再来听写吧', 'book');
      return;
    }
    const queue = shuffle(pool).slice(0, Math.min(10, pool.length));
    ui.spell = { queue, index: 0, score: 0, answered: false, answer: '', mode: state.spellMode || 'word' };
    renderSpellModal();
    setTimeout(() => {
      speak(queue[0].w);
      const input = document.getElementById('spell-input');
      if (input) input.focus();
    }, 320);
  }

  const SPELL_MODE_INFO = {
    // word 模式：给单词，写意思（不自动判对错，只给答案，自己判断）
    word: { title: '看单词，写意思', tip: '先写下你记得的意思，再看答案自己判断。', showWord: true, writeMeaning: true, placeholder: '输入你记得的中文意思' },
    meaning: { title: '看释义，写单词', tip: '根据中文释义回忆单词。', showWord: false, placeholder: '输入听到的单词' },
    audio: { title: '只听发音，写单词', tip: '听发音，把单词写出来。', showWord: false, placeholder: '输入听到的单词' },
  };

  function renderSpellModal() {
    const s = ui.spell;
    if (!s) return;
    if (s.index >= s.queue.length) { renderSpellResult(); return; }
    const w = s.queue[s.index];
    const mode = SPELL_MODE_INFO[s.mode] || SPELL_MODE_INFO.word;
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card spell-card" role="dialog" aria-modal="true" aria-label="听写挑战">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="modal-head" style="text-align:center;padding-right:0"><div class="eyebrow">SPELL &amp; RECALL</div><h2>${mode.title}</h2><p>${mode.tip}</p></div>
          <div class="spell-mode-row">
            ${[['word', '显示单词'], ['meaning', '显示词义'], ['audio', '只听发音']].map(([key, label]) => `<button class="spell-mode-chip ${s.mode === key ? 'is-on' : ''}" data-action="spell-mode" data-mode="${key}">${label}</button>`).join('')}
          </div>
          ${mode.showWord ? `<div class="spell-word">${esc(w.w)}</div>` : s.mode === 'meaning' ? `<div class="spell-meaning">${esc(w.tr)}</div>` : ''}
          <button class="spell-audio" data-action="spell-play" aria-label="再听一次"><svg><use href="#i-volume"/></svg></button>
          <p class="spell-hint">第 ${s.index + 1} / ${s.queue.length} 个 · 点击喇叭可以再听一次</p>
          <input class="spell-input ${mode.writeMeaning ? 'is-meaning' : ''}" id="spell-input" value="${esc(s.answer || '')}" placeholder="${mode.placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false" ${s.answered ? 'disabled' : ''}>
          ${s.answered ? (mode.writeMeaning ? `
            <div class="spell-reveal" id="spell-feedback">
              <div class="spell-reveal-head">正确答案</div>
              <div class="spell-reveal-answer">${esc(w.w)}</div>
              <div class="spell-reveal-meaning">${esc(w.tr)}</div>
            </div>` : `<div class="spell-feedback ${s.correct ? 'ok' : 'no'}" id="spell-feedback">${s.correct ? '✓ 拼写正确' : `✕ 正确拼写：${esc(w.w)}`}</div>`)
            : ''}
          ${mode.writeMeaning ? `<div class="spell-score"><span>已答 <b>${s.index + (s.answered ? 1 : 0)}</b> / ${s.queue.length}</span></div>` : `<div class="spell-score"><span>正确 <b>${s.score}</b></span><span>已答 <b>${s.index + (s.answered ? 1 : 0)}</b></span></div>`}
          <div style="margin-top:16px"><button class="btn ${s.answered ? 'btn-primary' : 'btn-coral'} btn-block" data-action="${s.answered ? 'spell-next' : 'spell-check'}">${s.answered ? '下一个' : (mode.writeMeaning ? '看答案' : '检查拼写')}</button></div>
        </div>
      </div>
    `);
    if (s.answered) {
      setTimeout(() => document.querySelector('[data-action="spell-next"]')?.focus(), 60);
    } else {
      setTimeout(() => { const input = document.getElementById('spell-input'); if (input) input.focus(); }, 50);
    }
  }

  function checkSpell() {
    const s = ui.spell;
    if (!s || s.answered) return;
    const input = document.getElementById('spell-input');
    const value = input ? input.value : '';
    if (!value.trim()) {
      const feedback = document.getElementById('spell-feedback');
      if (feedback) {
        feedback.textContent = '先写一个答案，再检查。';
        feedback.className = 'spell-feedback no';
      }
      if (input) input.focus();
      return;
    }
    const w = s.queue[s.index];
    const info = SPELL_MODE_INFO[s.mode] || SPELL_MODE_INFO.word;
    const normalize = str => String(str).toLowerCase().replace(/[\s'\-]/g, '');
    // 写意思模式不做自动判分，只展示答案，由用户自己判断。
    const ok = info.writeMeaning ? null : normalize(value) === normalize(w.w);
    s.answered = true;
    s.answer = value;
    s.correct = ok;
    if (ok) s.score++;
    const day = ensureDay();
    day.spell = (day.spell || 0) + 1;
    state.stats.spell = (state.stats.spell || 0) + 1;
    if (ok === true) day.correct = (day.correct || 0) + 1;
    else if (ok === false) day.wrong = (day.wrong || 0) + 1;
    touchStudy();
    save();
    renderSpellModal();
  }

  function spellNext() {
    const s = ui.spell;
    if (!s) return;
    s.index++;
    s.answered = false;
    s.correct = false;
    s.answer = '';
    if (s.index >= s.queue.length) { renderSpellResult(); return; }
    renderSpellModal();
    if (s.mode !== 'word') setTimeout(() => speak(s.queue[s.index].w), 240);
  }

  function renderSpellResult() {
    const s = ui.spell;
    if (!s) return;
    const total = s.queue.length;
    const score = s.score;
    const noJudge = (SPELL_MODE_INFO[s.mode] || {}).writeMeaning;
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card spell-card" role="dialog" aria-modal="true" aria-label="听写结果">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="summary-badge" style="margin-bottom:14px"><svg><use href="#i-trophy"/></svg></div>
          <div class="eyebrow">SPELLING RESULT</div>
          ${noJudge
            ? `<h2 style="margin:5px 0 8px">这一组写完了。</h2><p class="muted" style="font-size:12px">写意思模式不判对错，对照下面的答案自己回忆一遍。</p>`
            : `<h2 style="margin:5px 0 8px">${score === total ? '全部写对，厉害。' : score >= total * 0.7 ? '很稳，继续保持。' : '再听一遍，会记得更牢。'}</h2>
          <p class="muted" style="font-size:12px">这一组答对 <strong style="color:var(--accent);font-size:24px;font-family:var(--serif)">${score}</strong> / ${total} 个</p>`}
          <div class="summary-words" style="margin-top:20px">${s.queue.map(w => `<span>${esc(w.w)}</span>`).join('')}</div>
          <div class="summary-actions" style="margin-top:18px">
            <button class="btn btn-ghost" data-action="close-modal">先这样</button>
            <button class="btn btn-primary" data-action="spell-restart">再来一组</button>
          </div>
        </div>
      </div>
    `);
    launchConfetti();
  }

  function restartSpell() {
    ui.spell = null;
    openSpell();
  }

  function switchSpellMode(mode) {
    const s = ui.spell;
    if (!SPELL_MODE_INFO[mode]) return;
    state.spellMode = mode;
    save();
    if (!s) { renderRoute(); return; }
    s.mode = mode;
    renderSpellModal();
    if (mode !== 'word') setTimeout(() => speak(s.queue[s.index].w), 200);
  }


/* ===== 17-onboarding.js ===== */
/* ---------------- Onboarding ---------------- */
  function maybeOnboard() {
    if (state.profile.onboarded) return;
    ui.onboard = { step: 1, book: state.profile.book || 'senior', goal: state.profile.dailyGoal || 20, name: state.profile.name || '单词旅人' };
    ui.onboardOpen = true;
    document.body.style.overflow = 'hidden';
    renderOnboard();
  }

  function renderOnboard() {
    const ob = ui.onboard;
    const juniorCount = WORDS.filter(w => w.levels.includes('junior')).length;
    const seniorCount = WORDS.filter(w => w.levels.includes('senior')).length;
    const zsbCount = WORDS.filter(w => w.levels.includes('zhuanshengben')).length;
    const allCount = WORDS.length;
    const step = ob.step;
    overlayEl.innerHTML = `
      <div class="onboard">
        <div class="onboard-card">
          <div class="onboard-visual">
            <div>
              <img class="onboard-logo" src="assets/img/logo.svg" alt="拾词">
              <h2>拾起一个词，<br>就多看见一点世界。</h2>
              <p>面向初高中与专升本考生的英语单词学习工具。用间隔重复记住，用听写检验，用每天的十分钟，慢慢变熟。</p>
              <div class="onboard-words"><span>sprout</span><span>courage</span><span>wonder</span><span>journey</span><span>quiet</span></div>
            </div>
            <div class="onboard-foot">WORDGLEAM · 拾词</div>
          </div>
          <div class="onboard-form">
            <div class="onboard-step ${step === 1 ? 'is-on' : ''}">
              <div class="eyebrow">STEP 01 · YOUR PLAN</div>
              <h3>先选一个词库。</h3>
              <p class="sub">不用纠结，之后随时可以在设置里切换。</p>
              <div class="choice-grid">
                <button class="choice-card ${ob.book === 'junior' ? 'is-on' : ''}" data-action="onboard-book" data-book="junior"><strong>初中词库</strong><span>教材基础词 · 从七上到九全</span><em>${juniorCount} 词</em></button>
                <button class="choice-card ${ob.book === 'senior' ? 'is-on' : ''}" data-action="onboard-book" data-book="senior"><strong>高中词库</strong><span>必修 + 选修 + 高考补充</span><em>${seniorCount} 词</em></button>
                <button class="choice-card ${ob.book === 'zhuanshengben' ? 'is-on' : ''}" data-action="onboard-book" data-book="zhuanshengben"><strong>专升本词库</strong><span>统招大纲词汇 · 整合版</span><em>${zsbCount} 词</em></button>
                <button class="choice-card ${ob.book === 'all' ? 'is-on' : ''}" data-action="onboard-book" data-book="all"><strong>从初中到高中</strong><span>全部词库，按自己的节奏来</span><em>${allCount} 词</em></button>
              </div>
              <div style="margin-top:22px">
                <div class="eyebrow" style="margin-bottom:9px">每日目标</div>
                <div class="goal-grid">
                  ${[10, 20, 30, 50].map(n => `<button class="goal-chip ${ob.goal === n ? 'is-on' : ''}" data-action="onboard-goal" data-goal="${n}"><strong>${n}</strong><span>个 / 天</span></button>`).join('')}
                </div>
              </div>
            </div>

            <div class="onboard-step ${step === 2 ? 'is-on' : ''}">
              <div class="eyebrow">STEP 02 · SAY HELLO</div>
              <h3>怎么称呼你？</h3>
              <p class="sub">给自己起个名字，出现在首页和统计里。</p>
              <input class="name-input" id="onboard-name" maxlength="16" value="${esc(ob.name)}" placeholder="单词旅人">
              <div style="margin-top:18px" class="source-note"><svg><use href="#i-spark"/></svg><div>你的学习计划：<strong>${ob.book === 'junior' ? '初中词库' : ob.book === 'senior' ? '高中词库' : '全部词库'}</strong>，每天 <strong>${ob.goal}</strong> 个新词。到期复习会自动排进来。</div></div>
              <div class="setting-row" style="margin-top:8px"><div class="label"><strong>自动朗读</strong><span>显示单词时自动播放发音，可随时关闭。</span></div><label class="switch"><input type="checkbox" id="onboard-autospeak" checked><span></span></label></div>
              <div class="source-note" style="margin-top:8px"><svg><use href="#i-check"/></svg><div>所有记录只保存在本机浏览器。可以在设置里导出备份。</div></div>
            </div>

            <div class="onboard-actions">
              <div class="step-dots"><i class="${step === 1 ? 'is-on' : ''}"></i><i class="${step === 2 ? 'is-on' : ''}"></i></div>
              <div style="display:flex;gap:8px">
                ${step === 2 ? '<button class="btn btn-ghost btn-sm" data-action="onboard-back">上一步</button>' : ''}
                <button class="btn btn-primary" data-action="${step === 1 ? 'onboard-next' : 'onboard-done'}">${step === 1 ? '下一步' : '开始拾词'}<svg><use href="#i-arrow"/></svg></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    if (step === 2) {
      const name = document.getElementById('onboard-name');
      if (name) name.addEventListener('input', e => { ui.onboard.name = e.target.value; });
    }
  }

  function finishOnboarding() {
    const ob = ui.onboard;
    state.profile.book = ob.book;
    state.profile.dailyGoal = Number(ob.goal) || 20;
    state.profile.name = (ob.name || '').trim().slice(0, 16) || '单词旅人';
    state.profile.onboarded = true;
    const auto = document.getElementById('onboard-autospeak');
    if (auto) state.profile.autoSpeak = auto.checked;
    save();
    ui.onboardOpen = false;
    overlayEl.innerHTML = '';
    document.body.style.overflow = '';
    topbar();
    navigate('today');
    setTimeout(() => openSession({ mode: 'mixed' }), 260);
  }


/* ===== 18-actions.js ===== */
/* ---------------- Actions ---------------- */
  function toggleFavorite(id) {
    if (!id || !WORD_BY_ID.has(id)) return;
    const idx = state.favorites.indexOf(id);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.unshift(id);
    save();
    syncFavorites(id);
  }

  function syncFavorites(id) {
    $$('[data-action="toggle-favorite"][data-id]').forEach(btn => {
      if (btn.dataset.id === id) {
        const on = isFavorite(id);
        btn.classList.toggle('is-on', on);
        if (btn.classList.contains('row-star')) btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
      }
    });
    const detailBtn = $('.detail-actions [data-action="toggle-favorite"]');
    if (detailBtn && detailBtn.dataset.id === id) {
      const on = isFavorite(id);
      detailBtn.className = `btn btn-sm ${on ? 'btn-soft' : 'btn-ghost'}`;
      detailBtn.innerHTML = `<svg><use href="#i-star"/></svg>${on ? '已收藏' : '收藏'}`;
    }
    if (ui.route === 'library' && ui.libraryFilter === 'favorite') renderLibraryResults();
  }

  function setBook(book) {
    if (!book || !BOOK_LABELS[book]) return;
    if (state.profile.book === book) return;
    state.profile.book = book;
    ui.libraryPage = 1;
    save();
    topbar();
    renderRoute();
  }

  function toggleTheme() {
    state.profile.theme = state.profile.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
    if (ui.route === 'settings') renderRoute();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shici-backup-${dateKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('备份已导出', 'download');
  }

  function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = migrateState(JSON.parse(String(reader.result)));
        if (!imported || typeof imported !== 'object' || !imported.progress) throw new Error('invalid');
        if (!confirm('导入会覆盖当前学习记录，确定继续吗？')) return;
        state = {
          ...defaultState(),
          ...imported,
          profile: { ...defaultState().profile, ...(imported.profile || {}) },
          streak: { ...defaultState().streak, ...(imported.streak || {}) },
          stats: { ...defaultState().stats, ...(imported.stats || {}) },
          spellSource: ['learned', 'all', 'auto'].includes(imported.spellSource) ? imported.spellSource : 'learned',
          customBooks: imported.customBooks && typeof imported.customBooks === 'object' ? imported.customBooks : {},
          session: imported.session && typeof imported.session === 'object' ? imported.session : null,
          progress: sanitizeProgress(imported.progress),
          favorites: Array.isArray(imported.favorites) ? imported.favorites.filter(id => WORD_BY_ID.has(id)) : [],
          notes: imported.notes && typeof imported.notes === 'object' ? imported.notes : {},
          mistakeExcluded: Array.isArray(imported.mistakeExcluded)
            ? imported.mistakeExcluded.filter(id => WORD_BY_ID.has(id)) : [],
          days: imported.days && typeof imported.days === 'object' ? imported.days : {},
        };
        normalizeStreak();
        save();
        applyTheme();
        topbar();
        renderRoute();
        toast('学习记录已恢复', 'check');
      } catch (err) {
        toast('这个文件不是有效的拾词备份', 'close');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  
/* -------- Custom wordbook import -------- */
  function parseBookText(text) {
    const out = [];
    const seen = new Set();
    const rows = String(text || '').split(/\r?\n/);
    for (const line of rows) {
      const raw = line.trim();
      if (!raw || raw.startsWith('#')) continue;
      let w = '';
      let tr = '';
      let ph = '';
      // Tab / comma separated: apple \t 苹果 \t ˈæpl
      const cells = raw.split(/\t|,|，|\|/).map(s => s.trim()).filter(Boolean);
      if (cells.length >= 2) {
        w = cells[0];
        if (/^[\/\[]?[a-zˈˌːəɪʊɔæʌθðʃʒŋŋ'‑\- ]+[\/\]]?$/i.test(cells[1]) && cells[2]) {
          ph = cells[1].replace(/^[\/\[]|[\/\]]$/g, '');
          tr = cells[2];
        } else {
          tr = cells[1];
          ph = (cells[2] || '').replace(/^[\/\[]|[\/\]]$/g, '');
        }
      } else {
        // Whitespace: "apple 苹果"
        const m = raw.match(/^(\S+)\s+(.+)$/);
        if (!m) continue;
        w = m[1];
        tr = m[2];
      }
      w = w.replace(/^[\s*\-•\d.、]+/, '').trim();
      if (!/^[A-Za-z][A-Za-z'\- ]{0,38}$/.test(w)) continue;
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ w, ph: ph.slice(0, 40), tr: tr.slice(0, 120) });
      if (out.length >= 5000) break;
    }
    return out;
  }

  function openBookImport() {
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="导入自定义词库">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="modal-head"><div class="eyebrow">CUSTOM WORDS</div><h2>导入自己的词库</h2><p>支持纯文本（.txt）或 CSV：每行一个词，用 Tab、逗号或空格分隔。</p></div>
          <pre class="book-sample">apple	苹果	ˈæpl
banjo,班卓琴
cherry 樱桃</pre>
          <!-- A visible <label for> is the reliable file picker on mobile:
               programmatic .click() on a hidden input is blocked by iOS/Android. -->
          <label class="file-picker" for="book-file" data-action="pick-book-file">
            <svg><use href="#i-upload"/></svg>
            <span><strong>从手机文件中选择</strong><small>.txt / .csv / .md · 最多 5,000 个词</small></span>
          </label>
          <input class="file-input-native" type="file" id="book-file" accept=".txt,.csv,.md,text/plain,text/csv,application/vnd.ms-excel">
          <div class="drop-zone" id="book-drop">也可以把文件拖到这里（电脑）</div>
          <div class="import-tip">
            手机提示：点上面的区域会打开系统「文件」界面，第一次使用会请求存储/文件访问权限，请选择「允许」。<br>
            如果始终选不到文件，用下面的「直接粘贴单词」，同样可以建立词库。
          </div>
          <button class="btn btn-ghost btn-block" data-action="open-book-paste"><svg><use href="#i-pencil"/></svg>直接粘贴单词</button>
        </div>
      </div>
    `);
    bindBookDropZone();
  }

  function openBookPaste() {
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="粘贴单词">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="modal-head"><div class="eyebrow">PASTE WORDS</div><h2>直接粘贴单词</h2><p>每行一个词，格式：单词 空格/Tab/逗号 释义。</p></div>
          <div class="setting-row" style="padding-top:0">
            <div class="label"><strong>词库名称</strong></div>
            <input class="text-input" id="paste-book-name" type="text" maxlength="16" placeholder="我的词库" autocomplete="off">
          </div>
          <textarea class="paste-area" id="paste-book-text" placeholder="apple	苹果&#10;banjo,班卓琴&#10;cherry 樱桃"></textarea>
          <button class="btn btn-primary btn-block" style="margin-top:14px" data-action="save-pasted-book">保存并导入</button>
        </div>
      </div>
    `);
  }

  function savePastedBook() {
    const area = document.getElementById('paste-book-text');
    const nameInput = document.getElementById('paste-book-name');
    const text = area ? area.value : '';
    const words = parseBookText(text);
    if (!words.length) { toast('没识别到单词，每行写「单词 释义」', 'close'); return; }
    const label = ((nameInput && nameInput.value) || '我的词库').trim().slice(0, 16) || '我的词库';
    const key = createBookFromText(words, label);
    if (!key) { toast('导入失败，请检查格式', 'close'); return; }
    state.profile.book = key;
    save();
    closeModal();
    topbar();
    navigate('library');
    toast(`已导入 ${words.length} 个词到「${label}」`, 'book');
  }

  // Decode without relying on the browser guessing the encoding:
  // Chinese CSVs are often GBK, plain word lists are usually UTF-8.
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.onload = () => {
        const buffer = reader.result;
        try {
          let text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
          if (text.includes('\uFFFD')) throw new Error('not utf8');
          resolve(text.replace(/^\uFEFF/, ''));
        } catch {
          try {
            resolve(new TextDecoder('gbk').decode(buffer).replace(/^\uFEFF/, ''));
          } catch {
            resolve(new TextDecoder().decode(buffer));
          }
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function importBookFile(file) {
    if (!file) { toast('没有选择文件', 'close'); return; }
    const okExt = /\.(txt|csv|md|text)$/i.test(file.name || '');
    if (!okExt) {
      toast('请选择 .txt、.csv 或 .md 文件', 'close');
      return;
    }
    if (file.size > 3 * 1024 * 1024) { toast('文件太大了，请控制在 3MB 以内', 'close'); return; }
    readFileText(file).then(text => {
      const words = parseBookText(text);
      if (words.length < 1) {
        toast('没识别到单词，每行写「单词 释义」', 'close');
        return;
      }
      const label = (file.name || '我的词库').replace(/\.[^.]+$/, '').slice(0, 16) || '我的词库';
      const key = createBookFromText(words, label);
      if (!key) { toast('导入失败，请检查文件内容', 'close'); return; }
      state.profile.book = key;
      save();
      closeModal();
      topbar();
      navigate('library');
      toast(`已导入 ${words.length} 个词到「${label}」`, 'book');
    }).catch(() => toast('读取文件失败，可以改用「直接粘贴单词」', 'close'));
  }

  function onBookFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importBookFile(file);
  }

  /** Bind drag & drop once per modal render (desktop convenience). */
  function bindBookDropZone() {
    const zone = document.getElementById('book-drop');
    if (!zone) return;
    const clear = () => zone.classList.remove('is-over');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', clear);
    zone.addEventListener('drop', e => {
      e.preventDefault();
      clear();
      const file = e.dataTransfer?.files?.[0];
      if (file) importBookFile(file);
    });
    zone.addEventListener('click', () => document.getElementById('book-file')?.click());
  }

  function deleteCustomBook(key) {
    if (!state.customBooks || !state.customBooks[key]) return;
    const label = state.customBooks[key].label || '这个词库';
    if (!confirm(`删除「${label}」？学习记录会保留在进度里。`)) return;
    removeCustomBook(key);
    save();
    topbar();
    renderRoute();
    toast('词库已删除', 'check');
  }

  function createBookFromText(rawWords, label) {
    const words = rawWords.filter(w => w && w.w);
    if (!words.length) return null;
    const key = `u_${Date.now().toString(36)}`;
    saveCustomBook(key, label || '我的词库', words);
    if (!BOOK_LABELS[key]) registerBook(key, { label: label || '我的词库', filter: w => CUSTOM_WORDS.get(w.id)?.custom === key });
    save();
    return key;
  }

  function bookWordsPreview(key) {
    const book = customBooks()[key];
    return book ? book.words.length : 0;
  }

  function confirmReset() {
    openModal(`
      <div class="modal-backdrop" data-action="backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="确认清空进度">
          <button class="icon-btn modal-close" data-action="close-modal" aria-label="关闭"><svg><use href="#i-close"/></svg></button>
          <div class="modal-head"><div class="eyebrow">RESET PROGRESS</div><h2>要清空学习进度吗？</h2><p>会删除所有单词进度、统计数据、连续记录和听写记录。收藏与笔记会保留，此操作不可撤销。</p></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:22px">
            <button class="btn btn-ghost" data-action="close-modal">再想想</button>
            <button class="btn btn-coral" data-action="reset-progress">确认清空</button>
          </div>
        </div>
      </div>
    `);
  }

  function resetProgress() {
    state.progress = {};
    state.days = {};
    state.mistakeExcluded = [];
    state.streak = { current: 0, best: 0, last: '' };
    state.stats = { totalNew: 0, totalReviews: 0, correct: 0, wrong: 0, spell: 0, seconds: 0 };
    save();
    closeModal();
    topbar();
    renderRoute();
    toast('学习进度已清空，重新开始吧', 'sprout');
  }

  function onProfileName(e) {
    state.profile.name = (e.target.value || '').trim().slice(0, 16) || '单词旅人';
    debounceSave();
    topbar();
  }
  function onAutoSpeak(e) {
    state.profile.autoSpeak = e.target.checked;
    save();
  }
  function onShuffleChange(e) {
    state.profile.shuffle = e.target.checked;
    save();
    toast(state.profile.shuffle ? '已开启乱序背单词' : '已恢复按顺序背单词', 'book');
  }

  function toggleSidebar(force) {
    const sidebar = $('.sidebar');
    if (!sidebar) return;
    const open = typeof force === 'boolean' ? force : !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('sidebar-open', open);
    let scrim = document.getElementById('sidebar-scrim');
    if (open && !scrim) {
      scrim = document.createElement('div');
      scrim.id = 'sidebar-scrim';
      scrim.className = 'sidebar-scrim';
      scrim.addEventListener('click', () => toggleSidebar(false));
      document.body.appendChild(scrim);
    }
    if (!open && scrim) scrim.remove();
    if (open) document.body.style.overflow = 'hidden';
    else if (!ui.modalOpen && !ui.session && !ui.onboardOpen) document.body.style.overflow = '';
  }


/* ===== 19-events.js ===== */
/* ---------------- Reminder notifications ---------------- */
  const REMINDER_KEY = 'shici.reminder.v1';

  function reminderConfig() {
    const raw = state.profile.reminder;
    return {
      enabled: !!(raw && raw.enabled),
      time: (raw && /^\d{2}:\d{2}$/.test(raw.time)) ? raw.time : '20:00',
      lastFired: (raw && raw.lastFired) || '',
    };
  }

  function reminderSupported() {
    return typeof Notification !== 'undefined';
  }

  function reminderPermission() {
    if (!reminderSupported()) return 'unsupported';
    return Notification.permission; // default | granted | denied
  }

  /** Ask for the OS notification permission (mobile needs an explicit grant). */
  function requestReminderPermission() {
    return new Promise((resolve) => {
      if (!reminderSupported()) { resolve('unsupported'); return; }
      if (Notification.permission === 'granted') { resolve('granted'); return; }
      if (Notification.permission === 'denied') { resolve('denied'); return; }
      try {
        const result = Notification.requestPermission((p) => resolve(p));
        if (result && typeof result.then === 'function') result.then(resolve).catch(() => resolve('denied'));
      } catch {
        resolve('denied');
      }
    });
  }

  let reminderTimer = null;

  function scheduleReminderCheck() {
    if (reminderTimer) clearTimeout(reminderTimer);
    const flush = () => { // keep the timestamp in backup files
      try { localStorage.setItem(REMINDER_KEY, JSON.stringify(reminderConfig())); } catch {}
    };
    flush();
    const tick = () => {
      checkReminder();
      reminderTimer = setTimeout(tick, 60 * 1000);
    };
    reminderTimer = setTimeout(tick, 60 * 1000);
  }

  function checkReminder() {
    const cfg = reminderConfig();
    if (!cfg.enabled) return;
    if (reminderPermission() !== 'granted') return;
    const now = new Date();
    const [hh, mm] = cfg.time.split(':').map(Number);
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (now < target) return;
    const today = dateKey(now);
    if (cfg.lastFired === today) return;
    const day = getDay(today);
    const done = (day.new || 0) + (day.review || 0);
    const goal = state.profile.dailyGoal || 20;
    if (done >= goal) { markReminderFired(today); return; }
    fireReminder(done, goal);
    markReminderFired(today);
  }

  function markReminderFired(today) {
    state.profile.reminder = { ...reminderConfig(), lastFired: today };
    save();
  }

  function fireReminder(done, goal) {
    const remain = Math.max(0, goal - done);
    const title = '拾词 · 今天的词还没拾完';
    const body = remain ? `还差 ${remain} 个词就到今天的计划了。` : '来复习几个词，让记忆保持温度。';
    try {
      const n = new Notification(title, { body, tag: 'shici-daily', icon: 'assets/img/logo.svg', badge: 'assets/img/logo.svg' });
      n.onclick = () => { try { window.focus(); } catch {} };
      setTimeout(() => { try { n.close(); } catch {} }, 30000);
    } catch {
      // Shown as an in-app fallback where the OS blocks notifications.
      if (typeof toast === 'function') toast(body, 'sprout');
    }
  }

  async function enableReminder(time) {
    const cfg = reminderConfig();
    const permission = await requestReminderPermission();
    if (permission === 'unsupported') {
      toast('当前环境不支持通知，可以在手机系统设置里给拾词打开通知', 'close');
      return;
    }
    if (permission !== 'granted') {
      toast('通知权限被拒绝，请到系统设置里手动允许「拾词」通知', 'close');
      return;
    }
    state.profile.reminder = { enabled: true, time: time || cfg.time, lastFired: '' };
    save();
    scheduleReminderCheck();
    renderRoute();
    toast(`已开启每日 ${state.profile.reminder.time} 提醒`, 'check');
  }

  function setReminderTime(time) {
    if (!/^\d{2}:\d{2}$/.test(time || '')) return;
    const cfg = reminderConfig();
    state.profile.reminder = { ...cfg, time, lastFired: '' };
    save();
    scheduleReminderCheck();
    renderRoute();
  }

  function disableReminder() {
    const cfg = reminderConfig();
    state.profile.reminder = { ...cfg, enabled: false };
    save();
    if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
    renderRoute();
    toast('已关闭每日提醒', 'check');
  }

  async function testReminder() {
    const permission = await requestReminderPermission();
    if (permission !== 'granted') {
      toast('需要通知权限才能测试，请允许后重试', 'close');
      return;
    }
    fireReminder(0, state.profile.dailyGoal || 20);
  }

  function onReminderToggle(e) {
    if (e.target.checked) {
      const cfg = reminderConfig();
      enableReminder(cfg.time);
    } else {
      disableReminder();
    }
  }

  function onReminderTime(e) {
    setReminderTime(e.target.value);
  }
/* ---------------- Delegated events ---------------- */
  function handleAction(action, el, e) {
    if (CUSTOM_ACTIONS.has(action)) {
      CUSTOM_ACTIONS.get(action)(el, e);
      return;
    }
    switch (action) {
      case 'start-session': openSession({ mode: 'mixed' }); break;
      case 'resume-session':
        if (!resumeSession()) { state.session = null; save(); renderRoute(); }
        break;
      case 'discard-session': state.session = null; save(); renderRoute(); toast('已放弃这一组，下次重新开始', 'check'); break;
      case 'spell-mode':
        if (ui.spell) switchSpellMode(el.dataset.mode);
        else setSpellMode(el.dataset.mode);
        break;
      case 'pick-book-file': break;
      case 'request-notification': requestReminderPermission().then(p => { renderRoute(); toast(p === 'granted' ? '通知权限已允许' : '通知权限未开启，请到系统设置里允许', p === 'granted' ? 'check' : 'close'); }); break;
      case 'test-reminder': testReminder(); break;
      case 'open-book-import': openBookImport(); break;
      case 'open-book-paste': openBookPaste(); break;
      case 'save-pasted-book': savePastedBook(); break;
      case 'delete-book': deleteCustomBook(el.dataset.book); break;
      case 'set-filter': ui.libraryFilter = el.dataset.filter; ui.libraryPage = 1; renderRoute(); break;
      case 'toggle-shuffle-library': toggleLibraryShuffle(); break;
      case 'stats-more': ui.statsPage += 1; renderRoute(); break;
      case 'start-review': openSession({ mode: 'review' }); break;
      case 'review-learned': openSession({ mode: 'learned' }); break;
      case 'spell-learned': openSpell({ source: 'learned' }); break;
      case 'set-spell-source': setSpellSource(el.dataset.source); break;
      case 'start-extra': closeSummary(); openSession({ mode: 'extra', extra: 10 }); break;
      case 'open-spell': openSpell(); break;
      case 'close-session': closeSession(); break;
      case 'close-summary': closeSummary(); break;
      case 'reveal-card': revealCard(); break;
      case 'skip-word': skipCurrent(); break;
      case 'grade': gradeCurrent(Number(el.dataset.grade)); break;
      case 'audio': speak(el.dataset.word, 0.86, true); break;
      case 'toggle-favorite': toggleFavorite(el.dataset.id); break;
      case 'open-word': openWordDetail(el.dataset.id); break;
      case 'learn-single': closeModal(); openSession({ mode: 'single', ids: [el.dataset.id] }); break;
      case 'close-modal': closeModal(); break;
      case 'backdrop': if (e.target === el) closeModal(); break;
      case 'test-audio': speak('hello', 0.86, true); break;
      case 'toggle-theme': toggleTheme(); break;
      case 'set-theme':
        state.profile.theme = el.dataset.theme === 'dark' ? 'dark' : 'light';
        applyTheme(); save();
        $$('[data-action="set-theme"]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.theme === state.profile.theme));
        break;
      case 'select-word': selectWord(el); break;
      case 'open-settings': navigate('settings'); break;
      case 'toggle-nav': toggleSidebar(); break;
      case 'go-library': navigate('library'); break;
      case 'set-book': setBook(el.dataset.book); break;
      case 'set-goal':
        state.profile.dailyGoal = Number(el.dataset.goal) || 20;
        save(); topbar();
        $$('[data-action="set-goal"]').forEach(btn => btn.classList.toggle('is-on', Number(btn.dataset.goal) === state.profile.dailyGoal));
        toast(`每日目标设为 ${state.profile.dailyGoal} 个词`, 'target');
        break;
      case 'set-accent':
        state.profile.accent = el.dataset.accent === 'uk' ? 'uk' : 'us';
        save();
        $$('[data-action="set-accent"]').forEach(btn => btn.classList.toggle('is-on', btn.dataset.accent === state.profile.accent));
        toast(state.profile.accent === 'uk' ? '已切换英音' : '已切换美音', 'volume');
        break;
      case 'clear-search': ui.libraryQuery = ''; ui.libraryFilter = 'all'; ui.libraryPage = 1; renderRoute(); break;
      case 'load-more': ui.libraryPage++; renderLibraryResults(); break;
      case 'export-data': exportData(); break;
      case 'import-data': document.getElementById('import-file')?.click(); break;
      case 'confirm-reset': confirmReset(); break;
      case 'reset-progress': resetProgress(); break;
      case 'spell-play': if (ui.spell) speak(ui.spell.queue[ui.spell.index]?.w, 0.86, true); break;
      case 'spell-check': checkSpell(); break;
      case 'spell-next': spellNext(); break;
      case 'spell-restart': restartSpell(); break;
      case 'onboard-book': ui.onboard.book = el.dataset.book; renderOnboard(); break;
      case 'onboard-goal': ui.onboard.goal = Number(el.dataset.goal); renderOnboard(); break;
      case 'onboard-next': ui.onboard.step = 2; renderOnboard(); break;
      case 'onboard-back': ui.onboard.step = 1; renderOnboard(); break;
      case 'onboard-done': finishOnboarding(); break;
      default: break;
    }
  }

  function onClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'backdrop' && e.target !== actionEl) return;
      if (action === 'toggle-favorite' || action === 'select-word') e.stopPropagation();
      e.preventDefault();
      handleAction(action, actionEl, e);
      return;
    }
    const navLink = e.target.closest('a[href^="#/"]');
    if (navLink) toggleSidebar(false);
  }

  /**
   * Single tap on a word row only highlights it and shows a small hint.
   * Opening the detail sheet used to happen on any tap, which felt like the
   * app was jumping to another screen by accident.
   */
  function selectWord(el) {
    const id = el.dataset.id;
    const w = WORD_BY_ID.get(id);
    if (!w) return;
    $$('.word-row.is-selected, .due-item.is-selected, .learned-item.is-selected')
      .forEach(row => row.classList.remove('is-selected'));
    el.classList.add('is-selected');
    const st = statusInfo(w);
    toast(`${w.w} · ${st.label} · 点右侧箭头看详情`, 'book');
  }

  function onRowHold(e) {
    const row = e.target.closest('.word-row, .due-item, .learned-item');
    if (!row || !row.dataset.id) return;
    if (e.target.closest('[data-action]') && !e.target.closest('[data-action="select-word"]')) return;
    openWordDetail(row.dataset.id);
    row.classList.remove('is-selected');
  }

  function onKeydown(e) {
    if (ui.session) {
      if (ui.session.summaryOpen && e.key === 'Escape') {
        e.preventDefault();
        closeSummary();
      }
      return;
    }
    if (ui.spell && e.key === 'Enter') {
      e.preventDefault();
      if (ui.spell.answered) spellNext(); else checkSpell();
      return;
    }
    if (ui.modalOpen && e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      e.preventDefault(); toggleSidebar(false); return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.word-row, .due-item')) {
      e.preventDefault();
      e.target.click();
    }
  }

  function onInput(e) {
    if (e.target.id === 'library-search') {
      ui.libraryQuery = e.target.value;
      ui.libraryPage = 1;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderLibraryResults, 120);
      return;
    }
    if (e.target.matches('[data-note-id]')) {
      state.notes[e.target.dataset.noteId] = e.target.value;
      debounceSave();
    }
  }

  function onChange(e) {
    if (e.target.id === 'library-filter') {
      ui.libraryFilter = e.target.value;
      ui.libraryPage = 1;
      renderLibraryResults();
      return;
    }
    if (e.target.id === 'book-file') {
      onBookFile(e);
    }
  }


/* ===== 20-init.js ===== */
/* ---------------- Init ---------------- */
  async function init() {
    await loadState();
    normalizeStreak();
    applyTheme();
    topbar();
    setRouteChrome(currentRoute());
    renderRoute();
    window.addEventListener('hashchange', () => {
      toggleSidebar(false);
      renderRoute();
    });
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    // Mobile browsers often need a gesture before speech/audio is unlocked.
    document.addEventListener('pointerdown', () => {
      try {
        if ('speechSynthesis' in window) {
          refreshVoices();
          if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        }
      } catch {}
    }, { once: true, passive: true });
    // Extra safety: flush the latest state before the window/app closes.
    window.addEventListener('pagehide', () => { save(); flushIdbBackup(); });
    window.addEventListener('beforeunload', () => { save(); flushIdbBackup(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { save(); flushIdbBackup(); }
    });
    setTimeout(() => {
      document.getElementById('boot-screen')?.classList.add('is-gone');
      maybeOnboard();
    }, 420);
    if (isFeatureEnabled('pwa') && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // Resume the daily reminder loop (checks once a minute while the app is open).
    setTimeout(() => { try { scheduleReminderCheck(); } catch {} }, 1200);
  }

  // Small public extension surface for future feature pieces / debugging.
  window.WordGleam = Object.freeze({
    version: APP_VERSION,
    stateVersion: STATE_VERSION,
    features: FEATURES,
    registerRoute,
    registerAction,
    registerBook,
    registerStateMigration,
    registerFeature,
    isFeatureEnabled,
    navigate,
    setBook,
    openSession,
    openWordDetail,
    toast,
    getWord: id => WORD_BY_ID.get(id) || null,
    getState: () => JSON.parse(JSON.stringify(state)),
  });

  init();

})();

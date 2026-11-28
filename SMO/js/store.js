/* =====================================================================
 * LỚP DỮ LIỆU — toàn bộ dữ liệu lưu trong trình duyệt (không cần máy chủ)
 *  - Dữ liệu chính (JSON): localStorage, key "lms_offline_v1"
 *  - File tài liệu tải lên: IndexedDB "lms_offline_files"
 * ===================================================================== */

const DB_KEY = 'lms_offline_v1';
const SESSION_KEY = 'lms_session';
const PIN_VALID_MINUTES = 15;
const EXAM_GRACE_SECONDS = 120;
const ROLES = ['admin', 'teacher', 'student'];
const ATTENDANCE_STATUSES = ['Có mặt', 'Đi muộn', 'Vắng có phép', 'Vắng không phép'];

/* ---------- SHA-256 thuần JS (chạy cả khi mở bằng file://) ---------- */
function sha256(str) {
    const ascii = unescape(encodeURIComponent(str));
    const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const bitLen = ascii.length * 8;
    let hash = sha256.h = sha256.h || [];
    const k = sha256.k = sha256.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
            hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
            k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
        }
    }
    let msg = ascii + '\x80';
    while (msg.length % 64 - 56) msg += '\x00';
    for (let i = 0; i < msg.length; i++) words[i >> 2] |= msg.charCodeAt(i) << ((3 - i) % 4) * 8;
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash;
        hash = hash.slice(0, 8);
        for (let i = 0; i < 64; i++) {
            const w15 = w[i - 15], w2 = w[i - 2];
            const a = hash[0], e = hash[4];
            const temp1 = hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
                (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                    w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
            const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
                ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
            hash = [(temp1 + temp2) | 0].concat(hash);
            hash[4] = (hash[4] + temp1) | 0;
        }
        for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
        for (let j = 3; j + 1; j--) {
            const b = (hash[i] >> (j * 8)) & 255;
            result += ((b < 16) ? 0 : '') + b.toString(16);
        }
    }
    return result;
}

function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function hashPassword(raw) {
    const salt = randomHex(8);
    return `sha256$${salt}$${sha256(salt + raw)}`;
}

function checkPassword(user, raw) {
    const [algo, salt, h] = String(user.password).split('$');
    return algo === 'sha256' && sha256(salt + raw) === h;
}

/* ---------- Thời gian ---------- */
const pad = n => String(n).padStart(2, '0');
function fmtDateTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function todayStr() { return fmtDateTime(Date.now()).slice(0, 10); }

/* ---------- Dữ liệu chính ---------- */
let DB = null;

function seedData() {
    const now = Date.now();
    const data = {
        version: 1,
        seq: {},
        users: [], courses: [], attendance: [], materials: [], exams: [], results: [],
        examStarts: {}, events: [], logs: [], chats: {}
    };
    const add = (table, obj) => {
        data.seq[table] = (data.seq[table] || 0) + 1;
        obj.id = data.seq[table];
        data[table].push(obj);
        return obj;
    };
    add('users', { username: 'admin', password: hashPassword('123'), full_name: 'Quản Trị Viên', role: 'admin', is_active: true });
    const gv = add('users', { username: 'gv1', password: hashPassword('123'), full_name: 'Thầy Nguyễn Văn A', role: 'teacher', is_active: true });
    add('users', { username: 'hs1', password: hashPassword('123'), full_name: 'Em Trần Thị B', role: 'student', is_active: true });
    add('users', { username: 'hs2', password: hashPassword('123'), full_name: 'Em Lê Văn C', role: 'student', is_active: true });
    const c1 = add('courses', { name: 'Toán Cao Cấp - Lớp 12A1', teacher_id: gv.id, pin: '', pin_created_at: null });
    add('exams', {
        course_id: c1.id, title: 'Kiểm tra 15 phút Giải tích', duration: 15, password: '',
        questions: [
            { id: 1, level: 'Dễ', type: 'mc', question: '2 + 2 bằng mấy?', options: ['3', '4', '5', '6'], answer: '4' },
            { id: 2, level: 'Trung bình', type: 'mc', question: 'Đạo hàm của x^2 là gì?', options: ['x', '2x', 'x^2', '2'], answer: '2x' },
            { id: 3, level: 'Khó', type: 'essay', question: 'Trình bày ứng dụng của tích phân trong tính diện tích hình phẳng.' }
        ]
    });
    add('events', { title: 'Kiểm tra giữa kỳ Toán', event_date: '2026-12-05', description: 'Học sinh mang theo máy tính bỏ túi.' });
    add('logs', { user_name: 'Hệ thống', action: 'Khởi tạo dữ liệu mẫu', timestamp: now });
    return data;
}

function loadDB() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (data && data.version === 1) { DB = data; return DB; }
        }
    } catch (e) { console.error('Dữ liệu hỏng, tạo lại dữ liệu mẫu', e); }
    DB = seedData();
    saveDB();
    return DB;
}

function saveDB() {
    try {
        localStorage.setItem(DB_KEY, JSON.stringify(DB));
    } catch (e) {
        alert('Không lưu được dữ liệu (bộ nhớ trình duyệt đầy hoặc đang ở chế độ ẩn danh).');
        throw e;
    }
}

/** Mọi thay đổi đi qua đây: đọc lại bản mới nhất (tránh ghi đè dữ liệu của tab khác) rồi lưu. */
function mutate(fn) {
    loadDB();
    const out = fn(DB);
    saveDB();
    return out;
}

function insert(table, obj) {
    DB.seq[table] = (DB.seq[table] || 0) + 1;
    obj.id = DB.seq[table];
    DB[table].push(obj);
    return obj;
}

function byId(table, id) { return DB[table].find(x => x.id === Number(id)); }

function logAction(userName, action) {
    insert('logs', { user_name: userName, action, timestamp: Date.now() });
    if (DB.logs.length > 500) DB.logs = DB.logs.slice(-500);
}

/* ---------- Phiên đăng nhập (mỗi tab một phiên) ---------- */
function currentUser() {
    try {
        const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (!s) return null;
        const u = byId('users', s.uid);
        return u && u.is_active ? u : null;
    } catch (e) { return null; }
}
function setSession(uid) { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid })); }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

/* ---------- Lưu file tài liệu bằng IndexedDB ---------- */
const FileStore = {
    _db: null,
    open() {
        if (this._db) return Promise.resolve(this._db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('lms_offline_files', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('files');
            req.onsuccess = () => { this._db = req.result; resolve(this._db); };
            req.onerror = () => reject(req.error);
        });
    },
    async _tx(mode, fn) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('files', mode);
            const req = fn(tx.objectStore('files'));
            tx.oncomplete = () => resolve(req && req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    },
    put(key, blob) { return this._tx('readwrite', s => s.put(blob, key)); },
    get(key) { return this._tx('readonly', s => s.get(key)); },
    del(key) { return this._tx('readwrite', s => s.delete(key)); },
    keys() { return this._tx('readonly', s => s.getAllKeys()); },
    clear() { return this._tx('readwrite', s => s.clear()); }
};

/* ---------- Kiểm tra đề thi JSON ---------- */
function validateQuestions(raw) {
    let questions;
    try { questions = JSON.parse(raw); } catch (e) { return [null, 'JSON không hợp lệ: ' + e.message]; }
    if (!Array.isArray(questions) || !questions.length) return [null, 'Danh sách câu hỏi phải là một mảng JSON và không được rỗng.'];
    const seen = new Set();
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i], n = i + 1;
        if (!q || typeof q !== 'object' || Array.isArray(q)) return [null, `Câu ${n}: phải là một đối tượng JSON.`];
        if (q.id === undefined || seen.has(String(q.id))) return [null, `Câu ${n}: thiếu "id" hoặc "id" bị trùng.`];
        seen.add(String(q.id));
        if (!String(q.question || '').trim()) return [null, `Câu ${n}: thiếu nội dung "question".`];
        if (!['mc', 'essay'].includes(q.type)) return [null, `Câu ${n}: "type" phải là "mc" (trắc nghiệm) hoặc "essay" (tự luận).`];
        if (q.type === 'mc') {
            if (!Array.isArray(q.options) || q.options.length < 2) return [null, `Câu ${n}: câu trắc nghiệm cần ít nhất 2 "options".`];
            q.options = q.options.map(String);
            if (!q.options.includes(String(q.answer))) return [null, `Câu ${n}: "answer" phải trùng với một trong các "options".`];
            q.answer = String(q.answer);
        }
    }
    return [questions, null];
}

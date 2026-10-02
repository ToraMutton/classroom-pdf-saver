// 保存先フォルダ（IndexedDB）と保存履歴・コース設定・記憶したパスワード（chrome.storage.local）の管理
//
// FileSystemDirectoryHandle は chrome.storage に入れられない（JSON化できない）ため、
// structured clone で保存できる IndexedDB に置く。

const DB_NAME = 'classroom-pdf-saver';
const STORE = 'folders';
const HISTORY_LIMIT = 500;

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => { db.close(); resolve(req.result); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

// { id, handle, name, createdAt, lastUsed }[] を最近使った順で返す
export async function listFolders() {
    const all = await tx('readonly', s => s.getAll());
    return all.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
}

export async function getFolder(id) {
    return tx('readonly', s => s.get(id));
}

// 同じフォルダが登録済みならそれを返し、なければ追加する
export async function addFolder(handle) {
    for (const f of await listFolders()) {
        if (await f.handle.isSameEntry(handle)) {
            await touchFolder(f.id);
            return f.id;
        }
    }
    const now = Date.now();
    return tx('readwrite', s => s.add({ handle, name: handle.name, createdAt: now, lastUsed: now }));
}

export async function touchFolder(id) {
    const f = await getFolder(id);
    if (!f) return;
    f.lastUsed = Date.now();
    await tx('readwrite', s => s.put(f));
}

export async function removeFolder(id) {
    await tx('readwrite', s => s.delete(id));
    const { courseFolders = {} } = await chrome.storage.local.get('courseFolders');
    for (const [course, folderId] of Object.entries(courseFolders)) {
        if (folderId === id) delete courseFolders[course];
    }
    await chrome.storage.local.set({ courseFolders });
}

// ---- コースごとの保存先 ----

export async function getCourseFolders() {
    const { courseFolders = {} } = await chrome.storage.local.get('courseFolders');
    return courseFolders;
}

export async function setCourseFolder(courseId, folderId) {
    if (!courseId) return;
    const courseFolders = await getCourseFolders();
    courseFolders[courseId] = folderId;
    await chrome.storage.local.set({ courseFolders });
}

export async function getCourseNames() {
    const { courseNames = {} } = await chrome.storage.local.get('courseNames');
    return courseNames;
}

export async function setCourseName(courseId, name) {
    if (!courseId || !name) return;
    const courseNames = await getCourseNames();
    if (courseNames[courseId] === name) return;
    courseNames[courseId] = name;
    await chrome.storage.local.set({ courseNames });
}

// ---- 保存履歴 ----
// key: `${kind}:${fileId}` → { key, name, folderId, folderName, courseName, at }

export async function getHistory() {
    const { history = {} } = await chrome.storage.local.get('history');
    return history;
}

export async function addHistory(entry) {
    const history = await getHistory();
    history[entry.key] = entry;
    const keys = Object.keys(history);
    if (keys.length > HISTORY_LIMIT) {
        keys.sort((a, b) => history[a].at - history[b].at)
            .slice(0, keys.length - HISTORY_LIMIT)
            .forEach(k => delete history[k]);
    }
    await chrome.storage.local.set({ history });
}

export async function removeHistory(key) {
    const history = await getHistory();
    delete history[key];
    await chrome.storage.local.set({ history });
}

export async function clearHistory() {
    await chrome.storage.local.set({ history: {} });
}

// ---- 鍵付き PDF のパスワード（授業ごと） ----
// ユーザーが「記憶する」を選んだときだけ保存する。chrome.storage.local はこの PC の
// ブラウザプロファイル内に（暗号化されずに）残り、Google アカウントには同期されない。
// 同期される chrome.storage.sync には入れないこと。

export async function getCoursePasswords() {
    const { coursePasswords = {} } = await chrome.storage.local.get('coursePasswords');
    return coursePasswords;
}

export async function getCoursePassword(courseId) {
    if (!courseId) return null;
    return (await getCoursePasswords())[courseId] ?? null;
}

export async function setCoursePassword(courseId, password) {
    if (!courseId) return;
    const coursePasswords = await getCoursePasswords();
    coursePasswords[courseId] = password;
    await chrome.storage.local.set({ coursePasswords });
}

export async function removeCoursePassword(courseId) {
    const coursePasswords = await getCoursePasswords();
    delete coursePasswords[courseId];
    await chrome.storage.local.set({ coursePasswords });
}

export async function clearCoursePasswords() {
    await chrome.storage.local.set({ coursePasswords: {} });
}

// ---- 権限 ----

export async function hasPermission(handle) {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

// ユーザー操作（クリック）の直後に呼ぶ必要がある
export async function ensurePermission(handle) {
    if (await hasPermission(handle)) return true;
    try {
        return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch {
        return false;
    }
}

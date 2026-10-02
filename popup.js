import { scanPage } from './lib/scan.js';
import { fetchItem, decideFilename, writeFile, KIND_LABEL } from './lib/download.js';
import { needsPassword, unlockPdf } from './lib/unlock.js';
import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);

const state = {
    page: null,       // scanPage() の結果
    folders: [],      // store.listFolders()
    history: {},      // store.getHistory()
    checked: new Set(),
    saving: false,
    passwords: [],    // 入力して鍵を外せたパスワード（ポップアップを閉じると消える）
    answerPassword: null, // パスワード入力欄の応答を待っている Promise の resolve
};

function selectedFolder() {
    const id = Number($('folder').value);
    return state.folders.find(f => f.id === id) ?? null;
}

function openManage(params = {}) {
    const url = new URL(chrome.runtime.getURL('manage.html'));
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    chrome.tabs.create({ url: url.href });
    window.close();
}

function openManageForAdd() {
    openManage({ add: '1', course: state.page?.courseId, courseName: state.page?.courseName });
}

function showNote(text, buttonLabel, onClick) {
    const note = $('folder-note');
    note.textContent = text;
    if (buttonLabel) {
        const b = document.createElement('button');
        b.textContent = buttonLabel;
        b.addEventListener('click', onClick);
        note.append(b);
    }
    note.hidden = false;
}

async function refreshFolderNote() {
    $('folder-note').hidden = true;
    const folder = selectedFolder();
    if (!folder) {
        showNote('保存先フォルダがまだありません。', 'フォルダを追加', openManageForAdd);
    } else if (!(await store.hasPermission(folder.handle))) {
        showNote('保存時にこのフォルダへの書き込み許可を確認します。');
    }
}

function renderFolders(defaultId) {
    const select = $('folder');
    select.replaceChildren(...state.folders.map(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        return opt;
    }));
    if (defaultId != null && state.folders.some(f => f.id === defaultId)) {
        select.value = defaultId;
    }
    select.disabled = !state.folders.length;
}

function updateControls() {
    const total = state.page?.items.length ?? 0;
    const n = state.checked.size;
    $('count').textContent = total ? `${n} / ${total} 件選択` : '';
    $('toggle-all').checked = total > 0 && n === total;
    $('toggle-all').indeterminate = n > 0 && n < total;
    $('toggle-all').disabled = !total || state.saving;
    $('save').disabled = state.saving || !n || !selectedFolder();
    $('save').textContent = n ? `保存 (${n})` : '保存';
    $('folder').disabled = state.saving || !state.folders.length;
    $('add-folder').disabled = state.saving;
    for (const li of $('items').children) {
        li.classList.toggle('checked', state.checked.has(li.dataset.key));
        li.querySelector('input').checked = state.checked.has(li.dataset.key);
        li.querySelector('input').disabled = state.saving;
    }
}

function renderItems() {
    const items = state.page.items;
    $('items').replaceChildren(...items.map(item => {
        const li = document.createElement('li');
        li.dataset.key = item.key;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `cb-${item.key}`;
        cb.addEventListener('change', () => {
            cb.checked ? state.checked.add(item.key) : state.checked.delete(item.key);
            updateControls();
        });

        const label = document.createElement('label');
        label.htmlFor = cb.id;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.name || `(名前不明) ${item.id}`;

        const meta = document.createElement('span');
        meta.className = 'meta';
        const kind = document.createElement('span');
        const isPdf = item.looksPdf || item.kind !== 'drive';
        kind.className = `badge ${isPdf ? 'pdf' : ''}`;
        kind.textContent = item.kind === 'drive' && item.looksPdf ? 'PDF' : KIND_LABEL[item.kind];
        meta.append(kind);

        const saved = state.history[item.key];
        if (saved) {
            li.classList.add('saved');
            const s = document.createElement('span');
            s.className = 'badge saved';
            s.textContent = `保存済み → ${saved.folderName}`;
            s.title = `${saved.name}（${new Date(saved.at).toLocaleString()}）`;
            meta.append(s);
        }

        const result = document.createElement('div');
        result.className = 'result';

        label.append(name, meta, result);
        li.append(cb, label);
        return li;
    }));

    const empty = $('empty');
    if (!items.length) {
        empty.textContent = state.page.isClassroom
            ? '資料が見つかりません。ページの読み込みが終わってから開き直すか、授業の「授業」タブや投稿の詳細ページで試してください。'
            : 'このページには Drive / Google ドキュメントの資料リンクがありません。';
        empty.hidden = false;
    }
    updateControls();
}

function setResult(key, text, ok) {
    const li = [...$('items').children].find(li => li.dataset.key === key);
    const el = li?.querySelector('.result');
    if (!el) return;
    el.textContent = text;
    el.className = `result ${ok === true ? 'ok' : ok === false ? 'error' : ''}`;
}

// ---- 鍵付き PDF ----

// パスワード入力欄を出して応答を待つ。
// 戻り値: { password, remember } | { keep: true }（鍵付きのまま保存） | { skip: true }
function askPassword(item, message) {
    $('password-file').textContent = item.name || item.id;
    $('password-message').textContent = message;
    $('password').value = '';
    $('remember-row').hidden = !state.page.courseId;
    $('password-panel').hidden = false;
    $('password-panel').scrollIntoView({ block: 'nearest' });
    $('password').focus();
    return new Promise(resolve => { state.answerPassword = resolve; });
}

function answerPassword(answer) {
    $('password-panel').hidden = true;
    state.answerPassword?.(answer);
    state.answerPassword = null;
}

// 候補を順に試し、鍵を外せたら { blob, password } を返す
async function tryPasswords(bytes, passwords) {
    for (const password of new Set(passwords)) {
        if (!password) continue;
        const blob = await unlockPdf(bytes, password);
        if (blob) return { blob, password };
    }
    return null;
}

// パスワードが必要な PDF なら鍵を外す。記憶したパスワード → この保存中に使ったパスワード →
// 入力欄の順に試す。戻り値: { blob: 保存する内容, note: 結果に添える文字列 }。スキップなら null
async function unlockIfNeeded(item, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!(await needsPassword(bytes))) return { blob, note: '' };

    const { courseId } = state.page;
    const saved = await store.getCoursePassword(courseId);
    const known = await tryPasswords(bytes, [saved, ...state.passwords]);
    if (known) return { blob: known.blob, note: '（鍵を解除）' };

    let message = saved ? '記憶したパスワードでは開けませんでした。' : '';
    for (;;) {
        setResult(item.key, 'パスワードを入力してください');
        const answer = await askPassword(item, message);
        if (answer.skip) return null;
        if (answer.keep) return { blob, note: '（鍵付きのまま）' };

        setResult(item.key, '鍵を解除中…');
        // コピー&ペーストで前後に空白が入りやすいので、そのままで駄目なら空白を除いて試す
        const found = await tryPasswords(bytes, [answer.password, answer.password.trim()]);
        if (!found) {
            message = 'パスワードが違います。';
            continue;
        }
        state.passwords = [found.password, ...state.passwords.filter(p => p !== found.password)];
        if (answer.remember) await store.setCoursePassword(courseId, found.password);
        return { blob: found.blob, note: '（鍵を解除）' };
    }
}

async function save() {
    const folder = selectedFolder();
    if (!folder) return;

    // requestPermission はクリック直後（ユーザー操作中）に呼ぶ必要がある
    if (!(await store.ensurePermission(folder.handle))) {
        showNote('フォルダへの書き込みが許可されませんでした。', '管理ページで許可', () => openManage());
        return;
    }
    $('folder-note').hidden = true;

    state.saving = true;
    updateControls();

    const { courseId, courseName } = state.page;
    await store.setCourseFolder(courseId, folder.id);
    await store.touchFolder(folder.id);

    const targets = state.page.items.filter(i => state.checked.has(i.key));
    let ok = 0, failed = 0, skipped = 0;

    for (const [i, item] of targets.entries()) {
        $('status').textContent = `保存中… ${i + 1} / ${targets.length}`;
        setResult(item.key, 'ダウンロード中…');
        try {
            const fetched = await fetchItem(item);
            const content = await unlockIfNeeded(item, fetched.blob);
            if (!content) {
                // チェックは残しておき、パスワードが分かったらもう一度保存できるようにする
                setResult(item.key, 'スキップしました');
                skipped++;
                continue;
            }
            const name = decideFilename(item, fetched);
            const prev = state.history[item.key];
            const overwrite = prev?.folderId === folder.id ? prev.name : null;
            const finalName = await writeFile(folder.handle, name, content.blob, overwrite);

            const entry = {
                key: item.key, name: finalName, folderId: folder.id, folderName: folder.name,
                courseId, courseName, at: Date.now(),
            };
            await store.addHistory(entry);
            state.history[item.key] = entry;
            state.checked.delete(item.key);
            setResult(item.key, `✓ ${finalName}${content.note}`, true);
            ok++;
        } catch (e) {
            console.error(item, e);
            setResult(item.key, `✗ ${e.message || e}`, false);
            failed++;
        }
        updateControls();
    }

    state.saving = false;
    $('status').textContent = failed || skipped
        ? [`${ok} 件保存`, skipped && `${skipped} 件スキップ`, failed && `${failed} 件失敗`].filter(Boolean).join('、')
        : `${ok} 件を「${folder.name}」に保存しました`;
    updateControls();
}

async function init() {
    $('open-manage').addEventListener('click', () => openManage());
    $('add-folder').addEventListener('click', openManageForAdd);
    $('save').addEventListener('click', save);
    $('folder').addEventListener('change', async () => {
        await store.setCourseFolder(state.page?.courseId, Number($('folder').value));
        await refreshFolderNote();
        updateControls();
    });
    $('toggle-all').addEventListener('change', (e) => {
        state.checked = e.target.checked ? new Set(state.page.items.map(i => i.key)) : new Set();
        updateControls();
    });
    $('password-form').addEventListener('submit', (e) => {
        e.preventDefault();
        answerPassword({ password: $('password').value, remember: $('remember').checked });
    });
    $('password-keep').addEventListener('click', () => answerPassword({ keep: true }));
    $('password-skip').addEventListener('click', () => answerPassword({ skip: true }));

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage });
        state.page = result;
    } catch (e) {
        console.error(e);
        $('course').textContent = 'このページでは使えません';
        $('empty').textContent = 'Google Classroom のページで開いてください。';
        $('empty').hidden = false;
        return;
    }

    const { courseId, courseName } = state.page;
    $('course').textContent = courseName || 'Classroom PDF Saver';
    await store.setCourseName(courseId, courseName);

    const [folders, history, courseFolders] = await Promise.all([
        store.listFolders(), store.getHistory(), store.getCourseFolders(),
    ]);
    state.folders = folders;
    state.history = history;

    // この授業で前回使ったフォルダ → なければ最近使ったフォルダ
    renderFolders(courseFolders[courseId] ?? folders[0]?.id);

    // 初期選択: PDF / Google ドキュメント類で、まだ保存していないもの
    for (const item of state.page.items) {
        if ((item.looksPdf || item.kind !== 'drive') && !history[item.key]) state.checked.add(item.key);
    }
    renderItems();
    await refreshFolderNote();
}

init();

import * as store from './lib/store.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function cell(content, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = content ?? '';
    return td;
}

function button(label, onClick, className) {
    const b = document.createElement('button');
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
}

function formatDate(ms) {
    return ms ? new Date(ms).toLocaleString() : '';
}

function showMessage(text) {
    $('message').textContent = text;
    $('message').hidden = false;
}

async function pickFolder() {
    let handle;
    try {
        // id を固定すると、ダイアログが前回選んだ場所から開く
        handle = await window.showDirectoryPicker({ id: 'classroom-pdf-saver', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
        if (e.name !== 'AbortError') alert(`フォルダを選べませんでした: ${e.message}`);
        return;
    }
    const folderId = await store.addFolder(handle);

    const course = params.get('course');
    const courseName = params.get('courseName');
    if (course) {
        await store.setCourseFolder(course, folderId);
        await store.setCourseName(course, courseName);
        showMessage(`「${handle.name}」を「${courseName || course}」の保存先にしました。ポップアップを開き直すと選ばれた状態になっています。`);
    } else {
        showMessage(`「${handle.name}」を追加しました。`);
    }
    $('add-banner').hidden = true;
    history.replaceState(null, '', location.pathname);
    params.delete('course');
    await render();
}

async function renderFolders() {
    const [folders, courseFolders, courseNames] = await Promise.all([
        store.listFolders(), store.getCourseFolders(), store.getCourseNames(),
    ]);

    const rows = await Promise.all(folders.map(async (f) => {
        const courses = Object.entries(courseFolders)
            .filter(([, id]) => id === f.id)
            .map(([course]) => courseNames[course] || course);

        const granted = await store.hasPermission(f.handle);
        const perm = granted
            ? Object.assign(document.createElement('span'), { className: 'granted', textContent: '許可済み' })
            : button('許可する', async () => {
                await store.ensurePermission(f.handle);
                await render();
            });

        const tr = document.createElement('tr');
        tr.append(
            cell(f.name, 'name'),
            cell(courses.join('、')),
            cell(formatDate(f.lastUsed)),
            cell(perm),
            cell(button('削除', async () => {
                if (!confirm(`「${f.name}」を保存先一覧から削除しますか？（フォルダ自体は消えません）`)) return;
                await store.removeFolder(f.id);
                await render();
            }, 'danger')),
        );
        return tr;
    }));

    $('folders').replaceChildren(...rows);
    $('no-folders').hidden = folders.length > 0;
}

async function renderHistory() {
    const entries = Object.values(await store.getHistory()).sort((a, b) => b.at - a.at);
    $('history').replaceChildren(...entries.map(h => {
        const tr = document.createElement('tr');
        tr.append(
            cell(h.name, 'name'),
            cell(h.courseName),
            cell(h.folderName),
            cell(formatDate(h.at)),
            cell(button('削除', async () => {
                await store.removeHistory(h.key);
                await render();
            }, 'danger')),
        );
        return tr;
    }));
    $('no-history').hidden = entries.length > 0;
    $('clear-history').disabled = !entries.length;
}

async function render() {
    await Promise.all([renderFolders(), renderHistory()]);
}

$('add-folder').addEventListener('click', pickFolder);
$('add-banner-button').addEventListener('click', pickFolder);
$('clear-history').addEventListener('click', async () => {
    if (!confirm('保存履歴をすべて消去しますか？')) return;
    await store.clearHistory();
    await render();
});

// ポップアップの「＋」から来た場合（フォルダ選択ダイアログはクリック操作が必要なのでボタンを出す）
if (params.get('add')) {
    const courseName = params.get('courseName');
    $('add-message').textContent = courseName
        ? `「${courseName}」の資料を保存するフォルダを選んでください。`
        : '資料を保存するフォルダを選んでください。';
    $('add-banner').hidden = false;
}

render();

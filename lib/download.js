// Drive / Google ドキュメントからファイルを取得し、選択フォルダへ書き込む
//
// 以前は chrome.downloads に URL を渡すだけだったため、Drive が返した
// 「ウイルススキャン確認ページ」や「ログインページ」の HTML がそのまま保存されていた。
// ここでは fetch で中身を受け取り、HTML なら原因に応じて対処してから保存する。

const DOC_EXPORT = {
    document: (id) => `https://docs.google.com/document/d/${id}/export?format=pdf`,
    spreadsheets: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`,
    presentation: (id) => `https://docs.google.com/presentation/d/${id}/export/pdf`,
    drawings: (id) => `https://docs.google.com/drawings/d/${id}/export/pdf`,
};

export const KIND_LABEL = {
    drive: 'ファイル',
    document: 'ドキュメント→PDF',
    spreadsheets: 'スプレッドシート→PDF',
    presentation: 'スライド→PDF',
    drawings: '図形→PDF',
};

const MAX_AUTHUSER = 5;
const TIMEOUT_MS = 5 * 60 * 1000;

class FetchError extends Error {
    // retryable: 別の authuser（Googleアカウント）で試す価値があるか
    constructor(message, retryable) {
        super(message);
        this.retryable = retryable;
    }
}

function buildUrl(item, authuser) {
    if (item.kind === 'drive') {
        // confirm=t で大きいファイルのウイルススキャン確認ページを事前に回避する
        return `https://drive.usercontent.google.com/u/${authuser}/uc?id=${item.id}&export=download&confirm=t`;
    }
    const url = new URL(DOC_EXPORT[item.kind](item.id));
    url.searchParams.set('authuser', authuser);
    return url.href;
}

// 試す authuser の順番: ページから分かったもの → 0, 1, 2, ...
function authCandidates(item) {
    const list = [item.authuser, ...Array.from({ length: MAX_AUTHUSER }, (_, i) => String(i))];
    return [...new Set(list.filter(a => a != null))];
}

function isHtml(res) {
    return /text\/html/i.test(res.headers.get('content-type') || '');
}

// Content-Disposition からファイル名を取り出す（filename* を優先）
function filenameFromDisposition(header) {
    if (!header) return null;
    let m = header.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
    if (m) {
        try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch { /* 下へ */ }
    }
    m = header.match(/filename\s*=\s*"((?:\\.|[^"])*)"/i) || header.match(/filename\s*=\s*([^;]+)/i);
    if (!m) return null;
    const raw = m[1].trim();
    // ヘッダーは Latin-1 として解釈されるので、UTF-8 のバイト列だった場合は復元する
    if ([...raw].every(c => c.charCodeAt(0) < 256)) {
        try {
            return new TextDecoder('utf-8', { fatal: true })
                .decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
        } catch { /* Latin-1 のまま */ }
    }
    return raw;
}

// ウイルススキャン確認ページからダウンロード用 URL を組み立てる
function findConfirmUrl(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form#download-form') ||
        [...doc.forms].find(f => /download|\/uc\b/.test(f.getAttribute('action') || ''));
    if (form) {
        const url = new URL(form.getAttribute('action'), baseUrl);
        for (const input of form.querySelectorAll('input[name]')) {
            url.searchParams.set(input.name, input.value);
        }
        return url.href;
    }
    const a = [...doc.querySelectorAll('a[href]')].find(a => /[?&]confirm=/.test(a.getAttribute('href')));
    return a ? new URL(a.getAttribute('href'), baseUrl).href : null;
}

function explainHtml(html, res) {
    if (/accounts\.google\.com/.test(res.url) || /ServiceLogin|signin\/v2|identifier/i.test(html)) {
        return new FetchError('ログインが必要（アカウント違いの可能性）', true);
    }
    if (/quota|割り当て|too many users|多くのユーザー/i.test(html)) {
        return new FetchError('Drive のダウンロード上限に達しています。時間をおいて再試行してください', false);
    }
    if (/access denied|アクセス権|request access|アクセスをリクエスト/i.test(html)) {
        return new FetchError('アクセス権がありません', true);
    }
    return new FetchError('ファイルではなく Web ページが返されました', true);
}

async function fetchOnce(url) {
    let res;
    try {
        res = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
        if (e.name === 'TimeoutError') throw new FetchError('タイムアウトしました', false);
        // ログイン画面（accounts.google.com）へのリダイレクトは CORS エラーとしてここに来る
        throw new FetchError('取得に失敗しました（ログインが必要な可能性）', true);
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new FetchError(`アクセスできません (HTTP ${res.status})`, true);
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status < 500);
    return res;
}

async function fetchWithAuth(item, authuser) {
    let res = await fetchOnce(buildUrl(item, authuser));

    if (isHtml(res)) {
        const html = await res.text();
        const confirmUrl = item.kind === 'drive' ? findConfirmUrl(html, res.url) : null;
        if (!confirmUrl) throw explainHtml(html, res);
        res = await fetchOnce(confirmUrl);
        if (isHtml(res)) throw explainHtml(await res.text(), res);
    }

    const blob = await res.blob();
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const headText = String.fromCharCode(...head);
    const expectPdf = item.kind !== 'drive';
    if (expectPdf && headText !== '%PDF-') {
        throw new FetchError('PDF ではないデータが返されました', true);
    }
    // Content-Type が HTML 以外でも中身が HTML のことがあるので念のため確認
    if (/^\s*<(!doc|htm)/i.test(await blob.slice(0, 64).text()) && !/\.html?$/i.test(item.name)) {
        throw explainHtml(await blob.text(), res);
    }

    return {
        blob,
        filename: filenameFromDisposition(res.headers.get('content-disposition')),
        authuser,
    };
}

// item: scanPage() の要素。成功時 { blob, filename, authuser } を返す
export async function fetchItem(item) {
    let lastError;
    for (const authuser of authCandidates(item)) {
        try {
            return await fetchWithAuth(item, authuser);
        } catch (e) {
            lastError = e;
            if (!(e instanceof FetchError) || !e.retryable) break;
        }
    }
    throw lastError;
}

export function sanitizeFilename(name, fallback = 'document') {
    let s = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    s = s.replace(/[. ]+$/, '');
    if (!s || s === '.' || s === '..') s = fallback;
    if (s.length > 200) {
        const ext = s.match(/\.[^.]{1,10}$/)?.[0] ?? '';
        s = s.slice(0, 200 - ext.length) + ext;
    }
    return s;
}

// 保存用のファイル名を決める。Docs 系は必ず .pdf にする
export function decideFilename(item, fetched) {
    let name = fetched.filename || item.name || item.id;
    if (item.kind !== 'drive' && !/\.pdf$/i.test(name)) name += '.pdf';
    return sanitizeFilename(name, item.id);
}

async function exists(dir, name) {
    try {
        await dir.getFileHandle(name);
        return true;
    } catch (e) {
        if (e.name === 'NotFoundError') return false;
        if (e.name === 'TypeMismatchError') return true; // 同名フォルダがある
        throw e;
    }
}

// 同名ファイルがあれば「名前 (1).pdf」のようにずらす。overwriteName と一致する場合は上書き
export async function writeFile(dir, name, blob, overwriteName = null) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';

    let finalName = name;
    for (let i = 1; finalName !== overwriteName && await exists(dir, finalName); i++) {
        finalName = `${base} (${i})${ext}`;
    }

    const handle = await dir.getFileHandle(finalName, { create: true });
    const writable = await handle.createWritable();
    try {
        await writable.write(blob);
        await writable.close();
    } catch (e) {
        await writable.abort().catch(() => {});
        throw e;
    }
    return finalName;
}

// タブ内に注入して実行する関数。chrome.scripting.executeScript で文字列化されて渡るため、
// 外側の変数や import は参照できない（関数内で完結させること）。
export function scanPage() {
    const TYPE_WORDS = /^(PDF|Google (ドキュメント|スライド|スプレッドシート|図形|Docs|Slides|Sheets|Drawings)|画像|動画|Word|Excel|PowerPoint|Image|Video)$/i;

    const parseLink = (href) => {
        let m;
        if ((m = href.match(/drive\.google\.com\/file\/d\/([\w-]+)/)) ||
            (m = href.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/))) {
            return { kind: 'drive', id: m[1] };
        }
        if ((m = href.match(/docs\.google\.com\/(?:[^/]+\/)*(document|presentation|spreadsheets|drawings)\/d\/([\w-]+)/))) {
            return { kind: m[1], id: m[2] };
        }
        return null;
    };

    // Classroom の添付リンクは「サムネイル」「ファイル名」「種類(PDF など)」が混在するので、
    // 候補を集めて種類表記を除いた一番それらしいものを名前にする
    const guessName = (a) => {
        const candidates = [
            a.getAttribute('title'),
            ...(a.innerText || '').split('\n'),
            (a.getAttribute('aria-label') || '').replace(/^[^:：]*[:：]\s*/, ''),
        ].map(s => (s || '').trim()).filter(s => s && !TYPE_WORDS.test(s));
        return candidates.sort((x, y) => y.length - x.length)[0] || '';
    };

    const pageAuth = location.pathname.match(/\/u\/(\d+)(\/|$)/)?.[1];
    const items = new Map();

    for (const a of document.querySelectorAll('a[href]')) {
        const link = parseLink(a.href);
        if (!link) continue;
        const key = `${link.kind}:${link.id}`;
        const label = `${a.innerText || ''} ${a.getAttribute('aria-label') || ''} ${a.title || ''}`;
        const name = guessName(a);
        const linkAuth = a.href.match(/[?&]authuser=(\d+)/)?.[1];

        const item = items.get(key) ?? { key, ...link, name: '', looksPdf: false, authuser: null };
        if (name.length > item.name.length) item.name = name;
        if (/\bPDF\b|\.pdf\b/i.test(label) || /\.pdf$/i.test(name)) item.looksPdf = true;
        item.authuser ??= pageAuth ?? linkAuth ?? null;
        items.set(key, item);
    }

    const courseId = location.pathname.match(/\/(?:c|w|r)\/([\w-]+)/)?.[1] ?? null;
    const courseName = document.title.replace(/\s*[-–|]\s*Google Classroom\s*$/i, '').trim();

    return {
        url: location.href,
        isClassroom: location.hostname === 'classroom.google.com',
        courseId,
        courseName,
        pageAuth: pageAuth ?? null,
        items: [...items.values()],
    };
}

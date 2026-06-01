// ページ内のPDFリンクを収集して返す
function collectPdfLinks() {
    const links = [];

    // Classroomの資料リンク（Drive埋め込みやPDF直リンク）を探す
    document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        if (
            href.includes('.pdf') ||
            href.includes('drive.google.com/file') ||
            href.includes('drive.google.com/open')
        ) {
            links.push({ url: href, text: a.textContent.trim() || 'document' });
        }
    });

    return links;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'getPdfLinks') {
        sendResponse(collectPdfLinks());
    }
});
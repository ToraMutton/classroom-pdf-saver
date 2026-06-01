chrome.action.onClicked.addListener(async (tab) => {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const seen = new Set();
                const links = [];
                document.querySelectorAll('a[href]').forEach(a => {
                    const fileMatch = a.href.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
                    if (!fileMatch) return;
                    const fileId = fileMatch[1];
                    if (seen.has(fileId)) return;
                    seen.add(fileId);
                    const authMatch = a.href.match(/authuser=(\d+)/);
                    links.push({ fileId, authuser: authMatch?.[1] ?? '0' });
                });
                return links;
            }
        });

        const links = results?.[0]?.result ?? [];
        if (!links.length) { console.warn("リンクなし"); return; }

        for (const { fileId, authuser } of links) {
            const url = `https://drive.usercontent.google.com/u/${authuser}/uc?id=${fileId}&export=download`;
            chrome.downloads.download({ url, saveAs: false, conflictAction: 'uniquify' });
        }
    } catch (e) { console.error(e); }
});
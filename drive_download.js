// Drive のビューアページが開いたら自動でダウンロードボタンを押す
(async () => {
    // ボタンが描画されるまで少し待つ
    const waitForButton = (selector, timeout = 8000) => {
        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) { clearInterval(interval); resolve(el); }
            }, 300);
            setTimeout(() => { clearInterval(interval); reject("timeout"); }, timeout);
        });
    };

    try {
        // Driveビューアの「ダウンロード」ボタン（aria-label で探す）
        const btn = await waitForButton('[aria-label="ダウンロード"]');
        btn.click();
        console.log("ダウンロードボタンをクリックしました");

        // ダウンロード開始後にタブを閉じる
        setTimeout(() => window.close(), 8000);
    } catch (e) {
        console.warn("ダウンロードボタンが見つかりませんでした", e);
        // 見つからない場合はタブをそのまま残す（手動で対応）
    }
})();
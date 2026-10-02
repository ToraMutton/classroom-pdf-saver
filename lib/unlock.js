// 鍵付き（パスワード付き）PDF の判定と解除
//
// 解除には qpdf の WebAssembly 版（vendor/qpdf）を使い、処理はすべてブラウザ内で完結する。
// wasm の実行には manifest の CSP に 'wasm-unsafe-eval' が必要。
// qpdf.js は ES モジュールではないので、鍵付きらしい PDF に出会ったときだけ <script> で読み込む。

const QPDF_JS = 'vendor/qpdf/qpdf.js';
const QPDF_WASM = 'vendor/qpdf/qpdf.wasm';

// qpdf の終了コード: 0 = 成功, 2 = エラー, 3 = 警告あり（出力はできている）
const EXIT_OK = 0;
const EXIT_WARNING = 3;

let qpdfLoading = null;

function loadQpdf() {
    qpdfLoading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = QPDF_JS;
        script.onload = () => resolve(globalThis.Module);
        script.onerror = () => {
            qpdfLoading = null;
            reject(new Error('PDF の鍵を外すための qpdf を読み込めませんでした'));
        };
        document.head.append(script);
    });
    return qpdfLoading;
}

// qpdf をコマンドラインと同じ引数で実行する（入力 /in.pdf → 出力 /out.pdf）。
// 前回の実行の状態を持ち越さないよう、毎回新しいインスタンスを作る
async function runQpdf(args, input) {
    const createModule = await loadQpdf();
    const qpdf = await createModule({ locateFile: () => chrome.runtime.getURL(QPDF_WASM) });
    qpdf.FS.writeFile('/in.pdf', input);
    const code = qpdf.callMain([...args, '/in.pdf', '/out.pdf']);
    if (code !== EXIT_OK && code !== EXIT_WARNING) return null;
    return qpdf.FS.readFile('/out.pdf');
}

// 暗号化された PDF はトレーラー（または XRef ストリームの辞書）に必ず平文の /Encrypt を持つ。
// 大半の PDF はこれで除外でき、qpdf を読み込まずに済む
function mayBeEncrypted(bytes) {
    const text = new TextDecoder('latin1').decode(bytes);
    return text.slice(0, 1024).includes('%PDF-') && text.includes('/Encrypt');
}

// パスワードを入力しないと開けない PDF か。
// 印刷・コピー制限だけで誰でも開ける PDF は false（そのまま保存する）
export async function needsPassword(bytes) {
    if (!mayBeEncrypted(bytes)) return false;
    // このビルドの qpdf は --requires-password の結果が「暗号化なし」と区別できないため、
    // 空パスワードで解除できるかどうかで判断する。
    // （qpdf が読めないほど壊れた PDF も true になるが、その場合は「鍵付きのまま保存」を選べる）
    return !(await runQpdf(['--decrypt'], bytes));
}

// パスワードで鍵を外した PDF を返す。パスワードが違えば null
export async function unlockPdf(bytes, password) {
    const output = await runQpdf([`--password=${password}`, '--decrypt'], bytes);
    return output && new Blob([output], { type: 'application/pdf' });
}

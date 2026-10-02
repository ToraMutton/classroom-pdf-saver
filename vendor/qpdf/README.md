# qpdf (WebAssembly)

鍵付き（パスワード付き）PDF の解除に使っている [qpdf](https://github.com/qpdf/qpdf) の WebAssembly 版です。
Chrome 拡張機能（Manifest V3）は外部からコードを読み込めないため、ここに同梱しています。
処理はすべてブラウザ内で行われ、PDF やパスワードが外部に送られることはありません。

| ファイル | 内容 |
| --- | --- |
| `qpdf.js` | Emscripten のローダー（無改変） |
| `qpdf.wasm` | qpdf 12.2.0 本体（無改変） |
| `LICENSE-qpdf.txt` | qpdf のライセンス（Apache License 2.0） |

## 入手元

npm パッケージ [`@neslinesli93/qpdf-wasm@0.3.0`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)
（<https://github.com/neslinesli93/qpdf-wasm>、ISC License）の `dist/` から取り出したものです。

```
c0e8fe62e0c3385dd8cb5d6b613f74d87a4138a3a3343e2add45a067a14d0884  qpdf.js
abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876  qpdf.wasm
```

更新するときは同じパッケージの新しいバージョンから 2 つのファイルを差し替え、上のハッシュも書き換えてください。

## ライセンス

- **qpdf** — Copyright (c) 2005-2021 Jay Berkenbilt, Copyright (c) 2022-2025 Jay Berkenbilt and Manfred Holger.
  Apache License 2.0（`LICENSE-qpdf.txt`）。
- **libjpeg-turbo 2.1.1**（qpdf.wasm に静的リンク）— This software is based in part on the work of the
  Independent JPEG Group. IJG License / Modified BSD License（<https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md>）。
- **zlib**（qpdf.wasm に静的リンク）— Copyright (C) Jean-loup Gailly and Mark Adler. zlib License（<https://zlib.net/zlib_license.html>）。

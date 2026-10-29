# Layout Toggle for Twitter

Twitter（x.com）の次の部分を、1 つずつ表示・非表示にできる Firefox 拡張。

- 左メニューの項目
- 「もっと見る」の中の項目
- 右サイドバーのブロック（検索ボックス、トレンド、おすすめユーザーなど）

レイアウトの設定もある。

- 左メニューの項目を隠すと、隠した数だけ「もっと見る」の中の項目を左メニューへ移せる。
- 右サイドバーのブロックをすべて隠すと、空いた場所までタイムラインを広げられる。

項目は画面の文字ではなく `data-testid` とリンク先で見分けるので、表示の言語に関係なく動く。

X Corp. とは関係のない個人の拡張。

## 入れ方

addons.mozilla.org から入れる（審査のあと）。デスクトップ版の Firefox 140 以上が必要。

## 設定

`about:addons` → Layout Toggle for Twitter → 設定。変えた設定は、開いている x.com のタブにすぐ反映される。

## プライバシー

データは集めないし、送らない。設定はブラウザの中にだけ保存する。詳しくは [PRIVACY.md](PRIVACY.md)。

## 開発

TypeScript で書いている。`npm run build` が型を確かめてから esbuild で束ね（圧縮しない）、`dist/` に拡張の完成品を作る。Node.js 24 以上が必要。

```sh
npm install
npm run build     # 型を確かめてから dist/ を作る
npm test          # 判定と移動の計算のテスト
npm run lint      # ビルドしてから dist/ を web-ext lint で検査
npm run package   # ビルドしてから web-ext-artifacts/ に .zip を作る
```

試すときは `about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む…」で `dist/manifest.json` を選ぶ。ビルドし直したら、同じ画面で「再読み込み」を押す。

## ライセンス

MIT

# Layout Toggle for Twitter

A Firefox add-on that lets you show or hide, one by one:

- each item in the Twitter (x.com) left menu,
- each item inside the "More" menu,
- each block in the right sidebar (search, trends, who to follow, and so on).

Optional layout tweaks:

- When you hide left menu items, the same number of items from "More" can move into the left menu (only the menu items the add-on knows from the start count; the Post button, the account switcher and "More" itself do not).
- When every right sidebar block is hidden, the timeline can widen into the freed space.

Items the add-on knows from the start are detected by `data-testid` and link targets, not by on-screen text, so they work in any display language. Right sidebar blocks it does not know are told apart by their heading text, so they depend on the display language.

This is an independent add-on. It is not affiliated with, endorsed by, or sponsored by X Corp.

日本語の説明は [README.ja.md](README.ja.md)。

## Install

From [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/layout-toggle-for-twitter/). Requires Firefox 140 or later on desktop.

## Settings

Open `about:addons` → Layout Toggle for Twitter → Preferences. Changes apply to open x.com tabs immediately.

## Privacy

No data is collected or transmitted. Settings and the items it found on x.com stay in your browser. See [PRIVACY.md](PRIVACY.md).

## Development

Written in TypeScript. `npm run build` type-checks the sources and bundles them with esbuild (not minified) into `dist/`, which is the complete add-on. Requires Node.js 24 or later.

```sh
npm install
npm run build     # type-check, then build dist/
npm test          # unit tests (detection rules and calculations, without the DOM)
npm run lint      # build, then web-ext lint on dist/
npm run package   # build, then make the .zip in web-ext-artifacts/
```

To try it, open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on…" and pick `dist/manifest.json`. After a rebuild, press "Reload" there.

## License

MIT

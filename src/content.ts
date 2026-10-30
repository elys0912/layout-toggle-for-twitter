// x.com のページで項目に印（data-xlt 属性）を付け、設定に合わせて隠す。content script の入口。
// 隠すのは差し込んだ <style> の CSS だけで、X の要素は消さない。判定が外れたときは何も隠れない。
// 「もっと見る」から移す項目は、左メニューの既存の項目を複製して作る（content/clone.ts）。
//
// 役割の分け方：
//   content/state.ts      storage.local の写しと、隠すかどうかの判定
//   content/seen-store.ts 見つけた項目と動いた時刻の記録・まとめての保存
//   content/mark.ts       左メニュー・「もっと見る」・右サイドバーへの印付け
//   content/promote.ts    「もっと見る」から左メニューへ移す
//   content/clone.ts      移す項目の複製

import {
  BUILTIN_ITEMS,
  HEADER_SELECTOR,
  HIDE_DECLARATION,
  NAV_SELECTOR,
  PRIMARY_COLUMN_SELECTOR,
  SIDEBAR_COLUMN_SELECTOR,
  applyStorageChanges,
  buildHiddenCss,
  isKeyInSection,
  resolveLayout,
  shouldWiden,
  toStoredState,
} from './registry.ts';
import { markMoreMenu, markNav, markSidebar } from './content/mark.ts';
import { applyPromotions, markPromotedInMenu } from './content/promote.ts';
import { readSeen, recordRun } from './content/seen-store.ts';
import { getStored, isHidden, replaceStored } from './content/state.ts';

// 投稿を並べる入れ物（primaryColumn の 2 段下）にも 600px の上限がある（2026-10-30 に確認）。
// 返信・いいねのボタンの行の上限は、ボタンが端まで散らばらないよう残す
const WIDEN_CSS = [
  `${SIDEBAR_COLUMN_SELECTOR}{${HIDE_DECLARATION}}`,
  `${PRIMARY_COLUMN_SELECTOR}{max-width:none!important}`,
  `${PRIMARY_COLUMN_SELECTOR} > div > div{max-width:none!important}`,
].join('\n');

const styleElement = document.createElement('style');
styleElement.dataset.xltStyle = '';
document.documentElement.append(styleElement);

let isLoaded = false;
let isScanScheduled = false;

/**
 * 隠す CSS と、タイムラインを広げる CSS を差し込む。
 * 「もっと見る」のメニューは開いたときにだけ現れ、presentKeys に入らない。
 * 印の付いた要素がいつ現れても隠れるよう、ページにある項目に限らず、知っている key をすべて含める
 */
function updateCss(presentKeys: readonly string[]): void {
  const keys = new Set([
    ...BUILTIN_ITEMS.map((item) => item.key),
    ...Object.keys(readSeen()),
    ...presentKeys,
  ]);
  const presentSideKeys = presentKeys.filter((key) => isKeyInSection(key, 'side'));
  const isWidened = shouldWiden({ layout: resolveLayout(getStored()), presentSideKeys, isHidden });
  const css = [
    buildHiddenCss([...keys].filter(isHidden)),
    `[data-xlt-promoted]{${HIDE_DECLARATION}}`,
    isWidened ? WIDEN_CSS : '',
  ].join('\n');

  if (styleElement.textContent !== css) styleElement.textContent = css;
}

function scan(): void {
  const header = document.querySelector(HEADER_SELECTOR);
  const nav = header?.querySelector(NAV_SELECTOR) ?? null;

  const presentNavKeys = header ? markNav(header, nav) : [];
  markMoreMenu();
  const presentSideKeys = markSidebar();

  const promotedKeys = nav ? applyPromotions(nav, presentNavKeys) : [];
  markPromotedInMenu(promotedKeys);

  updateCss([...presentNavKeys, ...presentSideKeys]);
}

/** X の描き直しは 1 フレームに何度も起きるので、判定は 1 フレームに 1 回にまとめる */
function scheduleScan(): void {
  if (!isLoaded || isScanScheduled) return;

  isScanScheduled = true;
  requestAnimationFrame(() => {
    isScanScheduled = false;
    scan();
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  replaceStored(applyStorageChanges(getStored(), changes));
  scheduleScan();
});

browser.storage.local.get(null).then((items) => {
  replaceStored(toStoredState(items));
  isLoaded = true;
  recordRun();
  scheduleScan();
}).catch((error: unknown) => {
  console.error('Layout Toggle for Twitter: 設定を読めなかった', error);
});

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });

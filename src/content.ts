// x.com のページで項目に印（data-xlt 属性）を付け、設定に合わせて隠す。
// 隠すのは差し込んだ <style> の CSS だけで、X の要素は消さない。判定が外れたときは何も隠れない。
// 「もっと見る」から移す項目は、左メニューの既存の項目を複製して作る。

import {
  MORE_ITEMS,
  NAV_ITEMS,
  SIDE_BLOCKS,
  applyStorageChanges,
  buildHiddenCss,
  buildUnknownLinkKey,
  classifySideBlock,
  computePromotions,
  identifyLink,
  isBuiltinKey,
  mergeHeadingBlocks,
  resolveHidden,
  resolveLayout,
  shouldWiden,
} from './registry.ts';
import type { MoreItem, SeenEntry, StoredState } from './registry.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MORE_BUTTON_SELECTOR = '[data-testid="AppTabBar_More_Menu"]';
// 「もっと見る」のメニューだけを選ぶ。投稿の「…」など、他のメニューも #layers に出る
const MORE_MENU_SELECTOR = '#layers [role="menu"]:has(a[data-testid="settings"])';
// 投稿を並べる入れ物（primaryColumn の 2 段下）にも 600px の上限がある（2026-10-30 に確認）。
// 返信・いいねのボタンの行の上限は、ボタンが端まで散らばらないよう残す
const WIDEN_CSS = [
  '[data-testid="sidebarColumn"]{display:none!important}',
  '[data-testid="primaryColumn"]{max-width:none!important}',
  '[data-testid="primaryColumn"] > div > div{max-width:none!important}',
].join('\n');
// 見つけた項目をまとめて保存するまでの待ち時間。X の描き直しのたびに書き込まないため
const SAVE_DELAY_MS = 1000;

const styleElement = document.createElement('style');
styleElement.dataset.xltStyle = '';
document.documentElement.append(styleElement);

let stored: StoredState = {};
let isLoaded = false;
let isScanScheduled = false;
let pendingSeen: Record<string, SeenEntry> = {};
// status に書く値。ranAt は設定画面が「x.com で動いたか」を判断するのに使う
let pendingStatus: NonNullable<StoredState['status']> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isHidden(key: string): boolean {
  return resolveHidden(stored, key);
}

function readSeen(): Record<string, SeenEntry> {
  return { ...stored.seen, ...pendingSeen };
}

// --- 見つけた項目の記録 ---

function recordSeen(key: string, entry: SeenEntry): void {
  const known = readSeen()[key];
  const isNew = !known && !isBuiltinKey(key);
  const merged: SeenEntry = { ...known, ...entry, ...(isNew ? { new: true } : {}) };
  if (known && JSON.stringify(known) === JSON.stringify(merged)) return;

  pendingSeen[key] = merged;
  scheduleSave();
}

function scheduleSave(): void {
  if (saveTimer !== null) return;

  saveTimer = setTimeout(async () => {
    saveTimer = null;
    // 書くのはこの拡張だけなので、読んだ値は StoredState の形をしている
    const { seen = {}, status = {} } = (await browser.storage.local.get(['seen', 'status'])) as StoredState;
    const changes: StoredState = {
      seen: { ...seen, ...pendingSeen },
      status: { ...status, ...pendingStatus },
    };

    pendingSeen = {};
    pendingStatus = {};
    await browser.storage.local.set({ ...changes });
  }, SAVE_DELAY_MS);
}

// --- 印付け ---

function setMark(element: HTMLElement, key: string): void {
  if (element.dataset.xlt !== key) element.dataset.xlt = key;
}

function readLink(element: Element): { testid: string | null; href: string | null } {
  return { testid: element.getAttribute('data-testid'), href: element.getAttribute('href') };
}

function readLabel(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

/** 左メニューと、その下のボタン 2 つに印を付け、見つけた key を返す */
function markNav(header: Element, nav: Element | null): string[] {
  const elements = [
    ...(nav ? nav.children : []),
    header.querySelector('[data-testid="SideNav_NewTweet_Button"]'),
    header.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
  ].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute('data-xlt-clone'));
  const keys: string[] = [];

  for (const element of elements) {
    const link = readLink(element);
    let key = identifyLink(link, NAV_ITEMS);
    if (!key && link.href) {
      key = buildUnknownLinkKey('nav', link.href);
      recordSeen(key, { label: readLabel(element) });
    }
    if (!key) continue;

    setMark(element, key);
    keys.push(key);
  }

  return keys;
}

/** 開いている「もっと見る」のメニューに印を付け、項目の中身を記録する */
function markMoreMenu(): void {
  const menu = document.querySelector(MORE_MENU_SELECTOR);
  if (!menu) return;

  const links = [...menu.querySelectorAll<HTMLAnchorElement>('a[href]')];
  links.forEach((element, order) => {
    const link = readLink(element);
    const href = link.href ?? '';
    const key = identifyLink(link, MORE_ITEMS) ?? buildUnknownLinkKey('more', href);
    const iconPaths = [...element.querySelectorAll('svg path')]
      .map((path) => path.getAttribute('d'))
      .filter((d): d is string => Boolean(d));

    setMark(element, key);
    recordSeen(key, { label: (element.textContent ?? '').trim(), href, iconPaths, order });
  });
}

function countDescendants(element: Element): number {
  return element.getElementsByTagName('*').length;
}

/**
 * 右サイドバーのブロックが並ぶ親を探す。
 * sidebarColumn の下は子が 1〜2 個の入れ物が続くので、中身の多い子へ降りていき、子を 3 つ以上持つ最初の要素を親とみなす
 */
function locateBlockContainer(column: Element): Element | null {
  let current: Element | undefined = column;

  for (let depth = 0; current && depth < 12; depth++) {
    if (current.children.length >= 3) return current;

    current = [...current.children].reduce<Element | undefined>(
      (largest, child) => (!largest || countDescendants(child) > countDescendants(largest) ? child : largest),
      undefined,
    );
  }

  return null;
}

/** 右サイドバーのブロックに印を付け、見つけた key を返す */
function markSidebar(): string[] {
  const column = document.querySelector('[data-testid="sidebarColumn"]');
  const container = column ? locateBlockContainer(column) : null;
  if (!container) return [];

  const blocks = [...container.children].filter((block): block is HTMLElement => block instanceof HTMLElement);
  const blockKeys = mergeHeadingBlocks(blocks.map(classifySideBlock));
  const keys: string[] = [];

  blocks.forEach((block, index) => {
    const key = blockKeys[index];
    if (!key) return;

    setMark(block, key);
    keys.push(key);
    if (key.startsWith('side.h:')) recordSeen(key, { label: key.slice('side.h:'.length) });
  });

  return keys;
}

// --- 「もっと見る」から左メニューへ移す ---

function listMoreItems(): MoreItem[] {
  return Object.entries(readSeen()).flatMap(([key, entry]) => {
    if (!key.startsWith('more.') || !entry.href) return [];

    return [{ key, href: entry.href, order: entry.order ?? 0, label: entry.label, iconPaths: entry.iconPaths }];
  });
}

/** 複製の元にする左メニューの項目。中身の作りが素直な「話題を検索」を優先する */
function pickTemplate(nav: Element): HTMLElement | null {
  return nav.querySelector<HTMLElement>(':scope > [data-testid="AppTabBar_Explore_Link"]')
    ?? nav.querySelector<HTMLElement>(':scope > a[data-testid^="AppTabBar_"]');
}

function replaceIcon(clone: Element, iconPaths: readonly string[]): void {
  const svg = clone.querySelector('svg');
  if (!svg) return;

  const group = document.createElementNS(SVG_NS, 'g');
  for (const d of iconPaths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    group.append(path);
  }
  svg.replaceChildren(group);
}

/** 名前を差し替える。幅が狭いと X は名前の部分を描かないので、そのときは何もしない */
function replaceLabel(clone: Element, label: string): void {
  const textBox = clone.querySelector('div[dir]');
  if (!textBox) return;

  const [firstSpan, ...restSpans] = textBox.querySelectorAll('span');
  if (!firstSpan) {
    textBox.textContent = label;
    return;
  }

  firstSpan.textContent = label;
  restSpans.forEach((span) => span.remove());
}

/** 内部のリンクは X のページ切り替えに乗せる。修飾キー付き・中ボタン・外部のリンクはブラウザに任せる */
function followClone(event: MouseEvent, href: string): void {
  const isPlainClick = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  if (!isPlainClick || !href.startsWith('/')) return;

  event.preventDefault();
  history.pushState(null, '', href);
  // X のルーターは popstate で URL を読み直す（2026-10-29 に、読み込み直さずに切り替わり「戻る」も効くことを確認）
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

function buildClone(template: HTMLElement, item: MoreItem): HTMLElement {
  // cloneNode は Node を返すので、元と同じ型に戻す
  const clone = template.cloneNode(true) as HTMLElement;
  const label = item.label ?? '';

  for (const name of ['data-testid', 'data-xlt', 'aria-current', 'aria-selected']) {
    clone.removeAttribute(name);
  }
  clone.dataset.xltClone = item.key;
  clone.dataset.xltCloneSignature = buildCloneSignature(item);
  clone.setAttribute('href', item.href);
  clone.setAttribute('aria-label', label);
  replaceIcon(clone, item.iconPaths ?? []);
  replaceLabel(clone, label);
  clone.addEventListener('click', (event) => followClone(event, item.href));

  return clone;
}

/** 複製の中身を表す文字列。表示の言語を変えると名前が変わるので、key だけでなく名前・リンク先・アイコンも含める */
function buildCloneSignature(item: MoreItem): string {
  return JSON.stringify([item.key, item.label ?? '', item.href, item.iconPaths ?? []]);
}

/** 複製を、移す項目の並びと中身に合わせる。どちらも変わっていなければ触らない */
function syncClones(nav: Element, promotions: readonly MoreItem[]): void {
  const existing = [...nav.querySelectorAll<HTMLElement>(':scope > [data-xlt-clone]')];
  const existingSignatures = existing.map((element) => element.dataset.xltCloneSignature).join('\n');
  const wantedSignatures = promotions.map(buildCloneSignature).join('\n');
  if (existingSignatures === wantedSignatures) return;

  existing.forEach((element) => element.remove());
  const template = pickTemplate(nav);
  if (!template) return;

  const moreButton = nav.querySelector(`:scope > ${MORE_BUTTON_SELECTOR}`);
  for (const item of promotions) {
    nav.insertBefore(buildClone(template, item), moreButton);
  }
}

function applyPromotions(nav: Element, presentNavKeys: readonly string[]): string[] {
  const navHrefs = new Set(
    [...nav.querySelectorAll(':scope > a[href]:not([data-xlt-clone])')]
      .map((element) => element.getAttribute('href'))
      .filter((href): href is string => href !== null),
  );
  const promotions = resolveLayout(stored).promote
    ? computePromotions({ presentNavKeys, moreItems: listMoreItems(), navHrefs, isHidden })
    : [];

  syncClones(nav, promotions);

  return promotions.map((item) => item.key);
}

/** 移した項目の、メニューの中の元の項目に印を付ける */
function markPromotedInMenu(promotedKeys: readonly string[]): void {
  for (const element of document.querySelectorAll<HTMLElement>('#layers [data-xlt^="more."]')) {
    const isPromoted = promotedKeys.includes(element.dataset.xlt ?? '');
    element.toggleAttribute('data-xlt-promoted', isPromoted);
  }
}

// --- CSS ---

function updateCss(presentKeys: readonly string[]): void {
  const keys = new Set([
    ...[...NAV_ITEMS, ...MORE_ITEMS, ...SIDE_BLOCKS].map((item) => item.key),
    ...Object.keys(readSeen()),
    ...presentKeys,
  ]);
  const presentSideKeys = presentKeys.filter((key) => key.startsWith('side.'));
  const widen = shouldWiden({ layout: resolveLayout(stored), presentSideKeys, isHidden });
  const css = [
    buildHiddenCss([...keys].filter(isHidden)),
    '[data-xlt-promoted]{display:none!important}',
    widen ? WIDEN_CSS : '',
  ].join('\n');

  if (styleElement.textContent !== css) styleElement.textContent = css;
}

// --- 全体の流れ ---

function scan(): void {
  const header = document.querySelector('header[role="banner"]');
  const nav = header?.querySelector('nav[role="navigation"]') ?? null;

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

  stored = applyStorageChanges(stored, changes);
  scheduleScan();
});

browser.storage.local.get(null).then((items) => {
  stored = items as StoredState;
  isLoaded = true;
  // permissions.contains は、x.com で動いているのに false を返した（2026-10-29）。
  // そのため、x.com で実際に動いた時刻を設定画面に渡す
  pendingStatus.ranAt = Date.now();
  scheduleSave();
  scheduleScan();
});

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });

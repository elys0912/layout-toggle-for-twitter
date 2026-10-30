// x.com の左メニュー・「もっと見る」・右サイドバーの要素に印（data-xlt 属性）を付け、
// 表に無い項目を seen に記録する。隠すのは印を使う CSS で、ここでは要素を書き換えない。

import {
  BELOW_NAV_BUTTON_SELECTORS,
  MORE_ITEMS,
  MORE_MENU_SELECTOR,
  NAV_ITEMS,
  SIDEBAR_COLUMN_SELECTOR,
  buildUnknownLinkKey,
  classifySideBlock,
  identifyLink,
  isBuiltinKey,
  mergeHeadingBlocks,
  readHeadingTitle,
} from '../registry.ts';
import type { LinkAttributes, LinkRule, SectionPrefix } from '../registry.ts';
import { recordSeen } from './seen-store.ts';

function setMark(element: HTMLElement, key: string): void {
  if (element.dataset.xlt !== key) element.dataset.xlt = key;
}

function readLink(element: Element): LinkAttributes {
  return { testid: element.getAttribute('data-testid'), href: element.getAttribute('href') };
}

function readLabel(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

/** 表で見分けた key を返す。表に無ければ href から key を作る。href も無ければ null */
function resolveLinkKey(
  link: LinkAttributes,
  rules: readonly LinkRule[],
  section: Exclude<SectionPrefix, 'side'>,
): string | null {
  const knownKey = identifyLink(link, rules);
  if (knownKey) return knownKey;

  return link.href ? buildUnknownLinkKey(section, link.href) : null;
}

/** 左メニューと、その下のボタン 2 つに印を付け、見つけた key を返す。表に無い項目は名前を記録する */
export function markNav(header: Element, nav: Element | null): string[] {
  const elements = [
    ...(nav ? nav.children : []),
    ...BELOW_NAV_BUTTON_SELECTORS.map((selector) => header.querySelector(selector)),
  ].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.hasAttribute('data-xlt-clone'));
  const keys: string[] = [];

  for (const element of elements) {
    const key = resolveLinkKey(readLink(element), NAV_ITEMS, 'nav');
    if (!key) continue;

    setMark(element, key);
    keys.push(key);
    if (!isBuiltinKey(key)) recordSeen(key, { label: readLabel(element) });
  }

  return keys;
}

/** 開いている「もっと見る」のメニューに印を付け、項目の中身を記録する。移すときの複製に使う */
export function markMoreMenu(): void {
  const menu = document.querySelector(MORE_MENU_SELECTOR);
  if (!menu) return;

  const links = [...menu.querySelectorAll<HTMLAnchorElement>('a[href]')];
  links.forEach((element, order) => {
    const link = readLink(element);
    const key = resolveLinkKey(link, MORE_ITEMS, 'more');
    if (!key) return;

    const iconPaths = [...element.querySelectorAll('svg path')]
      .map((path) => path.getAttribute('d'))
      .filter((d): d is string => Boolean(d));

    setMark(element, key);
    recordSeen(key, { label: (element.textContent ?? '').trim(), href: link.href ?? '', iconPaths, order });
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

/** 右サイドバーのブロックに印を付け、見つけた key を返す。表に無いブロックは見出しを記録する */
export function markSidebar(): string[] {
  const column = document.querySelector(SIDEBAR_COLUMN_SELECTOR);
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
    const title = readHeadingTitle(key);
    if (title !== null) recordSeen(key, { label: title });
  });

  return keys;
}

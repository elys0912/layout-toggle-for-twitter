// 設定画面。storage.local の hidden・layout を書き、content script が記録した seen（見つけた項目）と
// status.ranAt（x.com で動いた時刻）を読んで画面を作る。
// 保存は切り替えた時点で行う。開いている x.com のタブは storage.onChanged で反映する。

import {
  MORE_ITEMS,
  NAV_ITEMS,
  SIDE_BLOCKS,
  applyStorageChanges,
  buildMessageName,
  isBuiltinKey,
  resolveHidden,
  resolveLayout,
} from './registry.ts';
import type { Layout, LinkRule, SideBlockRule, StoredState } from './registry.ts';

interface SectionDefinition {
  prefix: 'nav' | 'more' | 'side';
  titleMessage: string;
  builtinItems: readonly (LinkRule | SideBlockRule)[];
}

// 右サイドバーは x.com の画面の上から順に並べる。SIDE_BLOCKS は判定の優先順なので、画面の並びとは違う
const SIDE_DISPLAY_ORDER: readonly string[] = [
  'side.search',
  'side.filters',
  'side.premium',
  'side.live',
  'side.news',
  'side.scores',
  'side.trends',
  'side.follow',
  'side.footer',
];

const SECTIONS: readonly SectionDefinition[] = [
  { prefix: 'nav', titleMessage: 'sectionNav', builtinItems: NAV_ITEMS },
  { prefix: 'more', titleMessage: 'sectionMore', builtinItems: MORE_ITEMS },
  {
    prefix: 'side',
    titleMessage: 'sectionSide',
    builtinItems: [...SIDE_BLOCKS].sort((a, b) => SIDE_DISPLAY_ORDER.indexOf(a.key) - SIDE_DISPLAY_ORDER.indexOf(b.key)),
  },
];

let stored: StoredState = {};
// 画面を開いた時点で「新規」だった項目。保存の印は開いた直後に外すが、この画面を閉じるまでは印を出し続ける
let newKeysOnOpen = new Set<string>();

function reportError(error: unknown): void {
  console.error('Layout Toggle for Twitter:', error);
}

function t(name: string): string {
  return browser.i18n.getMessage(name) || name;
}

/** HTML に必ずある要素を取り出す。無ければ HTML の書き間違いなので例外にする */
function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} が options.html に無い`);

  return element;
}

function applyStaticMessages(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n ?? '');
  }
  document.documentElement.lang = browser.i18n.getUILanguage();
}

function isHidden(key: string): boolean {
  return resolveHidden(stored, key);
}

/** 欄に並べる key。組み込みの項目の後に、x.com で見つけた表に無い項目を並べる */
function listSectionKeys(section: SectionDefinition): string[] {
  const builtinKeys = section.builtinItems.map((item) => item.key);
  const discoveredKeys = Object.keys(stored.seen ?? {})
    .filter((key) => key.startsWith(`${section.prefix}.`) && !builtinKeys.includes(key));

  return [...builtinKeys, ...discoveredKeys];
}

function readItemLabel(key: string): string {
  if (isBuiltinKey(key)) return t(buildMessageName(key));

  return stored.seen?.[key]?.label || key;
}

async function saveHidden(changes: Record<string, boolean>): Promise<void> {
  stored.hidden = { ...stored.hidden, ...changes };
  await browser.storage.local.set({ hidden: stored.hidden });
}

async function saveLayout(changes: Partial<Layout>): Promise<void> {
  stored.layout = { ...stored.layout, ...changes };
  await browser.storage.local.set({ layout: stored.layout });
}

// --- 描画 ---

function buildBadge(messageName: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = t(messageName);

  return badge;
}

function buildRow(key: string): HTMLElement {
  const id = `item-${key}`;
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = readItemLabel(key);
  if (newKeysOnOpen.has(key) || stored.seen?.[key]?.new) label.append(buildBadge('badgeNew'));

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'switch';
  toggle.id = id;
  toggle.checked = !isHidden(key);
  toggle.addEventListener('change', () => {
    saveHidden({ [key]: !toggle.checked }).catch(reportError);
  });

  row.append(label, toggle);

  return row;
}

function buildSectionButton(messageName: string, keys: readonly string[], hidden: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t(messageName);
  button.addEventListener('click', () => {
    saveHidden(Object.fromEntries(keys.map((key) => [key, hidden]))).catch(reportError);
  });

  return button;
}

function buildSection(section: SectionDefinition): HTMLElement {
  const keys = listSectionKeys(section);
  const element = document.createElement('section');
  element.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = t(section.titleMessage);
  const buttons = document.createElement('div');
  buttons.className = 'section-buttons';
  buttons.append(
    buildSectionButton('buttonShowAll', keys, false),
    buildSectionButton('buttonHideAll', keys, true),
  );
  head.append(title, buttons);
  element.append(head);

  const hasSeenMoreMenu = Object.keys(stored.seen ?? {}).some((key) => key.startsWith('more.'));
  if (section.prefix === 'more' && !hasSeenMoreMenu) {
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent = t('noteMoreNotSeen');
    element.append(hint);
  }

  element.append(...keys.map(buildRow));

  return element;
}

function renderLayout(): void {
  const layout = resolveLayout(stored);
  requireElement('layout-promote', HTMLInputElement).checked = layout.promote;
  requireElement('layout-widen', HTMLInputElement).checked = layout.widen;
  requireElement('widen-note', HTMLParagraphElement).textContent = t(layout.widen ? 'noteWidenWaiting' : 'noteWidenOff');
}

/** content script が x.com で一度も動いていなければ案内を出す */
function renderNotRunBanner(): void {
  requireElement('not-run-banner', HTMLDivElement).hidden = Boolean(stored.status?.ranAt);
}

/** 描き直しても、操作中のスイッチからフォーカスが外れないようにする */
function render(): void {
  const focusedId = document.activeElement?.id;

  requireElement('sections', HTMLDivElement).replaceChildren(...SECTIONS.map(buildSection));
  renderLayout();
  renderNotRunBanner();

  if (focusedId) document.getElementById(focusedId)?.focus();
}

/** 「新規」の印は一度見せたら、保存の側から外す */
async function clearNewBadges(): Promise<void> {
  if (newKeysOnOpen.size === 0) return;

  const seen = stored.seen ?? {};
  const cleared = { ...seen };
  for (const key of newKeysOnOpen) cleared[key] = { ...seen[key], new: false };
  await browser.storage.local.set({ seen: cleared });
}

// --- 起動 ---

function bindStaticControls(): void {
  const promote = requireElement('layout-promote', HTMLInputElement);
  const widen = requireElement('layout-widen', HTMLInputElement);

  promote.addEventListener('change', () => {
    saveLayout({ promote: promote.checked }).catch(reportError);
  });
  widen.addEventListener('change', () => {
    saveLayout({ widen: widen.checked }).catch(reportError);
  });
  requireElement('reset', HTMLButtonElement).addEventListener('click', () => {
    browser.storage.local.remove(['hidden', 'layout']).catch(reportError);
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  stored = applyStorageChanges(stored, changes);
  render();
});

applyStaticMessages();
bindStaticControls();
browser.storage.local.get(null).then(async (items) => {
  stored = items as StoredState;
  const seen = stored.seen ?? {};
  newKeysOnOpen = new Set(Object.keys(seen).filter((key) => seen[key]?.new));
  render();
  await clearNewBadges();
}).catch(reportError);

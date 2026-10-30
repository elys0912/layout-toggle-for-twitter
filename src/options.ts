// 設定画面。storage.local の hidden・layout を書き、content script が記録した seen（見つけた項目）と
// status.ranAt（x.com で動いた時刻）を読んで画面を作る。
// 保存は切り替えた時点で行う。開いている x.com のタブは storage.onChanged で反映する。

import { MORE_ITEMS, NAV_ITEMS, SIDE_BLOCKS_IN_DISPLAY_ORDER, isKeyInSection } from './page-rules.ts';
import type { LinkRule, SectionPrefix, SideBlockRule } from './page-rules.ts';
import {
  applyStorageChanges,
  buildMessageName,
  clearNewMarks,
  isBuiltinKey,
  resolveHidden,
  resolveLayout,
  toStoredState,
} from './registry.ts';
import type { Layout, StoredState } from './registry.ts';
import { updateStoredState } from './storage.ts';

interface SectionDefinition {
  prefix: SectionPrefix;
  titleMessage: string;
  builtinItems: readonly (LinkRule | SideBlockRule)[];
}

const SECTIONS: readonly SectionDefinition[] = [
  { prefix: 'nav', titleMessage: 'sectionNav', builtinItems: NAV_ITEMS },
  { prefix: 'more', titleMessage: 'sectionMore', builtinItems: MORE_ITEMS },
  // 右サイドバーは x.com の画面の上から順に並べる
  { prefix: 'side', titleMessage: 'sectionSide', builtinItems: SIDE_BLOCKS_IN_DISPLAY_ORDER },
];

/** 設定画面が書く設定。保存の待ち行列に入れる単位 */
type SettingsChanges = Pick<StoredState, 'hidden' | 'layout'>;

let stored: StoredState = {};
// 画面を開いた時点で「新規」だった項目。保存の印は開いた直後に外すが、この画面を閉じるまでは印を出し続ける
let newKeysOnOpen = new Set<string>();
// 最後に欄を作ったときの、欄の並びと見た目（buildSectionsSnapshot）。変わらなければ欄を作り直さない
let renderedSectionsSnapshot = '';
// 最後に並べた設定の書き込みが終わる時点。書き込みはこの後ろに 1 つずつ並べる
let lastQueuedSettingsWrite: Promise<void> = Promise.resolve();
// 待ち行列に入れ、まだ保存が終わっていない変更（並べた順）。画面には保存値にこれを重ねた値を出す
let queuedSettingsChanges: SettingsChanges[] = [];

function reportError(error: unknown): void {
  console.error('Layout Toggle for Twitter:', error);
}

function t(name: string): string {
  // getMessage は定義の無い名前に空文字を返すので、?? でなく || で名前に戻す
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

/** 画面に出す、隠すかどうか。保存を待っている変更があれば、保存値より後に並べた変更を出す */
function isHidden(key: string): boolean {
  const queued = queuedSettingsChanges.findLast((changes) => changes.hidden?.[key] !== undefined);

  return queued?.hidden?.[key] ?? resolveHidden(stored, key);
}

/** 画面に出す並べ方。保存値に、保存を待っている変更を並べた順に重ねる */
function resolveDisplayedLayout(): Layout {
  return queuedSettingsChanges.reduce<Layout>(
    (layout, changes) => ({ ...layout, ...changes.layout }),
    resolveLayout(stored),
  );
}

/** 欄に並べる key。組み込みの項目の後に、x.com で見つけた表に無い項目を並べる */
function listSectionKeys(section: SectionDefinition): string[] {
  const builtinKeys = section.builtinItems.map((item) => item.key);
  const discoveredKeys = Object.keys(stored.seen ?? {})
    .filter((key) => isKeyInSection(key, section.prefix) && !builtinKeys.includes(key));

  return [...builtinKeys, ...discoveredKeys];
}

function readItemLabel(key: string): string {
  if (isBuiltinKey(key)) return t(buildMessageName(key));

  // 名前が空のときも、何の項目か分かるよう key を出す
  return stored.seen?.[key]?.label || key;
}

function hasNewBadge(key: string): boolean {
  return newKeysOnOpen.has(key) || Boolean(stored.seen?.[key]?.new);
}

function hasSeenMoreMenu(): boolean {
  return Object.keys(stored.seen ?? {}).some((key) => isKeyInSection(key, 'more'));
}

/**
 * 設定の書き込みを 1 つずつ順に行う。続けて操作したとき、後の書き込みが前の変更を含まない値で上書きしないため。
 * write は前の書き込みが終わってから呼ぶ
 */
function enqueueSettingsWrite(write: () => Promise<void>): Promise<void> {
  const queuedWrite = lastQueuedSettingsWrite.then(write);
  // write が例外を投げても、次の書き込みは行う
  lastQueuedSettingsWrite = queuedWrite.catch(() => undefined);

  return queuedWrite;
}

/** 保存値に changes を重ねた、書き込む値。前の書き込みが終わってから作る */
function buildSettingsToWrite(changes: SettingsChanges): SettingsChanges {
  const toWrite: SettingsChanges = {};
  if (changes.hidden) toWrite.hidden = { ...stored.hidden, ...changes.hidden };
  if (changes.layout) toWrite.layout = { ...stored.layout, ...changes.layout };

  return toWrite;
}

/**
 * 保存が成功してから手元の値を変える。成功しても失敗しても待ち行列から外して描き直す。
 * 失敗したときは、切り替えたスイッチが保存値のとおりに戻る
 */
async function writeSettings(changes: SettingsChanges): Promise<void> {
  const toWrite = buildSettingsToWrite(changes);
  try {
    await browser.storage.local.set(toWrite);
    stored = { ...stored, ...toWrite };
  } catch (error) {
    reportError(error);
  } finally {
    queuedSettingsChanges = queuedSettingsChanges.filter((queued) => queued !== changes);
  }

  render();
}

function saveSettings(changes: SettingsChanges): Promise<void> {
  queuedSettingsChanges.push(changes);

  return enqueueSettingsWrite(() => writeSettings(changes));
}

function saveHidden(changes: Record<string, boolean>): Promise<void> {
  return saveSettings({ hidden: changes });
}

function saveLayout(changes: Partial<Layout>): Promise<void> {
  return saveSettings({ layout: changes });
}

/** 表示の設定（hidden・layout）だけを初期設定に戻す。見つけた項目（seen）と動いた記録（status）は残す */
function resetSettings(): Promise<void> {
  return enqueueSettingsWrite(async () => {
    await browser.storage.local.remove(['hidden', 'layout']);
    stored = { ...stored, hidden: undefined, layout: undefined };
  });
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
  if (hasNewBadge(key)) label.append(buildBadge('badgeNew'));

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'switch';
  toggle.id = id;
  toggle.dataset.key = key;
  toggle.checked = !isHidden(key);
  toggle.addEventListener('change', () => {
    saveHidden({ [key]: !toggle.checked }).catch(reportError);
  });

  row.append(label, toggle);

  return row;
}

/** 欄の項目をまとめて切り替えるボタン。shouldHide が true なら全部隠し、false なら全部表示する */
function buildSectionButton(
  { messageName, keys, shouldHide }: { messageName: string; keys: readonly string[]; shouldHide: boolean },
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t(messageName);
  button.addEventListener('click', () => {
    saveHidden(Object.fromEntries(keys.map((key) => [key, shouldHide]))).catch(reportError);
  });

  return button;
}

function buildSectionHead(section: SectionDefinition, keys: readonly string[]): HTMLElement {
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = t(section.titleMessage);

  const buttons = document.createElement('div');
  buttons.className = 'section-buttons';
  buttons.append(
    buildSectionButton({ messageName: 'buttonShowAll', keys, shouldHide: false }),
    buildSectionButton({ messageName: 'buttonHideAll', keys, shouldHide: true }),
  );

  const head = document.createElement('div');
  head.className = 'section-head';
  head.append(title, buttons);

  return head;
}

/** 「もっと見る」を x.com で一度も開いていないときの案内。開いていれば null */
function buildMoreNotSeenNote(): HTMLElement | null {
  if (hasSeenMoreMenu()) return null;

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = t('noteMoreNotSeen');

  return note;
}

function buildSection(section: SectionDefinition): HTMLElement {
  const keys = listSectionKeys(section);
  const element = document.createElement('section');
  element.className = 'section';
  element.append(buildSectionHead(section, keys));

  const note = section.prefix === 'more' ? buildMoreNotSeenNote() : null;
  if (note) element.append(note);

  element.append(...keys.map(buildRow));

  return element;
}

function renderLayout(): void {
  const layout = resolveDisplayedLayout();
  requireElement('layout-promote', HTMLInputElement).checked = layout.promote;
  requireElement('layout-widen', HTMLInputElement).checked = layout.widen;
  requireElement('widen-note', HTMLParagraphElement).textContent = t(layout.widen ? 'noteWidenWaiting' : 'noteWidenOff');
}

/** content script が x.com で一度も動いていなければ案内を出す */
function renderNotRunBanner(): void {
  requireElement('not-run-banner', HTMLDivElement).hidden = Boolean(stored.status?.ranAt);
}

/**
 * 欄の作りを決める値（項目の並び・名前・「新規」の印・「もっと見る」の案内）を 1 つの文字列にする。
 * seen の href・iconPaths・order は欄に出ないので含めない
 */
function buildSectionsSnapshot(): string {
  const rows = SECTIONS.map((section) => (
    listSectionKeys(section).map((key) => [key, readItemLabel(key), hasNewBadge(key)])
  ));

  return JSON.stringify({ rows, hasSeenMoreMenu: hasSeenMoreMenu() });
}

/** 項目のスイッチを、作り直さずに画面に出す値（保存値と保存を待っている変更）に合わせる */
function syncItemToggles(): void {
  for (const toggle of document.querySelectorAll<HTMLInputElement>('#sections input[data-key]')) {
    toggle.checked = !isHidden(toggle.dataset.key ?? '');
  }
}

/**
 * 欄を保存値に合わせる。x.com を開いている間は content script が seen・status を書くたびに呼ばれるので、
 * 欄の作りが変わらなければスイッチだけ合わせ、スクロール位置とフォーカスを動かさない。
 * 作り直すときも、操作中のスイッチからフォーカスが外れないようにする
 */
function renderSections(): void {
  const snapshot = buildSectionsSnapshot();
  if (snapshot === renderedSectionsSnapshot) {
    syncItemToggles();
    return;
  }

  const focusedId = document.activeElement?.id;
  requireElement('sections', HTMLDivElement).replaceChildren(...SECTIONS.map(buildSection));
  renderedSectionsSnapshot = snapshot;

  if (focusedId) document.getElementById(focusedId)?.focus();
}

/** storage の値に合わせて画面を描き直す */
function render(): void {
  renderSections();
  renderLayout();
  renderNotRunBanner();
}

/**
 * 「新規」の印は一度見せたら、保存の側から外す。
 * 画面を開いてからも content script が seen に項目を足しうるので、書く直前に読み直して重ねる
 */
async function clearNewBadges(): Promise<void> {
  if (newKeysOnOpen.size === 0) return;

  await updateStoredState(['seen'], ({ seen = {} }) => ({ seen: clearNewMarks(seen, newKeysOnOpen) }));
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
    resetSettings().catch(reportError);
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
  stored = toStoredState(items);
  const seen = stored.seen ?? {};
  newKeysOnOpen = new Set(Object.keys(seen).filter((key) => seen[key]?.new));
  render();
  await clearNewBadges();
}).catch(reportError);

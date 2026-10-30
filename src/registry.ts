// 保存値（storage.local の中身）の形と、DOM を書き換えない判定・計算の関数。
// content script と設定画面は esbuild でこのファイルを取り込み、テストは node がそのまま読む。
// x.com の画面の手がかりの表と key の作り方は page-rules.ts に置く。

import { BUILTIN_ITEMS, NAV_ITEMS, SPACER_KEY } from './page-rules.ts';

export interface Layout {
  widen: boolean;
  promote: boolean;
}

/** content script が x.com で見つけた項目。more.* は左メニューへ移すときに href・iconPaths・order を使う */
export interface SeenEntry {
  label?: string;
  href?: string;
  iconPaths?: string[];
  order?: number;
  new?: boolean;
}

/** content script が動いた記録。ranAt は設定画面が「x.com で動いたか」を判断するのに使う */
export interface RunStatus {
  ranAt?: number;
}

/** storage.local の中身。書くのはこの拡張だけ */
export interface StoredState {
  hidden?: Record<string, boolean>;
  layout?: Partial<Layout>;
  seen?: Record<string, SeenEntry>;
  status?: RunStatus;
}

export interface MoreItem {
  key: string;
  href: string;
  order: number;
  label?: string;
  iconPaths?: string[];
}

const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_ITEMS.map((item) => item.key));

// 初期状態で隠す項目。ホームと設定とプライバシーは、隠すと戻る手段が減るので含めない
export const DEFAULT_HIDDEN: readonly string[] = [
  'nav.grok',
  'nav.premium',
  'more.business',
  'more.ads',
  'side.premium',
  'side.live',
  'side.scores',
];

const DEFAULT_LAYOUT: Layout = { widen: false, promote: true };

// 隠すと「もっと見る」から 1 つ移せる左メニューの項目。ボタン類と、もっと見る自体は数えない
export const SLOT_KEYS: readonly string[] = NAV_ITEMS
  .filter((item) => item.button === undefined)
  .map((item) => item.key);

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_KEYS.has(key);
}

/** 項目を隠すかどうか。保存値に無い項目は初期値に従う */
export function resolveHidden(stored: StoredState, key: string): boolean {
  if (key === SPACER_KEY) return resolveHidden(stored, 'side.search');

  return stored.hidden?.[key] ?? DEFAULT_HIDDEN.includes(key);
}

export function resolveLayout(stored: StoredState): Layout {
  return {
    widen: stored.layout?.widen ?? DEFAULT_LAYOUT.widen,
    promote: stored.layout?.promote ?? DEFAULT_LAYOUT.promote,
  };
}

/**
 * 「もっと見る」から左メニューへ移す項目を、移す順に返す。
 * 移せる数は、ページにある左メニューの項目のうち隠したものの数。
 * 隠した項目と、同じ href がすでに左メニューにある項目は移さない
 */
export function computePromotions(input: {
  presentNavKeys: readonly string[];
  moreItems: readonly MoreItem[];
  navHrefs: ReadonlySet<string>;
  isHidden: (key: string) => boolean;
}): MoreItem[] {
  const { presentNavKeys, moreItems, navHrefs, isHidden } = input;
  const slotCount = presentNavKeys
    .filter((key) => SLOT_KEYS.includes(key) && isHidden(key))
    .length;
  if (slotCount === 0) return [];

  const candidates = [...moreItems]
    .sort((a, b) => a.order - b.order)
    .filter((item) => !isHidden(item.key) && !navHrefs.has(item.href));

  return candidates.slice(0, slotCount);
}

/** タイムラインを広げるか。ページにある右サイドバーのブロックがすべて隠れているときだけ広げる */
export function shouldWiden(input: {
  layout: Pick<Layout, 'widen'>;
  presentSideKeys: readonly string[];
  isHidden: (key: string) => boolean;
}): boolean {
  const { layout, presentSideKeys, isHidden } = input;
  const blockKeys = presentSideKeys.filter((key) => key !== SPACER_KEY);
  if (!layout.widen || blockKeys.length === 0) return false;

  return blockKeys.every(isHidden);
}

// 隠すときの宣言。X の CSS より優先させるため !important を付ける
export const HIDE_DECLARATION = 'display:none!important';

// 左メニューへ移した項目の、「もっと見る」の中の元の項目に付ける印。content script の CSS でこの印の付いた項目を隠す
export const PROMOTED_ATTRIBUTE = 'data-xlt-promoted';

/**
 * 隠す項目の CSS。key は見出しの文字を含みうるので、CSS の文字列としてエスケープする。
 * 例：['nav.grok'] → '[data-xlt="nav.grok"]{display:none!important}'
 */
export function buildHiddenCss(keys: readonly string[]): string {
  return keys
    .map((key) => `[data-xlt="${escapeCssString(key)}"]{${HIDE_DECLARATION}}`)
    .join('\n');
}

/**
 * CSS の文字列の中にそのまま置けない文字をエスケープする。例：'a"b' → 'a\"b'、改行 → '\a '
 * 改行の類（\n・\r・\f）は 16 進のエスケープにする。後ろの空白はエスケープの終わりの印で、
 * 続く文字が 16 進の数字でもエスケープの一部として読まれない
 */
function escapeCssString(text: string): string {
  return text
    .replace(/["\\]/g, '\\$&')
    .replace(/[\n\r\f]/g, (newline) => `\\${newline.charCodeAt(0).toString(16)} `);
}

/** storage.onChanged の変更を取り込んだ新しい状態を返す。newValue が無い項目は消えたものとして扱う */
export function applyStorageChanges(
  stored: StoredState,
  changes: Record<string, { newValue?: unknown }>,
): StoredState {
  const next: Record<string, unknown> = { ...stored };
  for (const [name, { newValue }] of Object.entries(changes)) {
    if (newValue === undefined) {
      delete next[name];
    } else {
      next[name] = newValue;
    }
  }

  return toStoredState(next);
}

/** content script が保存を待っている記録 */
export interface PendingRecords {
  seen: Record<string, SeenEntry>;
  status: RunStatus;
}

/**
 * 書く直前に読み直した保存値に、content script が保存を待っている記録を重ねる。
 * 同じ key の項目は手元の記録で置き換え、手元に無い項目（設定画面が書いた分を含む）は保存値のまま残す
 */
export function mergePendingRecords(
  latest: StoredState,
  pending: PendingRecords,
): Required<Pick<StoredState, 'seen' | 'status'>> {
  return {
    seen: { ...latest.seen, ...pending.seen },
    status: { ...latest.status, ...pending.status },
  };
}

/** 書く直前に読み直した seen の、keys の項目から「新規」の印だけを外した写しを返す */
export function clearNewMarks(seen: Record<string, SeenEntry>, keys: Iterable<string>): Record<string, SeenEntry> {
  const cleared = { ...seen };
  for (const key of keys) cleared[key] = { ...seen[key], new: false };

  return cleared;
}

/** storage.local から読んだ値を StoredState として扱う */
export function toStoredState(items: Record<string, unknown>): StoredState {
  // 書くのはこの拡張だけなので、値は StoredState の各項目の形をしている
  return items as StoredState;
}

/** 組み込みの項目の翻訳名。例：'nav.home' → 'item_nav_home' */
export function buildMessageName(key: string): string {
  // 組み込みの key は '.' を 1 つだけ含むので、最初の 1 つを置き換えれば足りる
  return `item_${key.replace('.', '_')}`;
}

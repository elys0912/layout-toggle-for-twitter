// x.com の項目の見分け方（データ）と、DOM を書き換えない判定・計算の関数。
// content script と設定画面は esbuild でこのファイルを取り込み、テストは node がそのまま読む。
// 見分け方は 2026-10-29 に x.com/home（日本語表示）の DOM を読んで決めた。

export interface LinkRule {
  key: string;
  testid?: string;
  href?: string;
  hrefPattern?: RegExp;
}

export interface SideBlockRule {
  key: string;
  selector: string;
}

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

/** storage.local の中身。書くのはこの拡張だけ */
export interface StoredState {
  hidden?: Record<string, boolean>;
  layout?: Partial<Layout>;
  seen?: Record<string, SeenEntry>;
  status?: { ranAt?: number };
}

export interface MoreItem {
  key: string;
  href: string;
  order: number;
  label?: string;
  iconPaths?: string[];
}

/** classifySideBlock が使う分だけの要素の形。テストでは偽の要素を渡す */
export interface QueryableBlock {
  textContent: string | null;
  querySelector(selector: string): { textContent: string | null } | null;
}

// 左メニュー（header[role="banner"] の中）。testid が無い項目は href で見分ける
export const NAV_ITEMS: readonly LinkRule[] = [
  { key: 'nav.home', testid: 'AppTabBar_Home_Link' },
  { key: 'nav.explore', testid: 'AppTabBar_Explore_Link' },
  { key: 'nav.notifications', testid: 'AppTabBar_Notifications_Link' },
  { key: 'nav.messages', testid: 'AppTabBar_DirectMessage_Link' },
  { key: 'nav.calls', testid: 'AppTabBar_Calls_Link' },
  { key: 'nav.grok', href: '/i/grok' },
  { key: 'nav.history', href: '/i/history' },
  { key: 'nav.premium', testid: 'premium-signup-tab' },
  { key: 'nav.profile', testid: 'AppTabBar_Profile_Link' },
  { key: 'nav.more', testid: 'AppTabBar_More_Menu' },
  { key: 'nav.post', testid: 'SideNav_NewTweet_Button' },
  { key: 'nav.account', testid: 'SideNav_AccountSwitcher_Button' },
];

// 「もっと見る」の中（#layers の [role="menu"]）。リストとコミュニティは href の先頭にユーザー名が入る
export const MORE_ITEMS: readonly LinkRule[] = [
  { key: 'more.lists', hrefPattern: /^\/[^/]+\/lists$/ },
  { key: 'more.communities', hrefPattern: /^\/[^/]+\/communities$/ },
  { key: 'more.studio', href: '/i/jf/creators/studio' },
  { key: 'more.notes', href: '/i/communitynotes' },
  { key: 'more.business', href: '/i/verified-orgs-signup' },
  { key: 'more.ads', hrefPattern: /^https:\/\/ads\.x\.com\// },
  { key: 'more.spaces', href: '/i/spaces/start' },
  { key: 'more.settings', testid: 'settings' },
];

// 右サイドバーのブロック。上から順に判定する。
// live の手がかり（pill-contents-container）は他のブロックにも出うるので最後に置く
export const SIDE_BLOCKS: readonly SideBlockRule[] = [
  { key: 'side.search', selector: '[data-testid="SearchBox_Search_Input"]' },
  { key: 'side.premium', selector: 'a[href="/i/premium_sign_up"]' },
  // 検索のページだけに出る。見出しは別のブロックに分かれている（mergeHeadingBlocks で同じ項目にまとめる）
  { key: 'side.filters', selector: '[data-testid="searchFiltersAdvancedSearch"], [data-testid="radioGroupPeople"]' },
  { key: 'side.follow', selector: '[data-testid="UserCell"], a[href^="/i/connect_people"]' },
  { key: 'side.footer', selector: 'nav a[href*="/tos"]' },
  { key: 'side.news', selector: '[data-testid="news_sidebar"]' },
  { key: 'side.scores', selector: '[data-testid$="_scores_sidebar"]' },
  { key: 'side.trends', selector: '[data-testid="trend"], a[href^="/explore/tabs/"]' },
  { key: 'side.live', selector: '[data-testid="pill-contents-container"]' },
];

// 検索ボックスの下にある、中身の無い余白。検索ボックスと一緒に隠す
export const SPACER_KEY = 'side.spacer';

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
  .map((item) => item.key)
  .filter((key) => !['nav.more', 'nav.post', 'nav.account'].includes(key));

/** リンクの testid と href から、項目の key を返す。どれにも当てはまらなければ null */
export function identifyLink(
  link: { testid: string | null; href: string | null },
  rules: readonly LinkRule[],
): string | null {
  const matched = rules.find((rule) => {
    if (rule.testid) return link.testid === rule.testid;
    if (rule.href) return link.href === rule.href;

    return rule.hrefPattern?.test(link.href ?? '') ?? false;
  });

  return matched ? matched.key : null;
}

/** 見分け方の表に無いリンクの key。例：('nav', '/i/bookmarks') → 'nav.href:/i/bookmarks' */
export function buildUnknownLinkKey(section: 'nav' | 'more', href: string): string {
  return `${section}.href:${href}`;
}

/**
 * 右サイドバーのブロック 1 つを判定する。
 * 表に無いブロックは見出しの文字を key にする。見出しも中身も無ければ余白とみなす
 */
export function classifySideBlock(block: QueryableBlock): string | null {
  const known = SIDE_BLOCKS.find(({ selector }) => block.querySelector(selector));
  if (known) return known.key;

  if ((block.textContent ?? '').trim() === '') return SPACER_KEY;

  const title = (block.querySelector('h2')?.textContent ?? '').trim();

  return title ? `side.h:${title}` : null;
}

// 見出しと中身が別のブロックに分かれている項目。直前の見出しだけのブロックを同じ項目として扱う
const KEYS_WITH_SEPARATE_HEADING: readonly string[] = ['side.filters'];

/**
 * 右サイドバーの並びの key を受け取り、見出しが別のブロックに分かれた項目の見出しを、中身と同じ key にした並びを返す。
 * 例：['side.h:検索フィルター', 'side.filters'] → ['side.filters', 'side.filters']
 */
export function mergeHeadingBlocks(keys: readonly (string | null)[]): (string | null)[] {
  return keys.map((key, index) => {
    const next = keys[index + 1];
    const isHeadingOfNext = key?.startsWith('side.h:') && next !== undefined && next !== null && KEYS_WITH_SEPARATE_HEADING.includes(next);

    return isHeadingOfNext ? next : key;
  });
}

export function isBuiltinKey(key: string): boolean {
  return [...NAV_ITEMS, ...MORE_ITEMS, ...SIDE_BLOCKS].some((item) => item.key === key);
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
  const blockKeys = input.presentSideKeys.filter((key) => key !== SPACER_KEY);
  if (!input.layout.widen || blockKeys.length === 0) return false;

  return blockKeys.every(input.isHidden);
}

/**
 * 隠す項目の CSS。key は見出しの文字を含みうるので、CSS の文字列としてエスケープする。
 * 例：['nav.grok'] → '[data-xlt="nav.grok"]{display:none!important}'
 */
export function buildHiddenCss(keys: readonly string[]): string {
  return keys
    .map((key) => `[data-xlt="${escapeCssString(key)}"]{display:none!important}`)
    .join('\n');
}

function escapeCssString(text: string): string {
  return text.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
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

  // 書くのはこの拡張だけなので、値は StoredState の各項目の形をしている
  return next as StoredState;
}

/** 組み込みの項目の翻訳名。例：'nav.home' → 'item_nav_home' */
export function buildMessageName(key: string): string {
  return `item_${key.replace('.', '_')}`;
}

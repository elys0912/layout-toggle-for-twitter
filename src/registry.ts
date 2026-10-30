// x.com の項目の見分け方（データ）と、DOM を書き換えない判定・計算の関数。
// content script と設定画面は esbuild でこのファイルを取り込み、テストは node がそのまま読む。
// 見分け方は 2026-10-29 に x.com/home（日本語表示）の DOM を読んで決めた。

/** リンクの見分け方。by で、リンクのどの属性を比べるかを決める */
export type LinkRule =
  | { key: string; by: 'testid'; testid: string }
  | { key: string; by: 'href'; href: string }
  | { key: string; by: 'hrefPattern'; hrefPattern: RegExp };

/**
 * 左メニューの、移す枠に数えないボタン。
 * more は「もっと見る」を開くボタン、belowNav は nav の外（左メニューの下）にあるボタン
 */
export type NavButton = 'more' | 'belowNav';

export type NavRule = LinkRule & { button?: NavButton };

/** identifyLink が比べる、リンクの属性 */
export interface LinkAttributes {
  testid: string | null;
  href: string | null;
}

export interface SideBlockRule {
  key: string;
  selector: string;
}

/** 項目の key の先頭。設定画面の欄の区切りと同じ */
export type SectionPrefix = 'nav' | 'more' | 'side';

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

/** classifySideBlock が使う分だけの要素の形。テストでは偽の要素を渡す */
export interface QueryableBlock {
  textContent: string | null;
  querySelector(selector: string): { textContent: string | null } | null;
}

// 見分け方の表と、content script の DOM の探索の両方で使う testid
const EXPLORE_TESTID = 'AppTabBar_Explore_Link';
const MORE_BUTTON_TESTID = 'AppTabBar_More_Menu';
const SETTINGS_TESTID = 'settings';

// 左メニュー（header[role="banner"] の中）。testid が無い項目は href で見分ける
export const NAV_ITEMS: readonly NavRule[] = [
  { key: 'nav.home', by: 'testid', testid: 'AppTabBar_Home_Link' },
  { key: 'nav.explore', by: 'testid', testid: EXPLORE_TESTID },
  { key: 'nav.notifications', by: 'testid', testid: 'AppTabBar_Notifications_Link' },
  { key: 'nav.messages', by: 'testid', testid: 'AppTabBar_DirectMessage_Link' },
  { key: 'nav.calls', by: 'testid', testid: 'AppTabBar_Calls_Link' },
  { key: 'nav.grok', by: 'href', href: '/i/grok' },
  { key: 'nav.history', by: 'href', href: '/i/history' },
  { key: 'nav.premium', by: 'testid', testid: 'premium-signup-tab' },
  { key: 'nav.profile', by: 'testid', testid: 'AppTabBar_Profile_Link' },
  { key: 'nav.more', by: 'testid', testid: MORE_BUTTON_TESTID, button: 'more' },
  { key: 'nav.post', by: 'testid', testid: 'SideNav_NewTweet_Button', button: 'belowNav' },
  { key: 'nav.account', by: 'testid', testid: 'SideNav_AccountSwitcher_Button', button: 'belowNav' },
];

// 「もっと見る」の中（#layers の [role="menu"]）。リストとコミュニティは href の先頭にユーザー名が入る
export const MORE_ITEMS: readonly LinkRule[] = [
  { key: 'more.lists', by: 'hrefPattern', hrefPattern: /^\/[^/]+\/lists$/ },
  { key: 'more.communities', by: 'hrefPattern', hrefPattern: /^\/[^/]+\/communities$/ },
  { key: 'more.studio', by: 'href', href: '/i/jf/creators/studio' },
  { key: 'more.notes', by: 'href', href: '/i/communitynotes' },
  { key: 'more.business', by: 'href', href: '/i/verified-orgs-signup' },
  { key: 'more.ads', by: 'hrefPattern', hrefPattern: /^https:\/\/ads\.x\.com\// },
  { key: 'more.spaces', by: 'href', href: '/i/spaces/start' },
  { key: 'more.settings', by: 'testid', testid: SETTINGS_TESTID },
];

// --- content script が DOM を探す selector。testid を使うものは、見分け方の表と同じ定数から作る ---

export const HEADER_SELECTOR = 'header[role="banner"]';
export const NAV_SELECTOR = 'nav[role="navigation"]';
export const PRIMARY_COLUMN_SELECTOR = '[data-testid="primaryColumn"]';
export const SIDEBAR_COLUMN_SELECTOR = '[data-testid="sidebarColumn"]';

export const MORE_BUTTON_SELECTOR = buildTestidSelector(MORE_BUTTON_TESTID);

// 「もっと見る」のメニューだけを選ぶ。投稿の「…」など、他のメニューも #layers に出る
export const MORE_MENU_SELECTOR = `#layers [role="menu"]:has(a${buildTestidSelector(SETTINGS_TESTID)})`;

// 複製の元にする左メニューの項目。中身の作りが素直な「話題を検索」
export const CLONE_TEMPLATE_SELECTOR = buildTestidSelector(EXPLORE_TESTID);

// nav の外（左メニューの下）にあるボタン
export const BELOW_NAV_BUTTON_SELECTORS: readonly string[] = NAV_ITEMS.flatMap((item) => (
  item.button === 'belowNav' && item.by === 'testid' ? [buildTestidSelector(item.testid)] : []
));

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

// 設定画面で右サイドバーの項目を並べる順。x.com の画面の上から順。
// SIDE_BLOCKS は判定の優先順なので、画面の並びとは違う。SIDE_BLOCKS に足したらここにも足す（試験で確かめる）
export const SIDE_DISPLAY_ORDER: readonly string[] = [
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

export const SIDE_BLOCKS_IN_DISPLAY_ORDER: readonly SideBlockRule[] = sortByDisplayOrder(SIDE_BLOCKS, SIDE_DISPLAY_ORDER);

export const BUILTIN_ITEMS: readonly (LinkRule | SideBlockRule)[] = [...NAV_ITEMS, ...MORE_ITEMS, ...SIDE_BLOCKS];

const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUILTIN_ITEMS.map((item) => item.key));

// 検索ボックスの下にある、中身の無い余白。検索ボックスと一緒に隠す
export const SPACER_KEY = 'side.spacer';

// 右サイドバーの、表に無いブロックの key の先頭。後ろに見出しの文字が付く
const HEADING_KEY_PREFIX = 'side.h:';

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

function buildTestidSelector(testid: string): string {
  return `[data-testid="${testid}"]`;
}

/** リンクの testid と href から、項目の key を返す。どれにも当てはまらなければ null */
export function identifyLink(link: LinkAttributes, rules: readonly LinkRule[]): string | null {
  const matched = rules.find((rule) => matchesLink(link, rule));

  return matched?.key ?? null;
}

function matchesLink(link: LinkAttributes, rule: LinkRule): boolean {
  switch (rule.by) {
    case 'testid':
      return link.testid === rule.testid;
    case 'href':
      return link.href === rule.href;
    case 'hrefPattern':
      return rule.hrefPattern.test(link.href ?? '');
  }
}

/** 欄の項目の key に共通する先頭。例：'more' → 'more.' */
export function buildKeyPrefix(section: SectionPrefix): string {
  return `${section}.`;
}

export function isKeyInSection(key: string, section: SectionPrefix): boolean {
  return key.startsWith(buildKeyPrefix(section));
}

/** 見分け方の表に無いリンクの key。例：('nav', '/i/bookmarks') → 'nav.href:/i/bookmarks' */
export function buildUnknownLinkKey(section: Exclude<SectionPrefix, 'side'>, href: string): string {
  return `${buildKeyPrefix(section)}href:${href}`;
}

/** 表に無い右サイドバーのブロックの key。例：'新しいブロック' → 'side.h:新しいブロック' */
export function buildHeadingKey(title: string): string {
  return `${HEADING_KEY_PREFIX}${title}`;
}

/** buildHeadingKey で作った key から見出しの文字を取り出す。見出しの key でなければ null */
export function readHeadingTitle(key: string): string | null {
  return key.startsWith(HEADING_KEY_PREFIX) ? key.slice(HEADING_KEY_PREFIX.length) : null;
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

  return title ? buildHeadingKey(title) : null;
}

// 見出しと中身が別のブロックに分かれている項目。直前の見出しだけのブロックを同じ項目として扱う
const KEYS_WITH_SEPARATE_HEADING: readonly string[] = ['side.filters'];

/**
 * 右サイドバーの並びの key を受け取り、見出しが別のブロックに分かれた項目の見出しを、中身と同じ key にした並びを返す。
 * 例：['side.h:検索フィルター', 'side.filters'] → ['side.filters', 'side.filters']
 */
export function mergeHeadingBlocks(keys: readonly (string | null)[]): (string | null)[] {
  return keys.map((key, index) => {
    const next = keys[index + 1] ?? null;
    const isHeading = key !== null && readHeadingTitle(key) !== null;
    const hasSeparateHeading = next !== null && KEYS_WITH_SEPARATE_HEADING.includes(next);

    return isHeading && hasSeparateHeading ? next : key;
  });
}

/** items を、key が order に出てくる順に並べ替えた写しを返す */
function sortByDisplayOrder<T extends { key: string }>(items: readonly T[], order: readonly string[]): T[] {
  return [...items].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

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

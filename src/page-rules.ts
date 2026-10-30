// x.com の画面の手がかりの表（項目の見分け方と、content script が DOM を探す selector）と、項目の key の作り方。
// X が画面を変えたら、このファイルを直す。保存値と設定の判定は registry.ts に置く。
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

// 検索ボックスの下にある、中身の無い余白。検索ボックスと一緒に隠す
export const SPACER_KEY = 'side.spacer';

// 右サイドバーの、表に無いブロックの key の先頭。後ろに見出しの文字が付く
const HEADING_KEY_PREFIX = 'side.h:';

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

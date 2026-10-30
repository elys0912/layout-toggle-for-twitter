// 項目の見分け方と、移動・広げる判定を、使う人の操作の場面と境目の値で確かめる。
// DOM は使わず、判定が使う分だけを持つ偽の要素で試す

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  MORE_ITEMS,
  NAV_ITEMS,
  SIDE_BLOCKS,
  SIDE_DISPLAY_ORDER,
  SPACER_KEY,
  BUILTIN_ITEMS,
  buildHeadingKey,
  buildUnknownLinkKey,
  classifySideBlock,
  identifyLink,
  mergeHeadingBlocks,
  readHeadingTitle,
} from '../src/page-rules.ts';
import type { QueryableBlock } from '../src/page-rules.ts';
import {
  applyStorageChanges,
  buildHiddenCss,
  buildMessageName,
  clearNewMarks,
  computePromotions,
  mergePendingRecords,
  resolveHidden,
  resolveLayout,
  shouldWiden,
} from '../src/registry.ts';
import type { MoreItem } from '../src/registry.ts';

// classifySideBlock が使う分だけを持つ、右サイドバーのブロックの代わり。
// parts はブロックの中にある要素の selector。selector の「, 」区切りのどれかが parts にあれば見つかったとみなす
function fakeBlock(
  { parts = [], heading = null, text = 'something' }: { parts?: string[]; heading?: string | null; text?: string } = {},
): QueryableBlock {
  return {
    textContent: text,
    querySelector(selector) {
      if (selector === 'h2') return heading === null ? null : { textContent: heading };

      return selector.split(', ').some((part) => parts.includes(part)) ? { textContent: '' } : null;
    },
  };
}

function hiddenOf(...keys: string[]): (key: string) => boolean {
  return (key) => keys.includes(key);
}

function readMessages(locale: string): Record<string, unknown> {
  const file = new URL(`../_locales/${locale}/messages.json`, import.meta.url);

  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('左メニューの項目の見分け方', () => {
  it('testid のある項目は testid で、testid の無い項目は href で見分ける', () => {
    assert.equal(identifyLink({ testid: 'AppTabBar_Home_Link', href: '/home' }, NAV_ITEMS), 'nav.home');
    assert.equal(identifyLink({ testid: null, href: '/i/grok' }, NAV_ITEMS), 'nav.grok');
  });

  it('X が表に無い項目を足したら、href から key を作って別の項目として扱う', () => {
    assert.equal(identifyLink({ testid: null, href: '/i/bookmarks' }, NAV_ITEMS), null);
    assert.equal(buildUnknownLinkKey('nav', '/i/bookmarks'), 'nav.href:/i/bookmarks');
  });
});

describe('「もっと見る」の項目の見分け方', () => {
  it('リストは誰のアカウントでも見分け、リストの中のページは別物として扱う', () => {
    assert.equal(identifyLink({ testid: null, href: '/someone_123/lists' }, MORE_ITEMS), 'more.lists');
    assert.equal(identifyLink({ testid: null, href: '/someone/lists/123' }, MORE_ITEMS), null);
  });

  it('広告は x.com の外へのリンク先で見分ける', () => {
    assert.equal(identifyLink({ testid: null, href: 'https://ads.x.com/?ref=menu' }, MORE_ITEMS), 'more.ads');
  });
});

describe('右サイドバーのブロックの見分け方', () => {
  it('2026-10-29〜30 に見た 9 種類のブロックを、それぞれの手がかりで見分ける', () => {
    const cases = [
      ['[data-testid="SearchBox_Search_Input"]', 'side.search'],
      ['a[href="/i/premium_sign_up"]', 'side.premium'],
      ['[data-testid="searchFiltersAdvancedSearch"]', 'side.filters'],
      ['[data-testid="UserCell"]', 'side.follow'],
      ['nav a[href*="/tos"]', 'side.footer'],
      ['[data-testid="news_sidebar"]', 'side.news'],
      ['[data-testid$="_scores_sidebar"]', 'side.scores'],
      ['[data-testid="trend"]', 'side.trends'],
      ['[data-testid="pill-contents-container"]', 'side.live'],
    ] as const;

    const actual = cases.map(([part]) => classifySideBlock(fakeBlock({ parts: [part] })));

    assert.deepEqual(actual, cases.map(([, key]) => key));
  });

  it('手がかりが 2 つあるブロックは、2 つ目の手がかりだけでも見分ける', () => {
    const cases = [
      ['[data-testid="radioGroupPeople"]', 'side.filters'],
      ['a[href^="/i/connect_people"]', 'side.follow'],
      ['a[href^="/explore/tabs/"]', 'side.trends'],
    ] as const;

    const actual = cases.map(([part]) => classifySideBlock(fakeBlock({ parts: [part] })));

    assert.deepEqual(actual, cases.map(([, key]) => key));
  });

  it('ニュースの中にライブ放送と同じ部品があっても、ニュースとして扱う', () => {
    const parts = ['[data-testid="pill-contents-container"]', '[data-testid="news_sidebar"]'];

    assert.equal(classifySideBlock(fakeBlock({ parts })), 'side.news');
  });

  it('X が新しいブロックを足したら、見出しの文字で別の項目として扱う', () => {
    assert.equal(classifySideBlock(fakeBlock({ heading: '  新しいブロック ' })), 'side.h:新しいブロック');
  });

  it('設定画面には、見出しの key から取り出した見出しの文字を名前として出す', () => {
    assert.equal(readHeadingTitle(buildHeadingKey('新しいブロック')), '新しいブロック');
    assert.equal(readHeadingTitle('side.news'), null);
  });

  it('検索のページで検索フィルターを隠すと見出しも一緒に隠れ、ほかのブロックの上の見出しは巻き込まない', () => {
    const merged = mergeHeadingBlocks(['side.h:検索フィルター', 'side.filters', 'side.h:別の見出し', 'side.news']);

    assert.deepEqual(merged, ['side.filters', 'side.filters', 'side.h:別の見出し', 'side.news']);
  });

  it('検索ボックスの下の中身の無い要素は、余白として扱う', () => {
    assert.equal(classifySideBlock(fakeBlock({ text: '  ' })), SPACER_KEY);
  });

  it('見出しも手がかりも無いブロックには印を付けない（隠せないが、誤って隠すこともない）', () => {
    assert.equal(classifySideBlock(fakeBlock()), null);
  });
});

describe('表示・非表示の設定', () => {
  it('切り替えた項目だけが変わり、ほかの項目は初期設定のまま', () => {
    const stored = { hidden: { 'nav.grok': false, 'nav.home': true } };

    assert.deepEqual(
      ['nav.grok', 'nav.home', 'nav.premium', 'nav.explore'].map((key) => resolveHidden(stored, key)),
      [false, true, true, false],
    );
  });

  it('検索ボックスを隠すと、その下の余白も一緒に隠れる', () => {
    assert.equal(resolveHidden({}, SPACER_KEY), false);
    assert.equal(resolveHidden({ hidden: { 'side.search': true } }, SPACER_KEY), true);
  });

  it('リセットすると隠す設定と並べ方が初期設定に戻り、見つけた項目の記録は残る', () => {
    const stored = {
      hidden: { 'nav.grok': false, 'nav.home': true },
      layout: { widen: true, promote: false },
      seen: { 'nav.href:/i/bookmarks': { label: 'ブックマーク' } },
    };

    // 設定画面のリセットは hidden と layout を消す。storage.onChanged には newValue の無い変更として届く
    const reset = applyStorageChanges(stored, { hidden: {}, layout: {} });

    assert.deepEqual(
      ['nav.grok', 'nav.home'].map((key) => resolveHidden(reset, key)),
      [true, false],
    );
    assert.deepEqual(resolveLayout(reset), { widen: false, promote: true });
    assert.deepEqual(reset.seen, stored.seen);
  });
});

describe('「もっと見る」から左メニューへ移す', () => {
  const moreItems: MoreItem[] = [
    { key: 'more.communities', href: '/u/communities', order: 1 },
    { key: 'more.lists', href: '/u/lists', order: 0 },
    { key: 'more.notes', href: '/i/communitynotes', order: 2 },
  ];

  it('左メニューを 2 つ隠すと、「もっと見る」の上から 2 つが移る', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.home', 'nav.grok', 'nav.premium'],
      moreItems,
      navHrefs: new Set(),
      isHidden: hiddenOf('nav.grok', 'nav.premium'),
    });

    assert.deepEqual(promotions.map((item) => item.key), ['more.lists', 'more.communities']);
  });

  it('ポストするボタン・アカウント切り替え・もっと見るを隠しても、何も移らない', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.more', 'nav.post', 'nav.account'],
      moreItems,
      navHrefs: new Set(),
      isHidden: hiddenOf('nav.more', 'nav.post', 'nav.account'),
    });

    assert.deepEqual(promotions, []);
  });

  it('隠す設定でも、そのアカウントの画面に無い項目は数えない', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.home'],
      moreItems,
      navHrefs: new Set(),
      isHidden: hiddenOf('nav.calls'),
    });

    assert.deepEqual(promotions, []);
  });

  it('「もっと見る」の中で隠した項目は移さず、次の項目を移す', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.grok'],
      moreItems,
      navHrefs: new Set(),
      isHidden: hiddenOf('nav.grok', 'more.lists'),
    });

    assert.deepEqual(promotions.map((item) => item.key), ['more.communities']);
  });

  it('X が自分で左メニューに出した項目は、二重に移さない', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.grok'],
      moreItems,
      navHrefs: new Set(['/u/lists']),
      isHidden: hiddenOf('nav.grok'),
    });

    assert.deepEqual(promotions.map((item) => item.key), ['more.communities']);
  });

  it('隠した数が「もっと見る」の項目より多ければ、全部移して終わる', () => {
    const promotions = computePromotions({
      presentNavKeys: ['nav.home', 'nav.explore', 'nav.grok', 'nav.premium'],
      moreItems,
      navHrefs: new Set(),
      isHidden: hiddenOf('nav.home', 'nav.explore', 'nav.grok', 'nav.premium'),
    });

    assert.deepEqual(promotions.map((item) => item.key), ['more.lists', 'more.communities', 'more.notes']);
  });
});

describe('タイムラインを広げる', () => {
  const layout = { widen: true };

  it('右サイドバーのブロックが 1 つでも表示のままなら広げない', () => {
    const widen = shouldWiden({
      layout,
      presentSideKeys: ['side.news', 'side.trends'],
      isHidden: hiddenOf('side.news'),
    });

    assert.equal(widen, false);
  });

  it('最後の 1 つを隠すと広げる。余白が残っていても構わない', () => {
    const widen = shouldWiden({
      layout,
      presentSideKeys: ['side.news', SPACER_KEY],
      isHidden: hiddenOf('side.news'),
    });

    assert.equal(widen, true);
  });

  it('右サイドバーの読み込み中（余白しか無い）には広げない', () => {
    const widen = shouldWiden({ layout, presentSideKeys: [SPACER_KEY], isHidden: () => true });

    assert.equal(widen, false);
  });
});

describe('見つけた項目の保存', () => {
  it('content script の記録を重ねると、同じ項目は手元の記録になり、手元に無い項目は保存値のまま残る', () => {
    const latest = {
      seen: {
        'more.lists': { label: 'リスト', order: 0 },
        'nav.href:/i/bookmarks': { label: 'ブックマーク', new: false },
      },
      status: { ranAt: 1 },
    };
    const pending = { seen: { 'more.lists': { label: 'リスト', order: 1 } }, status: { ranAt: 2 } };

    assert.deepEqual(mergePendingRecords(latest, pending), {
      seen: {
        'more.lists': { label: 'リスト', order: 1 },
        'nav.href:/i/bookmarks': { label: 'ブックマーク', new: false },
      },
      status: { ranAt: 2 },
    });
  });

  it('設定画面が新規の印を外した項目は、手元の古い記録が印を持っていても印を戻さない', () => {
    const latest = { seen: { 'nav.href:/i/bookmarks': { label: 'ブックマーク', new: false } } };
    const pending = { seen: { 'nav.href:/i/bookmarks': { label: 'ブックマーク', new: true } }, status: {} };

    assert.deepEqual(mergePendingRecords(latest, pending).seen, {
      'nav.href:/i/bookmarks': { label: 'ブックマーク', new: false },
    });
  });

  it('見つけた項目だけを保存するとき（動いた時刻は保存済み）は、保存値の動いた時刻を消さない', () => {
    const pending = { seen: { 'more.lists': { order: 0 } }, status: {} };

    assert.deepEqual(mergePendingRecords({ status: { ranAt: 1 } }, pending).status, { ranAt: 1 });
  });

  it('初めて保存するとき（保存値が空）は、手元の記録がそのまま入る', () => {
    const pending = { seen: { 'more.lists': { order: 0 } }, status: { ranAt: 1 } };

    assert.deepEqual(mergePendingRecords({}, pending), pending);
  });

  it('設定画面を開いて新規の印を外しても、名前とほかの項目は保存値のまま残る', () => {
    const seen = {
      'nav.href:/i/bookmarks': { label: 'ブックマーク', new: true },
      'side.h:新しいブロック': { new: true },
    };

    assert.deepEqual(clearNewMarks(seen, ['nav.href:/i/bookmarks']), {
      'nav.href:/i/bookmarks': { label: 'ブックマーク', new: false },
      'side.h:新しいブロック': { new: true },
    });
  });

  it('新規の印を外す項目が保存値に無ければ、項目を作らない', () => {
    assert.deepEqual(clearNewMarks({}, ['nav.href:/i/bookmarks']), {});
  });
});

describe('隠すための CSS', () => {
  it('見出しに引用符や改行が入っていても、CSS が壊れない', () => {
    assert.equal(
      buildHiddenCss(['side.h:a"b\\c\nd\r\ne\ff']),
      '[data-xlt="side.h:a\\"b\\\\c\\a d\\d \\a e\\c f"]{display:none!important}',
    );
  });
});

describe('設定画面の右サイドバーの欄', () => {
  it('見分けられるブロックは、どれも画面の並びの中に 1 回ずつ出る', () => {
    const blockKeys = SIDE_BLOCKS.map((block) => block.key).sort();

    assert.deepEqual([...SIDE_DISPLAY_ORDER].sort(), blockKeys);
  });
});

describe('設定画面の項目名', () => {
  it('組み込みの項目は、日本語と英語のどちらの画面でも名前が出る', () => {
    const ja = readMessages('ja');
    const en = readMessages('en');
    const names = BUILTIN_ITEMS.map((item) => buildMessageName(item.key));

    assert.deepEqual(names.filter((name) => !ja[name] || !en[name]), []);
  });
});

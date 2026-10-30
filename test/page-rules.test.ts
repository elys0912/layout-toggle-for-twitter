// x.com の画面の手がかりの表（項目の見分け方・key の作り方）を、X の画面の場面と境目の値で確かめる。
// X が画面を変えて page-rules.ts を直したら、このファイルを直す。DOM は使わず、判定が使う分だけを持つ偽の要素で試す

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  BUILTIN_ITEMS,
  MORE_ITEMS,
  NAV_ITEMS,
  SIDE_BLOCKS,
  SIDE_DISPLAY_ORDER,
  SPACER_KEY,
  buildHeadingKey,
  buildUnknownLinkKey,
  classifySideBlock,
  identifyLink,
  mergeHeadingBlocks,
  readHeadingTitle,
} from '../src/page-rules.ts';
import type { QueryableBlock } from '../src/page-rules.ts';
import { buildMessageName } from '../src/registry.ts';

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

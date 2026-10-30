// 「もっと見る」から左メニューへ移す項目を、左メニューの既存の項目を複製して作る。
// 複製には data-xlt-clone を付け、印付けと移す数の計算から外す。

import { CLONE_TEMPLATE_SELECTOR, MORE_BUTTON_SELECTOR } from '../registry.ts';
import type { MoreItem } from '../registry.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 複製の元にする左メニューの項目。中身の作りが素直な「話題を検索」を優先する */
function pickTemplate(nav: Element): HTMLElement | null {
  return nav.querySelector<HTMLElement>(`:scope > ${CLONE_TEMPLATE_SELECTOR}`)
    ?? nav.querySelector<HTMLElement>(':scope > a[data-testid^="AppTabBar_"]');
}

/** アイコンを差し替える。アイコンの形を記録できていなければ、複製元のアイコンのまま残す */
function replaceIcon(clone: Element, iconPaths: readonly string[]): void {
  const svg = clone.querySelector('svg');
  if (!svg || iconPaths.length === 0) return;

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
function navigateWithinApp(event: MouseEvent, href: string): void {
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
  clone.addEventListener('click', (event) => navigateWithinApp(event, item.href));

  return clone;
}

/** 複製の中身を表す文字列。表示の言語を変えると名前が変わるので、key だけでなく名前・リンク先・アイコンも含める */
function buildCloneSignature(item: MoreItem): string {
  return JSON.stringify([item.key, item.label ?? '', item.href, item.iconPaths ?? []]);
}

/** 複製を、移す項目の並びと中身に合わせる。どちらも変わっていなければ触らない */
export function syncClones(nav: Element, promotions: readonly MoreItem[]): void {
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

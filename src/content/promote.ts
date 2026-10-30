// 「もっと見る」から左メニューへ移す項目を決め、複製を置き、メニューの中の元の項目に印を付ける。

import { PROMOTED_ATTRIBUTE, buildKeyPrefix, computePromotions, isKeyInSection, resolveLayout } from '../registry.ts';
import type { MoreItem } from '../registry.ts';
import { CLONE_ATTRIBUTE, syncClones } from './clone.ts';
import { readSeen } from './seen-store.ts';
import { getStored, isHidden } from './state.ts';

function listMoreItems(): MoreItem[] {
  return Object.entries(readSeen()).flatMap(([key, entry]) => {
    if (!isKeyInSection(key, 'more') || !entry.href) return [];

    return [{ key, href: entry.href, order: entry.order ?? 0, label: entry.label, iconPaths: entry.iconPaths }];
  });
}

/** 移す項目の複製を左メニューに置き、移した項目の key を返す */
export function applyPromotions(nav: Element, presentNavKeys: readonly string[]): string[] {
  const navHrefs = new Set(
    [...nav.querySelectorAll(`:scope > a[href]:not([${CLONE_ATTRIBUTE}])`)]
      .map((element) => element.getAttribute('href'))
      .filter((href): href is string => href !== null),
  );
  const promotions = resolveLayout(getStored()).promote
    ? computePromotions({ presentNavKeys, moreItems: listMoreItems(), navHrefs, isHidden })
    : [];

  syncClones(nav, promotions);

  return promotions.map((item) => item.key);
}

/** 移した項目の、メニューの中の元の項目に印を付ける */
export function markPromotedInMenu(promotedKeys: readonly string[]): void {
  for (const element of document.querySelectorAll<HTMLElement>(`#layers [data-xlt^="${buildKeyPrefix('more')}"]`)) {
    const isPromoted = promotedKeys.includes(element.dataset.xlt ?? '');
    element.toggleAttribute(PROMOTED_ATTRIBUTE, isPromoted);
  }
}

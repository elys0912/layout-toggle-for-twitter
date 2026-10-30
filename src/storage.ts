// storage.local の書き方。seen は content script と設定画面の両方が書くので、
// 手元の写しで上書きせず、書く直前に読み直した値に変更を重ねる。

import { toStoredState } from './registry.ts';
import type { StoredState } from './registry.ts';

/** names の項目を storage.local から読み直し、update が返した値を書く */
export async function updateStoredState(
  names: readonly (keyof StoredState)[],
  update: (latest: StoredState) => StoredState,
): Promise<void> {
  const latest = toStoredState(await browser.storage.local.get([...names]));

  await browser.storage.local.set({ ...update(latest) });
}

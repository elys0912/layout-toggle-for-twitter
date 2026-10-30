// content script が持つ storage.local の写し。起動時と storage.onChanged のたびに置き換える。

import { resolveHidden } from '../registry.ts';
import type { StoredState } from '../registry.ts';

let stored: StoredState = {};

export function getStored(): StoredState {
  return stored;
}

export function replaceStored(next: StoredState): void {
  stored = next;
}

export function isHidden(key: string): boolean {
  return resolveHidden(stored, key);
}

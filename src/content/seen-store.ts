// x.com で見つけた項目（seen）と、x.com で動いた時刻（status）を、まとめて storage.local に保存する。
// 保存を待っている記録も readSeen で読めるので、保存の前から移す項目の計算に使える。

import { isBuiltinKey, mergePendingRecords } from '../registry.ts';
import type { PendingRecords, SeenEntry } from '../registry.ts';
import { updateStoredState } from '../storage.ts';
import { getStored } from './state.ts';

// 見つけた項目をまとめて保存するまでの待ち時間。X の描き直しのたびに書き込まないため
const SAVE_DELAY_MS = 1000;

// 保存に失敗したときに送り直すまでの待ち時間と、続けて送り直す回数の上限。
// 上限に達したら送り直しをやめ、次に記録が増えたときの保存に任せる。storage が壊れたときに書き続けないため
const SAVE_RETRY_DELAY_MS = 10_000;
const MAX_SAVE_RETRIES = 3;

const pending: PendingRecords = { seen: {}, status: {} };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// savePending が storage の読み書きを待っている間は true。保存を 2 本並べて走らせないため
let isSaving = false;
// 続けて失敗した回数。保存に成功したら 0 に戻す
let consecutiveSaveFailures = 0;

/** 保存済みの記録に、保存を待っている記録を重ねたもの */
export function readSeen(): Record<string, SeenEntry> {
  return { ...getStored().seen, ...pending.seen };
}

export function recordSeen(key: string, entry: SeenEntry): void {
  const known = readSeen()[key];
  // 組み込みの項目は設定画面に最初から並ぶので、新規の印を付けない
  const isNew = !known && !isBuiltinKey(key);
  const merged: SeenEntry = { ...known, ...entry, ...(isNew ? { new: true } : {}) };
  if (known && JSON.stringify(known) === JSON.stringify(merged)) return;

  pending.seen[key] = merged;
  scheduleSave();
}

/**
 * x.com で動いた時刻を記録する。
 * permissions.contains は、x.com で動いているのに false を返した（2026-10-29）。
 * そのため、x.com で実際に動いた時刻を設定画面に渡す
 */
export function recordRun(): void {
  pending.status = { ...pending.status, ranAt: Date.now() };
  scheduleSave();
}

function scheduleSave(delayMs: number = SAVE_DELAY_MS): void {
  if (saveTimer !== null) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    // 前の保存が終わっていなければ、同じ待ち時間の後に回す
    if (isSaving) {
      scheduleSave(delayMs);
      return;
    }

    void savePending();
  }, delayMs);
}

/**
 * 記録を保存する。保存に失敗した記録は手元に残し、SAVE_RETRY_DELAY_MS ごとに MAX_SAVE_RETRIES 回まで送り直す。
 * 送り直しをやめた後も、次に記録が増えたときに一緒に保存する。
 * 保存を待つ間に増えた・変わった記録も手元に残す
 */
async function savePending(): Promise<void> {
  const toSave: PendingRecords = { seen: { ...pending.seen }, status: pending.status };

  isSaving = true;
  try {
    await updateStoredState(['seen', 'status'], (latest) => mergePendingRecords(latest, toSave));
  } catch (error) {
    console.warn('Layout Toggle for Twitter: 見つけた項目を保存できなかった', error);
    consecutiveSaveFailures += 1;
    const canRetry = consecutiveSaveFailures <= MAX_SAVE_RETRIES;
    if (canRetry) scheduleSave(SAVE_RETRY_DELAY_MS);
    return;
  } finally {
    isSaving = false;
  }

  consecutiveSaveFailures = 0;

  // recordSeen・recordRun は記録を変えるたびに新しいオブジェクトを入れるので、同じオブジェクトなら保存済み
  for (const [key, entry] of Object.entries(toSave.seen)) {
    if (pending.seen[key] === entry) delete pending.seen[key];
  }
  if (pending.status === toSave.status) pending.status = {};
}

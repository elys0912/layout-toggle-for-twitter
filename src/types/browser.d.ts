// この拡張が使う Firefox の browser.* API だけの型宣言。
// @types/firefox-webext-browser は使わない。使う API が少なく、依存を増やさないため

declare namespace browser {
  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }

    const local: StorageArea;

    const onChanged: {
      addListener(callback: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    };
  }

  namespace i18n {
    function getMessage(messageName: string): string;
    function getUILanguage(): string;
  }
}

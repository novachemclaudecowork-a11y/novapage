/**
 * 詢價清單。
 *
 * 靜態網站沒有後端，清單存在瀏覽器的 localStorage，
 * 送出時才透過表單服務寄到公司信箱。
 * localStorage 在無痕視窗或封鎖站台資料時可能讀寫失敗，故全部包在 try/catch，
 * 失敗時視為空清單，不讓整頁壞掉。
 */
const KEY = 'novachem.inquiry.v1';

export interface InquiryItem {
  slug: string;
  name: string;
  code: string;
}

export function getItems(): InquiryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: InquiryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 無痕模式或站台資料被封鎖：略過儲存，當次瀏覽仍可運作
  }
  window.dispatchEvent(new CustomEvent('inquiry:change'));
}

export function countItems(): number {
  return getItems().length;
}

export function hasItem(slug: string): boolean {
  return getItems().some((i) => i.slug === slug);
}

export function addItem(item: InquiryItem): void {
  const items = getItems();
  if (items.some((i) => i.slug === item.slug)) return;
  save([...items, item]);
}

export function removeItem(slug: string): void {
  save(getItems().filter((i) => i.slug !== slug));
}

export function clearItems(): void {
  save([]);
}

/**
 * 網站資料來源。
 *
 * 所有產品與分類資料都讀自專案根目錄的 content/，那是後台唯一會寫入的地方。
 * site-mirror/ 與 scripts/extract_products.py 等只是當初從舊站匯入的工具，
 * 不參與日常建置，請勿再從那裡取資料。
 */
import categoriesData from '../../content/categories.json';
import productsData from '../../content/products.json';
import aboutData from '../../content/about.json';

export interface Subcategory {
  slug: string;
  name: string;
  order: number;
  published: boolean;
  legacy_m2: string;
  /** 由產品資料推算，非儲存欄位 */
  productCount?: number;
}

export interface Category {
  slug: string;
  name: string;
  order: number;
  published: boolean;
  legacy_m: string;
  children: Subcategory[];
}

export interface ProductDocument {
  /** 例如「安全資料表」「產品說明書」 */
  label: string;
  /** 檔案路徑，例如 /documents/cw-waterbased-sds.pdf */
  file: string;
}

export interface Product {
  slug: string;
  name: string;
  code: string;
  category: string;
  subcategory: string | null;
  published: boolean;
  order: number;
  images: string[];
  documents: ProductDocument[];
  spec_html: string;
  legacy: { m: string; pg: number };
}

// 所有產品放在同一個檔案裡。
// 這樣後台只需一次讀取、一次寫入，不會受 Cloudflare 的子請求數量限制，
// 也不會出現部分產品存檔成功、部分失敗的情況。
const allProducts: Product[] = (productsData as Product[])
  .slice()
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));

const allCategories = (categoriesData as Category[])
  .slice()
  .sort((a, b) => a.order - b.order);

/** 網站上實際顯示的產品（已上架者） */
export const products: Product[] = allProducts.filter((p) => p.published);

/** 含已下架者。轉址與後台需要完整清單。 */
export const productsIncludingUnpublished: Product[] = allProducts;

export const categories: Category[] = allCategories
  .filter((c) => c.published)
  .map((c) => ({
    ...c,
    children: c.children
      .filter((s) => s.published)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        productCount: products.filter((p) => p.subcategory === s.slug).length,
      })),
  }));

export const about = aboutData as { title: string; body: string };

export const company = {
  nameZh: '貝星貿易股份有限公司',
  nameEn: 'NOVACHEM TRADING CO., LTD.',
  address: '242 台灣新北市新莊區五權一路九號 8 樓之 1',
  tel: '+886-2-2299-4000',
  telHref: '+886222994000',
  fax: '+886-2-2299-4263',
  email: 'novachem@ms24.hinet.net',
  founded: 1988,
  tagline: '專營網印油墨、製版資材、洗版劑',
  description:
    '成立於 1988 年，提供絲網印刷油墨、感光乳劑及相關週邊網印商品，' +
    '並擁有自主研發能力。全系列產品符合 RoHS、REACH、TSCA 等規範。',
} as const;

export const mainNav = [
  { label: '首頁', href: '/' },
  { label: '公司簡介', href: '/about/' },
  { label: '產品介紹', href: '/products/' },
  { label: '最新訊息', href: '/news/' },
  { label: '技術支援', href: '/support/' },
  { label: '聯絡我們', href: '/contact/' },
] as const;

/** 由 spec_html 取出純文字，供 meta description 與站內搜尋使用 */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function productsOf(categorySlug: string): Product[] {
  return products.filter((p) => p.category === categorySlug);
}

export function categoryOf(product: Product): Category | undefined {
  return categories.find((c) => c.slug === product.category);
}

export function subcategoryOf(product: Product): Subcategory | undefined {
  if (!product.subcategory) return undefined;
  return categories.flatMap((c) => c.children).find((s) => s.slug === product.subcategory);
}

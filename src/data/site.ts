import catalog from './catalog.json';
import pages from './pages.json';

export interface Subcategory {
  name: string;
  slug: string;
  legacy_m2: string;
  legacy_pd_type: string;
  product_count: number;
}

export interface Category {
  name: string;
  slug: string;
  legacy_m: string;
  legacy_pd_type: string;
  children: Subcategory[];
  note?: string;
}

export interface Product {
  slug: string;
  name: string;
  code: string;
  spec_html: string;
  spec_text: string;
  images: string[];
  category: string;
  subcategory: string | null;
  legacy: { m: string; pg: number };
}

export const categories = catalog.categories as Category[];
export const products = catalog.products as Product[];

export const company = {
  nameZh: '貝星貿易股份有限公司',
  nameEn: 'NOVACHEM TRADING CO., LTD.',
  address: '242 台灣新北市新莊區五權一路九號 8 樓之 1',
  tel: '+886-2-2299-4000',
  telHref: '+886222994000',
  fax: '+886-2-2299-4263',
  email: 'novachem@ms24.hinet.net',
  founded: 1988,
  tagline: '專營網印油墨、製版資材、筆墨水、洗版劑',
  description:
    '成立於 1988 年，提供絲網印刷油墨、感光乳劑及相關週邊網印商品，' +
    '並擁有自主研發能力。全系列產品符合 RoHS、REACH、TSCA 等規範。',
} as const;

export const staticPages = pages as Record<
  string,
  { title: string; nav: string; html?: string; text?: string; missing?: boolean }
>;

export const mainNav = [
  { label: '首頁', href: '/' },
  { label: '公司簡介', href: '/about/' },
  { label: '產品介紹', href: '/products/' },
  { label: '最新訊息', href: '/news/' },
  { label: '技術支援', href: '/support/' },
  { label: '聯絡我們', href: '/contact/' },
] as const;

/** 舊站的產品照路徑（/upload/1/126-1b.jpg?t=…）轉為新站路徑 */
export function imageUrl(src: string): string {
  const clean = src.split('?')[0].replace(/^\/upload\//, '');
  return `/images/products/${clean}`;
}

export function productsOf(categorySlug: string): Product[] {
  return products.filter((p) => p.category === categorySlug);
}

export function categoryOf(product: Product): Category | undefined {
  return categories.find((c) => c.slug === product.category);
}

export function subcategoryOf(product: Product): Subcategory | undefined {
  if (!product.subcategory) return undefined;
  return categories
    .flatMap((c) => c.children)
    .find((s) => s.slug === product.subcategory);
}

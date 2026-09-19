// 公司基本資料。
// 目前取自公開網站資訊，待鏡像檔取得後需逐項核對確認。
export const company = {
  nameZh: '貝星貿易股份有限公司',
  nameEn: 'NOVACHEM TRADING CO., LTD.',
  address: '242 新北市新莊區五權一路 9 號 8 樓之 1',
  tel: '+886-2-2299-4000',
  fax: '+886-2-2299-4263',
  email: 'novachem@ms24.hinet.net',
  tagline: '專營網印油墨、製版資材、筆墨水、洗版劑',
} as const;

// 四大產品線。分類 ID 對應舊站的 m 參數，供 301 轉址對照使用。
// 實際的次分類與產品清單待鏡像檔分析後補齊。
export const categories = [
  { slug: 'screen-inks',  legacyM: 1, nameZh: '網印油墨' },
  { slug: 'cleaners',     legacyM: 2, nameZh: '洗版劑・稀釋劑' },
  { slug: 'pen-inks',     legacyM: 3, nameZh: '筆墨水' },
  { slug: 'platemaking',  legacyM: 4, nameZh: '製版資材' },
] as const;

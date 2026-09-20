/**
 * 建置環境判定。
 *
 * 只有在部署平台明確設定 SITE_ENV=production 時才視為正式站。
 * 採「預設不是正式站」的保守做法：忘記設定的後果是預覽站不被索引（無害），
 * 而相反的預設會讓預覽站被 Google 收錄並與舊站打架（有害）。
 */
export const isProduction = import.meta.env.SITE_ENV === 'production';

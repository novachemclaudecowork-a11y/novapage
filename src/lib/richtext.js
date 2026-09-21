/**
 * 內文的呈現方式。
 *
 * 後台的每一則訊息、每一項產品說明都各自記著它是用哪種格式寫的：
 *   html      —— 直接就是網頁原始碼（舊站匯入的資料都是這種）
 *   markdown  —— 用 Markdown 寫，顯示前才轉成 HTML
 *
 * 前台頁面與後台的即時預覽都呼叫這裡，兩邊才會長得一樣；
 * 任何一邊自己另外寫一套轉換，遲早會對不起來。
 */
import { marked } from 'marked';

marked.setOptions({
  // 單一換行就換行。使用者在輸入框按 Enter 時的預期就是這樣，
  // 而不是 Markdown 原本「要空一行才算換段」的規則。
  breaks: true,
  gfm: true,
});

/** @typedef {'html' | 'markdown'} BodyFormat */

/** 沒有記錄格式的舊資料一律當成 HTML */
export function normalizeFormat(format) {
  return format === 'markdown' ? 'markdown' : 'html';
}

/**
 * 轉成可以直接放進頁面的 HTML。
 * @param {string} source 使用者寫的原始內容
 * @param {BodyFormat} format
 */
export function renderBody(source, format) {
  if (!source) return '';
  if (normalizeFormat(format) === 'markdown') return marked.parse(source);
  return source;
}

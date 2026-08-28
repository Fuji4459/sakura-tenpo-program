/**
 * SAKURA店舗伝票 - Google Sheets backend
 *
 * 使い方:
 * 1. Googleスプレッドシートを1つ作成
 * 2. 拡張機能 > Apps Script を開く
 * 3. このコードを貼り付け
 * 4. 下の CONFIG.API_KEY を長いランダム文字列に変更
 * 5. setup() を1回実行して権限を許可
 * 6. デプロイ > 新しいデプロイ > ウェブアプリ
 *    実行するユーザー: 自分
 *    アクセスできるユーザー: 全員
 * 7. /exec URLをSAKURA店舗伝票の「Google保存設定」に入力
 *
 * セキュリティ:
 * - API_KEYは必ず変更してください。
 * - WebアプリURLと店舗キーは第三者に公開しないでください。
 */

const CONFIG = {
  SPREADSHEET_ID: "", // このスクリプトをスプレッドシートに紐付けた場合は空欄のままでOK
  API_KEY: "CHANGE_THIS_TO_A_LONG_RANDOM_STORE_KEY"
};

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  return json_({
    ok: true,
    app: "SAKURA店舗伝票",
    message: "Google保存サーバーは稼働しています。",
    time: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const raw = e && e.parameter && e.parameter.payload;
    if (!raw) return json_({ok:false, error:"payloadがありません"});

    const data = JSON.parse(raw);
    if (String(data.apiKey || "") !== String(CONFIG.API_KEY)) {
      return json_({ok:false, error:"店舗キーが正しくありません"});
    }
    if (!Array.isArray(data.sales)) {
      return json_({ok:false, error:"salesが配列ではありません"});
    }

    const sales = data.sales.map(normalizeSale_);
    saveAll_(sales);

    return json_({
      ok:true,
      count:sales.length,
      updatedAt:new Date().toISOString()
    });
  } catch (err) {
    console.error(err);
    return json_({ok:false, error:String(err)});
  }
}

function setup() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, "売上データ", [
    "売上ID","日付","日時","お客様名","小計","消費税","合計金額","精算金額","明細JSON","更新日時"
  ]);
  ensureSheet_(ss, "日別集計", [
    "日付","伝票数","小計","消費税","売上合計"
  ]);
  ensureSheet_(ss, "月別集計", [
    "月","伝票数","小計","消費税","売上合計","営業日数","1日平均"
  ]);
  return "setup completed";
}

function saveAll_(sales) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet_();
    setup();

    const salesSheet = ss.getSheetByName("売上データ");
    const dailySheet = ss.getSheetByName("日別集計");
    const monthlySheet = ss.getSheetByName("月別集計");

    // 売上データを全件置換。編集・削除・復元も常に正しく反映できます。
    const rows = [
      ["売上ID","日付","日時","お客様名","小計","消費税","合計金額","明細JSON","更新日時"]
    ];
    sales.forEach(s => {
      rows.push([
        s.id,
        s.date,
        s.timestamp ? new Date(s.timestamp) : "",
        s.customer,
        s.subtotal,
        s.tax,
        s.total,
        s.settlementAmount,
        JSON.stringify(s.items || []),
        s.updatedAt ? new Date(s.updatedAt) : ""
      ]);
    });
    replaceSheet_(salesSheet, rows);

    const daily = {};
    sales.forEach(s => {
      const date = s.date || "";
      if (!daily[date]) daily[date] = {count:0, subtotal:0, tax:0, total:0};
      daily[date].count++;
      daily[date].subtotal += Number(s.subtotal)||0;
      daily[date].tax += Number(s.tax)||0;
      daily[date].total += Number(s.total)||0;
    });

    const dailyRows = [["日付","伝票数","小計","消費税","売上合計"]];
    Object.keys(daily).sort().forEach(date => {
      const d = daily[date];
      dailyRows.push([date,d.count,d.subtotal,d.tax,d.total]);
    });
    replaceSheet_(dailySheet, dailyRows);

    const monthly = {};
    sales.forEach(s => {
      const month = String(s.date || "").slice(0,7);
      if (!monthly[month]) monthly[month] = {
        count:0, subtotal:0, tax:0, total:0, dates:{}
      };
      const m = monthly[month];
      m.count++;
      m.subtotal += Number(s.subtotal)||0;
      m.tax += Number(s.tax)||0;
      m.total += Number(s.total)||0;
      m.dates[s.date] = true;
    });

    const monthlyRows = [["月","伝票数","小計","消費税","売上合計","営業日数","1日平均"]];
    Object.keys(monthly).sort().forEach(month => {
      const m = monthly[month];
      const days = Object.keys(m.dates).length;
      monthlyRows.push([
        month,m.count,m.subtotal,m.tax,m.total,days,
        days ? Math.floor(m.total/days) : 0
      ]);
    });
    replaceSheet_(monthlySheet, monthlyRows);
  } finally {
    lock.releaseLock();
  }
}

function normalizeSale_(s) {
  const items = Array.isArray(s.items) ? s.items.map(i => ({
    name: String(i.name || ""),
    price: Math.max(0, Number(i.price)||0),
    qty: Math.max(1, Number(i.qty)||1)
  })) : [];
  const subtotal = items.reduce((sum,i)=>sum+i.price*i.qty,0);
  const tax = Math.floor(subtotal * 0.10);
  const calculatedTotal = subtotal + tax;
  const settlementRaw = Number(s.settlementAmount);
  const total = Number.isFinite(settlementRaw) && settlementRaw >= 0
    ? Math.floor(settlementRaw)
    : calculatedTotal;

  return {
    id: String(s.id || Utilities.getUuid()),
    date: String(s.date || ""),
    timestamp: Number(s.timestamp) || Date.now(),
    customer: String(s.customer || ""),
    items: items,
    subtotal: subtotal,
    tax: tax,
    total: total,
    settlementAmount: total,
    settlementManuallySet: !!s.settlementManuallySet,
    updatedAt: Number(s.updatedAt) || Date.now()
  };
}

function ensureSheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function replaceSheet_(sheet, rows) {
  sheet.clearContents();
  if (!rows.length) return;
  sheet.getRange(1,1,rows.length,rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
  if (sheet.getLastColumn() >= 1) {
    sheet.getRange(1,1,1,sheet.getLastColumn()).setFontWeight("bold");
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

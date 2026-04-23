# 每月採買紀錄

## 本地開發

```bash
npm install
npm run dev
```

開啟 http://localhost:5173

## 部署到 Vercel

1. 推上 GitHub
2. 在 vercel.com 匯入此 repo
3. Framework: Vite（自動偵測）
4. 點 Deploy

## Google Sheets 設定

Apps Script URL 已內建於 `src/App.jsx` 的 `SCRIPT_URL` 變數。

若需更換，修改第 3 行：
```js
const SCRIPT_URL = "https://script.google.com/macros/s/YOUR_ID/exec";
```

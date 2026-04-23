function doGet(e) {
  // 加在最前面
  if (e.parameter.method === "OPTIONS") return respond({ok:true});
  // ... 其餘原本的程式碼
}
import { useState, useMemo, useEffect, useCallback, useRef } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzl6WOdMDhXw2qh3h3joktXOqrlptl3fzTtNxLuLPdiGhly6MZij90cNYyUmd8BvSb_Bw/exec";

const now = new Date();
const todayStr = now.toISOString().slice(0, 10);
const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

function genMonths() {
  const out = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ ym, label: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` });
  }
  return out;
}
const MONTHS = genMonths();

// ── Export helpers ─────────────────────────────────────────
function toCSV(rows) {
  const header = "日期,項目,單位,金額,備註";
  const body = rows.map(e =>
    [e.date, e.item, e.unit || "", e.amount, e.note || ""]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return "\uFEFF" + [header, ...body].join("\n");
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV(entries, label) {
  downloadBlob(toCSV(entries), `採買紀錄_${label}.csv`, "text/csv;charset=utf-8;");
}

function exportXLSX(entries, label) {
  if (typeof window.XLSX === "undefined") {
    alert("XLSX 函式庫載入中，請稍後再試或改用 CSV。");
    return;
  }
  const ws = window.XLSX.utils.json_to_sheet(
    entries.map(e => ({ 日期: e.date, 項目: e.item, 單位: e.unit || "", 金額: e.amount, 備註: e.note || "" }))
  );
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "採買紀錄");
  window.XLSX.writeFile(wb, `採買紀錄_${label}.xlsx`);
}

// ── Main App ───────────────────────────────────────────────
export default function App() {
  const [entries, setEntries]       = useState([]);
  const [budget, setBudget]         = useState(4000);
  const [editBudget, setEditBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("4000");
  const [viewMonth, setViewMonth]   = useState(currentYM);
  const [form, setForm]             = useState({ item: "", unit: "", amount: "", note: "", date: todayStr });
  const [editId, setEditId]         = useState(null);
  const [showForm, setShowForm]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [sync, setSync]             = useState({ status: "idle", msg: "" }); // idle|loading|ok|error
  const [toast, setToast]           = useState(null);
  const xlsxLoaded                  = useRef(false);

  // Load SheetJS once
  useEffect(() => {
    if (xlsxLoaded.current) return;
    xlsxLoaded.current = true;
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    document.head.appendChild(s);
  }, []);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Google Sheets API ──────────────────────────────────
  const fetchAll = useCallback(async () => {
    setSync({ status: "loading", msg: "讀取中…" });
    try {
      const res = await fetch(SCRIPT_URL);
      const json = await res.json();
      if (json.ok) {
        setEntries(json.data || []);
        setSync({ status: "ok", msg: `已同步 ${new Date().toLocaleTimeString("zh-TW")}` });
      } else throw new Error(json.error || "未知錯誤");
    } catch (e) {
      setSync({ status: "error", msg: "連線失敗：" + e.message });
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const sheetsPost = useCallback(async (body) => {
    try {
      const res = await fetch(SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      return json;
    } catch (e) {
      showToast("⚠️ 寫入 Sheets 失敗：" + e.message, false);
      return null;
    }
  }, []);

  // ── Derived data ───────────────────────────────────────
  const filtered = useMemo(() =>
    entries.filter(e => e.date?.startsWith(viewMonth))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [entries, viewMonth]
  );

  const monthSpent = filtered.reduce((s, e) => s + Number(e.amount), 0);
  const monthBalance = budget - monthSpent;
  const pct = Math.min((monthSpent / budget) * 100, 100);
  const barColor = pct < 60 ? "#22c55e" : pct < 85 ? "#f59e0b" : "#ef4444";

  const cumulativeBalance = useMemo(() => {
    const months = [...new Set(entries.map(e => e.date?.slice(0, 7)).filter(Boolean))].filter(m => m <= viewMonth);
    if (!months.includes(viewMonth)) months.push(viewMonth);
    return months.reduce((acc, ym) => {
      const s = entries.filter(e => e.date?.startsWith(ym)).reduce((a, e) => a + Number(e.amount), 0);
      return acc + (budget - s);
    }, 0);
  }, [entries, viewMonth, budget]);

  const viewLabel = MONTHS.find(m => m.ym === viewMonth)?.label || viewMonth;

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(e => { if (!map[e.date]) map[e.date] = []; map[e.date].push(e); });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // ── CRUD ──────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.item.trim() || !form.amount || !form.date) {
      showToast("⚠️ 請填寫日期、項目、金額", false); return;
    }
    const amount = Number(form.amount);

    if (editId !== null) {
      const updated = { ...entries.find(e => e.id === editId), ...form, amount };
      setEntries(prev => prev.map(e => e.id === editId ? updated : e));
      setSync({ status: "loading", msg: "儲存中…" });
      const r = await sheetsPost({ action: "update", entry: updated });
      if (r) { showToast("✅ 已更新"); setSync({ status: "ok", msg: "已同步" }); }
      setEditId(null);
    } else {
      const entry = { id: Date.now().toString(), ...form, amount };
      setEntries(prev => [...prev, entry]);
      setSync({ status: "loading", msg: "新增中…" });
      const r = await sheetsPost({ action: "add", entry });
      if (r) { showToast("✅ 已新增"); setSync({ status: "ok", msg: "已同步" }); }
    }
    setForm({ item: "", unit: "", amount: "", note: "", date: todayStr });
    setShowForm(false);
  };

  const handleEdit = (entry) => {
    setForm({ item: entry.item, unit: entry.unit || "", amount: String(entry.amount), note: entry.note || "", date: entry.date });
    setEditId(entry.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setEntries(prev => prev.filter(e => e.id !== deleteTarget.id));
    setDeleteTarget(null);
    setSync({ status: "loading", msg: "刪除中…" });
    const r = await sheetsPost({ action: "delete", id: deleteTarget.id });
    if (r) { showToast("🗑️ 已刪除"); setSync({ status: "ok", msg: "已同步" }); }
  };

  const handleCancel = () => {
    setForm({ item: "", unit: "", amount: "", note: "", date: todayStr });
    setEditId(null); setShowForm(false);
  };

  const saveBudget = () => {
    const v = parseInt(budgetInput);
    if (!isNaN(v) && v > 0) { setBudget(v); showToast(`✅ 預算已更新為 NT$${v.toLocaleString()}`); }
    setEditBudget(false);
  };

  // ── Helpers ────────────────────────────────────────────
  const fmtDate = d => { if (!d) return ""; const [, m, day] = d.split("-"); return `${m}/${day}`; };
  const weekDay = d => { if (!d) return ""; return "週" + ["日","一","二","三","四","五","六"][new Date(d + "T12:00:00").getDay()]; };
  const sign = v => v >= 0 ? "+" : "";
  const col  = v => v >= 0 ? "#22c55e" : "#f87171";

  const syncDotColor = { idle: "#64748b", loading: "#f59e0b", ok: "#22c55e", error: "#f87171" }[sync.status];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a0a1a 0%,#111132 55%,#0a0a1a 100%)", fontFamily: "'Noto Sans TC','Helvetica Neue',sans-serif", color: "#e2e8f0", paddingBottom: 120 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&family=Orbitron:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#4a4a8a;border-radius:2px}
        .erow{transition:background .15s}.erow:hover{background:rgba(255,255,255,.04)}
        .bico{background:none;border:none;cursor:pointer;padding:5px;border-radius:7px;transition:background .15s,transform .12s;display:flex;align-items:center}
        .bico:hover{background:rgba(255,255,255,.09);transform:scale(1.13)}
        .ifield{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.11);border-radius:10px;padding:10px 14px;color:#e2e8f0;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
        .ifield:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.2)}
        .ifield::placeholder{color:rgba(255,255,255,.25)}
        .ifield::-webkit-calendar-picker-indicator{filter:invert(.55);cursor:pointer}
        .abtn{background:linear-gradient(135deg,#4f52d3,#7c3aed);border:none;border-radius:11px;color:#fff;padding:11px 26px;font-size:14px;font-family:inherit;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s;letter-spacing:.3px}
        .abtn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(99,102,241,.5)}
        .cbtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:11px;color:#94a3b8;padding:11px 20px;font-size:14px;font-family:inherit;cursor:pointer;transition:background .15s}
        .cbtn:hover{background:rgba(255,255,255,.11)}
        .fab{background:linear-gradient(135deg,#4f52d3,#7c3aed);border:none;border-radius:50px;color:#fff;padding:13px 26px;font-size:15px;font-family:inherit;font-weight:700;cursor:pointer;transition:transform .15s,box-shadow .15s;display:flex;align-items:center;gap:8px;box-shadow:0 6px 24px rgba(99,102,241,.45)}
        .fab:hover{transform:translateY(-3px);box-shadow:0 10px 32px rgba(99,102,241,.6)}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:200;animation:fadeIn .15s;padding:16px}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulseA{0%,100%{opacity:1}50%{opacity:.35}}
        .fpanel{animation:slideUp .22s cubic-bezier(.23,1.2,.44,1)}
        .mchip{border:none;border-radius:20px;padding:6px 15px;font-size:13px;font-family:inherit;cursor:pointer;transition:all .18s;font-weight:500;white-space:nowrap}
        .mon{background:linear-gradient(135deg,#4f52d3,#7c3aed);color:#fff;box-shadow:0 3px 12px rgba(99,102,241,.4)}
        .moff{background:rgba(255,255,255,.06);color:#94a3b8;border:1px solid rgba(255,255,255,.08)}
        .moff:hover{background:rgba(255,255,255,.11);color:#e2e8f0}
        .mpbtn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:11px 15px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all .16s;font-family:inherit;width:100%;text-align:left}
        .mpbtn:hover{background:rgba(99,102,241,.1);border-color:rgba(99,102,241,.3)}
        .mpbtn-on{background:linear-gradient(135deg,rgba(79,82,211,.25),rgba(124,58,237,.25))!important;border-color:rgba(129,140,248,.5)!important}
        .expbtn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:11px;color:#e2e8f0;padding:12px 20px;font-size:14px;font-family:inherit;cursor:pointer;display:flex;align-items:center;gap:9px;transition:all .16s;font-weight:500;width:100%}
        .expbtn:hover{background:rgba(99,102,241,.18);border-color:rgba(99,102,241,.5);color:#a5b4fc}
        .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999;background:#1e1e4a;border:1px solid rgba(129,140,248,.4);border-radius:50px;padding:10px 22px;font-size:13px;font-weight:600;color:#e2e8f0;box-shadow:0 8px 32px rgba(0,0,0,.5);animation:slideUp .2s;white-space:nowrap}
        .pulse-anim{animation:pulseA 1.2s infinite}
        .modal-box{background:#111132;border:1px solid rgba(129,140,248,.28);border-radius:20px;padding:24px;width:100%;max-width:360px;max-height:82vh;overflow-y:auto}
        .section-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:16px 18px}
        .balance-card{border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px}
        .divline{height:1px;background:rgba(255,255,255,.05)}
      `}</style>

      {/* Toast */}
      {toast && <div className="toast" style={{ borderColor: toast.ok ? "rgba(34,197,94,.4)" : "rgba(248,113,113,.4)" }}>{toast.msg}</div>}

      {/* ── HEADER ── */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 18px 0" }}>

        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 9, letterSpacing: 5, color: "#4f52d3", textTransform: "uppercase", marginBottom: 5 }}>Monthly Shopping Record</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-.3px" }}>每月採買紀錄</h1>
          </div>
          {/* Sync badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: "6px 13px" }}>
            <span className={`${sync.status === "loading" ? "pulse-anim" : ""}`}
              style={{ width: 7, height: 7, borderRadius: 99, background: syncDotColor, display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#64748b", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sync.status === "loading" ? "同步中…" : sync.status === "ok" ? "已連線 Sheets" : sync.status === "error" ? "連線失敗" : "準備中"}
            </span>
            <button onClick={fetchAll} title="重新整理" style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 14, lineHeight: 1, padding: 0 }}>↻</button>
          </div>
        </div>

        {/* Budget editor */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>每月預算</span>
          {editBudget ? (
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#818cf8" }}>NT$</span>
              <input className="ifield" type="number" value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setEditBudget(false); }}
                style={{ width: 130, padding: "7px 12px", fontSize: 15 }} autoFocus />
              <button className="abtn" style={{ padding: "7px 16px", fontSize: 13 }} onClick={saveBudget}>確認</button>
              <button className="cbtn" style={{ padding: "7px 13px", fontSize: 13 }} onClick={() => setEditBudget(false)}>取消</button>
            </div>
          ) : (
            <button onClick={() => { setBudgetInput(String(budget)); setEditBudget(true); }}
              style={{ background: "rgba(79,82,211,.13)", border: "1px solid rgba(99,102,241,.35)", borderRadius: 22, padding: "5px 16px", color: "#a5b4fc", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "'Orbitron',monospace", display: "flex", alignItems: "center", gap: 7 }}>
              NT$ {budget.toLocaleString()}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
        </div>

        {/* Month selector */}
        <div className="section-card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>📅 查詢月份</span>
            <button onClick={() => setShowMonthPicker(true)}
              style={{ background: "rgba(79,82,211,.15)", border: "1px solid rgba(99,102,241,.35)", borderRadius: 20, padding: "3px 13px", color: "#a5b4fc", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              {viewLabel} ▾
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 3, scrollbarWidth: "none" }}>
            {MONTHS.slice(0, 5).map(m => (
              <button key={m.ym} className={`mchip ${viewMonth === m.ym ? "mon" : "moff"}`} onClick={() => setViewMonth(m.ym)}>
                {m.ym === currentYM ? "本月" : `${parseInt(m.ym.split("-")[1])} 月`}
              </button>
            ))}
            <button className="mchip moff" onClick={() => setShowMonthPicker(true)}>更多 ›</button>
          </div>
        </div>

        {/* Summary card */}
        <div className="section-card" style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, letterSpacing: .5 }}>{viewLabel} 採購總覽</div>

          {/* Spent + bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>本月採購支出</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-.5px", fontFamily: "'Orbitron',monospace" }}>
                {monthSpent.toLocaleString()}
                <span style={{ fontSize: 13, color: "#64748b", marginLeft: 4, fontFamily: "inherit", fontWeight: 400 }}>NT$</span>
              </div>
            </div>
            <div style={{ textAlign: "right", paddingBottom: 4 }}>
              <div style={{ fontSize: 10, color: "#64748b" }}>使用率</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: barColor }}>{pct.toFixed(1)}%</div>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 99, height: 8, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg,${barColor},${barColor}99)`, transition: "width .6s cubic-bezier(.23,1,.44,1)", boxShadow: `0 0 12px ${barColor}77` }} />
          </div>

          {/* 本月結餘 + 累計餘額 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="balance-card" style={{ background: "rgba(255,255,255,.04)", borderLeft: `3px solid ${col(monthBalance)}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: col(monthBalance), display: "inline-block" }} />
                <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: .5 }}>本月結餘</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: col(monthBalance), fontFamily: "'Orbitron',monospace" }}>
                {sign(monthBalance)}{Math.abs(monthBalance).toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#475569" }}>
                {monthBalance >= 0 ? `剩 ${((monthBalance / budget) * 100).toFixed(0)}% 預算` : "已超出預算 ⚠️"}
              </div>
            </div>
            <div className="balance-card" style={{ background: "rgba(255,255,255,.04)", borderLeft: `3px solid ${cumulativeBalance >= 0 ? "#818cf8" : "#f87171"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: cumulativeBalance >= 0 ? "#818cf8" : "#f87171", display: "inline-block" }} />
                <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: .5 }}>累計餘額</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: cumulativeBalance >= 0 ? "#a5b4fc" : "#f87171", fontFamily: "'Orbitron',monospace" }}>
                {sign(cumulativeBalance)}{Math.abs(cumulativeBalance).toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: "#475569" }}>截至 {viewLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN content ── */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 18px" }}>

        {/* Export button row */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button onClick={() => setShowExport(true)}
            style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, padding: "6px 16px", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            匯出
          </button>
        </div>

        {/* Add / edit form */}
        {showForm && (
          <div className="fpanel section-card" style={{ border: "1px solid rgba(99,102,241,.35)", marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#a5b4fc", marginBottom: 14 }}>
              {editId ? "✏️ 編輯採購項目" : "🛒 新增採購"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>📅 消費日期 *</label>
                <input className="ifield" type="date" value={form.date} max={todayStr}
                  onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>項目名稱 *</label>
                <input className="ifield" placeholder="例：衛生紙" value={form.item}
                  onChange={e => setForm({ ...form, item: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>單位</label>
                <input className="ifield" placeholder="例：1串、2kg" value={form.unit}
                  onChange={e => setForm({ ...form, unit: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>金額（NT$）*</label>
                <input className="ifield" type="number" placeholder="0" min="0" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 5 }}>備註</label>
                <input className="ifield" placeholder="選填" value={form.note}
                  onChange={e => setForm({ ...form, note: e.target.value })} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="cbtn" onClick={handleCancel}>取消</button>
              <button className="abtn" onClick={handleAdd}>{editId ? "儲存修改" : "新增紀錄"}</button>
            </div>
          </div>
        )}

        {/* Entries table */}
        <div style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 18, overflow: "hidden" }}>

          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 60px 88px 74px 58px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.05)", background: "rgba(255,255,255,.03)" }}>
            {["日期","項目","單位","金額","備註","操作"].map(h => (
              <div key={h} style={{ fontSize: 11, color: "#475569", fontWeight: 600, letterSpacing: .5 }}>{h}</div>
            ))}
          </div>

          {sync.status === "loading" && entries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "52px 0", color: "#475569" }}>
              <div className="pulse-anim" style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
              <div style={{ fontSize: 14 }}>正在從 Google Sheets 讀取資料…</div>
            </div>
          ) : grouped.length === 0 ? (
            <div style={{ textAlign: "center", padding: "52px 0", color: "#475569" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🛒</div>
              <div style={{ fontSize: 14 }}>{viewLabel} 尚無採購紀錄</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "#334155" }}>點擊下方按鈕新增採購</div>
            </div>
          ) : grouped.map(([date, dayEntries]) => (
            <div key={date}>
              {/* Date group header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px 4px", background: "rgba(79,82,211,.06)", borderTop: "1px solid rgba(255,255,255,.04)" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#c7d2fe" }}>{fmtDate(date)}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{weekDay(date)}</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.04)" }} />
                <span style={{ fontSize: 12, color: "#6366f1", fontWeight: 600 }}>
                  小計 NT$ {dayEntries.reduce((s, e) => s + Number(e.amount), 0).toLocaleString()}
                </span>
              </div>
              {dayEntries.map((entry, i) => (
                <div key={entry.id} className="erow" style={{ display: "grid", gridTemplateColumns: "56px 1fr 60px 88px 74px 58px", padding: "11px 14px", borderBottom: i < dayEntries.length - 1 ? "1px solid rgba(255,255,255,.03)" : "none", alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{fmtDate(entry.date)}</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 4 }}>{entry.item}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{entry.unit || "—"}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>
                    <span style={{ fontSize: 9, color: "#475569", marginRight: 1 }}>NT$</span>{Number(entry.amount).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.note || "—"}</div>
                  <div style={{ display: "flex", gap: 1 }}>
                    <button className="bico" onClick={() => handleEdit(entry)} title="編輯">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="bico" onClick={() => setDeleteTarget(entry)} title="刪除">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Footer: totals */}
          {filtered.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(99,102,241,.22)", background: "rgba(79,82,211,.07)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 60px 88px 74px 58px", padding: "11px 14px 7px", alignItems: "center" }}>
                <div style={{ gridColumn: "span 3", fontSize: 12, fontWeight: 700, color: "#a5b4fc", letterSpacing: .5 }}>月採購合計</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#818cf8", fontFamily: "'Orbitron',monospace" }}>
                  {monthSpent.toLocaleString()}
                </div>
                <div style={{ gridColumn: "span 2" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "0 14px 13px", gap: 12 }}>
                <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: "9px 12px", borderLeft: `3px solid ${col(monthBalance)}` }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3, fontWeight: 600 }}>本月結餘</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: col(monthBalance), fontFamily: "'Orbitron',monospace" }}>
                    {sign(monthBalance)}{Math.abs(monthBalance).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: "9px 12px", borderLeft: `3px solid ${cumulativeBalance >= 0 ? "#818cf8" : "#f87171"}` }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3, fontWeight: 600 }}>累計餘額</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: cumulativeBalance >= 0 ? "#a5b4fc" : "#f87171", fontFamily: "'Orbitron',monospace" }}>
                    {sign(cumulativeBalance)}{Math.abs(cumulativeBalance).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        {filtered.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
            {[
              { label: "筆數", value: `${filtered.length} 筆`, icon: "📝" },
              { label: "平均每筆", value: `NT$${Math.round(monthSpent / filtered.length).toLocaleString()}`, icon: "📊" },
              { label: "最高消費", value: `NT$${Math.max(...filtered.map(e => e.amount)).toLocaleString()}`, icon: "🔝" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 14, padding: "13px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 5 }}>{s.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 1 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FAB ── */}
      {!showForm && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 50 }}>
          <button className="fab" onClick={() => { setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新增採購
          </button>
        </div>
      )}

      {/* ── Month picker modal ── */}
      {showMonthPicker && (
        <div className="overlay" onClick={() => setShowMonthPicker(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>選擇查詢月份</div>
              <button onClick={() => setShowMonthPicker(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {MONTHS.map(m => {
                const mE = entries.filter(e => e.date?.startsWith(m.ym));
                const mS = mE.reduce((a, e) => a + Number(e.amount), 0);
                const mB = budget - mS;
                const months2 = [...new Set(entries.map(e => e.date?.slice(0,7)).filter(Boolean))].filter(x => x <= m.ym);
                if (!months2.includes(m.ym)) months2.push(m.ym);
                const cumB = months2.reduce((acc, ym) => { const s = entries.filter(e => e.date?.startsWith(ym)).reduce((a,e)=>a+Number(e.amount),0); return acc+(budget-s); },0);
                const isActive = viewMonth === m.ym;
                return (
                  <button key={m.ym} className={`mpbtn ${isActive ? "mpbtn-on" : ""}`}
                    onClick={() => { setViewMonth(m.ym); setShowMonthPicker(false); }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: isActive ? "#c7d2fe" : "#e2e8f0" }}>{m.label}</span>
                      <span style={{ fontSize: 11, color: "#475569" }}>
                        {mE.length > 0 ? `${mE.length} 筆 · 支出 NT$${mS.toLocaleString()}` : "尚無記錄"}
                      </span>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 3 }}>
                      {mE.length > 0 && (
                        <>
                          <span style={{ fontSize: 12, fontWeight: 700, color: col(mB) }}>{sign(mB)}NT${Math.abs(mB).toLocaleString()} <span style={{ fontSize: 9, color: "#475569", fontWeight: 400 }}>結餘</span></span>
                          <span style={{ fontSize: 11, color: cumB >= 0 ? "#818cf8" : "#f87171", fontWeight: 600 }}>累計 {sign(cumB)}NT${Math.abs(cumB).toLocaleString()}</span>
                        </>
                      )}
                      {isActive && <span style={{ fontSize: 10, color: "#6366f1" }}>▶ 目前</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {showExport && (
        <div className="overlay" onClick={() => setShowExport(false)}>
          <div className="modal-box" style={{ maxWidth: 320 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>📤 匯出資料</div>
              <button onClick={() => setShowExport(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>

            {/* Current month */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, fontWeight: 600, letterSpacing: .5 }}>📅 {viewLabel}（{filtered.length} 筆）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="expbtn" onClick={() => { exportCSV(filtered, viewLabel); setShowExport(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  匯出本月 CSV
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569", background: "rgba(255,255,255,.05)", padding: "2px 8px", borderRadius: 10 }}>UTF-8</span>
                </button>
                <button className="expbtn" onClick={() => { exportXLSX(filtered, viewLabel); setShowExport(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                  匯出本月 XLSX
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569", background: "rgba(255,255,255,.05)", padding: "2px 8px", borderRadius: 10 }}>Excel</span>
                </button>
              </div>
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,.07)", marginBottom: 18 }} />

            {/* All data */}
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, fontWeight: 600, letterSpacing: .5 }}>📦 全部資料（{entries.length} 筆）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="expbtn" onClick={() => { exportCSV(entries, "全部"); setShowExport(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  匯出全部 CSV
                </button>
                <button className="expbtn" onClick={() => { exportXLSX(entries, "全部"); setShowExport(false); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                  匯出全部 XLSX
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <div className="overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-box" style={{ maxWidth: 290, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🗑️</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>確定刪除？</div>
            <div style={{ fontSize: 13, color: "#818cf8", fontWeight: 600, marginBottom: 4 }}>{deleteTarget.item}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 22 }}>NT$ {Number(deleteTarget.amount).toLocaleString()} · {deleteTarget.date}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="cbtn" style={{ flex: 1 }} onClick={() => setDeleteTarget(null)}>取消</button>
              <button onClick={handleDelete}
                style={{ flex: 1, background: "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", borderRadius: 11, color: "#fff", padding: "11px", fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
                刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

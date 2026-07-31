// アプリ本体：起動・ログイン・タブシェル・共通ユーティリティ
'use strict';

const App = {
  member: null,        // {id, name, role}
  month: defaultMonth(),
  tab: null
};

const WDAY = ['日', '月', '火', '水', '木', '金', '土'];
const WISH = {
  o: { mark: '○', label: '出たい', cls: 'w-o' },
  d: { mark: '△', label: 'どちらでも', cls: 'w-d' },
  x: { mark: '×', label: 'NG', cls: 'w-x' }
};

function defaultMonth() { // 既定＝翌月（前月に翌月分を組む運用）
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function shiftMonth(month, diff) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const d = new Date(y, m - 1 + diff, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function monthLabel(month) { return Number(month.slice(0, 4)) + '年' + Number(month.slice(5, 7)) + '月'; }

function dayLabel(month, day) {
  const w = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day).getDay();
  return day + '日(' + WDAY[w] + ')';
}

function isWeekend(month, day) {
  const w = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day).getDay();
  return w === 0 || w === 6;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 起動 ──────────────────────────────────────

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!GAS_URL) {
    document.getElementById('app').innerHTML =
      '<div class="boot">セットアップ待ち：config.js に GAS_URL を設定してください<br>（セットアップ手順.md 参照）</div>';
    return;
  }
  const cred = Store.cred();
  if (!cred) { renderLogin(); return; }
  try {
    const res = await api('login', {});
    App.member = res.member;
    renderShell();
  } catch (e) {
    if (e.message !== 'AUTH') renderLogin(e.message);
  }
}

// ── ログイン ──────────────────────────────────

function renderLogin(msg) {
  document.getElementById('app').innerHTML = `
    <div class="login">
      <div class="login-logo">シフト表</div>
      <div class="login-box">
        <label>なまえ</label>
        <input id="in-name" type="text" autocomplete="username" placeholder="配信名">
        <label>PIN（4桁）</label>
        <input id="in-pin" type="tel" inputmode="numeric" maxlength="8" autocomplete="current-password" placeholder="####">
        ${msg ? '<div class="login-err">' + esc(msg) + '</div>' : ''}
        <button class="btn primary" id="btn-login">はじめる</button>
      </div>
      <div class="login-note">なまえ・PINが分からないときはYへ</div>
    </div>`;
  document.getElementById('btn-login').onclick = doLogin;
  document.getElementById('in-pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const name = document.getElementById('in-name').value.trim();
  const pin = document.getElementById('in-pin').value.trim();
  if (!name || !pin) { toast('なまえとPINを入れてください', true); return; }
  try {
    const res = await api('login', { name, pin });
    Store.saveCred({ name, pin });
    App.member = res.member;
    renderShell();
  } catch (e) {
    if (e.message !== 'AUTH') renderLogin(e.message);
  }
}

function logout() {
  Store.clearCred();
  App.member = null;
  renderLogin();
}

// ── タブシェル ────────────────────────────────

function tabsFor() {
  if (App.member.role === 'admin') {
    return [
      { id: 'build', label: 'シフト作成', render: renderBuild },
      { id: 'matrix', label: '希望一覧', render: renderMatrix },
      { id: 'records', label: '承認・記録', render: renderRecords },
      { id: 'stats', label: '集計', render: renderStats }
    ];
  }
  return [
    { id: 'wish', label: '希望提出', render: renderWish },
    { id: 'sched', label: 'シフト', render: renderSchedule },
    { id: 'stats', label: 'みんな', render: renderStats }
  ];
}

function renderShell() {
  const tabs = tabsFor();
  App.tab = App.tab && tabs.some(t => t.id === App.tab) ? App.tab : tabs[0].id;
  document.getElementById('app').innerHTML = `
    <header class="top">
      <span class="top-title">シフト表</span>
      <span class="top-user">${esc(App.member.name)}</span>
      <button class="top-logout" id="btn-logout">出る</button>
    </header>
    <main id="view"></main>
    <nav class="tabs">${tabs.map(t =>
      `<button class="tab ${t.id === App.tab ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </nav>`;
  document.getElementById('btn-logout').onclick = logout;
  document.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => { App.tab = b.dataset.tab; renderShell(); };
  });
  tabs.find(t => t.id === App.tab).render();
}

// 月ナビ（各ビュー共通）。onChange(month) を呼ぶ
function monthNavHtml() {
  return `
    <div class="monthnav">
      <button class="mn-btn" id="mn-prev">◀</button>
      <span class="mn-label">${monthLabel(App.month)}</span>
      <button class="mn-btn" id="mn-next">▶</button>
    </div>`;
}

function bindMonthNav(onChange) {
  document.getElementById('mn-prev').onclick = () => { App.month = shiftMonth(App.month, -1); onChange(); };
  document.getElementById('mn-next').onclick = () => { App.month = shiftMonth(App.month, 1); onChange(); };
}

function view() { return document.getElementById('view'); }

function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

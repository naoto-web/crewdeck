// GAS APIクライアント（全アクションPOST・PIN同送＝書込保護）
'use strict';

async function api(action, params) {
  if (!GAS_URL) throw new Error('GAS_URLが未設定です（セットアップ手順.md参照）');
  const cred = Store.cred();
  const body = Object.assign({}, params || {}, {
    action,
    name: cred ? cred.name : (params && params.name),
    pin: cred ? cred.pin : (params && params.pin)
  });
  showLoading(true);
  let res;
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(body) });
    res = await r.json();
  } catch (e) {
    throw new Error('通信に失敗しました。電波状況を確認してください');
  } finally {
    showLoading(false);
  }
  if (!res.ok) {
    if (res.error === 'AUTH' && action !== 'login') {
      Store.clearCred();
      renderLogin(res.message || 'ログインし直してください');
      throw new Error('AUTH');
    }
    throw new Error(res.message || res.error || 'エラーが発生しました');
  }
  return res;
}

const Store = {
  cred() { try { return JSON.parse(localStorage.getItem('cred')); } catch (e) { return null; } },
  saveCred(c) { localStorage.setItem('cred', JSON.stringify(c)); },
  clearCred() { localStorage.removeItem('cred'); }
};

function showLoading(on) {
  let el = document.getElementById('loading');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading';
      el.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

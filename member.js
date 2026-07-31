// メンバー画面：希望提出・シフト閲覧＋承認・みんな（集計）
'use strict';

// ── 希望提出 ──────────────────────────────────

async function renderWish() {
  let data;
  try { data = await api('memberData', { month: App.month }); } catch (e) { toast(e.message, true); return; }

  // 前回提出があればそれを初期値に、なければ全部△
  const draft = {};
  for (let d = 1; d <= data.days; d++) {
    const prev = data.myWishes && data.myWishes.payload ? data.myWishes.payload[d] : null;
    draft[d] = { a: prev && prev.a ? prev.a : 'd', p: prev && prev.p ? prev.p : 'd' };
  }

  const cfg = data.config;
  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">希望の締切：前月${cfg.wishDeadlineDay}日ごろ（詳しくはYから連絡）。締切まで何回でも出し直せます</div>
    ${data.myWishes ? `<div class="hint ok">前回提出：${esc(data.myWishes.submittedAt)}（${data.myWishes.count}回目）</div>`
                    : '<div class="hint warn">この月はまだ未提出です</div>'}
    ${data.myWishes && data.myWishes.by && data.myWishes.by !== App.member.id
      ? '<div class="hint">いまの内容はスタッフが代理で入力したものです。修正して出し直してOK</div>' : ''}
    <div class="bulk">
      まとめて：
      <button class="btn sm" data-bulk="o">全部○</button>
      <button class="btn sm" data-bulk="d">全部△</button>
      <button class="btn sm" data-bulk="x">全部×</button>
    </div>
    <div class="legend">○=出たい ／ △=どちらでも ／ ×=NG　（タップで切替）</div>
    <div class="slot-heads"><span></span><span>前半</span><span>後半</span></div>
    <div id="wish-list"></div>
    <textarea id="wish-memo" placeholder="Yへのメモ（例：15日は午前だけなら可）">${esc(data.myWishes ? data.myWishes.memo : '')}</textarea>
    <button class="btn primary wide" id="btn-submit">この内容で提出する</button>
    <div class="spacer"></div>`;
  bindMonthNav(renderWish);

  const list = document.getElementById('wish-list');
  function paint() {
    list.innerHTML = '';
    for (let d = 1; d <= data.days; d++) {
      const row = document.createElement('div');
      row.className = 'wish-row' + (isWeekend(App.month, d) ? ' wknd' : '');
      row.innerHTML = `
        <span class="wr-day">${dayLabel(App.month, d)}</span>
        <button class="wr-btn ${WISH[draft[d].a].cls}" data-d="${d}" data-s="a">${WISH[draft[d].a].mark}</button>
        <button class="wr-btn ${WISH[draft[d].p].cls}" data-d="${d}" data-s="p">${WISH[draft[d].p].mark}</button>`;
      list.appendChild(row);
    }
    list.querySelectorAll('.wr-btn').forEach(b => {
      b.onclick = () => {
        const d = b.dataset.d, s = b.dataset.s;
        draft[d][s] = draft[d][s] === 'o' ? 'd' : draft[d][s] === 'd' ? 'x' : 'o';
        b.className = 'wr-btn ' + WISH[draft[d][s]].cls;
        b.textContent = WISH[draft[d][s]].mark;
      };
    });
  }
  paint();

  document.querySelectorAll('[data-bulk]').forEach(b => {
    b.onclick = () => {
      for (let d = 1; d <= data.days; d++) { draft[d].a = b.dataset.bulk; draft[d].p = b.dataset.bulk; }
      paint();
    };
  });

  document.getElementById('btn-submit').onclick = async () => {
    try {
      await api('saveWishes', { month: App.month, payload: draft, memo: document.getElementById('wish-memo').value });
      toast('提出しました');
      renderWish();
    } catch (e) { toast(e.message, true); }
  };
}

// ── シフト閲覧＋承認 ───────────────────────────

async function renderSchedule() {
  let data;
  try { data = await api('memberData', { month: App.month }); } catch (e) { toast(e.message, true); return; }

  const nameOf = {};
  data.members.forEach(m => nameOf[m.id] = m.name);

  if (!data.schedule) {
    view().innerHTML = monthNavHtml() + '<div class="empty">この月のシフトはまだ公開されていません</div>';
    bindMonthNav(renderSchedule);
    return;
  }

  const s = data.schedule;
  const idx = {};
  s.assignments.forEach(a => idx[a.date + '|' + a.slot] = a.memberIds);
  const myCount = s.counts[App.member.id] || { days: 0, a: 0, p: 0 };
  const memberIds = data.members.filter(m => m.role !== 'admin').map(m => m.id);
  const approvedCount = data.approvals.done.filter(id => memberIds.includes(id)).length;

  function chips(ids) {
    if (!ids || !ids.length) return '<span class="chip none">—</span>';
    return ids.map(id =>
      `<span class="chip ${id === App.member.id ? 'me' : ''}">${esc(nameOf[id] || id)}</span>`).join('');
  }

  let rows = '';
  for (let d = 1; d <= data.days; d++) {
    rows += `
      <div class="sc-row ${isWeekend(App.month, d) ? 'wknd' : ''}">
        <span class="sc-day">${dayLabel(App.month, d)}</span>
        <span class="sc-slot">${chips(idx[d + '|a'])}</span>
        <span class="sc-slot">${chips(idx[d + '|p'])}</span>
      </div>`;
  }

  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">版${s.version}・${s.status === 'confirmed' ? '確定済み' : '公開中'}（${esc(s.publishedAt)}）${s.note ? '<br>メモ：' + esc(s.note) : ''}</div>
    <div class="mycount">あなた：${myCount.days}日（前半${myCount.a}・後半${myCount.p}）</div>
    ${data.approvals.mine
      ? `<div class="hint ok">✅ この版は確認済みです（全体 ${approvedCount}/${memberIds.length}人）</div>`
      : `<button class="btn primary wide" id="btn-approve">内容を確認しました（版${s.version}）</button>
         <div class="hint">確認すると記録が残ります。気になる点があれば押す前にYへ連絡してください</div>`}
    <div class="slot-heads sc"><span></span><span>前半</span><span>後半</span></div>
    ${rows}
    <div class="spacer"></div>`;
  bindMonthNav(renderSchedule);

  const btn = document.getElementById('btn-approve');
  if (btn) btn.onclick = async () => {
    try {
      await api('approve', { month: App.month, version: s.version });
      toast('確認を記録しました');
      renderSchedule();
    } catch (e) { toast(e.message, true); }
  };
}

// ── みんな（集計）：メンバー・Y共通 ─────────────

async function renderStats() {
  let data;
  try { data = await api('memberData', { month: App.month }); } catch (e) { toast(e.message, true); return; }

  if (!data.schedule) {
    view().innerHTML = monthNavHtml() + '<div class="empty">この月のシフトはまだ公開されていません</div>';
    bindMonthNav(renderStats);
    return;
  }

  const counts = data.schedule.counts;
  const rows = data.members.filter(m => m.role !== 'admin').map(m => {
    const c = counts[m.id] || { days: 0, a: 0, p: 0 };
    return `<tr class="${m.id === App.member.id ? 'me' : ''}">
      <td>${esc(m.name)}</td><td>${c.days}日</td><td>${c.a}</td><td>${c.p}</td></tr>`;
  }).join('');

  // 自分の希望充足（○に入れた率・×を踏まれた数）
  let fulfill = '';
  if (data.myWishes && data.myWishes.payload) {
    const idx = {};
    data.schedule.assignments.forEach(a => idx[a.date + '|' + a.slot] = a.memberIds);
    let oTotal = 0, oHit = 0, xHit = 0;
    for (let d = 1; d <= data.days; d++) {
      ['a', 'p'].forEach(s => {
        const w = data.myWishes.payload[d] ? data.myWishes.payload[d][s] : null;
        const assigned = (idx[d + '|' + s] || []).includes(App.member.id);
        if (w === 'o') { oTotal++; if (assigned) oHit++; }
        if (w === 'x' && assigned) xHit++;
      });
    }
    fulfill = `<div class="hint">あなたの希望：○に入れた率 ${oTotal ? Math.round(oHit / oTotal * 100) + '%（' + oHit + '/' + oTotal + '）' : '—'}
      ／ ×の日に入った数 ${xHit}${xHit > 0 ? ' ⚠️Yに確認してください' : ''}</div>`;
  }

  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">版${data.schedule.version}の集計（出勤日数と前半/後半の内訳）</div>
    <table class="stats"><thead><tr><th>メンバー</th><th>日数</th><th>前半</th><th>後半</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${fulfill}
    <div class="spacer"></div>`;
  bindMonthNav(renderStats);
}

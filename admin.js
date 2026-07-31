// Y（管理者）画面：シフト作成・希望一覧・承認/記録
'use strict';

const Admin = { month: null, data: null, draftIdx: null, dirty: false, notes: [] };

async function loadAdmin(force) {
  if (!force && Admin.month === App.month && Admin.data) return;
  if (Admin.dirty && Admin.month !== App.month) {
    if (!confirm('保存していない調整があります。破棄して月を切り替えますか？')) {
      App.month = Admin.month;
    }
  }
  const res = await api('adminData', { month: App.month });
  Admin.month = App.month;
  Admin.data = res;
  Admin.draftIdx = {};
  res.draft.forEach(a => Admin.draftIdx[a.date + '|' + a.slot] = a.memberIds.slice());
  Admin.dirty = false;
  Admin.notes = [];
}

function draftToAssignments() {
  return Object.keys(Admin.draftIdx).map(k => {
    const p = k.split('|');
    return { date: Number(p[0]), slot: p[1], memberIds: Admin.draftIdx[k] };
  });
}

function admMembers() { return Admin.data.members.filter(m => m.role !== 'admin' && m.active); }

function wishAt(memberId, day, slot) {
  const w = Admin.data.wishes[memberId];
  const v = w && w.payload && w.payload[day] ? w.payload[day][slot] : null;
  return v || 'd';
}

// ── 警告計算（ブロックせず表示のみ＝最終判断はY） ──

function computeWarnings() {
  const cfg = Admin.data.config;
  const cellFlags = {}; // key → [msg]
  const msgs = [];
  const workedDays = {};  // id → Set(day)
  const slotCounts = {};  // id → {a, p}
  admMembers().forEach(m => { workedDays[m.id] = new Set(); slotCounts[m.id] = { a: 0, p: 0 }; });

  for (let d = 1; d <= Admin.data.days; d++) {
    ['a', 'p'].forEach(s => {
      const key = d + '|' + s;
      const ids = Admin.draftIdx[key] || [];
      const flags = [];
      if (ids.length < 2) flags.push(ids.length === 0 ? '空き' : '1人');
      if (ids.length === 1) {
        const lone = Admin.data.members.find(m => m.id === ids[0]);
        if (lone && lone.noSolo) flags.push('単独NG:' + lone.name);
      }
      ids.forEach(id => {
        if (workedDays[id]) { workedDays[id].add(d); slotCounts[id][s]++; }
        if (wishAt(id, d, s) === 'x') flags.push('×踏み:' + nameOfA(id));
      });
      if (ids.length === 2 && cfg.ngPairs.some(p =>
        (p[0] === ids[0] && p[1] === ids[1]) || (p[0] === ids[1] && p[1] === ids[0]))) {
        flags.push('NGペア');
      }
      if (flags.length) cellFlags[key] = flags;
    });
    // 前後通し出勤の検出（手動編集で入り得る。ルール＝通しなし）
    const both = (Admin.draftIdx[d + '|a'] || []).filter(id => (Admin.draftIdx[d + '|p'] || []).includes(id));
    both.forEach(id => {
      ['a', 'p'].forEach(s => {
        const key = d + '|' + s;
        (cellFlags[key] = cellFlags[key] || []).push('通し:' + nameOfA(id));
      });
      msgs.push(`⚠️ ${d}日：${nameOfA(id)}が前後通し（ルール＝通しなし）`);
    });
    // 夜→翌朝の検出（ルール＝夜に出た翌日の昼はなし）
    if (d > 1) {
      const overnight = (Admin.draftIdx[(d - 1) + '|p'] || []).filter(id => (Admin.draftIdx[d + '|a'] || []).includes(id));
      overnight.forEach(id => {
        (cellFlags[d + '|a'] = cellFlags[d + '|a'] || []).push('夜明け:' + nameOfA(id));
        msgs.push(`⚠️ ${d}日前半：${nameOfA(id)}が前日の夜から連続（夜明け昼はなし）`);
      });
    }
  }

  admMembers().forEach(m => {
    const days = workedDays[m.id].size;
    if (days > m.maxDays) msgs.push(`⚠️ ${m.name}：${days}日（上限${m.maxDays}日を超過）`);
    // 連勤チェック
    let streak = 0, maxRun = 0;
    for (let d = 1; d <= Admin.data.days; d++) {
      streak = workedDays[m.id].has(d) ? streak + 1 : 0;
      maxRun = Math.max(maxRun, streak);
    }
    if (maxRun > cfg.maxStreak) msgs.push(`⚠️ ${m.name}：最大${maxRun}連勤（上限${cfg.maxStreak}）`);
  });

  Object.keys(cellFlags).forEach(k => {
    const p = k.split('|');
    cellFlags[k].forEach(f => {
      if (f.startsWith('×踏み') || f === 'NGペア' || f.startsWith('単独NG')) {
        msgs.push(`⚠️ ${p[0]}日${p[1] === 'a' ? '前半' : '後半'}：${f}`);
      }
    });
  });

  return { cellFlags, msgs, workedDays, slotCounts };
}

function nameOfA(id) {
  const m = Admin.data.members.find(m => m.id === id);
  return m ? m.name : id;
}

// ── シフト作成 ────────────────────────────────

async function renderBuild() {
  // 未保存の調整があるときだけキャッシュ維持。それ以外は毎回最新を取得（後から届く希望を取りこぼさない）
  try { await loadAdmin(!Admin.dirty); } catch (e) { toast(e.message, true); return; }
  const data = Admin.data;
  const { cellFlags, msgs, workedDays, slotCounts } = computeWarnings();
  const pub = data.published;

  // 人別の出勤日数（前半/後半内訳）を常時表示。上限超過は赤・希望未提出は「未」
  const memberChips = admMembers().map(m => {
    const days = workedDays[m.id] ? workedDays[m.id].size : 0;
    const sc = slotCounts[m.id] || { a: 0, p: 0 };
    const over = days > m.maxDays;
    const noWish = !data.wishes[m.id];
    return `<span class="mchip ${over ? 'over' : ''}">${esc(m.name)} <b>${days}${m.targetDays ? '/' + m.targetDays : ''}日</b>（前${sc.a}・後${sc.p}）${noWish ? '<b class="nosub">未</b>' : ''}</span>`;
  }).join('');

  let rows = '';
  for (let d = 1; d <= data.days; d++) {
    rows += `<div class="bd-row ${isWeekend(App.month, d) ? 'wknd' : ''}">
      <span class="bd-day">${dayLabel(App.month, d)}</span>
      ${['a', 'p'].map(s => {
        const key = d + '|' + s;
        const ids = Admin.draftIdx[key] || [];
        const flags = cellFlags[key] || [];
        const tag = raceTag(data.raceInfo[key]);
        return `<button class="bd-cell ${flags.length ? 'warn' : ''}" data-key="${key}">
          ${ids.length ? ids.map(id => `<span class="chip">${esc(nameOfA(id))}</span>`).join('') : '<span class="chip none">＋</span>'}
          ${flags.length ? `<span class="badge">${flags[0]}</span>` : ''}
          ${tag ? `<span class="rbadge">${tag}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }

  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">${pub ? `公開中：版${pub.version}（${esc(pub.publishedAt)}・${pub.status === 'confirmed' ? '確定済み' : '承認待ち'}）` : 'まだ未公開の月です'}${Admin.dirty ? '　<b class="dirty">未保存の調整あり</b>' : ''}</div>
    <div class="toolbar">
      <button class="btn sm" id="btn-race">レース情報取得</button>
      <button class="btn sm" id="btn-gen">たたき台生成</button>
      <button class="btn sm" id="btn-save">保存</button>
      <button class="btn sm primary" id="btn-pub">公開</button>
    </div>
    <div class="mchips">${memberChips}</div>
    ${Admin.notes.length ? `<div class="notes">${Admin.notes.map(n => '・' + esc(n)).join('<br>')}</div>` : ''}
    ${msgs.length ? `<div class="warnbox">${msgs.map(esc).join('<br>')}</div>` : ''}
    <div class="slot-heads sc"><span></span><span>前半</span><span>後半</span></div>
    ${rows}
    <div class="spacer"></div>
    <div id="modal-root"></div>`;
  bindMonthNav(async () => { await loadAdmin(); renderBuild(); });

  document.getElementById('btn-race').onclick = async () => {
    try {
      const res = await api('fetchRaceInfo', { month: App.month });
      toast(`取得OK：ガールズ${res.girlsDays}日・グレード(G3以上)${res.gradeDays}日`);
      if (res.notes && res.notes.length) console.warn(res.notes);
      await loadAdmin(true);
      renderBuild();
    } catch (e) { toast(e.message, true); }
  };

  document.getElementById('btn-gen').onclick = async () => {
    if (Object.keys(Admin.draftIdx).some(k => (Admin.draftIdx[k] || []).length) &&
        !confirm('いまのドラフトを上書きしてたたき台を作り直します。よろしいですか？')) return;
    try {
      const res = await api('generateDraft', { month: App.month });
      Admin.draftIdx = {};
      res.assignments.forEach(a => Admin.draftIdx[a.date + '|' + a.slot] = a.memberIds.slice());
      Admin.notes = res.notes || [];
      Admin.dirty = false; // サーバー保存済み
      toast('たたき台を作成しました');
      renderBuild();
    } catch (e) { toast(e.message, true); }
  };

  document.getElementById('btn-save').onclick = async () => {
    try {
      await api('saveDraft', { month: App.month, assignments: draftToAssignments() });
      Admin.dirty = false;
      toast('保存しました');
      renderBuild();
    } catch (e) { toast(e.message, true); }
  };

  document.getElementById('btn-pub').onclick = async () => {
    const label = pub ? '再公開（版' + (pub.version + 1) + '）' : '公開（版1）';
    const note = prompt(label + '：メンバーへのメモ・変更理由（任意）', '');
    if (note === null) return;
    try {
      await api('saveDraft', { month: App.month, assignments: draftToAssignments() });
      const res = await api('publish', { month: App.month, note });
      toast('版' + res.version + 'を公開しました');
      await loadAdmin(true);
      renderBuild();
    } catch (e) { toast(e.message, true); }
  };

  document.querySelectorAll('.bd-cell').forEach(c => c.onclick = () => openCellEditor(c.dataset.key));
}

function openCellEditor(key) {
  const p = key.split('|');
  const day = Number(p[0]), slot = p[1];
  const cur = (Admin.draftIdx[key] || []).slice();
  const root = document.getElementById('modal-root');

  function paint() {
    const rinfo = Admin.data.raceInfo[key];
    root.innerHTML = `
      <div class="modal-bg">
        <div class="modal">
          <div class="modal-title">${dayLabel(App.month, day)} ${slot === 'a' ? '前半' : '後半'}（2人まで）</div>
          ${rinfo && rinfo.venues ? `<div class="modal-sub">${esc(rinfo.venues)}</div>` : ''}
          ${admMembers().map(m => {
            const w = wishAt(m.id, day, slot);
            const sel = cur.includes(m.id);
            return `<button class="pick ${sel ? 'sel' : ''}" data-id="${m.id}">
              <span class="pick-w ${WISH[w].cls}">${WISH[w].mark}</span>${esc(m.name)}
              ${!Admin.data.wishes[m.id] ? '<span class="nosub">未提出</span>' : ''}
            </button>`;
          }).join('')}
          <div class="modal-btns">
            <button class="btn sm" id="md-clear">クリア</button>
            <button class="btn sm primary" id="md-ok">OK</button>
          </div>
        </div>
      </div>`;
    root.querySelectorAll('.pick').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      const i = cur.indexOf(id);
      if (i >= 0) cur.splice(i, 1);
      else {
        if (cur.length >= 2) { toast('2人までです。先にどちらかを外してください', true); return; }
        if (wishAt(id, day, slot) === 'x' && !confirm(nameOfA(id) + 'は×（NG）希望です。それでも入れますか？')) return;
        cur.push(id);
      }
      paint();
    });
    root.querySelector('#md-clear').onclick = () => { cur.length = 0; paint(); };
    root.querySelector('#md-ok').onclick = () => {
      Admin.draftIdx[key] = cur.slice();
      Admin.dirty = true;
      root.innerHTML = '';
      renderBuild();
    };
    root.querySelector('.modal-bg').onclick = e => { if (e.target.classList.contains('modal-bg')) root.innerHTML = ''; };
  }
  paint();
}

// ── 希望一覧（マトリクス・タップ編集可＝スタッフの代理入力） ─────

async function renderMatrix() {
  try { await loadAdmin(true); } catch (e) { toast(e.message, true); return; }
  const data = Admin.data;
  const ms = admMembers();

  // 編集用ローカル状態（保存するまでサーバーには送らない）
  const edit = {};
  ms.forEach(m => {
    edit[m.id] = {};
    for (let d = 1; d <= data.days; d++) {
      edit[m.id][d] = { a: wishAt(m.id, d, 'a'), p: wishAt(m.id, d, 'p') };
    }
  });
  const dirty = new Set();

  let head = '<tr><th></th>' + ms.map(m =>
    `<th>${esc(m.name)}${!data.wishes[m.id] ? '<br><span class="nosub">未</span>' : ''}</th>`).join('') + '</tr>';
  let body = '';
  for (let d = 1; d <= data.days; d++) {
    ['a', 'p'].forEach(s => {
      body += `<tr class="${isWeekend(App.month, d) ? 'wknd' : ''}">
        <th class="mx-day">${s === 'a' ? dayLabel(App.month, d) + ' 前' : '　後'}</th>
        ${ms.map(m => {
          const w = edit[m.id][d][s];
          return `<td class="${WISH[w].cls} mx-cell" data-m="${m.id}" data-d="${d}" data-s="${s}">${WISH[w].mark}</td>`;
        }).join('')}
      </tr>`;
    });
  }

  const memos = ms.filter(m => data.wishes[m.id] && data.wishes[m.id].memo)
    .map(m => `<div>・<b>${esc(m.name)}</b>：${esc(data.wishes[m.id].memo)}</div>`).join('');
  const subs = ms.filter(m => data.wishes[m.id])
    .map(m => {
      const w = data.wishes[m.id];
      const proxy = w.by && w.by !== m.id ? '・' + esc(nameOfA(w.by)) + 'が代理入力' : '';
      return `<div>・${esc(m.name)}：${esc(w.submittedAt)}（${w.count}回目${proxy}）</div>`;
    }).join('');

  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">セルをタップで ○→△→× 切替。「保存」でその人の希望として記録されます（スタッフの代理入力としてログに残る）</div>
    <div class="toolbar">
      <button class="btn sm primary" id="btn-wish-save" disabled>保存</button>
      <span class="dirty-info" id="dirty-info"></span>
    </div>
    <div class="mx-wrap"><table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${memos ? '<div class="notes"><b>メモ</b><br>' + memos + '</div>' : ''}
    ${subs ? '<div class="notes"><b>最終提出</b><br>' + subs + '</div>' : ''}
    <div class="spacer"></div>`;
  bindMonthNav(renderMatrix);

  const saveBtn = document.getElementById('btn-wish-save');
  const info = document.getElementById('dirty-info');
  function refreshBar() {
    saveBtn.disabled = dirty.size === 0;
    info.textContent = dirty.size ? '未保存：' + [...dirty].map(nameOfA).join('・') : '';
  }
  document.querySelectorAll('.mx-cell').forEach(td => {
    td.onclick = () => {
      const m = td.dataset.m, d = td.dataset.d, s = td.dataset.s;
      const next = edit[m][d][s] === 'o' ? 'd' : edit[m][d][s] === 'd' ? 'x' : 'o';
      edit[m][d][s] = next;
      td.className = WISH[next].cls + ' mx-cell';
      td.textContent = WISH[next].mark;
      dirty.add(m);
      refreshBar();
    };
  });
  saveBtn.onclick = async () => {
    const targets = [...dirty];
    try {
      for (const id of targets) {
        await api('saveWishes', {
          month: App.month, forId: id, payload: edit[id],
          memo: data.wishes[id] ? data.wishes[id].memo : ''
        });
      }
      toast(targets.map(nameOfA).join('・') + ' の希望を保存しました');
      renderMatrix();
    } catch (e) { toast(e.message, true); }
  };
  refreshBar();
}

// ── 承認・記録 ────────────────────────────────

async function renderRecords() {
  try { await loadAdmin(true); } catch (e) { toast(e.message, true); return; }
  const data = Admin.data;
  const pub = data.published;
  const ms = admMembers();

  let approveHtml = '<div class="empty">まだ公開されていません</div>';
  if (pub) {
    const at = {};
    data.approvals.forEach(a => at[a.memberId] = a.approvedAt);
    approveHtml = `
      <table class="stats"><thead><tr><th>メンバー</th><th>版${pub.version}の確認</th></tr></thead><tbody>
      ${ms.map(m => `<tr><td>${esc(m.name)}</td><td>${at[m.id] ? '✅ ' + esc(at[m.id]) : '<span class="nosub">未確認</span>'}</td></tr>`).join('')}
      </tbody></table>`;
  }

  const logs = (data.changeLog || []).map(r =>
    `<div class="log-row">${esc(r.at)}｜版${esc(r.version)}｜${esc(r.date)}日${r.slot === 'a' ? '前半' : '後半'}：
     ${esc(csvToNames(r.before))} → ${esc(csvToNames(r.after))}${r.reason ? '（' + esc(r.reason) + '）' : ''}</div>`).join('');

  view().innerHTML = `
    ${monthNavHtml()}
    <div class="hint">${pub ? `版${pub.version}・${pub.status === 'confirmed' ? '確定済み' : '公開中（承認待ち）'}・${esc(pub.publishedAt)}` : '未公開'}</div>
    <h3>本人確認の状況</h3>
    ${approveHtml}
    <h3>変更履歴（公開後の調整・交代）</h3>
    ${logs || '<div class="empty">変更はありません</div>'}
    <div class="toolbar">
      <button class="btn sm" id="btn-export">記録一式をCSV出力</button>
      ${pub && pub.status !== 'confirmed' ? '<button class="btn sm primary" id="btn-confirm">この月を確定する</button>' : ''}
    </div>
    <div class="hint">CSVは希望ログ・承認ログ・変更履歴込み。月末に出力して保管（税務調査時の「希望確認→協議→合意」の証拠一式）</div>
    <div class="spacer"></div>`;
  bindMonthNav(renderRecords);

  document.getElementById('btn-export').onclick = async () => {
    try {
      const res = await api('exportMonth', { month: App.month });
      downloadCsv(res.filename, res.csv);
    } catch (e) { toast(e.message, true); }
  };
  const bc = document.getElementById('btn-confirm');
  if (bc) bc.onclick = async () => {
    if (!confirm('この月を確定します（以後の変更も履歴には残ります）。よろしいですか？')) return;
    try {
      await api('confirmMonth', { month: App.month });
      toast('確定しました');
      renderRecords();
    } catch (e) { toast(e.message, true); }
  };
}

function csvToNames(csv) {
  return String(csv || '').split(',').filter(Boolean).map(id => nameOfA(id.trim())).join('・') || '—';
}

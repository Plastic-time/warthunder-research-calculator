(() => {
  'use strict';
  const storage = window.PlanStorage;
  const t = (source, params) => window.WTI18n.t(source, params);
  let hooks = { busy: () => true, restored: async () => {} };
  let ticket = null;
  let busy = false;
  let revision = 0;
  let message = '';
  const dialog = document.createElement('dialog');
  dialog.id = 'planBackupDialog';
  dialog.className = 'plan-backup-dialog';
  dialog.setAttribute('aria-labelledby', 'planBackupTitle');
  dialog.innerHTML = `<header><h2 id="planBackupTitle" data-i18n="备份与恢复"></h2><button type="button" data-backup-close aria-label="关闭" data-i18n-aria-label="关闭"><span class="nav-icon" style="--nav-icon:url('assets/navigation/x.svg')" aria-hidden="true"></span></button></header>
    <div class="plan-backup-body"><div class="plan-backup-actions">
      <button type="button" data-backup-export><span class="nav-icon" style="--nav-icon:url('assets/navigation/download.svg')" aria-hidden="true"></span><span data-i18n="导出备份"></span></button>
      <button type="button" data-backup-import><span class="nav-icon" style="--nav-icon:url('assets/navigation/upload.svg')" aria-hidden="true"></span><span data-i18n="选择备份文件"></span></button>
    </div><input type="file" accept=".json,application/json" data-backup-file hidden>
    <section class="plan-backup-preview" hidden aria-labelledby="planBackupFile"><h3 id="planBackupFile"></h3><p data-backup-date></p><p data-backup-counts></p><p data-backup-details></p><p data-backup-overwrite></p><p data-i18n="仅替换备份中包含的记录，其他记录保留。"></p></section>
    <p data-backup-status role="status" aria-live="polite"></p></div>
    <footer hidden><button type="button" data-backup-cancel data-i18n="取消"></button><button type="button" data-backup-confirm data-i18n="确认恢复"></button></footer>`;
  document.body.append(dialog);
  const query = selector => dialog.querySelector(selector);
  const fileInput = query('[data-backup-file]');
  const status = query('[data-backup-status]');
  const warning = document.createElement('div');
  warning.className = 'plan-storage-warning';
  warning.hidden = true;
  warning.setAttribute('role', 'alert');
  warning.innerHTML = '<span></span><button type="button" data-i18n="备份与恢复"></button>';
  document.body.append(warning);
  let warningSource = '';
  const errors = {
    invalid: '备份文件无效，请选择本计算器导出的 JSON 文件（不超过 5 MB）。',
    version: '此备份版本暂不支持，请更新网页后重试。',
    empty: '暂无可备份的计划记录。',
    corrupt: '部分保存记录已损坏，未导出不完整备份。原记录未修改。',
    storage: '浏览器存储不可用或空间不足，操作未完成。',
    changed: '本地记录已发生变化，请重新选择备份文件。',
    rollback: '恢复中断，部分记录可能已改变。请保留备份文件并重试。',
  };
  function say(source) { message = source; status.textContent = t(source); }
  function reject(error) { say(errors[error.code] || errors.invalid); }
  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  function clearPreview() {
    ticket = null;
    query('.plan-backup-preview').hidden = true;
    query('footer').hidden = true;
    fileInput.value = '';
  }
  function refreshText() {
    window.WTI18n.translate(dialog);
    window.WTI18n.translate(warning);
    status.textContent = t(message);
    warning.querySelector('span').textContent = t(warningSource);
    if (!ticket) return;
    const counts = { trees: 0, mods: 0, targets: 0, owned: 0, progress: 0 };
    for (const {key, value} of ticket.data.records) {
      if (storage.kind(key) === 'tree') { counts.trees++; counts.targets += value.planned.length; counts.owned += value.owned.length; }
      else { counts.mods++; counts.targets += value.selected.length; counts.owned += value.researched.length; }
      counts.progress += Object.keys(value.progressRp).length;
    }
    query('[data-backup-date]').textContent = t('备份时间：{date}', { date: new Date(ticket.data.createdAt).toLocaleString(window.WTI18n.tag) });
    query('[data-backup-counts]').textContent = t('{trees} 棵科技树 · {mods} 辆载具的配件记录', counts);
    query('[data-backup-details]').textContent = t('{targets} 个目标 · {owned} 个完成标记 · {progress} 条 RP 进度', counts);
    query('[data-backup-overwrite]').textContent = t('将替换 {count} 条已有记录。', { count: ticket.overwritten });
  }
  function open() {
    if (dialog.open) return;
    clearPreview();
    say('');
    refreshText();
    dialog.showModal();
  }
  document.getElementById('planBackupButton').addEventListener('click', open);
  warning.querySelector('button').addEventListener('click', open);
  query('[data-backup-close]').addEventListener('click', () => dialog.close());
  query('[data-backup-cancel]').addEventListener('click', () => { revision++; clearPreview(); say(''); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { revision++; clearPreview(); });
  query('[data-backup-import]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const current = ++revision;
    clearPreview();
    say('');
    setBusy(true);
    try {
      if (file.size > storage.MAX_BYTES) throw { code: 'invalid' };
      const text = await file.text();
      if (current !== revision || !dialog.open) return;
      ticket = storage.preview(storage.parse(text));
      query('#planBackupFile').textContent = file.name;
      query('.plan-backup-preview').hidden = false;
      query('footer').hidden = false;
      refreshText();
    } catch (error) { clearPreview(); reject(error); }
    finally { setBusy(false); }
  });
  query('[data-backup-export]').addEventListener('click', () => {
    say('');
    try {
      const data = storage.capture();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `warthunder-plans-${data.createdAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say('备份已生成。');
    } catch (error) { reject(error); }
  });
  query('[data-backup-confirm]').addEventListener('click', async () => {
    if (!ticket || busy) return;
    if (hooks.busy()) { say('请等待当前载入或计算完成。'); return; }
    setBusy(true);
    try {
      storage.restore(ticket);
      clearPreview();
      warning.hidden = true;
      document.dispatchEvent(new Event('wt-plans-restored'));
      await hooks.restored();
      say('计划记录已恢复。');
    } catch (error) { reject(error); }
    finally { setBusy(false); }
  });
  document.addEventListener('wt-storage-warning', event => {
    warningSource = event.detail === 'read' ? '保存记录无法读取，原记录已保留。' : '本次修改未能保存，请先导出备份，避免刷新后丢失。';
    warning.querySelector('span').textContent = t(warningSource);
    warning.hidden = false;
  });
  document.addEventListener('wt-language-change', refreshText);
  window.PlanBackup = { configure(value) { hooks = value; } };
  refreshText();
})();

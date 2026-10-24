(() => {
  let report = null;
  let activeTree = null;
  let helpName = '';
  let helpUnitId = '';
  const t = (source, params) => window.WTI18n.t(source, params);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = { squadron: '联队载具', 'premium-golden-eagles': '金鹰载具', 'premium-pack': '礼包载具',
    'premium-special': '特殊载具', component: '组合载具部件', standard: '普通 / 非金币', event: '活动载具' };
  const descriptions = { 'premium-golden-eagles': 'Wiki 标有明确的金鹰价格', 'premium-pack': 'Wiki 购买入口指向 Gaijin Store',
    'premium-special': '没有金鹰价格或当前礼包购买入口' };
  const badge = (kind, text, title = '') => `<span class="pill roster-badge roster-${kind}" data-roster-label="${escape(text || '')}" data-roster-title="${escape(title)}" title="${escape(title ? t(title) : '')}">${escape(text ? t(text) : '')}</span>`;
  const hiddenBadge = (name, id = '') => `<span class="pill roster-badge roster-hidden" role="button" tabindex="0" data-roster-hidden-help data-unit-name="${escape(name || '')}" data-roster-unit-id="${escape(id)}" title="${escape(t('点击查看隐藏载具说明'))}" aria-haspopup="dialog">${escape(t('持有后可见'))}</span>`;

  function renderHelp(dialog) {
    const name = helpUnitId && typeof displayTitle === 'function'
      ? displayTitle({ data_unit_id: helpUnitId, title: helpName || helpUnitId }) : helpName || t('该载具');
    dialog.innerHTML = `<div class="roster-help-heading">
        <div><span>${escape(t('隐藏载具'))}</span><h2 id="rosterHiddenTitle">${escape(t('持有后可见是什么意思？'))}</h2></div>
        <button type="button" data-roster-help-close aria-label="${escape(t('关闭隐藏载具说明'))}">${escape(t('关闭'))}</button>
      </div>
      <p><strong data-roster-hidden-name>${escape(name)}</strong> ${escape(t('被游戏配置标记为“仅在拥有后显示”（showOnlyWhenBought）。它不是向所有账号公开展示的常规科技树载具，通常只有已经拥有、购买或满足特定发放条件的玩家才能在游戏中看到。'))}</p>
      <p>${escape(t('Wiki 仍可能保留它的资料，所以本页面会显示该载具。这个标签只解释显示条件，不代表它目前仍可购买或获取，也不会将它自动视为可研发载具。'))}</p>
      <p class="roster-help-note">${escape(t('研发前置、等级解锁数量和 RP / SL 计算不会因此改变。'))}</p>`;
  }

  function getHelpDialog() {
    let dialog = document.getElementById('rosterHiddenDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'rosterHiddenDialog';
    dialog.className = 'roster-help-dialog';
    dialog.setAttribute('aria-labelledby', 'rosterHiddenTitle');
    renderHelp(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-roster-help-close]')) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function openHiddenHelp(trigger) {
    helpName = trigger.dataset.unitName || '';
    helpUnitId = trigger.dataset.rosterUnitId || '';
    const dialog = getHelpDialog();
    renderHelp(dialog);
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-roster-hidden-help]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    openHiddenHelp(trigger);
  }, true);

  document.addEventListener('keydown', event => {
    const trigger = event.target.closest?.('[data-roster-hidden-help]');
    if (!trigger || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    openHiddenHelp(trigger);
  }, true);

  window.RosterAudit = {
    async load() {
      try {
        const response = await fetch('roster-audit.json?v=roster-1', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(t('载具收录对照暂不可用'));
        report = await response.json();
        if (report.schema !== 2 || !report.trees) throw new Error(t('载具收录对照格式错误'));
      } catch (error) { report = null; console.warn(error); }
    },
    badges(country, type, unit, displayName) {
      const item = report?.trees[`${country}/${type}`]?.units[String(unit.data_unit_id).toLowerCase()];
      if (!item) return badge('pending', '分类待核对');
      const description = item.acquisition?.provenance?.kind === 'official-announcement'
        ? (item.gameSource ? '查看官方活动来源' : '官方公告已确认购买方式') : descriptions[item.category] || '仅作分类展示，不改变计算规则';
      return (item.category === 'squadron' ? '' : badge(item.category, labels[item.category], description)) +
        (item.hidden ? hiddenBadge(displayName || item.title || unit.data_unit_id, unit.data_unit_id) : '');
    },
    info(country, type, unitId) {
      return report?.trees[`${country}/${type}`]?.units[String(unitId || '').toLowerCase()] || null;
    },
    isHidden(country, type, unitId) {
      return report?.trees[`${country}/${type}`]?.units[String(unitId || '').toLowerCase()]?.hidden === true;
    },
    render(country, type) {
      activeTree = [country, type];
      const panel = document.getElementById('rosterAudit');
      if (!panel) return;
      const tree = report?.trees[`${country}/${type}`];
      const token = `${country}/${type}/${!!tree}/${window.WTI18n.locale}`;
      if (panel.dataset.tree === token) return;
      const sameTree = panel.dataset.tree?.startsWith(`${country}/${type}/`);
      panel.dataset.tree = token;
      if (!sameTree) panel.open = false;
      if (!tree) {
        panel.innerHTML = `<summary>${escape(t('载具收录对照暂不可用'))}</summary>`;
        return;
      }
      const unmatched = Object.entries(tree.units).filter(([, unit]) => !unit.matched);
      const total = tree.wikiCount + (tree.gameOnlyCount || 0);
      panel.innerHTML = `<summary>${escape(t('载具收录对照 · 已匹配 {matched}/{total} · 配置独有 {config} · Wiki 独有 {wiki}', { matched: tree.matched, total, config: tree.candidates.length, wiki: unmatched.length }))}</summary>
        <p>${escape(t('Datamine {version} · {commit} · 配置独有条目待核对，不代表可获取，不计入研发。', { version: report.version, commit: report.commit.slice(0, 7) }))}</p>
        <div class="roster-legend">${Object.entries(labels).map(([k,v]) => badge(k,v)).join('')}${hiddenBadge('')}</div>
        <ul class="roster-candidates">${tree.candidates.map(item => `<li><code>${escape(item.id)}</code><span>${escape(t('等级 {rank}', { rank: item.rank }))}</span>${badge('pending','待核对')}${item.isClanVehicle ? badge('squadron','联队载具') : ''}${item.showOnlyWhenBought ? hiddenBadge(item.id, item.id) : ''}</li>`).join('')}
        ${unmatched.map(([id,item]) => `<li><span>${escape(typeof displayTitle === 'function' ? displayTitle({ data_unit_id: id, title: item.title || id }) : item.title || id)}</span>${badge('pending','仅 Wiki 收录')}</li>`).join('')}</ul>
        ${!tree.candidates.length && !unmatched.length ? `<p>${escape(t('当前科技树无收录差异。'))}</p>` : ''}`;
    }
  };
  document.addEventListener('wt-language-change', () => {
    if (activeTree) window.RosterAudit.render(...activeTree);
    document.querySelectorAll('[data-roster-label]').forEach(element => {
      element.textContent = element.dataset.rosterLabel ? t(element.dataset.rosterLabel) : '';
      element.title = element.dataset.rosterTitle ? t(element.dataset.rosterTitle) : '';
    });
    document.querySelectorAll('[data-roster-hidden-help]').forEach(element => {
      element.textContent = t('持有后可见');
      element.title = t('点击查看隐藏载具说明');
    });
    const dialog = document.getElementById('rosterHiddenDialog');
    if (dialog?.open) {
      const focused = dialog.contains(document.activeElement);
      const scrollTop = dialog.scrollTop;
      renderHelp(dialog);
      dialog.scrollTop = scrollTop;
      if (focused) dialog.querySelector('[data-roster-help-close]').focus({ preventScroll: true });
    }
  });
})();

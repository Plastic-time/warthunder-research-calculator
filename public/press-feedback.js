(() => {
  'use strict';
  const selector = 'button, [role="button"], a[href], summary, label.planner-option, input[type="button"], input[type="submit"], input[type="reset"]';
  const instantSelector = 'label.planner-option, #selectTreeButton, [role="checkbox"], [role="switch"], [role="tab"], .branch-tab, .country-choice, .modification-edit-mode button, .usage-guide-tabs button';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  let active = null;
  let epoch = 0;
  let cancelledPointerAt = -Infinity;

  function controlFor(target) {
    const control = target.closest?.(selector);
    if (!control || control.matches(':disabled, [aria-disabled="true"]') || control.closest('[inert]')) return null;
    if (control.matches(instantSelector) || target.closest?.('input[type="checkbox"], input[type="radio"], select')) return null;
    if (!control.getClientRects().length || control.closest('[hidden], dialog:not([open])')) return null;
    if (control.matches('label') && control.querySelector('input:disabled')) return null;
    return control;
  }

  function surfacesFor(control) {
    // Scaling a tooltip's ancestor changes its containing block during the press.
    if (control.querySelector(':scope > .modification-action-label')) return [...control.querySelectorAll(':scope > .modification-action-icon')];
    if (control.matches('.unit-wiki-launch')) return [...control.querySelectorAll('.wiki-bookmark')];
    if (control.matches('.unit-tile')) return [...control.querySelectorAll(':scope > img, .unit-title')];
    if (control.matches('.modification-tile')) return [...control.querySelectorAll(':scope > img, .modification-ammunition, .modification-tile-copy')];
    return [control];
  }

  function clean(surface) {
    animations.get(surface)?.cancel();
    animations.delete(surface);
    surface.removeAttribute('data-press-feedback');
    surface.style.removeProperty('--press-scale');
  }

  function motionFor(control) {
    if (control.matches('.unit-tile, .modification-tile')) return {scale: 0.99, peak: 1, duration: 160};
    if (control.matches('.floating-plan-button, [data-modification-action="calculate"]')) return {scale: 0.975, peak: 1.006, duration: 220};
    return {scale: 0.98, peak: 1, duration: 160};
  }

  function clearPress() {
    if (active) active.surfaces.forEach(clean);
    active = null;
    disabledObserver.disconnect();
  }

  function reset() {
    epoch++;
    clearPress();
    for (const surface of [...animations.keys()]) clean(surface);
  }

  // Tree and modification clicks replace their DOM nodes synchronously.
  function resolver(control) {
    const root = control.closest('.folder-popup, #treeContainer, #modificationDialog') || document;
    const key = ['data-unit-id', 'data-mod-id', 'data-folder-key'].find(name => control.hasAttribute(name));
    const query = key ? `[${key}="${CSS.escape(control.getAttribute(key))}"]` : null;
    return () => control.isConnected ? control : query ? root.querySelector(query) : null;
  }

  function press(control, input) {
    clearPress();
    if (reducedMotion.matches) return;
    const surfaces = surfacesFor(control);
    if (!surfaces.length) return;
    surfaces.forEach(clean);
    const rect = control.getBoundingClientRect();
    const motion = motionFor(control);
    const {scale} = motion;
    active = {control, surfaces, motion, rect, ...input};
    for (const surface of surfaces) {
      surface.style.setProperty('--press-scale', String(scale));
      surface.setAttribute('data-press-feedback', 'pressed');
      if (surface.animate) {
        const animation = surface.animate([{scale: '1'}, {scale: String(scale)}], {duration: 70, easing: 'ease-out'});
        animations.set(surface, animation);
      }
    }
    disabledObserver.observe(control, {attributes: true, attributeFilter: ['disabled', 'aria-disabled']});
  }

  function rebound(findControl, motion, event) {
    const version = epoch;
    requestAnimationFrame(() => {
      if (version !== epoch || reducedMotion.matches || (event?.type === 'pointerup' && event.defaultPrevented)) return;
      const control = findControl();
      if (!control?.isConnected || !control.getClientRects().length || control.closest('[hidden], [inert], dialog:not([open])')) return;
      for (const surface of surfacesFor(control)) {
        if (!surface.animate) continue;
        clean(surface);
        surface.setAttribute('data-press-feedback', 'release');
        const frames = [{scale: String(motion.scale), offset: 0}];
        if (motion.peak > 1) frames.push({scale: String(motion.peak), offset: 0.65});
        frames.push({scale: '1', offset: 1});
        const animation = surface.animate(frames, {duration: motion.duration, easing: 'cubic-bezier(.2,.7,.3,1)'});
        animations.set(surface, animation);
        animation.onfinish = () => { if (animations.get(surface) === animation) clean(surface); };
      }
    });
  }

  const disabledObserver = new MutationObserver(() => {
    if (active?.control.matches(':disabled, [aria-disabled="true"]')) clearPress();
  });
  window.addEventListener('pointerdown', event => {
    clearPress();
    if (!event.isPrimary || event.button !== 0) return;
    const control = controlFor(event.target);
    if (control) press(control, {pointerId: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType});
  }, {capture: true, passive: true});
  window.addEventListener('pointermove', event => {
    if (!active || event.pointerId !== active.pointerId) return;
    const {rect, x, y, pointerType} = active;
    const moved = pointerType !== 'mouse' && Math.hypot(event.clientX - x, event.clientY - y) > 10;
    if (moved || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      cancelledPointerAt = performance.now();
      clearPress();
    }
  }, {capture: true, passive: true});
  window.addEventListener('pointerup', event => {
    if (!active || event.pointerId !== active.pointerId) return;
    const {control, motion, rect} = active;
    const find = resolver(control);
    clearPress();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) rebound(find, motion, event);
  }, {capture: true, passive: true});
  window.addEventListener('pointercancel', () => {cancelledPointerAt = performance.now(); reset();}, {capture: true, passive: true});
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { reset(); return; }
    if (event.repeat || ![' ', 'Enter'].includes(event.key)) return;
    const control = controlFor(event.target);
    if (control && !(control.matches('a') && event.key === ' ')) press(control, {key: event.key});
  }, true);
  window.addEventListener('keyup', event => { if (active?.key === event.key) clearPress(); }, true);
  window.addEventListener('click', event => {
    if (event.detail !== 0 || !event.isTrusted || performance.now() - cancelledPointerAt < 500) return;
    const control = controlFor(event.target);
    if (!control) return;
    const find = resolver(control);
    clearPress();
    rebound(find, motionFor(control));
  }, true);
  window.addEventListener('blur', reset);
  document.addEventListener('focusout', event => { if (active?.control === event.target) clearPress(); }, true);
  document.addEventListener('scroll', reset, {capture: true, passive: true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  reducedMotion.addEventListener('change', reset);
})();

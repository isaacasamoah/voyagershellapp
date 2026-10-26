function createPanelFocus(panel) {
  let saved;
  function remember(node) {
    saved = {
      control: node.id,
      vessel: node.closest?.('[data-vessel]')?.dataset.vessel || node.dataset.key,
    };
    return saved;
  }
  panel.addEventListener('focusin', (event) => remember(event.target));
  return {
    capture() {
      const active = document.activeElement;
      return active && active !== document.body ? remember(active) : saved;
    },
    restore(before, groups) {
      if (!before) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const get = (id) => document.getElementById(id);
      const visible = (node) => node && !node.disabled && node.getClientRects?.().length > 0;
      const previous = [...groups.previous, ...groups.removed].some(
        (row) => row.id === before.vessel,
      );
      let target =
        previous && !get('previous-agents').open
          ? get('previous-toggle')
          : get(before.control) || get(`inspect-${before.vessel}`);
      if (!visible(target)) {
        if (previous) target = get('previous-toggle');
        else if (groups.attention.some((row) => row.id === before.vessel))
          target = get('attention-heading');
        else target = get('current-heading');
      }
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: 'nearest' });
      }
    },
  };
}

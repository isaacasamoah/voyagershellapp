(() => {
  const panel = document.createElement("div");
  panel.id = "content-picker";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Open a Vessel");
  document.body.append(panel);
  let types = [];
  let current;

  function close(restore = false) {
    const opener = current?.anchor();
    const inside = panel.contains(document.activeElement);
    current = undefined;
    panel.hidePopover();
    if ((restore || inside) && opener?.isConnected) opener.focus();
  }

  function position() {
    if (!current) return;
    const rect = current.anchor()?.getBoundingClientRect();
    if (!rect) return close();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - bounds.height - 8))}px`;
  }

  function render() {
    if (!current) return;
    const selected = document.activeElement?.dataset.type;
    const title = document.createElement("div");
    title.className = "picker-title";
    title.textContent = current.title;
    const request = current;
    const choices = types.map((type) => {
      const node = document.createElement("button");
      node.type = "button";
      node.dataset.type = type.id;
      node.textContent = type.name;
      node.onclick = () => {
        if (current !== request || !types.some((item) => item.id === type.id))
          return;
        const select = request.select;
        close();
        Promise.resolve(select(type.id)).catch(() => {});
      };
      return node;
    });
    panel.replaceChildren(title, ...choices);
    if (!choices.length) {
      const empty = document.createElement("p");
      empty.textContent = "No content types available";
      panel.append(empty);
    }
    position();
    if (selected)
      (
        choices.find((node) => node.dataset.type === selected) || choices[0]
      )?.focus();
  }

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close(true);
      return;
    }
    const choices = [...panel.querySelectorAll("button")];
    const index = choices.indexOf(document.activeElement);
    const next = {
      ArrowDown: (index + 1) % choices.length,
      ArrowUp: (index - 1 + choices.length) % choices.length,
      Home: 0,
      End: choices.length - 1,
    }[event.key];
    if (next !== undefined && choices[next]) {
      event.preventDefault();
      choices[next].focus();
    }
  });
  panel.addEventListener("toggle", (event) => {
    if (event.newState === "closed" && !panel.matches(":popover-open")) close();
  });
  window.addEventListener("resize", position);
  window.contentPicker = {
    open(anchor, title, select) {
      close();
      current = { anchor, title, select };
      render();
      panel.showPopover();
      position();
      panel.querySelector("button")?.focus();
    },
    update(value) {
      types = value;
      if (panel.matches(":popover-open")) render();
    },
    close,
  };
})();

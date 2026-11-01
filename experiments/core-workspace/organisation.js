(() => {
  let preview;
  let cancelled = false;
  let lastClick;
  const vesselDrag = "application/x-voyager-portal";
  const navigationDrag = "application/x-voyager-navigation";
  const refocus = (selector) =>
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        document.querySelector(selector)?.focus();
    });

  function clear() {
    preview?.remove();
    preview = null;
    document
      .querySelectorAll(".drop-before,.drop-after,.drop-here")
      .forEach((node) =>
        node.classList.remove("drop-before", "drop-after", "drop-here"),
      );
    document.body.classList.remove("moving-portal");
  }

  function edit(label, item, field, kind, selector) {
    if (!label.isConnected || document.querySelector(".inline-name")) return;
    lastClick = null;
    const input = element("input", "inline-name");
    input.value = item[field];
    input.maxLength = 80;
    input.setAttribute("aria-label", `Rename ${kind}`);
    const currentLabel = () =>
      document
        .querySelector(selector)
        ?.querySelector(".realm-name,.dimension-name,.portal-title") || label;
    const position = () => {
      const anchor = currentLabel();
      anchor.style.visibility = "hidden";
      const rect = anchor.getBoundingClientRect();
      Object.assign(input.style, {
        left: `${rect.left - 4}px`,
        top: `${rect.top - 5}px`,
        width: `${Math.max(rect.width + 8, 100)}px`,
      });
    };
    position();
    document.body.append(input);
    let finished = false;
    const finish = async (save, restoreFocus = false) => {
      if (finished) return;
      finished = true;
      label.style.visibility = "";
      currentLabel().style.visibility = "";
      const name = input.value.trim();
      input.remove();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (save && !name) notify("Enter a name to save it.");
      if (save && name && name !== item[field]) {
        try {
          await act("rename", { id: item.id, name });
        } catch {
          if (restoreFocus) refocus(selector);
          return;
        }
      }
      if (restoreFocus) refocus(selector);
    };
    input.onkeydown = (event) => {
      event.stopPropagation();
      if (["Enter", "Escape"].includes(event.key)) {
        event.preventDefault();
        finish(event.key === "Enter", true);
      }
    };
    input.onblur = () => finish(true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    input.focus();
    input.select();
  }

  function fleetDrop(node, item) {
    node.ondragover = (event) => {
      if (cancelled || !event.dataTransfer.types.includes(vesselDrag)) return;
      event.preventDefault();
      node.classList.add("drop-here");
    };
    node.ondragleave = () => node.classList.remove("drop-here");
    node.ondrop = (event) => {
      if (!event.dataTransfer.types.includes(vesselDrag)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = event.dataTransfer.getData(vesselDrag);
      clear();
      if (!cancelled && id)
        act("move", { id, dimension: item.id }).catch(() => {});
    };
  }

  function previewFleets(realm, node) {
    if (preview?.dataset.realm === realm.id) return;
    preview?.remove();
    preview = element("div", "drag-fleets");
    preview.dataset.realm = realm.id;
    preview.setAttribute("aria-label", `Move Vessel into ${realm.name}`);
    preview.append(element("small", "", realm.name));
    for (const fleet of realm.dimensions) {
      const target = button(`Move into ${fleet.name}`, fleet.name, () => {});
      fleetDrop(target, fleet);
      preview.append(target);
    }
    const rect = node.getBoundingClientRect();
    Object.assign(preview.style, {
      left: `${Math.min(rect.right + 6, window.innerWidth - 230)}px`,
      top: `${Math.max(6, Math.min(rect.top, window.innerHeight - realm.dimensions.length * 40 - 50))}px`,
    });
    document.body.append(preview);
  }

  function navigation(node, item, entity) {
    const selector = `[data-${entity}="${CSS.escape(item.id)}"]`;
    const label = node.querySelector(
      entity === "realm" ? ".realm-name" : ".dimension-name",
    );
    const rename = () =>
      edit(
        label,
        item,
        "name",
        entity === "realm" ? "Voyage" : "Fleet",
        selector,
      );
    node.ondblclick = rename;
    const select = node.onclick;
    node.onclick = (event) => {
      const double =
        event.detail > 1 ||
        (event.detail > 0 &&
          lastClick?.id === item.id &&
          lastClick.entity === entity &&
          event.timeStamp - lastClick.at < 500);
      lastClick =
        event.detail > 0 ? { id: item.id, entity, at: event.timeStamp } : null;
      if (double) rename();
      else if (!node.classList.contains("active")) select(event);
    };
    node.title +=
      entity === "realm"
        ? " · F2 rename · Alt+Shift+Up/Down reorder"
        : " · F2 rename · Alt+Shift+Left/Right reorder";
    node.addEventListener("keydown", (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        rename();
      }
      const keys =
        entity === "realm"
          ? ["ArrowUp", "ArrowDown"]
          : ["ArrowLeft", "ArrowRight"];
      if (!event.altKey || !event.shiftKey || !keys.includes(event.key)) return;
      event.preventDefault();
      const items =
        entity === "realm"
          ? state.realms
          : state.realms.find((r) => r.dimensions.some((d) => d.id === item.id))
              .dimensions;
      const direction = event.key === keys[0] ? -1 : 1;
      const target =
        items[items.findIndex((x) => x.id === item.id) + direction];
      if (target)
        act("reorder", {
          entity,
          id: item.id,
          target: target.id,
          after: direction > 0,
        })
          .then(() => refocus(selector))
          .catch(() => {});
    });
    node.draggable = true;
    node.ondragstart = (event) => {
      if (event.target.closest("#voyager-avatar")) return;
      cancelled = false;
      event.dataTransfer.setData(
        navigationDrag,
        JSON.stringify({ entity, id: item.id }),
      );
    };
    if (entity === "dimension") fleetDrop(node, item);
    const previousOver = node.ondragover;
    const previousDrop = node.ondrop;
    node.ondragover = (event) => {
      if (cancelled) return;
      if (event.dataTransfer.types.includes(vesselDrag)) {
        if (entity === "realm") previewFleets(item, node);
        else previousOver(event);
        return;
      }
      if (!event.dataTransfer.types.includes(navigationDrag)) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const after =
        entity === "realm"
          ? event.clientY > rect.top + rect.height / 2
          : event.clientX > rect.left + rect.width / 2;
      node.classList.toggle("drop-after", after);
      node.classList.toggle("drop-before", !after);
    };
    node.ondragleave = () =>
      node.classList.remove("drop-before", "drop-after", "drop-here");
    node.ondrop = (event) => {
      if (event.dataTransfer.types.includes(vesselDrag)) {
        previousDrop?.(event);
        return;
      }
      if (!event.dataTransfer.types.includes(navigationDrag)) return;
      event.preventDefault();
      const after = node.classList.contains("drop-after");
      try {
        const source = JSON.parse(event.dataTransfer.getData(navigationDrag));
        if (!cancelled && source.entity === entity && source.id !== item.id)
          act("reorder", {
            entity,
            id: source.id,
            target: item.id,
            after,
          }).catch(() => {});
      } catch {
        notify("That navigation item could not be moved.");
      }
      clear();
    };
  }

  function vessel(head, title, item) {
    head.draggable = true;
    head.addEventListener("keydown", (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        edit(
          title,
          item,
          "title",
          "Vessel",
          `.portal[data-portal="${CSS.escape(item.id)}"] .portal-header`,
        );
      }
    });
    title.ondblclick = () =>
      edit(
        title,
        item,
        "title",
        "Vessel",
        `.portal[data-portal="${CSS.escape(item.id)}"] .portal-header`,
      );
    title.title = "Double-click to rename · Drag header to place · F2 rename";
    head.ondragstart = (event) => {
      if (event.target.closest("button,#voyager-avatar")) {
        event.preventDefault();
        return;
      }
      cancelled = false;
      event.dataTransfer.setData(vesselDrag, item.id);
      document.body.classList.add("moving-portal");
    };
  }

  document.addEventListener("dragend", clear);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cancelled = true;
      clear();
    }
  });
  window.organisation = { navigation, vessel, canDrop: () => !cancelled };
})();

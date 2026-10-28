"use strict";
(() => {
  // src/webview/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "class") {
        node.className = String(value);
      } else {
        node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  // src/hotkey.ts
  function hotkeyLabel(hotkey) {
    const name = (mod) => mod === "Control" ? "Ctrl" : mod === "Super" ? "Win" : mod;
    return hotkey.split("+").map((part) => {
      const [key, times] = part.split("*");
      const side = /^(Left|Right)(Control|Shift|Alt|Super)$/.exec(key ?? "");
      if (side) return `${side[1]} ${name(side[2])}${times === "2" ? " twice" : ""}`;
      if (part === "CapsLock") return "Caps Lock";
      if (part === "ScrollLock") return "Scroll Lock";
      if (part === "MouseBack") return "Mouse Back";
      if (part === "MouseForward") return "Mouse Forward";
      if (part === "CommandOrControl" || part === "CmdOrCtrl") return "Ctrl";
      return name(part);
    }).join("+");
  }

  // src/webview/keycaps.ts
  function caps(hotkey, chain) {
    const attrs = chain ? { class: "kg", "data-chain": chain } : { class: "kg" };
    if (!hotkey) return el("span", attrs, el("span", { class: "key none" }, "not set"));
    const twice = hotkey.endsWith("*2");
    const parts = hotkey.replace(/\*2$/, "").split("+");
    return el("span", attrs, ...parts.map((part) => el("span", { class: "key" }, hotkeyLabel(part))), twice ? el("span", { class: "x2" }, "\xD72") : null);
  }

  // src/webview/tray.ts
  var post = (message) => window.tutorHost.post(message);
  var root = document.getElementById("root");
  function command(label, run, hotkey = "") {
    return el("button", { class: "cmd", "data-nav": true, onclick: () => post({ type: "tray", command: run }) }, el("span", { class: "l" }, label), hotkey ? caps(hotkey) : null);
  }
  var grp = (text) => el("div", { class: "grp" }, text);
  function status(v) {
    switch (v.translator) {
      case "ready":
        return el("span", { class: "st", title: `${v.native} \u21C4 English, offline` }, el("span", { class: "dot" }), "ready");
      case "downloading":
        return el("span", { class: "st" }, "downloading\u2026");
      case "absent":
        return el("span", { class: "st" }, "translator on first use");
      default:
        return null;
    }
  }
  function render(v) {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.id : void 0;
    const knob = el("span", { class: v.autoFix ? "tg on" : "tg" });
    const fix = el(
      "button",
      {
        class: "cmd trow",
        "data-nav": true,
        "data-id": "autoFix",
        role: "switch",
        "aria-checked": String(v.autoFix),
        // Saved at once; the panel stays, as a switch is not a command.
        onclick: () => {
          const next = fix.getAttribute("aria-checked") !== "true";
          fix.setAttribute("aria-checked", String(next));
          knob.classList.toggle("on", next);
          post({ type: "saveSettings", patch: { autoFix: next } });
        }
      },
      el("span", { class: "l" }, "Fix the layout as I type"),
      knob
    );
    const cmds = [
      command("Listen", "listenCopied", v.keys.listenCopied),
      command("Translate", "translateCopied"),
      command("Listen", "listenScreen", v.keys.snipListen),
      command("Translate", "translateScreen", v.keys.snipTranslate)
    ];
    cmds.forEach((c, i) => c.dataset.id = String(i));
    const note = command(v.speech.recording ? "Save the note" : "New note", "note", v.speech.noteKey);
    note.dataset.id = "note";
    const transcripts = command("Transcripts", "transcripts");
    transcripts.dataset.id = "transcripts";
    const openApp = () => post({ type: "tray", command: "open" });
    const brand = el("button", { class: "brand", tabindex: "-1", title: "Open Altype", onclick: openApp }, el("span", { class: "key" }, "alt"), el("span", { class: "wm" }, "altype"));
    const open = el("button", { class: "open", "data-nav": true, "data-id": "open", onclick: openApp }, "Open");
    const quit = command("Quit", "quit");
    quit.dataset.id = "quit";
    const panel = el(
      "div",
      { class: "panel" },
      el("header", { class: "head" }, brand, el("div", { class: "side" }, status(v), open)),
      el("section", { class: "sec" }, grp("Copied text"), cmds[0], cmds[1]),
      el("section", { class: "sec" }, grp("A piece of the screen"), cmds[2], cmds[3]),
      v.speech.installed ? el("section", { class: "sec" }, grp("Speech"), note, transcripts) : null,
      el("section", { class: "sec sw" }, fix),
      el("section", { class: "sec" }, quit)
    );
    root.replaceChildren(panel);
    if (focused) focusRow(root.querySelector(`[data-id="${focused}"]`));
  }
  function focusRow(node) {
    if (!node) return;
    node.focus();
    for (const other of root.querySelectorAll(".cur")) if (other !== node) other.classList.remove("cur");
    node.classList.add("cur");
  }
  var navs = () => [...root.querySelectorAll("[data-nav]")];
  function move(by) {
    const all = navs();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement);
    const next = at < 0 ? by > 0 ? 0 : all.length - 1 : (at + by + all.length) % all.length;
    focusRow(all[next]);
  }
  var byKeys = (on) => document.body.classList.toggle("keys", on);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return post({ type: "trayClose" });
    }
    byKeys(true);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  window.addEventListener("pointermove", () => byKeys(false));
  window.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.nav !== void 0) focusRow(event.target);
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const m = event.data;
    if (m.type === "tray") render(m.view);
    else if (m.type === "trayShown") {
      byKeys(false);
      focusRow(root.querySelector(".cmd[data-nav]"));
    }
  });
  new ResizeObserver(() => post({ type: "trayHeight", px: Math.ceil(document.body.getBoundingClientRect().height) + 2 })).observe(document.body);
  post({ type: "trayReady" });
})();

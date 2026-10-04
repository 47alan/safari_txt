// ==UserScript==
// @name         常用站点
// @namespace    quick-sites
// @version      1.1.0
// @updateURL    https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E5%B8%B8%E7%94%A8%E7%AB%99%E7%82%B9.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E5%B8%B8%E7%94%A8%E7%AB%99%E7%82%B9.user.js
// @description  悬浮球菜单里的「常用站点」：轻点即在新标签页打开常去的网站，不用再翻书签；面板里可直接输入网址添加，也可一键加入当前页，删除也在面板里。与广告过滤 / 视频嗅探 / 阅读模式 / NSFW 脚本共用同一个悬浮球。
// @author       you
// @match        *://*/*
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  /* 想加站点就在这里加一行：name 随便写，url 要带 https://。
   * 含羞草这类经常换域名的站不写死：在它的页面上打开面板点「把当前页加入」即可，
   * 加进去的条目存在脚本自己的存储里，所有网站都能看到。 */
  const SITES = [
    { name: '3*O（media）', url: 'https://media.3go.fun/' },
    { name: '3*O（tube）', url: 'https://tube.3go.fun/' },
    { name: 'SP*', url: 'https://up.sp2026.com/' },
    { name: '91', url: 'https://www.91porn.com/' },
    { name: '*王论坛', url: 'https://laowang.vip/' },
    { name: 'J*vhub', url: 'https://javhub.net/' },
    { name: 'X*sian', url: 'https://xasian.org/' },
    { name: '爱*社区', url: 'https://bbav110.com/' },
    { name: '春*院', url: 'https://chunman4.com/' },
    { name: 'mrds · 短视频', url: 'https://mrds.com/category/blyp/' },
    { name: 'hl365', url: 'https://hl365.com/' },
  ];

  // BEGIN shared safari tools dock
  // 两个可独立安装的脚本内嵌同一入口；只通过 DOM 注册功能，不依赖共享 JS 全局变量。
  // 注册协议：菜单项 append 到 #tool-actions；主图标上方的 #before、下方的 #after 是两个插槽，
  // 各脚本可往里 append <button type="button" aria-label="…"><span>图标</span></button>，span 会画成 28px 小圆钮，
  // 按钮行为由注册它的脚本自己监听 click。入口只负责排版、整组拖动、显隐与触摸兼容，不含任何具体功能。
  function sharedToolsDock() {
    const id = '__safari_tools_dock__';
    const existing = document.getElementById(id);
    if (existing && existing.shadowRoot) return existing.shadowRoot;
    const positionKey = '__safari_tools_position_v1__';
    const size = 44; // 每个按钮的点击区域 44px，实际可见的小圆点更小。
    const dock = document.createElement('div');
    dock.id = id;
    dock.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;pointer-events:none!important;z-index:2147483647!important;';
    const ui = dock.attachShadow({ mode: 'open' });
    ui.innerHTML = `
      <style>
        :host { color-scheme: light; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        #stack { position: fixed; width: 44px; margin: 0; padding: 0; display: flex; flex-direction: column; pointer-events: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
        .slot { display: flex; flex-direction: column; }
        #stack button { width: 44px; height: 44px; margin: 0; padding: 6px; border: 0; background: transparent; color: #146b56; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
        #launcher { cursor: grab; }
        .slot > button { cursor: pointer; }
        #stack.dragging button { cursor: grabbing; }
        #glyph { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #146b56; color: #fff; box-shadow: 0 2px 9px #173d3238; font: 600 23px/1 -apple-system, system-ui, sans-serif; opacity: .82; }
        .slot > button > span { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #fff; border: 1.5px solid currentColor; box-shadow: 0 2px 9px #173d3238; font: 600 15px/1 -apple-system, system-ui, sans-serif; opacity: .82; }
        .slot svg { width: 16px; height: 16px; display: block; }
        #stack button:focus-visible { outline: 2px solid #16826a; outline-offset: 1px; border-radius: 50%; }
        #stack button:hover > *, #stack button:focus-visible > *, #stack.dragging button > * { opacity: 1; }
        #launcher.active #glyph { background: #d83c35; }
        #tool-menu { position: fixed; width: 212px; padding: 6px; border: 1px solid #d5dfdc; border-radius: 15px; background: #fff; color: #183a32; box-shadow: 0 5px 25px #173d3230; pointer-events: auto; overflow: auto; overscroll-behavior: contain; font: 14px/1.4 -apple-system, system-ui, sans-serif; text-align: left; }
        #tool-actions { display: flex; flex-direction: column; gap: 2px; }
        #tool-actions > button { width: 100%; min-height: 44px; margin: 0; padding: 10px 12px; border: 0; border-radius: 9px; background: transparent; color: #183a32; font: inherit; font-weight: 600; text-align: left; cursor: pointer; touch-action: manipulation; }
        #tool-actions > button:hover, #tool-actions > button:active { background: #e8f4ef; }
        #tool-actions > button:focus-visible { outline: 2px solid #16826a; outline-offset: -2px; }
        .hint { margin: 7px 4px 4px; color: #6a7c73; font-size: 11px; text-align: center; }
        #safe-area { position: fixed; visibility: hidden; pointer-events: none; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
      </style>
      <div id="stack" hidden>
        <div id="before" class="slot"></div>
        <button id="launcher" type="button" aria-label="网页工具（拖动可移动）" title="网页工具（拖动可移动）" aria-expanded="false" aria-controls="tool-menu" hidden><span id="glyph" aria-hidden="true">⋮</span></button>
        <div id="after" class="slot"></div>
      </div>
      <div id="tool-menu" role="group" aria-label="网页工具" hidden><div id="tool-actions"></div><p class="hint">拖动悬浮球可移动 · 自动记住位置</p></div>
      <div id="safe-area" aria-hidden="true"></div>`;
    document.documentElement.appendChild(dock);
    const stack = ui.getElementById('stack');
    const launcher = ui.getElementById('launcher');
    const glyph = ui.getElementById('glyph');
    const menu = ui.getElementById('tool-menu');
    const actions = ui.getElementById('tool-actions');
    const slots = Array.from(ui.querySelectorAll('.slot'));
    let position = { x: 1, y: 1 };
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        position = { x: Math.max(0, Math.min(1, saved.x)), y: Math.max(0, Math.min(1, saved.y)) };
      }
    } catch (error) {}
    let drag = null;
    let suppressClick = false;

    // 主图标加上插槽里未隐藏的小圆钮，就是整组按钮的高度。
    function stackHeight() {
      return size * (1 + slots.reduce((count, slot) => count + Array.from(slot.children).filter(button => !button.hidden).length, 0));
    }

    // 整组按钮左上角允许出现的范围；right + size / bottom + stackHeight() 才是可用区域的右缘和下缘。
    function bounds() {
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0;
      const top = viewport ? viewport.offsetTop : 0;
      const width = viewport ? viewport.width : window.innerWidth;
      const height = viewport ? viewport.height : window.innerHeight;
      const safe = getComputedStyle(ui.getElementById('safe-area'));
      const minimumX = left + 8 + (parseFloat(safe.paddingLeft) || 0);
      const minimumY = top + 8 + (parseFloat(safe.paddingTop) || 0);
      return { left: minimumX, top: minimumY,
        right: Math.max(minimumX, left + width - size - 8 - (parseFloat(safe.paddingRight) || 0)),
        bottom: Math.max(minimumY, top + height - stackHeight() - 12 - (parseFloat(safe.paddingBottom) || 0)) };
    }

    function placeMenu() {
      if (menu.hidden) return;
      const box = bounds();
      const edgeX = box.right + size;
      const edgeY = box.bottom + stackHeight();
      menu.style.width = Math.min(212, edgeX - box.left) + 'px';
      menu.style.maxHeight = (edgeY - box.top) + 'px';
      const anchor = stack.getBoundingClientRect();
      const rect = menu.getBoundingClientRect();
      const clampX = value => Math.max(box.left, Math.min(edgeX - rect.width, value));
      const clampY = value => Math.max(box.top, Math.min(edgeY - rect.height, value));
      let left = clampX(anchor.right - rect.width);
      let top = anchor.top - 6 - rect.height;
      if (top < box.top) {
        // 上方放不下就放下方；再放不下就挪到侧边，尽量别压住按钮。
        if (anchor.bottom + 6 + rect.height <= edgeY) top = anchor.bottom + 6;
        else {
          top = anchor.top + (anchor.height - rect.height) / 2;
          if (anchor.left - 6 - rect.width >= box.left) left = anchor.left - 6 - rect.width;
          else if (anchor.right + 6 + rect.width <= edgeX) left = anchor.right + 6;
          else top = anchor.bottom + 6;
        }
      }
      menu.style.left = left + 'px';
      menu.style.top = clampY(top) + 'px';
    }

    function placeStack() {
      const box = bounds();
      stack.style.left = (box.left + position.x * (box.right - box.left)) + 'px';
      stack.style.top = (box.top + position.y * (box.bottom - box.top)) + 'px';
      placeMenu();
    }

    function setMenu(open) {
      menu.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
      if (open) placeMenu();
    }

    function entries() { return Array.from(actions.children); }
    function activeEntry() { return entries().find(button => button.dataset.active === 'true'); }
    function update() {
      const buttons = entries();
      const hidden = !buttons.some(button => !button.hidden) || buttons.some(button => button.dataset.panelOpen === 'true');
      if (stack.hidden !== hidden) stack.hidden = hidden; // 插槽里的小圆钮跟主图标一起显示、一起隐藏
      if (launcher.hidden !== hidden) launcher.hidden = hidden; // 兼容按 launcher.hidden 判断入口是否可见的调用方
      const active = activeEntry();
      launcher.classList.toggle('active', !!active);
      glyph.textContent = active ? '×' : '⋮';
      const label = active ? '退出点选隐藏（拖动可移动）' : '网页工具（拖动可移动）';
      launcher.setAttribute('aria-label', label);
      launcher.title = label;
      if (hidden || active) setMenu(false);
      placeStack(); // 插槽增减会改变整组高度，顺便重新定位
    }

    function pressedButton(event) {
      const node = event.target;
      return node && typeof node.closest === 'function' ? node.closest('button') : null;
    }
    function activateLauncher() {
      const active = activeEntry();
      if (active) active.click();
      else setMenu(menu.hidden);
    }
    function activate(button) {
      if (button === launcher) activateLauncher();
      else button.click(); // 插槽按钮的行为由注册它的脚本在 click 里实现
    }
    stack.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      const button = pressedButton(event);
      if (!button) return;
      suppressClick = false; // 上一次拖动没有产生 click，也不能吞掉下一次正常轻点。
      const rect = stack.getBoundingClientRect();
      drag = { id: event.pointerId, button, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      try { button.setPointerCapture(event.pointerId); } catch (error) {}
    });
    stack.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      suppressClick = true;
      event.preventDefault();
      stack.classList.add('dragging');
      setMenu(false);
      const box = bounds();
      const left = Math.max(box.left, Math.min(box.right, drag.left + dx));
      const top = Math.max(box.top, Math.min(box.bottom, drag.top + dy));
      position = { x: box.right === box.left ? 0 : (left - box.left) / (box.right - box.left),
        y: box.bottom === box.top ? 0 : (top - box.top) / (box.bottom - box.top) };
      placeStack();
    }, { passive: false });
    function finishDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const { moved, button } = drag;
      drag = null;
      stack.classList.remove('dragging');
      if (moved) {
        suppressClick = true;
        try { localStorage.setItem(positionKey, JSON.stringify(position)); } catch (error) {}
      }
      try { if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId); } catch (error) {}
      // 移动浏览器在拖动之后可能不再合成下一次 tap 的 click，直接处理触摸抬起。
      // 若仍收到兼容 click，则吞掉它，避免菜单瞬间打开又关闭、插槽按钮触发两次。
      if (!moved && event.type === 'pointerup' && event.pointerType === 'touch') {
        suppressClick = true;
        activate(button);
      }
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => stack.addEventListener(name, finishDrag));
    // 捕获阶段先拦掉拖动或触摸抬起之后浏览器补发的兼容 click，别让它再传到按钮自己的监听器。
    stack.addEventListener('click', event => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    stack.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const button = pressedButton(event);
      if (button === launcher) activateLauncher();
      else if (button) setMenu(false); // 点了旁边的小圆钮，菜单顺手收起
    });
    launcher.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' || activeEntry()) return;
      event.preventDefault();
      setMenu(true);
      const first = entries().find(button => !button.hidden);
      if (first) first.focus({ preventScroll: true });
    });
    menu.addEventListener('click', event => {
      if (event.target.closest('button')) setMenu(false);
    });
    document.addEventListener('pointerdown', event => {
      if (!event.composedPath().includes(dock)) setMenu(false);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        setMenu(false);
        launcher.focus({ preventScroll: true });
      }
    });
    dock.addEventListener('safari-tools-update', update);
    new MutationObserver(update).observe(actions, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['hidden', 'data-active', 'data-panel-open'] });
    slots.forEach(slot => new MutationObserver(update).observe(slot, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['hidden'] }));
    new MutationObserver(() => {
      if (!dock.isConnected && document.documentElement) document.documentElement.appendChild(dock);
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', placeStack, { passive: true });
    window.addEventListener('pageshow', placeStack, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', placeStack, { passive: true });
      window.visualViewport.addEventListener('scroll', placeStack, { passive: true });
    }
    placeStack();
    update();
    return ui;
  }
  // END shared safari tools dock

  const KEY = 'quick_sites_custom_v1';

  /* -------------------- 自定义条目的存储（脚本级，跨网站） -------------------- */
  function gmObject() {
    try { if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') return GM; } catch (e) {}
    return null;
  }
  function storageReady() {
    return !!gmObject() || typeof GM_getValue === 'function';
  }
  function validSite(item) {
    return item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url) && typeof item.name === 'string';
  }
  async function loadCustom() {
    let raw = '[]';
    try {
      const gm = gmObject();
      if (gm) raw = await gm.getValue(KEY, '[]');
      else if (typeof GM_getValue === 'function') raw = GM_getValue(KEY, '[]');
    } catch (e) {}
    try {
      const list = JSON.parse(raw || '[]');
      return Array.isArray(list) ? list.filter(validSite) : [];
    } catch (e) { return []; }
  }
  async function saveCustom(list) {
    const raw = JSON.stringify(list);
    try {
      const gm = gmObject();
      if (gm && typeof gm.setValue === 'function') await gm.setValue(KEY, raw);
      else if (typeof GM_setValue === 'function') GM_setValue(KEY, raw);
    } catch (e) {}
  }

  /* -------------------- 面板 -------------------- */
  const host = document.createElement('div');
  host.id = '__quick_sites__';
  host.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483646!important;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host { color-scheme: light; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      #backdrop { position: fixed; inset: 0; background: #0003; }
      #panel { position: fixed; left: 50%; top: calc(10vh + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
        width: min(380px, calc(100vw - 24px)); max-height: calc(78vh - env(safe-area-inset-top, 0px)); display: flex; flex-direction: column;
        border-radius: 16px; background: #fff; color: #183a32; box-shadow: 0 10px 40px #0004;
        font: 15px/1.4 -apple-system, system-ui, sans-serif; overflow: hidden; }
      .hd { display: flex; align-items: center; gap: 8px; padding: 12px 10px 10px 16px; border-bottom: 1px solid #e3ebe8; }
      .hd b { font-size: 16px; }
      .hd .sub { flex: 1; color: #6a7c73; font-size: 12px; }
      .hd button { width: 36px; height: 36px; border: 0; border-radius: 50%; background: #eef4f1; color: #183a32; font-size: 16px; cursor: pointer; }
      #list { overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 6px 8px; }
      .row { display: flex; align-items: center; gap: 4px; }
      .row a { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 10px 10px; border-radius: 10px; color: inherit; text-decoration: none; -webkit-touch-callout: default; }
      .row a:active, .row a:hover { background: #e8f4ef; }
      .row .name { font-weight: 600; }
      .row .url { color: #6a7c73; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .row button { flex: 0 0 auto; min-width: 44px; height: 40px; border: 0; border-radius: 8px; background: transparent; color: #b3403a; font: inherit; font-size: 13px; cursor: pointer; }
      .empty { padding: 20px; text-align: center; color: #6a7c73; font-size: 13px; }
      .ft { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid #e3ebe8; }
      .ft form { display: flex; flex-wrap: wrap; gap: 6px; }
      .ft input { flex: 1 1 120px; min-width: 0; min-height: 40px; padding: 6px 10px; border: 1px solid #cbdad3; border-radius: 10px; background: #fff; color: inherit; font: inherit; font-size: 14px; }
      .ft input:focus { outline: 2px solid #16826a; outline-offset: 1px; }
      .ft button { min-height: 40px; padding: 8px 14px; border: 0; border-radius: 10px; background: #146b56; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
      .ft button.secondary { background: #eef4f1; color: #146b56; }
      .ft .row2 { display: flex; align-items: center; gap: 8px; }
      .ft .hint { flex: 1; color: #6a7c73; font-size: 12px; }
    </style>
    <div id="backdrop" hidden></div>
    <div id="panel" role="dialog" aria-label="常用站点" hidden>
      <div class="hd"><b>常用站点</b><span class="sub">轻点在新标签页打开</span><button type="button" data-act="close" aria-label="关闭">✕</button></div>
      <div id="list"></div>
      <div class="ft">
        <form id="add-form" autocomplete="off">
          <input id="add-name" type="text" placeholder="名称（可不填）" autocapitalize="off" autocorrect="off" spellcheck="false">
          <input id="add-url" type="text" inputmode="url" placeholder="网址，如 example.com 或 https://…" autocapitalize="off" autocorrect="off" spellcheck="false" required>
          <button type="submit">添加</button>
        </form>
        <div class="row2"><button type="button" class="secondary" data-act="add">把当前页加入</button><span class="hint"></span></div>
      </div>
    </div>`;
  const backdrop = ui.getElementById('backdrop');
  const panel = ui.getElementById('panel');
  const list = ui.getElementById('list');
  const addButton = panel.querySelector('[data-act="add"]');
  const addForm = ui.getElementById('add-form');
  const nameInput = ui.getElementById('add-name');
  const urlInput = ui.getElementById('add-url');
  const hint = panel.querySelector('.hint');
  let custom = [];
  let entry = null;

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return u.host + (u.pathname === '/' ? '' : u.pathname) + u.search;
    } catch (e) { return url; }
  }
  function row(item, index) {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name || shortUrl(item.url);
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = shortUrl(item.url);
    link.append(name, url);
    wrap.appendChild(link);
    if (index >= 0) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删除';
      del.setAttribute('aria-label', '删除 ' + name.textContent);
      del.dataset.del = String(index);
      wrap.appendChild(del);
    }
    return wrap;
  }
  function render() {
    list.innerHTML = '';
    SITES.forEach((item) => list.appendChild(row(item, -1)));
    custom.forEach((item, index) => list.appendChild(row(item, index)));
    if (!list.children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '还没有站点，点下面「把当前页加入」';
      list.appendChild(empty);
    }
    const ready = storageReady();
    addButton.hidden = !ready;
    addForm.hidden = !ready;
    hint.textContent = ready ? '自己加的条目所有网站共用' : '此环境不支持保存，请直接编辑脚本顶部的列表';
  }

  // 用户手输的网址：没写协议就补 https://，其它不合法的直接拒绝
  function normalizeUrl(text) {
    let value = (text || '').trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
      return url.href;
    } catch (e) { return null; }
  }
  async function addSite(name, url) {
    if (custom.some((item) => item.url === url) || SITES.some((item) => item.url === url)) {
      hint.textContent = '这个网址已经在列表里';
      return false;
    }
    custom.push({ name: (name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || new URL(url).hostname, url });
    await saveCustom(custom);
    render();
    hint.textContent = '已加入';
    list.scrollTop = list.scrollHeight;
    return true;
  }

  async function open() {
    custom = await loadCustom();
    render();
    backdrop.hidden = false;
    panel.hidden = false;
    if (entry) {
      entry.dataset.panelOpen = 'true';
      entry.setAttribute('aria-expanded', 'true');
    }
    panel.querySelector('[data-act="close"]').focus({ preventScroll: true });
  }
  function close() {
    backdrop.hidden = true;
    panel.hidden = true;
    if (entry) {
      entry.dataset.panelOpen = 'false';
      entry.setAttribute('aria-expanded', 'false');
    }
  }
  function addCurrent() {
    return addSite(document.title, location.href);
  }
  async function addTyped() {
    const url = normalizeUrl(urlInput.value);
    if (!url) {
      hint.textContent = '网址不完整，例如 example.com 或 https://example.com/path';
      urlInput.focus();
      return;
    }
    if (await addSite(nameInput.value, url)) {
      nameInput.value = '';
      urlInput.value = '';
    }
  }
  async function remove(index) {
    custom.splice(index, 1);
    await saveCustom(custom);
    render();
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.act === 'close') close();
    else if (target.dataset.act === 'add') addCurrent();
    else if (target.dataset.del !== undefined) remove(Number(target.dataset.del));
  });
  addForm.addEventListener('submit', (event) => { event.preventDefault(); addTyped(); });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
  new MutationObserver(() => {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* -------------------- 接入共享悬浮球 -------------------- */
  function boot() {
    document.documentElement.appendChild(host);
    const tools = sharedToolsDock();
    entry = document.createElement('button');
    entry.id = 'quick-sites';
    entry.type = 'button';
    entry.textContent = '常用站点';
    entry.setAttribute('aria-expanded', 'false');
    entry.addEventListener('click', () => { if (panel.hidden) open(); else close(); });
    tools.getElementById('tool-actions').appendChild(entry);
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();

// ==UserScript==
// @name         NSFW站点七合一脚本
// @name:en      NSFW 7-in-1 Script
// @namespace    local.nsfw.combined.v2
// @version      2.5.1
// @description  ① 3*O & 91/SP*：绕过 VIP 限制提取原画/高清 MP4 直链播放与下载；② *王论坛：免金币读取付费区视频 m3u8；③ J*vhub：突破观看限额，免会员全片流式下载；④ X*sian：免 VIP 突破 120 秒试看限制，伪造本地会员态及分片合成下载；⑤ 爱*社区(bb*)：免 VIP/订阅/金币在线播放原画，支持完整视频 .ts 下载；⑥ 春*院(chunman4.com 及镜像)：付费视频帖由截图路径推导 m3u8/种子，hls.js 直播 + AES-128 分片解密完整下载，附件移动 API 枚举 + /remote/ 无鉴权直链；⑦ 含羞草：iOS Safari 适配的试看解锁（游客身份取址 + start/end 扩窗，自建 HLS 播放器，静音自动播兜底）。各模块入口统一收进共享悬浮球菜单，与广告过滤 / 视频嗅探 / 阅读模式共用一个悬浮球；解析面板默认不弹出，解析成功只点亮悬浮球下方的「解」小圆钮，点了才展开。
// @author       local
// 含羞草的站点域名经常更换，而且从首页点进片子是 SPA 路由、不整页刷新，只能全站注入再在脚本内判断；
// 其它模块各自按域名守卫，不在目标站上时的开销只有一次域名匹配。hls.js 改为用到时再按需加载（Safari 原生支持 HLS，用不到）。
// 覆盖站点：media/tube.3go.fun · *.sp2026.com · *.9p9.xyz · 91porn.com · laowang*.vip · javhub.net/play/ ·
//           xasian.org 及同构站 · bbav110.com / avjb.com · chunman*.com 及镜像 · 含羞草（/play/video/ 播放页）
// @match        *://*/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_cookie
// @grant        unsafeWindow
// @connect      *
// @noframes
// ==/UserScript==

/* =====================================================================
 * 公共部分：共享悬浮球入口 + 按需加载 hls.js
 *   - 各模块不再各自画右下角浮钮（会和视频嗅探 / 广告过滤的悬浮球叠在一起，功能也重复），
 *     统一用 nsfwDockEntry() 往共享悬浮球的菜单里挂一个入口。
 *   - 面板默认隐藏，不再一进页面就弹出来挡住网页；解析成功后用 nsfwDockBadge() 点亮
 *     悬浮球下方的「解」小圆钮，用户点它才展开面板。
 *   - 共享悬浮球代码块与其它脚本逐字一致，由测试校验；改它要同步四份。
 * ===================================================================== */

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

// 各模块的入口统一挂到共享悬浮球菜单里；同一个 id 重复调用只更新文字和点击行为。
function nsfwDockEntry(id, label, onClick) {
  const tools = sharedToolsDock();
  let entry = tools.getElementById(id);
  if (!entry) {
    entry = document.createElement('button');
    entry.id = id;
    entry.type = 'button';
    tools.getElementById('tool-actions').appendChild(entry);
  }
  entry.textContent = label;
  entry.onclick = onClick;
  return entry;
}

// 解析成功后点亮悬浮球下方的「解」小圆钮，只作提示；面板不自动弹出，用户点了小圆钮才展开。
function nsfwDockBadge(onTap) {
  const tools = sharedToolsDock();
  let badge = tools.getElementById('nsfw-ready');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'nsfw-ready';
    badge.type = 'button';
    badge.innerHTML = '<span style="background:#146b56;color:#fff;border-color:#146b56">解</span>';
    const label = '已解析到视频，点击展开';
    badge.setAttribute('aria-label', label);
    badge.title = label;
    tools.getElementById('after').appendChild(badge);
  }
  badge.hidden = false;
  badge.onclick = onTap;
  return badge;
}

// hls.js 只在真正要播 HLS 且浏览器不原生支持时才加载；沙盒里优先拿页面 window 上的实例。
const NSFW_HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
let nsfwHlsLoading = null;
function nsfwHlsCtor() {
  try { if (typeof Hls !== 'undefined' && Hls) return Hls; } catch (e) {}
  try { if (typeof unsafeWindow === 'object' && unsafeWindow && unsafeWindow.Hls) return unsafeWindow.Hls; } catch (e) {}
  return window.Hls || null;
}
function nsfwHls() {
  const ready = nsfwHlsCtor();
  if (ready) return Promise.resolve(ready);
  if (!nsfwHlsLoading) {
    nsfwHlsLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = NSFW_HLS_CDN;
      s.async = true;
      s.onload = () => resolve(nsfwHlsCtor());
      s.onerror = () => { nsfwHlsLoading = null; resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  return nsfwHlsLoading;
}

/* =====================================================================
 * 模块 1/7：直链播放器（3*O + 91/SP*） v1.2.1
 * ===================================================================== */

(function () {
  "use strict";

  const HOST = location.hostname.toLowerCase();
  const PREF = "nsfw_dp_";

  function is3go() {
    return /(^|\.)3go\.fun$/i.test(HOST);
  }
  function isSp2026() {
    return (
      /(^|\.)sp2026\.com$/i.test(HOST) ||
      /(^|\.)9p9\.xyz$/i.test(HOST) ||
      /(^|\.)91porn\.com$/i.test(HOST)
    );
  }

  function prefGet(k, d) {
    try {
      const v = GM_getValue(PREF + k, d);
      return v === undefined ? d : v;
    } catch {
      return d;
    }
  }
  function prefSet(k, v) {
    try {
      GM_setValue(PREF + k, v);
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function copyText(text) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof GM_setClipboard === "function") {
          GM_setClipboard(text);
          resolve();
          return;
        }
      } catch (_) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve, reject);
      } else {
        reject(new Error("no clipboard"));
      }
    });
  }

  function toast(msg, kind = "ok", ms = 2200) {
    let host = document.getElementById("nsfw-dp-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "nsfw-dp-toast-host";
      document.documentElement.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `nsfw-dp-toast ${kind}`;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 280);
    }, ms);
  }

  function injectSharedStyles() {
    if (document.getElementById("nsfw-dp-shared-style")) return;
    GM_addStyle(`
      #nsfw-dp-toast-host {
        position: fixed; z-index: 2147483646;
        right: 64px; bottom: 72px;
        display: flex; flex-direction: column; gap: 8px;
        pointer-events: none; max-width: min(420px, calc(100vw - 80px));
      }
      .nsfw-dp-toast {
        opacity: 0; transform: translateY(8px);
        transition: opacity .22s, transform .22s;
        padding: 10px 14px; border-radius: 10px;
        font: 600 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 10px 28px rgba(0,0,0,.4);
        color: #0b1220; background: #86efac;
      }
      .nsfw-dp-toast.err { background: #fca5a5; }
      .nsfw-dp-toast.info { background: #93c5fd; }
      .nsfw-dp-toast.show { opacity: 1; transform: translateY(0); }

      .nsfw-dp-panel {
        position: relative; z-index: 99990;
        margin: 12px 0 16px; padding: 0;
        border-radius: 14px; overflow: hidden;
        border: 1px solid var(--nsfw-bd, #334155);
        background: linear-gradient(165deg, var(--nsfw-bg1, #1b2433) 0%, var(--nsfw-bg2, #121820) 100%);
        color: var(--nsfw-fg, #e2e8f0);
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,.38);
      }
      .nsfw-dp-panel.theme-amber {
        --nsfw-bd: #334155; --nsfw-bg1: #1b2433; --nsfw-bg2: #121820;
        --nsfw-fg: #e2e8f0; --nsfw-accent: #fbbf24; --nsfw-accent-fg: #0f172a;
        --nsfw-sec: #334155; --nsfw-sec-fg: #e2e8f0; --nsfw-ok: #86efac; --nsfw-err: #fca5a5;
        --nsfw-muted: #94a3b8; --nsfw-input-bd: #475569; --nsfw-input-bg: #0b1220;
      }
      .nsfw-dp-panel.theme-blue {
        --nsfw-bd: #2e3a55; --nsfw-bg1: #1a1f2e; --nsfw-bg2: #12151c;
        --nsfw-fg: #e8eefc; --nsfw-accent: #7cb3ff; --nsfw-accent-fg: #0b1220;
        --nsfw-sec: #2a354d; --nsfw-sec-fg: #d7e3ff; --nsfw-ok: #8dffb0; --nsfw-err: #ff8f8f;
        --nsfw-muted: #a9b6d3; --nsfw-input-bd: #3a4663; --nsfw-input-bg: #0d111a;
      }
      .nsfw-dp-hd {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 14px; cursor: default;
        border-bottom: 1px solid color-mix(in srgb, var(--nsfw-bd) 70%, transparent);
        user-select: none;
      }
      .nsfw-dp-hd h3 {
        margin: 0; flex: 1; min-width: 0;
        font-size: 15px; font-weight: 700; letter-spacing: .02em;
        color: var(--nsfw-accent);
      }
      .nsfw-dp-hd h3 small {
        display: inline; margin-left: 6px;
        font-weight: 500; font-size: 11px; opacity: .72; color: var(--nsfw-fg);
      }
      .nsfw-dp-hd .nsfw-dp-tools { display: flex; gap: 6px; flex-shrink: 0; }
      .nsfw-dp-iconbtn {
        appearance: none; border: 0; border-radius: 8px;
        width: 30px; height: 30px; padding: 0;
        cursor: pointer; font-size: 14px; line-height: 1;
        background: var(--nsfw-sec); color: var(--nsfw-sec-fg);
      }
      .nsfw-dp-iconbtn:hover { filter: brightness(1.12); }
      .nsfw-dp-body { padding: 12px 14px 14px; }
      .nsfw-dp-panel.collapsed .nsfw-dp-body { display: none; }
      .nsfw-dp-panel.collapsed .nsfw-dp-hd { border-bottom: 0; }
      .nsfw-dp-sub { margin: 0 0 10px; font-size: 12px; color: var(--nsfw-muted); }
      .nsfw-dp-row {
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0;
      }
      .nsfw-dp-panel button.nsfw-btn,
      .nsfw-dp-panel a.nsfw-btn {
        appearance: none; border: 0; border-radius: 8px;
        padding: 8px 12px; cursor: pointer;
        font-weight: 650; font-size: 12px; text-decoration: none;
        color: var(--nsfw-accent-fg); background: var(--nsfw-accent);
        display: inline-flex; align-items: center; gap: 6px;
      }
      .nsfw-dp-panel button.nsfw-btn.secondary,
      .nsfw-dp-panel a.nsfw-btn.secondary {
        background: var(--nsfw-sec); color: var(--nsfw-sec-fg);
      }
      .nsfw-dp-panel button.nsfw-btn:disabled {
        opacity: .55; cursor: wait;
      }
      .nsfw-dp-panel button.nsfw-btn.busy::before {
        content: ""; width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid color-mix(in srgb, currentColor 35%, transparent);
        border-top-color: currentColor;
        animation: nsfw-spin .7s linear infinite;
      }
      @keyframes nsfw-spin { to { transform: rotate(360deg); } }
      .nsfw-dp-panel input.nsfw-url {
        flex: 1 1 220px; min-width: 0;
        border-radius: 8px; border: 1px solid var(--nsfw-input-bd);
        background: var(--nsfw-input-bg); color: var(--nsfw-fg);
        padding: 8px 10px; font-size: 12px; font-family: ui-monospace, monospace;
      }
      .nsfw-dp-panel input.nsfw-url:focus {
        outline: 2px solid color-mix(in srgb, var(--nsfw-accent) 55%, transparent);
        outline-offset: 1px;
      }
      .nsfw-dp-status {
        font-size: 12px; color: var(--nsfw-muted);
        word-break: break-all; white-space: pre-wrap; min-height: 1.35em;
      }
      .nsfw-dp-status.ok { color: var(--nsfw-ok); }
      .nsfw-dp-status.err { color: var(--nsfw-err); }
      .nsfw-dp-meta {
        display: flex; flex-wrap: wrap; gap: 6px 12px;
        font-size: 12px; color: var(--nsfw-fg); margin: 4px 0 2px;
      }
      .nsfw-dp-meta b { color: var(--nsfw-accent); font-weight: 650; }
      .nsfw-dp-steps {
        display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px;
      }
      .nsfw-dp-step {
        font-size: 11px; padding: 3px 8px; border-radius: 999px;
        background: var(--nsfw-sec); color: var(--nsfw-muted);
      }
      .nsfw-dp-step.on { color: var(--nsfw-accent-fg); background: var(--nsfw-accent); }
      .nsfw-dp-step.done { color: #052e16; background: var(--nsfw-ok); }
      .nsfw-dp-step.fail { color: #450a0a; background: var(--nsfw-err); }
      .nsfw-dp-panel video.nsfw-vid {
        display: none; width: 100%;
        max-height: min(70vh, 720px); margin-top: 10px;
        border-radius: 8px; background: #000;
      }
      .nsfw-dp-panel video.nsfw-vid.show { display: block; }
      .nsfw-dp-opts {
        display: flex; flex-wrap: wrap; gap: 10px 14px;
        margin-top: 8px; font-size: 12px; color: var(--nsfw-muted);
      }
      .nsfw-dp-opts label {
        display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
      }
      .nsfw-dp-opts input { accent-color: var(--nsfw-accent); }
      .nsfw-dp-hotkey {
        margin-top: 6px; font-size: 11px; color: var(--nsfw-muted); opacity: .85;
      }
      .nsfw-dp-hotkey kbd {
        font: 600 10px/1 ui-monospace, monospace;
        padding: 1px 5px; border-radius: 4px;
        border: 1px solid var(--nsfw-bd); background: var(--nsfw-input-bg);
      }
      @media (max-width: 640px) {
        .nsfw-dp-panel button.nsfw-btn, .nsfw-dp-panel a.nsfw-btn {
          flex: 1 1 auto; justify-content: center;
        }
      }
    `);
  }

  function makePanel({ ns, theme, title, subtitle, bodyHtml, collapsedKey }) {
    injectSharedStyles();
    let root = document.getElementById(`${ns}-root`);
    if (root) return root;

    const collapsed = !!prefGet(collapsedKey || `${ns}_collapsed`, false);
    root = document.createElement("div");
    root.id = `${ns}-root`;
    root.className = `nsfw-dp-panel theme-${theme || "amber"}${collapsed ? " collapsed" : ""}`;
    root.innerHTML = `
      <div class="nsfw-dp-hd">
        <h3>${title}<small>${subtitle || ""}</small></h3>
        <div class="nsfw-dp-tools">
          <button type="button" class="nsfw-dp-iconbtn" data-act="collapse" title="折叠/展开">▾</button>
          <button type="button" class="nsfw-dp-iconbtn" data-act="hide" title="隐藏面板（悬浮球菜单可重新打开）">✕</button>
        </div>
      </div>
      <div class="nsfw-dp-body">${bodyHtml}</div>
    `;

    const collapseBtn = root.querySelector('[data-act="collapse"]');
    const syncCollapseIcon = () => {
      collapseBtn.textContent = root.classList.contains("collapsed") ? "▸" : "▾";
    };
    syncCollapseIcon();

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]");
      if (!t || !root.contains(t)) return;
      const act = t.getAttribute("data-act");
      if (act === "collapse") {
        ev.preventDefault();
        root.classList.toggle("collapsed");
        prefSet(collapsedKey || `${ns}_collapsed`, root.classList.contains("collapsed"));
        syncCollapseIcon();
      } else if (act === "hide") {
        ev.preventDefault();
        root.style.display = "none";
        toast("面板已隐藏，悬浮球菜单里可重新打开", "info");
      }
    });

    return root;
  }

  function mountBefore(el, target, mode) {
    if (!target || target === document.body) {
      document.body.insertBefore(el, document.body.firstChild);
      return;
    }
    if (mode === "prepend") {
      target.insertBefore(el, target.firstChild);
    } else if (mode === "after") {
      target.parentNode.insertBefore(el, target.nextSibling);
    } else {
      target.parentNode.insertBefore(el, target);
    }
  }

  function setBusy(btn, busy, labelIdle) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.classList.add("busy");
      if (labelIdle) btn.textContent = labelIdle;
    } else {
      btn.disabled = false;
      btn.classList.remove("busy");
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function setStatus(root, msg, kind) {
    const el = root.querySelector("[data-status]");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setSteps(root, active, map) {
    const box = root.querySelector("[data-steps]");
    if (!box) return;
    box.querySelectorAll("[data-step]").forEach((el) => {
      const id = el.getAttribute("data-step");
      el.classList.remove("on", "done", "fail");
      const st = map && map[id];
      if (st === "done") el.classList.add("done");
      else if (st === "fail") el.classList.add("fail");
      else if (id === active || st === "on") el.classList.add("on");
    });
  }

  function bindUrlInput(root) {
    const input = root.querySelector("[data-url]");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("focus", () => input.select());
    input.addEventListener("dblclick", async () => {
      if (!input.value) return;
      try {
        await copyText(input.value);
        toast("已复制直链");
        setStatus(root, "已复制直链到剪贴板。", "ok");
      } catch {
        input.select();
        toast("请手动 Ctrl+C", "err");
      }
    });
  }

  function applyLink(root, mp4, { filename, autoPlay } = {}) {
    const input = root.querySelector("[data-url]");
    const aOpen = root.querySelector("[data-open]");
    const aDl = root.querySelector("[data-download]");
    const btnCopy = root.querySelector('[data-act="copy"]');
    const btnPlay = root.querySelector('[data-act="play"]');
    const btnPip = root.querySelector('[data-act="pip"]');
    const video = root.querySelector("[data-video]");

    if (input) input.value = mp4;
    if (btnCopy) btnCopy.disabled = false;
    if (btnPlay) btnPlay.disabled = false;
    if (btnPip) btnPip.disabled = false;
    if (aOpen) {
      aOpen.style.display = "";
      aOpen.href = mp4;
    }
    if (aDl) {
      aDl.style.display = "";
      aDl.href = mp4;
      if (filename) aDl.setAttribute("download", filename);
    }

    if (video && autoPlay) {
      playVideo(root, mp4);
    }
  }

  function playVideo(root, mp4) {
    const video = root.querySelector("[data-video]");
    if (!video) return;
    const src = mp4 || root.querySelector("[data-url]")?.value;
    if (!src) return;
    video.classList.add("show");
    video.style.display = "block";
    video.removeAttribute("crossorigin");
    if (video.src !== src) {
      video.src = src;
      video.load();
    }
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    setStatus(root, "页内播放中 · 支持拖动进度（HTTP Range）。", "ok");
  }

  async function doCopy(root) {
    const url = root.querySelector("[data-url]")?.value;
    if (!url) return;
    try {
      await copyText(url);
      toast("已复制直链");
      setStatus(root, "已复制直链到剪贴板。", "ok");
    } catch {
      root.querySelector("[data-url]")?.select();
      toast("复制失败，已选中链接", "err");
      setStatus(root, "自动复制失败，请 Ctrl+C。", "err");
    }
  }

  async function doPip(root) {
    const video = root.querySelector("[data-video]");
    if (!video) return;
    if (!video.src) playVideo(root);
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        if (video.readyState < 1) {
          await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
        }
        await video.requestPictureInPicture();
        toast("已进入画中画", "info");
      } else {
        toast("当前浏览器不支持画中画", "err");
      }
    } catch (e) {
      toast("画中画失败: " + (e.message || e), "err");
    }
  }

  function bindHotkeys(handler) {
    if (window.__nsfwDpHotkeys) return;
    window.__nsfwDpHotkeys = true;
    document.addEventListener("keydown", (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const tag = (e.target && e.target.tagName) || "";
        if (/^(INPUT|TEXTAREA|SELECT)$/i.test(tag) || e.target?.isContentEditable) return;
        handler(e);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 3*O
  // ═══════════════════════════════════════════════════════════
  function run3go() {
    const NS = "go3-orig";
    const API = (token) =>
      `${location.origin}/api/v1/media/${encodeURIComponent(token)}`;
    const log = (...a) => console.log(`[${NS}]`, ...a);

    function gmGet(url) {
      return new Promise((resolve, reject) => {
        fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json" },
        })
          .then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("json")) resolve(await r.json());
            else resolve(await r.text());
          })
          .catch(() => {
            if (typeof GM_xmlhttpRequest !== "function") {
              reject(new Error("fetch failed and no GM_xmlhttpRequest"));
              return;
            }
            GM_xmlhttpRequest({
              method: "GET",
              url,
              headers: { Accept: "application/json" },
              timeout: 30000,
              onload(res) {
                if (res.status < 200 || res.status >= 400) {
                  reject(new Error(`HTTP ${res.status}`));
                  return;
                }
                try {
                  resolve(JSON.parse(res.responseText));
                } catch {
                  resolve(res.responseText);
                }
              },
              onerror: () => reject(new Error("network error")),
              ontimeout: () => reject(new Error("timeout")),
            });
          });
      });
    }

    function encodeMediaPath(path) {
      if (!path) return path;
      if (/^https?:\/\//i.test(path)) return path;
      const p = path.startsWith("/") ? path : `/${path}`;
      return p
        .split("/")
        .map((seg) => (seg ? encodeURIComponent(seg) : ""))
        .join("/");
    }

    function absUrl(pathOrUrl) {
      if (!pathOrUrl) return null;
      if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
      return new URL(encodeMediaPath(pathOrUrl), location.origin).href;
    }

    function getTokenFromLocation() {
      const u = new URL(location.href);
      const m = u.searchParams.get("m");
      if (m) return m;
      const path = u.pathname.match(/\/(?:view|media)\/([^/?#]+)/i);
      if (path) return decodeURIComponent(path[1]);
      return null;
    }

    function isViewPage() {
      return (
        /\/view\/?$/i.test(location.pathname) ||
        /[?&]m=/.test(location.search) ||
        /\/(?:view|media)\/[^/?#]+/i.test(location.pathname)
      );
    }

    function fmtDur(sec) {
      if (sec == null || isNaN(sec)) return "-";
      sec = Math.round(Number(sec));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      return `${m}:${String(s).padStart(2, "0")}`;
    }

    function fmtSize(n) {
      if (n == null || n === "") return null;
      const num = Number(n);
      if (!isNaN(num) && num > 1024) {
        if (num >= 1e9) return (num / 1e9).toFixed(2) + " GB";
        if (num >= 1e6) return (num / 1e6).toFixed(1) + " MB";
        if (num >= 1e3) return (num / 1e3).toFixed(0) + " KB";
      }
      return String(n);
    }

    function findMount() {
      const candidates = [
        document.querySelector(".video-player"),
        document.querySelector(".player-container"),
        document.querySelector("#page-media"),
        document.querySelector("video")?.closest("div"),
        document.querySelector("main"),
        document.querySelector("#main"),
        document.querySelector(".media-content"),
      ].filter(Boolean);
      return candidates[0] || document.body;
    }

    function ensureRoot() {
      let root = document.getElementById(`${NS}-root`);
      if (root) return root;
      root = makePanel({
        ns: NS,
        theme: "amber",
        title: "3*O 原画直链",
        subtitle: "绕过 VIP 下载",
        bodyHtml: `
          <p class="nsfw-dp-sub">公开 API 取 original_media_url · 站内「下载」自动劫持为原画</p>
          <div class="nsfw-dp-row">
            <button type="button" class="nsfw-btn" data-act="load">获取并播放</button>
            <button type="button" class="nsfw-btn secondary" data-act="play" disabled>仅播放</button>
            <button type="button" class="nsfw-btn secondary" data-act="copy" disabled>复制</button>
            <button type="button" class="nsfw-btn secondary" data-act="pip" disabled>画中画</button>
            <a class="nsfw-btn secondary" data-open href="#" target="_blank" rel="noopener" style="display:none">新标签</a>
            <a class="nsfw-btn" data-download href="#" download style="display:none">下载原画</a>
          </div>
          <div class="nsfw-dp-meta" data-meta></div>
          <div class="nsfw-dp-row">
            <input class="nsfw-url" data-url type="text" readonly placeholder="原画 mp4 直链（双击复制）" />
          </div>
          <div class="nsfw-dp-status" data-status>就绪。</div>
          <div class="nsfw-dp-opts">
            <label><input type="checkbox" data-opt="auto_fetch" ${prefGet("go3_auto_fetch", true) ? "checked" : ""}/> 进入自动获取</label>
            <label><input type="checkbox" data-opt="auto_play" ${prefGet("go3_auto_play", false) ? "checked" : ""}/> 获取后自动播放</label>
          </div>
          <div class="nsfw-dp-hotkey">快捷键：<kbd>Alt</kbd>+<kbd>D</kbd> 获取并播放 · <kbd>Alt</kbd>+<kbd>C</kbd> 复制 · <kbd>Alt</kbd>+<kbd>P</kbd> 画中画</div>
          <video class="nsfw-vid" controls playsinline preload="metadata" data-video></video>
        `,
      });
      mountBefore(root, findMount(), "before");
      bindUrlInput(root);

      root.querySelectorAll("[data-opt]").forEach((inp) => {
        inp.addEventListener("change", () => {
          const k = inp.getAttribute("data-opt");
          prefSet("go3_" + k, !!inp.checked);
        });
      });

      return root;
    }

    function applyMedia(root, data, mp4) {
      const meta = root.querySelector("[data-meta]");
      const fname =
        (data && data.title
          ? String(data.title).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)
          : "video") + ".mp4";

      if (meta) {
        meta.innerHTML = [
          data?.title ? `<span>标题 <b>${escapeHtml(data.title)}</b></span>` : "",
          data?.duration != null ? `<span>时长 <b>${fmtDur(data.duration)}</b></span>` : "",
          data?.size != null ? `<span>大小 <b>${escapeHtml(fmtSize(data.size))}</b></span>` : "",
          data?.video_height ? `<span>清晰度 <b>${data.video_height}p</b></span>` : "",
          data?.user ? `<span>作者 <b>${escapeHtml(String(data.user))}</b></span>` : "",
        ]
          .filter(Boolean)
          .join("");
      }

      const autoPlay =
        root.querySelector('[data-opt="auto_play"]')?.checked ||
        prefGet("go3_auto_play", false);

      applyLink(root, mp4, { filename: fname, autoPlay });
      if (!autoPlay) {
        setStatus(root, "已拿到原画直链 · 可播放 / 复制 / 下载（支持 Range）。", "ok");
      }
      prefSet("go3_last_mp4", mp4);
      prefSet("go3_last_token", getTokenFromLocation() || "");
    }

    let cachedMp4 = null;
    let loading = false;

    async function loadOriginal(root, { play } = {}) {
      if (loading) return null;
      const btn = root.querySelector('[data-act="load"]');
      loading = true;
      setBusy(btn, true, "获取中…");
      const float = document.getElementById(`${NS}-float`);
      if (float) float.classList.add("busy");
      try {
        const token = getTokenFromLocation();
        if (!token) throw new Error("当前页没有 media token（?m=…）");

        setStatus(root, "请求媒体 API…");
        const data = await gmGet(API(token));
        if (!data || typeof data !== "object") throw new Error("API 返回非 JSON");

        let orig = data.original_media_url;
        if (!orig) {
          const enc = data.encodings_info || {};
          const o = enc["0-original"] || enc.original;
          if (o && typeof o === "object") {
            for (const k of Object.keys(o)) {
              if (o[k]?.url) {
                orig = o[k].url;
                break;
              }
            }
          }
        }
        if (!orig) throw new Error("API 无 original_media_url");

        const mp4 = absUrl(orig);
        if (!mp4) throw new Error("无法拼出直链");
        if (/banned\.mp4/i.test(mp4)) throw new Error("命中 banned 占位");

        cachedMp4 = mp4;
        applyMedia(root, data, mp4);
        log("mp4", mp4);
        nsfwDockBadge(() => showRoot(root));

        if (play) playVideo(root, mp4);
        toast("原画直链已就绪");
        return { data, mp4 };
      } catch (e) {
        setStatus(root, `失败: ${e && e.message ? e.message : e}`, "err");
        toast(String(e.message || e), "err");
        throw e;
      } finally {
        loading = false;
        setBusy(btn, false);
        if (float) float.classList.remove("busy");
      }
    }

    function getMp4() {
      return cachedMp4 || document.querySelector(`#${NS}-root [data-url]`)?.value || null;
    }

    function hookDownloadClicks() {
      document.addEventListener(
        "click",
        async (ev) => {
          const el = ev.target.closest("a,button,[role=button],span,div");
          if (!el) return;
          if (el.closest(`#${NS}-root`)) return;
          const label = (
            (el.getAttribute("aria-label") || "") +
            " " +
            (el.getAttribute("title") || "") +
            " " +
            (el.textContent || "")
          ).toLowerCase();
          if (!/download|下载/.test(label)) return;
          if (el.tagName === "A" && /\/media\/original\//i.test(el.href || "")) return;

          let mp4 = getMp4();
          if (!mp4) {
            try {
              const token = getTokenFromLocation();
              if (!token) return;
              const data = await gmGet(API(token));
              mp4 = absUrl(data.original_media_url);
              cachedMp4 = mp4;
            } catch {
              return;
            }
          }
          if (!mp4) return;

          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();

          const a = document.createElement("a");
          a.href = mp4;
          a.target = "_blank";
          a.rel = "noopener";
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast("已用原画直链下载", "info");
          log("intercepted download →", mp4);
        },
        true
      );
    }

    function watchVipModal() {
      const obs = new MutationObserver(() => {
        const modal = document.getElementById("vip-required-modal");
        if (!modal || modal.dataset.nsfwPatched) return;
        modal.dataset.nsfwPatched = "1";

        const box =
          modal.querySelector(".vip-box") || modal.querySelector("div") || modal;
        if (box.querySelector(".nsfw-modal-dl")) return;

        const row = document.createElement("div");
        row.style.cssText = "margin-top:14px;display:flex;flex-direction:column;gap:8px";
        const b = document.createElement("button");
        b.className = "nsfw-modal-dl";
        b.type = "button";
        b.textContent = "无需 VIP · 直接打开原画";
        b.style.cssText =
          "background:#fbbf24;color:#111;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;width:100%";
        b.addEventListener("click", async () => {
          try {
            b.disabled = true;
            b.textContent = "获取中…";
            let mp4 = getMp4();
            if (!mp4) {
              const data = await gmGet(API(getTokenFromLocation()));
              mp4 = absUrl(data.original_media_url);
              cachedMp4 = mp4;
            }
            if (mp4) window.open(mp4, "_blank", "noopener");
            modal.classList.remove("active");
            modal.style.display = "none";
            toast("已打开原画");
          } catch (e) {
            alert("获取直链失败: " + (e.message || e));
          } finally {
            b.disabled = false;
            b.textContent = "无需 VIP · 直接打开原画";
          }
        });
        row.appendChild(b);
        box.appendChild(row);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    function showRoot(root) {
      root.style.display = "";
      root.classList.remove("collapsed");
      prefSet(`${NS}_collapsed`, false);
      const cb = root.querySelector('[data-act="collapse"]');
      if (cb) cb.textContent = "▾";
      root.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    if (!isViewPage() && !getTokenFromLocation()) return;

    const root = ensureRoot();
    root.style.display = "none"; // 不自动弹出：解析好后点亮悬浮球下的小圆钮，用户点了才展开

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]");
      if (!t || !root.contains(t)) return;
      const act = t.getAttribute("data-act");
      if (act === "load") {
        ev.preventDefault();
        loadOriginal(root, { play: true }).catch(() => {});
      } else if (act === "play") {
        ev.preventDefault();
        playVideo(root);
      } else if (act === "copy") {
        ev.preventDefault();
        doCopy(root);
      } else if (act === "pip") {
        ev.preventDefault();
        doPip(root);
      }
    });

    nsfwDockEntry(`${NS}-entry`, "原画直链", () => {
      showRoot(root);
      loadOriginal(root, { play: true }).catch(() => {});
    });

    hookDownloadClicks();
    watchVipModal();

    bindHotkeys((e) => {
      if (!is3go()) return;
      if (e.code === "KeyD") {
        e.preventDefault();
        showRoot(root);
        loadOriginal(root, { play: true }).catch(() => {});
      } else if (e.code === "KeyC") {
        e.preventDefault();
        doCopy(root);
      } else if (e.code === "KeyP") {
        e.preventDefault();
        doPip(root);
      }
    });

    const auto =
      root.querySelector('[data-opt="auto_fetch"]')?.checked ??
      prefGet("go3_auto_fetch", true);
    if (auto && getTokenFromLocation()) {
      loadOriginal(root).catch(() => {});
    } else {
      setStatus(root, "点「获取并播放」，或点站内下载（自动原画）。");
    }

    // SPA：history + 轮询双保险
    let lastHref = location.href;
    let lastToken = getTokenFromLocation();
    const onNav = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const tok = getTokenFromLocation();
      if (!tok || tok === lastToken) return;
      lastToken = tok;
      cachedMp4 = null;
      const v = root.querySelector("[data-video]");
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.classList.remove("show");
      }
      root.querySelector("[data-url]").value = "";
      root.querySelector("[data-meta]").innerHTML = "";
      if (prefGet("go3_auto_fetch", true)) {
        loadOriginal(root).catch(() => {});
      } else {
        setStatus(root, "检测到新视频，点「获取并播放」。", "info");
      }
    };
    setInterval(onNav, 600);
    ["pushState", "replaceState"].forEach((m) => {
      const orig = history[m];
      history[m] = function () {
        const r = orig.apply(this, arguments);
        queueTimeout(onNav, 0);
        return r;
      };
    });
    window.addEventListener("popstate", onNav);
  }

  // ═══════════════════════════════════════════════════════════
  // 91 / SP*
  // ═══════════════════════════════════════════════════════════
  function runSp2026() {
    const NS = "sp2026-hd-player";
    const SHARE_HOST_RE = /https?:\/\/[^"'<\s]+\/ev\.php\?VID=[^"'<\s]+/i;
    const STRENCODE_RE =
      /strencode\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/;
    const STRENCODE2_RE = /strencode2\s*\(\s*["']([^"']+)["']\s*\)/;
    const warn = (...a) => console.warn(`[${NS}]`, ...a);

    let mjsCache = { url: "", code: "" };

    function gmGet(url, opts = {}) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: opts.method || "GET",
          url,
          headers: opts.headers || {
            "User-Agent": navigator.userAgent,
            Accept: "*/*",
          },
          responseType: opts.responseType || "text",
          timeout: opts.timeout || 45000,
          onload(res) {
            if (res.status >= 200 && res.status < 400) resolve(res);
            else reject(new Error(`HTTP ${res.status} ${url.slice(0, 100)}`));
          },
          onerror: () => reject(new Error(`network error: ${url.slice(0, 100)}`)),
          ontimeout: () => reject(new Error(`timeout: ${url.slice(0, 100)}`)),
        });
      });
    }

    function absUrl(u, base) {
      try {
        return new URL(u, base || location.href).href;
      } catch {
        return u;
      }
    }

    function findShareUrl(html) {
      const ta =
        document.querySelector("#fm-video_link") ||
        document.querySelector("textarea[name='video_link']") ||
        document.querySelector("textarea[id*='video']");
      if (ta && /ev\.php\?VID=/i.test(ta.value || "")) {
        return (ta.value.match(SHARE_HOST_RE) || [])[0] || ta.value.trim();
      }
      const m = (html || document.documentElement.innerHTML).match(SHARE_HOST_RE);
      return m ? m[0] : null;
    }

    function decodeStrencode2(html) {
      const m = html.match(STRENCODE2_RE);
      if (!m) return null;
      try {
        const decoded = decodeURIComponent(m[1]);
        const src = decoded.match(/src=['"]([^'"]+)['"]/i);
        return src ? src[1] : null;
      } catch {
        return null;
      }
    }

    function runStrencodeInFrame(mjsCode, a, b, c) {
      return new Promise((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.style.cssText =
          "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
        document.documentElement.appendChild(iframe);

        const cleanup = () => {
          try {
            iframe.remove();
          } catch (_) {}
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("strencode 执行超时"));
        }, 10000);

        try {
          const idoc = iframe.contentDocument || iframe.contentWindow.document;
          idoc.open();
          idoc.write("<!doctype html><html><head></head><body></body></html>");
          idoc.close();
          const w = iframe.contentWindow;
          const s = idoc.createElement("script");
          s.textContent = mjsCode;
          idoc.body.appendChild(s);

          if (typeof w.strencode !== "function") {
            clearTimeout(timer);
            cleanup();
            reject(new Error("m.js 执行后无 strencode"));
            return;
          }
          const tag = w.strencode(a, b, c);
          const src = String(tag).match(/src=['"]([^'"]+)['"]/i);
          clearTimeout(timer);
          cleanup();
          if (!src) {
            reject(new Error("strencode 结果无 src: " + String(tag).slice(0, 100)));
            return;
          }
          resolve(src[1]);
        } catch (e) {
          clearTimeout(timer);
          cleanup();
          reject(e);
        }
      });
    }

    async function decodeShareToMp4(shareUrl, onStep) {
      onStep?.("share");
      const shareRes = await gmGet(shareUrl, {
        headers: { Accept: "text/html,*/*", Referer: location.origin + "/" },
      });
      const shareHtml = shareRes.responseText || "";
      const call = shareHtml.match(STRENCODE_RE);
      if (!call) throw new Error("分享页未找到 strencode(...)");

      onStep?.("mjs");
      let mjsUrl = "https://91.9p9.xyz/js/m.js";
      const mjsRef = shareHtml.match(/src=["']([^"']*js\/m\.js[^"']*)["']/i);
      if (mjsRef) mjsUrl = absUrl(mjsRef[1], shareUrl);

      let mjs = mjsCache.url === mjsUrl ? mjsCache.code : "";
      if (!mjs) {
        const mjsRes = await gmGet(mjsUrl, {
          headers: { Referer: shareUrl, Accept: "*/*" },
        });
        mjs = mjsRes.responseText || "";
        if (!mjs || mjs.length < 100) throw new Error("m.js 加载失败");
        mjsCache = { url: mjsUrl, code: mjs };
      }

      onStep?.("decode");
      const mp4 = await runStrencodeInFrame(mjs, call[1], call[2], call[3]);
      if (/banned\.mp4/i.test(mp4))
        throw new Error("命中 banned.mp4 反爬占位，请稍后重试");
      return mp4;
    }

    function getViewkey() {
      const m = location.search.match(/[?&]viewkey=([^&]+)/i);
      if (m) return decodeURIComponent(m[1]);
      const a = document.querySelector("a[href*='viewkey=']");
      if (a) {
        const m2 = a.href.match(/viewkey=([^&]+)/i);
        if (m2) return decodeURIComponent(m2[1]);
      }
      return null;
    }

    function isHdPage() {
      return /view_video_hd\.php/i.test(location.pathname);
    }
    function isViewPage() {
      return /view_video(?:_hd)?\.php/i.test(location.pathname);
    }
    function isSharePage() {
      return /ev\.php/i.test(location.pathname) && /[?&]VID=/i.test(location.search);
    }

    function findPlayerMount() {
      const vipHint = Array.from(
        document.querySelectorAll("div, span, p, td")
      ).find(
        (el) =>
          /只有VIP|only VIP|watch HD|开通VIP/i.test(el.textContent || "") &&
          (el.textContent || "").length < 220
      );
      if (vipHint) {
        const box =
          vipHint.closest(
            ".col-md-8, .video-border, #videodetails, .videodetails-yakov"
          ) || vipHint.parentElement;
        if (box) return { before: box, mode: "before" };
      }
      const video = document.querySelector("#player_one, video.video-js, #player video, video");
      if (video) {
        const wrap =
          video.closest(
            ".video-container, .media-parent, .example-video-container, #player"
          ) || video.parentElement;
        return { before: wrap, mode: "before" };
      }
      const details = document.querySelector(
        "#videodetails, .videodetails-yakov, .col-md-8"
      );
      if (details) return { before: details, mode: "prepend" };
      return { before: document.body, mode: "prepend" };
    }

    function ensureRoot() {
      let root = document.getElementById(`${NS}-root`);
      if (root) return root;
      root = makePanel({
        ns: NS,
        theme: "blue",
        title: "HD 直链播放器",
        subtitle: "分享链解码 · 非 VIP",
        bodyHtml: `
          <div class="nsfw-dp-steps" data-steps>
            <span class="nsfw-dp-step" data-step="share">① 分享链</span>
            <span class="nsfw-dp-step" data-step="mjs">② 解密脚本</span>
            <span class="nsfw-dp-step" data-step="decode">③ 解码直链</span>
            <span class="nsfw-dp-step" data-step="play">④ 播放</span>
          </div>
          <div class="nsfw-dp-row">
            <button type="button" class="nsfw-btn" data-act="load">获取并播放 HD</button>
            <button type="button" class="nsfw-btn secondary" data-act="sd">SD 兜底</button>
            <button type="button" class="nsfw-btn secondary" data-act="copy" disabled>复制</button>
            <button type="button" class="nsfw-btn secondary" data-act="pip" disabled>画中画</button>
            <a class="nsfw-btn secondary" data-open href="#" target="_blank" rel="noopener" style="display:none">新标签</a>
            <a class="nsfw-btn secondary" data-download href="#" download style="display:none">下载</a>
          </div>
          <div class="nsfw-dp-row">
            <input class="nsfw-url" data-url type="text" readonly placeholder="mp4 直链（双击复制）" />
          </div>
          <div class="nsfw-dp-status" data-status>就绪。</div>
          <div class="nsfw-dp-opts">
            <label><input type="checkbox" data-opt="autoplay" ${prefGet("sp_autoplay", true) ? "checked" : ""}/> 进入自动获取 HD</label>
            <label><input type="checkbox" data-opt="sd_fallback" ${prefGet("sp_sd_fallback", true) ? "checked" : ""}/> HD 失败自动试 SD</label>
          </div>
          <div class="nsfw-dp-hotkey">快捷键：<kbd>Alt</kbd>+<kbd>D</kbd> 获取 HD · <kbd>Alt</kbd>+<kbd>S</kbd> SD · <kbd>Alt</kbd>+<kbd>C</kbd> 复制 · <kbd>Alt</kbd>+<kbd>P</kbd> 画中画</div>
          <video class="nsfw-vid" controls playsinline preload="metadata" data-video style="display:none"></video>
        `,
      });
      const mount = findPlayerMount();
      mountBefore(root, mount.before, mount.mode);
      bindUrlInput(root);

      root.querySelectorAll("[data-opt]").forEach((inp) => {
        inp.addEventListener("change", () => {
          prefSet("sp_" + inp.getAttribute("data-opt"), !!inp.checked);
        });
      });

      return root;
    }

    let loading = false;

    function finishMp4(root, mp4, label) {
      const vk = getViewkey() || "video";
      applyLink(root, mp4, {
        filename: `${vk}-hd.mp4`,
        autoPlay: true,
      });
      setSteps(root, null, {
        share: "done",
        mjs: "done",
        decode: "done",
        play: "done",
      });
      setStatus(
        root,
        `${label || "已就绪"} · 支持 Range 拖动。直链有时效，失效请重试。`,
        "ok"
      );
      prefSet("sp_last_mp4", mp4);
      prefSet("sp_last_viewkey", getViewkey() || "");
      toast(label || "HD 直链就绪");
      nsfwDockBadge(() => showRoot(root));
    }

    async function loadHd(root) {
      if (loading) return;
      const btn = root.querySelector('[data-act="load"]');
      loading = true;
      setBusy(btn, true, "解码中…");
      const float = document.getElementById(`${NS}-float`);
      if (float) float.classList.add("busy");

      const stepMap = {};
      const onStep = (id) => {
        Object.keys(stepMap).forEach((k) => {
          if (stepMap[k] === "on") stepMap[k] = "done";
        });
        stepMap[id] = "on";
        setSteps(root, id, stepMap);
        const labels = {
          share: "解析分享链…",
          mjs: "加载解密脚本…",
          decode: "执行 strencode…",
          play: "准备播放…",
        };
        setStatus(root, labels[id] || id);
      };

      try {
        onStep("share");
        let share = findShareUrl();

        if (!share && !isHdPage()) {
          const vk = getViewkey();
          if (!vk) throw new Error("页面没有 viewkey，无法定位视频");
          const hdPage = `${location.origin}/view_video_hd.php?viewkey=${encodeURIComponent(vk)}`;
          setStatus(root, "拉取高清页分享链…");
          const res = await gmGet(hdPage, {
            headers: { Referer: location.href, Accept: "text/html" },
          });
          share = findShareUrl(res.responseText);
          if (!share) {
            const m = (res.responseText || "").match(SHARE_HOST_RE);
            share = m ? m[0] : null;
          }
        }
        if (!share) throw new Error("未找到 ev.php?VID= 分享链接（页面结构可能变了）");

        const mp4 = await decodeShareToMp4(share, onStep);
        onStep("play");
        finishMp4(root, mp4, "HD 直链");
      } catch (e) {
        warn(e);
        setSteps(root, null, { ...stepMap, decode: "fail" });
        setStatus(root, `失败: ${e && e.message ? e.message : e}`, "err");
        toast(String(e.message || e), "err");

        const fb =
          root.querySelector('[data-opt="sd_fallback"]')?.checked ??
          prefGet("sp_sd_fallback", true);
        if (fb) {
          setStatus(root, `HD 失败，尝试 SD…\n${e.message || e}`, "err");
          try {
            await loadSd(root, { silent: true });
          } catch (_) {}
        }
      } finally {
        loading = false;
        setBusy(btn, false);
        if (float) float.classList.remove("busy");
      }
    }

    async function loadSd(root, { silent } = {}) {
      const btn = root.querySelector('[data-act="sd"]');
      if (!silent) setBusy(btn, true, "解析中…");
      try {
        if (!silent) setStatus(root, "解析 SD strencode2…");
        let mp4 = decodeStrencode2(document.documentElement.innerHTML);
        if (!mp4) {
          const vk = getViewkey();
          if (!vk) throw new Error("无 viewkey");
          const sdPage = `${location.origin}/view_video.php?viewkey=${encodeURIComponent(vk)}`;
          const res = await gmGet(sdPage, {
            headers: { Referer: location.href, Accept: "text/html" },
          });
          mp4 = decodeStrencode2(res.responseText || "");
        }
        if (!mp4) throw new Error("未找到 strencode2 SD 源");
        finishMp4(root, mp4, silent ? "SD 兜底直链" : "SD 直链");
      } catch (e) {
        if (!silent) {
          setStatus(root, `SD 失败: ${e && e.message ? e.message : e}`, "err");
          toast(String(e.message || e), "err");
        }
        throw e;
      } finally {
        if (!silent) setBusy(btn, false);
      }
    }

    function enhanceSharePage() {
      injectSharedStyles();
      const pickSrc = () =>
        document.querySelector("video source")?.src ||
        document.querySelector("video")?.currentSrc ||
        document.querySelector("video")?.src ||
        null;

      const tryEnhance = () => {
        const src = pickSrc();
        if (!src || document.getElementById(`${NS}-root`)) return !!src;
        const root = makePanel({
          ns: NS,
          theme: "blue",
          title: "分享页直链",
          subtitle: "已从播放器提取",
          bodyHtml: `
            <div class="nsfw-dp-row">
              <button type="button" class="nsfw-btn" data-act="copy">复制直链</button>
              <button type="button" class="nsfw-btn secondary" data-act="pip">画中画</button>
              <a class="nsfw-btn" data-open href="${escapeHtml(src)}" target="_blank" rel="noopener">新标签</a>
              <a class="nsfw-btn secondary" data-download href="${escapeHtml(src)}" download>下载</a>
            </div>
            <div class="nsfw-dp-row">
              <input class="nsfw-url" data-url readonly value="${escapeHtml(src)}" />
            </div>
            <div class="nsfw-dp-status ok" data-status>可复制到 mpv / VLC 播放。</div>
            <video class="nsfw-vid show" controls playsinline data-video src="${escapeHtml(src)}"></video>
          `,
        });
        document.body.insertBefore(root, document.body.firstChild);
        root.style.display = "none"; // 不自动弹出
        nsfwDockBadge(() => showRoot(root));
        bindUrlInput(root);
        root.addEventListener("click", (ev) => {
          const t = ev.target.closest("[data-act]");
          if (!t) return;
          if (t.getAttribute("data-act") === "copy") {
            ev.preventDefault();
            doCopy(root);
          } else if (t.getAttribute("data-act") === "pip") {
            ev.preventDefault();
            doPip(root);
          }
        });
        toast("分享页直链已提取", "info");
        return true;
      };

      if (tryEnhance()) return;
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        if (tryEnhance() || n > 50) clearInterval(timer);
      }, 200);
    }

    function showRoot(root) {
      root.style.display = "";
      root.classList.remove("collapsed");
      prefSet(`${NS}_collapsed`, false);
      const cb = root.querySelector('[data-act="collapse"]');
      if (cb) cb.textContent = "▾";
      root.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // 列表页：悬停预览无，只在详情/分享页工作
    if (isSharePage()) {
      enhanceSharePage();
      return;
    }
    if (!isViewPage()) return;

    const root = ensureRoot();
    root.style.display = "none"; // 不自动弹出：取到直链后点亮悬浮球下的小圆钮

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]");
      if (!t || !root.contains(t)) return;
      const act = t.getAttribute("data-act");
      if (act === "load") {
        ev.preventDefault();
        loadHd(root);
      } else if (act === "sd") {
        ev.preventDefault();
        loadSd(root).catch(() => {});
      } else if (act === "copy") {
        ev.preventDefault();
        doCopy(root);
      } else if (act === "pip") {
        ev.preventDefault();
        doPip(root);
      }
    });

    nsfwDockEntry(`${NS}-entry`, "HD 直链", () => {
      showRoot(root);
      loadHd(root);
    });

    bindHotkeys((e) => {
      if (!isSp2026()) return;
      if (e.code === "KeyD") {
        e.preventDefault();
        showRoot(root);
        loadHd(root);
      } else if (e.code === "KeyS") {
        e.preventDefault();
        loadSd(root).catch(() => {});
      } else if (e.code === "KeyC") {
        e.preventDefault();
        doCopy(root);
      } else if (e.code === "KeyP") {
        e.preventDefault();
        doPip(root);
      }
    });

    // 普通详情页也默认自动拉 HD（可关）
    const auto =
      root.querySelector('[data-opt="autoplay"]')?.checked ??
      prefGet("sp_autoplay", true);
    if (auto) {
      loadHd(root);
    } else {
      setStatus(
        root,
        isHdPage()
          ? "高清页：点「获取并播放 HD」解码分享链。"
          : "详情页：可直接取 HD，或 SD 兜底。"
      );
    }
  }

  // ─── 入口 ─────────────────────────────────────────────────
  if (is3go()) run3go();
  else if (isSp2026()) runSp2026();
})();

/* =====================================================================
 * 模块 2/7：*王论坛 - 免币看视频 (mobile API) v1.1.1
 * ===================================================================== */

(function () {
  'use strict';

  if (!/(^|\.)laowang|opk\d*\.vip$/i.test(location.hostname) && !/laowang/i.test(location.hostname)) {
    return;
  }

  const PANEL_ID = 'lw-free-video-panel';
  const STYLE_ID = 'lw-free-video-style';

  function absUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith('//')) return location.protocol + path;
    if (path.startsWith('/')) return location.origin + path;
    return location.origin + '/' + path.replace(/^\.\//, '');
  }

  function getTid() {
    const u = new URL(location.href);
    let m = u.searchParams.get('tid');
    if (m && /^\d+$/.test(m)) return m;
    m = location.pathname.match(/(?:thread-|tid-)(\d+)/i);
    if (m) return m[1];
    m = location.href.match(/[?&]tid=(\d+)/i);
    return m ? m[1] : null;
  }

  function hasDcSellLock() {
    const html = document.documentElement.innerHTML;
    return (
      html.includes('dc_locked') ||
      html.includes('dc_sell:pay') ||
      html.includes('dc_pay_button') ||
      /本付费内容需要支付/.test(html)
    );
  }

  function extractPlayIds(text) {
    if (!text) return [];
    const ids = new Set();
    const patterns = [
      /\/remote_play\/video\/play\/(\d+)/gi,
      /\/remote_play\/index\.php\/play\/ajax\/(\d+)/gi,
      /play\/ajax\/(\d+)\.html/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text))) ids.add(m[1]);
    }
    const iframeRe = /src=["']([^"']*remote_play[^"']+)["']/gi;
    let im;
    while ((im = iframeRe.exec(text))) {
      const m2 = im[1].match(/(\d{3,})/);
      if (m2) ids.add(m2[1]);
    }
    return [...ids];
  }

  function extractDirectM3u8(text) {
    if (!text) return [];
    const out = new Set();
    let m;
    const re = /https?:\/\/[^\s"'<>]+m3u8[^\s"'<>]*/gi;
    while ((m = re.exec(text))) out.add(m[0].replace(/&amp;/g, '&'));
    const re2 = /\/remote_m3u8\/[^\s"'<>]+/gi;
    while ((m = re2.exec(text))) out.add(absUrl(m[0].replace(/&amp;/g, '&')));
    return [...out];
  }

  function gmFetch(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const headers = Object.assign(
        { Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest' },
        opts.headers || {}
      );
      if (url.startsWith(location.origin) || url.startsWith('/')) {
        const u = url.startsWith('/') ? location.origin + url : url;
        fetch(u, {
          method: opts.method || 'GET',
          credentials: 'include',
          headers,
          body: opts.body || null,
        })
          .then(async (r) => resolve({ status: r.status, text: await r.text() }))
          .catch(reject);
        return;
      }
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: opts.method || 'GET',
          url,
          headers,
          data: opts.body || null,
          onload(res) {
            resolve({ status: res.status, text: res.responseText || '' });
          },
          onerror(err) {
            reject(err);
          },
        });
      } else {
        reject(new Error('no fetch'));
      }
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css =
      '#' +
      PANEL_ID +
      '{position:fixed;z-index:2147483646;right:64px;bottom:16px;width:min(420px,calc(100vw - 80px));max-height:min(70vh,640px);overflow:auto;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px/1.45 system-ui,sans-serif}' +
      '#' +
      PANEL_ID +
      ' .hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1f2937;border-bottom:1px solid #374151;position:sticky;top:0}' +
      '#' +
      PANEL_ID +
      ' .hd b{font-size:13px}' +
      '#' +
      PANEL_ID +
      ' .hd .btns{display:flex;gap:6px}' +
      '#' +
      PANEL_ID +
      ' button,#' +
      PANEL_ID +
      ' a.btn{appearance:none;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#2563eb;color:#fff;text-decoration:none;font-size:12px}' +
      '#' +
      PANEL_ID +
      ' button.sec{background:#374151}' +
      '#' +
      PANEL_ID +
      ' button:disabled{opacity:.5;cursor:not-allowed}' +
      '#' +
      PANEL_ID +
      ' .bd{padding:10px 12px}' +
      '#' +
      PANEL_ID +
      ' .muted{color:#9ca3af;font-size:12px}' +
      '#' +
      PANEL_ID +
      ' .err{color:#fca5a5}' +
      '#' +
      PANEL_ID +
      ' .ok{color:#86efac}' +
      '#' +
      PANEL_ID +
      ' .card{border:1px solid #374151;border-radius:10px;padding:10px;margin:8px 0;background:#0b1220}' +
      '#' +
      PANEL_ID +
      ' .card h4{margin:0 0 6px;font-size:13px;color:#93c5fd}' +
      '#' +
      PANEL_ID +
      ' .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
      '#' +
      PANEL_ID +
      ' .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}' +
      '#' +
      PANEL_ID +
      ' video{width:100%;max-height:220px;background:#000;border-radius:8px;margin-top:8px}' +
      '#' +
      PANEL_ID +
      '.min .bd{display:none}' +
      '#' +
      PANEL_ID +
      '.min{width:auto}';
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = css;
      document.head.appendChild(s);
    }
  }

  function panel() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    ensureStyle();
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML =
      '<div class="hd"><b>免金币看视频</b><div class="btns">' +
      '<button type="button" class="sec" data-act="min">收起</button>' +
      '<button type="button" class="sec" data-act="close">关闭</button></div></div>' +
      '<div class="bd"><div class="muted" data-role="meta">初始化…</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button type="button" data-act="run">拉取并播放</button>' +
      '<button type="button" class="sec" data-act="rerun">强制刷新</button></div>' +
      '<div data-role="list"></div></div>';
    document.documentElement.appendChild(el);
    el.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'close') el.style.display = 'none';
      if (act === 'min') el.classList.toggle('min');
      if (act === 'run' || act === 'rerun') run({ force: act === 'rerun' });
    });
    return el;
  }

  function setMeta(html, isErr) {
    const el = panel().querySelector('[data-role="meta"]');
    el.className = isErr ? 'err' : 'muted';
    el.innerHTML = html;
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve(true);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  async function fetchMobileThread(tid) {
    const url = '/api/mobile/index.php?version=4&module=viewthread&tid=' + encodeURIComponent(tid);
    const res = await gmFetch(url);
    if (res.status !== 200) throw new Error('mobile API HTTP ' + res.status);
    var data;
    try {
      data = JSON.parse(res.text);
    } catch (e) {
      throw new Error('mobile API 非 JSON（可能被防火墙拦截）');
    }
    var vars = data.Variables || data.variables || {};
    var posts = vars.postlist || vars.postList || [];
    var messages = posts.map(function (p) { return p.message || p.content || ''; }).filter(Boolean);
    var blob = messages.join('\n') + '\n' + res.text;
    return {
      data: data,
      subject: (vars.thread && (vars.thread.subject || vars.thread.title)) || document.title,
      messages: messages,
      blob: blob,
    };
  }

  async function fetchPlayAjax(playId) {
    const url = '/remote_play/index.php/play/ajax/' + encodeURIComponent(playId) + '.html';
    const res = await gmFetch(url);
    if (res.status !== 200) throw new Error('play ajax HTTP ' + res.status);
    try {
      return JSON.parse(res.text);
    } catch (e) {
      throw new Error('play ajax 非 JSON');
    }
  }

  function renderItem(container, item) {
    const card = document.createElement('div');
    card.className = 'card';
    const title = item.title || ('play #' + item.id);
    const playPage = absUrl('/remote_play/video/play/' + item.id + '.html');
    const m3u8 = item.m3u8 || '';
    const dl = item.download ? absUrl(item.download) : '';
    card.innerHTML =
      '<h4>' + escapeHtml(title) + '</h4>' +
      '<div class="mono muted">id=' + escapeHtml(String(item.id)) + '</div>' +
      (m3u8 ? '<div class="mono" style="margin-top:6px">' + escapeHtml(m3u8) + '</div>' : '') +
      '<div class="row">' +
      '<a class="btn" href="' + playPage + '" target="_blank" rel="noopener">打开播放页</a>' +
      (m3u8 ? '<button type="button" data-copy="' + escapeAttr(m3u8) + '">复制 m3u8</button>' : '') +
      (dl ? '<a class="btn sec" href="' + escapeAttr(dl) + '" target="_blank" rel="noopener">下载页</a>' : '') +
      (m3u8 ? '<button type="button" class="sec" data-playsrc="' + escapeAttr(m3u8) + '">本页试播</button>' : '') +
      '</div><div data-vhost></div>';
    card.addEventListener('click', async function (e) {
      const c = e.target.closest('[data-copy]');
      if (c) {
        const ok = await copyText(c.getAttribute('data-copy'));
        c.textContent = ok ? '已复制' : '复制失败';
        setTimeout(function () { c.textContent = '复制 m3u8'; }, 1200);
      }
      const p = e.target.closest('[data-playsrc]');
      if (p) {
        const host = card.querySelector('[data-vhost]');
        host.innerHTML =
          '<video controls autoplay playsinline src="' + escapeAttr(p.getAttribute('data-playsrc')) + '"></video>' +
          '<div class="muted">若无法播，多半是 AES 分片/跨域；请用播放页或把 m3u8 丢给 PotPlayer/mpv。</div>';
      }
    });
    container.appendChild(card);
  }

  var running = false;
  async function run() {
    if (running) return;
    running = true;
    const p = panel();
    const list = p.querySelector('[data-role="list"]');
    const btn = p.querySelector('[data-act="run"]');
    btn.disabled = true;
    list.innerHTML = '';
    try {
      const tid = getTid();
      if (!tid) {
        setMeta('当前页解析不到 tid（请在帖子页使用）', true);
        return;
      }
      const locked = hasDcSellLock();
      setMeta(
        'tid=<b>' + tid + '</b> ' +
          (locked
            ? '<span class="ok">检测到付费锁，正在走 mobile API…</span>'
            : '<span class="muted">未检测到锁，仍尝试 mobile API…</span>')
      );

      const mt = await fetchMobileThread(tid);
      const playIds = extractPlayIds(mt.blob);
      const direct = extractDirectM3u8(mt.blob);

      if (!playIds.length && !direct.length) {
        setMeta(
          'tid=' + tid + ' mobile API 已返回，但未找到 remote_play / m3u8。<br>' +
            '这通常是 <b>jnpar 网盘帖</b>（mobile 不吐链），不是 dc_sell 视频帖。',
          true
        );
        return;
      }

      setMeta(
        '标题：' + escapeHtml(mt.subject || '') + '<br>' +
          '找到 play id：<b>' + (playIds.join(', ') || '无') + '</b>；直接 m3u8：<b>' + direct.length + '</b>'
      );

      for (var i = 0; i < direct.length; i++) {
        renderItem(list, { id: 'm3u8', title: '直接 m3u8', m3u8: direct[i] });
      }

      for (var j = 0; j < playIds.length; j++) {
        var id = playIds[j];
        try {
          var info = await fetchPlayAjax(id);
          var playlink = info.playlink || info.url || info.m3u8 || '';
          renderItem(list, {
            id: id,
            title: info.title || info.name || ('视频 ' + id),
            m3u8: playlink ? absUrl(playlink) : '',
            download: info.download || info.down || '',
          });
        } catch (e) {
          var card = document.createElement('div');
          card.className = 'card';
          card.innerHTML =
            '<h4>play ' + escapeHtml(id) + '</h4><div class="err">' + escapeHtml(e.message || e) + '</div>' +
            '<div class="row"><a class="btn" target="_blank" rel="noopener" href="' +
            absUrl('/remote_play/video/play/' + id + '.html') +
            '">仍打开播放页</a></div>';
          list.appendChild(card);
        }
      }
      nsfwDockBadge(function () { panel().style.display = ''; }); // 解析出链接：点亮小圆钮，等用户自己打开
    } catch (e) {
      setMeta(escapeHtml(e.message || String(e)), true);
    } finally {
      running = false;
      btn.disabled = false;
    }
  }

  function shouldAuto() {
    return !!(getTid() && (hasDcSellLock() || /mod=viewthread|thread-\d+/i.test(location.href)));
  }

  function togglePanel() {
    const el = panel();
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }

  function boot() {
    if (!getTid()) return;
    nsfwDockEntry('lw-free-video-entry', '老王免币视频', togglePanel);
    panel().style.display = 'none'; // 不自动弹出：有结果时点亮悬浮球下的小圆钮
    if (shouldAuto()) setTimeout(function () { run(); }, 600);
    else setMeta('tid=<b>' + getTid() + '</b>。点击「拉取并播放」使用 mobile API。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  var last = location.href;
  setInterval(function () {
    if (location.href !== last) {
      last = location.href;
      if (getTid()) boot();
    }
  }, 1200);
})();

/* =====================================================================
 * 模块 3/7：J*vhub 无限观看 + 下载 v1.0.1 【已加站点守卫】
 * ===================================================================== */

/* ============================================================================
 * 逆向结论（来自对 javhub.net 的实际逆向）:
 *  - 每个 /play/<id>/<slug> 页面的 HTML 里直接内嵌完整视频签名直链:
 *      <video src="https://<cdn>.2babes.com|anyhentai.com/mp4/<md5>.mp4?md5=<token>&expires=<unix>">
 *    签名参数为 md5 token + 过期时间（约 6 小时），服务器每次生成新签名。
 *  - CDN(2babes/anyhentai) 不在 Cloudflare 后面，只校验 Referer 指向 javhub.net，
 *    支持 HTTP Range（可断点续传），无 CORS、无 Content-Disposition。
 *  - 观看计数由服务端按访客 cookie `_var`（httpOnly，按 IP 生成）在 POST /playapi 时统计；
 *    播放页每次加载都会派发全新签名 URL，因此“无限观看”= 每页刷新即有新配额/新源。
 *  - 免费下载 = 直接抓取页内签名的 mp4 源码（全片、多清晰度见 jwplayer playlist）。
 *  本脚本因此启用 GM_xmlhttpRequest（绕过 CORS、可带 Referer）实现流式下载，
 *  并用 GM_cookie 旋转身份应对服务端观看限额页。
 * ==========================================================================*/

(() => {
  "use strict";
  // [merged] 站点守卫：仅 javhub.net 播放页生效
  if (!/(^|\.)javhub\.net$/i.test(location.hostname) || !location.pathname.startsWith("/play/")) return;


  const SELF_ORIGIN = location.origin;
  const CDN_RE = /^(?:https?:)?\/\/[0-9a-z.-]*(?:2babes|anyhentai)[^"'\s]*/i;

  /* ---------------- 工具 ---------------- */

  function parseSignedUrl(u) {
    // 解析签名 URL 的 expires 与剩余时长
    try {
      const m = u.match(/[?&]expires=(\d+)/i);
      if (!m) return null;
      const exp = parseInt(m[1], 10) * 1000;
      const remain = exp - Date.now();
      return { expires: exp, remainMs: remain, expired: remain <= 0 };
    } catch (e) { return null; }
  }

  function fmtSize(n) {
    if (!n) return "?";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + " " + u[i];
  }

  function fmtTime(ms) {
    if (ms <= 0) return "已过期";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  /* ---------------- 取源 ---------------- */

  function collectSources() {
    // 1) <video> 元素
    const out = [];
    const v = document.querySelector("video");
    if (v) {
      const src = v.currentSrc || v.getAttribute("src") || "";
      if (src && CDN_RE.test(src)) out.push({ url: src, label: "当前" });
      // <source> 子元素
      document.querySelectorAll("video source").forEach(s => {
        const su = s.src || s.getAttribute("src");
        if (su && CDN_RE.test(su) && !out.some(o => o.url === su)) {
          out.push({ url: su, label: (s.getAttribute("label") || s.getAttribute("res") || "来源") });
        }
      });
    }
    // 2) jwplayer playlist（多清晰度时列出全部）
    try {
      if (typeof jwplayer === "function") {
        const jw = jwplayer();
        const pl = jw && jw.getPlaylist ? jw.getPlaylist() : null;
        const all = pl && pl[0] ? (pl[0].allSources || pl[0].sources || []) : [];
        all.forEach((s, i) => {
          if (s && s.file && CDN_RE.test(s.file) && !out.some(o => o.url === s.file)) {
            out.push({ url: s.file, label: s.label && s.label !== "0" ? s.label : (`清晰度 ${i + 1}`) });
          }
        });
      }
    } catch (e) {}
    // 3) 页面 HTML 兜底
    if (!out.length) {
      const m = document.documentElement.outerHTML.match(CDN_RE);
      if (m) out.push({ url: m[0].replace(/&amp;/g, "&"), label: "嵌入" });
    }
    return out;
  }

  function setPlayerSrc(url) {
    // 原地换源（不刷新页面）
    const v = document.querySelector("video");
    if (v) { v.src = url; v.load(); try { v.play().catch(() => {}); } catch (e) {} }
    try {
      if (typeof jwplayer === "function") {
        const jw = jwplayer();
        if (jw && jw.load) jw.load({ file: url });
        else if (jw && jw.setup) jw.setup({ playlist: [{ sources: [{ file: url, type: "mp4" }] }] });
      }
    } catch (e) {}
  }

  /* ---------------- 重取源（不刷新页面，续约签名 URL） ---------------- */

  function refetchSource() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: location.href,
        headers: { "Referer": SELF_ORIGIN + "/", "X-Requested-With": "XMLHttpRequest" },
        timeout: 30000,
        onload: (res) => {
          try {
            const html = res.responseText;
            const m = html.match(/https:\/\/[0-9a-z.-]*(?:2babes|anyhentai)[^"'\s&]*\.mp4\?[^"'\s&]*/i);
            resolve(m ? m[0].replace(/&amp;/g, "&") : null);
          } catch (e) { resolve(null); }
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  /* ---------------- 下载（流式分块写盘） ---------------- */

  const CHUNK = 16 * 1024 * 1024; // 16MB / 块

  async function streamDownload(url, filename, preWriter, onProgress) {
    // 1) HEAD 拿总大小
    const size = await new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "HEAD", url,
        headers: { "Referer": SELF_ORIGIN + "/" },
        onload: (r) => {
          const cl = r.responseHeaders.match(/content-length:\s*(\d+)/i);
          resolve(cl ? parseInt(cl[1], 10) : 0);
        },
        onerror: () => resolve(0), ontimeout: () => resolve(0), timeout: 30000,
      });
    });

    // 2) 写盘句柄：优先使用点击手势内预取的 File System Access API 句柄
    let writer = preWriter, parts = null;
    if (!writer) parts = []; // Firefox 兜底：内存分片

    let done = 0;
    const total = Math.max(size, 1);

    const fetchRange = (start, end) => new Promise((resolveChunk, rejectChunk) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          "Referer": SELF_ORIGIN + "/",
          "Range": `bytes=${start}-${end > 0 ? end : ""}`,
        },
        responseType: "blob",
        timeout: 120000,
        onload: (r) => {
          if (r.status === 200 || r.status === 206) resolveChunk(r.response);
          else rejectChunk(new Error("HTTP " + r.status));
        },
        onerror: () => rejectChunk(new Error("网络错误")),
        ontimeout: () => rejectChunk(new Error("超时")),
      });
    });

    try {
      while (done < total) {
        const end = Math.min(done + CHUNK - 1, total - 1);
        let blob;
        try {
          blob = await fetchRange(done, end);
        } catch (e) {
          await new Promise(r => setTimeout(r, 3000)); // 网络抖动重试
          blob = await fetchRange(done, end);
        }
        if (writer) await writer.write(blob);
        else parts.push(blob);
        done += blob.size;
        onProgress(done, total);
      }
      if (writer) await writer.close();
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 120000);
      }
      return true;
    } catch (e) {
      if (writer) { try { await writer.abort(); } catch (_) {} }
      throw e;
    }
  }

  /* ---------------- UI ---------------- */

  function buildPanel(sources) {
    GM_addStyle(`
      #jhx-panel{position:fixed;top:90px;right:12px;z-index:2147483646;width:300px;
        background:#14161c;color:#e8e8e8;border:1px solid #775cdc;border-radius:10px;
        font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.55);overflow:hidden}
      #jhx-panel .jhx-head{padding:8px 12px;background:#775cdc;color:#fff;font-weight:700;cursor:move;
        display:flex;justify-content:space-between;align-items:center}
      #jhx-panel .jhx-body{padding:10px 12px}
      #jhx-panel .jhx-row{display:flex;gap:8px;align-items:center;margin:6px 0}
      #jhx-panel button{border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:600}
      #jhx-panel .jhx-btn-dl{background:#28a745;color:#fff;flex:1}
      #jhx-panel .jhx-btn-dl:disabled{background:#5a5f6a;cursor:wait}
      #jhx-panel .jhx-btn2{background:#343a46;color:#e8e8e8}
      #jhx-panel select{flex:1;background:#262a34;color:#e8e8e8;border:1px solid #444;border-radius:6px;padding:4px}
      #jhx-panel .jhx-bar{height:8px;background:#262a34;border-radius:4px;overflow:hidden;margin-top:6px}
      #jhx-panel .jhx-bar>div{height:100%;background:#28a745;width:0}
      #jhx-panel .jhx-meta{color:#9aa0ab;font-size:12px;margin-top:6px;word-break:break-all}
      #jhx-panel .jhx-err{color:#ff6b6b;font-size:12px;margin-top:6px}
      #jhx-panel .jhx-ok{color:#51cf66;font-size:12px;margin-top:6px}
    `);

    const panel = document.createElement("div");
    panel.id = "jhx-panel";
    panel.innerHTML = `
      <div class="jhx-head"><span>J*vhub 无限观看+下载</span><span style="cursor:pointer" id="jhx-min">—</span></div>
      <div class="jhx-body">
        <div class="jhx-row">
          <select id="jhx-src"></select>
        </div>
        <div class="jhx-row">
          <button id="jhx-dl" class="jhx-btn-dl">⬇ 下载所选</button>
          <button id="jhx-copy" class="jhx-btn2">复制</button>
          <button id="jhx-refresh" class="jhx-btn2">换源</button>
        </div>
        <div class="jhx-row"><button id="jhx-play" class="jhx-btn2" style="flex:1">▶ 强制播放</button></div>
        <div class="jhx-bar"><div id="jhx-barfill"></div></div>
        <div class="jhx-meta" id="jhx-meta"></div>
        <div class="jhx-err" id="jhx-err"></div>
        <div class="jhx-ok" id="jhx-ok"></div>
      </div>`;
    document.body.appendChild(panel);

    const $ = (id) => panel.querySelector(id);
    const sel = $("#jhx-src");
    sources.forEach((s, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `${s.label} — ${fmtSize(s.size || 0)}`;
      sel.appendChild(o);
    });
    // 默认选中当前播放的那条
    const cur = (document.querySelector("video") || {}).currentSrc || (document.querySelector("video") || {}).src || "";
    if (cur) {
      const i = sources.findIndex(s => s.url === cur);
      if (i >= 0) sel.value = String(i);
    }

    // 异步补全各源的文件大小（HEAD Content-Length）
    sources.forEach((s, i) => {
      GM_xmlhttpRequest({
        method: "HEAD",
        url: s.url,
        headers: { "Referer": SELF_ORIGIN + "/" },
        timeout: 20000,
        onload: (r) => {
          const cl = r.responseHeaders.match(/content-length:\s*(\d+)/i);
          if (cl) {
            s.size = parseInt(cl[1], 10);
            const o = sel.options[i];
            if (o) o.textContent = `${s.label} — ${fmtSize(s.size)}`;
            if (i === parseInt(sel.value, 10)) renderMeta();
          }
        },
      });
    });

    const meta = $("#jhx-meta");
    function renderMeta() {
      const srcs = collectSources();
      const s = srcs[parseInt(sel.value, 10)] || srcs[0];
      if (!s) { meta.textContent = "未检测到视频源"; return; }
      const p = parseSignedUrl(s.url);
      meta.innerHTML = `文件: <b>${s.url.split("/").pop().split("?")[0]}</b><br>` +
        `大小: <b>${fmtSize(s.size)}</b> &nbsp; 签名剩余: <b id="jhx-exp">${p ? fmtTime(p.remainMs) : "?"}</b>`;
      const exp = $("#jhx-exp");
      if (exp && p) {
        const t = setInterval(() => {
          const pp = parseSignedUrl(s.url);
          exp.textContent = pp ? fmtTime(pp.remainMs) : "?";
          if (pp && pp.expired) clearInterval(t);
        }, 1000);
      }
    }
    renderMeta();
    sel.addEventListener("change", renderMeta);

    // 拖动
    let drag = false;
    panel.querySelector(".jhx-head").addEventListener("mousedown", (e) => {
      drag = true;
      const dx = e.clientX - panel.getBoundingClientRect().left;
      const dy = e.clientY - panel.getBoundingClientRect().top;
      const mm = (ev) => {
        if (!drag) return;
        panel.style.left = (ev.clientX - dx) + "px";
        panel.style.top = (ev.clientY - dy) + "px";
        panel.style.right = "auto";
      };
      const mu = () => { drag = false; window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", mu); };
      window.addEventListener("mousemove", mm);
      window.addEventListener("mouseup", mu);
    });
    $("#jhx-min").addEventListener("click", () => {
      panel.querySelector(".jhx-body").style.display =
        panel.querySelector(".jhx-body").style.display === "none" ? "" : "none";
    });

    // 下载
    $("#jhx-dl").addEventListener("click", async () => {
      const srcs = collectSources();
      const s = srcs[parseInt(sel.value, 10)] || srcs[0];
      if (!s) { $("#jhx-err").textContent = "未检测到视频源"; return; }
      const btn = $("#jhx-dl");
      btn.disabled = true;
      btn.textContent = "下载中…";
      $("#jhx-err").textContent = "";
      const title = (document.title.split("|")[0] || "video").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
      const fn = (title + "_" + s.url.split("/").pop().split("?")[0]).replace(/&/g, "_");
      // 必须在用户手势内同步弹出保存对话框（异步后会失去用户激活）
      let writer = null;
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fn,
            types: [{ description: "MP4 视频", accept: { "video/mp4": [".mp4"] } }],
          });
          writer = await handle.createWritable();
        } catch (e) {
          $("#jhx-err").textContent = "已取消选择保存位置";
          btn.disabled = false;
          btn.textContent = "⬇ 下载所选";
          return;
        }
      }
      $("#jhx-ok").textContent = writer ? "开始流式下载…" : "Firefox 模式：将在完成后弹出保存（大文件请谨慎）";
      try {
        const ok = await streamDownload(s.url, fn, writer, (done, total) => {
          $("#jhx-barfill").style.width = (done / Math.max(total, 1) * 100).toFixed(1) + "%";
          $("#jhx-meta").innerHTML = `下载中 … ${fmtSize(done)} / ${fmtSize(total)}`;
        });
        if (ok) {
          $("#jhx-barfill").style.width = "100%";
          $("#jhx-ok").textContent = "✅ 下载完成（已保存为 " + fn + "）";
          if (typeof GM_notification === "function") GM_notification({ title: "J*vhub 下载完成", text: fn, timeout: 5000 });
        }
      } catch (e) {
        $("#jhx-err").textContent = "下载失败: " + e.message +
          "（大文件请保持浏览器前台并检查磁盘空间）";
      }
      btn.disabled = false;
      btn.textContent = "⬇ 下载所选";
    });

    // 复制链接
    $("#jhx-copy").addEventListener("click", () => {
      const srcs = collectSources();
      const s = srcs[parseInt(sel.value, 10)] || srcs[0];
      if (!s) return;
      GM_setClipboard(s.url);
      $("#jhx-ok").textContent = "已复制签名直链（约 6 小时内有效）";
    });

    // 换源 / 续约
    $("#jhx-refresh").addEventListener("click", async () => {
      $("#jhx-refresh").disabled = true;
      $("#jhx-ok").textContent = "正在重新获取签名源…";
      const u = await refetchSource();
      if (u) {
        setPlayerSrc(u);
        $("#jhx-ok").textContent = "✅ 已原地换源并续约签名（无需刷新页面）";
        setTimeout(renderMeta, 800);
      } else {
        $("#jhx-err").textContent = "换源失败（可能已触发观看限制页）";
      }
      $("#jhx-refresh").disabled = false;
    });

    // 强制播放（浏览器自动播放策略拦截时）
    $("#jhx-play").addEventListener("click", () => {
      const v = document.querySelector("video");
      if (v) { v.currentTime = v.currentTime || 0; v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
      try { if (typeof jwplayer === "function") jwplayer().play(); } catch (e) {}
      $("#jhx-ok").textContent = "已尝试强制播放";
    });
  }

  /* ---------------- 观看限制的自动恢复 ---------------- */

  function isPaywallPage() {
    // 付费页/限制页特征：无视频源 + 出现推广文案
    const v = document.querySelector("video");
    if (v && (v.currentSrc || v.getAttribute("src"))) return false;
    const body = (document.body ? document.body.innerText : "") || "";
    return /premium|membership|unlimited watch|video download|pricing/i.test(body.slice(0, 4000));
  }

  function rotateIdentity() {
    // 服务端按 _var cookie（httpOnly）统计访客观看数；GM_cookie 可绕过 httpOnly 限制。
    // 返回是否成功旋转。
    return new Promise((resolve) => {
      if (typeof GM_cookie === "undefined" || !GM_cookie.list) return resolve(false);
      GM_cookie.list({ domain: "javhub.net" }, (cookies, err) => {
        if (err) return resolve(false);
        const v = (cookies || []).find(c => c.name === "_var");
        const prefix = v ? v.value.split("_")[0] + "_" : "";
        // 生成与站点格式一致的尾段：8 位 hex 的 base64
        const hex = Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
        const tail = btoa(hex);
        const cleanup = [];
        const set = () => new Promise((res) => {
          GM_cookie.set({ domain: "javhub.net", path: "/", name: "_var", value: prefix + tail,
                          expires: Math.floor(Date.now() / 1000) + 86400 * 30 }, (e2) => res(!e2));
        });
        if (v) {
          GM_cookie.delete({ domain: "javhub.net", name: "_var" }, (e1) => {
            void e1;
            set().then(resolve);
          });
        } else {
          set().then(resolve);
        }
      });
    });
  }

  function autoRecover() {
    if (!isPaywallPage()) return;
    const tag = document.querySelector("#jhx-ok");
    if (tag) tag.textContent = "检测到观看限制页，正在自动恢复…";

    refetchSource().then(async (u) => {
      if (u) {
        setPlayerSrc(u);
        if (tag) tag.textContent = "✅ 已自动恢复播放（新签名源）";
        return;
      }
      // 换源不行 → 旋转 _var 身份后整页刷新
      const ok = await rotateIdentity();
      if (tag) tag.textContent = ok ? "已旋转访客身份，刷新页面…" : "身份旋转不可用，等待服务端恢复";
      setTimeout(() => {
        if (isPaywallPage()) location.reload();
      }, 1500);
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    nsfwDockEntry("jhx-entry", "J*vhub 下载", () => {
      const panel = document.querySelector("#jhx-panel");
      if (!panel) { buildPanel(collectSources()); return; }
      panel.style.display = panel.style.display === "none" ? "" : "none";
    });
    // 等播放器挂载源
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const srcs = collectSources();
      if ((srcs.length || tries > 20) && document.body) {
        clearInterval(t);
        if (!document.querySelector("#jhx-panel")) {
          buildPanel(srcs);
          const panel = document.querySelector("#jhx-panel");
          if (panel) {
            panel.style.display = "none"; // 不自动弹出
            if (srcs.length) nsfwDockBadge(() => { panel.style.display = ""; });
          }
        }
      }
    }, 500);

    // 观看限制自动恢复（每 4 秒巡检）
    setInterval(autoRecover, 4000);
    setTimeout(autoRecover, 3000);

    // 自动尝试播放（消除“点一下开始”）
    setTimeout(() => {
      const v = document.querySelector("video");
      if (v && v.paused) { v.play().catch(() => {}); }
    }, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
 * 模块 4/7：X*sian 免会员播放 v1.0.1
 * 原理：
 *   [V1] POST https://v2.cdn199.com/js 网关，body.url=/sevenVideos/<id>
 *        匿名（userId=null）直接返回付费视频完整 m3u8s[]，付费校验纯前端
 *   [V2] API 响应 AES 加密，密钥硬编码 "xxx"（前端 decrypt()）
 *   [V3] 本地会员态 CapacitorStorage.SevenVideoUser 用 AES 密钥
 *        "xxxxx" 加密，可离线伪造 activeUntil 实现客户端 VIP
 *   [V4] VIP 高速线路参数 line=default1/hd1/hd2/hd3 匿名可用
 * 注意：网关要求 Origin/Referer/UA 匹配，否则 403 {"blocked":true}
 * ===================================================================== */
(function () {
  "use strict";

  const NS = "xa-free";
  const API_HOST = "v2.cdn199.com";
  const API_PATH = "/js";
  const AES_KEY_API = "xxx";      // 接口响应加密密钥（前端硬编码）
  const AES_KEY_LOCAL = "xxxxx";  // 本地存储加密密钥（前端硬编码）
  const STORE_KEY = "CapacitorStorage.SevenVideoUser";

  const KNOWN_HOST_RE =
    /(^|\.)(xasian|xchina|91porn|91zpc|hstv|1024video|1024fans|yaoporn|asianhub|madou|caoliu|theporny|dirtychinese|111porn|pornfk|pilipili|dsdtube|pornshop|bdsmzoo|91\.wtf)\./i;

  function isKnownSite() {
    return KNOWN_HOST_RE.test(location.hostname);
  }

  function getApp() {
    return location.hostname.replace(/^www\./, "");
  }

  /* ---------------- 基础工具 ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg, kind, ms) {
    kind = kind || "ok";
    ms = ms || 2400;
    let host = document.getElementById("nsfw-dp-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "nsfw-dp-toast-host";
      document.documentElement.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "nsfw-dp-toast " + kind;
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 280);
    }, ms);
  }

  function copyText(text) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof GM_setClipboard === "function") {
          GM_setClipboard(text);
          resolve();
          return;
        }
      } catch (_) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve, reject);
      } else {
        reject(new Error("no clipboard"));
      }
    });
  }

  /* ---------------- 网关调用 + AES 解密 ---------------- */

  function gmPost(url, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest 不可用"));
        return;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: "https://" + API_HOST + API_PATH,
        headers: Object.assign(
          {
            "Content-Type": "application/json",
            Origin: location.origin,
            Referer: location.origin + "/",
            "User-Agent": navigator.userAgent,
            Accept: "application/json, text/plain, */*",
          },
          extraHeaders || {}
        ),
        data: JSON.stringify(body),
        timeout: 30000,
        onload(res) {
          if (res.status < 200 || res.status >= 400) {
            let msg = "HTTP " + res.status;
            try {
              const j = JSON.parse(res.responseText);
              if (j && j.message) msg += " · " + j.message;
              else if (j && j.error) msg += " · " + j.error;
            } catch (_) {}
            reject(new Error(msg));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error("非 JSON 响应: " + res.responseText.slice(0, 120)));
          }
        },
        onerror: () => reject(new Error("网络错误")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  function evpBytesToKey(pass, salt, keyLen, ivLen) {
    // EVP_BytesToKey: D_i = MD5(D_{i-1} || pass || salt)
    const d = [];
    let prev = CryptoJS.lib.WordArray.create([]);
    for (;;) {
      const h = CryptoJS.algo.MD5.create();
      h.update(prev);
      h.update(CryptoJS.enc.Utf8.parse(pass));
      h.update(CryptoJS.enc.Latin1.parse(salt.toString("latin1")));
      prev = h.finalize();
      d.push(prev);
      const total = d.reduce((a, w) => a + w.sigBytes, 0);
      if (total >= keyLen + ivLen) break;
    }
    const all = CryptoJS.lib.WordArray.create(
      [].concat(...d.map((w) => w.words)),
      keyLen + ivLen
    );
    return {
      key: CryptoJS.lib.WordArray.create(all.words.slice(0, keyLen / 4)),
      iv: CryptoJS.lib.WordArray.create(
        all.words.slice(keyLen / 4, (keyLen + ivLen) / 4)
      ),
    };
  }

  function aesDecrypt(cipherB64, pass) {
    // CryptoJS.OpenSSL 格式：Salted__ + salt + AES-256-CBC(PKCS7)
    const raw = atob(cipherB64);
    if (raw.slice(0, 8) !== "Salted__") throw new Error("非 Salted 密文");
    const salt = raw.slice(8, 16);
    const ct = raw.slice(16);
    const { key, iv } = evpBytesToKey(pass, salt, 32, 16);
    const dec = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Latin1.parse(ct) },
      key,
      { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    return dec.toString(CryptoJS.enc.Utf8);
  }

  function aesEncrypt(plain, pass) {
    const enc = CryptoJS.AES.encrypt(plain, pass); // OpenSSL salted 格式
    return enc.toString();
  }

  function api(url, extra) {
    const body = Object.assign(
      {
        url,
        deviceInfo: {},
        app: getApp(),
        isStandalone: false,
        theLink: "novaluenull",
        uuid: "novalue",
      },
      extra || {}
    );
    return gmPost(API_PATH, body).then((j) => {
      if (!j || typeof j.r !== "string") throw new Error("网关响应异常");
      return JSON.parse(aesDecrypt(j.r, AES_KEY_API));
    });
  }

  /* ---------------- HLS 播放 ---------------- */

  let hlsInst = null;
  function playM3u8(video, url) {
    if (hlsInst) {
      try { hlsInst.destroy(); } catch (_) {}
      hlsInst = null;
    }
    video.style.display = "block";
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      return;
    }
    nsfwHls().then((H) => {
      if (!H || !H.isSupported()) {
        toast("本浏览器不支持 HLS，请用「复制」+外部播放器", "err");
        return;
      }
      hlsInst = new H();
      hlsInst.loadSource(url);
      hlsInst.attachMedia(video);
      hlsInst.on(H.Events.ERROR, (_e, data) => {
        if (data && data.fatal) toast("播放出错: " + data.type + " / " + data.details, "err");
      });
      video.play().catch(() => {});
    });
  }

  /* ---------------- 面板 UI（复用 nsfw-dp 样式） ---------------- */

  function injectStyles() {
    if (document.getElementById("nsfw-dp-shared-style")) return;
    GM_addStyle(`
      #nsfw-dp-toast-host {
        position: fixed; z-index: 2147483646;
        right: 64px; bottom: 72px;
        display: flex; flex-direction: column; gap: 8px;
        pointer-events: none; max-width: min(420px, calc(100vw - 80px));
      }
      .nsfw-dp-toast {
        opacity: 0; transform: translateY(8px);
        transition: opacity .22s, transform .22s;
        padding: 10px 14px; border-radius: 10px;
        font: 600 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 10px 28px rgba(0,0,0,.4);
        color: #0b1220; background: #86efac;
      }
      .nsfw-dp-toast.err { background: #fca5a5; }
      .nsfw-dp-toast.info { background: #93c5fd; }
      .nsfw-dp-toast.show { opacity: 1; transform: translateY(0); }

      .xa-panel {
        position: relative; z-index: 99990;
        margin: 12px 0 16px; padding: 0;
        border-radius: 14px; overflow: hidden;
        border: 1px solid #334155;
        background: linear-gradient(165deg, #1b2433 0%, #121820 100%);
        color: #e2e8f0;
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,.38);
        --xa-accent: #fbbf24; --xa-sec: #334155; --xa-muted: #94a3b8;
        --xa-input-bd: #475569; --xa-input-bg: #0b1220; --xa-ok: #86efac; --xa-err: #fca5a5;
      }
      .xa-hd {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 14px; cursor: default;
        border-bottom: 1px solid rgba(51,65,85,.7); user-select: none;
      }
      .xa-hd h3 { margin: 0; flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: var(--xa-accent); }
      .xa-hd h3 small { font-weight: 500; font-size: 11px; opacity: .72; color: #e2e8f0; }
      .xa-hd .xa-tools { display: flex; gap: 6px; }
      .xa-iconbtn {
        appearance: none; border: 0; border-radius: 8px; width: 30px; height: 30px;
        cursor: pointer; font-size: 14px; line-height: 1;
        background: var(--xa-sec); color: #e2e8f0;
      }
      .xa-body { padding: 12px 14px 14px; }
      .xa-panel.collapsed .xa-body { display: none; }
      .xa-panel.collapsed .xa-hd { border-bottom: 0; }
      .xa-sub { margin: 0 0 10px; font-size: 12px; color: var(--xa-muted); }
      .xa-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
      .xa-panel button.xa-btn, .xa-panel a.xa-btn {
        appearance: none; border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer;
        font-weight: 650; font-size: 12px; text-decoration: none;
        color: #0f172a; background: var(--xa-accent);
        display: inline-flex; align-items: center; gap: 6px;
      }
      .xa-panel button.xa-btn.secondary, .xa-panel a.xa-btn.secondary {
        background: var(--xa-sec); color: #e2e8f0;
      }
      .xa-panel button.xa-btn:disabled { opacity: .55; cursor: wait; }
      .xa-panel button.xa-btn.busy::before {
        content: ""; width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
        animation: xa-spin .7s linear infinite;
      }
      @keyframes xa-spin { to { transform: rotate(360deg); } }
      .xa-panel select.xa-line, .xa-panel input.xa-url {
        border-radius: 8px; border: 1px solid var(--xa-input-bd);
        background: var(--xa-input-bg); color: #e2e8f0;
        padding: 8px 10px; font-size: 12px;
      }
      .xa-panel input.xa-url {
        flex: 1 1 260px; min-width: 0;
        font-family: ui-monospace, monospace;
      }
      .xa-status {
        font-size: 12px; color: var(--xa-muted);
        word-break: break-all; white-space: pre-wrap; min-height: 1.35em;
      }
      .xa-status.ok { color: var(--xa-ok); }
      .xa-status.err { color: var(--xa-err); }
      .xa-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: #e2e8f0; margin: 4px 0 2px; }
      .xa-meta b { color: var(--xa-accent); }
      .xa-panel video.xa-vid {
        display: none; width: 100%;
        max-height: min(70vh, 720px); margin-top: 10px;
        border-radius: 8px; background: #000;
      }
      .xa-panel video.xa-vid.show { display: block; }
    `);
  }

  function buildPanel() {
    injectStyles();
    let root = document.getElementById(NS + "-root");
    if (root) return root;

    root = document.createElement("div");
    root.id = NS + "-root";
    root.className = "xa-panel";
    root.innerHTML = `
      <div class="xa-hd">
        <h3>X*sian 免会员直链<small>匿名取 m3u8 · 伪造本地 VIP</small></h3>
        <div class="xa-tools">
          <button type="button" class="xa-iconbtn" data-act="collapse" title="折叠/展开">▾</button>
          <button type="button" class="xa-iconbtn" data-act="hide" title="隐藏面板">✕</button>
        </div>
      </div>
      <div class="xa-body">
        <p class="xa-sub">网关 POST v2.cdn199.com/js · 响应 AES 密钥硬编码 "xxx" · 付费校验纯前端，匿名即可取完整 m3u8。</p>
        <div class="xa-row">
          <button type="button" class="xa-btn" data-act="load">获取直链并播放</button>
          <button type="button" class="xa-btn secondary" data-act="play" disabled>仅播放</button>
          <button type="button" class="xa-btn secondary" data-act="copy" disabled>复制</button>
          <button type="button" class="xa-btn secondary" data-act="dl" disabled>拼接下载</button>
          <button type="button" class="xa-btn secondary" data-act="forge">伪造会员态</button>
        </div>
        <div class="xa-meta" data-meta></div>
        <div class="xa-row">
          <select class="xa-line" data-line title="播放线路（VIP 高速线路匿名可用）">
            <option value="default1">default1 默认</option>
            <option value="hd1">hd1 高速</option>
            <option value="hd2">hd2 高速</option>
            <option value="hd3">hd3 高速</option>
          </select>
          <input class="xa-url" data-url type="text" readonly placeholder="m3u8 直链（双击复制）" />
        </div>
        <div class="xa-status" data-status>就绪。在详情页 /video/&lt;id&gt; 使用，或手动输入视频 ID。</div>
        <div class="xa-row">
          <input class="xa-url" data-vid type="text" placeholder="视频 ID（可选，如 HZxqbouILs）" style="flex:1 1 220px" />
        </div>
        <video class="xa-vid" controls playsinline preload="metadata" data-video></video>
      </div>
    `;

    // 挂载：插到页面主内容前
    const target =
      document.querySelector(".video-main, .video-detail, .player-section, main, #main") ||
      document.body;
    if (target && target !== document.body) {
      target.parentNode.insertBefore(root, target);
    } else {
      document.body.insertBefore(root, document.body.firstChild);
    }

    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]");
      if (!t || !root.contains(t)) return;
      const act = t.getAttribute("data-act");
      if (act === "collapse") {
        root.classList.toggle("collapsed");
        const cb = root.querySelector('[data-act="collapse"]');
        if (cb) cb.textContent = root.classList.contains("collapsed") ? "▸" : "▾";
      } else if (act === "hide") {
        root.style.display = "none";
        toast("面板已隐藏，悬浮球菜单里可重新打开", "info");
      } else if (act === "load") {
        doLoad({ play: true });
      } else if (act === "play") {
        doPlay();
      } else if (act === "copy") {
        doCopy();
      } else if (act === "dl") {
        doDownload();
      } else if (act === "forge") {
        doForge();
      }
    });

    const input = root.querySelector("[data-url]");
    input.addEventListener("dblclick", async () => {
      if (!input.value) return;
      try {
        await copyText(input.value);
        toast("已复制直链");
      } catch {
        input.select();
      }
    });

    return root;
  }

  function getVid() {
    // 1) 手动输入
    const manual = document.querySelector(`#${NS}-root [data-vid]`)?.value.trim();
    if (manual) return manual;
    // 2) URL /video/<id> 或 /download/<id>
    const m = location.pathname.match(/\/(?:video|download|embed)\/([^/?#]+)/i);
    if (m) return m[1];
    return null;
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.classList.add("busy");
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      btn.classList.remove("busy");
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
    }
  }

  function setStatus(msg, kind) {
    const el = document.querySelector(`#${NS}-root [data-status]`);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("ok", "err");
    if (kind) el.classList.add(kind);
  }

  function setMeta(v) {
    const el = document.querySelector(`#${NS}-root [data-meta]`);
    if (!el) return;
    el.innerHTML = [
      v.title ? `<span>标题 <b>${esc(v.title)}</b></span>` : "",
      v.videoType ? `<span>类型 <b>${esc(v.videoType)}</b></span>` : "",
      v.durationStr ? `<span>时长 <b>${esc(v.durationStr)}</b></span>` : "",
      v.size ? `<span>大小 <b>${esc(v.size)}</b></span>` : "",
      v.user ? `<span>作者 <b>${esc(v.user)}</b></span>` : "",
      v.downloadable ? `<span><b style="color:var(--xa-ok)">可下载</b></span>` : "",
    ].join("");
  }

  let lastData = null;

  async function doLoad({ play } = {}) {
    const root = document.getElementById(NS + "-root");
    const btn = root.querySelector('[data-act="load"]');
    setBusy(btn, true, "获取中…");
    try {
      const vid = getVid();
      if (!vid) throw new Error("未找到视频 ID（详情页 /video/<id>，或手动输入）");
      const line = root.querySelector("[data-line]")?.value || "default1";
      setStatus("请求 /sevenVideos/" + vid + " (line=" + line + ")…");
      const d = await api("/sevenVideos/" + vid, {
        userId: null,
        url_search: "?line=" + line,
        token: "ufd",
      });
      lastData = d;
      setMeta(d);
      const urls = d.m3u8s || [];
      if (!urls.length) throw new Error("响应无 m3u8s（可能该视频无播放源）");
      const url = urls[0];
      const input = root.querySelector("[data-url]");
      input.value = url;
      root.querySelector('[data-act="copy"]').disabled = false;
      root.querySelector('[data-act="dl"]').disabled = false;
      root.querySelector('[data-act="play"]').disabled = false;
      setStatus(
        `✅ ${d.videoType || "video"} · ${d.size || "?"} · 匿名直出完整 m3u8，付费校验纯前端已绕过。`,
        "ok"
      );
      toast("已获取直链");
      nsfwDockBadge(() => {
        root.style.display = "";
        root.classList.remove("collapsed");
        root.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      if (play) doPlay();
    } catch (e) {
      setStatus("失败: " + (e && e.message ? e.message : e), "err");
      toast(String((e && e.message) || e), "err");
    } finally {
      setBusy(btn, false);
    }
  }

  function doPlay() {
    const root = document.getElementById(NS + "-root");
    const url = root.querySelector("[data-url]")?.value;
    if (!url) {
      setStatus("还没有直链，先点「获取直链并播放」。", "err");
      return;
    }
    const video = root.querySelector("[data-video]");
    video.classList.add("show");
    playM3u8(video, url);
    setStatus("页内播放中（hls.js）· 不受站点 120 秒试看限制。", "ok");
  }

  async function doCopy() {
    const url = document.querySelector(`#${NS}-root [data-url]`)?.value;
    if (!url) return;
    try {
      await copyText(url);
      toast("已复制 m3u8 直链");
      setStatus("已复制直链（有签名时效，失效重取即可）。", "ok");
    } catch {
      document.querySelector(`#${NS}-root [data-url]`)?.select();
    }
  }

  async function doDownload() {
    const root = document.getElementById(NS + "-root");
    const url = root.querySelector("[data-url]")?.value;
    if (!url) {
      setStatus("没有直链", "err");
      return;
    }
    const btn = root.querySelector('[data-act="dl"]');
    setBusy(btn, true, "下载中…");
    try {
      const plRes = await fetch(url, {
        headers: { "User-Agent": navigator.userAgent, Referer: location.origin + "/" },
      });
      if (!plRes.ok) throw new Error("m3u8 HTTP " + plRes.status);
      const pl = await plRes.text();
      const segs = pl.split("\n").filter((l) => l && !l.startsWith("#"));
      if (!segs.length) throw new Error("m3u8 无分片");
      const base = url.slice(0, url.lastIndexOf("/") + 1);
      const name =
        (lastData && lastData.title
          ? String(lastData.title).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60)
          : getVid() || "video") + ".ts";
      const parts = [];
      for (let i = 0; i < segs.length; i++) {
        const segUrl = /^https?:\/\//i.test(segs[i]) ? segs[i] : base + segs[i];
        const r = await fetch(segUrl, {
          headers: { "User-Agent": navigator.userAgent, Referer: location.origin + "/" },
        });
        if (!r.ok) throw new Error("分片 " + i + " HTTP " + r.status);
        parts.push(await r.blob());
        setStatus(`拼接下载中… ${i + 1}/${segs.length}`, "ok");
      }
      const blob = new Blob(parts, { type: "video/mp2t" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setStatus(`已生成 ${name}（${(blob.size / 1048576).toFixed(1)} MB）`, "ok");
      toast("下载已开始");
    } catch (e) {
      setStatus("下载失败: " + (e && e.message ? e.message : e), "err");
    } finally {
      setBusy(btn, false);
    }
  }

  function doForge() {
    const root = document.getElementById(NS + "-root");
    const vid = getVid() || "deadbeefdeadbeefdeadbeef";
    const user = {
      userId: vid,
      userEmail: "poc@" + location.hostname,
      activeUntil: Date.now() + 86400 * 365 * 100 * 1000, // ~100 年后
      token: "forged-token",
    };
    try {
      const enc = aesEncrypt(JSON.stringify(user), AES_KEY_LOCAL);
      localStorage.setItem(STORE_KEY, enc);
      setStatus(
        "✅ 已写入伪造会员态 " + STORE_KEY + "（activeUntil=100 年后）。刷新页面后站点视为有效会员，解锁 120 秒试看限制与会员 UI。",
        "ok"
      );
      toast("伪造会员态已写入，刷新页面生效");
    } catch (e) {
      setStatus("伪造失败: " + (e && e.message ? e.message : e), "err");
    }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    // 站点守卫：仅在已知同构域名运行；其他站点给个浮钮手动尝试
    if (!isKnownSite() && !/xasian/i.test(location.hostname)) return;

    // 等待 CryptoJS（@require）
    if (typeof CryptoJS === "undefined") {
      toast("CryptoJS 未加载，请检查 @require", "err");
      return;
    }

    const root = buildPanel();
    root.style.display = "none"; // 不自动弹出：取到直链后点亮悬浮球下的小圆钮
    nsfwDockEntry(NS + "-entry", "X*sian 免会员", () => {
      root.style.display = "";
      root.classList.remove("collapsed");
      root.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    // 详情页自动获取
    if (/\/video\/[^/?#]+/i.test(location.pathname)) {
      setTimeout(() => doLoad({ play: false }), 800);
    } else {
      setStatus(
        "就绪。详情页 /video/<id> 自动取流；也可手动输入视频 ID 后点「获取直链并播放」。",
        "info"
      );
    }

    // SPA 路由变化时重置
    let lastPath = location.pathname + location.search;
    setInterval(() => {
      const now = location.pathname + location.search;
      if (now === lastPath) return;
      lastPath = now;
      const v = root.querySelector("[data-video]");
      if (v) { v.pause(); v.removeAttribute("src"); v.classList.remove("show"); }
      root.querySelector("[data-url]").value = "";
      root.querySelector("[data-meta]").innerHTML = "";
      lastData = null;
      if (/\/video\/[^/?#]+/i.test(location.pathname)) {
        setTimeout(() => doLoad({ play: false }), 500);
      }
    }, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
 * 模块 5/7：爱*社区(bb*) - VIP/订阅/金币视频 免会员在线播放 + 下载 v1.0.1
 * ===================================================================== */
(function () {
  "use strict";

  /* 站点守卫：仅 bbav110.com / avjb.com 及其子域 */
  if (!/(^|\.)(bbav110\.com|avjb\.com)$/i.test(location.hostname)) return;

  /* 仅视频详情页 /video/{id}/ 或 /videos/{id}/ */
  const vidMatch = location.pathname.match(/\/video[s]?\/(\d+)\//);
  if (!vidMatch) return;

  const NS = "bbav-x5";
  const VIDEO_ID = parseInt(vidMatch[1], 10);
  const GROUP = String(Math.floor(VIDEO_ID / 1000) * 1000); // CDN 分组不补零（80000 而非 080000）
  const HOSTS = [
    "https://list.avstatic.com",
    "https://bot.imgclh.com",
    "https://newz.jb-aiwei.cc",
  ];
  const PREF = "nsfw_bbav_";
  const DL_CONC = 8;
  const MAX_SEG = 40000;

  const $ = (sel, root) => (root || document).querySelector(sel);

  function prefGet(k, d) {
    try {
      const v = GM_getValue(PREF + k, d);
      return v === undefined ? d : v;
    } catch { return d; }
  }
  function prefSet(k, v) {
    try { GM_setValue(PREF + k, v); } catch (_) {}
  }

  function toast(msg, kind, ms) {
    let host = document.getElementById("nsfw-dp-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "nsfw-dp-toast-host";
      document.documentElement.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "nsfw-dp-toast " + (kind || "ok");
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 280); }, ms || 2400);
  }

  function gmGet(url, { binary } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 40000,
        responseType: binary ? "arraybuffer" : "text",
        onload: (res) => {
          if (res.status < 200 || res.status >= 400) return reject(new Error("HTTP " + res.status));
          resolve(res);
        },
        onerror: () => reject(new Error("网络错误")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  function segUrl(n) {
    return `${HOSTS[0]}/videos/${GROUP}/${VIDEO_ID}/${String(n).padStart(4, "0")}.jpg`;
  }

  async function segExists(n) {
    try { return (await gmGet(segUrl(n))).status === 200; } catch { return false; }
  }

  async function probeCount() {
    if (!(await segExists(0))) return null;
    let lo = 0, hi = MAX_SEG;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (await segExists(mid)) lo = mid; else hi = mid;
    }
    return lo + 1;
  }

  /* 从第一个分片解析视频 PES 的 PTS，得到分片秒数（PES 头不一定在 TS 包起点，全量扫描 00 00 01 e0） */
  async function probeSegDur() {
    try {
      const res = await gmGet(segUrl(0), { binary: true });
      const u8 = new Uint8Array(res.response);
      let first = null, last = null;
      for (let p = 0; p + 14 <= u8.length; p++) {
        if (u8[p] !== 0 || u8[p + 1] !== 0 || u8[p + 2] !== 1 || u8[p + 3] !== 0xe0) continue; // 视频 PES 起始码
        if (!(u8[p + 7] & 0x80)) continue; // 有 PTS
        const mk = u8[p + 9];
        if ((mk & 0xe0) !== 0x20) continue; // PTS 标记 0x21(PTS) / 0x31(PTS+DTS)
        const pts = ((mk & 0x0e) << 29) | ((u8[p + 10] & 0xfe) << 22) |
                    ((u8[p + 11] & 0xfe) << 14) | ((u8[p + 12] & 0xfe) << 7) | (u8[p + 13] >> 1);
        if (first === null) first = pts;
        last = pts;
      }
      if (first !== null && last !== null && last > first) {
        const d = (last - first) / 90000;
        if (d > 0.2 && d < 10) return d;
      }
      return 2;
    } catch { return 2; }
  }

  function buildM3u8(count, segDur) {
    const lines = ["#EXTM3U", "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(segDur))}`,
      "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
    for (let i = 0; i < count; i++) {
      lines.push(`#EXTINF:${segDur.toFixed(3)},`, segUrl(i));
    }
    lines.push("#EXT-X-ENDLIST");
    return lines.join("\n") + "\n";
  }

  /* ---------------- UI ---------------- */

  GM_addStyle(`
#${NS}-root{position:fixed;right:64px;bottom:16px;z-index:2147483645;width:264px;
 background:linear-gradient(165deg,#241a2e,#141018);border:1px solid #ff3b6f66;border-radius:14px;
 padding:12px 14px;color:#eee;font:13px/1.5 system-ui,sans-serif;
 box-shadow:0 12px 34px rgba(0,0,0,.6)}
#${NS}-root h3{margin:0 0 6px;font-size:14px;color:#ffd76a;display:flex;justify-content:space-between;align-items:center}
#${NS}-root h3 button{background:none;border:0;color:#888;cursor:pointer;font-size:13px}
#${NS}-root .bb-tip{color:#a99;font-size:11px;margin-bottom:8px;word-break:break-all}
#${NS}-root .bb-btn{display:block;width:100%;margin:5px 0;padding:8px 10px;border:0;border-radius:8px;cursor:pointer;
 font-size:13px;font-weight:650;background:#2c2438;color:#eee;text-align:center}
#${NS}-root .bb-btn:hover{background:#3a3050}
#${NS}-root .bb-btn.primary{background:linear-gradient(90deg,#ff3b6f,#c91c4f);color:#fff}
#${NS}-root .bb-btn:disabled{opacity:.5;cursor:not-allowed}
#${NS}-root .bb-bar{height:6px;background:#221c2c;border-radius:3px;margin-top:8px;overflow:hidden}
#${NS}-root .bb-bar>div{height:100%;width:0;background:linear-gradient(90deg,#ffd76a,#ff3b6f);transition:width .2s}
#${NS}-root .bb-log{color:#8f8;font-size:11px;margin-top:6px;word-break:break-all;max-height:64px;overflow:auto}
#${NS}-player{position:fixed;inset:0;z-index:2147483646;background:#000;display:none;align-items:center;justify-content:center}
#${NS}-player.show{display:flex}
#${NS}-player video{max-width:98vw;max-height:98vh;background:#000}
#${NS}-player .bb-close{position:absolute;top:12px;right:16px;z-index:2;background:#ea1853;border:0;color:#fff;
 font-size:15px;padding:8px 16px;border-radius:8px;cursor:pointer}
`);

  function ensurePanel() {
    let root = document.getElementById(`${NS}-root`);
    if (root) return root;
    root = document.createElement("div");
    root.id = `${NS}-root`;
    root.innerHTML = `
<h3>🔓 爱*社区 免会员<button type="button" data-act="hide">✕</button></h3>
<div class="bb-tip" data-tip>视频ID ${VIDEO_ID} · 检测中...</div>
<button type="button" class="bb-btn primary" data-act="play">▶ 在线播放（免会员）</button>
<button type="button" class="bb-btn" data-act="trial" style="display:none">▶ 播放试看（仅 30 秒）</button>
<button type="button" class="bb-btn" data-act="m3u8">⬇ 下载 m3u8 列表</button>
<button type="button" class="bb-btn" data-act="dl">⬇ 下载完整视频 .ts</button>
<div class="bb-bar"><div data-bar></div></div>
<div class="bb-log" data-log>初始化…</div>`;
    document.body.appendChild(root);
    root.querySelector('[data-act="hide"]').onclick = () => { root.style.display = "none"; };
    return root;
  }

  function ensurePlayer() {
    let wrap = document.getElementById(`${NS}-player`);
    if (wrap) return wrap;
    wrap = document.createElement("div");
    wrap.id = `${NS}-player`;
    wrap.innerHTML = `<button type="button" class="bb-close">✕ 关闭</button>
      <video controls autoplay playsinline></video>`;
    wrap.querySelector(".bb-close").onclick = () => wrap.classList.remove("show");
    document.body.appendChild(wrap);
    return wrap;
  }

  /* ---------------- 动作 ---------------- */

  function setLog(msg, kind) {
    const el = $(`[data-log]`, document.getElementById(`${NS}-root`));
    if (!el) return;
    el.textContent = msg;
    if (kind) el.style.color = kind === "err" ? "#f88" : "#8f8";
  }
  function setBar(pct) {
    const el = $(`[data-bar]`, document.getElementById(`${NS}-root`));
    if (el) el.style.width = Math.min(100, pct) + "%";
  }
  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
  }

  let STATE = null; // { count, segDur, m3u8, totalSec }

  /* 从页面提取旧式播放器（Playerjs）内联的试看源 file 参数 */
  function findTrialUrl() {
    try {
      const m = document.documentElement.innerHTML.match(
        /file\s*:\s*"([^"]+video_limt\.mp4)"/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  async function ensureState() {
    if (STATE) return STATE;
    setLog("探测分片…");
    const count = await probeCount();
    if (!count) {
      const trial = findTrialUrl();
      const trialBtn = $(`[data-act="trial"]`, document.getElementById(`${NS}-root`));
      if (trial) {
        if (trialBtn) {
          trialBtn.style.display = "";
          trialBtn.dataset.url = trial;
        }
        setLog("该视频无完整分片（2024-09 前旧视频未分片化）· 站点仅提供试看源", "err");
        nsfwDockBadge(() => { document.getElementById(`${NS}-root`).style.display = ""; });
      } else {
        setLog("该视频无可用视频源（站点自身播放器亦为空）", "err");
      }
      return null;
    }
    const segDur = await probeSegDur();
    const m3u8 = buildM3u8(count, segDur);
    const totalSec = Math.round(count * segDur);
    STATE = { count, segDur, m3u8, totalSec };
    const tip = $(`[data-tip]`, document.getElementById(`${NS}-root`));
    if (tip) tip.textContent = `视频ID ${VIDEO_ID} · ${count} 片 ≈ ${Math.floor(totalSec / 60)}m${totalSec % 60}s · ${segDur.toFixed(1)}s/片`;
    setLog(`就绪：${count} 片 ≈ ${Math.floor(totalSec / 60)}m${totalSec % 60}s`);
    nsfwDockBadge(() => { document.getElementById(`${NS}-root`).style.display = ""; });
    return STATE;
  }

  function doPlayTrial() {
    const btn = $(`[data-act="trial"]`, document.getElementById(`${NS}-root`));
    if (!btn || !btn.dataset.url) return;
    const wrap = ensurePlayer();
    const video = wrap.querySelector("video");
    if (video._hls) { try { video._hls.destroy(); } catch (_) {} }
    video.src = btn.dataset.url;
    video.load();
    wrap.classList.add("show");
    const p = video.play(); if (p && p.catch) p.catch(() => {});
    setLog("试看源播放中（该视频完整版未公开）");
  }

  async function doPlay() {
    const btn = $(`[data-act="play"]`, document.getElementById(`${NS}-root`));
    setBusy(btn, true);
    try {
      const st = await ensureState();
      if (!st) return;
      setLog("加载播放器…");
      const wrap = ensurePlayer();
      const video = wrap.querySelector("video");
      const blobUrl = URL.createObjectURL(new Blob([st.m3u8], { type: "application/vnd.apple.mpegurl" }));
      const H = video.canPlayType("application/vnd.apple.mpegurl") ? null : await nsfwHls(); // Safari 走原生 HLS
      if (H && H.isSupported()) {
        if (video._hls) video._hls.destroy();
        const hls = new H({ maxBufferLength: 30 });
        video._hls = hls;
        hls.on(H.Events.MANIFEST_PARSED, () => video.play());
        hls.on(H.Events.ERROR, (e, d) => {
          if (d.fatal) setLog("播放错误: " + d.type + " / " + d.details, "err");
        });
        hls.loadSource(blobUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = blobUrl;
      } else {
        throw new Error("浏览器不支持 HLS，且 hls.js 加载失败");
      }
      wrap.classList.add("show");
      setLog(`播放中：${st.count} 片 · 直连 CDN（免会员）`);
    } catch (e) {
      setLog("播放失败: " + (e && e.message ? e.message : e), "err");
      toast(String(e.message || e), "err");
    } finally {
      setBusy(btn, false);
    }
  }

  function doDlM3u8() {
    if (!STATE) {
      ensureState().then(() => doDlM3u8());
      return;
    }
    const blob = new Blob([STATE.m3u8], { type: "application/vnd.apple.mpegurl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bbav_${VIDEO_ID}.m3u8`;
    a.click();
    setLog("m3u8 已下载（可用 VLC / ffmpeg 播放或下载）");
    toast("m3u8 已下载");
  }

  async function doDlAll() {
    const btn = $(`[data-act="dl"]`, document.getElementById(`${NS}-root`));
    setBusy(btn, true);
    try {
      const st = await ensureState();
      if (!st) return;
      setLog(`下载中 0% …`);
      const parts = new Array(st.count);
      let done = 0;
      const worker = async (i) => {
        try {
          const res = await gmGet(segUrl(i), { binary: true });
          parts[i] = res.response;
        } catch { parts[i] = null; }
        done++;
        setBar((done / st.count) * 100);
        if (done % 40 === 0 || done === st.count) setLog(`下载中 ${((done / st.count) * 100).toFixed(0)}% (${done}/${st.count})`);
      };
      for (let i = 0; i < st.count; i += DL_CONC) {
        await Promise.all(Array.from({ length: Math.min(DL_CONC, st.count - i) }, (_, k) => worker(i + k)));
      }
      const ok = parts.filter(Boolean).length;
      if (!ok) throw new Error("分片全部下载失败");
      const blob = new Blob(parts.filter(Boolean), { type: "video/mp2t" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `bbav_${VIDEO_ID}_full.ts`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setLog(`完成：${ok}/${st.count} 片 → bbav_${VIDEO_ID}_full.ts (${(blob.size / 1048576).toFixed(1)} MB)`);
      toast("完整视频已开始下载");
    } catch (e) {
      setLog("下载失败: " + (e && e.message ? e.message : e), "err");
      toast(String(e.message || e), "err");
    } finally {
      setBusy(btn, false);
    }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    const root = ensurePanel();
    root.style.display = "none"; // 不自动弹出：探测到分片后点亮悬浮球下的小圆钮
    nsfwDockEntry(NS + "-entry", "爱社区免会员", () => {
      root.style.display = root.style.display === "none" ? "" : "none";
    });
    root.querySelector('[data-act="play"]').onclick = doPlay;
    root.querySelector('[data-act="trial"]').onclick = doPlayTrial;
    root.querySelector('[data-act="m3u8"]').onclick = doDlM3u8;
    root.querySelector('[data-act="dl"]').onclick = doDlAll;
    // 页面自带播放器时（免费视频），面板浮在右下角不干扰
    ensureState().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
/* =====================================================================
 * 模块 6/7：春*院(chunman) - 附件直链 + 付费视频绕过 v1.2.1
 * =====================================================================
 * 逆向成果：
 *   [A] 附件付费墙绕过：移动 API /api/mobile/index.php?version=4&module=viewthread
 *       返回全部附件（含付费隐藏），/remote/data/attachment/forum/{path} 无鉴权直下
 *   [B] 付费视频帖绕过：付费后 iframe 才渲染，但"视频截图" poster 路径
 *       泄露存储目录：
 *         poster  /remote_m3u8/data_2/video/m3u8/{site}/{Y}/{M}/{D}/{hash}/jpg/vod.jpg
 *         m3u8    .../{hash}/ts/index.m3u8   （无鉴权，AES-128，IV 在 m3u8 内）
 *         种子    /remote_m3u8/torrents/{site}/{Y}/{M}/{D}/{hash}.torrent（无鉴权）
 *       → 由 poster 推导 m3u8 + 种子，hls.js 直播 / AES-128 解密拼接完整下载
 *   [C] 免费视频帖：iframe /remote_play/video/play/{vid}.html 直接可播；
 *       ajax /remote_play/index.php/play/ajax/{vid}.html 兜底解析
 * 镜像域名：chunman4.com / chunmanp0gauky.com / chunmani6q1l.com /
 *           chunmancduz.com / chunmanelapo.com（cookies 通用）
 * ===================================================================== */

(function () {
  "use strict";

  /* ---------------- 站点守卫 ---------------- */
  const HOST = location.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^chunman[a-z0-9]*\.com$/.test(HOST)) return;

  const NS = "cm7";

  /* ---------------- 常量（逆向所得） ---------------- */
  const MOBILE_API = "/api/mobile/index.php?version=4&module=viewthread&tid=";

  /* ---------------- 工具 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);

  function toast(msg, kind, ms) {
    let host = document.getElementById("cm7-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "cm7-toast-host";
      document.documentElement.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = "cm7-toast " + (kind || "ok");
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 280); }, ms || 2600);
  }

  // 同源 fetch（带 cookie）；失败退 GM_xmlhttpRequest（跨域分片用）
  function sfetch(url, opt) {
    opt = opt || {};
    opt.credentials = "include";
    return fetch(url, opt).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    });
  }
  function gmFetch(url, { binary } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET", url, timeout: 60000,
        responseType: binary ? "arraybuffer" : "text",
        onload: (res) => {
          if (res.status < 200 || res.status >= 400) return reject(new Error("HTTP " + res.status));
          resolve(res);
        },
        onerror: () => reject(new Error("网络错误")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  function getTid() {
    const m1 = location.search.match(/[?&]tid=(\d+)/);
    if (m1) return m1[1];
    const m2 = location.pathname.match(/thread-(\d+)-\d+-\d+\.html/);
    if (m2) return m2[1];
    return null;
  }

  /* ================================================================
   * [A] 移动 API 附件枚举 + /remote/ 直链
   * ================================================================ */
  async function fetchThreadApi(tid) {
    const r = await sfetch(MOBILE_API + tid);
    return r.json();
  }

  function extractAttachments(api) {
    const out = [];
    const posts = (api && api.Variables && api.Variables.postlist) || [];
    for (const p of posts) {
      const atts = p.attachments || {};
      for (const aid of Object.keys(atts)) {
        const a = atts[aid];
        out.push({
          aid, tid: a.tid, pid: a.pid,
          filename: a.filename,
          size: a.attachsize || ((a.filesize / 1024).toFixed(1) + " KB"),
          isimage: a.isimage === "1",
          // 核心绕过：/remote/ 静态路径无鉴权（remote=1 时 url 已是远程前缀）
          direct: (a.url || "/remote/data/attachment/forum/") + a.attachment,
          paid: a.payed === "0" && a.price > 0, // 付费附件标记
          price: a.price,
          downloads: a.downloads,
        });
      }
    }
    return out;
  }

  // 扫描正文里的视频/磁力/ed2k 链接（含移动 API 的 message 字段）
  function scanLinks(sources) {
    const found = { m3u8: [], mp4: [], magnet: [], ed2k: [] };
    const text = sources.join("\n");
    let m;
    const reM3u8 = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g;
    while ((m = reM3u8.exec(text))) if (!found.m3u8.includes(m[0])) found.m3u8.push(m[0]);
    const reMp4 = /https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g;
    while ((m = reMp4.exec(text))) if (!found.mp4.includes(m[0])) found.mp4.push(m[0]);
    const reMag = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*/g;
    while ((m = reMag.exec(text))) if (!found.magnet.includes(m[0])) found.magnet.push(m[0]);
    const reEd = /ed2k:\/\/\|file\|[^\s"'<>]+/g;
    while ((m = reEd.exec(text))) if (!found.ed2k.includes(m[0])) found.ed2k.push(m[0]);
    return found;
  }

  /* ================================================================
   * [B2] 付费视频帖绕过：poster 路径 → 推导 m3u8 + 种子
   *   poster  /remote_m3u8/data_2/video/m3u8/{site}/{Y}/{M}/{D}/{hash}/jpg/vod.jpg
   *   m3u8    .../{hash}/ts/index.m3u8（无鉴权 AES-128）
   *   torrent /remote_m3u8/torrents/{site}/{Y}/{M}/{D}/{hash}.torrent
   * ================================================================ */
  function scanVideoPaths(sources) {
    const text = sources.join("\n");
    const vids = [];
    const seen = new Set();
    let m;
    // poster 截图路径（付费帖也可见，泄露存储目录）
    // 两种编码风格都存在：日期分隔符可能是真实 / 或 %2F，统一解码后解析
    const rePoster = /\/remote_m3u8\/(data_2\/video\/m3u8\/[^"'\s<>\\]+?)\/jpg\/vod\.(?:jpg|png)/g;
    while ((m = rePoster.exec(text))) {
      const base = m[1]; // data_2/video/m3u8/{site}/{Y}/{M}/{D}/{hash}（可能 URL 编码）
      let decoded;
      try { decoded = decodeURIComponent(base); }
      catch { decoded = base; }
      const segs = decoded.split("/");
      if (segs.length < 8) continue;
      const hash = segs[segs.length - 1];
      if (seen.has(hash)) continue;
      seen.add(hash);
      const tail = segs.slice(3).join("/"); // {site}/{Y}/{M}/{D}/{hash}
      vids.push({
        hash,
        poster: "/remote_m3u8/" + base + "/jpg/vod.jpg",        // 原样（编码形式，已验证 200）
        m3u8: "/remote_m3u8/" + base + "/ts/index.m3u8",        // 原样（编码形式，已验证 200）
        torrent: "/remote_m3u8/torrents/" + tail + ".torrent",  // 解码形式（已验证 200）
        origin: location.origin,
      });
    }
    return vids;
  }

  // 探测 m3u8 是否有效（返回完整 URL 或 null）
  async function probeVideoM3u8(v) {
    const candidates = [
      v.m3u8,                              // 已验证主路径 ts/index.m3u8
      v.m3u8.replace("/ts/index.m3u8", "/index.m3u8"),
      v.m3u8.replace("/ts/index.m3u8", "/vod.m3u8"),
    ];
    for (const u of candidates) {
      try {
        const t = await fetchText(u);
        if (t && t.trimStart().startsWith("#EXTM3U")) return u;
      } catch { /* next */ }
    }
    return null;
  }

  // 免费帖 iframe：/remote_play/video/play/{vid}.html → ajax 解析真实 m3u8
  function scanPlayerIframes(sources) {
    const text = sources.join("\n");
    const vids = [];
    const seen = new Set();
    let m;
    const re = /\/remote_play\/video\/play\/(\d+)\.html/g;
    while ((m = re.exec(text))) {
      if (!seen.has(m[1])) { seen.add(m[1]); vids.push(m[1]); }
    }
    return vids;
  }

  async function resolvePlayerAjax(vid) {
    try {
      const t = await fetchText(`/remote_play/index.php/play/ajax/${vid}.html`);
      // 响应可能是 JSON 或 HTML，找 m3u8 / remote_m3u8 路径
      const mm = t.match(/(?:https?:\/\/[^"'\s<>]+)?\/remote_m3u8\/[^"'\s<>\\]+\.m3u8/);
      if (mm) return mm[0].startsWith("http") ? mm[0] : location.origin + mm[0];
      const mj = t.match(/https?:\/\/[^"'\s<>\\]+\.m3u8/);
      if (mj) return mj[0];
    } catch { /* ignore */ }
    return null;
  }

  async function gatherThreadIntel(tid) {
    // DOM 是主源：poster 路径（付费帖）和 iframe（免费帖）都在页面里。
    // 移动 API 只是附件枚举的补充源——失败绝不阻断 DOM 扫描。
    const sources = [document.documentElement.outerHTML];
    let atts = [];
    try {
      const api = await fetchThreadApi(tid);
      atts = extractAttachments(api);
      sources.push(...((api.Variables || {}).postlist || []).map((p) => p.message || ""));
    } catch (e) { /* API 挂了/未登录/限流：附件枚举跳过，视频扫描继续 */ }
    const links = scanLinks(sources);
    const videos = scanVideoPaths(sources);       // 付费帖 poster 泄露
    const players = scanPlayerIframes(sources);   // 免费帖 iframe
    return { atts, links, videos, players };
  }

  /* ================================================================
   * [B] HLS 视频绕过：播放 + AES-128 解密完整下载
   * ================================================================ */
  function waToU8(wa) {
    const len = wa.sigBytes;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    return u8;
  }

  async function fetchBin(url) {
    try {
      const r = await sfetch(url);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      const res = await gmFetch(url, { binary: true });
      return new Uint8Array(res.response);
    }
  }
  async function fetchText(url) {
    try {
      const r = await sfetch(url);
      return await r.text();
    } catch (e) {
      const res = await gmFetch(url);
      return res.responseText;
    }
  }

  async function parseM3u8(m3u8Url) {
    const txt = await fetchText(m3u8Url);
    const lines = txt.split(/\r?\n/).map((l) => l.trim());
    let keyUrl = null, keyIvHex = null;
    const segs = [];
    let seq = 0;
    for (const line of lines) {
      if (line.startsWith("#EXT-X-KEY:")) {
        const mu = line.match(/URI="([^"]+)"/);
        if (mu) keyUrl = new URL(mu[1], m3u8Url).href;
        const mi = line.match(/IV=0x([0-9a-fA-F]+)/);
        if (mi) keyIvHex = mi[1];
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        seq = parseInt(line.split(":")[1], 10) || 0;
      } else if (line && !line.startsWith("#")) {
        segs.push({ url: new URL(line, m3u8Url).href, seq: seq + segs.length });
      }
    }
    return { keyUrl, keyIvHex, segs, raw: txt };
  }

  // AES-128-CBC 解密单个分片（IV 缺省 = 分片序号大端 16 字节）
  function decryptSeg(u8, keyWa, ivHex) {
    const ivWa = CryptoJS.enc.Hex.parse(ivHex);
    const ct = CryptoJS.lib.WordArray.create(u8);
    const dec = CryptoJS.AES.decrypt(
      { ciphertext: ct }, keyWa,
      { iv: ivWa, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding }
    );
    return waToU8(dec);
  }

  function playHls(m3u8Url) {
    let ov = document.getElementById(NS + "-player");
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = NS + "-player";
    ov.className = "show";
    ov.innerHTML = '<button class="cm7-close">✕ 关闭</button><video controls autoplay playsinline></video>';
    document.documentElement.appendChild(ov);
    ov.querySelector(".cm7-close").onclick = () => { ov.remove(); };
    const video = ov.querySelector("video");
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = m3u8Url; // Safari 原生 HLS，不需要 hls.js
      return;
    }
    nsfwHls().then((H) => {
      if (!H || !H.isSupported()) { toast("浏览器不支持 HLS，且 hls.js 加载失败", "err"); return; }
      const hls = new H({ maxBufferLength: 60 });
      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
      hls.on(H.Events.ERROR, (_, d) => {
        if (d.fatal) toast("播放失败: " + d.type, "err");
      });
      ov.addEventListener("click", (e) => { if (e.target === ov) { hls.destroy(); ov.remove(); } });
    });
  }

  async function downloadHls(m3u8Url, onProgress) {
    const pl = await parseM3u8(m3u8Url);
    if (!pl.segs.length) throw new Error("m3u8 无分片");
    onProgress("解析: " + pl.segs.length + " 片" + (pl.keyUrl ? " (AES-128 加密)" : ""));
    let keyWa = null;
    if (pl.keyUrl) {
      const kb = await fetchBin(pl.keyUrl);
      keyWa = CryptoJS.lib.WordArray.create(kb);
    }
    const CONC = 6;
    const parts = new Array(pl.segs.length);
    let done = 0;
    const worker = async (i) => {
      try { parts[i] = await fetchBin(pl.segs[i].url); }
      catch { parts[i] = null; }
      done++;
      onProgress(`下载 ${Math.round((done / pl.segs.length) * 100)}% (${done}/${pl.segs.length})`);
    };
    for (let i = 0; i < pl.segs.length; i += CONC) {
      await Promise.all(Array.from({ length: Math.min(CONC, pl.segs.length - i) }, (_, k) => worker(i + k)));
    }
    const ok = parts.filter(Boolean).length;
    if (!ok) throw new Error("分片全部下载失败");
    if (keyWa) {
      onProgress("解密中…");
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        const ivHex = pl.keyIvHex || (pl.segs[i].seq >>> 0).toString(16).padStart(32, "0");
        parts[i] = decryptSeg(parts[i], keyWa, ivHex);
      }
    }
    const blob = new Blob(parts.filter(Boolean), { type: "video/mp2t" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chunman_${getTid() || "video"}_full.ts`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    onProgress(`完成: ${ok}/${pl.segs.length} 片 → ${a.download} (${(blob.size / 1048576).toFixed(1)} MB)`);
    return blob.size;
  }

  /* ================================================================
   * UI：浮动面板 + 帖内直链注入
   * ================================================================ */
  GM_addStyle(`
#${NS}-root{position:fixed;right:64px;bottom:16px;z-index:2147483645;width:280px;
 background:linear-gradient(165deg,#1e2a24,#101512);border:1px solid #2ecc7166;border-radius:14px;
 padding:12px 14px;color:#e8f0ea;font:13px/1.5 system-ui,sans-serif;
 box-shadow:0 12px 34px rgba(0,0,0,.6)}
#${NS}-root h3{margin:0 0 6px;font-size:14px;color:#7ee8a0;display:flex;justify-content:space-between;align-items:center}
#${NS}-root h3 button{background:none;border:0;color:#888;cursor:pointer;font-size:13px}
#${NS}-root .cm-tip{color:#9a9;font-size:11px;margin-bottom:8px;word-break:break-all}
#${NS}-root .cm-btn{display:block;width:100%;margin:5px 0;padding:8px 10px;border:0;border-radius:8px;cursor:pointer;
 font-size:13px;font-weight:650;background:#22302a;color:#e8f0ea;text-align:center}
#${NS}-root .cm-btn:hover{background:#2e4238}
#${NS}-root .cm-btn.primary{background:linear-gradient(90deg,#27ae60,#1a8a4a);color:#fff}
#${NS}-root .cm-btn:disabled{opacity:.5;cursor:not-allowed}
#${NS}-root .cm-bar{height:6px;background:#1a241e;border-radius:3px;margin-top:8px;overflow:hidden}
#${NS}-root .cm-bar>div{height:100%;width:0;background:linear-gradient(90deg,#7ee8a0,#27ae60);transition:width .2s}
#${NS}-root .cm-log{color:#8f8;font-size:11px;margin-top:6px;word-break:break-all;max-height:100px;overflow:auto}
#cm7-toast-host{position:fixed;top:70px;right:20px;z-index:2147483647;display:flex;flex-direction:column;gap:8px}
.cm7-toast{background:#1a2a20;color:#cfe;border:1px solid #27ae6088;border-radius:8px;padding:10px 16px;
 font:13px system-ui;opacity:0;transform:translateX(20px);transition:all .25s;max-width:340px;word-break:break-all}
.cm7-toast.show{opacity:1;transform:none}
.cm7-toast.err{background:#2a1a1a;border-color:#c0392b88;color:#fcc}
#${NS}-player{position:fixed;inset:0;z-index:2147483646;background:#000;display:none;align-items:center;justify-content:center}
#${NS}-player.show{display:flex}
#${NS}-player video{max-width:98vw;max-height:98vh;background:#000}
#${NS}-player .cm7-close{position:absolute;top:12px;right:16px;z-index:2;background:#1a8a4a;border:0;color:#fff;
 font-size:15px;padding:8px 16px;border-radius:8px;cursor:pointer}
#${NS}-attbox{margin:14px 0;border:1px dashed #2ecc7188;border-radius:10px;padding:10px 14px;background:#0f1712}
#${NS}-attbox h4{margin:0 0 8px;color:#7ee8a0;font-size:13px}
#${NS}-attbox .cm-att{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1c2a22;font-size:12px}
#${NS}-attbox .cm-att:last-child{border-bottom:0}
#${NS}-attbox .cm-att a{color:#6ec6ff;text-decoration:none;word-break:break-all}
#${NS}-attbox .cm-att .cm-paid{color:#e74c3c;font-weight:700;font-size:11px}
#${NS}-attbox .cm-att .cm-free{color:#27ae60;font-size:11px}
#${NS}-attbox .cm-att button{background:#22302a;border:1px solid #2ecc7155;color:#7ee8a0;border-radius:6px;
 padding:3px 10px;cursor:pointer;font-size:11px}
`);

  function ensurePanel() {
    let root = document.getElementById(NS + "-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = NS + "-root";
    root.innerHTML = `
<h3>🏮 春满助手 <button data-act="hide" title="收起">—</button></h3>
<div class="cm-tip" id="${NS}-tip">chunman4.com 及镜像通用</div>
<button class="cm-btn primary" data-act="atts">① 枚举全部附件直链（绕付费墙）</button>
<button class="cm-btn" data-act="scan">② 扫描并播放视频链接</button>
<div class="cm-bar" style="display:none"><div></div></div>
<div class="cm-log" id="${NS}-log"></div>`;
    document.documentElement.appendChild(root);
    root.querySelector('[data-act="hide"]').onclick = () => { root.style.display = "none"; };
    return root;
  }

  function setLog(msg) {
    const el = document.getElementById(NS + "-log");
    if (el) el.textContent = msg;
  }
  function setBar(pct) {
    const root = document.getElementById(NS + "-root");
    const bar = root && root.querySelector(".cm-bar");
    if (!bar) return;
    bar.style.display = pct == null ? "none" : "block";
    if (pct != null) bar.firstElementChild.style.width = pct + "%";
  }
  function setBusy(btn, busy, text) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) { btn.dataset.t = btn.textContent; btn.textContent = text || "处理中…"; }
    else if (btn.dataset.t) btn.textContent = btn.dataset.t;
  }

  // 帖内注入附件直链框
  function injectAttBox(atts, links, videos, players) {
    const old = document.getElementById(NS + "-attbox");
    if (old) old.remove();
    const host = $("#postlist") || $(".plc.cl") || document.body;
    const box = document.createElement("div");
    box.id = NS + "-attbox";
    let html = "";
    if (atts.length) {
      html += `<h4>📦 附件直链（${atts.length} 个，移动 API 枚举 + /remote/ 无鉴权）</h4>`;
      for (const a of atts) {
        const tag = a.paid ? '<span class="cm-paid">付费</span>' : '<span class="cm-free">免费</span>';
        html += `<div class="cm-att">${tag}
<a href="${a.direct}" target="_blank" rel="noopener" download>${a.filename}</a>
<span style="color:#8a9">${a.size}</span>
<button data-dl="${a.direct}" data-fn="${a.filename}">下载</button></div>`;
      }
    }
    // 站内视频（付费帖 poster 泄露推导 + 免费帖 iframe）
    videos = videos || [];
    players = players || [];
    if (videos.length || players.length) {
      html += `<h4 style="margin-top:10px">🎬 站内视频（${videos.length + players.length} 个，绕过购买）</h4>`;
      for (const v of videos) {
        html += `<div class="cm-att">
<button data-vm3u8="${v.m3u8}">▶ 播放</button>
<button data-vdl="${v.m3u8}">⬇ 完整下载</button>
<a href="${v.torrent}" target="_blank" download>🧲 种子</a>
<a href="${v.poster}" target="_blank">截图 ${v.hash.slice(-6)}</a></div>`;
      }
      for (const vid of players) {
        html += `<div class="cm-att">
<button data-pvid="${vid}">▶ 播放器解析</button>
<span style="color:#8a9">player #${vid}</span></div>`;
      }
    }
    const lc = links.m3u8.length + links.mp4.length + links.magnet.length + links.ed2k.length;
    if (lc) {
      html += `<h4 style="margin-top:10px">🔗 媒体链接（${lc}）</h4>`;
      for (const u of links.m3u8) html += `<div class="cm-att"><button data-play="${u}">▶ 播放</button><button data-dlv="${u}">⬇ 完整下载</button><a href="${u}" target="_blank">${u.slice(0, 80)}</a></div>`;
      for (const u of links.mp4) html += `<div class="cm-att"><a href="${u}" target="_blank" download>${u.slice(0, 90)}</a></div>`;
      for (const u of links.magnet) html += `<div class="cm-att"><a href="${u}" target="_blank">🧲 ${u.slice(0, 90)}</a></div>`;
      for (const u of links.ed2k) html += `<div class="cm-att"><a href="${u}" target="_blank">🫏 ${u.slice(0, 90)}</a></div>`;
    }
    if (!html) return null;
    box.innerHTML = html;
    // 事件
    box.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.dl) {
        const a = document.createElement("a");
        a.href = t.dataset.dl; a.download = t.dataset.fn || ""; a.click();
      } else if (t.dataset.play) {
        playHls(t.dataset.play);
      } else if (t.dataset.dlv) {
        setBar(0);
        downloadHls(t.dataset.dlv, (m) => { setLog(m); if (/(\d+)%/.test(m)) setBar(parseInt(RegExp.$1, 10)); })
          .then(() => toast("完整视频已开始下载"))
          .catch((err) => toast("下载失败: " + err.message, "err"));
      } else if (t.dataset.vm3u8) {
        // 站内视频：先探测候选路径，成功即播
        t.disabled = true; t.textContent = "探测中…";
        probeVideoM3u8({ m3u8: t.dataset.vm3u8 })
          .then((u) => {
            t.disabled = false; t.textContent = "▶ 播放";
            if (u) { setLog("m3u8 已定位: " + u.slice(-60)); playHls(u); }
            else toast("m3u8 探测失败（可能已删除）", "err");
          })
          .catch(() => { t.disabled = false; t.textContent = "▶ 播放"; });
      } else if (t.dataset.vdl) {
        t.disabled = true; t.textContent = "探测中…";
        probeVideoM3u8({ m3u8: t.dataset.vdl })
          .then((u) => {
            t.disabled = false; t.textContent = "⬇ 完整下载";
            if (!u) return toast("m3u8 探测失败", "err");
            setBar(0);
            downloadHls(u, (m) => { setLog(m); if (/(\d+)%/.test(m)) setBar(parseInt(RegExp.$1, 10)); })
              .then(() => toast("完整视频已开始下载"))
              .catch((err) => toast("下载失败: " + err.message, "err"));
          })
          .catch(() => { t.disabled = false; t.textContent = "⬇ 完整下载"; });
      } else if (t.dataset.pvid) {
        // 免费帖播放器：ajax 解析真实 m3u8
        t.disabled = true; t.textContent = "解析中…";
        resolvePlayerAjax(t.dataset.pvid)
          .then((u) => {
            t.disabled = false; t.textContent = "▶ 播放器解析";
            if (u) { setLog("播放器 m3u8: " + u.slice(-60)); playHls(u); }
            else toast("ajax 未返回 m3u8", "err");
          })
          .catch(() => { t.disabled = false; t.textContent = "▶ 播放器解析"; });
      }
    });
    host.parentElement.insertBefore(box, host.nextSibling);
    return box;
  }

  /* ---------------- 动作 ---------------- */

  async function doAtts(btn) {
    setBusy(btn, true);
    try {
      const tid = getTid();
      if (!tid) return toast("不在帖子页", "err");
      setLog("移动 API 枚举中…");
      const intel = await gatherThreadIntel(tid);
      const paid = intel.atts.filter((a) => a.paid).length;
      setLog(`附件 ${intel.atts.length}（付费 ${paid}）· 站内视频 ${intel.videos.length} · 播放器 ${intel.players.length}`);
      injectAttBox(intel.atts, intel.links, intel.videos, intel.players);
      toast(`已注入：${intel.atts.length} 附件 + ${intel.videos.length + intel.players.length} 视频`);
    } catch (e) {
      setLog("失败: " + (e.message || e));
      toast("枚举失败: " + (e.message || e), "err");
    } finally { setBusy(btn, false); setBar(null); }
  }

  async function doScan(btn) {
    setBusy(btn, true);
    try {
      const tid = getTid();
      const sources = [document.documentElement.outerHTML];
      if (tid) {
        try {
          const api = await fetchThreadApi(tid);
          sources.push(...((api.Variables || {}).postlist || []).map((p) => p.message || ""));
        } catch { /* API 失败不影响 DOM 扫描 */ }
      }
      const links = scanLinks(sources);
      const videos = scanVideoPaths(sources);
      const players = scanPlayerIframes(sources);
      const n = links.m3u8.length + links.mp4.length + links.magnet.length + links.ed2k.length;
      setLog(`m3u8:${links.m3u8.length} mp4:${links.mp4.length} 磁力:${links.magnet.length} ed2k:${links.ed2k.length} 站内视频:${videos.length} 播放器:${players.length}`);
      if (!n && !videos.length && !players.length) return toast("未发现任何视频链接", "err");
      if (tid || videos.length || players.length) injectAttBox([], links, videos, players);
      // 自动播放优先级：站内视频 > 完整 m3u8 > 播放器
      if (videos.length) {
        const u = await probeVideoM3u8(videos[0]);
        if (u) return playHls(u);
      }
      if (links.m3u8.length) return playHls(links.m3u8[0]);
      if (players.length) {
        const u = await resolvePlayerAjax(players[0]);
        if (u) return playHls(u);
      }
      toast(`发现 ${n + videos.length + players.length} 个条目，已注入页面`);
    } catch (e) {
      setLog("失败: " + (e.message || e));
    } finally { setBusy(btn, false); }
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    const tid = getTid();
    const root = ensurePanel();
    root.style.display = "none"; // 不自动弹出：帖内找到媒体后点亮悬浮球下的小圆钮
    nsfwDockEntry(NS + "-entry", "春满助手", () => {
      root.style.display = root.style.display === "none" ? "" : "none";
    });
    root.querySelector('[data-act="atts"]').onclick = (e) => doAtts(e.currentTarget);
    root.querySelector('[data-act="scan"]').onclick = (e) => doScan(e.currentTarget);
    const tip = root.querySelector("#" + NS + "-tip");
    if (tid) tip.textContent = `tid=${tid}`;

    // 帖子页自动枚举（静默，失败不打扰）
    if (tid) {
      gatherThreadIntel(tid)
        .then((intel) => {
          const hasMedia = intel.atts.length || intel.links.m3u8.length ||
            intel.links.magnet.length || intel.videos.length || intel.players.length;
          if (hasMedia) {
            injectAttBox(intel.atts, intel.links, intel.videos, intel.players);
            nsfwDockBadge(() => { root.style.display = ""; });
            setLog(`自动注入: 附件${intel.atts.length} 视频${intel.videos.length} 播放器${intel.players.length}`);
            // 付费视频帖自动探测 m3u8（不自动播放，仅确认可播）
            if (intel.videos.length) {
              probeVideoM3u8(intel.videos[0]).then((u) => {
                if (u) setLog("✓ 视频已解锁: " + u.slice(-50));
              }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
 * 模块 7/7：含羞草 - iOS Safari 试看解锁 v1.1.7（并入自 hanxiucao-1.1.0-ios-safari v1.1.6）
 *   同域 getPreUrl + start/end 扩窗；游客身份优先取址；自建 video + HLS；静音自动播兜底。
 *   站点域名常换，靠 /play/video/ 路径识别播放页；入口挂在共享悬浮球菜单（"含羞草解锁"）。
 *   v1.1.7：适配带 @grant 的沙盒（页面对象经 unsafeWindow 访问）、hls.js 按需加载、
 *           SPA 切页改为点击后复查地址兜底，入口随播放页显隐。
 * ===================================================================== */

(function () {
  'use strict';

  // 顶部诊断条开关：排障时改成 true 就会置顶显示 UA/URL/状态。
  // （之前漏了这行声明，'use strict' 下 showDiag 里的 !DEBUG 会抛 ReferenceError，
  //  把 fetchPreUrlById 每个取址组合都提前打断 → fallback 永远失败、只能靠 hook。）
  const DEBUG = false;
  // 带 @grant 的脚本跑在沙盒里：hook 页面请求、找站点 ckplayer 都得拿页面自己的 window（有 unsafeWindow 就用）。
  const PAGE = (typeof unsafeWindow === 'object' && unsafeWindow) || window;

  const AES_KEY = 'B77A9FF7F323B5404902102257503C2F';
  const END_EXPAND = 999999;
  const TAG = '[hxc-unlock]';
  const IS_IOS_SAFARI = isIosSafari();
  // 站点 ckplayer 自带的 hls（同源业务静态资源，非第三方破解 API）
  const SITE_HLS_CANDIDATES = [
    () => {
      try {
        const ck = document.querySelector('script[src*="ckplayer"]');
        if (ck && ck.src) {
          const base = ck.src.replace(/\/js\/ckplayer[^/]*$/, '/');
          return base + 'hls.js/hls.min.js';
        }
      } catch {
        /* ignore */
      }
      return null;
    },
    () => {
      const host = location.hostname;
      // 页面静态资源常见在 j0x.nasuiyile.com，从已加载脚本推断
      const hit = [...document.scripts]
        .map((s) => s.src)
        .find((s) => /nasuiyile\.com|ckplayer/i.test(s));
      if (hit) {
        try {
          const u = new URL(hit);
          return [
            u.origin + '/h5/ckplayer/hls.js/hls.min.js',
            u.origin + '/mobile/ckplayer/hls.js/hls.min.js',
            u.origin + '/pc/ckplayer/hls.js/hls.min.js',
          ];
        } catch {
          /* ignore */
        }
      }
      return null;
    },
    () => [
      'https://j02n.nasuiyile.com/h5/ckplayer/hls.js/hls.min.js',
      'https://j02n.nasuiyile.com/mobile/ckplayer/hls.js/hls.min.js',
      'https://j02n.nasuiyile.com/pc/ckplayer/hls.js/hls.min.js',
    ],
  ];

  const BUILTIN_API_CANDIDATES = [
    'https://a64d.vd9h4.com',
    'https://a59e.f3de7.com',
  ];

  const STATE = {
    apiBase: '',
    videoUrl: '',
    mediaUrl: '',
    videoId: 0,
    played: false, // 真正开始播/用户可点播
    attached: false, // 播放器已挂上
    lastHref: '',
    unlocking: false,
    attachTimer: null, // 挂载重试 interval 句柄
    readyTimer: null, // 8s 未播兜底 timeout 句柄
    hooksInstalled: false, // 网络 hook 是否已装（幂等）
    attaching: false, // onGotVideoUrl 正在挂载（hook 与 fallback 并发时的互斥锁）
  };

  /* ---------------- utils ---------------- */

  function log(...args) {
    console.log(TAG, ...args);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // 带超时的 fetch：iOS Safari 上请求偶尔会挂住不返回，超时后 abort，交给上层重试/换 base。
  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 8000);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  // 无条件可见的诊断条：只要脚本在播放页激活就置顶显示，方便在 iOS 上判断
  // 「脚本到底注入了没 / 卡在哪一步」。点右上角 × 可关闭。
  function showDiag(extra) {
    if (!DEBUG) return; // 默认关闭，不挡视线；DEBUG=true 时才显示诊断条
    try {
      let d = document.getElementById('hxc-diag');
      if (!d) {
        d = document.createElement('div');
        d.id = 'hxc-diag';
        d.style.cssText =
          'position:fixed;left:0;right:0;top:0;z-index:2147483647;' +
          'background:rgba(0,0,0,.86);color:#7CFFB2;font:12px/1.4 monospace;' +
          'padding:6px 30px 6px 8px;white-space:pre-wrap;word-break:break-all;';
        const close = document.createElement('span');
        close.textContent = '×';
        close.style.cssText =
          'position:absolute;right:8px;top:2px;color:#fff;font-size:20px;line-height:1;cursor:pointer;';
        close.onclick = () => d.remove();
        const body = document.createElement('div');
        body.id = 'hxc-diag-body';
        d.appendChild(close);
        d.appendChild(body);
        (document.body || document.documentElement).appendChild(d);
      }
      const b = d.querySelector('#hxc-diag-body') || d;
      b.textContent =
        'hxc v1.1.7 (nsfw) · iosSafari=' +
        IS_IOS_SAFARI +
        ' · isPlayPage=' +
        /\/play\/video\//i.test(location.href) +
        ' · auth=' +
        (hasAuthToken() ? 'yes' : 'NO') +
        (extra ? ' · ' + extra : '') +
        '\n' +
        location.href;
    } catch {
      /* ignore */
    }
  }

  function isIosSafari() {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ 默认「请求桌面网站」，UA 变成 Macintosh，无 iPad/Mobile 字样，
    // 只能靠 MacIntel + 多点触控识别，否则 iPad 上脚本会整个不运行。
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || iPadOS;
    if (!isIOS) return false;
    // 明确的第三方 iOS 浏览器才排除；桌面模式的 Safari UA 不含 Mobile，
    // 不能再拿 Mobile 当放行条件（否则 iPad 桌面模式被误杀）。
    const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|MicroMessenger|QQBrowser|UCBrowser|Quark/i.test(ua);
    return !isOtherIOSBrowser;
  }

  function isApiPath(url, path) {
    return typeof url === 'string' && url.indexOf(path) !== -1;
  }

  function rememberApiBase(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    try {
      const u = new URL(url, location.href);
      if (/\/(videos|base|gather|login|user|vip|visitor)\//.test(u.pathname)) {
        STATE.apiBase = u.origin;
      }
    } catch {
      /* ignore */
    }
  }

  function expandTrialUrl(url) {
    if (!url) return '';
    let u = String(url).replace(/\\u0026/g, '&');
    if (/[?&]start=\d+/i.test(u)) u = u.replace(/([?&])start=\d+/gi, '$1start=0');
    else u += (u.indexOf('?') >= 0 ? '&' : '?') + 'start=0';
    if (/[?&]end=\d+/i.test(u)) u = u.replace(/([?&])end=\d+/gi, '$1end=' + END_EXPAND);
    else u += '&end=' + END_EXPAND;
    return u.replace(/&&/g, '&').replace(/\?&/, '?');
  }

  function resetTrialCounters() {
    try {
      const pre = localStorage.getItem('preInfo');
      if (pre) {
        const o = JSON.parse(pre);
        o.count = 0;
        o.preNum = 0;
        localStorage.setItem('preInfo', JSON.stringify(o));
      }
    } catch {
      /* ignore */
    }
    try {
      const t = localStorage.getItem('tryPlayNum');
      if (t) {
        const o = JSON.parse(t);
        o.num = 0;
        localStorage.setItem('tryPlayNum', JSON.stringify(o));
      }
    } catch {
      /* ignore */
    }
  }

  function parseVideoIdFromLocation(href) {
    const url = href || location.href;
    const m2 = url.match(/[?&]videoId=(\d+)/i);
    if (m2) return parseInt(m2[1], 10);
    const m = url.match(/\/play\/video\/(\d+)(?:[/?#]|$)/i);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function isGatherOnlyUrl(href) {
    const url = href || location.href;
    return /\/play\/video\/\d+\/1(?:[?#]|$)/i.test(url) && !/[?&]videoId=/i.test(url);
  }

  function parseGatherId(href) {
    const url = href || location.href;
    let m = url.match(/[?&]cid=(\d+)/i);
    if (m) return parseInt(m[1], 10);
    m = url.match(/\/play\/video\/(\d+)\/1(?:[?#]|$)/i);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  // 从 URL 解析 videoSort（集序）。桌面版靠 hook 复用页面 body 自带正确的 videoSort，
  // iOS 走 fallback 得自己拼，写死 1 会和 /play/video/{id}/{sort} 里的 sort 对不上。
  function parseVideoSortFromLocation(href) {
    const url = href || location.href;
    let m = url.match(/[?&]videoSort=(\d+)/i);
    if (m) return parseInt(m[1], 10);
    m = url.match(/\/play\/video\/\d+\/(\d+)(?:[/?#]|$)/i);
    if (m) return parseInt(m[1], 10);
    return -1; // 未知
  }

  // 判断当前是否带得出登录 token（诊断条据此显示 auth=yes/NO）。
  function hasAuthToken() {
    try {
      const stores = [localStorage, sessionStorage];
      for (let s = 0; s < stores.length; s++) {
        const store = stores[s];
        if (!store) continue;
        const keys = Object.keys(store);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (/token|auth/i.test(k)) {
            const v = store.getItem(k);
            if (v && v.length < 500 && v[0] !== '{') return true;
          }
        }
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /* ---------------- AES ---------------- */

  function bytesToBase64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  async function aesEncrypt(plain) {
    const keyBytes = new TextEncoder().encode(AES_KEY);
    const iv = keyBytes.slice(0, 16);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-CBC' },
      false,
      ['encrypt']
    );
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      cryptoKey,
      new TextEncoder().encode(String(plain))
    );
    return bytesToBase64(new Uint8Array(cipher));
  }

  function utcTs() {
    const z = new Date();
    return parseInt(z.getTime() / 1e3, 10) + z.getTimezoneOffset() * 60;
  }

  function compactBody(obj) {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v === '' || v === null || v === undefined) return;
      out[k] = v;
    });
    return out;
  }

  async function buildEncryptedPayload(data) {
    const plain = JSON.stringify(compactBody(data));
    return {
      endata: await aesEncrypt(plain),
      ents: await aesEncrypt(String(utcTs())),
    };
  }

  /* ---------------- network ---------------- */

  function defaultHeaders(extra) {
    const h = {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8;',
      Did: '1',
      source: '1',
      isShortChain: '',
    };
    try {
      const keys = Object.keys(localStorage);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (/token|auth/i.test(k)) {
          const v = localStorage.getItem(k);
          if (v && v.length < 500 && v[0] !== '{') {
            h.Auth = v.replace(/^"|"$/g, '');
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }
    return Object.assign(h, extra || {});
  }

  function collectApiBases() {
    const bases = [];
    const add = (b) => {
      if (b && bases.indexOf(b) === -1) bases.push(b);
    };
    add(STATE.apiBase);
    BUILTIN_API_CANDIDATES.forEach(add);
    try {
      performance.getEntriesByType('resource').forEach((e) => {
        if (/\/videos\/|\/base\//.test(e.name)) add(new URL(e.name).origin);
      });
    } catch {
      /* ignore */
    }
    return bases;
  }

  const API_TIMEOUT = 8000;
  const API_RETRY_DELAYS = [500, 1200, 1900]; // 瞬时错误的指数退避重试间隔

  async function postApi(path, data, headers) {
    const bases = collectApiBases();
    let lastErr = null;
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i];
      // 每个 base 上对「网络/超时」类瞬时错误做指数退避重试；
      // 服务端已返回但逻辑失败（如试看关闭）不重试，直接换下一个 base。
      for (let attempt = 0; attempt <= API_RETRY_DELAYS.length; attempt++) {
        try {
          const payload = await buildEncryptedPayload(data);
          const res = await fetchWithTimeout(
            base + path,
            {
              method: 'POST',
              headers: headers || defaultHeaders(),
              body: JSON.stringify(payload),
              credentials: 'omit',
            },
            API_TIMEOUT
          );
          const json = await res.json();
          if (json && (json.code === 0 || json.data)) {
            STATE.apiBase = base;
            return json;
          }
          lastErr = json;
          break; // 逻辑失败，重试也没用，换下一个 base
        } catch (e) {
          lastErr = e; // 网络/超时/abort 类瞬时错误：退避后重试
          if (attempt < API_RETRY_DELAYS.length) await sleep(API_RETRY_DELAYS[attempt]);
        }
      }
    }
    throw lastErr || new Error('all api bases failed');
  }

  async function fetchPreUrlOnce(videoId, videoSort, noAuth) {
    const id = Number(videoId);
    if (!id) throw new Error('invalid videoId');
    const body = { videoId: id };
    if (videoSort != null && Number(videoSort) >= 0) body.videoSort = Number(videoSort);
    const headers = defaultHeaders();
    // 关键：该站「试看」多半只对游客(未登录)开放，带 token 反而被判为「已注册→开通VIP」。
    // noAuth=true 时去掉登录态，复现「桌面游客」那条能成功的请求。
    if (noAuth && headers.Auth) delete headers.Auth;
    const json = await postApi('/videos/getPreUrl', body, headers);
    if (!json || !json.data || !json.data.url) {
      throw new Error((json && json.msg) || 'getPreUrl empty');
    }
    return expandTrialUrl(json.data.url);
  }

  // 之前发现：多档 videoSort 全部「试看功能已关闭」，而诊断条 auth=yes。
  // 桌面是纯游客却能看 → 试看只对游客开放。所以这里「游客身份优先」逐个组合尝试。
  async function fetchPreUrlById(videoId, hintSort) {
    const combos = [];
    const seen = {};
    const add = (noAuth, s) => {
      if (s != null && s < 0) return;
      const key = (noAuth ? 'g' : 'a') + '|' + (s == null ? 'none' : s);
      if (seen[key]) return;
      seen[key] = true;
      combos.push({ noAuth: noAuth, sort: s });
    };
    // 游客(不带 token)优先
    add(true, hintSort);
    add(true, null);
    add(true, 1);
    add(true, 0);
    // 再退回带登录态
    add(false, hintSort);
    add(false, null);

    let lastErr = null;
    for (let i = 0; i < combos.length; i++) {
      const c = combos[i];
      const tag = (c.sort == null ? 'none' : c.sort) + (c.noAuth ? ' guest' : ' auth');
      try {
        showDiag('getPreUrl #' + videoId + ' sort=' + tag + ' …');
        return await fetchPreUrlOnce(videoId, c.sort, c.noAuth);
      } catch (e) {
        lastErr = e;
        log('getPreUrl', tag, 'fail', e && e.message);
      }
    }
    throw new Error(
      '游客/登录多组合均失败: ' + (lastErr && lastErr.message ? lastErr.message : 'unknown')
    );
  }

  async function resolveGatherFirstVideoId(gatherId) {
    const json = await postApi('/gather/getDetail', { gatherId: Number(gatherId) });
    const videos = json && json.data && json.data.info && json.data.info.videos;
    if (videos && videos.length) return Number(videos[0].id);
    throw new Error('gather empty');
  }

  /**
   * master m3u8 → 实际 media m3u8（并继续扩窗）
   * 失败则退回 master
   */
  async function resolvePlayableM3u8(masterUrl) {
    const url = expandTrialUrl(masterUrl);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        credentials: 'omit',
        headers: { Accept: '*/*' },
      });
      clearTimeout(timer);
      if (!res.ok) return url;
      const text = await res.text();
      // 已是 media playlist
      if (/#EXTINF:/i.test(text)) return url;
      const lines = text.split(/\r?\n/);
      let media = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line[0] === '#') continue;
        media = line;
        break;
      }
      if (!media) return url;
      const abs = new URL(media, url).href;
      return expandTrialUrl(abs);
    } catch (e) {
      log('resolve media m3u8 fail, use master', e);
      return url;
    }
  }

  /* ---------------- hooks ---------------- */

  function installNetworkHooks() {
    if (STATE.hooksInstalled) return;
    STATE.hooksInstalled = true;
    const XHR = PAGE.XMLHttpRequest.prototype;
    const rawOpen = XHR.open;
    const rawSend = XHR.send;
    const rawSetHeader = XHR.setRequestHeader;

    XHR.open = function (method, url) {
      this.__hxc = { method, url: String(url), headers: {} };
      rememberApiBase(String(url));
      return rawOpen.apply(this, arguments);
    };

    XHR.setRequestHeader = function (k, v) {
      if (this.__hxc) this.__hxc.headers[k] = v;
      return rawSetHeader.apply(this, arguments);
    };

    XHR.send = function (body) {
      try {
        const meta = this.__hxc;
        if (meta && isApiPath(meta.url, '/videos/getInfo')) {
          rememberApiBase(meta.url);
          cloneGetPreUrl(meta.url.replace('/videos/getInfo', '/videos/getPreUrl'), body, meta.headers);
        }
      } catch (e) {
        log('xhr hook err', e);
      }
      return rawSend.apply(this, arguments);
    };

    const rawFetch = PAGE.fetch;
    if (typeof rawFetch === 'function') {
      PAGE.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          rememberApiBase(url);
          if (isApiPath(url, '/videos/getInfo')) {
            const headers = {};
            if (init && init.headers) {
              if (init.headers.forEach) init.headers.forEach((v, k) => (headers[k] = v));
              else Object.assign(headers, init.headers);
            }
            cloneGetPreUrl(url.replace('/videos/getInfo', '/videos/getPreUrl'), init && init.body, headers);
          }
        } catch (e) {
          log('fetch hook err', e);
        }
        return rawFetch.apply(this, arguments);
      };
    }
  }

  let cloneInflight = '';
  function cloneGetPreUrl(preUrl, body, headers) {
    const key = String(body || '') + '|' + preUrl;
    if (cloneInflight === key) return;
    cloneInflight = key;

    const h = Object.assign({}, headers || {});
    if (!h['Content-Type'] && !h['content-type']) {
      h['Content-Type'] = 'application/json;charset=UTF-8;';
    }

    fetch(preUrl, { method: 'POST', headers: h, body: body, credentials: 'omit' })
      .then((r) => r.json())
      .then((json) => {
        if (json && json.data && json.data.url) {
          log('hook getPreUrl ok');
          onGotVideoUrl(expandTrialUrl(json.data.url));
        } else {
          log('hook getPreUrl fail', json);
          fallbackUnlock();
        }
      })
      .catch((e) => {
        log('hook getPreUrl error', e);
        fallbackUnlock();
      })
      .finally(() => {
        // 请求已结束，放开这把 in-flight 锁，页面内后续合法触发（切集/重试）不再被静默挡掉
        if (cloneInflight === key) cloneInflight = '';
      });
  }

  /* ---------------- UI / player ---------------- */

  function removeVipUi() {
    // 只动遮罩，别乱删封面/容器（会和 Vue 互撕导致播放器挂掉）
    const sels = ['.vip-mask', '.absolute.bg-overlay', '.login-tip-modal', '#login-tip-modal'];
    sels.forEach((s) => {
      document.querySelectorAll(s).forEach((el) => {
        try {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        } catch {
          /* ignore */
        }
      });
    });
  }

  function ensurePanel(url, statusText) {
    let panel = document.getElementById('hxc-unlock-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'hxc-unlock-panel';
      panel.style.cssText =
        'position:relative;z-index:10001;margin:8px 0;padding:10px 12px;' +
        'background:rgba(0,0,0,.8);color:#7CFFB2;font:13px/1.5 sans-serif;' +
        'border-radius:6px;word-break:break-all;';
      const mount =
        document.querySelector('#v_prism') ||
        document.querySelector('#video1') ||
        document.querySelector('h1,h2') ||
        document.body;
      if (mount && mount.parentNode) mount.parentNode.insertBefore(panel, mount.nextSibling);
      else (document.body || document.documentElement).appendChild(panel);
    }
    const safe = (url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    panel.innerHTML =
      '<div><b>含羞草解锁</b> <span id="hxc-status" style="opacity:.9">' +
      (statusText || '') +
      '</span></div>' +
      '<div style="margin-top:4px">' +
      '<a id="hxc-unlock-link" href="' +
      safe +
      '" target="_blank" style="color:#6ecbff;margin-right:12px">打开 m3u8</a>' +
      '<a id="hxc-click-play" href="javascript:void(0)" style="color:#ffd76e;margin-right:12px">点击播放</a>' +
      '<a id="hxc-retry" href="javascript:void(0)" style="color:#ccc">重试</a>' +
      '</div>' +
      '<div style="opacity:.75;font-size:12px;margin-top:4px">若画面黑但有控件：点「点击播放」。直链能播说明地址 OK，是页内自动播放被拦或播放器未挂上。</div>';

    const playBtn = panel.querySelector('#hxc-click-play');
    if (playBtn) {
      playBtn.onclick = (e) => {
        e.preventDefault();
        forcePlay(true);
      };
    }
    const retryBtn = panel.querySelector('#hxc-retry');
    if (retryBtn) {
      retryBtn.onclick = (e) => {
        e.preventDefault();
        STATE.played = false;
        STATE.attached = false;
        STATE.videoUrl = '';
        STATE.mediaUrl = '';
        cloneInflight = '';
        fallbackUnlock(true);
      };
    }
  }

  function setStatus(t) {
    const el = document.getElementById('hxc-status');
    if (el) el.textContent = t || '';
  }

  function ensureMobileViewport() {
    if (!IS_IOS_SAFARI || !document.head) return;
    // 站点已有 viewport 就别改写，避免破坏其自身布局；仅在缺失时补一个。
    if (document.querySelector('meta[name="viewport"]')) return;
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(meta);
  }

  function getPlayerBox() {
    return (
      document.querySelector('#v_prism') ||
      document.querySelector('#video1') ||
      document.querySelector('.ck-video') ||
      null
    );
  }

  function ensureVideoEl() {
    let video = document.getElementById('hxc-unlock-video');
    const box = getPlayerBox();
    if (!box) return null;

    if (!video || !box.contains(video)) {
      // 清空站点空壳，挂我们的 video（只清播放容器，不动整页）
      try {
        box.innerHTML = '';
      } catch {
        /* ignore */
      }
      video = document.createElement('video');
      video.id = 'hxc-unlock-video';
      video.controls = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('x-webkit-airplay', 'allow');
      video.preload = 'auto';
      video.style.cssText =
        'width:100%;height:100%;min-height:' +
        (IS_IOS_SAFARI ? '210px' : '240px') +
        ';max-height:' +
        (IS_IOS_SAFARI ? '70vh' : '80vh') +
        ';background:#000;display:block;position:relative;z-index:99999;';
      box.style.position = box.style.position || 'relative';
      box.style.zIndex = '99999';
      if (IS_IOS_SAFARI) {
        box.style.aspectRatio = box.style.aspectRatio || '16 / 9';
        box.style.minHeight = box.style.minHeight || '210px';
        box.style.background = '#000';
        box.style.overflow = 'hidden';
      }
      box.appendChild(video);
    }
    return video;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existed = [...document.scripts].find((s) => s.src === src);
      if (existed) {
        if (nsfwHlsCtor()) return resolve();
        existed.addEventListener('load', () => resolve());
        existed.addEventListener('error', () => reject(new Error('hls load fail')));
        setTimeout(() => (nsfwHlsCtor() ? resolve() : reject(new Error('hls timeout'))), 8000);
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script error ' + src));
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function ensureHlsLib() {
    if (nsfwHlsCtor()) return true;
    if (await nsfwHls()) return true; // 脚本公共的 CDN 按需加载
    const tried = {};
    for (let i = 0; i < SITE_HLS_CANDIDATES.length; i++) {
      const list = [].concat(SITE_HLS_CANDIDATES[i]() || []);
      for (let j = 0; j < list.length; j++) {
        const src = list[j];
        if (!src || tried[src]) continue;
        tried[src] = true;
        try {
          log('load hls', src);
          await loadScript(src);
          if (nsfwHlsCtor()) return true;
        } catch (e) {
          log('hls candidate fail', src, e);
        }
      }
    }
    return !!nsfwHlsCtor();
  }

  function bindVideoEvents(video) {
    if (video.__hxcBound) return;
    video.__hxcBound = true;
    video.addEventListener('loadedmetadata', () => {
      setStatus('已加载 ' + Math.round(video.duration || 0) + 's · 尝试播放');
      forcePlay();
    });
    video.addEventListener('playing', () => {
      STATE.played = true;
      if (video.muted) {
        // 静音自动播放已经动起来了，保留提示层让用户点一下开声音
        setStatus('已静音自动播放 · 点屏幕开启声音');
        showClickOverlay();
      } else {
        setStatus('播放中');
        hideClickOverlay();
      }
    });
    video.addEventListener('error', () => {
      setStatus('video error，请点「打开 m3u8」或重试');
    });
  }

  function showClickOverlay() {
    const box = getPlayerBox();
    if (!box) return;
    const video = document.getElementById('hxc-unlock-video');
    const unmute = !!(video && !video.paused && video.muted); // 正在静音播放 → 提示开声音
    let ov = document.getElementById('hxc-click-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'hxc-click-overlay';
      ov.style.cssText =
        'position:absolute;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
        'cursor:pointer;color:#fff;font:600 18px/1.2 sans-serif;touch-action:manipulation;';
      ov.innerHTML =
        '<div id="hxc-ov-btn" style="padding:14px 22px;border-radius:10px;background:#e6a23c;color:#111">▶ 点击播放</div>';
      ov.onclick = () => forcePlay(true);
      ov.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          forcePlay(true);
        },
        { passive: false }
      );
      const pos = getComputedStyle(box).position;
      if (!pos || pos === 'static') box.style.position = 'relative';
      box.appendChild(ov);
    }
    const btn = ov.querySelector('#hxc-ov-btn');
    if (btn) btn.textContent = unmute ? '🔊 点击开启声音' : '▶ 点击播放';
    // 静音播放时用更淡的遮罩，别把画面盖死
    ov.style.background = unmute ? 'rgba(0,0,0,.15)' : 'rgba(0,0,0,.45)';
    ov.style.display = 'flex';
  }

  function hideClickOverlay() {
    const ov = document.getElementById('hxc-click-overlay');
    if (ov) ov.style.display = 'none';
  }

  function forcePlay(userGesture) {
    const video =
      document.getElementById('hxc-unlock-video') ||
      document.querySelector('#v_prism video, #video1 video, video');
    if (!video) {
      if (STATE.mediaUrl || STATE.videoUrl) attachPlayer(STATE.mediaUrl || STATE.videoUrl);
      return;
    }
    removeVipUi();
    if (userGesture) video.muted = false; // 只有用户手势才能带声音播

    const p = video.play();
    if (!p || typeof p.then !== 'function') return;

    p.then(() => {
      STATE.played = true;
      if (video.muted) {
        setStatus('已静音自动播放 · 点屏幕开启声音');
        showClickOverlay();
      } else {
        hideClickOverlay();
        setStatus('播放中');
      }
    }).catch((err) => {
      log('play blocked', err, 'muted=', video.muted, 'gesture=', !!userGesture);
      if (!userGesture && !video.muted) {
        // 有声自动播放被 iOS 拦截 → 退回静音自动播放（iOS 通常放行），先让画面动起来
        video.muted = true;
        video
          .play()
          .then(() => {
            STATE.played = true;
            setStatus('已静音自动播放 · 点屏幕开启声音');
            showClickOverlay();
          })
          .catch((e2) => {
            log('muted autoplay also blocked', e2);
            setStatus('需手动点击播放（浏览器拦截自动播放）');
            showClickOverlay();
          });
      } else {
        setStatus('需手动点击播放（浏览器拦截自动播放）');
        showClickOverlay();
      }
    });
  }

  async function attachPlayer(url) {
    if (!url) return false;
    const video = ensureVideoEl();
    if (!video) {
      setStatus('等待播放器容器…');
      return false;
    }
    bindVideoEvents(video);
    removeVipUi();

    // Safari 原生 HLS
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      if (video.src !== url) video.src = url;
      try {
        video.load();
      } catch {
        /* ignore */
      }
      STATE.attached = true;
      forcePlay();
      return true;
    }

    const H = (await ensureHlsLib()) ? nsfwHlsCtor() : null;
    if (!H || !H.isSupported()) {
      setStatus('无 HLS 能力，请点「打开 m3u8」');
      return false;
    }

    try {
      if (video.__hls) {
        try {
          video.__hls.destroy();
        } catch {
          /* ignore */
        }
        video.__hls = null;
      }
      const hls = new H({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hls.on(H.Events.ERROR, (_, data) => {
        log('hls error', data);
        if (data && data.fatal) {
          setStatus('HLS 错误: ' + (data.details || data.type));
          try {
            if (data.type === H.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === H.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          } catch {
            /* ignore */
          }
        }
      });
      hls.on(H.Events.MANIFEST_PARSED, () => {
        setStatus('清单已解析，尝试播放');
        forcePlay();
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      video.__hls = hls;
      STATE.attached = true;
      // 再兜一次 play（用箭头包一层，否则 timeoutId 会被当成 userGesture 传进去）
      setTimeout(() => forcePlay(), 300);
      return true;
    } catch (e) {
      log('attach hls fail', e);
      setStatus('挂载失败: ' + e.message);
      return false;
    }
  }

  /** 次选：站点 ckplayer（有时比自建慢/被 paused） */
  function playWithCkplayer(url) {
    const box = getPlayerBox();
    if (!box || typeof PAGE.ckplayer !== 'function') return false;
    try {
      if (PAGE.ck) {
        try {
          if (typeof PAGE.ck.remove === 'function') PAGE.ck.remove();
        } catch {
          /* ignore */
        }
        PAGE.ck = null;
      }
      // 若我们已有 video，不再用 ckplayer 覆盖
      if (document.getElementById('hxc-unlock-video')) return false;
      box.style.zIndex = '99999';
      PAGE.ck = new PAGE.ckplayer({
        container: box.id ? '#' + box.id : box,
        plug: 'hls.js',
        video: url,
        cookie: 'hxc_unlock',
      });
      try {
        PAGE.ck.volume(1);
        PAGE.ck.play();
      } catch {
        /* ignore */
      }
      STATE.attached = true;
      setTimeout(() => {
        const v = box.querySelector('video');
        if (v) {
          v.controls = true;
          bindVideoEvents(v);
          forcePlay();
        }
      }, 500);
      return true;
    } catch (e) {
      log('ckplayer fail', e);
      return false;
    }
  }

  async function onGotVideoUrl(masterUrl) {
    if (!masterUrl) return;
    if (STATE.videoUrl === masterUrl && (STATE.attached || STATE.played)) return;
    // hook 与 fallback 两条路可能几乎同时拿到地址，各挂一次会让播放器反复重建。
    // 谁先进来谁负责本轮挂载，另一条直接返回。
    if (STATE.attaching) return;
    STATE.attaching = true;

    STATE.videoUrl = masterUrl;
    ensurePanel(masterUrl, '解析 media 清单…');
    nsfwDockBadge(() => {
      const target = getPlayerBox() || document.getElementById('hxc-unlock-panel');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    removeVipUi();

    const mediaUrl = await resolvePlayableM3u8(masterUrl);
    STATE.mediaUrl = mediaUrl;
    ensurePanel(mediaUrl, '挂载播放器…');
    log('play url', mediaUrl.slice(0, 140));

    // 优先自建 HLS（可控、可点播）。inFlight 保证「上一拍没跑完就跳过这一拍」，
    // 否则每 400ms 叠加一个异步 attach，可能建出多个 hls 实例互相打架。
    let n = 0;
    let inFlight = false;
    const tryAttach = async () => {
      if (inFlight) return false;
      inFlight = true;
      try {
        removeVipUi();
        if (await attachPlayer(mediaUrl)) return true;
        if (playWithCkplayer(mediaUrl)) return true;
        return false;
      } finally {
        inFlight = false;
      }
    };

    // 挂载前先清掉上一轮可能还在跑的定时器，避免切集/重试后旧循环把上一集地址挂过来
    if (STATE.attachTimer) clearInterval(STATE.attachTimer);
    if (STATE.readyTimer) clearTimeout(STATE.readyTimer);
    STATE.attachTimer = null;
    STATE.readyTimer = null;

    STATE.attaching = false; // 定时器接管后即释放锁，切集/重试可再进入

    if (await tryAttach()) return;

    STATE.attachTimer = setInterval(async () => {
      n++;
      if ((await tryAttach()) || n > 30) {
        clearInterval(STATE.attachTimer);
        STATE.attachTimer = null;
      }
    }, 400);

    // 8s 仍无 playing → 提示点播
    STATE.readyTimer = setTimeout(() => {
      STATE.readyTimer = null;
      if (!STATE.played) {
        setStatus('已就绪但未自动播，请点「点击播放」');
        showClickOverlay();
      }
    }, 8000);
  }

  /* ---------------- fallback unlock ---------------- */

  async function fallbackUnlock(force) {
    if (!/\/play\/video\//i.test(location.href)) return;
    if (STATE.unlocking) return;
    if (!force && STATE.played) return;
    if (!force && STATE.videoUrl && STATE.attached) return;

    STATE.unlocking = true;
    try {
      resetTrialCounters();
      ensurePanel(STATE.videoUrl || '#', '取址中…');

      let videoId = parseVideoIdFromLocation();
      if (isGatherOnlyUrl()) {
        const gid = parseGatherId();
        if (gid) {
          setStatus('解析合集…');
          videoId = await resolveGatherFirstVideoId(gid);
        }
      }
      if (!videoId) {
        setStatus('未识别 videoId');
        return;
      }
      STATE.videoId = videoId;
      log('fallback videoId', videoId);
      const hintSort = parseVideoSortFromLocation();
      setStatus('getPreUrl #' + videoId);
      const url = await fetchPreUrlById(videoId, hintSort);
      await onGotVideoUrl(url);
    } catch (e) {
      log('fallback fail', e);
      const msg = '失败: ' + (e && e.message ? e.message : e);
      showDiag(msg);
      ensurePanel(STATE.videoUrl || '#', msg);
    } finally {
      STATE.unlocking = false;
    }
  }

  /* ---------------- route / boot ---------------- */

  let dockEntry = null;
  function syncDockEntry(onPlayPage) {
    if (!onPlayPage && !dockEntry) return; // 不是播放页、也没建过入口：别为此在别的网站上创建悬浮球
    dockEntry = nsfwDockEntry('hxc-unlock-entry', '含羞草解锁', () => {
      const panel = document.getElementById('hxc-unlock-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!STATE.played) fallbackUnlock(true);
    });
    dockEntry.hidden = !onPlayPage;
  }

  function onRoute() {
    const onPlayPage = /\/play\/video\//i.test(location.href);
    syncDockEntry(onPlayPage);
    if (!onPlayPage) return;
    // 进到播放页才「激活」：亮诊断条、补装 hook、启动观察器、补 viewport
    // （只在播放页做，不打扰其它网站）
    showDiag('onRoute');
    installNetworkHooks();
    startObserver();
    ensureMobileViewport();
    const changed = location.href !== STATE.lastHref;
    if (changed) {
      STATE.lastHref = location.href;
      STATE.played = false;
      STATE.attached = false;
      STATE.videoUrl = '';
      STATE.mediaUrl = '';
      STATE.unlocking = false;
      cloneInflight = '';
      // 切集/切路由：清掉上一集残留的重试与兜底定时器，避免把旧地址挂到新页
      if (STATE.attachTimer) clearInterval(STATE.attachTimer);
      if (STATE.readyTimer) clearTimeout(STATE.readyTimer);
      STATE.attachTimer = null;
      STATE.readyTimer = null;
      hideClickOverlay();
    }
    resetTrialCounters();
    // 立刻兜底，不傻等 hook（hook 仍会并行加速）
    setTimeout(() => fallbackUnlock(false), 200);
    setTimeout(() => {
      if (!STATE.videoUrl) fallbackUnlock(false);
    }, 1500);
  }

  function hookHistory() {
    const wrap = (type) => {
      const raw = PAGE.history[type];
      return function () {
        const ret = raw.apply(this, arguments);
        try {
          onRoute();
        } catch {
          /* ignore */
        }
        return ret;
      };
    };
    try {
      PAGE.history.pushState = wrap('pushState');
      PAGE.history.replaceState = wrap('replaceState');
    } catch {
      /* ignore */
    }
    window.addEventListener('popstate', onRoute);
    // 沙盒里可能 hook 不到页面的 history：SPA 切页都由用户点击触发，点击后延时复查地址即可，不用常驻轮询
    let lastSeen = location.href;
    const recheck = () => {
      if (location.href === lastSeen) return;
      lastSeen = location.href;
      try {
        onRoute();
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('click', () => {
      setTimeout(recheck, 300);
      setTimeout(recheck, 1200);
    }, true);
  }

  let moStarted = false;
  function startObserver() {
    if (moStarted) return;
    moStarted = true;
    // 轻量观察：只隐藏遮罩、必要时重挂 video。用 rAF 合并，避免高频 DOM 变动卡顿。
    let moScheduled = false;
    const mo = new MutationObserver(() => {
      if (moScheduled) return;
      moScheduled = true;
      requestAnimationFrame(() => {
        moScheduled = false;
        removeVipUi();
        // 站点若把我们的 video 冲掉，自动重挂
        if (STATE.mediaUrl && STATE.attached && !document.getElementById('hxc-unlock-video')) {
          log('video removed by page, re-attach');
          STATE.attached = false;
          attachPlayer(STATE.mediaUrl);
        }
      });
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function boot() {
    // 不再用 isIosSafari 当「是否运行」的开关：iOS 各家脚本管理器、以及 iPhone/iPad
    // 的「请求桌面网站」会让检测误判成 false，直接导致整个脚本不激活（现象就是
    // 「电脑能用、iOS 没反应、连面板都不出现」）。检测结果只保留给 IS_IOS_SAFARI
    // 决定 iOS 专属样式；全站注入，靠 onRoute 内部判断是否播放页再激活重逻辑。
    hookHistory();

    // document-start 时若已在播放页，尽早装 hook，抢在页面请求之前
    if (/\/play\/video\//i.test(location.href)) installNetworkHooks();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onRoute);
    } else {
      onRoute();
    }
    window.addEventListener('load', () => {
      if (!/\/play\/video\//i.test(location.href)) return;
      showDiag('load');
      installNetworkHooks();
      startObserver();
      removeVipUi();
      if (!STATE.played) fallbackUnlock(false);
    });
  }

  boot();
})();

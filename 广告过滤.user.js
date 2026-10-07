// ==UserScript==
// @name         隐藏干扰项 Pro（点选隐藏 / 持久拦截）
// @namespace    https://github.com/yourname/hide-distracting-items
// @version      1.5.2
// @updateURL    https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E5%B9%BF%E5%91%8A%E8%BF%87%E6%BB%A4.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E5%B9%BF%E5%91%8A%E8%BF%87%E6%BB%A4.user.js
// @description  自动过滤常见广告（含 iframe 内部）、拦截弹窗与全屏遮罩，并可点选隐藏任意页面元素，上下层逐级调整选中范围；按网站保存规则，小巧可拖动的悬浮入口，上下箭头一键回顶部 / 到底部，可与 视频嗅探共用。误伤时可随时管理、恢复。
// @author       you
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* 子框架里也要跑：很多广告是 iframe 里再套一层，顶层只能整块隐藏。
   * 但子框架只做自动过滤，不挂 UI —— 悬浮球、点选工具条只属于顶层页面。 */
  const isTop = window.top === window.self;

  /* 页面脚本可能覆盖浏览器内置对象：mrds.com 用的 Mirages 主题在顶层写了
   * `var CSS = function (css) {...}`，直接把 window.CSS 换成了它自己的函数，之后 CSS.escape 就不存在了，
   * 「隐藏」按钮一生成选择器就抛 TypeError，表现成"点了没反应"。
   * 我们在 document-start（页面脚本还没跑）先把原生实现抓在手里；抓不到就用按 CSSOM 规范写的兜底实现。 */
  const nativeCssEscape = (() => {
    try {
      const ns = window.CSS;
      return ns && typeof ns.escape === 'function' ? ns.escape.bind(ns) : null;
    } catch (e) { return null; }
  })();
  function cssEscape(value) {
    if (nativeCssEscape) {
      try { return nativeCssEscape(value); } catch (e) {}
    }
    const str = String(value);
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      const code = str.charCodeAt(i);
      if (code === 0) { out += '�'; continue; }
      if ((code >= 0x1 && code <= 0x1f) || code === 0x7f ||
          (i === 0 && code >= 0x30 && code <= 0x39) ||
          (i === 1 && code >= 0x30 && code <= 0x39 && str.charCodeAt(0) === 0x2d)) {
        out += '\\' + code.toString(16) + ' ';
        continue;
      }
      if (i === 0 && str.length === 1 && code === 0x2d) { out += '\\' + ch; continue; }
      if (code >= 0x80 || code === 0x2d || code === 0x5f ||
          (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        out += ch;
        continue;
      }
      out += '\\' + ch;
    }
    return out;
  }

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

  const VERSION = '1.5.2'; // 面板上会显示，方便确认装的是不是最新版
  const KEY = '__hdi_rules__::' + location.hostname;
  // 三个开关都是「存在=本站被手动关掉」；不存在=默认开启
  const AD_KEY = '__hdi_adfilter_off__';
  const POP_KEY = '__hdi_popup_off__';
  const MASK_KEY = '__hdi_mask_off__';
  const FLAG_KEYS = { ad: AD_KEY, pop: POP_KEY, mask: MASK_KEY };

  /* -------------------- 内置自动广告过滤规则（cosmetic） --------------------
   * iOS Safari Userscripts 下 @grant none，拉不了 EasyList 远程订阅，所以内置一套
   * 通用广告选择器，随脚本更新。尽量用精确 token / 前后缀匹配，少误伤正文；
   * 万一某站误伤，可在管理面板一键关闭「自动广告过滤」。 */
  const BUILTIN_AD_RULES = [
    // 通用广告容器（class 精确 token）
    '[class~="ad"]', '[class~="ads"]', '[class~="adsbygoogle"]', 'ins.adsbygoogle',
    '[class~="advertisement"]', '[class~="advertising"]', '[class~="sponsor"]',
    '[class~="sponsored"]', '[class~="promoted"]', '[class~="banner-ad"]', '[class~="ad-banner"]',
    // 常见广告命名（前后缀 / 中缀）
    '[class^="ad-"]', '[class*=" ad-"]', '[class$="-ad"]', '[class*="-ad "]',
    '[class^="ads-"]', '[class*=" ads-"]', '[class*="-ads"]', '[class*="_ad_"]', '[class*="_ads"]',
    '[class*="advert"]', '[class*="adsense"]',
    '[class*="ad-slot"]', '[class*="ad-unit"]', '[class*="ad-zone"]', '[class*="ad-frame"]',
    '[class*="ad-banner"]', '[class*="ad-container"]', '[class*="ad-wrapper"]',
    '[class*="ad-box"]', '[class*="ad-holder"]', '[class*="ad-block"]', '[class*="ad-space"]',
    '[class*="adbox"]', '[class*="adframe"]', '[class*="adwrap"]', '[class*="adslot"]',
    '[class*="popunder"]', '[class*="popup-ad"]', '[class*="ad-popup"]',
    // id
    '[id^="ad-"]', '[id^="ad_"]', '[id$="-ad"]', '[id$="_ad"]', '[id^="ads-"]', '[id^="ads_"]',
    '[id*="adunit"]', '[id*="ad-slot"]', '[id*="adslot"]', '[id*="adframe"]', '[id*="adbox"]',
    '[id^="google_ads"]', '[id^="div-gpt-ad"]', '[id^="taboola"]', '[id^="outbrain"]',
    '[id^="mgid"]', '[id*="revcontent"]', '[id*="adsterra"]',
    // 内容推荐型广告（Taboola / Outbrain / MGID / RevContent）
    '.OUTBRAIN', '.trc_rbox', '[class*="taboola"]', '[class*="outbrain"]',
    '[class*="mgbox"]', '[class*="mgid"]', '[class*="revcontent"]',
    // 广告网络 iframe
    'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    'iframe[src*="googleadservices"]', 'iframe[src*="google_ads"]',
    'iframe[src*="adservice."]', 'iframe[src*="adsystem."]', 'iframe[src*="adnxs"]',
    'iframe[src*="/ads/"]', 'iframe[src*="/adv/"]', 'iframe[src*="/banner"]',
    'iframe[src*="criteo"]', 'iframe[src*="pubmatic"]', 'iframe[src*="rubiconproject"]',
    'iframe[src*="openx"]', 'iframe[src*="smartadserver"]', 'iframe[src*="media.net"]',
    'iframe[src*="taboola"]', 'iframe[src*="outbrain"]', 'iframe[src*="mgid"]',
    'iframe[src*="revcontent"]', 'iframe[src*="adsterra"]', 'iframe[src*="hilltopads"]',
    'iframe[src*="propellerads"]', 'iframe[src*="popads"]', 'iframe[src*="popcash"]',
    'iframe[src*="adcash"]', 'iframe[src*="clickadu"]', 'iframe[src*="bidvertiser"]',
    'iframe[src*="exoclick"]', 'iframe[src*="exosrv"]', 'iframe[src*="juicyads"]',
    'iframe[src*="trafficjunky"]', 'iframe[src*="cpmstar"]', 'iframe[src*="zedo"]',
    'iframe[id^="google_ads_iframe"]', 'iframe[id^="aswift_"]', 'iframe[name^="google_ads"]',
    // IAB 标准广告尺寸：这些固定尺寸的 iframe 基本只有广告在用
    'iframe[width="300"][height="250"]', 'iframe[width="336"][height="280"]',
    'iframe[width="728"][height="90"]', 'iframe[width="970"][height="250"]',
    'iframe[width="320"][height="50"]', 'iframe[width="320"][height="100"]',
    'iframe[width="160"][height="600"]', 'iframe[width="300"][height="600"]',
    // 中文广告联盟（百度联盟 / 广点通 / 360 等）
    '[id^="cpro_"]', '[id*="baidu_ad"]', '.cproad', '[id^="union_"]', '[class*="gdt-"]',
    'iframe[src*="pos.baidu"]', 'iframe[src*="cpro.baidu"]', 'iframe[src*="gdt.qq"]',
    'iframe[src*="mediav"]', 'iframe[src*="union.360"]',
  ];

  /* 启发式：CSS 选择器写不全的第三方广告框架，按 URL 特征兜底识别。 */
  const AD_URL_RE = new RegExp(
    '(doubleclick|googlesyndication|googleadservices|google_ads|adservice\\.|adsystem\\.' +
    '|adnxs|adsrvr|adform|criteo|pubmatic|rubiconproject|openx|smartadserver|yieldmo|zedo' +
    '|cpmstar|media\\.net|taboola|outbrain|revcontent|mgid|adsterra|hilltopads|propellerads' +
    '|popads|popcash|popunder|adcash|exoclick|exosrv|juicyads|trafficjunky|clickadu' +
    '|bidvertiser|adspyglass|onclckpjs|pos\\.baidu|cpro\\.baidu|gdt\\.qq|mediav|union\\.360)' +
    '|/(ads?|adv|adserver|banners?|popunder)[/.?_-]', 'i');

  /* ------------------------- 存储（按域名） ------------------------- */
  function load() {
    try {
      const rules = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(rules) ? rules.filter(rule => typeof rule === 'string') : [];
    } catch (e) {
      return [];
    }
  }
  function save(rules) {
    try {
      localStorage.setItem(KEY, JSON.stringify(rules));
    } catch (e) {}
  }

  /* --------------------- 注入隐藏用的 <style> --------------------- */
  // 用 CSS 持续隐藏：只要选择器匹配，元素何时出现都会被隐藏。
  const styleEl = document.createElement('style');
  styleEl.id = '__hdi_style';
  (document.head || document.documentElement).appendChild(styleEl);

  function flagOn(key) {
    try { return localStorage.getItem(key) == null; } catch (e) { return true; }
  }
  function setFlag(key, on) {
    try {
      if (on) localStorage.removeItem(key);
      else localStorage.setItem(key, '1');
    } catch (e) {}
  }

  // 当前生效的合法选择器；JS 兜底扫描复用它，省得再解析一遍
  let activeSelectors = [];
  // 扫描状态要在 apply() 之前声明：apply() 在顶层同步跑，晚声明会踩 TDZ
  const handled = new WeakSet();
  let scanQueued = false;
  let lastScan = 0;
  const probe = document.createDocumentFragment();
  function validSelector(sel) {
    try { probe.querySelector(sel); return true; } catch (e) { return false; }
  }

  function apply() {
    const manual = load();
    // 自动广告规则 + 手动规则一起注入；每条单独成规则，某条写坏也不影响其它条
    const all = (flagOn(AD_KEY) ? BUILTIN_AD_RULES : []).concat(manual);
    // 一律限定在 body 内：我们自己的 UI 挂在 <html> 下、不在 body 里，
    // 这样再激进的广告规则也绝不会误伤工具条和提示条
    activeSelectors = all.filter(validSelector).map((sel) => 'body ' + sel);
    styleEl.textContent = activeSelectors
      .map((sel) => `${sel}{display:none !important;visibility:hidden !important;}`)
      .join('\n');
    queueScan(true);
  }
  apply();

  // 有些 SPA 会清空 <head>，这里保证我们的 style 一直在
  new MutationObserver(() => {
    if (!styleEl.isConnected) {
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (root.dataset.mounted && !root.isConnected) document.documentElement.appendChild(root);
    queueScan();
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* --------------------- 生成稳定的 CSS 选择器 --------------------- */
  function safeQ(sel, root) {
    try {
      return Array.from((root || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  // 判断一个 class/id 是否"像随机生成的"（不稳定，不该用来当选择器）
  function isRandomLike(token) {
    if (!token) return true;
    if (token.length > 40) return true;
    if (/^(css-|sc-[a-z]|jsx-|emotion-|Mui.*-)/i.test(token)) return true; // css-in-js
    if (/[a-z0-9]{8,}/i.test(token) && /\d/.test(token) && /[a-f]/i.test(token)) return true; // 长 hash
    if (/^\d+$/.test(token)) return true; // 纯数字
    if (/^[a-z0-9]{7,}$/i.test(token) && !/[aeiou]/i.test(token)) return true; // 无元音的乱码
    return false;
  }

  function segmentFor(el) {
    const tag = el.tagName.toLowerCase();
    const good = Array.from(el.classList)
      .filter((c) => !isRandomLike(c))
      .slice(0, 3);
    return good.length ? tag + '.' + good.map((c) => cssEscape(c)).join('.') : tag;
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return null;

    // 优先：稳定且唯一的 id
    if (el.id && !isRandomLike(el.id)) {
      const s = '#' + cssEscape(el.id);
      if (safeQ(s).length === 1) return s;
    }

    const path = [];
    let cur = el;
    let depth = 0;

    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && depth < 8) {
      // 遇到稳定唯一的 id，用它作锚点收尾
      if (cur.id && !isRandomLike(cur.id)) {
        const idSeg = '#' + cssEscape(cur.id);
        if (safeQ(idSeg).length === 1) {
          path.unshift(idSeg);
          return path.join(' > ');
        }
      }

      let seg = segmentFor(cur);

      // 在父级范围内如果不唯一，补 nth-of-type 消歧
      const parent = cur.parentElement;
      if (parent) {
        if (safeQ(':scope > ' + seg, parent).length > 1) {
          const sibs = Array.from(parent.children).filter(
            (c) => c.tagName === cur.tagName
          );
          seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
        }
      }
      path.unshift(seg);

      const full = path.join(' > ');
      if (safeQ(full).length === 1) return full;

      cur = parent;
      depth++;
    }
    return path.join(' > ');
  }

  // 纯结构路径：不依赖 class/id，任何元素都能生成（代价是页面结构一变就失效）
  function pathSelector(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 12) {
      const parent = cur.parentElement;
      if (!parent) return '';
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(cur) + 1) + ')');
      cur = parent;
    }
    return parts.length ? 'body > ' + parts.join(' > ') : '';
  }

  // 生成后必须能反查到同一个元素，否则规则存了也白存（点了"隐藏"却没反应的元凶之一）
  function selectorFor(el) {
    let smart = null;
    try { smart = buildSelector(el); } catch (e) { smart = null; }
    if (smart && safeQ(smart).includes(el)) return smart;
    let path = '';
    try { path = pathSelector(el); } catch (e) { path = ''; }
    return path && safeQ(path).includes(el) ? path : null;
  }

  /* ------------------------------ UI ------------------------------ */
  const root = document.createElement('div');
  root.id = '__hdi_root';
  root.innerHTML = `
    <style>
      #__hdi_root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;
        font:14px/1.4 -apple-system,system-ui,sans-serif;color:#111;}
      #__hdi_root *{box-sizing:border-box;}
      /* 点选模式：让指针事件落到顶层文档，这样 iframe 广告也能被选中 */
      html.__hdi_pick iframe,html.__hdi_pick embed,html.__hdi_pick object,
      html.__hdi_pick video{pointer-events:none !important;}
      #__hdi_toast{pointer-events:none;position:fixed;left:50%;transform:translateX(-50%);
        bottom:calc(152px + env(safe-area-inset-bottom));display:none;max-width:82vw;
        background:rgba(28,28,30,.95);color:#fff;font-size:13px;line-height:1.35;
        padding:9px 14px;border-radius:12px;text-align:center;}
      #__hdi_box{position:fixed;pointer-events:none;border:2px solid #ff3b30;
        background:rgba(255,59,48,.12);border-radius:4px;display:none;z-index:2147483645;}
      #__hdi_bar{pointer-events:auto;position:fixed;left:50%;transform:translateX(-50%);
        bottom:calc(84px + env(safe-area-inset-bottom));display:none;gap:8px;
        background:rgba(28,28,30,.96);padding:10px 12px;border-radius:14px;
        box-shadow:0 6px 20px rgba(0,0,0,.4);align-items:center;max-width:92vw;flex-wrap:wrap;}
      /* 标签独占一行，三个按钮各自够大：iOS 上挤在一起很容易点到缝隙 */
      #__hdi_bar .lbl{flex:1 0 100%;color:#fff;font-size:12px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;opacity:.85;text-align:center;}
      #__hdi_bar button{pointer-events:auto;border:0;border-radius:9px;padding:10px 8px;
        min-height:44px;font-size:14px;font-weight:600;white-space:nowrap;
        touch-action:manipulation;flex:1 1 0;}
      #__hdi_bar button:disabled{opacity:.3;}
      .hdi-up,.hdi-down{background:#3a3a3c;color:#fff;} .hdi-hide{background:#ff3b30;color:#fff;}
      .hdi-cancel{background:#48484a;color:#fff;}
      #__hdi_panel{pointer-events:auto;position:fixed;inset:auto 12px calc(24px + env(safe-area-inset-bottom)) 12px;
        max-height:76vh;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.35);
        display:none;flex-direction:column;overflow:hidden;}
      #__hdi_panel h3{margin:0;padding:14px 16px;font-size:15px;border-bottom:1px solid #eee;
        display:flex;justify-content:space-between;align-items:center;}
      #__hdi_panel h3 span{color:#8e8e93;font-weight:400;font-size:12px;}
      #__hdi_list{overflow:auto;padding:4px 0;flex:1;}
      #__hdi_list .row{display:flex;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid #f2f2f2;}
      #__hdi_list code{flex:1;font-size:11px;color:#333;word-break:break-all;
        font-family:ui-monospace,Menlo,monospace;}
      #__hdi_list .del{border:0;background:#ff3b30;color:#fff;border-radius:8px;padding:6px 10px;font-size:12px;}
      #__hdi_list .empty{padding:24px 16px;text-align:center;color:#8e8e93;}
      #__hdi_panel .foot{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee;}
      #__hdi_panel .foot button{flex:1;border:0;border-radius:10px;padding:11px;font-size:14px;font-weight:600;}
      .hdi-clear{background:#ffefef;color:#ff3b30;} .hdi-close{background:#0a84ff;color:#fff;}
      #__hdi_panel .adrow{display:flex;align-items:center;justify-content:space-between;gap:10px;
        flex:0 0 auto;padding:12px 16px;border-bottom:1px solid #eee;font-size:14px;color:#111;}
      #__hdi_panel .adrow .sub{display:block;font-size:11px;color:#8e8e93;margin-top:2px;}
      .hdi-switch{position:relative;display:inline-block;width:46px;height:28px;flex:0 0 auto;}
      .hdi-switch input{opacity:0;width:0;height:0;}
      .hdi-switch i{position:absolute;inset:0;background:#c7c7cc;border-radius:999px;transition:.2s;}
      .hdi-switch i::before{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;
        background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3);}
      .hdi-switch input:checked + i{background:#34c759;}
      .hdi-switch input:checked + i::before{transform:translateX(18px);}
    </style>
    <div id="__hdi_box"></div>
    <div id="__hdi_toast" role="status" aria-live="polite"></div>
    <div id="__hdi_bar">
      <span class="lbl"></span>
      <button type="button" class="hdi-up">⬆︎ 上层</button>
      <button type="button" class="hdi-down">⬇︎ 下层</button>
      <button type="button" class="hdi-hide">隐藏 ✓</button>
      <button type="button" class="hdi-cancel">取消 ✕</button>
    </div>
    <div id="__hdi_panel" role="dialog" aria-label="广告过滤与已隐藏项">
      <h3>广告过滤 v${VERSION} <span></span></h3>
      <div class="adrow">
        <div>自动广告过滤<span class="sub">内置规则 + 广告域名识别，自动隐藏广告位</span></div>
        <label class="hdi-switch"><input type="checkbox" class="hdi-flag" data-flag="ad" aria-label="自动广告过滤"><i></i></label>
      </div>
      <div class="adrow">
        <div>拦截弹窗跳转<span class="sub">挡住点击空白处就自动弹出的新窗口</span></div>
        <label class="hdi-switch"><input type="checkbox" class="hdi-flag" data-flag="pop" aria-label="拦截弹窗跳转"><i></i></label>
      </div>
      <div class="adrow">
        <div>清除全屏遮罩<span class="sub">移除盖住整页、点哪都跳转的透明层</span></div>
        <label class="hdi-switch"><input type="checkbox" class="hdi-flag" data-flag="mask" aria-label="清除全屏遮罩"><i></i></label>
      </div>
      <div id="__hdi_list"></div>
      <div class="foot">
        <button type="button" class="hdi-clear">清空本站</button>
        <button type="button" class="hdi-close">关闭</button>
      </div>
    </div>`;

  function mountUI() {
    if (document.getElementById(root.id)) return;
    document.documentElement.appendChild(root);
    root.dataset.mounted = 'true';
    bindUI();
  }
  if (isTop) {
    if (document.body) mountUI();
    else document.addEventListener('DOMContentLoaded', mountUI, { once: true });
  }

  // 页面上难免有 `div{display:none!important}` 一类的粗暴规则，我们自己的 UI 用行内
  // !important 显隐，谁也压不掉
  function show(el, mode) {
    if (el) el.style.setProperty('display', mode, 'important');
  }
  function hide(el) {
    if (el) el.style.setProperty('display', 'none', 'important');
  }

  let toastTimer = 0;
  let lastAction = ''; // 诊断面板里回放最近一次操作，方便排查
  let forcedCount = 0;
  const nativeAlert = window.alert; // document-start 时拿到的还是原生实现

  function toast(msg) {
    lastAction = msg;
    const el = root.querySelector('#__hdi_toast');
    if (!el || !root.isConnected) return;
    el.textContent = msg;
    show(el, 'block');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hide(el), 2200);
  }

  function diagnosticText() {
    const manual = load();
    return [
      '隐藏干扰项 Pro  v' + VERSION,
      '页面：' + (location.hostname || '(空)') + (isTop ? '（顶层）' : '（子框架）'),
      '',
      '内置广告规则：' + BUILTIN_AD_RULES.length + ' 条',
      '本站手动规则：' + manual.length + ' 条',
      '本页已强制隐藏：' + forcedCount + ' 个元素',
      '原生 CSS.escape：' + (nativeCssEscape ? '已抓到' : '未抓到，用兜底实现') +
        (window.CSS && typeof window.CSS.escape === 'function' ? '' : '（页面已覆盖 window.CSS）'),
      '',
      '自动广告过滤：' + (flagOn(AD_KEY) ? '开' : '关'),
      '拦截弹窗跳转：' + (flagOn(POP_KEY) ? '开' : '关'),
      '清除全屏遮罩：' + (flagOn(MASK_KEY) ? '开' : '关'),
      '',
      '最近一次操作：' + (lastAction || '（本页还没有操作）'),
    ].join('\n');
  }

  /* ------------------ JS 兜底：压过行内 !important + 启发式识别 ------------------
   * 只靠 <style> 有两个盖不住的情况：
   *   1. 元素自带 style="display:block !important"，行内优先级更高，我们的规则会输；
   *   2. 广告域名千奇百怪，CSS 选择器列不全。
   * 所以这里再扫一遍 DOM，直接往命中元素写行内样式。 */
  function forceHide(el) {
    if (!el || el.nodeType !== 1) return;
    try {
      // 记下原来的行内 display，"恢复"时才还得回去
      if (!el.hasAttribute('data-hdi-hidden')) {
        el.setAttribute('data-hdi-hidden', el.style.getPropertyValue('display') || '');
      }
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      forcedCount++;
    } catch (e) {}
    handled.add(el);
  }

  // 元素到底藏没藏住：display / visibility / opacity 任何一路生效都算藏住了
  function stillVisible(el) {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
  }

  // 撤销所有行内强制隐藏；调用后再 apply()，仍然该藏的会被重新藏起来
  function unhideAll() {
    for (const el of safeQ('[data-hdi-hidden]')) {
      const prev = el.getAttribute('data-hdi-hidden');
      el.style.removeProperty('visibility');
      if (prev) el.style.setProperty('display', prev);
      else el.style.removeProperty('display');
      el.removeAttribute('data-hdi-hidden');
      handled.delete(el);
    }
  }

  function isOurs(el) {
    return !el || el === root || root.contains(el) || !!(el.closest && el.closest('#__safari_tools_dock__'));
  }

  // 广告外面常包着一层空壳容器，一起收掉，免得原地留一块空白
  function adShell(el) {
    let node = el;
    for (let i = 0; i < 3; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (parent.textContent.trim()) break;
      const others = Array.from(parent.children).filter((c) => c !== node && c.getClientRects().length);
      if (others.length) break;
      node = parent;
    }
    return node;
  }

  // 全屏透明遮罩（点哪儿都跳转的劫持层）一定盖在视口中心的最上层，从这一点反查最省事
  function killMask() {
    if (!isTop || !flagOn(MASK_KEY) || !document.body) return; // 子框架里"全屏"就是广告本身，不适用
    if (document.readyState === 'loading') return; // 页面还没渲染完，别把空壳当遮罩
    const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    if (!el || handled.has(el) || el === document.body || el === document.documentElement) return;
    if (isOurs(el)) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
    const rect = el.getBoundingClientRect();
    if (rect.width < innerWidth * 0.85 || rect.height < innerHeight * 0.85) return;
    if ((el.innerText || '').trim().length > 12) return;          // 有文字的多半是正经弹窗
    if (el.querySelector('input,textarea,select,video')) return;  // 有交互内容的不动
    if (el.querySelectorAll('*').length > 20) return;             // 结构复杂 → 更像页面容器，不是遮罩
    const parts = (cs.backgroundColor.match(/^rgba?\(([^)]+)\)/) || [, ''])[1].split(',');
    const alpha = parts.length > 3 ? parseFloat(parts[3]) : (parts.length === 3 ? 1 : 0);
    if (alpha > 0.5 && el.children.length) return;                // 不透明又有内容 → 可能是正经弹层
    forceHide(el);
    // 遮罩常顺手锁掉滚动，一并解开
    if (getComputedStyle(document.body).overflow === 'hidden') {
      document.body.style.setProperty('overflow', 'auto', 'important');
      document.documentElement.style.setProperty('overflow', 'auto', 'important');
    }
  }

  function scan() {
    scanQueued = false;
    lastScan = Date.now();
    if (!document.body) return;
    if (activeSelectors.length) {
      let hits = [];
      try { hits = Array.from(document.querySelectorAll(activeSelectors.join(','))); } catch (e) {}
      for (const el of hits) {
        if (isOurs(el)) continue;
        if (getComputedStyle(el).display === 'none') { handled.add(el); continue; }
        // 我们明明标记过它却又冒出来 → 站点脚本在还原样式，直接摘掉节点
        if (el.hasAttribute('data-hdi-hidden')) { try { el.remove(); } catch (e) {} continue; }
        if (handled.has(el)) continue;
        forceHide(el);
      }
    }
    if (flagOn(AD_KEY)) {
      for (const el of safeQ('iframe,embed,object')) {
        if (handled.has(el) || isOurs(el)) continue;
        const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (src && AD_URL_RE.test(src)) forceHide(adShell(el));
      }
    }
    killMask();
  }

  function queueScan(now) {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => requestAnimationFrame(scan), now ? 0 : Math.max(0, 400 - (Date.now() - lastScan)));
  }
  // 有些广告是延迟注入的，DOM 变动之外再定期补一刀（子框架降频，页面上可能有很多个）
  setInterval(() => queueScan(), isTop ? 3000 : 6000);

  /* ---------------------- 弹窗 / popunder 拦截 ----------------------
   * 只放行「用户确实点了链接或按钮」之后 1.2 秒内的第一次 window.open，
   * 点空白处冒出来的新窗口一律挡掉。 */
  let lastGesture = 0;
  let gestureOnLink = false;
  let openedSinceGesture = 0;
  ['pointerdown', 'touchstart', 'keydown'].forEach((type) =>
    document.addEventListener(type, (e) => {
      lastGesture = Date.now();
      openedSinceGesture = 0;
      const target = e.target;
      // 点在用户脚本自己的界面（悬浮球、阅读模式等）上不算"点了网页的链接"：这些按钮从不开新窗口，
      // 却常被 popunder 脚本借作放行的由头
      gestureOnLink = !!(target && target.closest && !isOurs(target) && !target.closest('#__rd_reader,#__rd_toast') &&
        target.closest('a[href],button,[role="button"],input,summary'));
    }, true));

  const nativeOpen = window.open;
  function stubWindow() {
    const stub = { closed: true, close() {}, focus() {}, blur() {}, postMessage() {},
      document: { write() {}, writeln() {}, close() {}, open() {} }, location: { href: '', replace() {}, assign() {} } };
    return stub;
  }
  try {
    window.open = function (...args) {
      if (flagOn(POP_KEY)) {
        const fresh = Date.now() - lastGesture < 1200;
        // 子框架基本都是广告位，里面弹出来的窗口一律不放行
        if (!isTop || !fresh || !gestureOnLink || openedSinceGesture >= 1) {
          toast('已拦截自动弹窗');
          return stubWindow();
        }
        openedSinceGesture++;
      }
      return nativeOpen.apply(window, args);
    };
  } catch (e) {}

  /* --------------------------- 回顶部 / 到底部 ---------------------------
   * 这两个箭头是本脚本自己的功能：只是借共享入口主图标上下的插槽摆放，滚动逻辑全在这里，
   * 视频助手不需要知道它们的存在；以后要加别的小圆钮，也只改本脚本。 */

  // 页面真正在滚的不一定是 window：不少站点把正文放进自己的 overflow 容器里，window 本身根本不动。
  // 从可视区中部往上找最近的可滚动祖先，找到就连它一起滚；文档本身总是会滚。
  function scrollContainers() {
    const viewport = window.visualViewport;
    const x = viewport ? viewport.offsetLeft + viewport.width / 2 : innerWidth / 2;
    const baseY = viewport ? viewport.offsetTop : 0;
    const height = viewport ? viewport.height : innerHeight;
    const list = [];
    for (const ratio of [0.5, 0.8]) {
      let node = null;
      try { node = document.elementFromPoint(x, baseY + height * ratio); } catch (e) {}
      for (; node && node !== document.documentElement && !isOurs(node); node = node.parentElement) {
        if (list.includes(node)) break;
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll|overlay/.test(getComputedStyle(node).overflowY)) {
          list.push(node);
          break;
        }
      }
    }
    list.push(document.scrollingElement || document.documentElement);
    return list;
  }

  function jumpTo(edge) {
    for (const node of scrollContainers()) {
      const top = edge === 'top' ? 0 : node.scrollHeight;
      try { node.scrollTo({ top, behavior: 'smooth' }); } catch (e) { node.scrollTop = top; }
    }
  }

  function jumpButton(id, label, path, edge) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg></span>';
    button.addEventListener('click', () => jumpTo(edge));
    return button;
  }

  /* --------------------------- 交互逻辑 --------------------------- */
  let selectMode = false;
  let currentEl = null;

  function bindUI() {
    const tools = sharedToolsDock();
    const selectEntry = document.createElement('button');
    selectEntry.id = 'hide-picker';
    selectEntry.type = 'button';
    selectEntry.textContent = '点选隐藏';
    const managerEntry = document.createElement('button');
    managerEntry.id = 'hide-manager';
    managerEntry.type = 'button';
    managerEntry.textContent = '广告过滤 · v' + VERSION; // 打开菜单就能确认装的是哪一版
    managerEntry.setAttribute('aria-expanded', 'false');
    const diagEntry = document.createElement('button');
    diagEntry.id = 'hide-diagnostics';
    diagEntry.type = 'button';
    diagEntry.textContent = '诊断信息';
    // 用原生 alert：不依赖我们的任何 DOM 和 CSS，页面再怎么折腾也挡不住
    diagEntry.addEventListener('click', () => {
      try { nativeAlert.call(window, diagnosticText()); } catch (e) {}
    });
    tools.getElementById('tool-actions').append(selectEntry, managerEntry, diagEntry);
    // 上下箭头挂进共享入口预留的插槽；入口若是没有插槽的旧版本就静默跳过，不影响其它功能
    const before = tools.getElementById('before');
    const after = tools.getElementById('after');
    if (before && after) {
      before.append(jumpButton('hide-scroll-top', '回到页面顶部', 'M12 19V5M5 12l7-7 7 7', 'top'));
      after.prepend(jumpButton('hide-scroll-bottom', '跳到页面底部', 'M12 5v14M5 12l7 7 7-7', 'bottom')); // 固定紧贴主图标，其它脚本的小圆钮排在它下面
    }
    const box = root.querySelector('#__hdi_box');
    const bar = root.querySelector('#__hdi_bar');
    const lbl = bar.querySelector('.lbl');

    // 轻点统一入口打开菜单；直接拖动移动，不再与长按管理面板冲突。
    selectEntry.addEventListener('click', toggleSelect);
    managerEntry.addEventListener('click', openPanel);
    function toggleSelect() {
      selectMode = !selectMode;
      selectEntry.dataset.active = String(selectMode);
      selectEntry.textContent = selectMode ? '退出点选隐藏' : '点选隐藏';
      document.documentElement.classList.toggle('__hdi_pick', selectMode);
      if (selectMode) toast('轻点任意区域选中它，再按「隐藏」');
      else clearSel();
      tools.host.dispatchEvent(new Event('safari-tools-update'));
    }

    /* 选择模式下的取点
     * 只监听 click 是不够的：iOS Safari 对纯 div 的轻点根本不派发 click，
     * iframe 里的点击也传不到顶层文档 —— 这正是"点了没反应"的原因。
     * 改成按下记坐标、抬起时判位移：轻点=选中，滑动=正常翻页。 */
    let start = null;
    function fromTool(e) {
      const path = e.composedPath ? e.composedPath() : [];
      return path.some((node) => node === root || node === tools.host ||
        (node && node.id === '__safari_video_links__'));
    }
    function onProbe(e) {
      if (!selectMode || fromTool(e)) return;
      const type = e.type;
      if (type === 'pointerdown' || type === 'touchstart') {
        const p = e.touches ? e.touches[0] : e;
        start = p ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
        e.stopImmediatePropagation(); // 不 preventDefault，页面照样能滚
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'pointercancel' || type === 'touchcancel') { start = null; return; }
      if (type !== 'pointerup' && type !== 'touchend') return;
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const from = start;
      start = null;
      if (!from || !p) return;
      if (Math.hypot(p.clientX - from.x, p.clientY - from.y) > 12) return; // 在滑动
      if (Date.now() - from.t > 900) return;                               // 长按
      const el = elementAtPoint(p.clientX, p.clientY);
      anchor = { x: p.clientX, y: p.clientY }; // 记住落点，"下层"往里钻时按它挑子元素
      if (el) pick(el);
      else toast('这里没有可选中的元素');
    }
    ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel',
      'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu'].forEach((type) =>
      document.addEventListener(type, onProbe, { capture: true, passive: false }));

    // 点选模式下 iframe 的 pointer-events 被临时关掉了，命中它时要把 iframe 本身找回来
    function elementAtPoint(x, y) {
      let frame = null;
      for (const f of safeQ('iframe,embed,object,video')) {
        const r = f.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        frame = f; // DOM 里靠后的通常压在上层
      }
      const stack = (document.elementsFromPoint
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)]).filter((n) => n && n.nodeType === 1 && !isOurs(n));
      const top = stack[0] || null;
      if (frame && (!top || top.contains(frame))) return frame;
      return top;
    }

    // 记下往上走过的路径，"下层"按钮据此原路返回；轻点新元素时重置
    let pickStack = [];
    let anchor = null;

    function pick(el, keepStack) {
      if (!el || /^(HTML|BODY)$/.test(el.tagName)) return;
      currentEl = el;
      if (!keepStack) pickStack = [];
      highlight(el);
      lbl.textContent = describe(el);
      show(bar, 'flex');
      syncNav();
    }

    // 没有可回退的路径时，按最初轻点的坐标往里钻；坐标没命中就挑面积最大的子元素
    function childAt(el) {
      const kids = Array.from(el.children).filter((c) => !isOurs(c) && c.getClientRects().length);
      if (!kids.length) return null;
      if (anchor) {
        const hit = kids.find((c) => {
          const r = c.getBoundingClientRect();
          return anchor.x >= r.left && anchor.x <= r.right && anchor.y >= r.top && anchor.y <= r.bottom;
        });
        if (hit) return hit;
      }
      return kids.reduce((best, c) => {
        const r = c.getBoundingClientRect();
        const b = best.getBoundingClientRect();
        return r.width * r.height > b.width * b.height ? c : best;
      }, kids[0]);
    }

    function syncNav() {
      const parent = currentEl && currentEl.parentElement;
      bar.querySelector('.hdi-up').disabled = !(parent && !/^(BODY|HTML)$/.test(parent.tagName));
      bar.querySelector('.hdi-down').disabled = !currentEl || (!pickStack.length && !childAt(currentEl));
    }
    function highlight(el) {
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        left: r.left + 'px',
        top: r.top + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
      show(box, 'block');
    }
    function describe(el) {
      const cls = Array.from(el.classList).slice(0, 2).join('.');
      const r = el.getBoundingClientRect();
      // 带上尺寸，一眼能看出选中范围是不是选过头了
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') +
        ' · ' + Math.round(r.width) + '×' + Math.round(r.height);
    }
    function clearSel() {
      currentEl = null;
      pickStack = [];
      Array.from(bar.querySelectorAll('button')).forEach((b) => { b.disabled = false; });
      hide(box);
      hide(bar);
    }

    bar.querySelector('.hdi-up').addEventListener('click', (e) => {
      e.preventDefault();
      const parent = currentEl && currentEl.parentElement;
      if (!parent || /^(BODY|HTML)$/.test(parent.tagName)) return;
      pickStack.push(currentEl);
      pick(parent, true);
    });
    bar.querySelector('.hdi-down').addEventListener('click', (e) => {
      e.preventDefault();
      if (!currentEl) return;
      // 上层点过头了就原路退回；没走过路径就按点击坐标往里钻
      const back = pickStack.pop();
      const next = back && back.isConnected ? back : childAt(currentEl);
      if (next) pick(next, true);
    });
    bar.querySelector('.hdi-cancel').addEventListener('click', (e) => {
      e.preventDefault();
      clearSel();
    });
    bar.querySelector('.hdi-hide').addEventListener('click', (e) => {
      e.preventDefault();
      if (!currentEl) { toast('还没选中任何元素'); return; }
      const el = currentEl;
      // 先把元素藏掉（行内 !important，压过站点自己的行内样式），再生成/保存规则：
      // 规则那一步万一出错，至少眼前这块广告已经没了，而不是像 1.4.1 那样整个点击静默失败
      forceHide(el);
      hide(box);
      let sel = null;
      try {
        sel = selectorFor(el);
        if (sel) {
          const rules = load();
          if (!rules.includes(sel)) {
            rules.push(sel);
            save(rules);
            apply();
          }
        }
      } catch (err) {
        sel = null;
      }
      /* 结果同时写进工具条标签：你的视线本来就在这里，不依赖提示条能不能显示出来。
       * 递进兜底：这类站点的广告脚本常会盯着自己的元素、把样式改回去，
       * 所以隐藏后复查一次，压不住就直接把节点摘掉，并如实告诉用户结果。 */
      Array.from(bar.querySelectorAll('button')).forEach((b) => { b.disabled = true; });
      const report = (msg) => {
        lbl.textContent = msg;
        toast(msg);
        setTimeout(clearSel, 1500);
      };
      setTimeout(() => {
        if (!stillVisible(el)) {
          report(sel ? '✓ 已隐藏，本站下次自动生效' : '✓ 已隐藏（未能生成规则，刷新会重现）');
          return;
        }
        try { el.remove(); } catch (err) {}
        if (stillVisible(el)) report('⚠️ 这块内容隐藏不掉，可能来自 iframe 内部');
        else report(sel ? '✓ 已移除该元素，本站下次自动隐藏' : '✓ 已移除该元素（未能生成规则）');
      }, 80);
    });

    /* 管理面板 */
    const panel = root.querySelector('#__hdi_panel');
    const list = root.querySelector('#__hdi_list');
    const count = panel.querySelector('h3 span');
    const flagChks = Array.from(panel.querySelectorAll('.hdi-flag'));

    flagChks.forEach((chk) => {
      chk.addEventListener('change', () => {
        setFlag(FLAG_KEYS[chk.dataset.flag], chk.checked);
        unhideAll(); // 关掉开关要能立刻放出误伤的元素
        apply();
        toast(chk.checked ? '已开启' : '已关闭，刷新页面即可全部恢复');
      });
    });

    window.__hdi_openPanel = openPanel; // 方便调试
    function openPanel() {
      if (selectMode) toggleSelect();
      flagChks.forEach((chk) => { chk.checked = flagOn(FLAG_KEYS[chk.dataset.flag]); }); // 每次打开同步开关状态
      renderList();
      show(panel, 'flex');
      managerEntry.dataset.panelOpen = 'true';
      managerEntry.setAttribute('aria-expanded', 'true');
      tools.host.dispatchEvent(new Event('safari-tools-update'));
      panel.querySelector('.hdi-close').focus({ preventScroll: true });
    }
    function closePanel() {
      hide(panel);
      managerEntry.dataset.panelOpen = 'false';
      managerEntry.setAttribute('aria-expanded', 'false');
      tools.host.dispatchEvent(new Event('safari-tools-update'));
      tools.getElementById('launcher').focus({ preventScroll: true });
    }
    function renderList() {
      const rules = load();
      count.textContent = location.hostname + ' · 手动 ' + rules.length + ' 条';
      if (!rules.length) {
        list.innerHTML = '<div class="empty">广告已在自动过滤<br>漏网的可用「点选隐藏」手动点掉</div>';
        return;
      }
      list.innerHTML = '';
      rules.forEach((sel, i) => {
        const row = document.createElement('div');
        row.className = 'row';
        const c = document.createElement('code');
        c.textContent = sel;
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '恢复';
        del.addEventListener('click', () => {
          const r = load();
          r.splice(i, 1);
          save(r);
          unhideAll(); // 清掉行内强制隐藏，否则删了规则元素也回不来
          apply();
          renderList();
        });
        row.append(c, del);
        list.appendChild(row);
      });
    }
    panel.querySelector('.hdi-clear').addEventListener('click', () => {
      if (confirm('清空本站所有隐藏规则？')) {
        save([]);
        unhideAll();
        apply();
        renderList();
      }
    });
    panel.querySelector('.hdi-close').addEventListener('click', closePanel);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (selectMode) toggleSelect();
      if (panel.style.display === 'flex') closePanel();
    });
    const refreshHighlight = () => {
      if (!currentEl) return;
      if (currentEl.isConnected) highlight(currentEl);
      else clearSel();
    };
    document.addEventListener('scroll', refreshHighlight, { capture: true, passive: true });
    window.addEventListener('resize', refreshHighlight, { passive: true });
    queueScan(true);
  }
})();

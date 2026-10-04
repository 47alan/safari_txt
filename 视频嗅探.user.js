// ==UserScript==
// @name         视频嗅探
// @namespace    safari-video-links
// @version      1.3.0
// @updateURL    https://raw.githubusercontent.com/47alan/safari_txt/main/%E8%A7%86%E9%A2%91%E5%97%85%E6%8E%A2.user.js
// @downloadURL  https://raw.githubusercontent.com/47alan/safari_txt/main/%E8%A7%86%E9%A2%91%E5%97%85%E6%8E%A2.user.js
// @description  嗅探网页里已加载的视频链接，支持名称/时长及广告筛选。嗅探到视频只点亮悬浮球下方的 ▶ 小圆钮（带数量角标），面板绝不自动弹出，点小圆钮或菜单项才打开；无视频时自动隐藏，与广告过滤等脚本共用悬浮球。适配 iPhone/iPad Safari Userscripts。
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

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

  const ROOT_ID = '__safari_video_links__';
  const STORAGE_KEY = '__safari_video_links_settings_v1__';
  const DEFAULT_SETTINGS = {
    maxResults: 20,
    minDuration: 60,
    hideUnknown: false,
    filterAds: true,
    sortOrder: 'discovery',
    excludeKeywords: ''
  };
  const MAX_RECORDS = 1000;
  const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'adnxs.com', 'adsrvr.org', 'amazon-adsystem.com', '2mdn.net'];
  const AD_TOKEN = /(?:^|[\s/_.-])(?:ads?|advertisement|advertising|preroll|midroll|postroll|vast|vpaid|sponsored|adsbygoogle)(?:$|[\s/_.-])/i;
  const MEDIA_PATH = /\.(mp4|m4v|mov|webm|ogv|mkv|flv|m3u8|mpd)$/i;
  const SEGMENT_PATH = /\.(ts|m4s|cmfv|cmfa|aac|vtt|srt|key)$/i;
  const records = new Map();
  const ignoredUrls = new Set();
  const internalRequests = new Set();
  const watchedVideos = new WeakSet();
  const watchedFrames = new WeakSet();
  const unreadableFrames = new WeakSet();
  const parsedStructuredData = new WeakMap();
  const rootObservers = new Map();
  let settings = loadSettings();
  let pageUrl = location.href;
  let resourceFloor = 0;
  let generation = 0;
  let sequence = 0;
  let host;
  let shadow;
  let tools;
  let videoEntry;
  let collectingDom = false;
  let domMediaPresent = false;
  let hadDomMedia = false;
  let panelOpen = false;
  let readyBadge = null; // 悬浮球下方的 ▶ 小圆钮：嗅探到视频就点亮，只作提示
  let scanTimer;
  let renderTimer;
  let toastTimer;
  let probeController;
  let probeProgress = '';
  let listSignature = '';
  let visibleRecords = [];
  let scanInfo = { blobs: 0, frames: 0 };

  function boundedNumber(value, fallback, minimum, maximum) {
    const parsed = typeof value === 'number' || typeof value === 'string' && value.trim() !== ''
      ? Number(value) : NaN;
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
  }

  function cleanSettings(value) {
    const saved = value && typeof value === 'object' ? value : {};
    return {
      maxResults: boundedNumber(saved.maxResults, DEFAULT_SETTINGS.maxResults, 1, 200),
      minDuration: boundedNumber(saved.minDuration, DEFAULT_SETTINGS.minDuration, 0, 86400),
      hideUnknown: typeof saved.hideUnknown === 'boolean' ? saved.hideUnknown : DEFAULT_SETTINGS.hideUnknown,
      filterAds: typeof saved.filterAds === 'boolean' ? saved.filterAds : DEFAULT_SETTINGS.filterAds,
      sortOrder: ['longest', 'discovery'].includes(saved.sortOrder) ? saved.sortOrder : DEFAULT_SETTINGS.sortOrder,
      excludeKeywords: (typeof saved.excludeKeywords === 'string' ? saved.excludeKeywords : DEFAULT_SETTINGS.excludeKeywords).slice(0, 2000)
    };
  }

  function loadSettings() {
    try {
      return cleanSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch (error) {
      return cleanSettings(null);
    }
  }

  function tidyText(value, limit = 180) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  }

  function durationSeconds(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const text = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return durationSeconds(Number(text));
    const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (iso) return durationSeconds(Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0));
    if (/^\d{1,5}:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?$/.test(text)) {
      return durationSeconds(text.split(':').reduce((total, part) => total * 60 + Number(part), 0));
    }
    const chinese = text.match(/^(?:(\d+(?:\.\d+)?)\s*(?:小时|时))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分))?\s*(?:(\d+(?:\.\d+)?)\s*(?:秒钟|秒))?$/);
    return chinese ? durationSeconds(Number(chinese[1] || 0) * 3600 + Number(chinese[2] || 0) * 60 + Number(chinese[3] || 0)) : null;
  }

  function formatDuration(value) {
    if (!Number.isFinite(value) || value <= 0) return '时长未知';
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  function normalizeUrl(value, base = document.baseURI) {
    if (typeof value !== 'string' || !value.trim() || value.length > 16000) return null;
    try {
      const url = new URL(value.trim(), base);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  function mediaKind(url, mime = '', explicit = false) {
    const parsed = new URL(url);
    if (SEGMENT_PATH.test(parsed.pathname)) return null;
    const match = parsed.pathname.match(MEDIA_PATH);
    if (match) return match[1].toLowerCase();
    const hint = `${mime} ${parsed.searchParams.get('format') || ''} ${parsed.searchParams.get('mime') || ''} ${parsed.searchParams.get('type') || ''}`.toLowerCase();
    if (/mpegurl|\bm3u8\b/.test(hint)) return 'm3u8';
    if (/dash\+xml|\bmpd\b/.test(hint)) return 'mpd';
    if (/\bmp4\b/.test(hint)) return 'mp4';
    return /^video\//i.test(mime) || explicit ? 'video' : null;
  }

  function fileName(url) {
    const parsed = new URL(url);
    let name = parsed.pathname.split('/').pop() || parsed.hostname;
    try { name = decodeURIComponent(name); } catch (error) {}
    return tidyText(name) || parsed.hostname;
  }

  function adReasons(url, node) {
    const parsed = new URL(url);
    const reasons = [];
    if (AD_HOSTS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) reasons.push('常见广告域名');
    if (AD_TOKEN.test(parsed.pathname)) reasons.push('地址含广告标记');
    let current = node;
    for (let depth = 0; current && depth < 6 && !/^(BODY|HTML)$/.test(current.tagName); depth++) {
      if (AD_TOKEN.test(`${current.id || ''} ${current.getAttribute('class') || ''}`) ||
          current.hasAttribute('data-ad-slot') || current.hasAttribute('data-ad-client')) {
        reasons.push('位于疑似广告容器');
        break;
      }
      current = current.parentElement || (current.getRootNode().host || null);
    }
    return reasons;
  }

  function markDomMedia() {
    domMediaPresent = true;
    hadDomMedia = true;
  }

  function hasVideoEvidence() {
    // 缓存中的旧链接不能让已移除播放器的页面一直显示视频入口。
    // 纯网络来源仍可单独使用；普通的跨域 iframe 本身不算视频证据。
    return domMediaPresent || !hadDomMedia && records.size > 0;
  }

  function addRecord(value, info = {}) {
    const url = normalizeUrl(value, info.base || document.baseURI);
    if (!url) return;
    const kind = mediaKind(url, info.mime || '', !!info.explicit);
    if (!kind) return;
    if (collectingDom) markDomMedia();
    let record = records.get(url);
    if (!record) {
      if (records.size >= MAX_RECORDS) return;
      record = { url, kind, name: fileName(url), nameSource: '地址文件名，未确认片名', nameRank: 0,
        duration: null, durationRank: 0, durationSource: '', live: false, node: null,
        origins: new Set(), ads: new Set(), sequence: sequence++, busy: false, error: '' };
      records.set(url, record);
    }
    if (kind !== 'video') record.kind = kind;
    if (info.origin) record.origins.add(info.origin);
    const name = tidyText(info.name);
    if (name && (info.nameRank || 0) >= record.nameRank) {
      record.name = name;
      record.nameRank = info.nameRank || 0;
      record.nameSource = info.nameSource || '页面标注';
    }
    const duration = durationSeconds(info.duration);
    if ((duration !== null || info.live) && (info.durationRank || 0) >= record.durationRank) {
      record.duration = info.live ? null : duration;
      record.live = !!info.live;
      record.durationRank = info.durationRank || 0;
      record.durationSource = info.durationSource || '页面标注';
      record.error = '';
    }
    if (info.node && (!record.node || !record.node.isConnected || info.node.tagName === 'VIDEO')) record.node = info.node;
    adReasons(url, info.node).forEach(reason => record.ads.add(reason));
    scheduleRender();
    return record;
  }

  function exclusionReason(record, checkDuration = true) {
    if (ignoredUrls.has(record.url)) return 'ignored';
    if (settings.filterAds && record.ads.size) return 'ads';
    const keywords = settings.excludeKeywords.toLowerCase().split(/[\n,，]+/).map(word => word.trim()).filter(Boolean).slice(0, 50);
    const searchable = `${record.url}\n${record.name}`.toLowerCase();
    if (keywords.some(word => searchable.includes(word))) return 'keywords';
    if (checkDuration && record.duration !== null && record.duration < settings.minDuration) return 'short';
    if (checkDuration && record.duration === null && settings.hideUnknown) return 'unknown';
    return '';
  }

  function filteredRecords() {
    const counts = { ignored: 0, ads: 0, keywords: 0, short: 0, unknown: 0 };
    const eligible = [];
    records.forEach(record => {
      const reason = exclusionReason(record);
      if (reason) counts[reason]++;
      else eligible.push(record);
    });
    eligible.sort((first, second) => settings.sortOrder === 'longest'
      ? (second.duration || 0) - (first.duration || 0) || first.sequence - second.sequence
      : first.sequence - second.sequence);
    return { counts, eligible };
  }
  function elementInfo(node) {
    const container = node.closest('figure, article, li, [itemscope], .video-card, .video-item') || node.parentElement;
    const uniqueContainer = container && container.querySelectorAll('video').length <= 1 ? container : null;
    const titleNode = uniqueContainer && uniqueContainer.querySelector('[itemprop~="name"], figcaption, .video-title, h1, h2, h3, h4');
    const timeNode = uniqueContainer && uniqueContainer.querySelector('[itemprop~="duration"]');
    const name = node.getAttribute('data-title') || node.getAttribute('data-video-title') ||
      node.getAttribute('aria-label') || node.getAttribute('title') ||
      (titleNode && (titleNode.getAttribute('content') || titleNode.textContent)) ||
      (node.tagName === 'A' ? node.textContent : '');
    const duration = durationSeconds(node.getAttribute('data-duration')) ||
      durationSeconds(timeNode && (timeNode.getAttribute('content') || timeNode.getAttribute('datetime') || timeNode.textContent));
    return { name, nameRank: 2, nameSource: '播放器/附近文字', duration, durationRank: 1,
      durationSource: '页面标注', node, base: node.ownerDocument.baseURI };
  }

  function collectVideo(video) {
    markDomMedia();
    scheduleRender();
    if (!watchedVideos.has(video)) {
      watchedVideos.add(video);
      ['loadedmetadata', 'durationchange', 'loadeddata', 'emptied', 'loadstart'].forEach(eventName => {
        video.addEventListener(eventName, () => {
          if (video.isConnected) {
            synchronizePage();
            collectVideo(video);
          }
        }, { passive: true });
      });
    }
    const info = elementInfo(video);
    const currentUrl = normalizeUrl(video.currentSrc, info.base);
    const candidates = [
      { value: video.currentSrc, mime: video.getAttribute('type') || '' },
      { value: video.getAttribute('src'), mime: video.getAttribute('type') || '' },
      { value: video.getAttribute('data-src'), mime: '' },
      { value: video.getAttribute('data-video-src'), mime: '' },
      { value: video.getAttribute('data-video-url'), mime: '' }
    ];
    video.querySelectorAll('source').forEach(source => candidates.push({
      value: source.getAttribute('src') || source.getAttribute('data-src'), mime: source.getAttribute('type') || ''
    }));
    candidates.forEach(candidate => {
      const url = normalizeUrl(candidate.value, info.base);
      if (!url) return;
      const playingSource = currentUrl === url && video.readyState >= 1;
      addRecord(url, Object.assign({}, info, {
        explicit: true, mime: candidate.mime, origin: '播放器',
        duration: playingSource ? durationSeconds(video.duration) : info.duration,
        durationRank: playingSource ? 3 : info.durationRank,
        durationSource: playingSource ? '播放器元数据' : info.durationSource,
        live: playingSource && video.duration === Infinity
      }));
    });
  }

  function collectStructuredData(root) {
    Array.from(root.querySelectorAll('script[type="application/ld+json"]')).slice(0, 80).forEach(script => {
      const text = script.textContent;
      const previous = parsedStructuredData.get(script);
      if (text.length > 1048576) return;
      if (previous && previous.text === text && previous.generation === generation) {
        if (previous.hasMedia) markDomMedia();
        return;
      }
      const cached = { text, generation, hasMedia: false };
      parsedStructuredData.set(script, cached);
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) { return; }
      const pending = [parsed];
      let inspected = 0;
      while (pending.length && inspected++ < 3000) {
        const item = pending.pop();
        if (!item || typeof item !== 'object') continue;
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        if (types.some(type => typeof type === 'string' && /(?:^|[/#])VideoObject$/i.test(type))) {
          const urls = Array.isArray(item.contentUrl) ? item.contentUrl : [item.contentUrl];
          urls.slice(0, 40).forEach(url => {
            const record = addRecord(url, {
              explicit: true, base: script.ownerDocument.baseURI, origin: '结构化数据', name: item.name,
              nameRank: 4, nameSource: 'VideoObject 名称', duration: durationSeconds(item.duration),
              durationRank: 2, durationSource: 'VideoObject 标注'
            });
            if (record) cached.hasMedia = true;
          });
        }
        Object.values(item).slice(0, 500).reverse().forEach(value => {
          if (value && typeof value === 'object') pending.push(value);
        });
      }
    });
    const metaValue = selector => {
      const meta = root.querySelector(selector);
      return meta ? meta.getAttribute('content') || '' : '';
    };
    const mime = metaValue('meta[property="og:video:type"]');
    const name = metaValue('meta[property="og:video:title"]') || metaValue('meta[property="og:title"]');
    const duration = durationSeconds(metaValue('meta[property="video:duration"], meta[property="og:video:duration"]'));
    root.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]').forEach(meta => {
      addRecord(meta.getAttribute('content'), { mime, name, nameRank: 1, nameSource: '网页分享标题',
        duration, durationRank: 1, durationSource: '网页分享信息', origin: '分享信息', base: meta.ownerDocument.baseURI });
    });
    root.querySelectorAll('[itemtype*="VideoObject"] [itemprop~="contentUrl"]').forEach(node => {
      addRecord(node.getAttribute('content') || node.getAttribute('href') || node.getAttribute('src'),
        Object.assign(elementInfo(node), { explicit: true, origin: '结构化数据' }));
    });
  }

  function collectLinks(root) {
    const nodes = root.querySelectorAll('a[href], [data-video-src], [data-video-url], [data-src]');
    Array.from(nodes).slice(0, 4000).forEach(node => {
      if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE') return;
      const info = elementInfo(node);
      ['href', 'data-video-src', 'data-video-url', 'data-src'].forEach(attribute => {
        addRecord(node.getAttribute(attribute), Object.assign({}, info, {
          mime: node.getAttribute('type') || '', origin: '页面链接',
          explicit: attribute === 'data-video-src' || attribute === 'data-video-url'
        }));
      });
    });
  }

  function collectResource(entry) {
    if (entry.startTime < resourceFloor || internalRequests.has(entry.name)) return;
    addRecord(entry.name, { origin: '网络记录（未关联播放器）' });
  }

  function synchronizePage() {
    if (pageUrl === location.href) return;
    pageUrl = location.href;
    generation++;
    resourceFloor = performance.now();
    if (probeController) probeController.abort();
    records.clear();
    ignoredUrls.clear();
    internalRequests.clear();
    visibleRecords = [];
    domMediaPresent = false;
    hadDomMedia = false;
    scanInfo = { blobs: 0, frames: 0 };
    scheduleRender();
  }

  function scheduleScan() {
    if (scanTimer || document.hidden) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanPage();
    }, 500);
  }

  function observeRoot(root) {
    if (rootObservers.has(root)) return;
    const observer = new MutationObserver(scheduleScan);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['src', 'href', 'data-src', 'data-video-src', 'data-video-url', 'data-duration',
        'data-title', 'data-video-title', 'title', 'aria-label', 'content', 'datetime', 'type', 'class', 'id'] });
    rootObservers.set(root, observer);
  }

  function sameOriginFrame(frame) {
    if (frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin')) return false;
    if (frame.hasAttribute('srcdoc')) return true;
    try {
      const url = new URL(frame.getAttribute('src') || 'about:blank', frame.ownerDocument.baseURI);
      return /^about:blank(?:[?#]|$)/i.test(url.href) || url.origin === location.origin;
    } catch (error) { return false; }
  }

  function scanPage() {
    if (!host) return;
    synchronizePage();
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
    const pending = [{ root: document, depth: 0 }];
    const visited = new Set();
    scanInfo = { blobs: 0, frames: 0 };
    domMediaPresent = false;
    collectingDom = true;
    try {
      while (pending.length && visited.size < 40) {
        const scope = pending.shift();
        if (visited.has(scope.root)) continue;
        visited.add(scope.root);
        observeRoot(scope.root);
        Array.from(scope.root.querySelectorAll('video')).slice(0, 200).forEach(video => {
          if (/^blob:/i.test(video.currentSrc || video.src)) scanInfo.blobs++;
          collectVideo(video);
        });
        collectStructuredData(scope.root);
        collectLinks(scope.root);
        Array.from(scope.root.querySelectorAll('*')).slice(0, 10000).forEach(node => {
          if (node === host || node.id === '__safari_tools_dock__') return;
          if (node.shadowRoot) pending.push({ root: node.shadowRoot, depth: scope.depth });
          if (node.tagName !== 'IFRAME' || scope.depth >= 3) return;
          if (!watchedFrames.has(node)) {
            watchedFrames.add(node);
            node.addEventListener('load', () => { unreadableFrames.delete(node); scheduleScan(); }, { passive: true });
          }
          if (!sameOriginFrame(node) || unreadableFrames.has(node)) { scanInfo.frames++; return; }
          try {
            const frameDocument = node.contentDocument;
            if (frameDocument) pending.push({ root: frameDocument, depth: scope.depth + 1 });
            else { unreadableFrames.add(node); scanInfo.frames++; }
          } catch (error) { unreadableFrames.add(node); scanInfo.frames++; }
        });
      }
    } finally { collectingDom = false; }
    rootObservers.forEach((observer, root) => {
      if (!visited.has(root)) {
        observer.disconnect();
        rootObservers.delete(root);
      }
    });
    try { performance.getEntriesByType('resource').forEach(collectResource); } catch (error) {}
    scheduleRender();
  }
  async function fetchManifest(url, signal) {
    internalRequests.add(url);
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    internalRequests.add(response.url);
    if (!response.ok) throw new Error(`清单请求失败：HTTP ${response.status}`);
    const limit = 524288;
    if (Number(response.headers.get('content-length')) > limit) {
      if (response.body) await response.body.cancel();
      throw new Error('清单超过 512 KB，已停止读取');
    }
    let text = '';
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit) {
            await reader.cancel();
            throw new Error('清单超过 512 KB，已停止读取');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    } else {
      text = await response.text();
      if (text.length > limit) throw new Error('清单过大，无法解析');
    }
    return { text, url: response.url || url };
  }

  async function readHlsDuration(url, signal, depth = 0) {
    const manifest = await fetchManifest(url, signal);
    const lines = manifest.text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== '#EXTM3U') throw new Error('返回的不是 M3U8 清单');
    const variantIndex = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
    if (variantIndex >= 0) {
      if (depth >= 2) throw new Error('清单嵌套过深，已停止读取');
      const childLine = lines.slice(variantIndex + 1).find(line => line && !line.startsWith('#'));
      const childUrl = normalizeUrl(childLine, manifest.url);
      if (!childUrl || childUrl === url) throw new Error('无法识别子清单地址');
      return readHlsDuration(childUrl, signal, depth + 1);
    }
    const durations = lines.filter(line => line.startsWith('#EXTINF:')).map(line => Number(line.slice(8).split(',')[0]));
    if (!durations.length || durations.some(value => !Number.isFinite(value) || value < 0)) throw new Error('清单没有有效的分段时长');
    if (!lines.includes('#EXT-X-ENDLIST')) return { duration: null, live: true, durationSource: 'HLS 未结束清单，不以窗口长度充当总时长' };
    return { duration: durationSeconds(durations.reduce((total, value) => total + value, 0)), live: false, durationSource: 'HLS 完整清单' };
  }

  async function readDashDuration(url, signal) {
    const manifest = await fetchManifest(url, signal);
    const xml = new DOMParser().parseFromString(manifest.text, 'application/xml');
    const presentation = xml.getElementsByTagNameNS('*', 'MPD')[0];
    if (!presentation || xml.getElementsByTagName('parsererror').length) throw new Error('返回的不是有效 MPD 清单');
    const live = presentation.getAttribute('type') === 'dynamic';
    return { duration: live ? null : durationSeconds(presentation.getAttribute('mediaPresentationDuration')),
      live, durationSource: live ? 'DASH 动态清单' : 'DASH 清单标注' };
  }

  function readNativeDuration(url, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('读取已取消或超时')); return; }
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none';
      let finished = false;
      const finish = (result, error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', abort);
        video.removeAttribute('src');
        video.load();
        video.remove();
        if (error) reject(error);
        else resolve(result);
      };
      const abort = () => finish(null, new Error('读取已取消或超时'));
      const check = () => {
        const duration = durationSeconds(video.duration);
        if (duration !== null || video.duration === Infinity) finish({ duration, live: video.duration === Infinity, durationSource: '额外读取的媒体元数据' });
      };
      signal.addEventListener('abort', abort, { once: true });
      video.addEventListener('loadedmetadata', check);
      video.addEventListener('durationchange', check);
      video.addEventListener('error', () => finish(null, new Error('无法读取媒体元数据：可能有格式、登录或网络限制')), { once: true });
      internalRequests.add(url);
      shadow.appendChild(video);
      video.src = url;
      video.load();
    });
  }

  async function readRecordDuration(record, signal) {
    if (record.kind === 'mpd') return readDashDuration(record.url, signal);
    if (record.kind === 'm3u8') {
      try { return await readHlsDuration(record.url, signal); }
      catch (error) {
        if (signal.aborted || error.name !== 'TypeError' || !document.createElement('video').canPlayType('application/vnd.apple.mpegurl')) throw error;
        return readNativeDuration(record.url, signal);
      }
    }
    return readNativeDuration(record.url, signal);
  }

  async function startProbe(candidates) {
    if (probeController) { notify('已有读取任务；可先点击“停止读取”'); return; }
    if (!candidates.length) { notify('没有需要读取时长的候选链接'); return; }
    const controller = new AbortController();
    probeController = controller;
    const startedGeneration = generation;
    let completed = 0;
    let identified = 0;
    for (const record of candidates.slice(0, 10)) {
      if (controller.signal.aborted || startedGeneration !== generation) break;
      if (records.get(record.url) !== record || exclusionReason(record, false)) continue;
      const timeoutController = new AbortController();
      const cancel = () => timeoutController.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 12000);
      record.busy = true;
      record.error = '';
      probeProgress = `${completed + 1}/${Math.min(candidates.length, 10)}`;
      scheduleRender();
      try {
        const result = await readRecordDuration(record, timeoutController.signal);
        if (!controller.signal.aborted && startedGeneration === generation && records.get(record.url) === record) {
          if (result.duration !== null || result.live) {
            addRecord(record.url, Object.assign({}, result, { explicit: true, durationRank: 3 }));
            identified++;
          } else record.error = '未获得总时长，请尝试在原网页播放后重新扫描';
        }
      } catch (error) {
        if (!controller.signal.aborted) record.error = tidyText(error.message, 120) || '读取失败，可能受到跨域限制';
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
        record.busy = false;
        completed++;
        scheduleRender();
      }
    }
    if (probeController === controller) probeController = null;
    probeProgress = '';
    scheduleRender();
    if (startedGeneration === generation) notify(controller.signal.aborted ? '已停止读取' : `已读取 ${completed} 条，获得时长/直播状态 ${identified} 条`);
  }
  function buildUi() {
    host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        * { box-sizing: border-box; }
        [hidden] { display: none !important; }
        button, input, select, textarea { font: inherit; }
        button { min-height: 44px; border: 1px solid #d5dfdc; border-radius: 11px; padding: 9px 12px; background: #fff; color: #183a32; cursor: pointer; touch-action: manipulation; font-weight: 600; }
        button:active { background: #e8f4ef; }
        button:disabled { opacity: .45; cursor: default; }
        button:focus-visible, input:focus, select:focus, textarea:focus { outline: 2px solid #16826a; outline-offset: 2px; }
        .primary { color: #fff; background: #146b56; border-color: #146b56; }
        .primary:active { background: #105541; }
        #panel { position: fixed; left: 10px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); width: calc(100vw - 20px); max-width: 580px; max-height: 84vh; max-height: calc(90dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; background: #f3f7f5; color: #20382f; border: 1px solid #cbdad3; border-radius: 20px; box-shadow: 0 12px 50px #142b3655; overflow: hidden; font: 14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; text-align: left; }
        header { padding: 13px 14px; background: #fff; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid #dbe5df; flex-shrink: 0; }
        header .heading { flex: 1; min-width: 0; }
        h2 { font-size: 18px; margin: 0; letter-spacing: -.4px; }
        .subtitle { font-size: 11px; color: #677b71; }
        #body { overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; min-height: 0; padding: 12px; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 9px; }
        .toolbar button { flex: 1 1 auto; font-size: 13px; }
        #summary { font-weight: 700; margin: 8px 0 4px; }
        #filtered, .hint { color: #61756b; font-size: 12px; margin: 5px 0; }
        .help { background: #e5efea; border-radius: 11px; padding: 9px 11px; margin: 10px 0; font-size: 12px; }
        summary { cursor: pointer; min-height: 30px; padding: 4px 0; }
        #settings { background: #fff; border: 1px solid #d5e3da; padding: 12px; border-radius: 13px; margin-bottom: 12px; }
        .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        label.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; font-size: 13px; }
        input[type=number], select, textarea { width: 100%; min-width: 0; border: 1px solid #b8cec1; border-radius: 9px; padding: 9px; background: #fff; color: #173b2b; font-size: 16px; }
        .check { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; }
        input[type=checkbox] { width: 20px; height: 20px; flex-shrink: 0; accent-color: #146b56; }
        .card { padding: 13px; background: #fff; border: 1px solid #dce6df; border-radius: 14px; margin: 10px 0; overflow-wrap: anywhere; }
        .card h3 { margin: 0 0 7px; font-size: 15px; line-height: 1.45; }
        .badges { display: flex; flex-wrap: wrap; gap: 6px; }
        .badge { background: #e8f3ed; color: #245c45; padding: 3px 7px; border-radius: 6px; font-size: 12px; font-weight: 600; }
        .unknown { background: #fff1d9; color: #886219; }
        .source, .address { color: #61756b; font-size: 12px; margin: 6px 0; }
        .address { font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
        .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
        .actions button { flex: 1 1 auto; font-size: 13px; padding: 8px 9px; }
        .warning { font-size: 12px; color: #976115; margin: 5px 0; }
        .url-field { font-size: 16px; line-height: 1.4; resize: vertical; -webkit-user-select: text; user-select: text; }
        .empty { padding: 25px 12px; text-align: center; color: #61756b; }
        footer { padding: 10px 13px; border-top: 1px solid #dbe5df; background: #fff; font-size: 11px; color: #61756b; flex-shrink: 0; }
        #restore { min-height: 36px; font-size: 12px; padding: 6px 9px; margin-bottom: 6px; }
        #manual-copy { padding: 12px; background: #fff3d9; border-radius: 12px; margin: 10px 0; }
        #manual-copy p { margin: 0 0 8px; }
        #toast { position: fixed; left: 16px; bottom: calc(82px + env(safe-area-inset-bottom, 0px)); max-width: calc(100vw - 32px); padding: 10px 14px; background: #173d32; color: #fff; border-radius: 12px; box-shadow: 0 5px 20px #0003; pointer-events: none; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
        @media (max-width: 350px) { .fields { grid-template-columns: 1fr; } header { gap: 5px; padding: 11px; } header button { padding: 8px; } }
      </style>
      <section id="panel" role="dialog" aria-label="视频嗅探" hidden>
        <header><div class="heading"><h2>视频嗅探</h2><div class="subtitle">Safari 助手 · 仅在本机处理</div></div><button id="settings-toggle" type="button" aria-expanded="false" aria-controls="settings">设置</button><button id="close" type="button">收起</button></header>
        <div id="body">
          <form id="settings" hidden>
            <div class="fields"><label class="field">最多显示链接数<input name="maxResults" type="number" min="1" max="200" step="1" inputmode="numeric" required></label><label class="field">最低时长（秒）<input name="minDuration" type="number" min="0" max="86400" step="1" inputmode="numeric" required></label></div>
            <label class="field">排序<select name="sortOrder"><option value="discovery">按发现顺序</option><option value="longest">时长从长到短，未知排最后</option></select></label>
            <label class="check"><input name="hideUnknown" type="checkbox"><span>隐藏时长未知 / 直播的视频</span></label>
            <label class="check"><input name="filterAds" type="checkbox"><span>过滤疑似广告（可能误判，可关闭）</span></label>
            <label class="field">额外排除关键词 / 域名<textarea name="excludeKeywords" rows="2" maxlength="2000" placeholder="例如：doubleclick.net, preroll, 广告"></textarea></label>
            <p class="hint">关键词按逗号或换行分隔，最多 50 个；匹配链接和名称，不是正则表达式。最低时长 0 表示不限。未知时长不保证超过门槛。</p>
            <p class="hint">设置按当前网站保存；清除网站数据会重置。脚本顶部 DEFAULT_SETTINGS 可修改所有网站的初始值。</p>
            <div class="toolbar"><button class="primary" type="submit">保存设置</button><button id="reset-settings" type="button">恢复默认</button></div>
          </form>
          <div class="toolbar"><button id="rescan" type="button">重新扫描</button><button id="copy-all" type="button">复制显示链接</button><button id="copy-list" type="button">复制名称＋链接</button></div>
          <div id="summary" role="status" aria-live="polite"></div><div id="filtered"></div>
          <details class="help"><summary>使用提示与读取限制</summary><p>先在原网页播放视频几秒，或向下滚动加载，再扫描。这里只处理当前网页已暴露的资源，不遍历其他页面。</p><p>默认不主动请求视频。点击“读取时长”会产生额外网络流量（每批最多 10 条），不会调用播放；Safari 仍可能为了元数据请求部分媒体数据。跨域限制可能导致失败。</p><p>M3U8 / MPD 是播放清单，需要支持对应格式的下载工具。临时链接可能过期，下载也可能需要 Cookie / Referer。本脚本不绕过登录、付费或 DRM。</p></details>
          <div class="toolbar"><button id="probe-all" type="button">读取未知时长（最多 10 条）</button></div>
          <div id="scan-notes" class="hint"></div>
          <section id="manual-copy" hidden><p>自动复制受限，请长按文本框，选择“全选 → 复制”。</p><textarea id="manual-text" class="url-field" rows="4" readonly aria-label="手动复制内容"></textarea><button id="manual-close" type="button">完成</button></section>
          <div id="list"></div>
        </div>
        <footer><button id="restore" type="button" hidden>恢复本页忽略项</button><div>仅复制你有权下载的内容。片名优先取页面标注；文件名不保证是真实片名。</div></footer>
      </section>
      <div id="toast" role="status" aria-live="polite" hidden></div>`;
    document.documentElement.appendChild(host);
    tools = sharedToolsDock();
    videoEntry = document.createElement('button');
    videoEntry.id = 'video-links';
    videoEntry.type = 'button';
    videoEntry.hidden = true;
    videoEntry.textContent = '视频嗅探';
    videoEntry.setAttribute('aria-expanded', 'false');
    videoEntry.addEventListener('click', () => setPanel(!panelOpen));
    tools.getElementById('tool-actions').prepend(videoEntry);
    // 嗅探到视频时点亮的小圆钮：面板不会因为嗅探到东西就自己弹出来挡住网页，点它才打开
    readyBadge = document.createElement('button');
    readyBadge.id = 'video-ready';
    readyBadge.type = 'button';
    readyBadge.hidden = true;
    readyBadge.innerHTML = '<span style="position:relative;background:#146b56;color:#fff;border-color:#146b56">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>' +
      '<i id="ready-count" hidden style="position:absolute;top:-7px;right:-9px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#d83c35;color:#fff;font:600 10px/16px -apple-system,system-ui,sans-serif;font-style:normal;text-align:center"></i></span>';
    readyBadge.addEventListener('click', () => setPanel(true));
    const afterSlot = tools.getElementById('after');
    if (afterSlot) afterSlot.append(readyBadge);
    shadow.getElementById('close').addEventListener('click', () => setPanel(false));
    shadow.getElementById('settings-toggle').addEventListener('click', () => {
      const form = shadow.getElementById('settings');
      form.hidden = !form.hidden;
      shadow.getElementById('settings-toggle').setAttribute('aria-expanded', String(!form.hidden));
    });
    const form = shadow.getElementById('settings');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      settings = cleanSettings({ maxResults: form.elements.maxResults.value, minDuration: form.elements.minDuration.value,
        sortOrder: form.elements.sortOrder.value, hideUnknown: form.elements.hideUnknown.checked,
        filterAds: form.elements.filterAds.checked, excludeKeywords: form.elements.excludeKeywords.value });
      persistSettings();
    });
    shadow.getElementById('reset-settings').addEventListener('click', () => {
      settings = cleanSettings(DEFAULT_SETTINGS);
      persistSettings();
    });
    shadow.getElementById('rescan').addEventListener('click', () => { scanPage(); notify('已重新扫描当前页面'); });
    shadow.getElementById('copy-all').addEventListener('click', () => copyVisible(false));
    shadow.getElementById('copy-list').addEventListener('click', () => copyVisible(true));
    shadow.getElementById('probe-all').addEventListener('click', () => {
      if (probeController) probeController.abort();
      else startProbe(Array.from(records.values()).filter(record => record.duration === null && !record.live && !exclusionReason(record, false)).slice(0, Math.min(settings.maxResults, 10)));
    });
    shadow.getElementById('restore').addEventListener('click', () => { ignoredUrls.clear(); scheduleRender(); });
    shadow.getElementById('manual-close').addEventListener('click', () => { shadow.getElementById('manual-copy').hidden = true; });
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') setPanel(false); });
    fillSettings();
  }

  function fillSettings() {
    const form = shadow.getElementById('settings');
    ['maxResults', 'minDuration', 'sortOrder', 'excludeKeywords'].forEach(name => { form.elements[name].value = settings[name]; });
    ['hideUnknown', 'filterAds'].forEach(name => { form.elements[name].checked = settings[name]; });
  }

  function persistSettings() {
    fillSettings();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      notify('设置已保存，仅对当前网站生效');
    } catch (error) { notify('设置已应用，但此网页不允许保存；刷新后会恢复默认'); }
    scheduleRender();
  }

  function setPanel(open) {
    panelOpen = open;
    shadow.getElementById('panel').hidden = !open;
    videoEntry.dataset.panelOpen = String(open);
    videoEntry.setAttribute('aria-expanded', String(open));
    tools.host.dispatchEvent(new Event('safari-tools-update'));
    if (open) {
      scanPage();
      render();
      if (panelOpen) shadow.getElementById('close').focus({ preventScroll: true });
    } else {
      if (probeController) probeController.abort();
      const launcher = tools.getElementById('launcher');
      if (!launcher.hidden) launcher.focus({ preventScroll: true });
    }
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionButton(text, action, primary = false) {
    const button = element('button', primary ? 'primary' : '', text);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  function recordDuration(record) {
    return record.live ? '直播 / 不定时长' : formatDuration(record.duration);
  }

  function locateRecord(record) {
    if (!record.node || !record.node.isConnected) { notify('原始元素已不在页面中'); return; }
    const frame = record.node.ownerDocument.defaultView.frameElement;
    setPanel(false);
    if (frame) frame.scrollIntoView({ block: 'center', behavior: 'smooth' });
    record.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (record.node.animate) record.node.animate([{ outline: '4px solid #16a37a' }, { outline: '4px solid transparent' }], { duration: 1800 });
  }

  function makeCard(record, index) {
    const card = element('article', 'card');
    card.dataset.url = record.url;
    card.appendChild(element('h3', '', `${index + 1}. ${record.name}`));
    const badges = element('div', 'badges');
    badges.appendChild(element('span', `badge${record.duration === null ? ' unknown' : ''}`, recordDuration(record)));
    const kind = record.kind === 'm3u8' ? 'HLS / M3U8' : record.kind === 'mpd' ? 'DASH / MPD' : record.kind.toUpperCase();
    badges.appendChild(element('span', 'badge', kind));
    card.appendChild(badges);
    const origins = Array.from(record.origins).map(origin => record.node && record.node.tagName === 'VIDEO' ? origin.replace('（未关联播放器）', '') : origin);
    card.appendChild(element('p', 'source', `${record.nameSource} · ${origins.join(' / ')}`));
    if (record.durationSource) card.appendChild(element('p', 'source', `时长来源：${record.durationSource}`));
    const parsed = new URL(record.url);
    card.appendChild(element('p', 'address', tidyText(`${parsed.hostname}${parsed.pathname}`, 130) + (parsed.search ? '（含查询参数）' : '')));
    if (record.ads.size) card.appendChild(element('p', 'warning', `疑似广告：${Array.from(record.ads).join('、')}`));
    if (record.error) card.appendChild(element('p', 'warning', record.error));
    const actions = element('div', 'actions');
    actions.appendChild(actionButton('复制链接', () => {
      synchronizePage();
      if (records.get(record.url) !== record) { scanPage(); notify('页面已切换，请重新选择链接'); return; }
      copyText(record.url);
    }, true));
    if (record.duration === null) {
      const probe = actionButton(record.busy ? '读取中…' : '读取时长', () => startProbe([record]));
      probe.disabled = !!probeController;
      actions.appendChild(probe);
    }
    if (record.node && record.node.isConnected) actions.appendChild(actionButton('定位', () => locateRecord(record)));
    actions.appendChild(actionButton('忽略', () => { ignoredUrls.add(record.url); scheduleRender(); }));
    card.appendChild(actions);
    const details = element('details', '');
    details.appendChild(element('summary', 'hint', '查看完整链接 / 手动复制'));
    const field = element('textarea', 'url-field');
    field.rows = 2;
    field.readOnly = true;
    field.value = record.url;
    field.setAttribute('aria-label', '完整视频链接');
    field.addEventListener('click', () => { field.select(); field.setSelectionRange(0, field.value.length); });
    details.appendChild(field);
    card.appendChild(details);
    return card;
  }

  function scheduleRender() {
    if (!shadow || renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 150);
  }

  function render() {
    if (!shadow) return;
    const result = filteredRecords();
    visibleRecords = result.eligible.slice(0, settings.maxResults);
    videoEntry.hidden = !hasVideoEvidence();
    videoEntry.textContent = `视频嗅探 · ${visibleRecords.length}`;
    videoEntry.setAttribute('aria-label', `视频嗅探，发现 ${records.size} 条，显示 ${visibleRecords.length} 条`);
    if (readyBadge) {
      readyBadge.hidden = videoEntry.hidden;
      const label = `已嗅探到视频${visibleRecords.length ? `，可复制 ${visibleRecords.length} 条` : ''}，点击查看`;
      readyBadge.setAttribute('aria-label', label);
      readyBadge.title = label;
      const count = readyBadge.querySelector('#ready-count');
      count.textContent = visibleRecords.length > 99 ? '99+' : String(visibleRecords.length);
      count.hidden = !visibleRecords.length;
    }
    if (videoEntry.hidden && panelOpen) setPanel(false);
    tools.host.dispatchEvent(new Event('safari-tools-update'));
    shadow.getElementById('summary').textContent = `发现 ${records.size} 条 · 符合 ${result.eligible.length} 条 · 显示 ${visibleRecords.length}/${settings.maxResults}`;
    const labels = { short: '短视频', ads: '疑似广告', keywords: '关键词', unknown: '时长未知', ignored: '手动忽略' };
    const filtered = Object.keys(labels).filter(key => result.counts[key]).map(key => `${labels[key]} ${result.counts[key]}`);
    shadow.getElementById('filtered').textContent = filtered.length ? `已过滤：${filtered.join(' · ')}` : `最低时长 ${settings.minDuration} 秒；未知时长${settings.hideUnknown ? '隐藏' : '保留并标注'}`;
    const notes = [];
    if (!settings.hideUnknown) notes.push('“时长未知”不表示满足最低时长，可读取后筛选或在设置中隐藏。');
    if (scanInfo.blobs) notes.push(`${scanInfo.blobs} 个播放器使用 blob 地址；只寻找其可见的真实网络地址，不复制 blob。`);
    if (scanInfo.frames) notes.push(`${scanInfo.frames} 个跨域/不可访问 iframe 无法直接读取，请在播放器所在页面使用脚本。`);
    if (records.size >= MAX_RECORDS) notes.push('已达到 1000 条缓存上限，请刷新网页重新收集。');
    shadow.getElementById('scan-notes').textContent = notes.join(' ');
    ['copy-all', 'copy-list'].forEach(id => { shadow.getElementById(id).disabled = !visibleRecords.length; });
    const probeButton = shadow.getElementById('probe-all');
    probeButton.textContent = probeController ? `停止读取 ${probeProgress}` : '读取未知时长（最多 10 条）';
    probeButton.disabled = !probeController && !Array.from(records.values()).some(record => record.duration === null && !record.live && !exclusionReason(record, false));
    const restore = shadow.getElementById('restore');
    restore.hidden = !ignoredUrls.size;
    restore.textContent = `恢复本页忽略项（${ignoredUrls.size}）`;
    if (!panelOpen) return;
    const signature = JSON.stringify(visibleRecords.map(record => [record.url, record.name, record.nameSource,
      record.duration, record.live, record.durationSource, Array.from(record.origins), Array.from(record.ads),
      !!(record.node && record.node.isConnected), record.busy, record.error, !!probeController]));
    if (signature === listSignature) return;
    listSignature = signature;
    const list = shadow.getElementById('list');
    list.textContent = '';
    if (!visibleRecords.length) {
      list.appendChild(element('p', 'empty', '没有符合条件的链接。可先播放/滚动加载，再扫描；或在设置中调整时长、广告和未知时长过滤。'));
    } else visibleRecords.forEach((record, index) => list.appendChild(makeCard(record, index)));
  }

  function notify(text) {
    if (!shadow) return;
    const toast = shadow.getElementById('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function manualCopy(text) {
    setPanel(true);
    shadow.getElementById('manual-copy').hidden = false;
    const field = shadow.getElementById('manual-text');
    field.value = text;
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    notify('自动复制受限，请长按文本框复制');
  }

  function legacyCopy(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
    const previous = shadow.activeElement || document.activeElement;
    let copied = false;
    try {
      (document.body || document.documentElement).appendChild(field);
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, text.length);
      copied = document.execCommand('copy');
    } catch (error) {} finally {
      field.remove();
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    }
    if (copied) notify('已复制');
    else manualCopy(text);
  }

  function copyText(text) {
    if (!text) { notify('没有可复制的链接'); return; }
    try {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => notify('已复制')).catch(() => legacyCopy(text));
        return;
      }
    } catch (error) {}
    legacyCopy(text);
  }

  function copyVisible(includeNames) {
    scanPage();
    const selected = filteredRecords().eligible.slice(0, settings.maxResults);
    copyText(selected.map(record => includeNames
      ? `${record.name}${record.nameRank ? '' : '（地址文件名）'} [${recordDuration(record)}]\n${record.url}`
      : record.url).join(includeNames ? '\n\n' : '\n'));
  }

  function boot() {
    if (document.getElementById(ROOT_ID) || !document.documentElement) return;
    buildUi();
    scanPage();
    window.addEventListener('pageshow', scheduleScan, { passive: true });
    window.addEventListener('popstate', () => { synchronizePage(); scheduleScan(); }, { passive: true });
    window.addEventListener('hashchange', () => { synchronizePage(); scheduleScan(); }, { passive: true });
    window.addEventListener('pagehide', () => { if (probeController) probeController.abort(); }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (probeController) probeController.abort(); }
      else scheduleScan();
    });
    setInterval(() => {
      if (!document.hidden && (pageUrl !== location.href || panelOpen)) scheduleScan();
    }, 2000);
  }

  try {
    const resourceObserver = new PerformanceObserver(list => {
      synchronizePage();
      list.getEntries().forEach(collectResource);
    });
    try { resourceObserver.observe({ type: 'resource', buffered: true }); }
    catch (error) { resourceObserver.observe({ entryTypes: ['resource'] }); }
  } catch (error) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

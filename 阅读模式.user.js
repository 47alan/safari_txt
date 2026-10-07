// ==UserScript==
// @name         阅读模式 Pro（通用正文提取 · 连续翻页 · 进度记忆）
// @namespace    https://github.com/yourname/reader-mode
// @version      3.2.0
// @updateURL    https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E9%98%85%E8%AF%BB%E6%A8%A1%E5%BC%8F.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/47alan/safari_txt@main/%E9%98%85%E8%AF%BB%E6%A8%A1%E5%BC%8F.user.js
// @description  任意小说 / 文章网页一键进入阅读模式：自动识别正文并去除干扰，自动加载下一页 / 下一章，按段落记忆阅读进度，按网站记住开关、下次自动进入。内置速读谷反劫持与 hl365 去弹窗规则；与隐藏干扰项、视频嗅探共用悬浮球。
// @author       you
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '3.2.0';

  /* ==================================================================
   * ★ 用户配置区：换域名 / 加新站，只改下面这一个 SITES 列表就行。★
   * ------------------------------------------------------------------
   * 每个 { } 是一个网站的配置；想加新站，复制一段、改域名和选择器即可。
   * 域名写法：根域名 'suduguu.com'（自动含 www、m 等子域）；也可直接粘贴
   *   完整网址 'https://suduguu.com/12/2.html'（路径会被忽略）。旧域名可
   *   保留，多写几个没关系；写错的那一项会被自动忽略，不连累其它站。
   * 每项加英文引号、末尾加英文逗号；保存后替换手机里的脚本并刷新网页。
   * 只有 domains 必填；其余字段都可省略，省略就走通用阅读模式。
   * ------------------------------------------------------------------
   * 字段说明：
   *   domains         该站的域名 / 网址列表（必填）
   *   content         正文容器选择器         title  章节标题选择器
   *   nav             翻页链接所在容器
   *   preferFetch     先抓服务端原文再解析（对付把正文掺假的站）
   *   autoPath        只有匹配的地址才自动进入
   *   autoDefault     没手动设置过时是否默认自动进入
   *   catalogFromPath 由章节地址推出目录地址
   *   antiHijack      反劫持：拦截注入的已知广告脚本（配合 badScripts）
   *   blockPopups     反劫持：封杀自动弹窗 / 跳转（换域名也有效，推荐开）
   *   badScripts      已知劫持脚本的特征正则；换域名后冒出新脚本时，把它
   *                   网址里的特征词加进来即可
   *   hideAds         要隐藏的广告元素选择器数组
   *   killPopups      要直接移除并恢复滚动的弹窗选择器数组
   * 换域名通常只需改 domains；页面结构也变了才需要动 content / nav 等。
   * ================================================================== */
  const SITES = [
    {
      name: '速读谷',
      domains: [
        'sudugu.org',
        'suduguu.com',
        // 'new-domain.example',          // ← 下次换域名时，在这里加一行
      ],
      content: '.con', title: '.submenu h1', nav: '.prenext',
      preferFetch: true, autoPath: /\/\d+\/\d+([-_]\d+)?\.html$/, autoDefault: true, catalogFromPath: true,
      antiHijack: true, blockPopups: true,
      badScripts: /(j2ggdy9|bzau8uk|openjson\d*|jigool|fkt5bpu|06uww3s|2l5xeuu|authlight)/i,
    },
    {
      name: 'hl365',
      domains: ['hl365.com'],
      hideAds: ['.adspop', '.application-popup', '.article-ads-btn', '.btn-download',
        '.horizontal-banner', '.ads-title', '.article-bottom-apps', '[id^="article-bottom-ads-"]'],
      killPopups: ['.adspop', '.application-popup'],
    },
    // { name: '新站点', domains: ['example.com'], content: '#content' },   // ← 复制这行加新站
  ];

  function normalizeDomain(raw) {
    if (typeof raw !== 'string') return '';
    const value = raw.trim();
    if (!value || /[\s\\]/.test(value)) return '';
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value :
        (value.startsWith('//') ? 'https:' : 'https://') + value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return '';
      const domain = url.hostname.toLowerCase().replace(/\.$/, '');
      // 不接受通配符、空标签等无效域名，避免把配置错误扩大为跨站匹配。
      return /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(domain) ? domain : '';
    } catch (e) { return ''; }
  }

  function hostMatches(domains) {
    const host = (location.hostname || '').toLowerCase().replace(/\.$/, '');
    return domains.some((raw) => {
      const domain = normalizeDomain(raw);
      return !!domain && (host === domain || host.endsWith('.' + domain));
    });
  }

  // 当前网站命中的配置；没命中就是空对象 —— 通用阅读模式照常可用。
  const site = SITES.find((s) => Array.isArray(s.domains) && hostMatches(s.domains)) || {};
  let blocked = 0;

  /* ==================================================================
   * 第一部分：站点专属净化。反劫持必须在 document-start 抢先执行。
   * 每一块都单独包进 try：任何一步出错都不连累悬浮球和通用阅读模式。
   * 通用阅读模式不依赖这里，只有速读谷 / hl365 这类站需要额外处理。
   * ================================================================== */

  // 反劫持：拦掉已知的注入广告脚本 + 透明诱饵层 + 作恶 WebSocket。
  function installAntiHijack() {
    const bad = site.badScripts;
    function isBadScriptNode(node) {
      if (!bad || !node || node.nodeType !== 1 || node.tagName !== 'SCRIPT') return false;
      const src = node.src || (node.getAttribute && node.getAttribute('src')) || '';
      return !!src && bad.test(src);
    }
    function wrapInsert(orig) {
      return function (node) {
        try {
          if (isBadScriptNode(node)) { blocked++; return node; } // 假装成功，实际不入 DOM
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    }
    Node.prototype.insertBefore = wrapInsert(Node.prototype.insertBefore);
    Node.prototype.appendChild = wrapInsert(Node.prototype.appendChild);

    // 透明诱饵层（position:fixed + opacity:0.01）
    const _iah = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (pos, html) {
      if (typeof html === 'string' && /position\s*:\s*fixed/i.test(html) &&
          /(opacity\s*:\s*0?\.0?1|z-index\s*:\s*100)/i.test(html)) { blocked++; return; }
      return _iah.apply(this, arguments);
    };

    // 只拦截已确认的脚本/WebSocket；不重写所有事件监听器，避免误伤正文加载。
    const _WS = window.WebSocket;
    if (_WS) {
      const FakeWS = function (url) {
        if ((bad && bad.test(String(url))) || /:2009\d(\b|\/)/.test(String(url))) {
          blocked++;
          return { close() {}, send() {}, addEventListener() {}, removeEventListener() {},
            readyState: 3, set onopen(v) {}, set onmessage(v) {}, set onclose(v) {}, set onerror(v) {} };
        }
        return new _WS(url, arguments[1]);
      };
      FakeWS.prototype = _WS.prototype;
      FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
      try { window.WebSocket = FakeWS; } catch (e) {}
    }
  }

  // 行为型防护：广告脚本弹新标签页的手法无非几种 —— 直接 window.open、新建 iframe 借它的
  // window.open、程序化点击 target=_blank 链接、form.submit 到新窗口、透明诱饵层骗真实点击。
  // 这里按"行为"逐一拦截，不依赖脚本名，换域名后依然有效。
  // 阅读器翻页走 location.href，用户亲手点的站内链接不受影响。
  function installPopupBlocker() {
    const nativeOpen = window.open;
    const fakeOpen = function () { blocked++; return null; };
    try { fakeOpen.toString = () => Function.prototype.toString.call(nativeOpen); } catch (e) {}

    function hostOf(url) {
      try { return new URL(url, location.href).hostname.toLowerCase().replace(/\.$/, ''); } catch (e) { return ''; }
    }
    // 站外 = 既不是当前主机，也不属于本站配置里的任何域名
    function offSite(url) {
      const host = hostOf(url);
      if (!host) return false;
      const own = (location.hostname || '').toLowerCase().replace(/\.$/, '');
      if (host === own) return false;
      return !(site.domains || []).some((raw) => {
        const domain = normalizeDomain(raw);
        return !!domain && (host === domain || host.endsWith('.' + domain));
      });
    }
    // 透明 / 铺满全屏的 fixed 层：用户以为点的是正文，其实点在诱饵链接上
    function isDecoy(node) {
      try {
        for (let n = node; n && n !== document.body && n !== document.documentElement && n.nodeType === 1; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (parseFloat(cs.opacity) <= 0.05) return true;
          if (cs.position === 'fixed') {
            const r = n.getBoundingClientRect();
            if (r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.8) return true;
          }
        }
      } catch (e) {}
      return false;
    }
    function guardClick(event) {
      const node = event.target;
      const link = node && typeof node.closest === 'function' ? node.closest('a[href],area[href]') : null;
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href || /^(#|javascript:)/i.test(href)) return;
      const newTab = /^_blank$/i.test(link.getAttribute('target') || '');
      const away = offSite(link.href);
      let block = false;
      if (!event.isTrusted) block = newTab || away;                            // 程序化点击：弹新页 / 跳站外一律拦
      else if (active && root && !root.contains(link)) block = newTab || away; // 阅读模式下 body 已隐藏，还能被点到的只能是诱饵
      else if (newTab && away) block = isDecoy(link);                          // 普通页面：透明层上的站外新窗口链接
      if (!block) return;
      blocked++;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    // 给一个 window（当前页或 iframe 里的）装上同一套防护
    function harden(win) {
      try {
        if (!win || win.__rd_popup_guard__) return;
        win.__rd_popup_guard__ = true;
        win.open = fakeOpen;
        win.addEventListener('click', guardClick, true);
      } catch (e) {} // 跨域 iframe 碰不了，也用不着：它开不了我们这页的新窗口
    }
    harden(window);

    // iframe 的 contentWindow 是一个全新的 window，自带原生 open —— 常见绕过手法，一并堵上
    ['contentWindow', 'contentDocument'].forEach((name) => {
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, name);
        if (!desc || !desc.get) return;
        Object.defineProperty(HTMLIFrameElement.prototype, name, Object.assign({}, desc, {
          get() {
            const value = desc.get.call(this);
            harden(name === 'contentWindow' ? value : (value && value.defaultView));
            return value;
          },
        }));
      } catch (e) {}
    });
    // 通过 frames[0] 直接拿 window 时不经过上面的 getter：新进来的 iframe 主动摸一下，装完即走
    function hardenFrames(scope) {
      try {
        const frames = scope.tagName === 'IFRAME' ? [scope] : Array.from(scope.querySelectorAll ? scope.querySelectorAll('iframe') : []);
        frames.forEach((frame) => {
          void frame.contentWindow;
          frame.addEventListener('load', () => { void frame.contentWindow; }); // 导航后是新 window，再来一次
        });
      } catch (e) {}
    }
    new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => { if (node.nodeType === 1) hardenFrames(node); }));
    }).observe(document.documentElement, { childList: true, subtree: true });

    // form.target=_blank + submit() 也是开新窗口的老办法
    try {
      const nativeSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        if (/^_blank$/i.test(this.getAttribute('target') || '')) { blocked++; return; }
        return nativeSubmit.apply(this, arguments);
      };
    } catch (e) {}
  }

  if (site.antiHijack) { try { installAntiHijack(); } catch (e) {} }
  if (site.blockPopups) { try { installPopupBlocker(); } catch (e) {} }

  // 去广告 / 关弹窗（hl365 这类站）：隐藏广告元素、移除弹窗并恢复滚动。
  function installAdHider() {
    const hideList = Array.isArray(site.hideAds) ? site.hideAds : [];
    const killList = Array.isArray(site.killPopups) ? site.killPopups : [];
    const killSelector = killList.join(',');
    const style = document.createElement('style');
    style.id = '__rd_site_ad_style';
    if (hideList.length) style.textContent = `${hideList.join(',\n')}{display:none!important;}`;
    function ensureStyle() {
      if (hideList.length && !style.isConnected) (document.head || document.documentElement).appendChild(style);
    }
    function removePopups() {
      if (!killSelector) return;
      const popups = document.querySelectorAll(killSelector);
      if (!popups.length) return;
      popups.forEach((popup) => popup.remove());
      if (document.body) document.body.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('overflow');
    }
    ensureStyle();
    new MutationObserver((records) => {
      ensureStyle();
      if (!killSelector) return;
      const addedPopup = records.some((record) => Array.from(record.addedNodes).some((node) =>
        node.nodeType === 1 && (node.matches(killSelector) || node.querySelector(killSelector))));
      if (addedPopup) removePopups();
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removePopups, { once: true });
    else removePopups();
  }
  if ((site.hideAds && site.hideAds.length) || (site.killPopups && site.killPopups.length)) {
    try { installAdHider(); } catch (e) {}
  }

  // 速读谷：清扫已漏网的透明诱饵层 / 撑高 body 的 style
  function sweepDecoys() {
    if (!site.antiHijack) return;
    try {
      document.querySelectorAll('div[style*="opacity:0.01"],div[style*="opacity: 0.01"]').forEach((d) => d.remove());
      document.querySelectorAll('style').forEach((s) => {
        const t = s.textContent || '';
        if (/min-height:\s*\d+px/i.test(t) && /padding-bottom:\s*100px/i.test(t)) s.remove();
      });
    } catch (e) {}
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

  /* ==================================================================
   * 第二部分：通用阅读模式
   * ================================================================== */

  const THEMES = {
    sepia: { bg: '#f5ecd9', fg: '#3a3229', sub: '#9b8b6e', line: '#e0d3b8', bar: '#f5ecd9f0' },
    light: { bg: '#ffffff', fg: '#1a1a1a', sub: '#999999', line: '#eeeeee', bar: '#fffffff0' },
    green: { bg: '#cce8cf', fg: '#2a3a2c', sub: '#6f8a72', line: '#b3d6b6', bar: '#cce8cff0' },
    dark:  { bg: '#1a1a1a', fg: '#c8c3ba', sub: '#666666', line: '#333333', bar: '#1a1a1af0' },
  };
  const CONFIG = { preloadPx: 1200, maxAuto: 80, minChars: 200, maxLinkDensity: 0.35 };

  const PREF_KEY = '__rd_pref__';
  const AUTO_KEY = '__rd_auto__::' + location.hostname; // '1' 自动进入 / '0' 不自动 / 不存在 = 用站点规则默认值

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function loadPref() {
    const fallback = { fs: 20, theme: 'sepia' };
    try {
      const raw = localStorage.getItem(PREF_KEY) || localStorage.getItem('__sdg_reader_pref__'); // 兼容旧版的字号 / 主题设置
      return Object.assign(fallback, JSON.parse(raw || '{}'));
    } catch (e) { return fallback; }
  }
  const pref = loadPref();
  function savePref() { writeJSON(PREF_KEY, pref); }

  function autoOn() {
    let saved = null;
    try { saved = localStorage.getItem(AUTO_KEY); } catch (e) {}
    return saved === null ? !!site.autoDefault : saved === '1';
  }
  function setAuto(on) { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) {} }
  function shouldAuto() { return autoOn() && (!site.autoPath || site.autoPath.test(location.pathname)); }

  // 主题 + 字号写成挂在 <html> 上的 CSS 变量，切换时只改变量
  function applyVars() {
    const th = THEMES[pref.theme] || THEMES.sepia;
    const ds = document.documentElement.style;
    ds.setProperty('--rd-bg', th.bg);
    ds.setProperty('--rd-fg', th.fg);
    ds.setProperty('--rd-sub', th.sub);
    ds.setProperty('--rd-line', th.line);
    ds.setProperty('--rd-bar', th.bar);
    ds.setProperty('--rd-fs', pref.fs + 'px');
  }
  function clearVars() {
    const ds = document.documentElement.style;
    ['bg', 'fg', 'sub', 'line', 'bar', 'fs'].forEach((name) => ds.removeProperty('--rd-' + name));
  }

  /* -------------------- 正文识别 --------------------
   * 顺序：站点规则 → 常见小说 / 文章站的正文容器 → 通用评分。
   * 评分只算容器"自己直接持有"的文字（文本节点、行内子元素、没有块级后代的叶子块），
   * 外层包装不会把内层正文重复计入，所以分最高的就是真正装段落的那一层。 */
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|SVG|CANVAS|VIDEO|AUDIO|SELECT|TEXTAREA|BUTTON|INPUT|NAV|FORM|HEADER|FOOTER)$/;
  const INLINE_TAGS = /^(A|SPAN|B|I|EM|STRONG|FONT|U|S|SMALL|MARK|SUP|SUB|WBR|CODE|TT|LABEL|ABBR|TIME|Q|CITE|BIG)$/;
  const BLOCK_QUERY = 'div,p,section,article,ul,ol,table,h1,h2,h3,h4,h5,h6,blockquote,pre,li,dl,figure';
  const CANDIDATE_QUERY = 'div,article,section,main,td,li,blockquote,dd';
  const KNOWN_CONTENT = ['#content', '#chaptercontent', '#chapter_content', '#chapter-content', '.chapter-content',
    '#nr1', '#nr', '#txt', '#TextContent', '#BookText', '#booktxt', '.read-content', '#htmlContent', '.showtxt',
    '#article', 'article', '[itemprop="articleBody"]', '.article-content', '.post-content', '.entry-content', '.article-body'];
  const IMG_MARK = '\u0000img:'; // 段落列表里标记图片的前缀：正文里不可能出现的字符

  function isHiddenLive(el) {
    if (el.ownerDocument !== document) return false; // 离线解析出来的文档没有布局信息
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }
  function resolveUrl(href, base) {
    try {
      const url = new URL(href, base);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (e) { return null; }
  }
  // 把容器内容按"块级换行 / <br> 换行"展开成文本，图片保留成单独一行的标记
  function textOf(el, base) {
    let out = '';
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { out += child.nodeValue; continue; }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName;
        if (SKIP_TAGS.test(tag) || isHiddenLive(child)) continue;
        if (tag === 'BR') { out += '\n'; continue; }
        if (tag === 'IMG') {
          const src = resolveUrl(child.getAttribute('data-src') || child.getAttribute('src') || '', base);
          if (src) out += '\n' + IMG_MARK + src + '\n';
          continue;
        }
        const block = !INLINE_TAGS.test(tag);
        if (block) out += '\n';
        walk(child);
        if (block) out += '\n';
      }
    })(el);
    return out;
  }
  function toParagraphs(text) {
    return text.split(/\n+/)
      .map((line) => line.startsWith(IMG_MARK) ? line.trim() : line.replace(/[ \t　\xa0]+/g, ' ').trim())
      .filter(Boolean);
  }
  function linkChars(el) {
    let n = 0;
    for (const a of el.querySelectorAll('a')) n += (a.textContent || '').trim().length;
    return n;
  }
  function measure(el, base) {
    const paragraphs = toParagraphs(textOf(el, base));
    const chars = paragraphs.reduce((n, p) => n + (p.startsWith(IMG_MARK) ? 0 : p.length), 0);
    const density = chars ? Math.min(1, linkChars(el) / chars) : 1;
    return { el, paragraphs, chars, density };
  }
  function ownScore(el) {
    let own = 0, links = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === 3) { own += child.nodeValue.trim().length; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (SKIP_TAGS.test(tag) || tag === 'BR' || tag === 'IMG') continue;
      const leafBlock = tag === 'P' || !child.querySelector(BLOCK_QUERY);
      if (!INLINE_TAGS.test(tag) && !leafBlock) continue; // 非叶子块级子元素会被单独评分
      const len = (child.textContent || '').trim().length;
      own += len;
      links += tag === 'A' ? len : linkChars(child);
    }
    if (own < CONFIG.minChars) return 0;
    return own * (1 - Math.min(1, links / own));
  }
  function bestWithin(scope) {
    let best = null, bestScore = 0;
    const candidates = [scope].concat(Array.from(scope.querySelectorAll(CANDIDATE_QUERY)));
    for (const el of candidates) {
      if (el !== scope && el.closest('nav,header,footer,aside,form')) continue;
      if (el.id === '__rd_reader' || el.closest('#__rd_reader')) continue;
      const score = ownScore(el);
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }
  function accept(el, base) {
    if (!el) return null;
    const found = measure(el, base);
    return found.chars >= CONFIG.minChars && found.density < CONFIG.maxLinkDensity ? found : null;
  }
  function pickContent(doc, base) {
    const body = doc.body;
    if (!body) return null;
    const scopes = [];
    if (site.content) { try { scopes.push(doc.querySelector(site.content)); } catch (e) {} }
    for (const selector of KNOWN_CONTENT) { try { scopes.push(doc.querySelector(selector)); } catch (e) {} }
    for (const scope of scopes) {
      if (!scope || scope.closest('#__rd_reader')) continue;
      const found = accept(bestWithin(scope), base);
      if (found) return found;
    }
    return accept(bestWithin(body), base);
  }

  function cleanTitle(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    const parts = t.split(/\s*[>›»]\s*/); // "书名 > 章节名" 这类面包屑只留最后一段
    return (parts[parts.length - 1] || t).trim();
  }
  function titleOf(doc, contentEl) {
    if (site.title) {
      const el = doc.querySelector(site.title);
      if (el && cleanTitle(el.textContent)) return cleanTitle(el.textContent);
    }
    const inside = contentEl.querySelector('h1,h2,h3');
    const headings = [inside].concat(Array.from(doc.querySelectorAll('h1'))).filter(Boolean);
    for (const h of headings) {
      const t = cleanTitle(h.textContent);
      if (t.length >= 2 && t.length <= 80 && !isHiddenLive(h)) return t;
    }
    return cleanTitle((doc.title || '').split(/\s*[-_|—–]\s*/)[0]) || '正文';
  }

  const NEXT_RE = /^(下一[页章节回篇]|下页|下章|next(page|chapter)?|›|»|>|→)$/i;
  const CATALOG_RE = /^(目录|章节目录|返回目录|回目录|章节列表|全部章节|index|contents?|catalog|toc)$/i;
  function normalizeText(s) {
    return (s || '').replace(/[\s　]+/g, '').replace(/[【】\[\]()（）]/g, '');
  }
  // 翻页目标必须留在同一个网站：同主机，或互为子域名（www ↔ m ↔ 根域名）。
  // 盗版站爱在真·翻页键旁边塞一个"下一页"假链接，指向广告跳转器（最后甩到 google / 应用商店）；
  // 这类链接几乎都跳去站外，挡住它就不会再被带走。
  function sameSiteUrl(url, base) {
    try {
      const host = new URL(url, base).hostname.toLowerCase().replace(/\.$/, '');
      const baseHost = new URL(base).hostname.toLowerCase().replace(/\.$/, '');
      if (!host || !baseHost) return false;
      if (host === baseHost) return true;
      const tail = baseHost.split('.').slice(-2).join('.'); // 粗略的注册域名，足够区分站内 / 站外
      return host === tail || host.endsWith('.' + tail);
    } catch (e) { return false; }
  }
  // 纯符号（> » › →）当翻页键太弱、常是装饰或广告；"下一章/下一页"这种明确文字更可信。
  function navScore(text) {
    if (!text) return 0;
    return /^[>»›→]$/.test(text) ? 1 : 2;
  }
  function findLink(doc, base, re, rel) {
    const picks = [];
    if (rel) {
      const a = doc.querySelector('link[rel~="' + rel + '"],a[rel~="' + rel + '"]');
      if (a) picks.push({ a, score: 3 }); // rel=next 是作者明示的，最优先
    }
    let scope = [];
    if (site.nav) { try { scope = Array.from(doc.querySelectorAll(site.nav + ' a')); } catch (e) {} }
    const pool = scope.length ? scope : Array.from(doc.querySelectorAll('a[href]'));
    pool.forEach((a) => {
      const score = navScore(normalizeText(a.textContent));
      if (score && re.test(normalizeText(a.textContent))) picks.push({ a, score: score + (scope.length ? 1 : 0) });
    });
    let best = null;
    for (const { a, score } of picks) {
      const href = a.getAttribute('href') || '';
      if (!href || /^(#|javascript:)/i.test(href)) continue;
      if (/^_blank$/i.test(a.getAttribute('target') || '')) continue; // 新标签页的"下一页"基本都是广告
      const url = resolveUrl(href, base);
      if (!url || !sameSiteUrl(url, base)) continue;                   // 跳站外的一律不认（挡掉跳 google 的假链接）
      if (!best || score > best.score) best = { url, score };          // 分高者胜，同分保留文档顺序（第一个）
    }
    return best ? best.url : null;
  }
  function findCatalog(doc, base) {
    const url = findLink(doc, base, CATALOG_RE);
    if (url) return url;
    if (site.catalogFromPath) { // 速读谷：/{书号}/{章节}.html → 书目录 /{书号}/
      const m = new URL(base).pathname.match(/^\/(\d+)\//);
      if (m) return new URL('/' + m[1] + '/', base).href;
    }
    return null;
  }

  /* -------------------- 取正文来源 --------------------
   * 默认直接用当前页面的 DOM；preferFetch 的站先 fetch 服务端原文（DOM 里可能是被掺假的半截），
   * 反复失败后才回退到 DOM。 */
  let fetchGaveUp = false;
  async function fetchDoc(url, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || 8000);
    try {
      const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return new DOMParser().parseFromString(await res.text(), 'text/html');
    } finally { clearTimeout(timer); }
  }
  // 有的站把分页正文改成用 <script src> 注入（脚本里 document.write 一堆 <p>）。
  // fetch 抓不到脚本执行结果，这里把脚本本身抓来，取出 document.write 的 HTML 填回正文容器，
  // 让后面的识别照常进行。只在配置了正文容器（site.content）的站上做，且容器本身没正文时才碰。
  async function fillInjectedContent(doc, base, timeout) {
    if (!site.content) return;
    let container = null;
    try { container = doc.querySelector(site.content); } catch (e) { return; }
    if (!container || (container.textContent || '').trim().length >= CONFIG.minChars) return;
    const script = container.querySelector('script[src]');
    if (!script) return;
    const src = resolveUrl(script.getAttribute('src') || '', base);
    if (!src || !sameSiteUrl(src, base)) return; // 注入脚本必须同站，别去跑第三方脚本
    let code = '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || 10000);
    try {
      const res = await fetch(src, { credentials: 'omit', signal: ctrl.signal });
      if (res.ok) code = await res.text();
    } catch (e) {} finally { clearTimeout(timer); }
    if (!code) return;
    const parts = [];
    const re = /document\.write(?:ln)?\(\s*(['"`])((?:\\.|[\s\S])*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(code))) parts.push(m[2]);
    if (!parts.length) return;
    const html = parts.join('').replace(/\\(['"\/\\])/g, '$1').replace(/\\r/g, '').replace(/\\n/g, '\n');
    try {
      const holder = doc.createElement('div');
      holder.innerHTML = html;
      script.replaceWith(holder);
    } catch (e) {}
  }
    async function obtainSource() {
    if (site.preferFetch && !fetchGaveUp) {
      for (let i = 0; i < 4; i++) {
        try {
          const doc = await fetchDoc(location.href);
          await fillInjectedContent(doc, location.href);
          if (pickContent(doc, location.href)) return { doc, url: location.href };
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 500 + i * 700));
      }
      fetchGaveUp = true;
    }
    return { doc: document, url: location.href };
  }

  /* -------------------- 阅读器 UI -------------------- */
  const CSS = `
    html{background:var(--rd-bg)!important;overflow:auto!important;height:auto!important;}
    body{display:none!important;}
    #__rd_reader{position:relative;z-index:2147483000;min-height:100vh;background:var(--rd-bg);color:var(--rd-fg);
      font-family:-apple-system,"PingFang SC",system-ui,serif;-webkit-text-size-adjust:100%;}
    #__rd_reader *{box-sizing:border-box;}
    #__rd_reader .wrap{max-width:720px;margin:0 auto;padding:calc(56px + env(safe-area-inset-top)) 20px 40vh;}
    #__rd_reader .rd-title{font-size:1.3em;font-weight:700;text-align:center;margin:8px 0 22px;}
    #__rd_reader .rd-divider{margin:40px 0 22px;text-align:center;font-weight:700;font-size:1.2em;position:relative;}
    #__rd_reader .rd-divider::before,#__rd_reader .rd-divider::after{content:"";position:absolute;top:50%;width:20%;height:1px;background:var(--rd-line);}
    #__rd_reader .rd-divider::before{left:6%;} #__rd_reader .rd-divider::after{right:6%;}
    #__rd_reader p{margin:0 0 1.05em;line-height:1.9;letter-spacing:.02em;text-indent:2em;font-size:var(--rd-fs);}
    #__rd_reader figure{margin:0 0 1.05em;text-align:center;}
    #__rd_reader figure img{max-width:100%;height:auto;border-radius:6px;}
    #__rd_reader .status{text-align:center;color:var(--rd-sub);font-size:15px;padding:20px 0 0;}
    #__rd_reader .status button,#__rd_reader .status a{display:inline-block;border:1px solid var(--rd-line);background:transparent;color:var(--rd-fg);
      border-radius:10px;padding:11px 24px;font-size:16px;text-decoration:none;margin:4px;}
    #__rd_resume{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 18px;padding:10px 12px;border:1px solid var(--rd-line);
      border-radius:12px;color:var(--rd-sub);font-size:14px;}
    #__rd_resume span{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #__rd_resume button{border:1px solid var(--rd-line);background:transparent;color:var(--rd-fg);border-radius:8px;padding:7px 12px;font-size:14px;}
    #__rd_resume[hidden]{display:none!important;}
    #__rd_reader .dot::after{display:inline-block;animation:rddot 1.2s steps(4,end) infinite;content:""}
    @keyframes rddot{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
    #__rd_bar{position:fixed;top:0;left:0;right:0;z-index:2147483600;display:flex;align-items:center;gap:6px;
      padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:var(--rd-bar);
      backdrop-filter:saturate(180%) blur(10px);-webkit-backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid var(--rd-line);}
    #__rd_bar .t{flex:1;font-size:13px;color:var(--rd-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:-apple-system,system-ui,sans-serif;}
    #__rd_bar button{border:0;background:var(--rd-line);color:var(--rd-fg);border-radius:8px;padding:7px 10px;font-size:14px;
      font-family:-apple-system,system-ui,sans-serif;min-width:34px;}
    #__rd_bar .shield{background:transparent;color:var(--rd-sub);font-size:12px;min-width:auto;padding:7px 4px;}
    #__rd_pop{position:fixed;top:calc(50px + env(safe-area-inset-top));right:12px;z-index:2147483600;background:var(--rd-bg);
      border:1px solid var(--rd-line);border-radius:12px;padding:8px;display:none;box-shadow:0 6px 24px rgba(0,0,0,.2);}
    #__rd_pop .row{display:flex;gap:8px;margin:4px;}
    #__rd_pop .sw{width:34px;height:34px;border-radius:8px;border:2px solid transparent;}
    #__rd_pop .sw.on{border-color:#0a84ff;}`;

  let active = false, entering = false, userExited = false;
  let root, bar, contentBox, statusBox, resumeBox, sentinel, io;
  let entryUrl = '', currentUrl = '', originalTitle = '', nextUrl = null, catalogUrl = null;
  let loading = false, stopped = false, autoCount = 0;
  const loadedUrls = new Set();
  let decoyObserver = null;

  function el(tag, props) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    return node;
  }

  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = el('div', { id: '__rd_toast' });
      toastEl.style.cssText = 'all:initial;position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top));transform:translateX(-50%);' +
        'z-index:2147483646;max-width:80vw;padding:10px 16px;border-radius:12px;background:#183a32;color:#fff;' +
        'font:14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 4px 18px #0004;pointer-events:none;';
    }
    toastEl.textContent = msg;
    if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2200);
  }

  function appendBlock(block) {
    const previous = contentBox.lastElementChild;
    const section = el('section', { className: 'rd-block' });
    section.dataset.url = block.url;
    section.dataset.title = block.title;
    if (!previous) section.appendChild(el('h1', { className: 'rd-title', textContent: block.title }));
    else if (previous.dataset.title !== block.title) section.appendChild(el('h2', { className: 'rd-divider', textContent: block.title }));
    const frag = document.createDocumentFragment();
    for (const text of block.paragraphs) {
      if (text.startsWith(IMG_MARK)) {
        const figure = el('figure');
        const img = el('img', { loading: 'lazy', alt: '' });
        img.src = text.slice(IMG_MARK.length);
        figure.appendChild(img);
        frag.appendChild(figure);
      } else {
        frag.appendChild(el('p', { textContent: text }));
      }
    }
    section.appendChild(frag);
    contentBox.appendChild(section);
    loadedUrls.add(pathOf(block.url));
    return section;
  }

  function setBarTitle(t) { const node = root && root.querySelector('#__rd_bar .t'); if (node) node.textContent = t; }
  function setPrompt() { statusBox.innerHTML = '<button type="button" data-act="load">继续 · 加载下一页</button>'; }
  function setDone(msg) { stopped = true; statusBox.innerHTML = ''; statusBox.appendChild(el('span', { textContent: '— ' + msg + ' —' })); if (io) io.disconnect(); }
  function updateShield() {
    const node = root && root.querySelector('.shield');
    if (node) node.textContent = blocked > 0 ? '🛡' + blocked : '';
  }

  async function loadNext(manual) {
    if (loading || stopped || !nextUrl) return;
    if (!manual && autoCount >= CONFIG.maxAuto) {
      statusBox.innerHTML = '<button type="button" data-act="load">已连续加载较多，点此继续</button>';
      return;
    }
    loading = true;
    const url = nextUrl;
    statusBox.innerHTML = '<span class="dot">加载下一页</span>';
    try {
      const doc = await fetchDoc(url, 15000);
      await fillInjectedContent(doc, url, 10000);
      const found = pickContent(doc, url);
      if (!found) throw new Error('下一页没有识别到正文');
      appendBlock({ url, title: titleOf(doc, found.el), paragraphs: found.paragraphs });
      autoCount++;
      updateShield();
      const following = findLink(doc, url, NEXT_RE, 'next');
      nextUrl = following && !loadedUrls.has(pathOf(following)) ? following : null;
      if (!nextUrl) setDone('已是最后一页'); else setPrompt();
    } catch (e) {
      statusBox.innerHTML = '';
      statusBox.appendChild(el('span', { textContent: '加载失败：' + (e && e.message || e) + ' ' }));
      statusBox.appendChild(el('button', { type: 'button', textContent: '重试' })).dataset.act = 'load';
      const open = el('a', { textContent: '直接打开下一页 ↗', href: url });
      statusBox.appendChild(open);
    } finally {
      loading = false;
    }
  }
  function maybeLoad() {
    if (!active || !sentinel) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + CONFIG.preloadPx) loadNext(false);
  }

  /* -------------------- 阅读进度：按"章节地址 + 段落序号 + 段内偏移"记录 --------------------
   * 不记像素：拼接了多章的长页面、换字号、横竖屏都会让像素位置失效。
   * 阅读到哪一章，地址栏就同步到哪一章（replaceState），刷新 / 收藏 / 从目录再进都能对上。 */
  let lastPos = null, scrollTimer = null, visibleAt = 0, restoreToken = 0;
  function pathOf(url) {
    try { const u = new URL(url, location.href); return u.pathname + u.search; } catch (e) { return url; }
  }
  function bookKey(url) {
    try { return new URL(url, location.href).pathname.replace(/[^/]*$/, ''); } catch (e) { return '/'; }
  }
  function posKey(url) { return '__rd_pos__::' + pathOf(url); }
  function lastKey(url) { return '__rd_last__::' + bookKey(url); }
  function readingLine() { return (bar ? bar.getBoundingClientRect().bottom : 0) + 2; }
  function unitsOf(block) { return block.querySelectorAll('p,figure'); }

  function locate() {
    if (!contentBox) return null;
    const line = readingLine();
    for (const block of contentBox.children) {
      if (block.getBoundingClientRect().bottom <= line) continue;
      const units = unitsOf(block);
      for (let i = 0; i < units.length; i++) {
        const r = units[i].getBoundingClientRect();
        if (r.bottom <= line) continue;
        const frac = r.height > 0 ? Math.max(0, Math.min(1, (line - r.top) / r.height)) : 0;
        return { block, url: block.dataset.url, title: block.dataset.title, i, frac };
      }
      return { block, url: block.dataset.url, title: block.dataset.title, i: 0, frac: 0 };
    }
    return null;
  }
  function savePos(pos) {
    if (!pos) return;
    lastPos = pos;
    const ts = Date.now();
    writeJSON(posKey(pos.url), { i: pos.i, f: Math.round(pos.frac * 100) / 100, ts });
    writeJSON(lastKey(pos.url), { url: pos.url, title: pos.title, i: pos.i, ts });
  }
  function scrollToPos(block, i, frac) {
    const units = unitsOf(block);
    const unit = units[Math.min(i, units.length - 1)];
    if (!unit) return;
    const r = unit.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, window.scrollY + r.top + r.height * (frac || 0) - readingLine()));
  }
  function restoreFor(block) {
    const rec = readJSON(posKey(block.dataset.url));
    if (!rec || typeof rec.i !== 'number') return;
    const token = ++restoreToken;
    let n = 0;
    const tick = () => {
      if (!active || token !== restoreToken) return; // 用户已经开始自己滚动，别再拉扯
      scrollToPos(block, rec.i, rec.f);
      if (++n < 4) setTimeout(tick, [80, 300, 900][n - 1]); // 字体加载后布局会变，多试几次
    };
    tick();
  }
  function syncLocation(pos) {
    if (!pos || pos.url === currentUrl) return;
    currentUrl = pos.url;
    try { if (new URL(pos.url).origin === location.origin) history.replaceState(history.state, '', pos.url); } catch (e) {}
    document.title = pos.title + ' · 阅读模式';
    setBarTitle(pos.title);
  }
  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      if (!active) return;
      // iOS Safari 切回前台后常先把页面重置到顶部；刚切回时的"顶部"不算数，别把它存成进度
      if (Date.now() - visibleAt < 1500 && window.scrollY < 16 && lastPos && lastPos.i > 2) return;
      const pos = locate();
      savePos(pos);
      syncLocation(pos);
      maybeLoad();
    }, 300);
  }
  function flush() { if (active) savePos(locate()); }
  function guardReset() {
    visibleAt = Date.now();
    if (!active || !lastPos) return;
    const expected = lastPos;
    [60, 250, 700].forEach((ms) => setTimeout(() => {
      if (!active || lastPos !== expected || window.scrollY >= 16) return;
      const now = locate();
      if (now && now.block === expected.block && Math.abs(now.i - expected.i) <= 1) return;
      scrollToPos(expected.block, expected.i, expected.frac);
    }, ms));
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') flush(); else guardReset();
  }
  function onUserScrollIntent() { restoreToken++; }
  function bindProgress() {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onUserScrollIntent, { passive: true });
    window.addEventListener('wheel', onUserScrollIntent, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', guardReset);
    window.addEventListener('pagehide', flush);
  }
  function unbindProgress() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('touchstart', onUserScrollIntent);
    window.removeEventListener('wheel', onUserScrollIntent);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', guardReset);
    window.removeEventListener('pagehide', flush);
    clearTimeout(scrollTimer);
    scrollTimer = null;
  }
  // 同一本书上次读到别的章节：给一个"继续"入口，不自动跳走
  function showResumeIfAny(url) {
    const last = readJSON(lastKey(url));
    if (!last || !last.url || pathOf(last.url) === pathOf(url)) return;
    const own = readJSON(posKey(url));
    if (own && own.ts >= last.ts) return;
    resumeBox.innerHTML = '';
    resumeBox.appendChild(el('span', { textContent: '上次读到：' + (last.title || '上次的位置') }));
    resumeBox.appendChild(el('button', { type: 'button', textContent: '继续' })).addEventListener('click', () => { location.href = last.url; });
    resumeBox.appendChild(el('button', { type: 'button', textContent: '忽略' })).addEventListener('click', () => { resumeBox.hidden = true; });
    resumeBox.hidden = false;
  }

  /* -------------------- 进入 / 退出 -------------------- */
  function build(source, found) {
    active = true;
    userExited = false;
    stopped = false; loading = false; autoCount = 0; lastPos = null;
    loadedUrls.clear();
    entryUrl = currentUrl = source.url;
    originalTitle = document.title;
    const title = titleOf(source.doc, found.el);
    applyVars();
    sweepDecoys();
    if (site.antiHijack && !decoyObserver) { // 阅读期间诱饵层还会被塞进来：盯住 <html> 的直接子节点，随到随清
      decoyObserver = new MutationObserver(() => sweepDecoys());
      decoyObserver.observe(document.documentElement, { childList: true });
    }

    root = el('div', { id: '__rd_reader' });
    root.innerHTML = `
      <style>${CSS}</style>
      <div id="__rd_bar">
        <button type="button" data-act="toc">目录</button>
        <button type="button" data-act="fs-">A−</button>
        <button type="button" data-act="fs+">A+</button>
        <div class="t"></div>
        <span class="shield"></span>
        <button type="button" data-act="theme">☀</button>
        <button type="button" data-act="exit">退出</button>
      </div>
      <div id="__rd_pop">
        <div class="row">
          <div class="sw" data-th="sepia" style="background:#f5ecd9"></div>
          <div class="sw" data-th="light" style="background:#fff;box-shadow:inset 0 0 0 1px #ddd"></div>
          <div class="sw" data-th="green" style="background:#cce8cf"></div>
          <div class="sw" data-th="dark" style="background:#1a1a1a"></div>
        </div>
      </div>
      <div class="wrap">
        <div id="__rd_resume" hidden></div>
        <div id="__rd_content"></div>
        <div class="status" id="__rd_status"></div>
        <div id="__rd_sentinel"></div>
      </div>`;
    document.documentElement.appendChild(root); // 挂在 <html> 下、<body> 之外：body 整个藏起来，阅读器和悬浮球都不受影响
    bar = root.querySelector('#__rd_bar');
    contentBox = root.querySelector('#__rd_content');
    statusBox = root.querySelector('#__rd_status');
    resumeBox = root.querySelector('#__rd_resume');
    sentinel = root.querySelector('#__rd_sentinel');

    const first = appendBlock({ url: source.url, title, paragraphs: found.paragraphs });
    document.title = title + ' · 阅读模式';
    setBarTitle(title);
    nextUrl = findLink(source.doc, source.url, NEXT_RE, 'next');
    if (nextUrl && loadedUrls.has(pathOf(nextUrl))) nextUrl = null;
    catalogUrl = findCatalog(source.doc, source.url);
    if (!catalogUrl) root.querySelector('[data-act="toc"]').textContent = '返回';
    if (!nextUrl) setDone('已是最后一页'); else setPrompt();
    updateShield();
    bindEvents();
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadNext(false); },
        { rootMargin: `0px 0px ${CONFIG.preloadPx}px 0px` });
      io.observe(sentinel);
    }
    bindProgress();
    restoreFor(first);
    showResumeIfAny(source.url);
    setTimeout(maybeLoad, 300);
  }

  function teardown() {
    unbindProgress();
    if (io) { io.disconnect(); io = null; }
    if (decoyObserver) { decoyObserver.disconnect(); decoyObserver = null; }
    if (root) root.remove();
    root = bar = contentBox = statusBox = resumeBox = sentinel = null;
    clearVars();
    active = false;
  }

  async function enterReader(opts) {
    const auto = !!(opts && opts.auto);
    if (active || entering) return active;
    entering = true;
    try {
      const source = await obtainSource();
      if (active) return true;
      const found = pickContent(source.doc, source.url);
      if (!found) {
        if (!auto) toast('这一页没有识别到可读的正文');
        return false;
      }
      build(source, found);
      if (!auto) { setAuto(true); toast('已进入阅读模式，本站以后自动进入'); }
      syncDock();
      return true;
    } catch (e) {
      if (!auto) toast('进入阅读模式失败：' + (e && e.message || e));
      return false;
    } finally {
      entering = false;
      if (!active) scheduleDetect(); // 自动进入没成（如原文 fetch 不通）：重新识别，补上小圆钮或再试一次
    }
  }

  function exitReader(opts) {
    if (!active) return;
    const byUser = !(opts && opts.auto);
    flush();
    const leftAt = currentUrl;
    teardown();
    userExited = true;
    if (byUser) setAuto(false); // 主动退出 = 本站以后不再自动进入，再点一次即可恢复
    syncDock();
    if (leftAt !== entryUrl) { location.href = leftAt; return; } // 已经读到别的章节：按普通网页打开那一章
    document.title = originalTitle;
  }

  function toggleReader() {
    if (active) exitReader();
    else enterReader();
  }

  function bindEvents() {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act],[data-th]');
      if (!t) return;
      const act = t.getAttribute('data-act');
      if (act === 'load') return loadNext(true);
      if (act === 'toc') return gotoCatalog();
      if (act === 'fs+') return changeFont(1);
      if (act === 'fs-') return changeFont(-1);
      if (act === 'theme') return togglePop();
      if (act === 'exit') return exitReader();
      const th = t.getAttribute('data-th');
      if (th) applyTheme(th);
    });
  }
  function gotoCatalog() {
    if (catalogUrl) { location.href = catalogUrl; return; }
    if (history.length > 1) history.back();
  }
  function changeFont(dir) {
    const pos = locate();
    pref.fs = Math.max(14, Math.min(30, pref.fs + dir * 2));
    savePref();
    applyVars();
    if (pos) requestAnimationFrame(() => scrollToPos(pos.block, pos.i, pos.frac)); // 字号变了也停在同一段
  }
  function togglePop() {
    const pop = root.querySelector('#__rd_pop');
    const show = pop.style.display !== 'block';
    pop.style.display = show ? 'block' : 'none';
    if (show) pop.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.getAttribute('data-th') === pref.theme));
  }
  function applyTheme(name) {
    pref.theme = name;
    savePref();
    applyVars();
    togglePop();
  }

  /* -------------------- 共享悬浮球：菜单项 + 一键小圆钮 -------------------- */
  let entry = null, quick = null, readable = false;
  function syncDock() {
    if (!entry) return;
    entry.textContent = active ? '退出阅读模式' : '阅读模式';
    entry.setAttribute('aria-pressed', String(active));
    if (quick) {
      const label = active ? '退出阅读模式' : '阅读模式';
      quick.hidden = !active && !readable; // 没有正文的页面不显示小圆钮，菜单里仍然有入口
      quick.setAttribute('aria-pressed', String(active));
      quick.setAttribute('aria-label', label);
      quick.title = label;
      quick.firstElementChild.style.cssText = active ? 'background:#146b56;color:#fff;' : '';
    }
  }
  function bindDock() {
    if (entry) return;
    const tools = sharedToolsDock();
    entry = el('button', { id: 'reader-mode', type: 'button', textContent: '阅读模式' });
    entry.title = '阅读模式 v' + VERSION;
    entry.addEventListener('click', toggleReader);
    tools.getElementById('tool-actions').appendChild(entry);
    const slot = tools.getElementById('before');
    if (slot) {
      quick = el('button', { id: 'reader-quick', type: 'button', hidden: true });
      quick.appendChild(el('span', { textContent: '阅' }));
      quick.addEventListener('click', toggleReader);
      slot.prepend(quick); // 固定放在整列最上方，不受脚本加载顺序影响
    }
    syncDock();
  }

  /* -------------------- 启动：识别正文 → 显示小圆钮 → 需要时自动进入 --------------------
   * 正文常常是异步渲染的，DOMContentLoaded 时未必在；用去抖的 MutationObserver 再盯 20 秒，
   * 识别到或进入阅读模式后就停手，不常驻。 */
  let detectTimer = null, detectUntil = 0, detectObserver = null, autoTries = 0;
  function detect() {
    if (active) return;
    let found = null;
    try { found = pickContent(document, location.href); } catch (e) {}
    readable = !!found;
    syncDock(); // 哪怕正在 fetch 原文，小圆钮也先亮出来，手动随时能点
    if (entering || !readable || !shouldAuto() || userExited || autoTries >= 3) return;
    autoTries++;
    enterReader({ auto: true });
  }
  function scheduleDetect() {
    if (detectTimer) return;
    detectTimer = setTimeout(() => { detectTimer = null; detect(); }, 400);
  }
  function startDetection() {
    detect();
    detectUntil = Date.now() + 20000;
    detectObserver = new MutationObserver(() => {
      if (active || Date.now() > detectUntil) { detectObserver.disconnect(); return; }
      scheduleDetect();
    });
    detectObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('load', scheduleDetect, { once: true });
  }
  function onReady() {
    bindDock();
    startDetection();
  }
  function boot() {
    // 速读谷这类先 fetch 原文的站不用等 DOM，注入即开始，避免"第一次刷新不生效"
    if (site.preferFetch && shouldAuto()) enterReader({ auto: true });
    if (document.body) onReady();
    else document.addEventListener('DOMContentLoaded', onReady, { once: true });
    window.addEventListener('pageshow', (e) => { if (e.persisted && !active) scheduleDetect(); });
  }
  boot();
})();

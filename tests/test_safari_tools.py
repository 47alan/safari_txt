"""Shared userscript UI regression tests; all pages and media requests are local fixtures.

Run: python tests/test_safari_tools.py --browser chromium
     python tests/test_safari_tools.py --browser webkit
Requires: pip install playwright; python -m playwright install chromium webkit
"""
import argparse
import json
from pathlib import Path
import re
import unittest
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ENGINE = "chromium"
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = {"video": ROOT / "视频嗅探.user.js", "ads": ROOT / "广告过滤.user.js",
           "reader": ROOT / "阅读模式.user.js", "sites": ROOT / "常用站点.user.js"}
NSFW = ROOT / "nsfw_web_script.js"  # Shares the dock too, but needs GM_* APIs: static checks only.
DOCK_COPIES = list(SCRIPTS.values()) + [NSFW]
DOCK = "#__safari_tools_dock__"
LAUNCHER = DOCK + " #launcher"
MENU = DOCK + " #tool-menu"
SCROLL_TOP = DOCK + " #hide-scroll-top"
SCROLL_BOTTOM = DOCK + " #hide-scroll-bottom"
READER = "#__rd_reader"
READER_ENTRY = DOCK + " #reader-mode"
READER_QUICK = DOCK + " #reader-quick"
AUTO_KEY = "__rd_auto__::safari-tools.test"
VIDEO_ENTRY = DOCK + " #video-links"
VIDEO_PANEL = "#__safari_video_links__ #panel"
POSITION_KEY = "__safari_tools_position_v1__"
VIDEO = '<video id="movie" controls preload="none" src="/movie.mp4" data-title="测试视频" data-duration="120"></video>'
BASE_BODY = """<h1>阅读测试页</h1><p>正文不应被工具遮挡。</p>
<div class="adsbygoogle">自动广告位</div><div id="old-hidden">旧规则隐藏项</div>
<article id="pick-target">手动选择的干扰内容</article>
<a id="normal-link" href="#normal">正常页面链接</a>"""


def novel_page(n, pages=2):
    paragraphs = "".join(f"<p>第{n}章第{i}段。" + "阅读模式测试正文，" * 6 + "</p>" for i in range(1, 41))
    nxt = f'<a href="/book/7/{n + 1}.html">下一页</a>' if n < pages else ""
    return (f'<div class="top"><a href="/book/7/">目录</a></div><h1>第{n}章 测试章节</h1><div id="content">{paragraphs}</div>'
            f'<div class="pager"><a href="/book/7/{n - 1}.html">上一页</a>{nxt}</div>')


CATALOG = '<h1>测试书</h1><ul>' + "".join(f'<li><a href="/book/7/{i}.html">第{i}章 测试章节</a></li>' for i in range(1, 40)) + '</ul>'
NOVEL_PAGES = {"/book/7/1.html": novel_page(1), "/book/7/2.html": novel_page(2), "/book/7/": CATALOG}
SUDUGU_PAGE = ('<div class="submenu"><h1>测试书 > 第一章 开端</h1></div><div class="con">'
               + "".join("<p>" + "速读谷正文段落，" * 8 + "</p>" for _ in range(30))
               + '</div><div class="prenext"><a href="/12/1.html">上一页</a><a href="/12/#dir">目录</a><a href="/12/3.html">下一章</a></div>')
HTML = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>网页工具测试</title>
<style>body{font:16px system-ui;margin:20px;background:#f5f7f8}video{max-width:100%%}
article{padding:20px;background:white;margin:16px 0}.adsbygoogle{padding:20px;background:orange}</style>
</head><body>%s</body></html>"""


class SharedCodeTests(unittest.TestCase):
    def test_embedded_dock_copies_match(self):
        blocks = [re.search(r"  // BEGIN shared safari tools dock.*?  // END shared safari tools dock",
                            path.read_text(encoding="utf-8"), re.S).group() for path in DOCK_COPIES]
        for block in blocks[1:]:
            self.assertEqual(blocks[0], block, "Standalone copies must use the same DOM protocol and drag logic")

    def test_scroll_arrows_live_only_in_the_ad_script(self):
        video = SCRIPTS["video"].read_text(encoding="utf-8")
        ads = SCRIPTS["ads"].read_text(encoding="utf-8")
        shared = re.search(r"  // BEGIN shared safari tools dock.*?  // END shared safari tools dock", ads, re.S).group()
        self.assertIn("hide-scroll-top", ads)
        self.assertNotIn("hide-scroll", video, "The video helper must not carry the arrow feature")
        self.assertNotIn("hide-scroll", SCRIPTS["reader"].read_text(encoding="utf-8"))
        self.assertNotIn("hide-scroll", NSFW.read_text(encoding="utf-8"))
        self.assertNotIn("hide-scroll", SCRIPTS["sites"].read_text(encoding="utf-8"))
        self.assertNotIn("scrollTo", shared, "The shared dock stays generic: no scrolling logic")

    def test_nsfw_script_uses_dock_entries_instead_of_its_own_floating_buttons(self):
        text = NSFW.read_text(encoding="utf-8")
        self.assertNotIn("makeFloat(", text, "Per-module floating buttons duplicate the shared dock")
        self.assertNotIn("nsfw-dp-float", text)
        self.assertNotIn("xa-float", text)
        self.assertEqual(len(re.findall(r"^\s+(?:dockEntry = )?nsfwDockEntry\(", text, re.M)), 8, "Eight module entries use the helper")
        self.assertNotIn("@require      https://cdn.jsdelivr.net/npm/hls.js", text, "hls.js is loaded on demand")
        self.assertIn("@match        *://*/*", text)
        self.assertIn("hxc-unlock-entry", text)
        self.assertGreaterEqual(text.count("nsfwDockBadge("), 12, "Every module lights the badge instead of popping its panel")
        self.assertEqual(text.count('.style.display = "none"; // 不自动弹出') + text.count(".style.display = 'none'; // 不自动弹出"), 8, "3go, SP*, SP* share page, laowang, javhub, xasian, bbav, chunman")


class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        expect.set_options(timeout=15000 if ENGINE == "webkit" else 5000)
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, ENGINE).launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844},
                                               is_mobile=True, has_touch=True, device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.bring_to_front()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.body = BASE_BODY
        self.pages = {}  # path -> body, for multi-page fixtures
        self.requests = []
        def route(request):
            self.requests.append(request.request.url)
            path = urlparse(request.request.url).path
            if path in self.pages:
                request.fulfill(content_type="text/html; charset=utf-8", body=HTML % self.pages[path])
            elif request.request.url.endswith(".m3u8"):
                request.fulfill(content_type="application/vnd.apple.mpegurl", body="#EXTM3U\n#EXTINF:120,\npart.ts\n#EXT-X-ENDLIST\n")
            elif request.request.url.endswith(".mp4"):
                request.fulfill(status=200, content_type="video/mp4", body=b"")
            else:
                request.fulfill(content_type="text/html; charset=utf-8", body=HTML % self.body)
        self.context.route("**/*", route)
        self.page.set_default_timeout(20000 if ENGINE == "webkit" else 6000)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "No uncaught errors should occur in any userscript")

    def inject(self, order=("ads", "video")):
        for key in order:
            self.page.add_script_tag(path=str(SCRIPTS[key]))
        self.page.wait_for_function("document.getElementById('__safari_tools_dock__')?.shadowRoot")

    def load(self, order=("ads", "video"), body=None, storage=None, blocked=False):
        self.body = BASE_BODY if body is None else body
        self.page.goto("https://safari-tools.test/page")
        if storage:
            self.page.evaluate("items => Object.entries(items).forEach(([key,value]) => localStorage.setItem(key,value))", storage)
        if blocked:
            self.page.evaluate("""() => {
                Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
                Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
            }""")
        self.inject(order)

    def menu(self):
        self.page.locator(LAUNCHER).click()
        expect(self.page.locator(MENU)).to_be_visible()

    def video_panel(self):
        self.menu()
        self.page.locator(VIDEO_ENTRY).click()
        expect(self.page.locator(VIDEO_PANEL)).to_be_visible()

    def close_video(self):
        self.page.locator("#__safari_video_links__ #close").click()
        expect(self.page.locator(VIDEO_PANEL)).to_be_hidden()

    def manager(self):
        self.menu()
        self.page.locator(DOCK + " #hide-manager").click()
        expect(self.page.locator("#__hdi_panel")).to_be_visible()

    def drag_mouse(self, x=70, y=180):
        box = self.page.locator(LAUNCHER).bounding_box()
        self.page.mouse.move(box["x"] + 22, box["y"] + 22)
        self.page.mouse.down()
        self.page.mouse.move(x, y, steps=8)
        self.page.mouse.up()
        expect(self.page.locator(MENU)).to_be_hidden()

    def assert_in_view(self, selector):
        box = self.page.locator(selector).bounding_box()
        viewport = self.page.evaluate("({width:visualViewport.width,height:visualViewport.height})")
        self.assertGreaterEqual(box["x"], -1)
        self.assertGreaterEqual(box["y"], -1)
        self.assertLessEqual(box["x"] + box["width"], viewport["width"] + 1)
        self.assertLessEqual(box["y"] + box["height"], viewport["height"] + 1)

    def test_one_dock_in_both_load_orders_and_working_video_panel(self):
        for order in (("ads", "video"), ("video", "ads")):
            with self.subTest(order=order):
                self.load(order, BASE_BODY + VIDEO)
                self.video_panel()
                expect(self.page.locator(DOCK)).to_have_count(1)
                expect(self.page.locator("#__hdi_fab")).to_have_count(0)
                expect(self.page.locator("#__safari_video_links__ #fab")).to_have_count(0)
                expect(self.page.locator(LAUNCHER)).to_be_hidden()
                expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("显示 1/20")
                self.close_video()
                self.manager()
                expect(self.page.locator(LAUNCHER)).to_be_hidden()
                self.page.locator(".hdi-close").click()
                self.assert_in_view(LAUNCHER)

    def test_plain_page_only_ad_controls(self):
        self.load()
        self.menu()
        expect(self.page.locator(VIDEO_ENTRY)).to_be_hidden()
        expect(self.page.locator(DOCK + " #hide-picker")).to_be_visible()
        expect(self.page.locator(DOCK + " #hide-manager")).to_be_visible()
        self.assertEqual(self.page.locator(DOCK + " #glyph").bounding_box()["width"], 32)
        self.assertEqual(self.page.locator(LAUNCHER).bounding_box()["width"], 44)
        expect(self.page.locator(".adsbygoogle")).to_be_hidden()
        self.page.locator("h1").click()
        expect(self.page.locator(MENU)).to_be_hidden()

    def test_video_badge_lights_up_without_opening_the_panel(self):
        self.load(body=BASE_BODY + VIDEO)
        badge = self.page.locator(DOCK + " #video-ready")
        expect(badge).to_be_visible()
        expect(self.page.locator(VIDEO_PANEL)).to_be_hidden()  # Sniffing never opens the panel by itself.
        expect(badge.locator("#ready-count")).to_have_text("1")
        self.assert_column("hide-scroll-top", "launcher", "hide-scroll-bottom", "video-ready")
        badge.click()
        expect(self.page.locator(VIDEO_PANEL)).to_be_visible()
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        self.close_video()
        expect(badge).to_be_visible()
        self.page.locator("#movie").evaluate("node => node.remove()")
        expect(badge).to_be_hidden()
        expect(self.page.locator(LAUNCHER)).to_be_visible()  # The ad tools keep the dock itself on screen.

    def test_video_alone_has_no_launcher_without_media_even_with_iframe(self):
        self.load(("video",), BASE_BODY + '<iframe src="https://cross-frame.test/content"></iframe>')
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        # Wait for the first complete scan; an unknown iframe must not count as a video.
        self.page.wait_for_function("document.getElementById('__safari_video_links__').shadowRoot.getElementById('scan-notes').textContent.includes('iframe')")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()

    def test_source_less_player_appears_and_disappears_dynamically(self):
        self.load(("video",))
        self.page.evaluate("document.body.insertAdjacentHTML('beforeend', '<video id=dynamic controls></video>')")
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("发现 0 条")
        self.page.locator("#dynamic").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        expect(self.page.locator(VIDEO_PANEL)).to_be_hidden()
        self.page.evaluate("html => document.body.insertAdjacentHTML('beforeend', html)", VIDEO)
        expect(self.page.locator(LAUNCHER)).to_be_visible()

    def test_removed_player_does_not_leave_a_button_due_to_cached_resources(self):
        self.load(("video",), BASE_BODY + VIDEO)
        self.page.evaluate("fetch('/stream.m3u8').then(response => response.text())")
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("发现 2 条")
        self.page.locator("#movie").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        expect(self.page.locator(VIDEO_PANEL)).to_be_hidden()

    def test_network_only_media_is_still_discoverable(self):
        self.load(("video",))
        self.page.evaluate("fetch('/stream.m3u8').then(response => response.text())")
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("发现 1 条")

    def test_cached_structured_data_stays_visible_until_removed(self):
        metadata = '<script id="metadata" type="application/ld+json">' + json.dumps({
            "@type": "VideoObject", "name": "Metadata video", "contentUrl": "/movie.mp4", "duration": "PT2M"
        }) + '</script>'
        self.load(("video",), BASE_BODY + metadata)
        self.video_panel()
        self.close_video()
        for index in range(2):
            self.page.locator("h1").evaluate("(node, text) => node.textContent = text", str(index))
            self.video_panel()  # Repeated explicit scans exercise the JSON-LD cache.
            self.close_video()
            expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.locator("#metadata").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()

    def test_media_link_and_same_origin_frame_and_shadow_video(self):
        self.load(("video",), BASE_BODY + '<a id="media-link" href="/movie.mp4">视频文件</a>')
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.locator("#media-link").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        self.page.evaluate("""() => {
            const host = document.createElement('section'); host.id = 'player-shadow';
            host.attachShadow({mode:'open'}).innerHTML = '<video controls></video>';
            document.body.append(host);
        }""")
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.locator("#player-shadow").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        self.page.evaluate("""() => {
            const frame = document.createElement('iframe'); frame.id = 'same-frame';
            frame.srcdoc = '<video controls></video>'; document.body.append(frame);
        }""")
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.locator("#same-frame").evaluate("node => node.remove()")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()

    def test_spa_navigation_clears_previous_page_evidence(self):
        self.load(("video",), BASE_BODY + VIDEO)
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.evaluate("""() => {
            document.getElementById('movie').remove(); history.pushState({}, '', '/article');
        }""")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        self.page.evaluate("html => { history.pushState({}, '', '/next-video'); document.body.insertAdjacentHTML('beforeend', html); }", VIDEO)
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("发现 1 条")

    def test_filtered_videos_keep_settings_accessible(self):
        self.load(("video",), BASE_BODY + VIDEO.replace('data-duration="120"', 'data-duration="10"'))
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("显示 0/20")
        self.page.locator("#__safari_video_links__ #settings-toggle").click()
        self.page.locator("#__safari_video_links__ [name=minDuration]").fill("0")
        self.page.locator("#__safari_video_links__ #settings button[type=submit]").click()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("显示 1/20")

    def test_drag_remembers_position_and_does_not_eat_next_click(self):
        self.load()
        self.drag_mouse()
        saved = self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", POSITION_KEY)
        self.assertLess(saved["x"], .5)
        self.assertLess(saved["y"], .5)
        before = self.page.locator(LAUNCHER).bounding_box()
        self.menu()  # The first real click following a drag must work.
        self.page.keyboard.press("Escape")
        expect(self.page.locator(MENU)).to_be_hidden()
        self.page.reload()
        self.inject(("video", "ads"))
        after = self.page.locator(LAUNCHER).bounding_box()
        self.assertAlmostEqual(before["x"], after["x"], delta=1)
        self.assertAlmostEqual(before["y"], after["y"], delta=1)

    def test_drag_clamped_and_menu_fits_after_rotation(self):
        self.load()
        self.drag_mouse(2, 2)
        self.assert_in_view(LAUNCHER)
        self.menu()
        self.assert_in_view(MENU)
        self.page.keyboard.press("Escape")
        self.page.set_viewport_size({"width": 844, "height": 390})
        self.assert_in_view(LAUNCHER)
        self.menu()
        self.assert_in_view(MENU)
        self.page.keyboard.press("Escape")
        self.drag_mouse(2000, 2000)
        self.assert_in_view(LAUNCHER)
        self.menu()
        self.assert_in_view(MENU)

    def test_native_touch_drag_and_next_tap(self):
        if ENGINE != "chromium":
            self.skipTest("Native multi-event touch input uses Chromium CDP; WebKit pointer cancellation and taps are tested separately")
        self.load(body=BASE_BODY + '<div style="height:2000px">长页面</div>')
        box = self.page.locator(LAUNCHER).bounding_box()
        x, y = box["x"] + 22, box["y"] + 22
        cdp = self.context.new_cdp_session(self.page)
        def touch(kind, points):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})
        touch("touchStart", [{"x": x, "y": y}])
        for step in range(1, 9):
            touch("touchMove", [{"x": x + (70 - x) * step / 8, "y": y + (220 - y) * step / 8}])
        touch("touchEnd", [])
        cdp.detach()
        expect(self.page.locator(MENU)).to_be_hidden()
        self.assertEqual(self.page.evaluate("scrollY"), 0)
        self.assertLess(self.page.locator(LAUNCHER).bounding_box()["x"], 100)
        self.page.locator(LAUNCHER).tap()
        expect(self.page.locator(MENU)).to_be_visible()

    def test_pointer_cancel_does_not_block_next_native_tap(self):
        self.load()
        self.page.locator(LAUNCHER).evaluate("""button => {
            const rect = button.getBoundingClientRect();
            for (const [type, dx] of [['pointerdown',0], ['pointermove',-80], ['pointercancel',-80]]) {
                button.dispatchEvent(new PointerEvent(type, {bubbles:true, composed:true, pointerId:99,
                    pointerType:'touch', isPrimary:true, button:0, clientX:rect.x+22+dx, clientY:rect.y+22-60*(dx!==0)}));
            }
        }""")
        expect(self.page.locator(MENU)).to_be_hidden()
        self.page.locator(LAUNCHER).tap()
        expect(self.page.locator(MENU)).to_be_visible()

    def test_existing_rules_settings_and_selection_restore(self):
        self.load(body=BASE_BODY + VIDEO, storage={
            "__hdi_rules__::safari-tools.test": json.dumps(["#old-hidden"]), "__hdi_adfilter_off__": "1",
            "__safari_video_links_settings_v1__": json.dumps({"maxResults": 5, "minDuration": 120})})
        expect(self.page.locator("#old-hidden")).to_be_hidden()
        expect(self.page.locator(".adsbygoogle")).to_be_visible()
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("显示 1/5")
        self.close_video()
        self.manager()
        self.page.locator(".hdi-switch:has(.hdi-flag[data-flag=ad])").click()
        expect(self.page.locator(".hdi-flag[data-flag=ad]")).to_be_checked()
        expect(self.page.locator(".adsbygoogle")).to_be_hidden()
        self.page.locator(".hdi-close").click()
        self.menu()
        self.page.locator(DOCK + " #hide-picker").click()
        self.page.locator("#pick-target").click()
        expect(self.page.locator("#__hdi_bar")).to_be_visible()
        self.page.locator(".hdi-hide").click()
        expect(self.page.locator("#pick-target")).to_be_hidden()
        expect(self.page.locator(LAUNCHER)).to_have_attribute("aria-label", "退出点选隐藏（拖动可移动）")
        self.page.locator(LAUNCHER).click()
        expect(self.page.locator("#__hdi_box")).to_be_hidden()
        self.manager()
        self.page.locator("#__hdi_list .row").filter(has_text="#pick-target").get_by_role("button", name="恢复").click()
        expect(self.page.locator("#pick-target")).to_be_visible()
        self.page.locator(".hdi-close").click()
        self.page.locator("#normal-link").click()
        self.assertTrue(self.page.url.endswith("#normal"))

    def test_ad_script_alone_and_late_registration(self):
        self.load(("ads",))
        self.manager()
        self.page.locator(".hdi-close").click()
        self.inject(("video",))
        self.menu()
        expect(self.page.locator(VIDEO_ENTRY)).to_be_hidden()
        expect(self.page.locator(DOCK + " #hide-manager")).to_have_count(1)
        expect(self.page.locator(DOCK)).to_have_count(1)
        self.load(("video",))
        expect(self.page.locator(LAUNCHER)).to_be_hidden()
        self.inject(("ads",))
        self.menu()
        expect(self.page.locator(DOCK + " #hide-manager")).to_be_visible()

    def test_blocked_and_corrupted_storage_does_not_break_dragging(self):
        self.load(storage={POSITION_KEY: "not json", "__hdi_rules__::safari-tools.test": "null",
                           "__safari_video_links_settings_v1__": '"invalid"'})
        self.drag_mouse()
        self.menu()
        self.load(blocked=True)
        self.drag_mouse(100, 250)
        self.menu()
        self.assert_in_view(MENU)

    def test_keyboard_menu_order_matches_visual_order(self):
        self.load(body=BASE_BODY + VIDEO)
        self.page.wait_for_function("!document.getElementById('__safari_tools_dock__').shadowRoot.getElementById('video-links').hidden")
        self.page.locator(LAUNCHER).focus()
        self.page.keyboard.press("ArrowDown")
        expect(self.page.locator(MENU)).to_be_visible()
        expect(self.page.locator(VIDEO_ENTRY)).to_be_focused()
        self.page.keyboard.press("Escape")
        expect(self.page.locator(LAUNCHER)).to_be_focused()
        self.page.keyboard.press("Enter")
        expect(self.page.locator(MENU)).to_be_visible()

    def test_blob_player_has_an_entry_even_without_a_copyable_url(self):
        self.load(("video",))
        self.page.evaluate("""() => {
            const video = document.createElement('video'); video.id = 'blob-player';
            video.preload = 'none'; video.controls = true;
            video.src = URL.createObjectURL(new Blob([], {type:'video/mp4'}));
            document.body.append(video);
        }""")
        self.video_panel()
        expect(self.page.locator("#__safari_video_links__ #scan-notes")).to_contain_text("blob")
        expect(self.page.locator("#__safari_video_links__ #summary")).to_contain_text("发现 0 条")
        self.close_video()
        self.page.locator("#blob-player").evaluate("node => { URL.revokeObjectURL(node.src); node.remove(); }")
        expect(self.page.locator(LAUNCHER)).to_be_hidden()

    def test_scripts_cooperate_across_isolated_javascript_worlds(self):
        if ENGINE != "chromium":
            self.skipTest("Separate JavaScript worlds are created via Chromium CDP")
        self.body = BASE_BODY + VIDEO
        self.page.goto("https://safari-tools.test/isolated")
        cdp = self.context.new_cdp_session(self.page)
        frame_id = cdp.send("Page.getFrameTree")["frameTree"]["frame"]["id"]
        for key in ("video", "ads"):
            world = cdp.send("Page.createIsolatedWorld", {"frameId": frame_id, "worldName": "userscript-" + key})
            result = cdp.send("Runtime.evaluate", {"contextId": world["executionContextId"],
                "expression": SCRIPTS[key].read_text(encoding="utf-8"), "returnByValue": True})
            self.assertNotIn("exceptionDetails", result)
        self.assertEqual(self.page.evaluate("typeof window.__hdi_openPanel"), "undefined")
        self.video_panel()
        self.close_video()
        self.manager()
        self.page.locator(".hdi-close").click()
        expect(self.page.locator(DOCK)).to_have_count(1)
        cdp.detach()

    def test_removed_ui_is_restored_without_duplicate_launchers(self):
        self.load(body=BASE_BODY + VIDEO)
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.page.evaluate("""() => {
            for (const id of ['__safari_tools_dock__','__hdi_root','__safari_video_links__','__hdi_style']) {
                document.getElementById(id).remove();
            }
        }""")
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        self.video_panel()
        expect(self.page.locator(DOCK)).to_have_count(1)
        expect(self.page.locator("#__hdi_root")).to_have_count(1)
        expect(self.page.locator(".adsbygoogle")).to_be_hidden()

    LONG_PAGE = BASE_BODY + '<div style="height:3000px">长页面</div>'

    def assert_column(self, *ids):
        """The named dock buttons form one contiguous column, top to bottom, fully on screen."""
        selectors = [DOCK + " #" + name for name in ids]
        boxes = [self.page.locator(selector).bounding_box() for selector in selectors]
        for above, below in zip(boxes, boxes[1:]):
            self.assertEqual(above["x"], below["x"])
            self.assertAlmostEqual(above["y"] + above["height"], below["y"], delta=1)
        for selector in selectors:
            self.assert_in_view(selector)

    def assert_stacked(self):
        self.assert_column("hide-scroll-top", "launcher", "hide-scroll-bottom")

    def test_scroll_arrows_stack_around_launcher_and_jump_to_page_edges(self):
        self.load(body=self.LONG_PAGE)
        self.assert_stacked()
        self.assertEqual(self.page.locator(SCROLL_TOP).bounding_box()["width"], 44)
        self.menu()
        self.page.locator(SCROLL_BOTTOM).tap()
        expect(self.page.locator(MENU)).to_be_hidden()
        self.page.wait_for_function("scrollY >= document.scrollingElement.scrollHeight - innerHeight - 1")
        self.page.locator(SCROLL_TOP).click()
        self.page.wait_for_function("scrollY === 0")
        self.page.locator(SCROLL_BOTTOM).focus()
        self.page.keyboard.press("Enter")
        self.page.wait_for_function("scrollY > 1000")
        expect(self.page.locator(LAUNCHER)).to_have_attribute("aria-label", "网页工具（拖动可移动）")

    def test_scroll_arrows_drive_the_real_scroll_container(self):
        self.load(body='<style>html,body{height:100%;margin:0;overflow:hidden}#app{height:100%;overflow:auto}</style>'
                       '<div id="app">' + BASE_BODY + '<div style="height:4000px">容器内长内容</div></div>')
        self.page.locator(SCROLL_BOTTOM).click()
        self.page.wait_for_function("(app => app.scrollTop >= app.scrollHeight - app.clientHeight - 1)(document.getElementById('app'))")
        self.page.locator(SCROLL_TOP).click()
        self.page.wait_for_function("document.getElementById('app').scrollTop === 0")

    def test_dragging_an_arrow_moves_the_whole_stack_without_scrolling(self):
        self.load(body=self.LONG_PAGE)
        box = self.page.locator(SCROLL_TOP).bounding_box()
        self.page.mouse.move(box["x"] + 22, box["y"] + 22)
        self.page.mouse.down()
        self.page.mouse.move(60, 300, steps=8)
        self.page.mouse.up()
        expect(self.page.locator(MENU)).to_be_hidden()
        self.assertEqual(self.page.evaluate("scrollY"), 0)
        self.assert_stacked()
        self.assertLess(self.page.locator(LAUNCHER).bounding_box()["x"], 100)
        saved = self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", POSITION_KEY)
        self.assertLess(saved["x"], .5)
        self.page.locator(SCROLL_BOTTOM).click()  # The first tap after a drag must still work.
        self.page.wait_for_function("scrollY > 1000")

    def test_scroll_arrows_belong_to_the_ad_script_and_follow_launcher_visibility(self):
        self.load(("video",), BASE_BODY + VIDEO)
        expect(self.page.locator(LAUNCHER)).to_be_visible()
        expect(self.page.locator(SCROLL_TOP)).to_have_count(0)  # The video helper alone has no arrows.
        self.assert_in_view(LAUNCHER)
        self.inject(("ads",))
        self.assert_stacked()  # Late registration grows the stack; it must stay inside the viewport.
        self.video_panel()
        expect(self.page.locator(SCROLL_TOP)).to_be_hidden()
        expect(self.page.locator(SCROLL_BOTTOM)).to_be_hidden()
        self.close_video()
        expect(self.page.locator(SCROLL_BOTTOM)).to_be_visible()
        self.manager()
        expect(self.page.locator(SCROLL_TOP)).to_be_hidden()
        self.page.locator(".hdi-close").click()
        self.assert_stacked()
        self.load(("ads",))
        self.assert_stacked()

    def reading_paragraph(self):
        """Index of the paragraph under the reader's top bar, plus the chapter it belongs to."""
        return self.page.evaluate("""() => {
            const line = document.querySelector('#__rd_bar').getBoundingClientRect().bottom + 2;
            const ps = [...document.querySelectorAll('#__rd_content p')];
            const i = ps.findIndex(p => p.getBoundingClientRect().bottom > line);
            const block = ps[i].closest('.rd-block');
            return { chapter: block.dataset.url, index: [...block.querySelectorAll('p')].indexOf(ps[i]) };
        }""")

    def scroll_reader_to(self, chapter, index):
        self.page.locator(f"#__rd_content .rd-block[data-url$='{chapter}'] p").nth(index).evaluate("""p => {
            const line = document.querySelector('#__rd_bar').getBoundingClientRect().bottom + 2;
            scrollTo(0, p.getBoundingClientRect().top + scrollY - line + 4);
        }""")

    def test_reader_toggle_remembers_site_and_keeps_paragraph_progress(self):
        self.pages = NOVEL_PAGES
        self.page.goto("https://safari-tools.test/book/7/1.html")
        self.inject(("reader",))
        expect(self.page.locator(READER_QUICK)).to_be_visible()
        expect(self.page.locator(READER)).to_have_count(0)
        self.page.locator(READER_QUICK).click()
        expect(self.page.locator(READER)).to_be_visible()
        expect(self.page.locator("body")).to_be_hidden()
        expect(self.page.locator("#__rd_content p")).to_have_count(40)
        expect(self.page.locator("#__rd_bar .t")).to_have_text("第1章 测试章节")
        self.menu()
        expect(self.page.locator(READER_ENTRY)).to_have_text("退出阅读模式")
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", AUTO_KEY), "1")
        self.scroll_reader_to("/book/7/1.html", 29)
        self.page.wait_for_function("JSON.parse(localStorage.getItem('__rd_pos__::/book/7/1.html') || '{}').i === 29")
        self.page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")  # Reaching the end loads the next page.
        expect(self.page.locator("#__rd_content .rd-block")).to_have_count(2)
        expect(self.page.locator("#__rd_content .rd-divider")).to_have_text("第2章 测试章节")
        self.scroll_reader_to("/book/7/2.html", 19)
        self.page.wait_for_function("location.pathname === '/book/7/2.html'")  # The address follows the chapter being read.
        self.page.wait_for_function("JSON.parse(localStorage.getItem('__rd_pos__::/book/7/2.html') || '{}').i === 19")
        expect(self.page.locator("#__rd_bar .t")).to_have_text("第2章 测试章节")
        self.page.reload()
        self.inject(("reader",))
        expect(self.page.locator(READER)).to_be_visible()  # Remembered for this site: no tap needed.
        self.page.wait_for_function("""() => {
            const line = document.querySelector('#__rd_bar').getBoundingClientRect().bottom + 2;
            const ps = [...document.querySelectorAll('#__rd_content p')];
            return ps.findIndex(p => p.getBoundingClientRect().bottom > line) === 19;
        }""")
        self.assertEqual(self.reading_paragraph(), {"chapter": "https://safari-tools.test/book/7/2.html", "index": 19})
        self.page.locator(READER_QUICK).click()  # Tapping again leaves reading mode and turns auto-enter off.
        expect(self.page.locator(READER)).to_have_count(0)
        expect(self.page.locator("body")).to_be_visible()
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", AUTO_KEY), "0")
        self.page.reload()
        self.inject(("reader",))
        expect(self.page.locator(READER_QUICK)).to_be_visible()
        self.page.wait_for_timeout(600)
        expect(self.page.locator(READER)).to_have_count(0)

    def test_reader_offers_to_resume_the_chapter_read_last(self):
        self.pages = NOVEL_PAGES
        self.page.goto("https://safari-tools.test/book/7/2.html")
        self.page.evaluate("""key => {
            localStorage.setItem(key, '1');
            localStorage.setItem('__rd_last__::/book/7/', JSON.stringify({url: 'https://safari-tools.test/book/7/1.html', title: '第1章 测试章节', i: 12, ts: Date.now()}));
        }""", AUTO_KEY)
        self.inject(("reader",))
        expect(self.page.locator(READER)).to_be_visible()
        expect(self.page.locator("#__rd_resume")).to_contain_text("第1章 测试章节")
        self.page.locator("#__rd_resume button", has_text="继续").click()
        self.page.wait_for_url("**/book/7/1.html")

    def test_reader_skips_pages_without_body_text(self):
        self.pages = NOVEL_PAGES
        self.page.goto("https://safari-tools.test/book/7/")
        self.page.evaluate("key => localStorage.setItem(key, '1')", AUTO_KEY)
        self.inject(("reader",))
        self.page.wait_for_timeout(800)
        expect(self.page.locator(READER)).to_have_count(0)  # A catalog page is links only: never auto-entered.
        expect(self.page.locator(READER_QUICK)).to_be_hidden()
        self.menu()
        self.page.locator(READER_ENTRY).click()
        expect(self.page.locator("#__rd_toast")).to_be_visible()
        expect(self.page.locator(READER)).to_have_count(0)

    def test_reader_sudugu_profile_builds_from_fetched_source_automatically(self):
        self.pages = {"/12/2.html": SUDUGU_PAGE, "/12/3.html": SUDUGU_PAGE.replace("第一章 开端", "第二章 继续")}
        self.page.goto("https://www.sudugu.org/12/2.html")
        self.inject(("reader",))
        expect(self.page.locator(READER)).to_be_visible()  # Site profile: automatic without any tap.
        expect(self.page.locator("#__rd_content p")).to_have_count(30)
        expect(self.page.locator("#__rd_bar .t")).to_have_text("第一章 开端")
        self.assertTrue(any(url.endswith("/12/2.html") for url in self.requests[1:]), "Prefers the fetched server copy")
        self.page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
        expect(self.page.locator("#__rd_content .rd-divider")).to_have_text("第二章 继续")
        self.scroll_reader_to("/12/3.html", 5)
        self.page.wait_for_function("location.pathname === '/12/3.html'")
        self.page.locator("#__rd_bar [data-act=exit]").click()
        self.page.wait_for_url("**/12/3.html")  # Left while reading chapter two: that page opens normally.
        expect(self.page.locator(READER)).to_have_count(0)

    def test_reader_sudugu_new_domain_uses_the_same_profile(self):
        self.pages = {"/12/2.html": SUDUGU_PAGE}
        for host in ("suduguu.com", "www.suduguu.com", "m.suduguu.com"):
            with self.subTest(host=host):
                self.page.goto(f"https://{host}/12/2.html")
                self.inject(("reader",))
                expect(self.page.locator(READER)).to_be_visible()
                expect(self.page.locator("#__rd_content p")).to_have_count(30)
                expect(self.page.locator("#__rd_bar .t")).to_have_text("第一章 开端")

    def test_reader_domain_config_normalizes_addresses_without_broadening_matches(self):
        source = SCRIPTS["reader"].read_text(encoding="utf-8")
        functions = re.search(r"  function normalizeDomain\(raw\) \{.*?(?=\n  // 当前网站命中的配置)", source, re.S).group()
        check = "([domains, host]) => { const location = {hostname: host};\n" + functions + "\nreturn hostMatches(domains); }"
        cases = [
            (["suduguu.com"], "suduguu.com", True),
            (["suduguu.com"], "m.suduguu.com", True),
            (["sudugu.org"], "www.sudugu.org", True),
            (["  SUDUGUU.COM  "], "WWW.SUDUGUU.COM", True),
            (["https://suduguu.com/12/2.html?from=test#text"], "www.suduguu.com", True),
            (["http://suduguu.com:8080/12/2.html"], "suduguu.com", True),
            (["suduguu.com/12/2.html"], "suduguu.com", True),
            (["//suduguu.com/12/2.html"], "suduguu.com", True),
            (["https://SUDUGUU.COM./12/2.html"], "www.suduguu.com.", True),
            (["https://www.suduguu.com/12/2.html"], "www.suduguu.com", True),
            (["www.suduguu.com"], "suduguu.com", False),
            (["www.suduguu.com"], "m.suduguu.com", False),
            (["suduguu.com"], "not-suduguu.com", False),
            (["suduguu.com"], "suduguu.com.example.org", False),
            (["suduguu.com"], "", False),
            ([], "suduguu.com", False),
            ([None, 42, {}, [], "not a url", "suduguu.com"], "suduguu.com", True),
            (["hl365.com/some/page"], "www.hl365.com", True),
        ]
        for value in (None, 42, {}, [], "", "  ", "not a url", "*", "*.suduguu.com", ".suduguu.com",
                      "https://", "https://suduguu..com", "https://-suduguu.com", "https://suduguu.com..",
                      "https://sudu guu.com", "https://sudu\nguu.com", "https://suduguu.com\\other",
                      "ftp://suduguu.com/", "javascript:alert(1)", "mailto:user@suduguu.com",
                      "https://user:pass@suduguu.com/", "https://other.example@suduguu.com/"):
            cases.append(([value], "suduguu.com", False))
        for domains, host, expected in cases:
            with self.subTest(domains=domains, host=host):
                self.assertEqual(self.page.evaluate(check, [domains, host]), expected)

    def test_reader_custom_domain_config_applies_profile_and_blocker_at_start(self):
        self.pages = {"/12/2.html": SUDUGU_PAGE}
        source = SCRIPTS["reader"].read_text(encoding="utf-8")
        # 模拟用户只改顶部 SITES 列表里速读谷的域名，直接粘贴新网址；前面的错误条目不能阻止有效配置生效。
        domains = [None, "ftp://reader-alias.test/", "  https://READER-ALIAS.TEST/12/2.html?source=test#text  "]
        source, replacements = re.subn(r"      domains: \[.*?\],",
                                       lambda _: "      domains: " + json.dumps(domains) + ",",
                                       source, count=1, flags=re.S)
        self.assertEqual(replacements, 1)
        self.page.add_init_script("window.__originalAppend = Node.prototype.appendChild;\n" + source)
        for host in ("reader-alias.test", "www.reader-alias.test"):
            with self.subTest(host=host):
                self.requests.clear()
                self.page.goto(f"https://{host}/12/2.html")
                expect(self.page.locator(READER)).to_be_visible()
                expect(self.page.locator("#__rd_content p")).to_have_count(30)
                expect(self.page.locator("#__rd_bar .t")).to_have_text("第一章 开端")
                self.assertGreaterEqual(self.requests.count(f"https://{host}/12/2.html"), 2,
                                        "新域名仍优先 fetch 服务端正文")
                self.assertTrue(self.page.evaluate("""() => {
                    const script = document.createElement('script');
                    script.src = 'https://blocked.test/j2ggdy9.js';
                    document.head.appendChild(script);
                    return !script.isConnected;
                }"""), "新域名同时启用反劫持")
        for host in ("not-reader-alias.test", "reader-alias.test.example.org", "unrelated.test"):
            with self.subTest(host=host):
                self.page.goto(f"https://{host}/12/2.html")
                expect(self.page.locator(READER_QUICK)).to_be_visible()
                expect(self.page.locator(READER)).to_have_count(0)
                self.assertTrue(self.page.evaluate("Node.prototype.appendChild === window.__originalAppend"),
                                "无关网站不启用速读谷反劫持")
                self.page.locator(READER_QUICK).click()
                expect(self.page.locator(READER)).to_be_visible()  # 通用阅读仍然可用。

    def test_nsfw_hanxiucao_module_registers_a_dock_entry_only_on_play_pages(self):
        self.load(("ads",))
        self.page.add_script_tag(path=str(NSFW))
        self.page.wait_for_timeout(500)
        self.menu()
        expect(self.page.locator(DOCK + " #hxc-unlock-entry")).to_have_count(0)  # Ordinary page: nothing registered.
        self.page.keyboard.press("Escape")
        self.body = BASE_BODY + '<div id="v_prism"></div>'
        self.page.goto("https://safari-tools.test/play/video/123")
        self.inject(("ads",))
        self.page.add_script_tag(path=str(NSFW))
        self.menu()
        expect(self.page.locator(DOCK + " #hxc-unlock-entry")).to_be_visible()
        self.page.locator(DOCK + " #hxc-unlock-entry").click()
        expect(self.page.locator("#hxc-unlock-panel")).to_be_visible()  # Unlock panel mounts next to the player box.
        expect(self.page.locator("#hxc-unlock-panel")).to_contain_text("含羞草解锁")

    def test_quick_sites_panel_opens_links_in_a_new_tab_and_remembers_added_pages(self):
        self.load(("ads", "sites"))
        self.menu()
        self.page.locator(DOCK + " #quick-sites").click()
        expect(self.page.locator("#__quick_sites__ #panel")).to_be_visible()
        expect(self.page.locator(LAUNCHER)).to_be_hidden()  # Dock protocol: the launcher yields while a panel is open.
        link = self.page.locator("#__quick_sites__ #list a", has_text="hl365")
        expect(link).to_have_attribute("target", "_blank")
        expect(link).to_have_attribute("href", "https://hl365.com/")
        expect(self.page.locator("#__quick_sites__ #list a", has_text="mrds")).to_have_attribute("href", "https://mrds.com/category/blyp/")
        expect(self.page.locator("#__quick_sites__ [data-act=add]")).to_be_hidden()  # No GM storage here: nothing to save into.
        expect(self.page.locator("#__quick_sites__ #add-form")).to_be_hidden()
        with self.context.expect_page() as opened:
            link.click()
        self.assertTrue(opened.value.url.startswith("https://hl365.com/"))
        opened.value.close()
        self.page.locator("#__quick_sites__ [data-act=close]").click()
        expect(self.page.locator("#__quick_sites__ #panel")).to_be_hidden()
        expect(self.page.locator(LAUNCHER)).to_be_visible()

        # With script storage (GM.getValue / GM.setValue) the current page can be added and survives a reload.
        fake_gm = """() => { window.GM = {
            getValue: (k, d) => Promise.resolve(localStorage.getItem('fake_gm_' + k) ?? d),
            setValue: (k, v) => { localStorage.setItem('fake_gm_' + k, v); return Promise.resolve(); } }; }"""
        self.page.goto("https://safari-tools.test/some/article?id=7")
        self.page.evaluate(fake_gm)
        self.inject(("ads", "sites"))
        self.menu()
        self.page.locator(DOCK + " #quick-sites").click()
        self.page.locator("#__quick_sites__ [data-act=add]").click()
        added = self.page.locator("#__quick_sites__ #list .row", has_text="网页工具测试")
        expect(added.locator("a")).to_have_attribute("href", "https://safari-tools.test/some/article?id=7")
        # Any address can be typed in; a missing scheme gets https:// and the host becomes the default name.
        self.page.locator("#__quick_sites__ #add-url").fill("not a url")
        self.page.locator("#__quick_sites__ #add-form button").click()
        expect(self.page.locator("#__quick_sites__ .hint")).to_contain_text("网址不完整")
        self.page.locator("#__quick_sites__ #add-url").fill("news.example.com/today")
        self.page.locator("#__quick_sites__ #add-form button").click()
        typed = self.page.locator("#__quick_sites__ #list .row", has_text="news.example.com")
        expect(typed.locator("a")).to_have_attribute("href", "https://news.example.com/today")
        expect(self.page.locator("#__quick_sites__ #add-url")).to_have_value("")
        self.page.locator("#__quick_sites__ #add-name").fill("我的论坛")
        self.page.locator("#__quick_sites__ #add-url").fill("https://forum.example.com/")
        self.page.locator("#__quick_sites__ #add-url").press("Enter")
        expect(self.page.locator("#__quick_sites__ #list .row", has_text="我的论坛").locator("a")).to_have_attribute("href", "https://forum.example.com/")
        self.page.reload()
        self.page.evaluate(fake_gm)
        self.inject(("ads", "sites"))
        self.menu()
        self.page.locator(DOCK + " #quick-sites").click()
        expect(self.page.locator("#__quick_sites__ #list .row", has_text="网页工具测试")).to_have_count(1)
        expect(self.page.locator("#__quick_sites__ #list .row", has_text="我的论坛")).to_have_count(1)
        self.page.locator("#__quick_sites__ #list .row", has_text="网页工具测试").locator("button").click()
        expect(self.page.locator("#__quick_sites__ #list .row", has_text="网页工具测试")).to_have_count(0)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#__quick_sites__ #panel")).to_be_hidden()

    def test_reader_shares_the_dock_with_the_other_scripts(self):
        self.pages = NOVEL_PAGES
        self.page.goto("https://safari-tools.test/book/7/1.html")
        self.inject(("ads", "reader", "video"))
        expect(self.page.locator(DOCK)).to_have_count(1)
        expect(self.page.locator(READER_QUICK)).to_be_visible()
        self.assert_column("reader-quick", "hide-scroll-top", "launcher", "hide-scroll-bottom")
        self.menu()
        expect(self.page.locator(READER_ENTRY)).to_be_visible()
        expect(self.page.locator(DOCK + " #hide-manager")).to_be_visible()
        self.page.locator(READER_ENTRY).click()
        expect(self.page.locator(READER)).to_be_visible()
        expect(self.page.locator(MENU)).to_be_hidden()
        self.assert_in_view(LAUNCHER)
        self.page.locator(SCROLL_BOTTOM).click()  # The ad script's arrows keep working inside reading mode.
        self.page.wait_for_function("scrollY > 500")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--browser", choices=("chromium", "webkit"), default="chromium")
    args, remaining = parser.parse_known_args()
    ENGINE = args.browser
    unittest.main(argv=[__file__] + remaining, verbosity=2)

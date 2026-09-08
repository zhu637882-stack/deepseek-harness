"""Actual Qingmu browser workflow over disposable services; no business stubs."""
import json
import sys
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
    page.set_default_timeout(10000)
    errors = []
    dialogs = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def reject_unexpected_dialog(dialog):
        dialogs.append({"type": dialog.type, "message": dialog.message})
        dialog.dismiss()

    page.on("dialog", reject_unexpected_dialog)
    try:
        page.goto(sys.argv[1], wait_until="load")
        enter = page.get_by_role("button", name="进入青木 OS", exact=True)
        # Fresh browser storage always shows the asynchronously mounted introduction.
        expect(enter).to_be_visible()
        enter.click()
        cockpit = page.get_by_role("dialog", name="青木 OS 制作驾驶舱")
        if cockpit.is_visible():
            page.get_by_role("button", name="关闭青木制作驾驶舱", exact=True).click()
        page.get_by_role("textbox", name="选择工作区", exact=True).click()
        picker = page.get_by_role("dialog", name="选择工作区目录")
        picker.get_by_role("button", name="编辑路径", exact=True).click()
        path = picker.get_by_role("textbox", name="编辑路径", exact=True)
        path.fill(sys.argv[2])
        path.press("Enter")
        picker.get_by_role("button", name="打开", exact=True).click()
        print("workspace selected", flush=True)
        page.get_by_role("button", name="青木制作台", exact=True).click()
        cockpit.get_by_role("tab", name="导演工作区", exact=True).click()
        page.get_by_role("button", name="进入 / 恢复青木导演", exact=True).click()
        expect(page.get_by_label("青木原生导演会话")).to_contain_text("6 项青木导演工具已挂载")
        expect(cockpit).to_contain_text("最近一次镜头上下文同步成功")
        print("native session bound", flush=True)
        composer = page.get_by_role("textbox", name="导演要求", exact=True)
        composer.fill("请读取本镜和 IMAGO 方法，给出空月台首稿。")
        page.get_by_role("button", name="发送给当前导演", exact=True).click()
        expect(page.get_by_label("向当前镜头的导演提要求")).to_contain_text("要求已发送")
        page.get_by_text("已有提示词、Take 与高级分镜", exact=True).click()
        # Wait for the real native tool result in the hidden outer conversation, not a mock receipt.
        page.get_by_text("本镜首稿建议已提供，请回导演工作区查看。", exact=True).wait_for(state="attached", timeout=30000)
        page.get_by_role("button", name="读取当前会话的建议", exact=True).click()
        page.get_by_role("button", name="采用到草稿", exact=True).click()
        page.get_by_role("textbox", name="首帧画面", exact=True).fill(sys.argv[3])
        page.get_by_role("button", name="检查并预览首稿", exact=True).click()
        page.get_by_role("button", name="保存首个 PromptIR Draft", exact=True).click()
        expect(page.get_by_role("heading", name="PromptIR Draft 已保存", exact=True)).to_be_visible()
        page.get_by_role("checkbox").check()
        page.get_by_role("button", name="选为首个 Ready", exact=True).click()
        # Successful outer refresh replaces bootstrap with the existing-Ready editor.
        expect(cockpit).to_contain_text("实际生效 Ready v1")
        expect(page.get_by_role("textbox", name="首帧画面提示词", exact=True)).to_have_value(sys.argv[3])
        page.reload(wait_until="load")
        if not cockpit.is_visible():
            page.get_by_role("button", name="青木制作台", exact=True).click()
        cockpit.get_by_role("tab", name="导演工作区", exact=True).click()
        page.get_by_text("已有提示词、Take 与高级分镜", exact=True).click()
        expect(cockpit).to_contain_text("实际生效 Ready v1")
        expect(page.get_by_role("textbox", name="首帧画面提示词", exact=True)).to_have_value(sys.argv[3])
        # Hold the next model response until the same shot has a new browser owner.
        expect(cockpit).to_contain_text("最近一次镜头上下文同步成功")
        page.get_by_role("textbox", name="导演要求", exact=True).fill("请再读取本镜的 Ready 提示词。")
        page.get_by_role("button", name="发送给当前导演", exact=True).click()
        expect(page.get_by_label("向当前镜头的导演提要求")).to_contain_text("要求已发送")
        page.get_by_role("button", name="关闭青木制作驾驶舱", exact=True).click()
        expect(cockpit).not_to_be_visible()
        page.get_by_role("button", name="青木制作台", exact=True).click()
        cockpit.get_by_role("tab", name="导演工作区", exact=True).click()
        expect(cockpit).to_contain_text("最近一次镜头上下文同步成功")
        print("native selection reentered", flush=True)
        page.get_by_text("镜头选择已变化；本次旧要求已停止，未读取其他镜头。", exact=True).wait_for(state="attached", timeout=30000)
        assert not errors, errors
        assert not dialogs, dialogs
        print(json.dumps({"fullHostBrowser": "passed", "pageErrors": 0, "reloaded": "Ready", "oldTarget": "rejected"}))
    except Exception:
        print(json.dumps({"body": page.locator("body").inner_text()[-16000:], "errors": errors, "dialogs": dialogs}, ensure_ascii=False), flush=True)
        raise
    finally:
        browser.close()

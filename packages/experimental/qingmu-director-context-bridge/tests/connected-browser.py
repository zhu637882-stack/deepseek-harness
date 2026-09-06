"""Opt-in real browser path; only the disposable synthetic project is changed."""
import json
import os
import sys
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel=os.environ.get("QINGMU_BROWSER_CHANNEL", "chrome"))
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(sys.argv[1], wait_until="networkidle")
    page.get_by_role("button", name="nativeDraftRead", exact=True).click()
    page.get_by_role("button", name="nativeDraftAdopt", exact=True).click()
    page.get_by_role("textbox", name="首帧画面", exact=True).fill(sys.argv[2])
    page.get_by_role("button", name="检查并预览首稿", exact=True).click()
    page.get_by_role("button", name="保存首个 PromptIR Draft", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("结果未知")
    page.get_by_role("button", name="恢复原 Draft 回执", exact=True).click()
    expect(page.get_by_role("heading", name="PromptIR Draft 已保存", exact=True)).to_be_visible()
    expect(page.get_by_label("外层权威回读")).to_have_text("Draft")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="选为首个 Ready", exact=True).click()
    expect(page.get_by_role("heading", name="首个 Ready PromptIR 已选定", exact=True)).to_be_visible()
    expect(page.get_by_label("外层权威回读")).to_have_text("Ready")
    page.reload(wait_until="networkidle")
    expect(page.get_by_role("heading", name="首个 Ready PromptIR 已选定", exact=True)).to_be_visible()
    assert not errors, errors
    print(json.dumps({"browser": "passed", "pageErrors": len(errors), "outerRead": ["Draft", "Ready"], "reload": "Ready"}))
    browser.close()

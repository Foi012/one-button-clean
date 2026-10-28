import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
import { normalizeSettings } from '../core.js';
import { contrast } from '../theme.js';
import { loadSettings } from '../settings.js';
import { mountReference } from './reference-fixtures.js';

const ENTRY = '/scripts/extensions/third-party/one-button/index.js';
let server, foreignServer, browser, origin, foreignOrigin;
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>
:root{--SmartThemeBlurTintColor:rgba(32,33,36,.7);--SmartThemeBodyColor:#e8e8e8;--SmartThemeQuoteColor:#c5b48b}
body{margin:0;background:#191a1c;color:var(--SmartThemeBodyColor);font:15px system-ui}#chat{max-width:620px;margin:100px auto;padding:28px;border:1px solid #8884;border-radius:8px}#extensionsMenuButton{position:fixed;left:18px;bottom:18px}#extensionsMenu{position:fixed;left:18px;bottom:56px;background:var(--SmartThemeBlurTintColor);padding:8px;display:none;z-index:5000}#extensionsMenu button{display:block;padding:8px;border:0;color:inherit;background:transparent}#extensions_settings2{display:none;padding:20px;max-width:480px}.sample{position:fixed;width:44px;height:44px;border:1px solid #888;border-radius:50%;background:#45484d;color:#fff}#memory{top:110px;left:24px}#music{top:180px;left:24px}#generate{top:320px;left:24px}#wrapped{position:fixed;top:250px;left:24px;width:44px;height:44px;background:#45484d;border-radius:50%;display:grid;place-items:center}#wrapped button{border:0;background:transparent;color:white}
</style><div id="chat"><h2>聊天</h2><p>常用入口留在外面，不常用的收纳起来。</p><button id="send">发送</button></div><div id="extensions_settings2"></div><button id="extensionsMenuButton">扩展</button><div id="extensionsMenu"><button>原有菜单项</button></div><button id="memory" class="sample" title="记忆管理" aria-hidden="false">记忆</button><button id="music" class="sample" title="音乐播放器">音乐</button><div id="wrapped"><button title="工具箱"><span>工具</span></button></div><button id="generate" class="sample" title="生成">生成</button><script>
window.calls={memory:0,music:0,wrapped:0,pointer:0,generated:0,stopped:0,generationPress:0,trusted:[]};
document.querySelector('#extensionsMenuButton').addEventListener('click',()=>{const menu=document.querySelector('#extensionsMenu');menu.style.display=menu.style.display==='block'?'none':'block'});
document.body.addEventListener('click',event=>{const id=event.target.closest('#memory,#music,#wrapped')?.id;if(id){calls[id]++;calls.trusted.push(event.isTrusted)}});
document.querySelector('#memory').addEventListener('pointerdown',()=>calls.pointer++);
let running=false;
document.querySelector('#generate').addEventListener('pointerdown',()=>calls.generationPress++);
document.querySelector('#generate').addEventListener('click',event=>{calls.trusted.push(event.isTrusted);if(!running)calls.generated++;else calls.stopped++;running=!running;event.currentTarget.textContent=running?'停止':'生成'});
window.saved=JSON.parse(localStorage.getItem('settings')||'{}');
window.SillyTavern={getContext:()=>({extensionSettings:saved,getRequestHeaders:()=>({'Content-Type':'application/json','X-CSRF-Token':'fixture'}),saveSettingsDebounced:()=>localStorage.setItem('settings',JSON.stringify(saved))})};
</script><script type="module" src="${ENTRY}"></script></html>`;

before(async () => {
    server = createServer(async (req, res) => {
        const file = req.url?.split('/').at(-1);
        if (['index.js', 'core.js', 'adapters.js', 'discovery.js', 'docking.js', 'settings.js', 'theme.js', 'updates.js', 'style.css'].includes(file)) {
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript');
            res.end(await readFile(new URL(`../${file}`, import.meta.url)));
        } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    foreignServer = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<button style="width:44px;height:44px" onclick="parent.postMessage({kind: &quot;foreign-activated&quot;, trusted: event.isTrusted}, &quot;*&quot;)">运行</button>');
    });
    await new Promise(resolve => foreignServer.listen(0, '127.0.0.1', resolve));
    foreignOrigin = `http://127.0.0.1:${foreignServer.address().port}`;
    browser = process.env.TEST_BROWSER === 'webkit'
        ? await webkit.launch({ headless: true })
        : await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); await new Promise(resolve => foreignServer?.close(resolve)); });
async function scenario(fn, options = {}) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, ...options });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try { await page.goto(origin); await page.locator('#ob-root').waitFor({ state: 'attached' }); await fn(page); assert.deepEqual(errors, []); }
    finally { await page.close(); }
}
async function open(page) {
    if (await page.locator('#ob-panel').isVisible()) return;
    if (await page.locator('.ob-launcher').isVisible()) await page.locator('.ob-launcher').click();
    else { await page.locator('#extensionsMenuButton').click(); await page.locator('#ob-menu-entry').click(); }
}
async function toggle(page, name, checked = true) {
    await open(page); await page.getByRole('switch', { name: `收纳 ${name}`, exact: true }).setChecked(checked);
}
async function settings(page) { await page.locator('#extensions_settings2').evaluate(node => { node.style.display = 'block'; }); }
async function theme(page, light) {
    await page.evaluate(light => {
        document.documentElement.style.setProperty('--SmartThemeBlurTintColor', light ? '#faf8f3' : '#202124');
        document.documentElement.style.setProperty('--SmartThemeBodyColor', light ? '#272725' : '#efefeb');
        document.documentElement.style.setProperty('--SmartThemeQuoteColor', light ? '#785b32' : '#d5bc8a');
        document.body.style.background = light ? '#f3f1eb' : '#161719';
    }, light);
    await page.waitForFunction(light => document.querySelector('#ob-root').dataset.obTone === (light ? 'light' : 'dark'), light);
}

test('single panel has refresh, individual switches and batch controls only', () => scenario(async page => {
    await open(page);
    assert.equal(await page.locator('#ob-panel').count(), 1);
    assert.equal(await page.locator('#ob-add-dialog,.ob-manager,.ob-recovery,input[type=search]').count(), 0);
    assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).count(), 1);
    assert.equal(await page.getByRole('checkbox', { name: '全部收纳', exact: true }).count(), 1);
    assert.equal(await page.locator('#ob-panel').getByRole('button', { name: '全部不收纳', exact: true }).count(), 0);
    assert.equal(await page.getByRole('switch').count(), 4);
    assert.equal(await page.locator('.ob-collected').count(), 0);
    assert.equal(await page.locator('.ob-launcher').isVisible(), false);
}));
test('switch collects without executing; original node stays in its original DOM', () => scenario(async page => {
    await toggle(page, '记忆管理');
    assert.deepEqual(await page.evaluate(() => [calls.memory, calls.pointer]), [0, 0]);
    assert.equal(await page.locator('#memory').evaluate(node => node.parentElement.tagName), 'BODY');
    assert.equal(await page.locator('#memory').evaluate(node => node.matches(':popover-open')), true);
    const control = await page.locator('#memory').boundingBox(), panel = await page.locator('#ob-panel').boundingBox();
    assert.ok(control.x >= panel.x && control.x + control.width <= panel.x + panel.width);
    assert.ok(control.y >= panel.y && control.y + control.height <= panel.y + panel.height);
    await page.getByRole('button', { name: '关闭收纳面板' }).click();
    assert.equal(await page.locator('#memory').isVisible(), false);
}));
test('original generation/stop control operates directly once per trusted click', () => scenario(async page => {
    await toggle(page, '生成');
    await page.locator('#generate').click();
    assert.deepEqual(await page.evaluate(() => [calls.generated, calls.stopped, calls.generationPress]), [1, 0, 1]);
    assert.equal(await page.locator('#ob-panel').isVisible(), true);
    await page.locator('#generate').click();
    assert.deepEqual(await page.evaluate(() => [calls.generated, calls.stopped]), [1, 1]);
    assert.deepEqual(await page.evaluate(() => calls.trusted), [true, true]);
}));
test('turning collection off restores original coordinates, style and aria', () => scenario(async page => {
    const before = await page.locator('#memory').evaluate(node => ({ style: node.style.cssText, aria: node.getAttribute('aria-hidden'), rect: node.getBoundingClientRect().toJSON() }));
    await toggle(page, '记忆管理'); await toggle(page, '记忆管理', false);
    const after = await page.locator('#memory').evaluate(node => ({ style: node.style.cssText, aria: node.getAttribute('aria-hidden'), rect: node.getBoundingClientRect().toJSON() }));
    assert.deepEqual(after, before); assert.equal(await page.locator('#memory').getAttribute('popover'), null);
}));
test('batch collection affects current catalog; all-off restores all original controls', () => scenario(async page => {
    await open(page); await page.getByRole('checkbox', { name: '全部收纳', exact: true }).check();
    assert.equal(await page.locator('.ob-row .ob-switch[aria-checked=\"true\"]').count(), 4);
    await page.getByRole('checkbox', { name: '全部收纳', exact: true }).uncheck();
    assert.equal(await page.locator('.ob-row .ob-switch[aria-checked=\"true\"]').count(), 0);
    assert.equal(await page.locator('.ob-collected').count(), 0);
    assert.deepEqual(await page.evaluate(() => [calls.generated, calls.memory]), [0, 0]);
}));
test('new plugin is discovered only on refresh/open and defaults off after collect-all', () => scenario(async page => {
    await open(page); await page.getByRole('checkbox', { name: '全部收纳', exact: true }).check();
    await page.evaluate(() => { const node = document.createElement('button'); node.id = 'new-entry'; node.title = '新插件'; node.style.cssText = 'position:fixed;left:150px;top:150px;width:44px;height:44px'; document.body.append(node); });
    await page.waitForTimeout(220);
    assert.equal(await page.getByRole('switch', { name: '收纳 新插件', exact: true }).count(), 0);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    assert.equal(await page.getByRole('switch', { name: '收纳 新插件', exact: true }).isChecked(), false);
    assert.equal(await page.locator('#new-entry').isVisible(), true);
}));
test('reopening detects new entries automatically without collecting them', () => scenario(async page => {
    await open(page); await page.getByRole('button', { name: '关闭收纳面板' }).click();
    await mountReference(page, 'pyq'); await open(page);
    assert.equal(await page.getByRole('switch', { name: '收纳 小剧场生成器', exact: true }).isChecked(), false);
}));
test('saved collection persists across reload without changing other devices', () => scenario(async page => {
    await toggle(page, '记忆管理'); await page.reload();
    await page.waitForFunction(() => document.querySelector('#memory').classList.contains('ob-collected'));
    await open(page); assert.equal(await page.getByRole('switch', { name: '收纳 记忆管理', exact: true }).isChecked(), true);
    assert.equal(await page.locator('#memory').evaluate(node => node.matches(':popover-open')), true);
}));
test('collected node recreated while closed is hidden without a discovery scan', () => scenario(async page => {
    await toggle(page, '音乐播放器'); await page.getByRole('button', { name: '关闭收纳面板' }).click();
    await page.locator('#music').evaluate(node => { const next = node.cloneNode(true); next.classList.remove('ob-collected'); next.removeAttribute('aria-hidden'); node.replaceWith(next); });
    await page.waitForFunction(() => document.querySelector('#music').classList.contains('ob-collected'));
    await open(page); assert.equal(await page.locator('#music').evaluate(node => node.matches(':popover-open')), true);
}));
test('temporarily missing selected entry remains visible and can be switched off', () => scenario(async page => {
    await toggle(page, '音乐播放器'); await page.locator('#music').evaluate(node => node.remove());
    await page.getByText('当前未显示', { exact: true }).waitFor();
    await page.getByRole('switch', { name: '收纳 音乐播放器', exact: true }).uncheck();
    assert.equal(await page.getByRole('switch', { name: '收纳 音乐播放器', exact: true }).isChecked(), false);
}));
test('Pyq whole image/hitbox docks and direct input stays trusted', () => scenario(async page => {
    await mountReference(page, 'pyq'); await toggle(page, '小剧场生成器');
    assert.equal(await page.evaluate(() => referenceOpens), 0);
    assert.equal(await page.locator('#pyq-creator-float-ball').evaluate(node => node.parentElement.tagName), 'BODY');
    await page.locator('.pyq-float-ball-hitbox').click();
    assert.equal(await page.evaluate(() => referenceOpens), 1);
    await page.getByRole('button', { name: '关闭收纳面板' }).click();
    assert.equal(await page.locator('.pyq-float-ball-image').isVisible(), false);
    assert.equal(await page.locator('.pyq-float-ball-hitbox').isVisible(), false);
}));
test('Sashimi shadow pointer capture opens original expanded panel with updated geometry', () => scenario(async page => {
    await mountReference(page, 'sashimi'); await toggle(page, '生鱼片工具箱');
    await page.locator('.pet-trigger').click(); await page.locator('.pet-panel').waitFor();
    await page.waitForFunction(() => document.querySelector('#ob-panel').hidden);
    const host = await page.locator('#preset-easy-toggle-native').boundingBox();
    assert.equal(host.width, 300); assert.equal(host.height, 240);
    assert.equal(await page.evaluate(() => referenceOpens), 1);
    await page.getByRole('button', { name: '收起工具箱', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#preset-easy-toggle-native').classList.contains('ob-collected'));
}));
test('opening a sibling plugin dialog dismisses collection panel and restores control position', () => scenario(async page => {
    await mountReference(page, 'quick-presets'); await toggle(page, '楼内预设快切');
    await page.locator('.pss-fab').click(); await page.locator('#pss-panel').waitFor();
    await page.waitForFunction(() => document.querySelector('#ob-panel').hidden);
    assert.equal(await page.locator('#pss-panel').isVisible(), true);
    assert.equal(await page.locator('.pss-fab').getAttribute('popover'), null);
}));
test('collected control remains active throughout a held gesture', () => scenario(async page => {
    await toggle(page, '记忆管理'); const r = await page.locator('#memory').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#memory').isVisible(), true);
    await page.mouse.up(); await page.waitForFunction(() => calls.memory === 1);
}));
test('scrolling list keeps original control aligned with its row', () => scenario(async page => {
    await page.evaluate(() => { for (let i = 0; i < 12; i++) { const node = document.createElement('button'); node.id = 'extra-' + i; node.title = '额外' + i; node.style.cssText = 'position:fixed;left:150px;top:150px;width:40px;height:40px'; document.body.append(node); } });
    await open(page); await page.getByRole('switch', { name: '收纳 额外11', exact: true }).check();
    await page.locator('#ob-panel').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.waitForTimeout(50);
    const control = await page.locator('#extra-11').boundingBox(); const slot = await page.locator('.ob-row[data-selector="#extra-11"] .ob-control-slot').boundingBox();
    assert.ok(Math.abs(control.x + control.width / 2 - slot.x - slot.width / 2) < 2);
    assert.ok(Math.abs(control.y + control.height / 2 - slot.y - slot.height / 2) < 2);
}));
test('zero-height transformed root does not trap the panel or original control layers', () => scenario(async page => {
    await page.evaluate(() => { document.documentElement.style.height = '0px'; document.documentElement.style.transform = 'translateZ(0)'; });
    await page.locator('#extensionsMenuButton').press('Enter');
    // The fixture uses native buttons; the menu keyboard handler remains native.
    if (!(await page.locator('#ob-menu-entry').isVisible())) await page.locator('#extensionsMenuButton').press('Enter');
    await page.locator('#ob-menu-entry').press('Enter');
    await page.getByRole('switch', { name: '收纳 生成', exact: true }).check();
    const box = await page.locator('#generate').boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 800);
    await page.locator('#generate').click(); assert.equal(await page.evaluate(() => calls.generated), 1);
}));
test('mobile touch collection and direct generation/stop work without extra dialogs', () => scenario(async page => {
    await open(page); await page.getByRole('switch', { name: '收纳 生成', exact: true }).tap();
    await page.locator('#generate').tap(); await page.locator('#generate').tap();
    assert.deepEqual(await page.evaluate(() => [calls.generated, calls.stopped]), [1, 1]);
    const box = await page.locator('#ob-panel').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
}, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
test('foreign popover ownership is not taken over', () => scenario(async page => {
    await page.locator('#memory').evaluate(node => { node.setAttribute('popover', 'manual'); node.showPopover(); });
    await open(page);
    assert.equal(await page.getByRole('switch', { name: '收纳 记忆管理', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#memory').getAttribute('popover'), 'manual');
}));
test('theme follows host, overrides remain available, and original controls retain their colors', () => scenario(async page => {
    const color = await page.locator('#generate').evaluate(node => getComputedStyle(node).backgroundColor);
    await toggle(page, '生成');
    for (const light of [true, false]) {
        await theme(page, light);
        const colors = await page.locator('#ob-panel').evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]);
        const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
        assert.ok(contrast(rgb(colors[0]), rgb(colors[1])) >= 4.5);
    }
    assert.equal(await page.locator('#generate').evaluate(node => getComputedStyle(node).backgroundColor), color);
    await page.getByRole('button', { name: '关闭收纳面板' }).click(); await settings(page);
    await page.getByRole('combobox', { name: '界面主题' }).selectOption('light');
    assert.equal(await page.locator('#ob-root').getAttribute('data-ob-tone'), 'light');
}));
test('entry modes, missing menu fallback and lifecycle recovery remain available', () => scenario(async page => {
    await settings(page); await page.getByRole('combobox', { name: '打开方式' }).selectOption('both');
    assert.equal(await page.locator('.ob-launcher').isVisible(), true);
    await toggle(page, '记忆管理');
    await page.evaluate(async () => (await import('/scripts/extensions/third-party/one-button/index.js')).onDisable());
    assert.equal(await page.locator('#memory').getAttribute('popover'), null);
    assert.equal(await page.locator('#memory').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('#ob-root,#ob-menu-entry').count(), 0);
    await page.evaluate(async () => (await import('/scripts/extensions/third-party/one-button/index.js')).onEnable());
    await page.locator('#extensionsMenu').evaluate(node => node.remove()); await page.locator('.ob-launcher').waitFor();
}));
test('legacy settings normalization and device partition preserve selections', () => {
    const context = { extensionSettings: { one_button: { entries: [{ selector: '#pyq-creator-float-ball > div:nth-of-type(2)', name: '小剧场' }] } }, saveSettingsDebounced() {} };
    const first = loadSettings(context, 'desktop'); first.save();
    assert.deepEqual(first.settings.entries, [{ selector: '#pyq-creator-float-ball', name: '小剧场' }]);
    assert.equal(loadSettings(context, 'phone').settings.entries.length, 0);
});
test('update checks remain explicit and use correct scope/CSRF', () => scenario(async page => {
    const posts = [];
    await page.route('**/api/extensions/**', async route => {
        const req = route.request(), endpoint = req.url().split('/').at(-1);
        if (endpoint === 'discover') return route.fulfill({ json: [{ name: 'third-party/one-button', type: 'global' }] });
        posts.push({ endpoint, data: req.postDataJSON(), csrf: req.headers()['x-csrf-token'] }); await route.fulfill({ json: { isUpToDate: false } });
    });
    await settings(page); await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await page.getByRole('button', { name: '更新 One Button', exact: true }).waitFor(); assert.equal(posts.length, 1); assert.equal(posts[0].csrf, 'fixture');
    await page.getByRole('button', { name: '更新 One Button', exact: true }).click(); await page.getByRole('button', { name: '刷新页面应用更新' }).waitFor(); assert.equal(posts[1].endpoint, 'update');
}));
test('reference controls preview stays single-level in both themes and mobile', () => scenario(async page => {
    await page.evaluate(() => { for (const n of document.querySelectorAll('#memory,#music,#wrapped,#generate')) n.remove(); });
    await mountReference(page, 'pyq'); await mountReference(page, 'sashimi');
    // Move the outside control away from the eventual collection panel.
    await toggle(page, '小剧场生成器');
    if (process.env.PREVIEW_DIR) {
        await page.mouse.move(0, 0);
        for (const light of [false, true]) { await theme(page, light); await page.screenshot({ path: process.env.PREVIEW_DIR + `/v3-${light ? 'light' : 'dark'}.png` }); }
        await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: process.env.PREVIEW_DIR + '/v3-mobile.png' });
    }
}));
test('collected controls cannot intercept clicks outside the scrolling panel', () => scenario(async page => {
    await page.evaluate(() => { for (let i = 0; i < 20; i++) { const n = document.createElement('button'); n.id = 'scroll-' + i; n.title = '滚动' + i; n.style.cssText = 'position:fixed;left:160px;top:160px;width:40px;height:40px'; document.body.append(n); } });
    await open(page); await page.getByRole('checkbox', { name: '全部收纳', exact: true }).check();
    assert.equal(await page.locator('#ob-panel').evaluate(panel => {
        const r = panel.getBoundingClientRect();
        for (const n of document.querySelectorAll('[id^="scroll-"]')) {
            const b = n.getBoundingClientRect();
            if (b.top >= r.top && b.bottom <= r.bottom) continue;
            const x = Math.max(1, Math.min(innerWidth - 1, b.left + b.width / 2)), y = Math.max(1, Math.min(innerHeight - 1, b.top + b.height / 2));
            if (n.contains(document.elementFromPoint(x, y))) return false;
        }
        return true;
    }), true);
}));
test('one bulk toggle exposes off, mixed and on states with predictable clicks', () => scenario(async page => {
    await open(page);
    const all = page.getByRole('checkbox', { name: '全部收纳', exact: true });
    assert.equal(await all.getAttribute('aria-checked'), 'false');
    await page.getByRole('switch', { name: '收纳 记忆管理', exact: true }).check();
    assert.equal(await all.getAttribute('aria-checked'), 'mixed');
    await all.click();
    assert.equal(await all.getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('.ob-row .ob-switch[aria-checked=\"true\"]').count(), 4);
    await all.click();
    assert.equal(await all.getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('.ob-row .ob-switch[aria-checked=\"true\"]').count(), 0);
}));
test('native popover adds no artificial border, padding or background to a div entrance', () => scenario(async page => {
    await mountReference(page, 'pyq');
    const before = await page.locator('#pyq-creator-float-ball').evaluate(n => { const s=getComputedStyle(n);return [s.borderTopWidth,s.paddingTop,s.backgroundColor]; });
    await toggle(page, '小剧场生成器');
    const after = await page.locator('#pyq-creator-float-ball').evaluate(n => { const s=getComputedStyle(n);return [s.borderTopWidth,s.paddingTop,s.backgroundColor]; });
    assert.deepEqual(after, before);
}));
test('visible entry choice immediately switches menu, ball or both and persists', () => scenario(async page => {
    await open(page);
    const choice = page.getByRole('combobox', { name: '入口方式', exact: true });
    assert.equal(await choice.inputValue(), 'menu');
    await choice.selectOption('floating');
    assert.equal(await page.locator('.ob-launcher').isVisible(), true);
    assert.equal(await page.locator('#ob-menu-entry').getAttribute('hidden'), '');
    await choice.selectOption('both');
    assert.equal(await page.locator('#ob-menu-entry').getAttribute('hidden'), null);
    await page.reload(); await open(page);
    assert.equal(await page.getByRole('combobox', { name: '入口方式', exact: true }).inputValue(), 'both');
    await page.getByRole('combobox', { name: '入口方式', exact: true }).selectOption('menu');
    assert.equal(await page.locator('.ob-launcher').isVisible(), false);
}));
test('cross-origin iframe control works directly in its slot without DOM relocation', () => scenario(async page => {
    await page.evaluate(url => {
        window.foreignTrusted = null;
        addEventListener('message', e => { if (e.origin === url && e.data?.kind === 'foreign-activated') foreignTrusted = e.data.trusted; });
        const n = document.createElement('iframe'); n.id = 'foreign-entry'; n.title = '跨域入口'; n.src = url;
        n.style.cssText = 'position:fixed;left:160px;top:160px;width:64px;height:64px;border:0'; document.body.append(n);
    }, foreignOrigin);
    await page.frameLocator('#foreign-entry').locator('button').waitFor();
    await toggle(page, '跨域入口'); await page.frameLocator('#foreign-entry').locator('button').click();
    await page.waitForFunction(() => foreignTrusted === true);
    assert.equal(await page.locator('#foreign-entry').evaluate(n => n.parentElement.tagName), 'BODY');
}));
test('theme checkbox/checkmark and generic button decorations cannot overlay our switches', () => scenario(async page => {
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = 'input[type=checkbox]::before{content:"";box-shadow:inset 1em 1em hotpink;clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0,43% 62%)} button::before{content:"♥"!important;color:hotpink} button{padding:15px;border-radius:0}';
        document.head.append(style);
    });
    await open(page);
    const all = page.getByRole('checkbox', { name: '全部收纳', exact: true });
    assert.equal(await all.evaluate(n => n.tagName), 'BUTTON');
    await all.click(); assert.equal(await all.getAttribute('aria-checked'), 'true');
    const visual = await all.evaluate(n => ({ width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,before:getComputedStyle(n,'::before').content,after:getComputedStyle(n,'::after').content,thumb:n.querySelectorAll('.ob-thumb').length }));
    assert.deepEqual(visual, { width:36,height:22,before:'none',after:'none',thumb:1 });
}));
test('original transform animation does not shrink on opening and never accumulates scale', () => scenario(async page => {
    await mountReference(page, 'pyq');
    await page.locator('#pyq-creator-float-ball').evaluate(n => { n.style.transition = 'transform 120ms ease, opacity 200ms ease'; });
    const original = await page.locator('#pyq-creator-float-ball').evaluate(n => ({ style:n.style.cssText,width:n.offsetWidth }));
    await toggle(page, '小剧场生成器');
    for (let i=0;i<3;i++) {
        const shown = await page.locator('#pyq-creator-float-ball').evaluate(n => ({ duration:getComputedStyle(n).transitionDuration,width:n.getBoundingClientRect().width }));
        assert.equal(shown.duration, '0s'); assert.ok(Math.abs(shown.width-44)<1);
        await page.getByRole('button', { name:'关闭收纳面板' }).click();
        assert.equal(await page.locator('#pyq-creator-float-ball').evaluate(n=>n.offsetWidth), original.width);
        await open(page);
    }
    await toggle(page, '小剧场生成器', false);
    assert.equal(await page.locator('#pyq-creator-float-ball').evaluate(n=>n.style.cssText), original.style);
}));

test('companion timer is not an entrance and follows collection even while its owner is docked', () => scenario(async page => {
    await mountReference(page, 'echo');
    await open(page);
    assert.equal(await page.getByRole('switch').count(), 5); // Four fixture controls plus Echo.
    assert.equal(await page.getByRole('switch', { name: '收纳 0.0s', exact: true }).count(), 0);
    await toggle(page, '回声工具箱');
    assert.equal(await page.locator('#titania-timer').isVisible(), false);
    assert.equal(await page.locator('#titania-float-btn').isVisible(), true);
    await page.getByRole('button', { name: '关闭收纳面板' }).click();
    assert.equal(await page.locator('#titania-timer').isVisible(), false);
    await toggle(page, '回声工具箱', false);
    assert.equal(await page.locator('#titania-timer').isVisible(), true);
    assert.equal(await page.locator('#titania-timer').getAttribute('aria-hidden'), null);
}));
test('saved companion selections are removed while real entrance choices are preserved', () => {
    const entries = [
        { selector: '#titania-timer', name: '0.0s' },
        { selector: '#titania-timer > span:nth-of-type(1)', name: '计时' },
        { selector: '#titania-float-btn', name: '回声工具箱' },
        { selector: '#other-timer', name: '0.0s' },
    ];
    assert.deepEqual(normalizeSettings({ entries }).entries, entries.slice(2));
});

test('known entrances stay inside their slots after repeated off/on and close/open cycles', () => scenario(async page => {
    for (const kind of ['pyq', 'quick-presets', 'echo', 'sashimi']) await mountReference(page, kind);
    const entries = [['小剧场生成器','#pyq-creator-float-ball'],['楼内预设快切','#pss-root .pss-fab'],['回声工具箱','#titania-float-btn'],['生鱼片工具箱','#preset-easy-toggle-native']];
    await open(page);
    for (const [name,selector] of entries) {
        await toggle(page,name);
        for(let i=0;i<3;i++) {
            await toggle(page,name,false); await toggle(page,name,true);
            const node=await page.locator(selector).boundingBox();
            const slot=await page.locator('.ob-row').filter({has:page.getByRole('switch',{name:`收纳 ${name}`,exact:true})}).locator('.ob-control-slot').boundingBox();
            assert.ok(Math.abs(node.x+node.width/2-slot.x-slot.width/2)<2, `${name}: horizontal alignment`);
            assert.ok(Math.abs(node.y+node.height/2-slot.y-slot.height/2)<2, `${name}: vertical alignment`);
            await page.getByRole('button',{name:'关闭收纳面板'}).click();
            assert.equal(await page.locator(selector).isVisible(),false);
            await open(page);
        }
    }
}));

test('composited light and shadow entrances leave no pixels at their original positions after recollection', () => scenario(async page => {
    await page.locator('#extensionsMenuButton').evaluate(node => { node.style.left='auto'; node.style.right='18px'; });
    const clip={x:100,y:100,width:100,height:170};
    const empty=await page.screenshot({clip});
    await mountReference(page,'echo'); await mountReference(page,'sashimi');
    await page.locator('#titania-float-btn').evaluate(node => {
        node.style.background='#475569'; node.style.backdropFilter='blur(8px)'; node.style.willChange='transform';
    });
    await page.locator('#preset-easy-toggle-native').evaluate(node => {
        node.style.willChange='transform';
        const style=document.createElement('style');
        style.textContent='.pet-trigger{backdrop-filter:blur(8px);transform:translateZ(0)}';
        node.shadowRoot.append(style);
    });
    await toggle(page,'回声工具箱'); await toggle(page,'生鱼片工具箱');
    for(const name of ['回声工具箱','生鱼片工具箱']) {
        for(let i=0;i<3;i++) {
            await toggle(page,name,false); await toggle(page,name,true);
            const actual=await page.screenshot({clip});
            assert.equal(actual.equals(empty),true,`${name}: original position must be visually empty`);
        }
    }
    await page.getByRole('button',{name:'关闭收纳面板'}).click();
    assert.equal((await page.screenshot({clip})).equals(empty),true,'closed collection must leave no old entrance pixels');
}));

test('background dismissal hides collected entrances from the first frame despite original visibility transitions', () => scenario(async page => {
    await mountReference(page,'echo'); await mountReference(page,'sashimi');
    await page.locator('#titania-float-btn,#preset-easy-toggle-native').evaluateAll(nodes => {
        for(const node of nodes) node.style.transition='all 1s ease';
    });
    const originalTransition=await page.locator('#titania-float-btn').evaluate(node => { const style=getComputedStyle(node); return [style.transitionProperty,style.transitionDuration,style.transitionTimingFunction]; });
    await toggle(page,'回声工具箱'); await toggle(page,'生鱼片工具箱');
    await page.evaluate(() => {
        window.dismissFrames=[];
        document.addEventListener('pointerdown', () => {
            const sample=() => {
                dismissFrames.push(['#titania-float-btn','#preset-easy-toggle-native'].map(selector => {
                    const node=document.querySelector(selector);
                    return {selector,visibility:getComputedStyle(node).visibility};
                }));
                if(dismissFrames.length<12) requestAnimationFrame(sample);
            };
            sample();
        },{once:true});
    });
    await page.mouse.click(1050,40);
    await page.waitForFunction(() => dismissFrames.length===12);
    assert.equal(await page.locator('#ob-panel').isVisible(),false);
    const frames=await page.evaluate(() => dismissFrames);
    assert.ok(frames.flat().every(sample=>sample.visibility==='hidden'),'no visible transition frame after clicking the background: '+JSON.stringify(frames));
    assert.equal(await page.evaluate(() => referenceOpens),0);
    await open(page);
    assert.equal(await page.locator('#titania-float-btn').isVisible(),true);
    await toggle(page,'回声工具箱',false);
    const restoredTransition=await page.locator('#titania-float-btn').evaluate(node => { const style=getComputedStyle(node); return [style.transitionProperty,style.transitionDuration,style.transitionTimingFunction]; });
    assert.deepEqual(restoredTransition,originalTransition);
}));

import { Collector, resolveTarget } from './core.js';
import { isExpanded } from './adapters.js';
import { discoverEntrances } from './discovery.js';
import { DockManager } from './docking.js';
import { deviceId, loadSettings } from './settings.js';
import { mountTheme } from './theme.js';
import { mountUpdates } from './updates.js';

let cleanup;
function start() {
    cleanup?.();
    const context = globalThis.SillyTavern?.getContext();
    if (!context?.extensionSettings || !context.saveSettingsDebounced) return;
    const id = deviceId(), { settings, save } = loadSettings(context, id);
    if (!settings.enabled) settings.entries = [];
    settings.enabled = true;
    const collector = new Collector(), dock = new DockManager();
    const lifetime = new AbortController();
    const listen = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: lifetime.signal });
    const el = (tag, cls = '', text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
    const button = (text, fn, cls = 'ob-button') => { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', fn); return node; };
    const root = el('div'); root.id = 'ob-root';
    const panel = el('section', 'ob-panel'); panel.id = 'ob-panel'; panel.hidden = true; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', '入口收纳');
    const launcher = button('▦', () => { if (dragged) { dragged = false; return; } setOpen(panel.hidden, launcher); }, 'ob-launcher');
    launcher.title = '入口收纳 · 可拖动'; launcher.setAttribute('aria-label', '打开入口收纳'); launcher.setAttribute('aria-controls', panel.id);
    const head = el('div', 'ob-head');
    const close = button('×', () => setOpen(false), 'ob-icon-button'); close.setAttribute('aria-label', '关闭收纳面板');
    head.append(el('strong', '', '入口收纳'), close);
    const summary = el('p', 'ob-muted ob-summary'); summary.setAttribute('role', 'status');
    const tools = el('div', 'ob-tools');
    const bulkLabel = el('div', 'ob-bulk');
    const bulk = el('button', 'ob-switch'); bulk.type = 'button'; bulk.setAttribute('role', 'checkbox'); bulk.setAttribute('aria-label', '全部收纳'); bulk.setAttribute('aria-checked', 'false'); bulk.append(el('span', 'ob-thumb')); bulk.firstChild.setAttribute('aria-hidden', 'true');
    listen(bulkLabel, 'click', () => { if (!bulk.disabled) setAll(bulk.getAttribute('aria-checked') !== 'true'); });
    bulkLabel.append(el('span', '', '全部收纳'), bulk);
    tools.append(button('刷新', () => refresh()), bulkLabel);
    const list = el('div', 'ob-list');
    const message = el('p', 'ob-message'); message.setAttribute('role', 'status');
    const entryMode = el('label', 'ob-entry-mode');
    const entrySelect = el('select'); entrySelect.setAttribute('aria-label', '入口方式');
    for (const [value, text] of [['menu', '菜单'], ['floating', '悬浮球'], ['both', '菜单＋悬浮球']]) {
        const option = el('option', '', text); option.value = value; entrySelect.append(option);
    }
    entrySelect.value = settings.entryMode;
    listen(entrySelect, 'change', () => {
        settings.entryMode = entrySelect.value; save(); ensureMenu(); place();
        settingsUI.querySelector('[aria-label="打开方式"]').value = settings.entryMode;
    });
    entryMode.append(el('span', '', '入口方式'), entrySelect);
    panel.append(head, summary, tools, list, message, entryMode); root.append(launcher, panel); document.body.append(root);
    const settingsUI = el('div'); settingsUI.id = 'ob-settings';
    settingsUI.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>One Button · 入口收纳</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"></div></div>';
    const settingsBody = settingsUI.querySelector('.inline-drawer-content');
    const settingsActions = el('div', 'ob-tools');
    settingsActions.append(button('打开收纳区', () => setOpen(true)), button('全部不收纳', () => setAll(false)));
    settingsBody.append(settingsActions);
    function selectSetting(label, key, choices) {
        const row = el('label', 'ob-setting'), select = el('select', 'ob-input');
        select.setAttribute('aria-label', label);
        for (const [value, text] of choices) { const option = el('option', '', text); option.value = value; select.append(option); }
        select.value = settings[key];
        listen(select, 'change', () => { settings[key] = select.value; entrySelect.value = settings.entryMode; save(); ensureMenu(); theme.update(); place(); });
        row.append(el('span', '', label), select); settingsBody.append(row);
    }
    selectSetting('打开方式', 'entryMode', [['menu', '扩展菜单'], ['floating', '悬浮按钮'], ['both', '菜单和悬浮按钮']]);
    selectSetting('界面主题', 'theme', [['host', '跟随酒馆'], ['light', '浅色'], ['dark', '深色']]);
    settingsBody.append(button('重置悬浮按钮位置', () => { settings.x = 1; settings.y = .7; save(); place(); }));
    const fallback = el('p', 'ob-muted'); settingsBody.append(fallback);
    settingsBody.append(el('small', 'ob-muted', '打开时检测入口；新入口默认不收纳。设置按当前浏览器保存。'));
    document.querySelector('#extensions_settings2, #extensions_settings')?.append(settingsUI);
    const theme = mountTheme([root, settingsUI], () => settings.theme), stopUpdates = mountUpdates(settingsUI, context);
    let catalog = [], rows = new Map(), menuEntry = null, anchor = null, previousFocus = null;
    let dragged = false, drag = null, disposed = false, timer, frame = 0, externalAtOpen = '';
    let targetObserver = new MutationObserver(() => schedule());

    const selected = css => settings.entries.some(entry => entry.selector === css);
    function notify(text = '') { message.textContent = text; place(); }
    function ensureMenu() {
        const host = document.querySelector('#extensionsMenu');
        if (menuEntry?.parentElement !== host) { menuEntry?.remove(); menuEntry = null; }
        if (host && !menuEntry) {
            menuEntry = button('入口收纳', event => { setOpen(true, document.querySelector('#extensionsMenuButton') || event.currentTarget); host.style.display = 'none'; }, 'list-group-item flex-container flexGap5');
            menuEntry.id = 'ob-menu-entry'; menuEntry.setAttribute('aria-controls', panel.id); host.append(menuEntry);
        }
        if (menuEntry) { menuEntry.hidden = settings.entryMode === 'floating'; menuEntry.setAttribute('aria-expanded', String(!panel.hidden)); }
        launcher.hidden = settings.entryMode === 'menu' && !!host;
        launcher.setAttribute('aria-expanded', String(!panel.hidden));
        fallback.textContent = !host && settings.entryMode === 'menu' ? '未找到酒馆扩展菜单，已显示悬浮按钮。' : id === 'storage-unavailable' ? '浏览器无法记忆设备标识。' : '';
    }
    function externalPanels() {
        return [...document.querySelectorAll('dialog[open], [role="dialog"], #pyq-creator-panel.pyq-open')].filter(node => !root.contains(node) && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => node.id || node.className).join('|');
    }
    function releaseCollected() {
        // Hide before restoring the original position and transition rules.
        collector.setExposed([]); collector.sync(settings);
        dock.releaseAll(); collector.sync(settings);
    }
    function setOpen(open, origin) {
        if (dock.active.size && !open) { pendingClose = true; return; }
        if (open) {
            if (!panel.hidden) return;
            previousFocus = document.activeElement; anchor = origin || (!launcher.hidden ? launcher : document.querySelector('#extensionsMenuButton'));
            panel.hidden = false;
            try { panel.showPopover(); } catch { panel.hidden = true; fallback.textContent = '当前浏览器无法打开收纳面板，请更新浏览器。'; return; }
            theme.update(); externalAtOpen = externalPanels(); refresh(); close.focus();
        } else {
            releaseCollected();
            try { if (panel.matches(':popover-open')) panel.hidePopover(); } catch { /* page teardown */ }
            panel.hidden = true;
            if (panel.contains(document.activeElement)) {
                if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
                else document.querySelector('#extensionsMenuButton')?.focus();
            }
        }
        ensureMenu();
    }
    function refresh() {
        if (dock.active.size) return;
        releaseCollected();
        const found = discoverEntrances(), detected = new Map(found.map(item => [item.selector, item]));
        const existing = new Map(catalog.filter(item => detected.has(item.selector) || selected(item.selector)).map(item => [item.selector, detected.get(item.selector) || item]));
        for (const item of found) existing.set(item.selector, item);
        // A refresh reflects current detection, while saved/recently-known entries
        // retain their row if temporarily missing. Newly discovered entries stay off.
        catalog = [...existing.values()];
        for (const entry of settings.entries) if (!catalog.some(item => item.selector === entry.selector)) catalog.push({ ...entry });
        render();
    }
    function setCollected(item, value) {
        if (dock.active.size) { const row = rows.get(item.selector); if (row) row.toggle.setAttribute('aria-checked', String(selected(item.selector))); return; }
        const { target } = resolveTarget(item.selector, document, true);
        if (value && (!target || !dock.canDock(target) || isExpanded(target))) { notify('这个入口当前无法安全收纳，请先收起插件面板或保持在外。'); return; }
        if (value && !selected(item.selector)) settings.entries.push({ selector: item.selector, name: item.name });
        if (!value) settings.entries = settings.entries.filter(entry => entry.selector !== item.selector);
        save(); syncControls();
    }
    function setAll(value) {
        if (dock.active.size) return;
        if (value) {
            for (const item of catalog) {
                const { target } = resolveTarget(item.selector, document, true);
                if (!selected(item.selector) && target && dock.canDock(target) && !isExpanded(target)) settings.entries.push({ selector: item.selector, name: item.name });
            }
        } else settings.entries = [];
        save(); syncControls();
    }
    function render() {
        releaseCollected();
        targetObserver.disconnect(); rows.clear(); list.replaceChildren();
        if (!catalog.length) list.append(el('p', 'ob-muted ob-empty', '未检测到可收纳的悬浮入口。'));
        for (const item of catalog) {
            const row = el('div', 'ob-row'); row.dataset.selector = item.selector;
            const slot = el('div', 'ob-control-slot'); slot.setAttribute('aria-label', `${item.name}原控件`);
            const caption = el('div', 'ob-caption'); caption.append(el('span', '', item.name));
            const status = el('small', 'ob-muted'); caption.append(status);
            const toggle = el('button', 'ob-switch'); toggle.type = 'button'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `收纳 ${item.name}`); toggle.setAttribute('aria-checked', 'false'); toggle.append(el('span', 'ob-thumb')); toggle.firstChild.setAttribute('aria-hidden', 'true');
            listen(toggle, 'click', () => setCollected(item, !selected(item.selector)));
            row.append(slot, caption, toggle); list.append(row); rows.set(item.selector, { item, slot, status, toggle });
        }
        syncControls();
    }
    function watchTargets() {
        targetObserver.disconnect();
        for (const entry of settings.entries) {
            const { target } = resolveTarget(entry.selector, document, true);
            if (!target) continue;
            targetObserver.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
            if (target.shadowRoot) targetObserver.observe(target.shadowRoot, { childList: true, subtree: true });
        }
    }
    function syncControls() {
        if (disposed || dock.active.size) return;
        const wanted = new Map(), exposed = new Set();
        let changed = false;
        for (const entry of [...settings.entries]) {
            const { target } = resolveTarget(entry.selector, document, true);
            if (!target) continue;
            if (!dock.canDock(target)) {
                dock.release(target); settings.entries = settings.entries.filter(item => item.selector !== entry.selector); changed = true;
                notify(`「${entry.name}」暂不支持直接收纳，已保留在外。`); continue;
            }
            if (dock.expanded(target)) { dock.release(target); exposed.add(target); continue; }
            if (!panel.hidden && rows.has(entry.selector)) { wanted.set(target, rows.get(entry.selector).slot); exposed.add(target); }
        }
        for (const node of dock.nodes) if (!wanted.has(node)) dock.release(node);
        collector.setExposed(exposed); collector.sync(settings);
        place(false);
        for (const [node, slot] of wanted) if (!dock.attach(node, slot)) {
            const item = catalog.find(item => resolveTarget(item.selector, document, true).target === node);
            if (item) { settings.entries = settings.entries.filter(entry => entry.selector !== item.selector); changed = true; }
            notify('有入口无法直接操作，已恢复在外。');
        }
        if (changed) { save(); collector.setExposed(dock.nodes); collector.sync(settings); }
        for (const { item, status, toggle } of rows.values()) {
            const { target } = resolveTarget(item.selector, document, true);
            toggle.setAttribute('aria-checked', String(selected(item.selector)));
            toggle.disabled = !selected(item.selector) && (!target || !dock.canDock(target) || isExpanded(target));
            status.textContent = !target ? '当前未显示' : !dock.canDock(target) ? '暂不支持收纳' : isExpanded(target) ? '面板已打开' : '';
        }
        summary.textContent = `已检测到 ${catalog.filter(item => !!resolveTarget(item.selector, document, true).target).length} 个入口 · 已收纳 ${settings.entries.length} 个`;
        const available = catalog.filter(item => {
            const { target } = resolveTarget(item.selector, document, true);
            return selected(item.selector) || (target && dock.canDock(target) && !isExpanded(target));
        });
        const count = available.filter(item => selected(item.selector)).length;
        const all = available.length > 0 && count === available.length;
        const mixed = count > 0 && !all;
        bulk.disabled = !available.length;
        bulk.setAttribute('aria-checked', mixed ? 'mixed' : String(all));
        watchTargets(); place();
    }
    function place(updateDock = true) {
        const view = window.visualViewport, w = view?.width || innerWidth, h = view?.height || innerHeight, l = view?.offsetLeft || 0, t = view?.offsetTop || 0;
        launcher.style.left = `${l + 12 + settings.x * Math.max(0, w - 68)}px`; launcher.style.top = `${t + 12 + settings.y * Math.max(0, h - 68)}px`;
        if (panel.hidden) return;
        panel.style.width = `${Math.min(360, w - 24)}px`; panel.style.maxHeight = `${h - 24}px`;
        const r = anchor?.getBoundingClientRect(), ph = panel.getBoundingClientRect().height, pw = panel.getBoundingClientRect().width;
        const x = r?.width ? r.left : l + (w - pw) / 2;
        const y = r?.height ? (r.top - t > h / 2 ? r.top - ph - 8 : r.bottom + 8) : t + (h - ph) / 2;
        panel.style.left = `${Math.max(l + 12, Math.min(l + w - pw - 12, x))}px`; panel.style.top = `${Math.max(t + 12, Math.min(t + h - ph - 12, y))}px`;
        if (updateDock) dock.update();
    }
    function schedule() {
        if (disposed || frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0; if (dock.active.size) return;
            if (!panel.hidden && ([...dock.nodes].some(node => dock.expanded(node)) || externalPanels() !== externalAtOpen)) setOpen(false);
            syncControls(); ensureMenu();
        });
    }
    let pendingClose = false;
    listen(document, 'pointerdown', event => {
        if (dock.contains(event.target)) { dock.active.add(event.pointerId); return; }
        if (!root.contains(event.target) && !menuEntry?.contains(event.target)) setOpen(false);
    }, { capture: true });
    for (const type of ['pointerup', 'pointercancel']) listen(document, type, event => {
        if (!dock.active.has(event.pointerId)) return;
        requestAnimationFrame(() => { dock.active.delete(event.pointerId); if (pendingClose) { pendingClose = false; setOpen(false); } schedule(); });
    }, { capture: true });
    listen(document, 'click', event => { if (dock.contains(event.target)) schedule(); });
    listen(document, 'keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false); } });
    listen(panel, 'scroll', () => dock.update());
    listen(launcher, 'pointerdown', event => { if (event.button !== 0) return; dragged = false; drag = { x: event.clientX, y: event.clientY, left: parseFloat(launcher.style.left), top: parseFloat(launcher.style.top) }; launcher.setPointerCapture(event.pointerId); });
    listen(launcher, 'pointermove', event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.hypot(dx, dy) > 6) dragged = true; if (!dragged) return; const v = window.visualViewport; settings.x = Math.max(0, Math.min(1, (drag.left + dx - (v?.offsetLeft || 0) - 12) / Math.max(1, (v?.width || innerWidth) - 68))); settings.y = Math.max(0, Math.min(1, (drag.top + dy - (v?.offsetTop || 0) - 12) / Math.max(1, (v?.height || innerHeight) - 68))); place(); });
    listen(launcher, 'pointerup', () => { if (dragged) save(); drag = null; }); listen(launcher, 'pointercancel', () => { drag = null; dragged = false; });
    listen(window, 'resize', () => place()); if (window.visualViewport) { listen(window.visualViewport, 'resize', () => place()); listen(window.visualViewport, 'scroll', () => place()); }
    const observer = new MutationObserver(records => {
        if (!records.some(record => !root.contains(record.target) && !settingsUI.contains(record.target) && record.target.id !== 'ob-menu-entry')) return;
        if (timer) return;
        timer = setTimeout(() => { timer = undefined; if (panel.hidden) syncControls(); else schedule(); ensureMenu(); }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    syncControls(); ensureMenu(); place(); save();
    cleanup = () => { disposed = true; lifetime.abort(); observer.disconnect(); targetObserver.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); dock.destroy(); collector.destroy(); theme.destroy(); stopUpdates(); menuEntry?.remove(); root.remove(); settingsUI.remove(); };
}
export function onDisable() { cleanup?.(); cleanup = undefined; }
export function onDelete() { onDisable(); }
export function onEnable() { start(); }
const context = globalThis.SillyTavern?.getContext(), events = context?.eventTypes || context?.event_types;
if (context?.eventSource && events?.APP_READY) context.eventSource.on(events.APP_READY, start);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

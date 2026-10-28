import { ADAPTERS, adapterFor, adapterSelector, isExpanded } from './adapters.js';

export const KEY = 'one_button';
export const HIDDEN = 'ob-collected';
const PROTECTED = '#ob-root, #ob-settings, #ob-menu-entry, #extensionsMenu, #chat, #top-bar, #top-settings-holder, #extensionsMenuButton, #send_form, #left-nav-panel, #right-nav-panel, #extensions_settings, #extensions_settings2, dialog, [role="dialog"]';

export function normalizeSettings(value) {
    const seen = new Set();
    const entries = Array.isArray(value?.entries) ? value.entries.flatMap(entry => {
        if (!entry || typeof entry.selector !== 'string' || !entry.selector.trim()) return [];
        const original = entry.selector.trim();
        const selector = /^#pyq-creator-float-ball(?:$|[ >.:\[])/.test(original) || original === '.pyq-float-ball-hitbox' ? '#pyq-creator-float-ball' : original;
        if (seen.has(selector)) return [];
        seen.add(selector);
        return [{ selector, name: String(entry.name || selector).slice(0, 100) }];
    }) : [];
    const unit = (n, fallback) => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
    return {
        enabled: value?.enabled !== false, entries,
        entryMode: ['menu', 'floating', 'both'].includes(value?.entryMode) ? value.entryMode : 'menu',
        theme: ['host', 'light', 'dark'].includes(value?.theme) ? value.theme : 'host',
        x: unit(value?.x, 1), y: unit(value?.y, 0.7),
    };
}

export function resolveTarget(selector, doc = document, allowExpanded = false) {
    try {
        const matches = doc.querySelectorAll(selector);
        if (matches.length !== 1) return { error: matches.length ? '选择器匹配了多个元素，请缩小范围。' : '暂未找到入口，插件可能还没加载。' };
        const target = matches[0];
        if (!(target instanceof doc.defaultView.HTMLElement)) return { error: '请选择 HTML 按钮或悬浮入口。' };
        if (target.matches(PROTECTED) || target.closest(PROTECTED) || target.querySelector(PROTECTED) || ['HTML', 'BODY', 'SCRIPT', 'STYLE', 'LINK'].includes(target.tagName)) {
            return { error: '这是主界面、弹窗或收纳插件本身，不能收纳。' };
        }
        const rect = target.getBoundingClientRect();
        const adapter = adapterFor(target);
        if ((rect.width > 180 || rect.height > 180) && !allowExpanded && adapter?.id !== 'sashimi' && !adapter?.standalone) return { error: '选中区域太大，请选择悬浮入口本身。' };
        return { target };
    } catch {
        return { error: '选择器无效，请检查 CSS 选择器格式。' };
    }
}

export function selectorFor(element, doc = document) {
    const known = adapterSelector(element);
    if (known && doc.querySelectorAll(known).length === 1) return known;
    for (let node = element; node && node !== doc.body; node = node.parentElement) {
        if (!node.id) continue;
        const prefix = `#${CSS.escape(node.id)}`;
        if (node === element && doc.querySelectorAll(prefix).length === 1) return prefix;
        const path = [];
        for (let child = element; child !== node; child = child.parentElement) {
            path.unshift(`${child.localName}:nth-of-type(${Array.from(child.parentElement.children).filter(sibling => sibling.localName === child.localName).indexOf(child) + 1})`);
        }
        const selector = `${prefix} > ${path.join(' > ')}`;
        if (doc.querySelectorAll(selector).length === 1) return selector;
    }
    const classes = Array.from(element.classList).filter(name => name !== HIDDEN && !/^(active|open|selected|hover|focus|fa-|ui-)/.test(name));
    if (classes.length) {
        const selector = element.localName + classes.map(name => `.${CSS.escape(name)}`).join('');
        if (doc.querySelectorAll(selector).length === 1) return selector;
    }
    return null;
}

export function pickTarget(element) {
    if (!(element instanceof Element) || element.closest(PROTECTED)) return null;
    if (!(element instanceof HTMLElement)) element = element.closest('button, a, [role="button"]') || element.parentElement;
    if (!element) return null;
    for (const adapter of ADAPTERS) {
        const host = element.closest(adapter.selector);
        if (host && resolveTarget(adapter.selector).target && !isExpanded(host)) return host;
    }
    let actionable = element.closest('button, a, [role="button"], [onclick], [tabindex]') || element;
    let candidate = null;
    // Prefer the outer fixed entrance, not an absolute image/hitbox inside it.
    for (let node = actionable; node && node !== document.body; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const position = getComputedStyle(node).position;
        if ((position === 'fixed' || position === 'absolute') && rect.width > 0 && rect.height > 0 && rect.width <= 180 && rect.height <= 180) {
            const controls = node.querySelectorAll('button, a, [role="button"], [onclick]');
            if (controls.length <= 1) candidate = node;
            if (position === 'fixed') break;
        }
        if (rect.width > 240 || rect.height > 240) break;
    }
    return candidate ? resolveTarget(selectorFor(candidate) || ':not(*)').target || null : null;
}

export class Collector {
    constructor(doc = document) { this.doc = doc; this.hidden = new Map(); this.watchers = new Map(); this.attributes = new Map(); this.exposed = new Set(); }
    setExposed(nodes) { this.exposed = new Set(nodes); }
    restore(node) {
        const previous = this.hidden.get(node);
        if (!previous) return;
        node.classList.remove(HIDDEN);
        if (previous.aria === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previous.aria);
        this.hidden.delete(node);
    }
    sync(settings) {
        if (!settings) return;
        this.settings = settings;
        const wanted = new Set();
        const hosts = new Set();
        const targets = new Set();
        if (settings.enabled) for (const entry of settings.entries) {
            const { target } = resolveTarget(entry.selector, this.doc, true);
            if (!target) continue;
            targets.add(target);
            if (!this.attributes.has(target)) {
                const observer = new MutationObserver(() => this.sync(this.settings));
                observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
                this.attributes.set(target, observer);
            }
            const adapter = adapterFor(target);
            if (adapter?.shadowControl && target.shadowRoot) {
                hosts.add(target);
                if (!this.watchers.has(target)) {
                    const observer = new MutationObserver(() => this.sync(this.settings));
                    observer.observe(target.shadowRoot, { childList: true, subtree: true });
                    this.watchers.set(target, observer);
                }
            }
            const rect = target.getBoundingClientRect();
            if (isExpanded(target) || ((!adapter?.standalone) && (rect.width > 180 || rect.height > 180)) || this.exposed.has(target)) continue;
            wanted.add(target);
            for (const css of adapter?.companions || []) {
                const companion = this.doc.querySelector(css);
                if (companion) wanted.add(companion);
            }
        }
        for (const [host, observer] of this.watchers) if (!hosts.has(host)) { observer.disconnect(); this.watchers.delete(host); }
        for (const [node, observer] of this.attributes) if (!targets.has(node)) { observer.disconnect(); this.attributes.delete(node); }
        for (const node of this.hidden.keys()) if (!wanted.has(node)) this.restore(node);
        for (const node of wanted) {
            if (!this.hidden.has(node)) this.hidden.set(node, { aria: node.getAttribute('aria-hidden') });
            if (!node.classList.contains(HIDDEN)) node.classList.add(HIDDEN);
            if (node.getAttribute('aria-hidden') !== 'true') node.setAttribute('aria-hidden', 'true');
        }
    }
    destroy() {
        this.settings = null;
        this.exposed.clear();
        for (const observer of this.watchers.values()) observer.disconnect();
        for (const observer of this.attributes.values()) observer.disconnect();
        this.watchers.clear();
        this.attributes.clear();
        for (const node of this.hidden.keys()) this.restore(node);
    }
}

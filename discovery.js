import { ADAPTERS, adapterFor, isExpanded } from './adapters.js';
import { isRendered, pickTarget, resolveTarget, selectorFor } from './core.js';

export function discoverEntrances(doc = document) {
    const found = new Map();
    const nodes = new Set([
        ...ADAPTERS.flatMap(adapter => [...doc.querySelectorAll(adapter.selector)]),
        ...doc.querySelectorAll('div, button, a, iframe, [role="button"]'),
    ]);
    for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0 || rect.left > innerWidth || rect.top > innerHeight) continue;
        if (node.closest('#ob-root, #ob-settings, #chat, #top-settings-holder, #extensionsMenu, #send_form, dialog, [role="dialog"]')) continue;
        const known = adapterFor(node);
        if (!known?.standalone && (rect.width > 180 || rect.height > 180)) continue;
        const style = getComputedStyle(node);
        if (!known && !['fixed', 'absolute'].includes(style.position)) continue;
        if (!isRendered(node, true)) continue;
        const target = pickTarget(node);
        if (!target || isExpanded(target)) continue;
        const selector = selectorFor(target, doc);
        if (!selector || resolveTarget(selector, doc).target !== target) continue;
        const adapter = adapterFor(target);
        const control = target.shadowRoot?.querySelector('[aria-label], [title]') || target.querySelector('[aria-label], [title]');
        const name = adapter?.name || target.getAttribute('aria-label') || target.title || control?.getAttribute('aria-label') || control?.title || target.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) || target.id || `未命名入口 ${found.size + 1}`;
        const box = target.getBoundingClientRect();
        const side = box.left + box.width / 2 < innerWidth / 2 ? '左侧' : '右侧';
        found.set(selector, { selector, name, side });
    }
    return [...found.values()];
}

// DOM/event contracts observed in the reference plugins. No plugin code is bundled.
export const ADAPTERS = Object.freeze([
    { id: 'echo', name: '回声工具箱', selector: '#titania-float-btn', companions: ['#titania-timer'] },
    { id: 'sashimi', name: '生鱼片工具箱', selector: '#preset-easy-toggle-native', shadowControl: '.pet-trigger' },
    { id: 'quick-presets', name: '楼内预设快切', selector: '#pss-root .pss-fab' },
    { id: 'pyq-theater', name: '小剧场生成器', selector: '#pyq-creator-float-ball', standalone: true },
]);

export function adapterFor(node) { return ADAPTERS.find(adapter => node.matches(adapter.selector)); }
export function adapterSelector(node) { return adapterFor(node)?.selector; }
export function isExpanded(node) {
    const adapter = adapterFor(node);
    // The Sashimi host contains either its trigger or its full panel, never both.
    // An unavailable/changed shadow tree must stay visible rather than hide unknown UI.
    return adapter?.shadowControl && !node.shadowRoot?.querySelector(adapter.shadowControl);
}

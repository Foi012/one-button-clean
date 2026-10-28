import { adapterFor, isExpanded } from './adapters.js';

const BASELINE = ['border-top', 'border-right', 'border-bottom', 'border-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'background-color', 'color'];
const PROPS = ['transition', 'position', 'top', 'left', 'right', 'bottom', 'margin', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'transform', 'transform-origin', 'display', 'z-index', 'box-sizing', 'overflow', 'clip-path', 'pointer-events', ...BASELINE.map(prop => `--ob-native-${prop}`)];
const read = (node, prop) => [node.style.getPropertyValue(prop), node.style.getPropertyPriority(prop)];
const same = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

export class DockManager {
    constructor(onChange = () => {}) { this.records = new Map(); this.onChange = onChange; this.active = new Set(); this.frame = 0; }
    canDock(node) {
        return !!node && typeof node.showPopover === 'function' && (this.records.has(node) || !node.hasAttribute('popover'));
    }
    contains(target) { return [...this.records.keys()].some(node => node.contains(target)); }
    get nodes() { return new Set(this.records.keys()); }
    captureExternal(record) {
        for (const prop of PROPS) {
            const current = read(record.node, prop);
            if (record.written.has(prop) && !same(current, record.written.get(prop))) record.original.set(prop, current);
        }
    }
    write(record, prop, value) {
        const next = [value, 'important'];
        if (!same(read(record.node, prop), next)) record.node.style.setProperty(prop, value, 'important');
        record.written.set(prop, read(record.node, prop));
    }
    attach(node, slot) {
        if (!this.canDock(node) || isExpanded(node)) return false;
        let record = this.records.get(node);
        if (!record) {
            const rect = node.getBoundingClientRect();
            const width = node.offsetWidth || rect.width, height = node.offsetHeight || rect.height;
            if (!width || !height || getComputedStyle(node).display === 'none') return false;
            record = { node, slot, width, height, original: new Map(PROPS.map(prop => [prop, read(node, prop)])), written: new Map(), display: getComputedStyle(node).display, overflow: getComputedStyle(node).overflow, pointerEvents: getComputedStyle(node).pointerEvents, clipPath: getComputedStyle(node).clipPath };
            const computed = getComputedStyle(node);
            record.baseline = new Map(BASELINE.map(prop => [prop, computed.getPropertyValue(prop)]));
            if (computed.color === getComputedStyle(node.parentElement).color) record.baseline.set('color', 'inherit');
            this.records.set(node, record);
            node.classList.add('ob-native-docked');
            node.setAttribute('popover', 'manual');
            // Establish the final scale and position before entering the top layer.
            // Original transform transitions must not animate the docking change.
            this.position(record);
            try { node.showPopover(); } catch { this.release(node); return false; }
            // Some WKWebViews retain the old fixed-position renderer on re-entry.
            // Rebuild its positioning context after promotion, before the next paint.
            this.write(record, 'position', 'absolute');
            void node.offsetWidth;
        }
        record.slot = slot;
        this.position(record);
        return true;
    }
    position(record) {
        if (this.active.size) return;
        this.captureExternal(record);
        if (!record.node.classList.contains('ob-native-docked')) record.node.classList.add('ob-native-docked');
        for (const [prop, value] of record.baseline) this.write(record, `--ob-native-${prop}`, value);
        const { node, slot, width, height } = record;
        const rect = slot.getBoundingClientRect();
        const scale = Math.min(1, 44 / width, 44 / height);
        const panel = slot.closest('#ob-panel').getBoundingClientRect();
        const y = rect.top + (rect.height - height * scale) / 2;
        const inView = y >= panel.top + 1 && y + height * scale <= panel.bottom - 1 && rect.left >= panel.left && rect.right <= panel.right;
        const values = {
            transition: 'none', position: 'fixed', top: `${rect.top + (rect.height - height * scale) / 2}px`,
            left: `${rect.left + (rect.width - width * scale) / 2}px`, right: 'auto', bottom: 'auto', margin: '0px',
            width: `${width}px`, height: `${height}px`, 'min-width': '0px', 'min-height': '0px',
            'max-width': 'none', 'max-height': 'none', transform: `scale(${scale})`, 'transform-origin': '0px 0px',
            display: record.display, overflow: 'hidden', 'clip-path': inView ? record.clipPath : 'inset(100%)', 'pointer-events': inView ? record.pointerEvents : 'none', 'box-sizing': 'border-box', 'z-index': '2147483646',
        };
        for (const [prop, value] of Object.entries(values)) this.write(record, prop, value);
    }
    expanded(node) {
        const record = this.records.get(node);
        if (record) this.captureExternal(record);
        return isExpanded(node) || (!adapterFor(node)?.standalone && (node.offsetWidth > 180 || node.offsetHeight > 180));
    }
    update() { for (const record of this.records.values()) this.position(record); }
    release(node) {
        const record = this.records.get(node);
        if (!record) return;
        this.captureExternal(record);
        this.records.delete(node);
        try { if (node.matches(':popover-open')) node.hidePopover(); } catch { /* detached/rebuilt original */ }
        node.removeAttribute('popover');
        node.classList.remove('ob-native-docked');
        for (const [prop, [value, priority]] of record.original) {
            if (value) node.style.setProperty(prop, value, priority); else node.style.removeProperty(prop);
        }
    }
    releaseAll() { for (const node of [...this.records.keys()]) this.release(node); }
    destroy() { cancelAnimationFrame(this.frame); this.releaseAll(); }
}

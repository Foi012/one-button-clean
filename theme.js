export function luminance(rgb) {
    const channels = rgb.slice(0, 3).map(channel => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const mix = (a, b, amount) => a.map((value, i) => Math.round(value * (1 - amount) + b[i] * amount));
const css = rgb => `rgb(${rgb.slice(0, 3).join(' ')})`;
function readable(color, bg, fallback) { return contrast(color, bg) >= 4.5 ? color : fallback; }

export function mountTheme(surfaces, getMode) {
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, { position: 'fixed', width: '0', height: '0', overflow: 'hidden', pointerEvents: 'none' });
    // A direct child of the page inherits the same theme variables as the extension.
    document.body.append(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const read = (expression, fallback) => {
        probe.style.color = expression;
        const resolved = getComputedStyle(probe).color || fallback;
        // Preserve exact sRGB channels, avoiding canvas premultiplication rounding
        // on the translucent theme colors commonly used by SillyTavern.
        const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/.exec(resolved);
        if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 255 : Number(rgb[4]) * (rgb[5] ? 2.55 : 255)];
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = resolved;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    let frame = 0;
    let disposed = false;
    function apply() {
        frame = 0;
        if (disposed) return;
        const mode = getMode();
        const hostText = read('var(--SmartThemeBodyColor, currentColor)', '#eee');
        const fallbackBg = luminance(hostText) > 0.45 ? [31, 31, 34] : [249, 249, 249];
        const tint = read('var(--SmartThemeBlurTintColor, transparent)', 'transparent');
        const bg = mode === 'light' ? [249, 249, 249] : mode === 'dark' ? [31, 31, 34] : tint[3] > 12 ? tint.slice(0, 3) : fallbackBg;
        const dark = luminance(bg) < 0.4;
        const fallbackText = contrast([255, 255, 255], bg) > contrast([0, 0, 0], bg) ? [255, 255, 255] : [0, 0, 0];
        const text = readable(mode === 'host' ? hostText.slice(0, 3) : fallbackText, bg, fallbackText);
        const muted = readable(mix(text, bg, 0.27), bg, text);
        const quote = read('var(--SmartThemeQuoteColor, currentColor)', css(text));
        const accent = readable(mode === 'host' ? quote.slice(0, 3) : text, bg, text);
        const values = {
            '--ob-bg': css(bg), '--ob-text': css(text), '--ob-muted': css(muted),
            '--ob-line': css(mix(bg, text, 0.25)), '--ob-hover': css(mix(bg, text, 0.07)),
            '--ob-accent': css(accent), '--ob-shadow': dark ? '0 8px 28px #0005' : '0 8px 28px #0002',
        };
        for (const node of surfaces) {
            node.dataset.obTone = dark ? 'dark' : 'light';
            for (const [key, value] of Object.entries(values)) if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
        }
    }
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(apply); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
    document.addEventListener('load', schedule, true);
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', schedule);
    apply();
    return {
        update: apply,
        destroy() { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('load', schedule, true); media.removeEventListener('change', schedule); probe.remove(); },
    };
}

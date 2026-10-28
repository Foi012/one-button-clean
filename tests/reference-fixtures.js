// Independent test doubles for source-verified DOM/event contracts.
// These are not copies of, or complete integrations with, the reference plugins.
export async function mountReference(page, kind) {
    await page.evaluate(kind => {
        window.referenceOpens = 0;
        const root = document.createElement('div');
        Object.assign(root.style, { position: 'fixed', left: '120px', top: '110px', width: '40px', height: '40px' });
        document.body.append(root);
        if (kind === 'pyq') {
            root.id = 'pyq-creator-float-ball';
            root.style.width = root.style.height = '122px';
            root.innerHTML = '<div class="pyq-float-ball-image" style="position:absolute;inset:0;background:#74929d;border-radius:50%;pointer-events:none"></div><div class="pyq-float-ball-hitbox" style="position:absolute;inset:0;pointer-events:auto"><span>小剧场</span></div>';
            root.querySelector('.pyq-float-ball-hitbox').addEventListener('pointerdown', () => window.calls.pointer++);
            root.querySelector('.pyq-float-ball-hitbox').addEventListener('click', () => window.referenceOpens++);
        } else if (kind === 'echo') {
            root.id = 'titania-float-btn';
            root.textContent = '剧场';
            const timer = document.createElement('div');
            timer.id = 'titania-timer'; timer.textContent = '1.0';
            document.body.append(timer);
            let pressed = false;
            root.addEventListener('mousedown', () => { pressed = true; });
            root.addEventListener('mouseup', () => { if (pressed) window.referenceOpens++; pressed = false; });
        } else if (kind === 'sashimi') {
            root.id = 'preset-easy-toggle-native';
            const shadow = root.attachShadow({ mode: 'open' });
            const showTrigger = () => {
                root.style.width = '40px'; root.style.height = '40px';
                shadow.innerHTML = '<style>:host{all:initial}button{width:40px;height:40px;border:1px solid #888;border-radius:50%;background:var(--SmartThemeBlurTintColor,#333);color:var(--SmartThemeBodyColor,#eee);display:grid;place-items:center}svg{width:18px;height:18px}</style><button class="pet-trigger" title="工具箱"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h14M3 14h14M7 3v6M13 11v6"/></svg></button>';
                const control = shadow.querySelector('button');
                let pointer;
                control.addEventListener('pointerdown', event => {
                    pointer = event.pointerId;
                    control.setPointerCapture(event.pointerId);
                });
                control.addEventListener('pointerup', event => {
                    if (pointer !== event.pointerId) return;
                    control.releasePointerCapture(event.pointerId);
                    pointer = null;
                    window.referenceOpens++;
                    queueMicrotask(() => {
                        root.style.width = '300px'; root.style.height = '240px';
                        shadow.innerHTML = '<section class="pet-panel" role="dialog"><h2>工具箱面板</h2><button>收起工具箱</button></section>';
                        shadow.querySelector('button').addEventListener('click', showTrigger);
                    });
                });
            };
            showTrigger();
        } else if (kind === 'quick-presets') {
            root.id = 'pss-root';
            root.style.position = 'static'; root.style.width = '0'; root.style.height = '0';
            root.innerHTML = '<button class="pss-fab" title="楼内预设快切" style="position:fixed;left:120px;top:110px;width:40px;height:40px"><svg viewBox="0 0 20 20"><path d="M0 0h20v20H0z"/></svg></button><section id="pss-panel" role="dialog" style="position:fixed;left:180px;top:100px;width:300px;height:240px" hidden>预设快切面板</section>';
            root.querySelector('button').addEventListener('click', () => {
                window.referenceOpens++;
                root.querySelector('section').hidden = false;
            });
        }
    }, kind);
}

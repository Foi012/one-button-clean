export const VERSION = '3.0.5';
export const RELEASE_NOTES = '单层列表、三态总开关、面板入口方式；修复美化勾选图案叠加和小剧场图标打开时的缩放闪动。';

export function extensionFolder(url = import.meta.url) {
    const parts = new URL('.', url).pathname.split('/').filter(Boolean);
    const marker = parts.indexOf('third-party');
    if (marker < 0 || marker !== parts.length - 2) return null;
    return decodeURIComponent(parts.at(-1));
}

export function mountUpdates(container, context) {
    const area = document.createElement('div');
    area.className = 'ob-updates';
    const heading = document.createElement('strong');
    heading.textContent = `版本与更新 · v${VERSION}`;
    const notes = document.createElement('p');
    notes.textContent = RELEASE_NOTES;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = '通过 Git 安装的扩展可检查更新；本地解压版请下载新版覆盖。';
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'ob-button'; check.textContent = '检查更新';
    const install = document.createElement('button');
    install.type = 'button'; install.className = 'ob-button'; install.textContent = '更新 One Button'; install.hidden = true;
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.className = 'ob-button'; refresh.textContent = '刷新页面应用更新'; refresh.hidden = true;
    refresh.addEventListener('click', () => location.reload());
    area.append(heading, notes, status, check, install, refresh);
    container.querySelector('.inline-drawer-content').append(area);
    let request;
    let disposed = false;
    let available = false;
    const run = async update => {
        if (disposed || request || (update && !available)) return;
        const folder = extensionFolder();
        if (!folder) { status.textContent = '当前不是酒馆扩展安装路径，请在酒馆中安装后检查。'; return; }
        request = new AbortController();
        check.disabled = true; install.disabled = true;
        status.textContent = update ? '正在更新，请稍候…' : '正在检查更新…';
        const timeout = setTimeout(() => request?.abort(), update ? 60000 : 15000);
        try {
            const getHeaders = context.getRequestHeaders || (await import('/script.js')).getRequestHeaders;
            const extensions = await fetch('/api/extensions/discover', { signal: request.signal });
            if (!extensions.ok) throw new Error(`读取扩展列表失败（HTTP ${extensions.status}）`);
            const list = await extensions.json();
            const entry = Array.isArray(list) && list.find(item => item.name === `third-party/${folder}`);
            if (!entry || !['local', 'global'].includes(entry.type)) throw new Error('找不到当前扩展的安装信息。');
            const response = await fetch(`/api/extensions/${update ? 'update' : 'version'}`, {
                method: 'POST', signal: request.signal, headers: getHeaders(),
                body: JSON.stringify({ extensionName: `third-party/${folder}`, global: entry.type === 'global' }),
            });
            if (!response.ok) {
                if (response.status === 403) throw new Error('当前账户没有更新此扩展的权限。');
                throw new Error(`请求失败（HTTP ${response.status}）；若为本地解压安装，请下载新版覆盖。`);
            }
            const data = await response.json();
            if (disposed) return;
            if (typeof data.isUpToDate !== 'boolean') throw new Error('酒馆没有返回有效的 Git 版本信息，请确认是通过 Git 安装。');
            if (update) {
                available = false;
                install.hidden = true;
                refresh.hidden = false;
                status.textContent = '更新请求已完成。保存当前工作后，刷新页面加载磁盘上的版本。';
                check.hidden = true;
            } else {
                available = !data.isUpToDate;
                install.hidden = !available;
                status.textContent = available ? 'Git 仓库有可用更新，点击“更新 One Button”安装。' : '当前 Git 分支已是最新。';
            }
        } catch (error) {
            if (!disposed) {
                status.textContent = error.name === 'AbortError' ? '请求超时，请稍后重试；更新请求若已到达服务器，可能仍在后台继续。' : error.message;
                if (!update) { available = false; install.hidden = true; }
            }
        } finally {
            clearTimeout(timeout); request = null;
            check.disabled = false; install.disabled = false;
        }
    };
    check.addEventListener('click', () => run(false));
    install.addEventListener('click', () => run(true));
    // Release notices are local. Merely loading this extension never checks a server.
    try {
        const key = 'one-button:last-seen-version';
        const previous = localStorage.getItem(key);
        if (previous && previous !== VERSION) globalThis.toastr?.info?.(RELEASE_NOTES, `One Button 已更新到 v${VERSION}`, { escapeHtml: true });
        localStorage.setItem(key, VERSION);
    } catch { /* Storage can be disabled without affecting collection. */ }
    return () => { disposed = true; request?.abort(); area.remove(); };
}

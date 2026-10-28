import { KEY, normalizeSettings } from './core.js';

export function deviceId(storage = localStorage) {
    try {
        let id = storage.getItem('one-button:device');
        if (!id || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) {
            id = crypto.randomUUID();
            storage.setItem('one-button:device', id);
        }
        return id;
    } catch { return 'storage-unavailable'; }
}

export function loadSettings(context, id) {
    const saved = context.extensionSettings[KEY];
    // Upgrade the old single-device settings once, preserving the user's choices.
    const settings = normalizeSettings(saved?.schema === 2 ? saved.devices?.[id] : saved);
    const save = () => {
        const current = context.extensionSettings[KEY];
        context.extensionSettings[KEY] = {
            schema: 2,
            devices: { ...(current?.schema === 2 ? current.devices : {}), [id]: settings },
        };
        context.saveSettingsDebounced();
    };
    return { settings, save };
}

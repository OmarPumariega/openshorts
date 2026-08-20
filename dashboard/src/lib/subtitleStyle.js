// Shared subtitle style constants + the user's persisted "default style
// profile" (Settings > Default subtitle style). Single source of truth for
// SubtitleModal (per-clip editing) and App.jsx (auto-apply on job
// completion) so the two never drift apart.
//
// Persisted in localStorage, not the server: this is a private, single-user
// instance with no account system, and a caption look is not a secret —
// unlike the Gemini key, there is no reason to keep it out of the browser.
//
// One profile per delivery FORMAT (vertical crop / "girar móvil" / vertical
// letterbox fit), not one shared profile for all three: a look tuned for a
// tight face-tracked crop (say, large text near the bottom third) can sit
// right on top of the presenter's face once the same clip is the whole
// 16:9 frame shrunk into a letterboxed band. 'vertical' keeps the ORIGINAL,
// unsuffixed key so anyone who already had a default style saved doesn't
// lose it when this shipped.
const STORAGE_KEYS = {
    vertical: 'openshorts_default_style',
    horizontal: 'openshorts_default_style_horizontal',
    letterboxed: 'openshorts_default_style_letterboxed',
};
export const FORMATS = [
    { id: 'vertical', label: 'Vertical (recorte)' },
    { id: 'horizontal', label: 'Girar móvil (9:16 girado)' },
    { id: 'letterboxed', label: 'Vertical encajado' },
];
const CUSTOM_PRESETS_KEY = 'openshorts_custom_presets';

export const FONT_OPTIONS = [
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Impact', label: 'Impact' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Courier New', label: 'Courier New' },
    // Bundled directly (fonts/Inter-Bold.ttf, fonts/Montserrat-Bold.ttf) — not
    // substituted via the fontmap like the system fonts above, since these are
    // shipped as real font files under their own name.
    { value: 'Inter', label: 'Inter' },
    { value: 'Montserrat', label: 'Montserrat' },
];

export const COLOR_PRESETS = [
    { color: '#FFFFFF', label: 'White' },
    { color: '#FFFF00', label: 'Yellow' },
    { color: '#00FFFF', label: 'Cyan' },
    { color: '#00FF00', label: 'Green' },
    { color: '#FF0000', label: 'Red' },
    { color: '#FF69B4', label: 'Pink' },
];

export const HIGHLIGHT_PRESETS = [
    { color: '#FFDD00', label: 'Gold' },
    { color: '#FF4444', label: 'Red' },
    { color: '#00FF88', label: 'Green' },
    { color: '#00BBFF', label: 'Blue' },
    { color: '#FF69B4', label: 'Pink' },
];

// Ready-made caption looks burned server-side as karaoke ASS (word highlight):
// dimmed base text + strong active word, optional glow/pop/box effect.
export const CAPTION_PRESETS = [
    { id: 'tiktok',  label: 'TikTok',     style: 'karaoke', effect: 'none', highlightColor: '#FE2C55', baseOpacity: 0.75, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'reels',   label: 'Reels',      style: 'karaoke', effect: 'none', highlightColor: '#E1306C', baseOpacity: 0.7,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'shorts',  label: 'Shorts Pop', style: 'karaoke', effect: 'pop',  highlightColor: '#FF0000', baseOpacity: 0.7,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'gold',    label: 'Gold Glow',  style: 'karaoke', effect: 'glow', highlightColor: '#FFD700', baseOpacity: 0.6,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'neon',    label: 'Neon',       style: 'karaoke', effect: 'glow', highlightColor: '#00FF88', baseOpacity: 0.55, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'cyber',   label: 'Cyber',      style: 'karaoke', effect: 'glow', highlightColor: '#00FFFF', baseOpacity: 0.5,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'karaoke', label: 'Karaoke',    style: 'karaoke', effect: 'none', highlightColor: '#FF6B6B', baseOpacity: 0.6,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'minimal', label: 'Minimal',    style: 'karaoke', effect: 'none', highlightColor: '#FFFFFF', baseOpacity: 0.65, uppercase: false, fontName: 'Verdana', borderWidth: 1 },
    { id: 'beast',   label: 'Beast',      style: 'karaoke', effect: 'pop',  highlightColor: '#FFD700', baseOpacity: 1.0,  uppercase: true,  fontName: 'Impact',  borderWidth: 3 },
    { id: 'boxed',   label: 'Boxed',      style: 'karaoke', effect: 'box',  highlightColor: '#7C3AED', baseOpacity: 0.85, uppercase: false, fontName: 'Verdana', borderWidth: 2 },
    { id: 'classic', label: 'Classic',    style: 'classic', effect: 'none', highlightColor: '#FFD700', baseOpacity: 1.0,  uppercase: false, fontName: 'Verdana', borderWidth: 2 },
];

// Baseline used when nothing has been saved yet — matches SubtitleModal's
// original hardcoded defaults, so behavior is unchanged until the user
// actually sets a profile in Settings.
export const FACTORY_DEFAULT_STYLE = {
    position: 'bottom',
    fontSize: 24,
    fontName: 'Verdana',
    fontColor: '#FFFFFF',
    highlightColor: '#FFDD00',
    borderColor: '#000000',
    borderWidth: 2,
    bgColor: '#000000',
    bgOpacity: 0.0,
    style: 'classic',
    effect: 'none',
    baseOpacity: 1.0,
    uppercase: false,
    presetId: null,
};

export function presetToStyle(preset) {
    return {
        ...FACTORY_DEFAULT_STYLE,
        style: preset.style,
        effect: preset.effect,
        highlightColor: preset.highlightColor,
        baseOpacity: preset.baseOpacity,
        uppercase: preset.uppercase,
        fontName: preset.fontName,
        borderWidth: preset.borderWidth,
        fontColor: '#FFFFFF',
        bgOpacity: 0,
        presetId: preset.id,
    };
}

// Returns the saved profile for one format, or null if the user has never
// set one — callers decide what "no profile saved" means (SubtitleModal
// falls back to the factory default; App.jsx's auto-apply skips that format
// entirely rather than burning captions twice with a style nobody asked for).
export function loadDefaultStyle(format = 'vertical') {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS[format] || STORAGE_KEYS.vertical);
        return raw ? { ...FACTORY_DEFAULT_STYLE, ...JSON.parse(raw) } : null;
    } catch {
        return null;
    }
}

export function saveDefaultStyle(style, format = 'vertical') {
    try {
        localStorage.setItem(STORAGE_KEYS[format] || STORAGE_KEYS.vertical, JSON.stringify(style));
    } catch {
        // localStorage full/unavailable — the profile just won't persist.
    }
}

export function clearDefaultStyle(format = 'vertical') {
    try {
        localStorage.removeItem(STORAGE_KEYS[format] || STORAGE_KEYS.vertical);
    } catch { /* ignore */ }
}

// {vertical, horizontal, letterboxed} -> saved profile | null, for callers
// that need all three at once (App.jsx's auto-apply loop).
export function loadAllDefaultStyles() {
    return Object.fromEntries(FORMATS.map((f) => [f.id, loadDefaultStyle(f.id)]));
}

// User-created caption looks (named, saved from the current editor state) —
// distinct from the built-in CAPTION_PRESETS above, which ship with the app
// and can't be edited or removed. Stored as a flat list in localStorage,
// same private-single-user rationale as the default style profile.
export function loadCustomPresets() {
    try {
        const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistCustomPresets(presets) {
    try {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
    } catch {
        // localStorage full/unavailable — nothing to do.
    }
    return presets;
}

// Snapshots the given style (whatever the editor currently holds) under a
// user-chosen name and appends it to the saved list. Returns the new preset.
export function saveCustomPreset(name, style) {
    const { presetId, ...styleFields } = style;
    const preset = {
        id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        label: name,
        custom: true,
        ...styleFields,
    };
    persistCustomPresets([...loadCustomPresets(), preset]);
    return preset;
}

// Removes a custom preset by id and returns the resulting list.
export function deleteCustomPreset(id) {
    return persistCustomPresets(loadCustomPresets().filter((p) => p.id !== id));
}

// Overwrites an existing custom preset's style fields in place (name/id kept)
// — the "I tweaked a preset I already saved, update it" path, as opposed to
// saveCustomPreset which always appends a new one. Returns the resulting list.
export function updateCustomPreset(id, style) {
    const { presetId, ...styleFields } = style;
    const presets = loadCustomPresets();
    const idx = presets.findIndex((p) => p.id === id);
    if (idx === -1) return presets;
    const next = presets.slice();
    next[idx] = { ...next[idx], ...styleFields };
    return persistCustomPresets(next);
}

// Custom presets snapshot the *entire* editable style (unlike the built-in
// CAPTION_PRESETS, which only pin a handful of fields and reset the rest),
// so restoring one is just re-hydrating it against the factory baseline.
export function customPresetToStyle(preset) {
    const { id, label, custom, ...styleFields } = preset;
    return {
        ...FACTORY_DEFAULT_STYLE,
        ...styleFields,
        presetId: id,
    };
}

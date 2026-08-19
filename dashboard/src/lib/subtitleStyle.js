// Shared subtitle style constants + the user's persisted "default style
// profile" (Settings > Default subtitle style). Single source of truth for
// SubtitleModal (per-clip editing) and App.jsx (auto-apply on job
// completion) so the two never drift apart.
//
// Persisted in localStorage, not the server: this is a private, single-user
// instance with no account system, and a caption look is not a secret —
// unlike the Gemini key, there is no reason to keep it out of the browser.
const STORAGE_KEY = 'openshorts_default_style';

export const FONT_OPTIONS = [
    { value: 'Verdana', label: 'Verdana' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Impact', label: 'Impact' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Courier New', label: 'Courier New' },
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

// Returns the saved profile, or null if the user has never set one — callers
// decide what "no profile saved" means (SubtitleModal falls back to the
// factory default; App.jsx's auto-apply skips entirely rather than burning
// captions twice with a style nobody asked for).
export function loadDefaultStyle() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...FACTORY_DEFAULT_STYLE, ...JSON.parse(raw) } : null;
    } catch {
        return null;
    }
}

export function saveDefaultStyle(style) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
    } catch {
        // localStorage full/unavailable — the profile just won't persist.
    }
}

export function clearDefaultStyle() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

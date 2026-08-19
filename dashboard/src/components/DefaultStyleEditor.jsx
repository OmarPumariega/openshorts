import React from 'react';
import {
    FONT_OPTIONS, COLOR_PRESETS, HIGHLIGHT_PRESETS, CAPTION_PRESETS,
    FACTORY_DEFAULT_STYLE, presetToStyle,
} from '../lib/subtitleStyle';

const swatchClass = (selected) =>
    `w-6 h-6 rounded-full transition-all ${selected
        ? 'ring-2 ring-[color:var(--color-accent)] ring-offset-2 ring-offset-[color:var(--color-paper-2)]'
        : 'ring-1 ring-[color:var(--color-rule-2)] hover:ring-[color:var(--color-accent)]'}`;

// Full font/color/size editor for the Settings > Default subtitle style
// card — everything SubtitleModal's per-clip editor offers, minus the parts
// that only make sense against a specific clip (word-level caption preview,
// text editing). Controlled: `value` is the saved profile (or null, meaning
// "factory default"), `onChange(style)` persists it (App.jsx's
// setDefaultStyle writes to localStorage) on every change — this is a
// standing preference, not a form you submit.
export default function DefaultStyleEditor({ value, onChange }) {
    const v = value || FACTORY_DEFAULT_STYLE;
    const set = (patch) => onChange({ ...v, presetId: patch.presetId !== undefined ? patch.presetId : null, ...patch });
    // Any manual tweak invalidates "this matches preset X" unless the patch
    // itself is what set the preset.
    const setField = (field) => (val) => onChange({ ...v, [field]: val, presetId: null });

    const bw = Math.max(v.borderWidth, 0);
    const outlineShadow = bw > 0 ? [
        `-${bw}px -${bw}px 0 ${v.borderColor}`, `${bw}px -${bw}px 0 ${v.borderColor}`,
        `-${bw}px ${bw}px 0 ${v.borderColor}`, `${bw}px ${bw}px 0 ${v.borderColor}`,
        `0 -${bw}px 0 ${v.borderColor}`, `0 ${bw}px 0 ${v.borderColor}`,
        `-${bw}px 0 0 ${v.borderColor}`, `${bw}px 0 0 ${v.borderColor}`,
    ].join(', ') : 'none';

    return (
        <div className="space-y-5">
            {/* Live preview */}
            <div className="rounded-input bg-black aspect-video flex items-center justify-center p-4 overflow-hidden">
                <span
                    style={{
                        fontFamily: v.fontName,
                        color: v.style === 'karaoke' ? v.highlightColor : v.fontColor,
                        fontSize: '22px',
                        fontWeight: 'bold',
                        textTransform: v.uppercase ? 'uppercase' : 'none',
                        textShadow: bw > 0 ? outlineShadow : 'none',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        textAlign: 'center',
                        lineHeight: 1.3,
                        ...(v.bgOpacity > 0
                            ? { backgroundColor: `${v.bgColor}${Math.round(v.bgOpacity * 255).toString(16).padStart(2, '0')}`, textShadow: 'none' }
                            : {}),
                    }}
                >
                    your subtitles<br />will look like this
                </span>
            </div>

            {/* Presets */}
            <div>
                <p className="eyebrow mb-2">Preset</p>
                <div className="grid grid-cols-3 gap-1.5">
                    {CAPTION_PRESETS.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => onChange(presetToStyle(p))}
                            className={`px-2 py-1.5 rounded-input border text-xs transition-colors flex items-center gap-1.5 justify-center
                                ${v.presetId === p.id
                                    ? 'border-[color:var(--color-accent)] text-ink'
                                    : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                            title={p.label}
                        >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.highlightColor }} />
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Font */}
            <div>
                <p className="eyebrow mb-2">Font</p>
                <select value={v.fontName} onChange={(e) => setField('fontName')(e.target.value)} className="input-field">
                    {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                    ))}
                </select>
            </div>

            {/* Text color */}
            <div>
                <p className="eyebrow mb-2">Text color</p>
                <div className="flex flex-wrap items-center gap-2.5">
                    {COLOR_PRESETS.map((c) => (
                        <button key={c.color} onClick={() => setField('fontColor')(c.color)}
                            className={swatchClass(v.fontColor === c.color)} style={{ backgroundColor: c.color }} title={c.label} />
                    ))}
                    <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Custom color">
                        <span className="text-xs text-muted leading-none">+</span>
                        <input type="color" value={v.fontColor} onChange={(e) => setField('fontColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                </div>
            </div>

            {/* Highlight color */}
            <div>
                <p className="eyebrow mb-2">Highlight (active word)</p>
                <div className="flex flex-wrap items-center gap-2.5">
                    {HIGHLIGHT_PRESETS.map((c) => (
                        <button key={c.color} onClick={() => setField('highlightColor')(c.color)}
                            className={swatchClass(v.highlightColor === c.color)} style={{ backgroundColor: c.color }} title={c.label} />
                    ))}
                    <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Custom color">
                        <span className="text-xs text-muted leading-none">+</span>
                        <input type="color" value={v.highlightColor} onChange={(e) => setField('highlightColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                </div>
            </div>

            {/* Size */}
            <div>
                <div className="flex justify-between mb-1">
                    <p className="eyebrow">Size</p>
                    <span className="readout">{v.fontSize}px</span>
                </div>
                <input type="range" min="14" max="48" value={v.fontSize}
                    onChange={(e) => setField('fontSize')(parseInt(e.target.value))}
                    className="w-full accent-[var(--color-accent)]" />
            </div>

            {/* Border */}
            <div>
                <p className="eyebrow mb-2">Border</p>
                <div className="flex items-center gap-3">
                    <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Border color">
                        <div className="w-full h-full" style={{ backgroundColor: v.borderColor }} />
                        <input type="color" value={v.borderColor} onChange={(e) => setField('borderColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                    <div className="flex-1">
                        <input type="range" min="0" max="5" value={v.borderWidth}
                            onChange={(e) => setField('borderWidth')(parseInt(e.target.value))}
                            className="w-full accent-[var(--color-accent)]" />
                        <div className="flex justify-between"><span className="readout">None</span><span className="readout">Thick</span></div>
                    </div>
                </div>
            </div>

            {/* Background box */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="eyebrow">Background</p>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={v.bgOpacity > 0}
                            onChange={(e) => setField('bgOpacity')(e.target.checked ? 0.5 : 0)} className="sr-only peer" />
                        <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
                {v.bgOpacity > 0 && (
                    <div className="flex items-center gap-3 animate-fade">
                        <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Background color">
                            <div className="w-full h-full" style={{ backgroundColor: v.bgColor }} />
                            <input type="color" value={v.bgColor} onChange={(e) => setField('bgColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </label>
                        <div className="flex-1">
                            <input type="range" min="10" max="100" value={Math.round(v.bgOpacity * 100)}
                                onChange={(e) => setField('bgOpacity')(parseInt(e.target.value) / 100)}
                                className="w-full accent-[var(--color-accent)]" />
                            <div className="flex justify-between"><span className="readout">Transparent</span><span className="readout">{Math.round(v.bgOpacity * 100)}%</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Uppercase (karaoke styles only) */}
            {v.style === 'karaoke' && (
                <div className="flex items-center justify-between">
                    <span className="readout">UPPERCASE</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={v.uppercase} onChange={(e) => setField('uppercase')(e.target.checked)} className="sr-only peer" />
                        <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
            )}
        </div>
    );
}

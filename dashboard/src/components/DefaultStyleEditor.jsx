import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
    FONT_OPTIONS, COLOR_PRESETS, HIGHLIGHT_PRESETS, CAPTION_PRESETS,
    FACTORY_DEFAULT_STYLE, presetToStyle,
    loadCustomPresets, saveCustomPreset, deleteCustomPreset, updateCustomPreset, customPresetToStyle,
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

    const [customPresets, setCustomPresets] = useState(() => loadCustomPresets());
    const [showNameInput, setShowNameInput] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [presetUpdated, setPresetUpdated] = useState(false);
    // Which custom preset (if any) is currently "loaded" for editing — unlike
    // v.presetId, this survives manual tweaks (setField clears v.presetId on
    // every change, since the values no longer match the preset exactly) so
    // there's still something to update once the user is done adjusting it.
    const [editingPresetId, setEditingPresetId] = useState(
        () => (v.presetId && loadCustomPresets().some((p) => p.id === v.presetId)) ? v.presetId : null
    );
    const editingPreset = customPresets.find((p) => p.id === editingPresetId) || null;
    const presetDirty = editingPreset && (() => {
        const { presetId: _a, ...current } = v;
        const { presetId: _b, ...stored } = customPresetToStyle(editingPreset);
        return JSON.stringify(current) !== JSON.stringify(stored);
    })();

    const handleSavePreset = () => {
        const name = presetName.trim();
        if (!name) return;
        const preset = saveCustomPreset(name, v);
        setCustomPresets((prev) => [...prev, preset]);
        onChange({ ...v, presetId: preset.id });
        setEditingPresetId(preset.id);
        setPresetName('');
        setShowNameInput(false);
    };

    const handleUpdatePreset = () => {
        if (!editingPresetId) return;
        setCustomPresets(updateCustomPreset(editingPresetId, v));
        setPresetUpdated(true);
        setTimeout(() => setPresetUpdated(false), 2000);
    };

    const handleDeletePreset = (id) => {
        setCustomPresets(deleteCustomPreset(id));
        if (v.presetId === id) onChange({ ...v, presetId: null });
        if (editingPresetId === id) setEditingPresetId(null);
    };

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
                    así se verán<br />tus subtítulos
                </span>
            </div>

            {/* Presets */}
            <div>
                <p className="eyebrow mb-2">Preset</p>
                <div className="grid grid-cols-3 gap-1.5">
                    {CAPTION_PRESETS.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => { onChange(presetToStyle(p)); setEditingPresetId(null); }}
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

            {/* Custom presets — user-named, saved from the current style below */}
            {customPresets.length > 0 && (
                <div>
                    <p className="eyebrow mb-2">Mis presets</p>
                    <div className="grid grid-cols-3 gap-1.5">
                        {customPresets.map((p) => (
                            <div key={p.id} className="relative group">
                                <button
                                    onClick={() => { onChange(customPresetToStyle(p)); setEditingPresetId(p.id); }}
                                    className={`w-full px-2 py-1.5 rounded-input border text-xs transition-colors flex items-center gap-1.5 justify-center
                                        ${v.presetId === p.id
                                            ? 'border-[color:var(--color-accent)] text-ink'
                                            : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                    title={p.label}
                                >
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.highlightColor }} />
                                    <span className="truncate">{p.label}</span>
                                </button>
                                <button
                                    onClick={() => handleDeletePreset(p.id)}
                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[color:var(--color-paper-2)] border border-rule2 text-muted hover:text-red-500 hover:border-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    title={`Borrar "${p.label}"`}
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Update the preset currently loaded, if the controls below have
                since been tweaked away from it */}
            {editingPreset && (
                <button
                    onClick={handleUpdatePreset}
                    disabled={!presetDirty}
                    className="w-full btn-primary text-xs py-2.5 disabled:opacity-50"
                    title={presetDirty ? `Sobrescribir "${editingPreset.label}" con el estilo actual` : 'No hay cambios que guardar'}
                >
                    {presetUpdated ? `✓ "${editingPreset.label}" actualizado` : `guardar cambios en "${editingPreset.label}"`}
                </button>
            )}

            {/* Save current style as a named custom preset */}
            <div>
                {showNameInput ? (
                    <div className="flex gap-1.5 animate-fade">
                        <input
                            type="text"
                            autoFocus
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSavePreset();
                                if (e.key === 'Escape') { setShowNameInput(false); setPresetName(''); }
                            }}
                            placeholder="nombre del preset…"
                            maxLength={30}
                            className="input-field flex-1 text-xs"
                        />
                        <button onClick={handleSavePreset} disabled={!presetName.trim()} className="btn-primary px-3 text-xs disabled:opacity-50">
                            crear
                        </button>
                        <button onClick={() => { setShowNameInput(false); setPresetName(''); }} className="btn-ghost px-3 text-xs">
                            cancelar
                        </button>
                    </div>
                ) : (
                    <button onClick={() => setShowNameInput(true)} className="w-full btn-ghost text-xs py-2.5">
                        + crear preset con el estilo actual
                    </button>
                )}
            </div>

            {/* Font */}
            <div>
                <p className="eyebrow mb-2">Fuente</p>
                <select value={v.fontName} onChange={(e) => setField('fontName')(e.target.value)} className="input-field">
                    {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                    ))}
                </select>
            </div>

            {/* Text color */}
            <div>
                <p className="eyebrow mb-2">Color del texto</p>
                <div className="flex flex-wrap items-center gap-2.5">
                    {COLOR_PRESETS.map((c) => (
                        <button key={c.color} onClick={() => setField('fontColor')(c.color)}
                            className={swatchClass(v.fontColor === c.color)} style={{ backgroundColor: c.color }} title={c.label} />
                    ))}
                    <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Color personalizado">
                        <span className="text-xs text-muted leading-none">+</span>
                        <input type="color" value={v.fontColor} onChange={(e) => setField('fontColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                </div>
            </div>

            {/* Highlight color */}
            <div>
                <p className="eyebrow mb-2">Resaltado (palabra activa)</p>
                <div className="flex flex-wrap items-center gap-2.5">
                    {HIGHLIGHT_PRESETS.map((c) => (
                        <button key={c.color} onClick={() => setField('highlightColor')(c.color)}
                            className={swatchClass(v.highlightColor === c.color)} style={{ backgroundColor: c.color }} title={c.label} />
                    ))}
                    <label className="w-6 h-6 rounded-full border border-dashed border-rule2 cursor-pointer flex items-center justify-center hover:border-brass transition-colors overflow-hidden relative" title="Color personalizado">
                        <span className="text-xs text-muted leading-none">+</span>
                        <input type="color" value={v.highlightColor} onChange={(e) => setField('highlightColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                </div>
            </div>

            {/* Size */}
            <div>
                <div className="flex justify-between mb-1">
                    <p className="eyebrow">Tamaño</p>
                    <span className="readout">{v.fontSize}px</span>
                </div>
                <input type="range" min="14" max="48" value={v.fontSize}
                    onChange={(e) => setField('fontSize')(parseInt(e.target.value))}
                    className="w-full accent-[var(--color-accent)]" />
            </div>

            {/* Border */}
            <div>
                <p className="eyebrow mb-2">Borde</p>
                <div className="flex items-center gap-3">
                    <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Color del borde">
                        <div className="w-full h-full" style={{ backgroundColor: v.borderColor }} />
                        <input type="color" value={v.borderColor} onChange={(e) => setField('borderColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </label>
                    <div className="flex-1">
                        <input type="range" min="0" max="5" value={v.borderWidth}
                            onChange={(e) => setField('borderWidth')(parseInt(e.target.value))}
                            className="w-full accent-[var(--color-accent)]" />
                        <div className="flex justify-between"><span className="readout">Ninguno</span><span className="readout">Grueso</span></div>
                    </div>
                </div>
            </div>

            {/* Background box */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="eyebrow">Fondo</p>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={v.bgOpacity > 0}
                            onChange={(e) => setField('bgOpacity')(e.target.checked ? 0.5 : 0)} className="sr-only peer" />
                        <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
                {v.bgOpacity > 0 && (
                    <div className="flex items-center gap-3 animate-fade">
                        <label className="relative w-8 h-8 rounded-input border border-rule2 cursor-pointer overflow-hidden shrink-0" title="Color de fondo">
                            <div className="w-full h-full" style={{ backgroundColor: v.bgColor }} />
                            <input type="color" value={v.bgColor} onChange={(e) => setField('bgColor')(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </label>
                        <div className="flex-1">
                            <input type="range" min="10" max="100" value={Math.round(v.bgOpacity * 100)}
                                onChange={(e) => setField('bgOpacity')(parseInt(e.target.value) / 100)}
                                className="w-full accent-[var(--color-accent)]" />
                            <div className="flex justify-between"><span className="readout">Transparente</span><span className="readout">{Math.round(v.bgOpacity * 100)}%</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Uppercase (karaoke styles only) */}
            {v.style === 'karaoke' && (
                <div className="flex items-center justify-between">
                    <span className="readout">MAYÚSCULAS</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={v.uppercase} onChange={(e) => setField('uppercase')(e.target.checked)} className="sr-only peer" />
                        <div className="w-8 h-4 rounded-full bg-paper3 peer-checked:bg-brass transition-colors after:content-[''] after:absolute after:top-0 after:left-0 after:h-4 after:w-4 after:rounded-full after:bg-ink after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                </div>
            )}
        </div>
    );
}

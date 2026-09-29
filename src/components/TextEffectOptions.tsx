import type { TextEffectsSettings } from '../chat/textEffects';

const sections = [
  { id: 'narration', label: 'Narration', description: 'Neutral roleplay text shifts between darker and lighter tones.' },
  { id: 'dialogue', label: 'Character dialogue', description: 'Colored character speech shifts between darker and lighter tones.' },
  { id: 'messages', label: 'App messages', description: 'Text in WhatsUp, Photogram, OnlyFriends and MatchMe bubbles.' },
] as const;

export function TextEffectOptions({ value, onChange }: {
  value: TextEffectsSettings;
  onChange: (value: TextEffectsSettings) => void;
}) {
  return <section className="text-effect-options" aria-label="Text wave effects">
    <div className="option-info">
      <strong>Text wave effects</strong>
      <p>100% is the current default, at the center of each slider. Shorter waves repeat more often. While adjusting a slider, the backdrop clears so you can see the chat.</p>
      <p>Above 100% intensity, neutral text also gains brighter highlights. Character names and avatar rings are independent of these sliders. Name waves repeat continuously every three seconds with random starting offsets and freeze only while Smooth Chat Auto-Scroll is moving the chat. Other text waves stay static.</p>
    </div>
    {sections.map(({ id, label, description }) => <fieldset className="text-effect-group" key={id}>
      <legend>{label}</legend>
      <p>{description}</p>
      <label className="option-toggle">
        <input type="checkbox" checked={value[id].enabled}
          onChange={(event) => onChange({ ...value, [id]: { ...value[id], enabled: event.target.checked } })} />
        <span>Activate {label.toLowerCase()} waves</span>
      </label>
      {(['intensity', 'wavelength'] as const).map((setting) => {
        const inputId = `text-effect-${id}-${setting}`;
        return <label className="option-field chat-text-size-field" htmlFor={inputId} key={setting}>
          {setting === 'intensity' ? 'Intensity' : 'Wavelength'}
          <div className="option-range-row">
            <input id={inputId} type="range" min={setting === 'intensity' ? 0 : 50}
              max={setting === 'intensity' ? 200 : 150} step={1}
              value={value[id][setting]} disabled={!value[id].enabled}
              aria-valuetext={`${value[id][setting]}% of default`}
              onChange={(event) => onChange({ ...value, [id]: { ...value[id], [setting]: Number(event.target.value) } })}
            />
            <output htmlFor={inputId}>{value[id][setting]}%</output>
          </div>
        </label>;
      })}
    </fieldset>)}
  </section>;
}

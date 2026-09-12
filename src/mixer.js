// Mixer drawer. Builds DOM once, mutates `mix` in place, calls onChange(field).

export function buildMixer(root, { mix, TYPES, VOICES, SCALES, KEY_NAMES, onChange, onReset }) {
  root.innerHTML = '';
  const bind = [];

  const h2 = (text) => { const el = document.createElement('h2'); el.textContent = text; root.appendChild(el); };

  const row = (cls = '') => { const el = document.createElement('div'); el.className = `row ${cls}`.trim(); root.appendChild(el); return el; };

  const label = (parent, text) => { const el = document.createElement('label'); el.textContent = text; parent.appendChild(el); return el; };

  const select = (parent, options, get, set) => {
    const el = document.createElement('select');
    for (const o of options) { const op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); }
    el.addEventListener('change', () => set(el.value));
    parent.appendChild(el);
    bind.push(() => { el.value = get(); });
    return el;
  };

  const range = (parent, { min, max, step }, get, set, fmt = (v) => v) => {
    const el = document.createElement('input');
    el.type = 'range'; el.min = min; el.max = max; el.step = step;
    const val = document.createElement('span');
    val.className = 'val';
    el.addEventListener('input', () => { set(Number(el.value)); val.textContent = fmt(Number(el.value)); });
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.appendChild(el);
    wrap.appendChild(val);
    parent.appendChild(wrap);
    bind.push(() => { el.value = get(); val.textContent = fmt(get()); });
    return el;
  };

  const toggle = (parent, text, get, set) => {
    const el = document.createElement('button');
    el.textContent = text;
    el.addEventListener('click', () => set(!get()));
    parent.appendChild(el);
    bind.push(() => el.classList.toggle('on', !!get()));
    return el;
  };

  h2('key');
  let r = row();
  label(r, 'root');
  select(r, KEY_NAMES, () => KEY_NAMES[mix.keyRoot], (v) => { mix.keyRoot = KEY_NAMES.indexOf(v); onChange('keyRoot'); });
  toggle(r, 'lock', () => mix.lock, (v) => { mix.lock = v; onChange('lock'); sync(); });
  r = row();
  label(r, 'scale');
  select(r, Object.keys(SCALES), () => mix.scale, (v) => { mix.scale = v; onChange('scale'); });
  r.appendChild(document.createElement('span'));

  h2('global');
  r = row();
  label(r, 'tempo');
  range(r, { min: 40, max: 180, step: 1 }, () => mix.bpm, (v) => { mix.bpm = v; onChange('bpm'); }, (v) => `${v}`);
  r = row();
  label(r, 'drone');
  range(r, { min: 0, max: 2, step: 0.05 }, () => mix.drone, (v) => { mix.drone = v; onChange('drone'); }, pct);
  r = row();
  label(r, 'master');
  range(r, { min: 0, max: 1, step: 0.02 }, () => mix.master, (v) => { mix.master = v; onChange('master'); }, pct);

  h2('voices');
  for (const t of TYPES) {
    const cfg = mix.types[t];
    r = row('type');
    label(r, t);
    select(r, VOICES, () => mix.types[t].voice, (v) => { mix.types[t].voice = v; onChange('voice'); });
    range(r, { min: 0, max: 2, step: 0.05 }, () => mix.types[t].level, (v) => { mix.types[t].level = v; onChange('level'); }, pct);
    toggle(r, 'M', () => mix.types[t].mute, (v) => { mix.types[t].mute = v; onChange('mute'); sync(); });
    void cfg;
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const reset = document.createElement('button');
  reset.textContent = 'reset';
  reset.addEventListener('click', () => onReset());
  actions.appendChild(reset);
  const hint = document.createElement('span');
  hint.className = 'val';
  hint.textContent = 'x or esc to close';
  actions.appendChild(hint);
  root.appendChild(actions);

  function sync() { for (const f of bind) f(); }
  sync();
  return { sync };
}

function pct(v) { return `${Math.round(v * 100)}%`; }

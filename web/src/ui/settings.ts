// Settings: a gilded box with a gear in the top left corner of the menus (and a button in the
// pause menu), opening a card with the sound levels and every key the game uses. While it's
// open it has the keyboard to itself, so Esc closes it rather than unpausing the race.
import * as audio from '../audio';
import { button, h } from '../dom';
import { touchScreen } from '../input';

let gear: HTMLElement | null = null;
let card: HTMLElement | null = null;
let stopKeys: (() => void) | null = null;
let refresh: (() => void) | null = null;

/** the gear box for the top left corner (one, moved from screen to screen) */
export function settingsGear(): HTMLElement {
  gear ??= h('div.panel.settings-gear', {
    title: 'Settings',
    role: 'button',
    tabIndex: 0,
    onpointerdown: () => audio.play('click', 0.5),
    onclick: () => openSettings(),
    onkeydown: (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        openSettings();
      }
    },
  }, gearIcon());
  return gear;
}

export function openSettings(): void {
  if (card) return;
  const ui = document.getElementById('ui')!;
  const toggle = button('', () => {
    audio.setMuted(!audio.isMuted());
    refresh?.();
  }, 'toggle', 'secondary');
  const sliders = (['volume', 'music', 'effects'] as const).map((which) => slider(which));
  refresh = () => {
    toggle.textContent = audio.isMuted() ? 'OFF' : 'ON';
    for (const s of sliders) s.refresh();
  };
  refresh();

  card = h('div.settings', { onpointerdown: (e: Event) => e.target === card && closeSettings() },
    h('div.card-panel.settings-card', null,
      h('div.card-title', null, 'SETTINGS'),
      h('div.scroll', null,
        h('div.kicker', null, 'SOUND'),
        h('div.crow', null, h('span.grow', null, 'Sound'), h('span.note', null, 'M anywhere'), toggle),
        ...sliders.map((s) => s.el),
        h('div.kicker', null, 'CONTROLS'),
        touchScreen ? h('div.note', null, 'On this device, drive with the on-screen controls.') : null,
        ...KEYS.map(([group, rows]) => h('div.keys', null,
          h('div.keys-title', null, group),
          ...rows.map(([action, keys]) => h('div.key-row', null, h('span.grow', null, action), h('span.key-caps', null, ...caps(keys)))),
        )),
      ),
      h('div.card-buttons', null, h('div.spacer'), button('Done', () => closeSettings())),
    ),
  );
  ui.append(card);
  // the keyboard is ours until it closes: Esc closes, M mutes, nothing reaches the game
  const keys = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.code.startsWith('Arrow')) return;
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') closeSettings();
    else if (e.code === 'KeyM') {
      audio.setMuted(!audio.isMuted());
      refresh?.();
    }
  };
  addEventListener('keydown', keys, { capture: true });
  stopKeys = () => removeEventListener('keydown', keys, { capture: true });
}

export function closeSettings(): void {
  if (!card) return;
  audio.play('back', 0.5);
  card.remove();
  card = null;
  stopKeys?.();
  stopKeys = null;
  refresh = null;
}

/** a sound level: its name, a gilded slider and the percentage */
function slider(which: audio.Level): { el: HTMLElement; refresh(): void } {
  const names: Record<audio.Level, string> = { volume: 'Master', music: 'Music', effects: 'Effects' };
  const value = h('span.level', null);
  const input = h('input.range', { type: 'range', min: '0', max: '100', step: '5' });
  const show = () => {
    const pct = Math.round(audio.getLevel(which) * 100);
    input.value = String(pct);
    input.style.setProperty('--fill', `${pct}%`);
    value.textContent = `${pct}%`;
  };
  input.addEventListener('input', () => {
    audio.setLevel(which, Number(input.value) / 100);
    show();
  });
  // a click to hear the new effects level
  input.addEventListener('change', () => {
    if (which !== 'music') audio.play('click', 0.6);
  });
  return { el: h('div.crow', null, h('span.grow', null, names[which]), input, value), refresh: show };
}

/** each key as a keycap; ' / ' between alternatives */
function caps(keys: string): Node[] {
  const out: Node[] = [];
  keys.split(' / ').forEach((alt, i) => {
    if (i) out.push(h('span.key-or', null, 'or'));
    for (const k of alt.split(' ')) out.push(h('kbd.key', null, k));
  });
  return out;
}

/** every key the game listens for (input.ts, game/race.ts, ui/parking.ts, game/chase.ts, app.ts) */
const KEYS: [string, [string, string][]][] = [
  ['RACING', [
    ['Accelerate', 'W / ↑'],
    ['Brake and reverse', 'S / ↓'],
    ['Steer', 'A D / ← →'],
    ['Boost', 'Space'],
    ['Use item (multiplayer)', 'E'],
    ['Switch camera', 'V'],
    ['Pause', 'Esc / P'],
    ['Restart (paused)', 'R'],
    ['Quit to menu (paused)', 'Q'],
  ]],
  ['PARKING', [
    ['Forward', 'W / ↑'],
    ['Reverse', 'S / ↓'],
    ['Steer', 'A D / ← →'],
    ['Brake', 'Space'],
    ['Back to levels', 'Esc'],
  ]],
  ['POLICE CHASE', [
    ['Change lane', 'A D / ← →'],
    ['Jump', 'W / ↑ / Space'],
    ['Start', 'Space / Enter'],
    ['Quit', 'Esc'],
  ]],
  ['ANYWHERE', [
    ['Sound on or off', 'M'],
  ]],
];

/** a 16 x 16 pixel gear: eight teeth round a ring, lit from the top left like the gilded art */
function gearIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const on = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x > 15 || y > 15) return false;
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8, r = Math.hypot(dx, dy);
    if (r < 2.3) return false;
    if (r <= 5.3) return true;
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      if (r <= 7.6 && dx * Math.cos(t) + dy * Math.sin(t) > 0 && Math.abs(dy * Math.cos(t) - dx * Math.sin(t)) <= 1.6) return true;
    }
    return false;
  };
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('gear-icon');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!on(x, y)) continue;
      const lit = !on(x - 1, y) || !on(x, y - 1) ? '#fff2a8' : !on(x + 1, y) || !on(x, y + 1) ? '#c9861f' : '#ffcc47';
      const rect = document.createElementNS(ns, 'rect');
      for (const [k, v] of [['x', x], ['y', y], ['width', 1], ['height', 1]] as const) rect.setAttribute(k, String(v));
      rect.setAttribute('fill', lit);
      svg.append(rect);
    }
  }
  return svg;
}

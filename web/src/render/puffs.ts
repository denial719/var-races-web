// Little bits flying off the cars, as camera-facing sprites from a pool:
//  - boost: every time a boosting car burns through one bar of its boost tank (as the HUD shows
//    it), smoke comes off the back of the car and dirt kicks up behind the back tires for half a
//    second
//  - skids: dirt sprays off the back tires while they leave skid marks
//  - crashes, from where it hit and harder for a harder hit: sparks scraping along what it hit,
//    pieces of the car (its paint, dark trim and, in a big hit, glass) that carry on with the
//    car's own speed, bounce and settle on the road, and a cloud of dust that hangs a moment
import * as THREE from 'three';
import { BOOST_SEGMENTS } from '../ui/hud';
import { CAR_L } from './cars';
import type { Rgb } from './geom';
import { hill } from './hills';
import { REAR, SIDE, type SkidTire } from './skids';

/** how long a puff or bit of dirt lasts (s) */
const LIFE = 0.5;
/** how long (s) after a bar is used up the puffs keep coming */
const EMIT = 0.5;
/** smoke puffs, and bits of dirt per back tire, each second */
const SMOKE_RATE = 24;
const DIRT_RATE = 30;
/** bits of dirt per skidding tire each second */
const SKID_DIRT_RATE = 22;
const GRAVITY = 140;
/** crashes: a closing speed (px/s) that counts as a full-strength hit */
const FULL_HIT = 220;
/** how many pieces, sparks and dust puffs a full-strength crash throws */
const PIECES = 22;
const SPARKS = 44;
const DUST = 9;
/** how long the pieces stay (s), lying on the road for most of it */
const PIECE_LIFE: [number, number] = [1.1, 1.8];
/** what's left of a falling bit's bounce, and of its spin and slide after landing */
const BOUNCE = 0.35;
/** most sparks alive at once */
const SPARK_POOL = 600;
const SPARK_GRAVITY = 260;

export interface Crash {
  /** where it hit, and the way back off it (toward the car) */
  x: number; y: number;
  nx: number; ny: number;
  /** the car's velocity, and how fast it closed on and slid along what it hit */
  vx: number; vy: number;
  closing: number;
  slideX: number; slideY: number;
  /** the car's paint */
  body: Rgb | null;
}

interface Puff {
  sprite: THREE.Sprite;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  born: number;
  life: number;
  from: number; to: number;
  alpha: number;
  falls: boolean;
  spin: number;
  /** the share of its life it stays at full strength before fading */
  hold: number;
}

interface Tracked {
  /** boost bars lit, as on the HUD */
  bars: number;
  /** how much longer it puffs, and puffs owed (fractions carry to the next frame) */
  emit: number;
  smoke: number;
  dirt: number;
}

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.userData.sceneOwned = true;
  return t;
}

/** a soft round blob, white so each puff can tint it */
function blob(): THREE.Texture {
  return canvasTexture((g) => {
    const fill = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    fill.addColorStop(0, 'rgba(255,255,255,1)');
    fill.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fill;
    g.fillRect(0, 0, 32, 32);
  });
}

/** a hard-edged shard, for pieces of car */
function shard(): THREE.Texture {
  return canvasTexture((g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(4, 8);
    g.lineTo(26, 3);
    g.lineTo(29, 22);
    g.lineTo(12, 29);
    g.closePath();
    g.fill();
  });
}

const spread = (n: number) => (Math.random() * 2 - 1) * n;
const between = (a: number, b: number) => a + Math.random() * (b - a);
const DIRT_COLOR = (): Rgb => [between(0.36, 0.46), between(0.26, 0.32), between(0.15, 0.2)];
const TRIM_COLOR = (): Rgb => { const v = between(0.08, 0.22); return [v, v, v * 1.05]; };
const GLASS_COLOR = (): Rgb => [between(0.75, 0.9), between(0.88, 0.97), 1];

/**
 * Sparks: short bright streaks (lines from where a spark is back along its path), glowing white
 * hot, then yellow, orange and out.
 */
class Sparks {
  readonly root: THREE.LineSegments;
  private readonly positions = new Float32Array(SPARK_POOL * 2 * 3);
  private readonly colors = new Float32Array(SPARK_POOL * 2 * 3);
  /** x, y, z, vx, vy, vz, age, life for each */
  private readonly state = new Float32Array(SPARK_POOL * 8);
  private next = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.root = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.root.frustumCulled = false;
    for (let i = 0; i < SPARK_POOL; i++) this.state[i * 8 + 7] = -1;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % SPARK_POOL;
    this.state.set([x, y, z, vx, vy, vz, 0, life], i * 8);
  }

  update(delta: number): void {
    const st = this.state, pos = this.positions, col = this.colors;
    for (let i = 0; i < SPARK_POOL; i++) {
      const o = i * 8;
      const life = st[o + 7];
      let heat = 0;
      if (life > 0) {
        st[o + 6] += delta;
        const age = st[o + 6] / life;
        if (age >= 1) st[o + 7] = -1;
        else {
          st[o + 5] -= SPARK_GRAVITY * delta;
          st[o] += st[o + 3] * delta;
          st[o + 1] += st[o + 4] * delta;
          st[o + 2] += st[o + 5] * delta;
          // skips off the road, losing most of its speed
          if (st[o + 2] < 0.2 && st[o + 5] < 0) {
            st[o + 2] = 0.2;
            st[o + 5] *= -0.3;
            st[o + 3] *= 0.6;
            st[o + 4] *= 0.6;
          }
          heat = 1 - age;
        }
      }
      const x = st[o], y = st[o + 1], z = st[o + 2];
      // the tail: where it was a moment ago, so faster sparks streak longer
      const tail = 0.022;
      const tx = x - st[o + 3] * tail, ty = y - st[o + 4] * tail, tz = Math.max(0.2, z - st[o + 5] * tail);
      pos.set([x, y, hill(x, y) + z, tx, ty, hill(tx, ty) + tz], i * 6);
      // white hot, then yellow, then orange as it cools
      const r = heat > 0 ? Math.min(1, heat * 2.2) : 0;
      const gr = Math.min(1, heat * 1.6) * 0.85;
      const b = Math.max(0, heat * 2 - 1) * 0.8;
      col.set([r, gr, b, r * 0.5, gr * 0.3, b * 0.2], i * 6);
    }
    this.root.geometry.getAttribute('position').needsUpdate = true;
    this.root.geometry.getAttribute('color').needsUpdate = true;
  }
}

export class Puffs {
  readonly root = new THREE.Group();
  private readonly soft = blob();
  private readonly hard = shard();
  private readonly sparks = new Sparks();
  private readonly free: THREE.Sprite[] = [];
  private readonly live: Puff[] = [];
  private readonly cars = new Map<number, Tracked>();
  private skidOwed = 0;
  private clock = 0;

  constructor() {
    this.root.add(this.sparks.root);
  }

  /** forgets cars that left the race (their puffs finish on their own) */
  keep(slots: Set<number>): void {
    for (const slot of this.cars.keys()) if (!slots.has(slot)) this.cars.delete(slot);
  }

  update(cars: { slot: number; x: number; y: number; heading: number; boost?: number; boosting?: boolean }[], delta: number): void {
    if (delta <= 0) return;
    this.clock += delta;
    for (const c of cars) if (c.boost !== undefined) this.track(c.slot, c.x, c.y, c.heading, c.boost, c.boosting ?? false, delta);
    this.move(delta);
    this.sparks.update(delta);
  }

  /** dirt off the tires that are leaving skid marks this frame */
  skid(tires: SkidTire[], delta: number): void {
    if (!tires.length) return;
    for (this.skidOwed += SKID_DIRT_RATE * tires.length * delta; this.skidOwed >= 1; this.skidOwed--) {
      const t = tires[Math.floor(Math.random() * tires.length)];
      const fx = Math.cos(t.heading), fy = Math.sin(t.heading);
      // flung back and out to the side the tire is on, as the car slides
      const back = between(20, 50), out = t.side * between(10, 35);
      this.add(t.x, t.y, 0.4, -fx * back - fy * out, -fy * back + fx * out, between(12, 28), between(1, 1.8), between(1, 1.8), 0.9, DIRT_COLOR(), true);
    }
  }

  /** a crash: sparks, pieces of the car and dust, all scaled by how hard it hit */
  crash(c: Crash): void {
    const hard = Math.max(0.3, Math.min(1.6, c.closing / FULL_HIT));
    const slide = Math.hypot(c.slideX, c.slideY);
    // along what it hit, the way the car was scraping (either way if it hit square on)
    const tx = slide > 1 ? c.slideX / slide : -c.ny * Math.sign(spread(1) || 1);
    const ty = slide > 1 ? c.slideY / slide : c.nx * Math.sign(spread(1) || 1);
    const scrape = Math.min(1, slide / 150);

    // sparks: fast, mostly thrown along the way it scraped, low over the road
    for (let i = 0, n = Math.round(SPARKS * hard * (0.5 + 0.5 * scrape)); i < n; i++) {
      const along = between(60, 240) * (Math.random() < 0.15 + 0.35 * (1 - scrape) ? -0.6 : 1);
      const off = between(10, 110);
      const side = spread(50);
      this.sparks.add(
        c.x + spread(1.5), c.y + spread(1.5), between(0.8, 3.2),
        tx * along + c.nx * off - ty * side + c.vx * 0.3, ty * along + c.ny * off + tx * side + c.vy * 0.3,
        between(10, 90), between(0.12, 0.38),
      );
    }

    // pieces of the car: carried on with the car, burst back off the hit and out the sides
    for (let i = 0, n = Math.round(PIECES * hard); i < n; i++) {
      const roll = Math.random();
      const glass = hard > 0.7 && roll < 0.18;
      const color = glass ? GLASS_COLOR() : c.body && roll < 0.68 ? c.body.map((v) => v * between(0.75, 1.1)) as Rgb : TRIM_COLOR();
      const burst = between(20, 90) * hard, a = Math.atan2(c.ny, c.nx) + spread(1.4);
      // a few big panels, mostly little bits
      const size = glass ? between(0.4, 0.9) : Math.random() < 0.15 ? between(1.6, 2.4) : between(0.5, 1.3);
      const p = this.add(
        c.x + spread(1.5), c.y + spread(1.5), between(1, 4.5),
        Math.cos(a) * burst + c.vx * between(0.25, 0.6) + tx * spread(30), Math.sin(a) * burst + c.vy * between(0.25, 0.6) + ty * spread(30),
        between(15, 55) * hard, size, size, glass ? 0.8 : 1, color, true, between(...PIECE_LIFE), this.hard, 0.65,
      );
      p.spin = spread(18);
      p.sprite.material.rotation = Math.random() * Math.PI * 2;
    }

    // dust and smoke: kicked up at the hit, drifting on with the car, spreading and hanging a moment
    for (let i = 0, n = Math.round(DUST * hard); i < n; i++) {
      const grey = between(0.55, 0.7);
      this.add(
        c.x + spread(3), c.y + spread(3), between(0.8, 3),
        c.nx * between(5, 18) + c.vx * between(0.1, 0.3) + spread(8), c.ny * between(5, 18) + c.vy * between(0.1, 0.3) + spread(8),
        between(3, 8), between(3, 5), between(10, 16) * (0.7 + 0.3 * hard), between(0.3, 0.45), [grey, grey * 0.97, grey * 0.92], false,
        between(0.8, 1.3), this.soft, 0.15,
      );
    }
  }

  private track(slot: number, x: number, y: number, heading: number, boost: number, boosting: boolean, delta: number): void {
    const bars = Math.round(Math.max(0, Math.min(1, boost)) * BOOST_SEGMENTS);
    let t = this.cars.get(slot);
    if (!t) {
      t = { bars, emit: 0, smoke: 0, dirt: 0 };
      this.cars.set(slot, t);
    }
    if (boosting && bars < t.bars) t.emit = EMIT;
    t.bars = bars;
    if (t.emit <= 0) return;
    t.emit -= delta;
    // a thick first moment, thinning out over the second
    const thick = 0.4 + 0.6 * Math.max(0, t.emit / EMIT);
    t.smoke += SMOKE_RATE * thick * delta;
    t.dirt += DIRT_RATE * thick * delta;

    const fx = Math.cos(heading), fy = Math.sin(heading);
    const along = (d: number, side: number): [number, number] => [x + fx * d - fy * side, y + fy * d + fx * side];
    // the smoke: grey puffs off the tail, drifting back and up as they spread
    for (; t.smoke >= 1; t.smoke--) {
      const [px, py] = along(-CAR_L / 2 - 1, spread(3));
      const back = between(15, 30), side = spread(10), grey = between(0.7, 0.85);
      this.add(px, py, between(1.5, 3), -fx * back - fy * side, -fy * back + fx * side, between(6, 12), between(3, 4), between(9, 12), 0.55, [grey, grey, grey], false);
    }
    // the dirt: brown bits flung back from each back tire, falling as they go
    for (; t.dirt >= 1; t.dirt--) {
      for (const s of [-1, 1]) {
        const [px, py] = along(REAR, SIDE * s);
        const back = between(40, 80), side = spread(15);
        this.add(px, py, 0.5, -fx * back - fy * side, -fy * back + fx * side, between(15, 35), between(1.2, 2), between(1.2, 2), 0.95, DIRT_COLOR(), true);
      }
    }
  }

  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, from: number, to: number, alpha: number, color: Rgb, falls: boolean, life = LIFE, map = this.soft, hold = 0): Puff {
    const sprite = this.free.pop() ?? this.make();
    sprite.visible = true;
    const m = sprite.material;
    m.map = map;
    m.rotation = 0;
    m.color.setRGB(...color);
    const p = { sprite, x, y, z, vx, vy, vz, born: this.clock, life, from, to, alpha, falls, spin: 0, hold };
    this.live.push(p);
    return p;
  }

  private make(): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, transparent: true, depthWrite: false, fog: true }));
    this.root.add(sprite);
    return sprite;
  }

  private move(delta: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      const age = (this.clock - p.born) / p.life;
      if (age >= 1) {
        p.sprite.visible = false;
        this.free.push(p.sprite);
        this.live.splice(i, 1);
        continue;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      if (p.falls) {
        p.vz -= GRAVITY * delta;
        p.z += p.vz * delta;
        if (p.z < 0.3) {
          p.z = 0.3;
          if (p.vz < -20) {
            // bounces, losing most of its speed
            p.vz *= -BOUNCE;
            p.vx *= 0.7; p.vy *= 0.7;
            p.spin *= 0.6;
          } else {
            // lying on the road: it scrapes to a stop
            p.vz = 0;
            const drag = Math.exp(-6 * delta);
            p.vx *= drag; p.vy *= drag;
            p.spin *= drag;
          }
        }
      } else {
        // smoke slows as it spreads
        const drag = Math.exp(-3 * delta);
        p.vx *= drag; p.vy *= drag;
        p.z += p.vz * delta;
      }
      p.sprite.material.rotation += p.spin * delta;
      p.sprite.position.set(p.x, p.y, hill(p.x, p.y) + p.z);
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * age);
      p.sprite.material.opacity = p.alpha * Math.min(1, (1 - age) / (1 - p.hold));
    }
  }
}

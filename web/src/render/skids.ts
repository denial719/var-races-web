// Skid marks: dark streaks the back tires leave on the road in a hard turn. A turn marks the
// road once it has been held for half a second, if the car went into it at 75 mph or more. Each
// piece of a streak fades on its own shortly after it's laid, so a skid fades from where it
// started toward the car, and only a short trail follows it.
//
// All the marks are quads in one ring buffer (oldest written over first), lying flat on the
// ground and lifted onto the hills like the road under them.
import * as THREE from 'three';
import { CAR_L, CAR_W } from './cars';
import { lift } from './hills';

/** how many mark pieces (one per back tire per frame) are kept at once */
const SEGMENTS = 3000;
/** the wheels count as turned (a turn button held) past this */
const TURNING = 0.5;
/** a turn has to be held this long (s) before it marks */
const START_AFTER = 0.4;
/** and the car has to go into it at 75 mph or more (2.5 px/s per mph) */
const MIN_ENTRY_SPEED = 80 * 2.5;
/** once a skid has begun, the tires keep marking this long (s) after the turn is let go, fading out */
const AFTER = 0.5;
/** a car that jumps further than this in one frame was placed (a respawn), not driven */
const JUMP = 60;
/** where the back tires are: behind the middle, and either side of it */
export const REAR = -(CAR_L / 2 - 0.21 * CAR_L);
export const SIDE = CAR_W / 2 - 1;
/** the mark sits just above the road */
const LIFT = 0.35;
/** each piece stays dark this long (s), then fades out over FADE */
const HOLD = 0.35;
const FADE = 0.6;
const COLOR = new THREE.Color(0.08, 0.08, 0.09);

/** how dark and how wide a piece is, by how long the turn has been held */
const strength = (held: number) => Math.min(0.6, 0.3 + (held - START_AFTER) * 0.3);
const width = (held: number) => 1.3 + Math.min(0.7, (held - START_AFTER) * 0.35);

interface Tracked {
  x: number;
  y: number;
  /** which way the current turn goes (-1, 0 for none, 1), how long it's been held, and the speed going in */
  turn: number;
  held: number;
  entry: number;
  /** after a skid's turn is let go: how long it keeps marking, and how long that turn was held */
  trail: number;
  trailHeld: number;
  tires: [number, number][] | null;
}

/** a back tire leaving a mark this frame; side is 1 for the left tire, -1 for the right */
export interface SkidTire { x: number; y: number; heading: number; side: number; }

const skidding = (t: Tracked) => t.turn !== 0 && t.held >= START_AFTER && t.entry >= MIN_ENTRY_SPEED;

export class SkidMarks {
  readonly root: THREE.Mesh;
  private readonly positions = new Float32Array(SEGMENTS * 4 * 3);
  private readonly colors = new Float32Array(SEGMENTS * 4 * 4);
  /** when each piece was laid, and how dark */
  private readonly born = new Float32Array(SEGMENTS).fill(-Infinity);
  private readonly dark = new Float32Array(SEGMENTS);
  private readonly cars = new Map<number, Tracked>();
  private readonly marking: SkidTire[] = [];
  private next = 0;
  private clock = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const index = new Uint32Array(SEGMENTS * 6);
    for (let i = 0; i < SEGMENTS; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 3, i * 4], i * 6);
    for (let v = 0; v < SEGMENTS * 4; v++) this.colors.set([COLOR.r, COLOR.g, COLOR.b, 0], v * 4);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // the marks are spread over the whole map, so never cull them
    const material = lift(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.root = new THREE.Mesh(geometry, material);
    this.root.frustumCulled = false;
    this.root.renderOrder = -40;
  }

  /** forgets cars that left the race (their marks stay and fade) */
  keep(slots: Set<number>): void {
    for (const slot of this.cars.keys()) if (!slots.has(slot)) this.cars.delete(slot);
  }

  /** lays this frame's marks, and says which tires are marking (for the dirt they throw up) */
  update(cars: { slot: number; x: number; y: number; heading: number; steer?: number; speed?: number }[], delta: number): SkidTire[] {
    this.marking.length = 0;
    if (delta <= 0) return this.marking;
    this.clock += delta;
    for (const c of cars) this.track(c.slot, c.x, c.y, c.heading, c.steer ?? 0, c.speed ?? 0, delta);
    this.fade();
    return this.marking;
  }

  private track(slot: number, x: number, y: number, heading: number, steer: number, speed: number, delta: number): void {
    let t = this.cars.get(slot);
    if (!t || Math.hypot(x - t.x, y - t.y) > JUMP) {
      t = { x, y, turn: 0, held: 0, entry: 0, trail: 0, trailHeld: 0, tires: null };
      this.cars.set(slot, t);
    }
    t.x = x; t.y = y;

    const turn = Math.abs(steer) > TURNING ? Math.sign(steer) : 0;
    if (turn !== t.turn) {
      // a skid's turn let go: it trails on a little longer
      if (skidding(t)) {
        t.trail = AFTER;
        t.trailHeld = t.held;
      }
      // a new turn (or none): start counting again, from the speed going in
      t.turn = turn;
      t.held = 0;
      t.entry = speed;
    }
    if (turn !== 0) t.held += delta;

    let w: number, alpha: number;
    if (skidding(t)) {
      t.trail = 0;
      w = width(t.held);
      alpha = strength(t.held);
    } else if (t.trail > 0) {
      t.trail -= delta;
      w = width(t.trailHeld);
      alpha = strength(t.trailHeld) * Math.max(0, t.trail / AFTER);
    } else {
      t.tires = null;
      return;
    }

    // the back tires, in map coordinates
    const fx = Math.cos(heading), fy = Math.sin(heading);
    const tires: [number, number][] = [-1, 1].map((s) => [x + fx * REAR - fy * SIDE * s, y + fy * REAR + fx * SIDE * s]);
    if (t.tires) for (let i = 0; i < 2; i++) this.lay(t.tires[i], tires[i], w, alpha);
    t.tires = tires;
    // the dirt thins out with the trailing mark
    if (Math.random() < alpha / 0.4) tires.forEach(([tx, ty], i) => this.marking.push({ x: tx, y: ty, heading, side: i ? 1 : -1 }));
  }

  /** one piece of mark from a to b */
  private lay(a: [number, number], b: [number, number], w: number, alpha: number): void {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return;
    const nx = (-dy / length) * w / 2, ny = (dx / length) * w / 2;
    const i = this.next;
    this.next = (this.next + 1) % SEGMENTS;
    this.positions.set([
      a[0] - nx, a[1] - ny, LIFT,
      b[0] - nx, b[1] - ny, LIFT,
      b[0] + nx, b[1] + ny, LIFT,
      a[0] + nx, a[1] + ny, LIFT,
    ], i * 12);
    this.born[i] = this.clock;
    this.dark[i] = alpha;
    this.root.geometry.getAttribute('position').needsUpdate = true;
  }

  /** every piece fades on its own clock, so the oldest part of a skid goes first */
  private fade(): void {
    const c = this.colors;
    for (let i = 0; i < SEGMENTS; i++) {
      const left = this.born[i] + HOLD + FADE - this.clock;
      const alpha = left > 0 ? this.dark[i] * Math.min(1, left / FADE) : 0;
      for (let v = 0; v < 4; v++) c[(i * 4 + v) * 4 + 3] = alpha;
    }
    this.root.geometry.getAttribute('color').needsUpdate = true;
  }
}

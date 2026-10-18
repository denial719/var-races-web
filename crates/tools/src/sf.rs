//! Paints the San Francisco map in the game's 16-bit pixel style, plus the Waymo car sprite,
//! and the classic map's preview for the map picker.
//!
//! The map is 2880 x 1620, painted and stored at 1/3 size (960 x 540 art pixels) and scaled up
//! 3x in the game so every art pixel is a crisp 3 x 3 block. The road follows the circuit in
//! circuits.rs. Coordinates are world coordinates
//! (y up, like the game) unless they're called ax / ay (art pixels, y down).

use std::path::Path;

use crate::circuits::{Field, Line};
use crate::cities::{save_map, sprite, AH, AW, H, ROAD, S, W, WALK};
use crate::image::{blend, rgb, Picture};
use crate::jrand::JRandom;
use crate::masks::read_rgba;

const ASPHALT: u32 = rgb(0x4b4d55);
const ASPHALT_SPECK: u32 = rgb(0x44464d);
const LANE: u32 = rgb(0xe9e4d6);
const CURB: u32 = rgb(0x7a766e);
/// the landmarks, where they stand (the 3D models in web/src/render/landmarks.ts stand on the same
/// spots, and its bridges find the same stretches of track)
const TRANSAMERICA: [i32; 2] = [1950, 700];
const COIT: [i32; 2] = [1600, 985];
const FERRY: [i32; 4] = [2400, 518, 2650, 572];
const ALCATRAZ: [i32; 2] = [2690, 1540];
const PALACE: [i32; 2] = [450, 1290];
const ORACLE: [i32; 2] = [2430, 240];
const DRAGON_GATE: [i32; 2] = [1380, 560];
/// the stretches of track that are famous streets (from, to, in the order you drive them):
/// Lombard Street's crooked bends, and
/// California Street with its cable cars
const LOMBARD: [[f64; 2]; 2] = [[1562.0, 313.0], [1015.0, 343.0]];
const CALIFORNIA: [[f64; 2]; 2] = [[980.0, 355.0], [420.0, 450.0]];
/// a point on each bridge: the Golden Gate (orange) and the Bay Bridge (silver)
const GOLDEN_GATE: [f64; 2] = [1200.0, 1490.0];
const BAY_BRIDGE: [f64; 2] = [2400.0, 820.0];
const KERB_RED: u32 = rgb(0xd9433b);
/// how sharply the line has to turn for a kerb on the inside (radians per map pixel)
const CORNER: f64 = 0.0035;
const WALK_A: u32 = rgb(0xc9c2b4);
const WALK_B: u32 = rgb(0xbab2a3);
const WATER: u32 = rgb(0x2f6ea6);
const WAVE: u32 = rgb(0x4d8fc6);
const WAVE_DARK: u32 = rgb(0x275d8e);
const SAND: u32 = rgb(0xcdb98d);
const GRASS: u32 = rgb(0x6aa84f);
const GRASS_LIGHT: u32 = rgb(0x82bd5e);
const TREE: u32 = rgb(0x3b7537);
const TREE_LIGHT: u32 = rgb(0x58994a);
const TREE_DARK: u32 = rgb(0x2a5528);
const OUTLINE: u32 = rgb(0x2a1d17);
const ORANGE: u32 = rgb(0xc4402f);
const ORANGE_LIGHT: u32 = rgb(0xe0634c);
const ORANGE_DARK: u32 = rgb(0x8c2a20);
const DECK: u32 = rgb(0x8f8a83);
const ALLEY: u32 = rgb(0x6f6a62);
const BRICK: u32 = rgb(0xb5523b);
const WHITE: u32 = rgb(0xf2efe6);
const ROCK: u32 = rgb(0x8c7d6a);
const ROCK_DARK: u32 = rgb(0x6c5f50);
const ROOFS: [u32; 8] = [
    rgb(0xe8a0a8), rgb(0x9fd3c7), rgb(0xc3a6e0), rgb(0xf2d27a), rgb(0x8fb8e8), rgb(0xf0b07a), rgb(0xe6dccb), rgb(0xd98c7a),
];
const TOWERS: [u32; 5] = [rgb(0x9aa5b1), rgb(0x8796a6), rgb(0xb3b8bd), rgb(0x7f8a99), rgb(0xa9b4c4)];

struct Sf {
    line: Line,
    field: Field,
    /// which centre line samples are on Lombard Street, and on California Street
    lombard: Vec<bool>,
    california: Vec<bool>,
    art: Vec<u32>,
    /// art pixels already taken by parks and landmarks, so houses go around them
    reserved: Vec<bool>,
    ignore_reserved: bool,
    rnd: JRandom,
}

pub fn paint(root: &Path) -> Result<(), String> {
    let line = Line::for_map("sf");
    let mut sf = Sf {
        field: Field::new(&line),
        lombard: line.stretch(LOMBARD[0], LOMBARD[1]),
        california: line.stretch(CALIFORNIA[0], CALIFORNIA[1]),
        line,
        art: vec![0; (AW * AH) as usize],
        reserved: vec![false; (AW * AH) as usize],
        ignore_reserved: false,
        rnd: JRandom::new(1906),
    };
    sf.ground();
    sf.city();
    sf.landmarks();
    sf.roads();
    sf.bridge();

    save_map(root, "sf", &sf.art, |x, y| sf.road_distance(x, y) <= ROAD)?;
    // the classic map's preview, from its hand-made picture
    let classic = read_rgba(&root.join("assets/maps/classic/background.png"))
        .or_else(|_| read_rgba(Path::new("assets/maps/classic/background.png")))?;
    let mut pic = Picture::new(classic.width, classic.height);
    for (i, px) in classic.pixels.chunks(4).enumerate() {
        pic.pixels[i] = (px[3] as u32) << 24 | (px[0] as u32) << 16 | (px[1] as u32) << 8 | px[2] as u32;
    }
    pic.shrink(384, 216).save(root.join("assets/maps/classic/preview.png"), false)?;
    waymo().save(root.join("assets/ui/waymo.png"), true)?;
    println!("San Francisco painted");
    Ok(())
}

impl Sf {
    fn set(&mut self, ax: i32, ay: i32, c: u32) {
        if ax >= 0 && ay >= 0 && ax < AW && ay < AH {
            self.art[(ay * AW + ax) as usize] = c;
        }
    }

    fn get(&self, ax: i32, ay: i32) -> u32 {
        self.art[(ay * AW + ax) as usize]
    }

    fn shade(&mut self, ax: i32, ay: i32, f: f64) {
        if ax >= 0 && ay >= 0 && ax < AW && ay < AH {
            let c = blend(self.get(ax, ay), rgb(0x000000), 1.0 - f);
            self.set(ax, ay, c);
        }
    }

    fn disc(&mut self, cx: i32, cy: i32, r: i32, c: u32) {
        for y in -r..=r {
            for x in -r..=r {
                if x * x + y * y <= r * r + r / 2 {
                    self.set(cx + x, cy + y, c);
                }
            }
        }
    }

    /// how far (x, y) is from the centre line
    fn road_distance(&self, x: i32, y: i32) -> i32 {
        self.field.distance(x, y)
    }

    /// the water: the Golden Gate strait under the main straight, the bay above the Wharf,
    /// Mission Bay under the Bay Bridge, and down the east side to McCovey Cove
    fn water(x: i32, y: i32) -> bool {
        let (xf, yf) = (x as f64, y as f64);
        let wave = 10.0 * (xf / 47.0).sin() + 6.0 * (xf / 13.0).sin();
        let strait = yf > 1330.0 + wave && xf > 650.0 + 14.0 * (yf / 31.0).sin() && xf < 1700.0 + 12.0 * (yf / 29.0).sin();
        let bay = yf > 1395.0 + wave && xf > 1960.0 + 12.0 * (yf / 29.0).sin();
        let mission = xf > 2262.0 + 10.0 * (yf / 37.0).sin() && yf > 592.0 + 6.0 * (xf / 23.0).sin() && yf < 1000.0 + 8.0 * (xf / 31.0).sin();
        let east = xf > 2785.0 + 6.0 * (yf / 37.0).sin() && yf < 1000.0;
        let cove = xf > 2660.0 + 8.0 * (yf / 19.0).sin() && yf < 470.0;
        strait || bay || mission || east || cove
    }

    fn near_water(x: i32, y: i32, d: i32) -> bool {
        Sf::water(x + d, y) || Sf::water(x - d, y) || Sf::water(x, y + d) || Sf::water(x, y - d)
    }

    /// true where nothing else should be painted: not road, sidewalk or water
    fn free(&self, x: i32, y: i32) -> bool {
        x >= 0
            && y >= 0
            && x < W
            && y < H
            && self.road_distance(x, y) > ROAD + WALK
            && !Sf::water(x, y)
            && !Sf::near_water(x, y, 6)
            && (self.ignore_reserved || !self.reserved[(((H - 1 - y) / S) * AW + (AW - 1).min(x / S)) as usize])
    }

    fn reserve(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        for ay in (H - y1) / S..=(H - y0) / S {
            for ax in x0 / S..=x1 / S {
                if ax >= 0 && ay >= 0 && ax < AW && ay < AH {
                    self.reserved[(ay * AW + ax) as usize] = true;
                }
            }
        }
    }

    fn ground(&mut self) {
        for ay in 0..AH {
            for ax in 0..AW {
                let (x, y) = (ax * S + 1, H - ay * S - 1);
                let c = if Sf::water(x, y) {
                    // rows of little waves
                    let n = (ax * 7 + ay * 13 + (ay / 3) * 5) % 23;
                    if n == 0 {
                        WAVE
                    } else if n == 11 {
                        WAVE_DARK
                    } else {
                        WATER
                    }
                } else if Sf::near_water(x, y, 6) {
                    SAND
                } else if (ax + ay) % 9 == 0 {
                    GRASS_LIGHT
                } else {
                    GRASS
                };
                self.set(ax, ay, c);
            }
        }
        // the fog rolling in over the bay (dithered, the 16-bit way)
        self.fog(900, 1580, 240, 50);
        self.fog(1350, 1390, 150, 34);
        self.fog(2200, 1570, 220, 40);
        self.fog(2500, 760, 120, 40);
    }

    fn fog(&mut self, cx: i32, cy: i32, rx: i32, ry: i32) {
        for ay in 0..AH {
            for ax in 0..AW {
                let (x, y) = (ax * S, H - ay * S);
                let d = ((x - cx) as f64 / rx as f64).powi(2) + ((y - cy) as f64 / ry as f64).powi(2);
                if d < 1.0 && Sf::water(x, y) && ((ax + ay) % 2 == 0 || d < 0.35) {
                    let c = blend(self.get(ax, ay), WHITE, if d < 0.35 { 0.55 } else { 0.35 });
                    self.set(ax, ay, c);
                }
            }
        }
    }

    /// blocks of houses and towers everywhere that isn't road, sidewalk, water or a park
    fn city(&mut self) {
        // parks and landmark spots first so houses don't go there
        self.park(0, 0, 120, H); // the Presidio along the left
        self.park(0, 1180, 650, H);
        self.park(270, 1150, 650, 1420); // the Palace of Fine Arts' grounds
        self.reserve(270, 1150, 650, 1420);
        self.park(1440, 860, 1760, 1110); // Telegraph Hill (Coit Tower)
        self.reserve(1440, 860, 1760, 1110);
        self.park(720, 640, 1060, 880); // Alamo Square
        self.reserve(700, 560, 1080, 880);
        self.reserve(TRANSAMERICA[0] - 70, TRANSAMERICA[1] - 70, TRANSAMERICA[0] + 70, TRANSAMERICA[1] + 70);
        self.reserve(ORACLE[0] - 200, ORACLE[1] - 170, ORACLE[0] + 200, ORACLE[1] + 170);
        self.reserve(DRAGON_GATE[0] - 40, DRAGON_GATE[1] - 30, DRAGON_GATE[0] + 40, DRAGON_GATE[1] + 30);
        self.reserve(FERRY[0] - 10, FERRY[1] - 10, FERRY[2] + 10, FERRY[3] + 10);
        // neighborhoods: small painted houses; downtown: big gray towers
        self.houses(1650, 380, 2250, 1020, true); // downtown
        self.houses(1180, 400, 1650, 860, true); // the Financial District
        self.reserve(1650, 380, 2250, 1020);
        self.reserve(1180, 400, 1650, 860);
        self.houses(120, 0, 2880, 1180, false);
        self.houses(1760, 1060, 2880, 1400, false); // North Beach
        self.houses(650, 1180, 1700, 1340, false);
    }

    fn park(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        let mut y = y0;
        while y < y1 {
            let mut x = x0;
            while x < x1 {
                if self.free(x, y) {
                    let (ax, ay) = (x / S, (H - y) / S);
                    self.set(ax, ay, if (ax * 3 + ay * 5) % 11 == 0 { GRASS_LIGHT } else { GRASS });
                }
                x += S;
            }
            y += S;
        }
        // trees, round with a lit top-left, scattered but not on top of each other
        for _ in 0..(x1 - x0) * (y1 - y0) / 2600 {
            let x = x0 + self.rnd.next_int((x1 - x0).max(1));
            let y = y0 + self.rnd.next_int((y1 - y0).max(1));
            if self.free(x, y) && self.free(x + 24, y) && self.free(x - 24, y) && self.free(x, y + 24) && self.free(x, y - 24) {
                let r = 3 + self.rnd.next_int(3);
                self.tree(x / S, (H - y) / S, r);
            }
        }
    }

    fn tree(&mut self, cx: i32, cy: i32, r: i32) {
        self.disc(cx + 1, cy + 1, r, TREE_DARK); // shadow
        self.disc(cx, cy, r, TREE);
        self.disc(cx - r / 3, cy - r / 3, (r / 2).max(1), TREE_LIGHT);
        self.set(cx + r / 3, cy - r / 2, TREE_LIGHT);
    }

    fn houses(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, downtown: bool) {
        // the ground between buildings is paved, not grass
        let mut y = y0;
        while y < y1 {
            let mut x = x0;
            while x < x1 {
                if self.free(x, y) {
                    let (ax, ay) = (x / S, (H - y) / S);
                    let c = if !downtown {
                        ALLEY
                    } else if ax % 6 == 0 || ay % 6 == 0 {
                        rgb(0xa9a296)
                    } else {
                        rgb(0xbdb6a8)
                    };
                    self.set(ax, ay, c);
                }
                x += S;
            }
            y += S;
        }
        if downtown {
            // towers of different sizes on a loose grid
            let mut by = y0;
            while by < y1 {
                let mut bx = x0;
                while bx < x1 - 30 {
                    let bw = 54 + 12 * self.rnd.next_int(4);
                    let color = TOWERS[self.rnd.next_int(TOWERS.len() as i32) as usize];
                    self.building(bx, by, bw.min(x1 - bx), 60.min(y1 - by), color, true);
                    bx += bw + 6;
                }
                by += 66;
            }
            return;
        }
        // city blocks: two rows of narrow, deep row houses back to back, little gardens between
        let (depth, garden, gap) = (33, 12, 6);
        let mut by = y0;
        while by < y1 - depth {
            for row in 0..2 {
                let ry = by + row * (depth + garden);
                if ry + depth > y1 {
                    break;
                }
                if row == 1 {
                    // back gardens behind the first row
                    let mut y = ry - garden;
                    while y < ry {
                        let mut x = x0;
                        while x < x1 {
                            if self.free(x, y) {
                                self.set(x / S, (H - y) / S, if (x / S + y / S) % 4 == 0 { GRASS_LIGHT } else { GRASS });
                            }
                            x += S;
                        }
                        y += S;
                    }
                }
                let mut x = x0;
                while x < x1 - 15 {
                    let w = 18 + 3 * self.rnd.next_int(4);
                    let color = ROOFS[self.rnd.next_int(ROOFS.len() as i32) as usize];
                    self.building(x, ry, w.min(x1 - x), depth, color, false);
                    x += w;
                }
            }
            by += depth * 2 + garden + gap;
        }
    }

    /// one roof seen from above: outline, lit and shaded halves, ridge, details; a shadow beside
    fn building(&mut self, x: i32, y: i32, w: i32, h: i32, color: u32, tower: bool) {
        let (ax0, ax1, ay0, ay1) = (x / S, (x + w) / S - 1, (H - (y + h)) / S, (H - y) / S - 1);
        if ax1 - ax0 < 2 || ay1 - ay0 < 2 {
            return;
        }
        // only where the whole building has room (never over sidewalks, road or water)
        for ay in ay0..=ay1 {
            for ax in ax0..=ax1 {
                if !self.free(ax * S + 1, H - ay * S - 1) {
                    return;
                }
            }
        }
        for ay in ay0..=ay1 + 1 {
            for ax in ax0 + 1..=ax1 + 1 {
                if ay > ay1 || ax > ax1 {
                    self.shade(ax, ay, 0.7); // shadow on the bottom right
                }
            }
        }
        let mid = (ax0 + ax1) / 2;
        for ay in ay0..=ay1 {
            for ax in ax0..=ax1 {
                let c = if ax == ax0 || ax == ax1 || ay == ay0 || ay == ay1 {
                    OUTLINE
                } else if !tower && ax == mid {
                    blend(color, OUTLINE, 0.4) // the ridge, running front to back
                } else if !tower && ay == ay0 + 1 {
                    blend(color, WHITE, 0.35) // the front edge (bay windows) catches the light
                } else if !tower {
                    if ax < mid { blend(color, WHITE, 0.16) } else { blend(color, OUTLINE, 0.14) }
                } else if ax == ax0 + 1 || ay == ay0 + 1 {
                    blend(color, WHITE, 0.25) // the lit edge of a flat roof
                } else {
                    color
                };
                self.set(ax, ay, c);
            }
        }
        if tower {
            // rooftop units
            for _ in 0..2 {
                let ux = ax0 + 2 + self.rnd.next_int((ax1 - ax0 - 4).max(1));
                let uy = ay0 + 2 + self.rnd.next_int((ay1 - ay0 - 4).max(1));
                self.set(ux, uy, rgb(0x5d636b));
                self.set(ux + 1, uy, rgb(0x5d636b));
            }
        } else if self.rnd.next_int(3) == 0 {
            self.set(mid + 1, ay1 - 2, OUTLINE); // a chimney
        }
    }

    fn landmarks(&mut self) {
        // Alamo Square, and the Painted Ladies facing it
        let ladies = [rgb(0xf3b6c4), rgb(0x9fd3c7), rgb(0xf2d27a), rgb(0xc3a6e0), rgb(0x8fb8e8), rgb(0xf0b07a), rgb(0xe8a0a8)];
        self.ignore_reserved = true;
        for (i, &c) in ladies.iter().enumerate() {
            self.building(732 + i as i32 * 45, 580, 42, 45, c, false);
        }
        self.ignore_reserved = false;

        // the Transamerica Pyramid, seen from straight above
        self.pyramid(TRANSAMERICA[0] / S, (H - TRANSAMERICA[1]) / S, 12);
        // Coit Tower on Telegraph Hill
        let (cx, cy) = (COIT[0] / S, (H - COIT[1]) / S);
        for i in 1..=2 {
            self.shade(cx + 6 + i, cy + i, 0.7);
        }
        self.disc(cx, cy, 6, OUTLINE);
        self.disc(cx, cy, 5, WHITE);
        self.disc(cx, cy, 2, rgb(0xcfc8b8));

        // the Ferry Building and its clock tower, on the shore at the foot of the Bay Bridge
        let [x0, y0, x1, y1] = FERRY;
        let (fx0, fx1, fy0, fy1) = (x0 / S, x1 / S, (H - y1) / S, (H - y0) / S);
        for ay in fy0 - 1..=fy1 + 1 {
            for ax in fx0 - 1..=fx1 + 1 {
                let edge = ax < fx0 || ax > fx1 || ay < fy0 || ay > fy1;
                self.set(ax, ay, if edge { OUTLINE } else if ay == fy0 { rgb(0xf1e6cf) } else { rgb(0xdccdb0) });
            }
        }
        let (tx, ty) = ((fx0 + fx1) / 2, (fy0 + fy1) / 2);
        for ay in ty - 4..=ty + 4 {
            for ax in tx - 4..=tx + 4 {
                let edge = (ax - tx).abs() == 4 || (ay - ty).abs() == 4;
                self.set(ax, ay, if edge { OUTLINE } else { rgb(0xc7b08a) });
            }
        }
        self.set(tx, ty, rgb(0x2f6f62));
        // piers out into Mission Bay and the east side
        for px in [2700, 2830] {
            for ax in (px - 16) / S..=(px + 16) / S {
                for ay in (H - 770) / S..=(H - 610) / S {
                    if Sf::water(ax * S, H - ay * S) && self.road_distance(ax * S, H - ay * S) > ROAD + WALK + 20 {
                        let edge = ax == (px - 16) / S || ax == (px + 16) / S;
                        self.set(ax, ay, if edge { OUTLINE } else { rgb(0x8a6a4a) });
                    }
                }
            }
        }
        self.wharf();
        self.palace_of_fine_arts();
        self.oracle_park();
        self.dragon_gate();

        // Alcatraz, out in the bay
        let (ix, iy) = (ALCATRAZ[0] / S, (H - ALCATRAZ[1]) / S);
        for ay in iy - 9..=iy + 9 {
            for ax in ix - 22..=ix + 22 {
                let d = ((ax - ix) as f64 / 22.0).powi(2) + ((ay - iy) as f64 / 9.0).powi(2);
                if d < 1.0 {
                    self.set(ax, ay, if d > 0.75 { ROCK_DARK } else if (ax + ay) % 6 == 0 { GRASS } else { ROCK });
                }
            }
        }
        for ay in iy - 3..=iy + 2 {
            for ax in ix - 9..=ix + 7 {
                let edge = ay == iy - 3 || ay == iy + 2 || ax == ix - 9 || ax == ix + 7;
                self.set(ax, ay, if edge { OUTLINE } else { WHITE });
            }
        }
        self.set(ix + 12, iy - 4, OUTLINE);
        self.set(ix + 12, iy - 5, rgb(0xffe08a)); // the lighthouse
    }

    /// the Palace of Fine Arts: a terracotta rotunda behind its lagoon, with a curving colonnade
    fn palace_of_fine_arts(&mut self) {
        let (cx, cy) = (PALACE[0] / S, (H - PALACE[1]) / S);
        // the lagoon in front (south)
        for ay in cy + 6..cy + 22 {
            for ax in cx - 26..=cx + 26 {
                let d = ((ax - cx) as f64 / 26.0).powi(2) + ((ay - cy - 14) as f64 / 8.0).powi(2);
                if d < 1.0 {
                    self.set(ax, ay, if d > 0.8 { SAND } else if (ax + ay) % 7 == 0 { WAVE } else { WATER });
                }
            }
        }
        // the colonnade: an arc of columns behind the rotunda
        for k in 0..=24 {
            let a = std::f64::consts::PI * (k as f64 / 24.0);
            let (x, y) = (cx + (30.0 * a.cos()) as i32, cy - (14.0 * a.sin()) as i32);
            self.set(x, y, rgb(0xd9a982));
            self.set(x, y + 1, rgb(0xb98a66));
        }
        // the rotunda: an ochre dome with a green-grey top
        for i in 1..=2 {
            self.shade(cx + 9 + i, cy + i, 0.7);
        }
        self.disc(cx, cy, 9, OUTLINE);
        self.disc(cx, cy, 8, rgb(0xd28b5a));
        self.disc(cx - 2, cy - 2, 4, rgb(0xe3a77a));
        self.disc(cx, cy, 2, rgb(0x7f9a8a));
    }

    /// Oracle Park: the Giants' ballpark on McCovey Cove, its diamond, stands and the big glove
    fn oracle_park(&mut self) {
        let (cx, cy) = (ORACLE[0] / S, (H - ORACLE[1]) / S);
        let r = 50;
        for ay in cy - r..=cy + r {
            for ax in cx - r..=cx + r {
                let (dx, dy) = ((ax - cx) as f64, (ay - cy) as f64);
                let d = (dx * dx + dy * dy).sqrt();
                if d > r as f64 {
                    continue;
                }
                // home plate at the bottom left, the outfield fanning out to the top right
                let a = (-dy).atan2(dx);
                let c = if d > r as f64 - 7.0 {
                    if (ax + ay) % 3 == 0 { rgb(0xf08a2e) } else { rgb(0x4a4c55) } // the stands, orange seats
                } else if d > r as f64 - 8.0 {
                    OUTLINE
                } else if (a - 0.8).abs() < 0.5 && d < 22.0 {
                    rgb(0xc8956a) // the infield dirt
                } else if ((ax / 3) + (ay / 3)) % 2 == 0 {
                    rgb(0x5aa84a)
                } else {
                    rgb(0x67b552)
                };
                self.set(ax, ay, c);
            }
        }
        // the bases
        for (bx, by) in [(cx + 4, cy - 4), (cx + 14, cy - 14), (cx + 4, cy - 14), (cx + 14, cy - 4)] {
            self.set(bx, by, WHITE);
        }
        // the giant Coke bottle and glove behind left field
        self.disc(cx - 34, cy - 30, 3, rgb(0xb5523b));
        self.disc(cx - 26, cy - 38, 2, rgb(0x8c6a3a));
    }

    /// the Dragon Gate at the entrance to Chinatown: green tiled roofs on red pillars
    fn dragon_gate(&mut self) {
        let (cx, cy) = (DRAGON_GATE[0] / S, (H - DRAGON_GATE[1]) / S);
        for ay in cy - 4..=cy + 4 {
            for ax in cx - 12..=cx + 12 {
                let roof = ay <= cy - 1;
                let pillar = !roof && ((ax - cx).abs() == 10 || (ax - cx).abs() == 4);
                if roof || pillar {
                    let edge = ay == cy - 4 || ax == cx - 12 || ax == cx + 12;
                    self.set(ax, ay, if edge { OUTLINE } else if roof { rgb(0x3f8f5a) } else { rgb(0xc8302c) });
                }
            }
        }
        self.set(cx, cy - 5, rgb(0xf2c84b));
        for i in 1..=2 {
            self.shade(cx + 12 + i, cy + i, 0.7);
        }
    }

    /// Fisherman's Wharf: wooden piers out into the bay, the sea lions lazing on Pier 39's
    /// floating docks, fishing boats and the big crab sign
    fn wharf(&mut self) {
        let shore = 1395;
        for (k, px) in [2100, 2230, 2360, 2490].into_iter().enumerate() {
            let (len, half) = (if k == 1 { 150 } else { 110 }, 20);
            // the pier, with a shed or two on it
            for ay in (H - (shore + len)) / S..=(H - shore + 12) / S {
                for ax in (px - half) / S..=(px + half) / S {
                    let (x, y) = (ax * S, H - ay * S);
                    if !Sf::water(x, y) && y < shore - 6 {
                        continue;
                    }
                    let edge = ax == (px - half) / S || ax == (px + half) / S || ay == (H - (shore + len)) / S;
                    self.set(ax, ay, if edge { OUTLINE } else if (ay % 3) == 0 { rgb(0x7a5a3c) } else { rgb(0x8a6a4a) });
                }
            }
            if k != 1 {
                self.building(px - 14, shore + 40, 28, 42, [rgb(0xc95b42), rgb(0x4a8fb8), rgb(0xd9b25a), rgb(0x6f9a5a)][k], false);
            }
            // fishing boats tied up alongside
            for b in 0..2 {
                let (bx, by) = ((px + half + 6) / S, (H - (shore + 30 + b * 45)) / S);
                for ay in by - 2..=by + 2 {
                    for ax in bx..bx + 7 {
                        let edge = ay == by - 2 || ay == by + 2 || ax == bx || ax == bx + 6;
                        self.set(ax, ay, if edge { OUTLINE } else if b == 0 { WHITE } else { rgb(0xd9433b) });
                    }
                }
            }
        }
        // Pier 39's floating docks, crowded with sea lions
        let (dx, dy) = (2230 / S, (H - (shore + 150)) / S);
        for d in 0..3 {
            let (x0, y0) = (dx + 9, dy + 4 + d * 8);
            for ay in y0..y0 + 5 {
                for ax in x0..x0 + 16 {
                    let edge = ay == y0 || ay == y0 + 4 || ax == x0 || ax == x0 + 15;
                    self.set(ax, ay, if edge { OUTLINE } else { rgb(0xb8b0a0) });
                }
            }
            for s in 0..4 {
                let sx = x0 + 2 + s * 3 + (d % 2);
                self.set(sx, y0 + 2, rgb(0x5a4030));
                self.set(sx + 1, y0 + 2, rgb(0x6b4c38));
                self.set(sx + 1, y0 + 1, rgb(0x4a3426));
            }
        }
        // the crab sign at the foot of the Wharf
        let (sx, sy) = (2300 / S, (H - (shore - 22)) / S);
        for ay in sy - 4..=sy + 4 {
            for ax in sx - 6..=sx + 6 {
                let ring = ((ax - sx) * (ax - sx) + (ay - sy) * (ay - sy) * 3) as f64;
                if ring <= 36.0 {
                    self.set(ax, ay, if ring > 22.0 { OUTLINE } else if ring > 9.0 { rgb(0xd9433b) } else { rgb(0x2f6fa8) });
                }
            }
        }
    }

    fn pyramid(&mut self, cx: i32, cy: i32, r: i32) {
        for ay in cy - r..=cy + r {
            for ax in cx - r..=cx + r {
                let (dx, dy) = (ax - cx, ay - cy);
                let c = if dx.abs() == r || dy.abs() == r {
                    OUTLINE
                } else if dx.abs() == dy.abs() {
                    rgb(0xb9b4aa) // the four ridges
                } else if dy.abs() > dx.abs() {
                    if dy < 0 { rgb(0xfbf8f0) } else { rgb(0xc9c3b6) }
                } else if dx < 0 {
                    rgb(0xeee9df)
                } else {
                    rgb(0xd8d2c5)
                };
                self.set(ax, ay, c);
            }
        }
        for i in 1..=3 {
            self.shade(cx + r + i, cy + i, 0.7);
        }
    }

    /// roads: asphalt with a few specks, a curb, the sidewalk, dashed centre lines, the start line
    fn roads(&mut self) {
        for ay in 0..AH {
            for ax in 0..AW {
                let (x, y) = (ax * S + 1, H - ay * S - 1);
                let d = self.road_distance(x, y);
                let over_water = Sf::water(x, y) || Sf::near_water(x, y, 6);
                if d <= ROAD {
                    let (i, side) = self.field.nearest(x, y);
                    let k = self.line.curve[i];
                    let c = if d > ROAD - S {
                        CURB
                    } else if d > ROAD - 3 * S && k.abs() > CORNER && (k.signum() as i32) == side {
                        if (i / 2) % 2 == 0 { KERB_RED } else { WHITE } // a kerb on the inside of the corner
                    } else if self.lombard[i] {
                        // Lombard Street's red brick, laid in staggered rows
                        if (ay % 3 == 0) || ((ax + (ay / 3) * 2) % 5 == 0) { rgb(0x8c3a2a) } else { BRICK }
                    } else if (ax * 5 + ay * 3) % 17 == 0 {
                        ASPHALT_SPECK
                    } else {
                        ASPHALT
                    };
                    self.set(ax, ay, c);
                } else if d <= ROAD + WALK && self.lombard[self.field.nearest(x, y).0] {
                    // Lombard's hedges and flower beds right up to the brick
                    let n = (ax * 7 + ay * 11) % 13;
                    self.set(ax, ay, if d <= ROAD + S { TREE_DARK } else if n == 0 { rgb(0xe0607e) } else if n == 6 { rgb(0xf2c84b) } else { TREE });
                } else if d <= ROAD + WALK && !over_water {
                    self.set(ax, ay, if ax % 4 == 0 || ay % 4 == 0 { WALK_B } else { WALK_A }); // pavement squares
                } else if d <= ROAD + WALK + S && !over_water {
                    // a low curb with bollards along the back of the sidewalk: the edge of the track
                    self.set(ax, ay, if (ax + ay) % 4 == 0 { rgb(0xe8c547) } else { rgb(0x55514b) });
                }
            }
        }
        // a dashed lane line down the middle wherever the road runs fairly straight
        for i in 0..self.line.len() {
            let p = self.line.points[i];
            if self.line.curve[i].abs() < CORNER && (i * 6 / 18) % 2 == 0 && !self.lombard[i] && !self.california[i] && !self.line.near_start(p[0], p[1]) {
                self.set(p[0] as i32 / S, (H - p[1] as i32) / S, LANE);
            }
        }
        // cable car tracks up California Street
        for i in 0..self.line.len() {
            let p = self.line.points[i];
            if self.california[i] {
                let t = self.line.tangent(i);
                for off in [-26.0, -16.0, 16.0, 26.0] {
                    let (x, y) = (p[0] - t[1] * off, p[1] + t[0] * off);
                    self.set(x as i32 / S, (H - y as i32) / S, rgb(0x34353a));
                }
            }
        }
        // a cable car on its rails halfway up California Street: a red and cream car with an
        // open end, seen from above
        let cable: Vec<usize> = (0..self.line.len()).filter(|&i| self.california[i]).collect();
        if let Some(&i) = cable.get(cable.len() / 2) {
            let (p, t) = (self.line.points[i], self.line.tangent(i));
            for a in -10i32..=10 {
                for b in -4i32..=4 {
                    let (x, y) = (p[0] + t[0] * a as f64 * 3.0 - t[1] * (b as f64 * 3.0 + 21.0), p[1] + t[1] * a as f64 * 3.0 + t[0] * (b as f64 * 3.0 + 21.0));
                    let edge = a.abs() == 10 || b.abs() == 4;
                    let c = if edge { OUTLINE } else if a.abs() > 7 { rgb(0x8a5a3a) } else if b.abs() == 3 { rgb(0xf2e6c8) } else { rgb(0xc8302c) };
                    self.set(x as i32 / S, (H - y as i32) / S, c);
                }
            }
        }
        // the checkered start/finish line across the road
        for ay in 0..AH {
            for ax in 0..AW {
                if let Some(square) = self.line.start_line((ax * S + 1) as f64, (H - ay * S - 1) as f64) {
                    self.set(ax, ay, if square == 0 { WHITE } else { rgb(0x1b1b1f) });
                }
            }
        }
    }

    /// the bridges, wherever the track crosses water: a walkway and railings, suspender ropes
    /// and towers. The Golden Gate is orange; the Bay Bridge is silver.
    fn bridge(&mut self) {
        let n = self.line.len();
        let over = |sf: &Sf, i: usize| {
            let p = sf.line.points[i];
            Sf::water(p[0] as i32, p[1] as i32)
        };
        // the runs of samples over water: (first, count)
        let first = (0..n).find(|&i| !over(self, i)).unwrap_or(0);
        let mut spans = Vec::new();
        let mut run: Option<(usize, usize)> = None;
        for k in 1..=n {
            let i = (first + k) % n;
            if over(self, i) {
                run = Some(run.map_or((i, 1), |(a, l)| (a, l + 1)));
            } else if let Some(r) = run.take() {
                spans.push(r);
            }
        }
        let (gg, bay) = (self.line.nearest(GOLDEN_GATE), self.line.nearest(BAY_BRIDGE));
        let contains = |(a, l): (usize, usize), i: usize| (i + n - a) % n < l;
        let mut colour = vec![0u8; n];
        let mut towers = Vec::new();
        for &span in &spans {
            let kind = if contains(span, gg) { 1 } else if contains(span, bay) { 2 } else { 3 };
            for k in 0..span.1 {
                colour[(span.0 + k) % n] = kind;
            }
            let at: &[f64] = match kind {
                1 => &[0.27, 0.73],
                2 => &[0.3, 0.7],
                _ => &[],
            };
            towers.extend(at.iter().map(|f| ((span.0 + (span.1 as f64 * f) as usize) % n, kind)));
        }
        for ay in 0..AH {
            for ax in 0..AW {
                let (x, y) = (ax * S + 1, H - ay * S - 1);
                if !(Sf::water(x, y) || Sf::near_water(x, y, 6)) {
                    continue;
                }
                let d = self.road_distance(x, y);
                let (i, side) = self.field.nearest(x, y);
                let kind = colour[i];
                if kind == 0 {
                    continue;
                }
                let (c, light, _) = bridge_colours(kind);
                if d > ROAD && d <= ROAD + WALK - S {
                    self.set(ax, ay, DECK); // the walkway
                } else if d > ROAD + WALK - S && d <= ROAD + WALK + S {
                    self.set(ax, ay, if i % 3 == 0 { light } else { c }); // the railing and main cable
                } else if d > ROAD + WALK + S && d <= ROAD + WALK + 3 * S && side < 0 {
                    self.set(ax, ay, WAVE_DARK); // the deck's shadow on the water
                }
            }
        }
        // the towers: a leg each side of the deck and a beam across
        for (i, kind) in towers {
            let (c, light, dark) = bridge_colours(kind);
            let (p, t) = (self.line.points[i], self.line.tangent(i));
            let normal = [-t[1], t[0]];
            for side in [-1.0, 1.0] {
                let off = side * (ROAD + WALK + 14) as f64;
                let (lx, ly) = (p[0] + normal[0] * off, p[1] + normal[1] * off);
                for a in -5i32..=5 {
                    for b in -4i32..=4 {
                        let (x, y) = (lx + t[0] * a as f64 * 3.0 + normal[0] * b as f64 * 3.0, ly + t[1] * a as f64 * 3.0 + normal[1] * b as f64 * 3.0);
                        let edge = a.abs() == 5 || b.abs() == 4;
                        self.set(x as i32 / S, (H - y as i32) / S, if edge { dark } else if a < 0 { light } else { c });
                    }
                }
            }
            let reach = (ROAD + WALK + 14) as f64;
            let mut off = -reach;
            while off <= reach {
                for (k, col) in [(-1.0, dark), (1.0, c)] {
                    let (x, y) = (p[0] + normal[0] * off + t[0] * k * 3.0, p[1] + normal[1] * off + t[1] * k * 3.0);
                    self.set(x as i32 / S, (H - y as i32) / S, col);
                }
                off += S as f64;
            }
        }
    }
}

fn waymo() -> Picture {
    let rows = [
        "...kkkkkkkk...", "..kywwwwwwyk..", ".kwwwwwwwwwwk.", "skwwwwwwwwwwks", ".kwwwwwwwwwwk.", ".kgwwwwwwwwgk.",
        "kkgbbbbbbbbgkk", ".kgbbbbbbbbgk.", ".kwgbbbbbbgwk.", ".kwbbbbbbbbwk.", ".kwbbllllbbwk.", ".kwbllccllbwk.",
        ".kwbllccllbwk.", ".kwbbllllbbwk.", ".kwbbbbbbbbwk.", ".kwbbbbbbbbwk.", ".kwbbbbbbbbwk.", ".kwgbbbbbbgwk.",
        ".kwwwwwwwwwwk.", ".kgwwwwwwwwgk.", ".kgbbbbbbbbgk.", ".kgwbbbbbbwgk.", ".kwwwwwwwwwwk.", ".kwwwwccwwwwk.",
        ".kwwwwwwwwwwk.", "skwwwwwwwwwwks", "..krwwwwwwrk..", "...kkkkkkkk...",
    ];
    sprite(
        rows,
        "kwgblcsry",
        &[
            rgb(0x1c1c22), rgb(0xf6f6f3), rgb(0xc8cbd1), rgb(0x23262d), rgb(0x3d434d), rgb(0x5fd3c6), rgb(0x111114), rgb(0xd23a3a),
            rgb(0xfff0b0),
        ],
    )
}

/// a bridge's railing colours: plain, lit and shaded (1 the Golden Gate, 2 the Bay Bridge)
fn bridge_colours(kind: u8) -> (u32, u32, u32) {
    match kind {
        1 => (ORANGE, ORANGE_LIGHT, ORANGE_DARK),
        2 => (rgb(0xc9ced6), rgb(0xe8ecf0), rgb(0x8a929e)),
        _ => (rgb(0x9b958c), rgb(0xb9b2a4), rgb(0x6f6a62)),
    }
}

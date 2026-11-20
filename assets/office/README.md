# The office

The isometric office that stands for Neuman's home: a cut-away floor with an
open work pod, a glazed conference room, a private office, a coffee point, a
lounge and Neuman's own server cabinet — and the dashed lines that leave every
screen, rise to the ceiling and come down into Neuman.

## What is here

| file | what it is |
| --- | --- |
| `build_lib.py` | the generator: every part, material and light, as code |
| `office.blend` | the source scene (studio look, camera, lights, ground) |
| `office-light.png` | 2000 px render on the light studio ground |
| `office-dark.png` | 2000 px render on `#1e232b`, the site's own background |
| `office-transparent.png` | 1600 px render with an alpha channel |

The web copy is `public/office/office.glb`: the room on its own, no lights,
ground or camera, carrying the animation below, plus 1400 px WebP versions of
the three renders. The hero that shows it is
`src/components/OfficeScene.astro`.

## Rebuilding

Open Blender, then run this from its Python console (or paste it into a
`blender` exec call):

```python
import sys, importlib
sys.path.insert(0, '/path/to/assets/office')
import build_lib; importlib.reload(build_lib)
build_lib.build('light')          # wipes the file and makes the scene
build_lib.set_look('dark')        # same scene, lit for the dark background
```

`build()` is destructive: it empties the .blend first. The script is the source
of truth, so change it rather than moving vertices by hand.

## The plan

- **12.8 × 10.4 m**, walls 3.3 m high on +Y (back) and -X (left); the camera
  sees the two cut sides. True isometric: an orthographic camera on (1, -1, 1).
- **Server wall** (back left): Neuman's cabinet alone — one rack's worth of
  computer, turned so its face looks into the room, with the `neuman` plaque,
  a window in the freed wall and a tall plant beside it. No row of stacks:
  local AI fits in one box.
- **Conference room** (back right): a glass front with a door gap and a short
  glass return, a 2.6 × 1.1 m table, four chairs, two people, a laptop with its
  own line to Neuman, a plant, and one wide window across the exterior wall.
- **Private office** (back centre, 3.6 × 2.25 m): desk tucked into the left
  corner, visitor armchair turned to face the desk, a little plant, a low
  cabinet, and one wide window behind the desk.
- **Work pod** (centre): four desks around a 1.25 m planter, keyboards on every
  desk, coffee on two, each person facing the middle. One of the four has got
  up: the chair is empty and he is on the sofa, arms down, one ankle crossed
  onto the other knee.
- **Coffee point** (left wall): a longer counter, a toaster turned to face the
  room, a coffee pot and cups, a bowl of apples and oranges between them, the
  menu board, and the person turned towards the pot, his free arm hinged at
  the shoulder so it can reach it.
- **Lounge** (front right): rug, sofa facing the room with a throw and cushions,
  two armchairs turned in, coffee table, console, floor lamp and plants.
- **Windows**: a ribbon clerestory along the left wall, a window beside the
  door, one by Neuman, and wide windows in the office and conference.

## The lines

Every screen has a port. A dashed frost line rises from the centre of the top
of its monitor — or from the conference laptop — to just below the wall top,
joins a shared ceiling bus and runs to Neuman's cabinet. The conference
laptop's line runs west along the back wall and joins the office computer's
line, and that one run carries both to Neuman. Every line then meets above the
cabinet and comes down as a single drop. The bus starts exactly at the last
screen's port, so no line ends in a stub. `Net_Lines` is the dotted network,
`Neuman_Glyph` the glider inlaid on Neuman's top where the bundle lands.

## The animation

`build_animation()` keys the scene on a 30 fps clock, frames 1–601 (20 s).
Frame 601 is frame 1, so the loop joins without a cut.

- **Idle** — every person sways a degree or two on a slow sine, with a smaller
  lean out of phase, so nobody stands frozen.
- **Typing** — the forearms of the four desk workers are separate objects
  (`Person_*_ArmL/R`), each on an empty at its elbow (`…_Pivot`) parented to
  its person; the pivots rock about 5° on a 1.25 s cycle, left and right out of
  phase.
- **Talking** — the conference pair swing further and lean in and out on a 5 s
  cycle.
- **The sofa leg** — `Person_Couch_Leg` taps at the hip, 1.25 s a bounce.
- **The coffee reach** — `Person_Coffee_ArmL_Pivot` rests, swings the free arm
  onto the pot in about 1.4 s, holds, and comes back; twice in the loop. The
  pot stands where the hand lands.
- **The lines** — six `Pulse_*` spheres run their route from port to cabinet in
  10 s, staggered, pulsing in size; the dashes themselves pulse through their
  material in the browser.

The GLB carries one clip per animated object — glTF splits it that way — all
20 s. `OfficeScene.astro` plays every clip on one mixer, sweeps the camera
±9° on a 40 s arc, and drives the line materials' emission. `OfficeViewer.astro`
is the same model as a figure in the Blender blog post, where the reader turns
it with the pointer and zooms with the wheel or a two-finger pinch.

## Conventions

- Metres, Z up, the floor at z = 0 and the room centred on the origin.
- Exported with +Y up, so glTF's y = the floor and the room's front is +Z.
- Objects are joined into a few named meshes (`Work_Pod`, `Conference`,
  `Office_Room`, `Server_Racks`, `Net_Lines`, …) so a viewer can find and
  animate them by name.
- Glass is alpha-blended (`glass`, alpha 0.26) and marked `alphaMode: BLEND`
  in the GLB.

## Colours

Everything is the site's Nord ladder (`tailwind.config.mjs`): Snow Storm for
the shell and desks, Polar Night for the racks and chair frames, frost for the
screens, LEDs, the work light and the data lines, aurora green for the plants,
one amber cushion, one amber throw and one amber shirt for warmth. The windows
are sky blue (`sky`, #81a1c1), which reads as daylight without inventing an
exterior.

Skin and hair are the only colours outside Nord — desaturated warm neutrals,
so the room has people in it rather than mannequins in blue-grey. The figures
are box-built on purpose: heads, torsos, limbs and hair as bevelled boxes with
two dark eyes, in the low-poly style of the reference sheet.

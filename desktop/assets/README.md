The astronaut is reused unchanged from Isaac's Voyager visual study, confirmed
for this desktop experiment. Source: https://voyagershell.ai/images/astronaut/idle.png
(observed in the September 20, 2026 design package).

The rainbow arcs, floating motion and thin circular border follow that study.
The UI uses the system monospace font; no third-party web font is redistributed.
Desktop transparency is real; CSS does not establish native background blur.

The book and stretch frames are unchanged Voyager Shell artwork from
[main at 925a271](https://github.com/isaacasamoah/voyagershell/tree/925a2717f1172540ab4290b118e3d0be4d7cdfc9/public/images/astronaut).
The assets and animation definitions match dev at `f547266`.
[VoyagerLanding.tsx](https://github.com/isaacasamoah/voyagershell/blob/925a2717f1172540ab4290b118e3d0be4d7cdfc9/components/ui/VoyagerLanding.tsx)
defines the idle stretch timing;
[AstronautState.tsx](https://github.com/isaacasamoah/voyagershell/blob/925a2717f1172540ab4290b118e3d0be4d7cdfc9/components/chat/AstronautState.tsx)
defines book opening, page turns and the finishing stretch. The Electron
controller uses those frames and timings without adding React.

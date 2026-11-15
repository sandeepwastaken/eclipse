# Asset credits

- `moon-color-2k.webp`, `moon-color-8k.webp`, `moon-normal-4k.webp`: derived from the [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) (visualizer Ernie Wright, scientist Noah Petro): the LROC WAC colour mosaic with LOLA polar reflectance, and LOLA relief.
- `south-polar-color.webp` and the terrain under `data/terrain/`: built by `scripts/build_terrain.py` from NASA LRO/LOLA gridded DEMs (PDS Geosciences Node).
- `moon-logo.svg` (logo, favicon) and `../favicon.png`: traced by `scripts/make_logo.py` from the LROC mosaic: the near side smoothed and split at the maria's share of its area, with Tycho as a ring. The same script makes the spinning GIF and MP4 in `brand/`.
- `earth/`: [Solar System Scope](https://www.solarsystemscope.com/textures/) textures (CC BY 4.0), based on NASA Blue Marble and Black Marble; ocean reflectance corrected, clouds converted to greyscale, city lights packed with a water mask.
- `../models/astronaut.glb`: team-supplied suit model, rigged by `scripts/rig_astronaut.py`, with motion from the [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu/) (subject 02).
- `../models/apollo-lm-pbr.glb`: team-supplied photogrammetric Apollo LM model.

NASA data and imagery are used under the [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).

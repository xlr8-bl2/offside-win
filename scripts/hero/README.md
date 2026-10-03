# The Champions League night scene

`hero.html` draws the scene behind the Champions League night card
(`nightHTML` in `public/js/lib/moments.js`): a violet night, and a stadium
roof clad in the starball's own pattern, its skyline glowing. three.js 0.169
with bloom, rendered headless. The card lays the starball and its words over
it, so the still carries neither (`bare=1`).

To render, serve a folder holding `hero.html`, `starball.js`
(`public/js/lib/starball.js`), `fonts/` (`public/fonts`) and
`node_modules/three`, then:

    node hrender.mjs night.png "w=960&h=640&bare=1&thr=0.6&bloom=0.6&cy=130&cz=340&fov=44&ty=150&haze=0.24&rim=3&rx=230&rz=230&ry=110&stars=0"
    node webp.mjs night.png public/brand/ucl-night.webp 0.85

The starball (`public/brand/ucl-emblem.svg`) is the competition logo the site
already shows beside its name (the provider's, league 7), traced with potrace
and filled white for the dark.

## The Premier League trophy

`public/brand/pl-trophy.svg`, the silhouette on the break note, is made from a
photograph of the trophy on white: `silbuild.mjs` takes the crown and the
lions from the photo, draws the vase from its measured profile (mirrored, so
it is symmetrical), the arms and the base, and our own ribbons, two a side
with a swallowtail and a thin gap round each; `silsvg.mjs` traces it. The
photo itself is not kept or shipped.

    node silbuild.mjs          # reads pl-photo.webp, writes pl-mask2.png
    node silsvg.mjs pl-mask2.png pl-trophy.svg 800 1065

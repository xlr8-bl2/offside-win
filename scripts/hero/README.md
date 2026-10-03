# The hero scene

`hero.html` draws the email and pop-up hero: the star ball floating over the
wordmark and headline, a violet night, and a dome clad in the ball's star
pattern glowing at the bottom. three.js 0.169 with bloom, rendered headless.

To render: serve a folder holding `hero.html`, `starball.js`
(`public/js/lib/starball.js`), `fonts/` (`public/fonts`) and
`node_modules/three`, then `node hrender.mjs out.png "<query>"`.

The settings behind `preview-ucl.png`:
`w=1080&h=1080&thr=0.6&bloom=0.6&cy=130&cz=340&fov=44&ty=150&haze=0.28&rim=3&by=0.05`
`head=` sets the headline.

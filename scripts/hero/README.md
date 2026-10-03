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

The emblem is `ucl-trace.svg`, traced (potrace) from the competition logo the
site already shows (sports.bzzoiro.com/img/league/7/), filled white.

The joining email's picture, `public/brand/mail/hero-in.jpg` (1200 x 1140):
`w=1200&h=1140&thr=0.6&bloom=0.6&cy=130&cz=340&fov=44&ty=146&haze=0.3&rim=3&by=0.05&ball=0.27&head=You’re in.&hs=0.13&card=40&fadeh=120`
`card=40` draws the top 40 email pixels of the card into the picture's foot,
4% in from each side, which is where `heroBody` in `worker/src/mail.ts` puts
the rest of it.

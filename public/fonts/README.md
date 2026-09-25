# Fonts

Self-hosted, so the first paint makes no third-party request and the faces
that set the first screen can be preloaded.

| File | Face | Licence |
|---|---|---|
| `bigshoulders-latin.woff2`, `bigshoulders-latin-ext.woff2` | Big Shoulders Display, variable weight | SIL OFL 1.1 |
| `geist-latin.woff2`, `geist-latin-ext.woff2` | Geist, variable weight | SIL OFL 1.1 |
| `caveat-latin.woff2` | Caveat, variable weight | SIL OFL 1.1 |
| `offside-figures-600/700/800.woff2` | Offside Figures, derived from Big Shoulders | SIL OFL 1.1 |

The Latin and Latin Extended subsets are the ones Google Fonts serves; they
cover every club and player name on the board.

## Offside Figures

Big Shoulders ships proportional figures and no `tnum` feature: its "1" is
316 units wide and its "0" 596, so `font-variant-numeric: tabular-nums` does
nothing and a column of odds set in it never lines up. Offside Figures is its
digits and price punctuation (`0-9 . , : + - – − %`), instanced at weights
600, 700 and 800, with every digit set to the widest digit's advance and its
outline centred in it. Kerning is removed so no pair can undo the equal
widths. Renamed, as the OFL asks of a modified font.

It is used through `--display-figures` (tokens.css) on numbers that stack in
a column or tick in place: odds, kick-off times, scores, clocks. Numbers that
stand alone keep Big Shoulders' own figures.

To rebuild it, instance and subset Big Shoulders with fontTools
(`fontTools.varLib.instancer`, `fontTools.subset`), set each digit's advance
to the maximum, and shift each outline by `(W - inkWidth) / 2 - xMin`.

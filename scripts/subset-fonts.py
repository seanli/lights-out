# Cuts the bundled fonts down to the characters the game uses (they are base64-inlined into the page).
# Run after changing fonts: python3 scripts/subset-fonts.py   (needs: pip install fonttools brotli)
from fontTools import subset
CHARS = 'U+0020-007E,U+00A0,U+00B7,U+00D7,U+2013,U+2014,U+2018-201D,U+2026,U+2212'
FACES = {
    'fraunces-600': 'node_modules/@fontsource/fraunces/files/fraunces-latin-600-normal.woff2',
    'manrope-500': 'node_modules/@fontsource/manrope/files/manrope-latin-500-normal.woff2',
    'manrope-700': 'node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2',
}
for name, src in FACES.items():
    out = f'src/shell/styles/fonts/{name}.woff2'
    subset.main([src, f'--unicodes={CHARS}', '--flavor=woff2', '--layout-features=kern,liga,tnum,lnum,case', f'--output-file={out}'])
    print(out)

# Noto fonts for reading and vocabulary PDF exports

`NotoSerif-Regular.ttf` and `NotoSans-Regular.ttf` are distributed with the
application for the serif and sans reading settings. Both include Vietnamese
glyphs and combining-mark positioning, so reading does not depend on the fonts
installed on the device. The settings preview uses the same fonts as the reader.
Next.js serves these fonts locally through `next/font/local`, loading them only
when used. No external font service is contacted during reading or export.

The existing Noto Sans file is also embedded in exported vocabulary PDFs.

Both unmodified files come from the same pinned source and are covered by the
SIL Open Font License 1.1 in `OFL.txt` (the source repository's `LICENSE`).

- Source: https://github.com/notofonts/noto-fonts
- Commit: `ffebf8c1ee449e544955a7e813c54f9b73848eac`

| File | Source path | SHA-256 |
| --- | --- | --- |
| `NotoSans-Regular.ttf` | `hinted/ttf/NotoSans/NotoSans-Regular.ttf` | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |
| `NotoSerif-Regular.ttf` | `hinted/ttf/NotoSerif/NotoSerif-Regular.ttf` | `c8f669ceb2c9c60ccf55198b305e08a997ffca79a38cc7eeb551e643cbe66505` |

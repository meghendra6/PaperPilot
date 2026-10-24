# Bundled fonts

`STIXTwoText.woff2` and `STIXTwoText-Italic.woff2` are subsets of STIX Two Text
(weight axis 400–700) from <https://github.com/google/fonts/tree/main/ofl/stixtwotext>.
The subsets keep Latin, Greek, general punctuation, and the minus sign. STIX Two
Text has no arrows or other operators, so those fall back to another font.
They are licensed under the SIL Open Font License 1.1 in `OFL.txt`.

Research Studio loads them from this folder. The Research Workspace window loads
the same files as `studio/fonts/` because the Studio frame may only read fonts
from its own chrome package.

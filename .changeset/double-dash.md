---
"nipa-cli": patch
---

nipa stops reading its own options at `--`. In `nipa switch -- -h`, the command gets `-h` and nipa doesn't print its help.

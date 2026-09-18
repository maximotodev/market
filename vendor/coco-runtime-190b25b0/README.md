# Frozen Coco browser runtime

This generated local package layout contains the unchanged compiled core and
IndexedDB packages built from clean Coco commit
`190b25b0c16eb6ebbb42e1d67a0d28399c641ae1`.

Rebuild and verify it with:

```sh
COCO_SOURCE=/path/to/coco bash scripts/build-frozen-coco-runtime.sh
```

The build script reconstructs the source using `git archive`, installs the
frozen Coco lockfile in a temporary directory, builds only Coco core and
IndexedDB, and checks both package trees against
`scripts/coco-runtime/manifest.json`.

Market installs one aliased `@cashu/cashu-ts@5.0.0-rc.4` package. Its
post-install linker replaces both package-local copies with symlinks to that
single physical directory. The runtime probe verifies constructor identity and
cross-package Amount interoperability.

The wallet seed vault used by the Market adapter is demo-only custody. UI and
business modules cannot read it, and it is not a production seed encryption or
recovery design.

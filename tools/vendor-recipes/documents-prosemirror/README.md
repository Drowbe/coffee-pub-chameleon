# Recipe: modules/documents/src/documents-lib-0-prosemirror.js

How the vendored editor bundle is built (ProseMirror + Yjs + y-prosemirror, MIT). The package list, versions and hashes are in modules/documents/THIRD-PARTY.md.

- `build.sh <empty dir> <folder of the 16 ProseMirror .tgz> <folder of the Yjs-family .tgz>`: unpacks the tarballs as data, runs the three patches, writes `entry.js`, bundles with esbuild 0.28.2 (`ESB=<its bin>`), fails if the Yjs outside address is still in the output.
- `rename-grid-role.mjs`: renames the grid package's old role word to `gridRole` (the names rule). The `gridEditing` export is added in `entry.js`.
- `patch-ypm.mjs`: three exact-once patches to y-prosemirror (marks on inline atoms, NodeSelection guard, snapshot colours as theme tokens).
- `patch-yjs-url.mjs`: removes the one outside address from a Yjs message.
- `banner.txt`: the licence header put on the bundle.

Run from an empty folder. Fetch every tarball with `npm pack --ignore-scripts` and verify each sha256 against THIRD-PARTY.md before building. Nothing is installed and no package script runs.

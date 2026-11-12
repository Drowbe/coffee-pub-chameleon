#!/bin/bash
# usage: build.sh <empty build dir> <folder with the 16 PM + 4 Yjs-family .tgz (flat or in two folders)> ... see below
# Recipe for src/documents-lib-0-prosemirror.js. Needs esbuild 0.28.2 (ESB=path to its bin), Node 22. Packages are data: nothing is installed, no script runs.
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd); D=$1; PM=$2; YP=$3; : "${ESB:?path to esbuild 0.28.2}"
rm -rf "$D"; mkdir -p "$D/node_modules"; cd "$D"
for f in "$PM"/*.tgz "$YP"/*.tgz; do n=$(basename "$f" .tgz); n=${n%-*}; mkdir -p "node_modules/$n"; tar -xzf "$f" --strip-components=1 -C "node_modules/$n"; done
node "$R/rename-grid-role.mjs" node_modules/prosemirror-tables
node "$R/patch-ypm.mjs" node_modules/y-prosemirror
node "$R/patch-yjs-url.mjs" node_modules/yjs
cp "$R/banner.txt" banner.txt
cat > entry.js <<'E2'
export * from 'prosemirror-model';
export * from 'prosemirror-transform';
export * from 'prosemirror-state';
export * from 'prosemirror-view';
export * from 'prosemirror-commands';
export * from 'prosemirror-keymap';
export * from 'prosemirror-history';
export * from 'prosemirror-inputrules';
export * from 'prosemirror-schema-list';
export * from 'prosemirror-tables';
export { tableEditing as gridEditing } from 'prosemirror-tables';
export * from 'prosemirror-dropcursor';
export * from 'prosemirror-gapcursor';
export { MarkdownSerializer, MarkdownSerializerState } from './node_modules/prosemirror-markdown/src/to_markdown.ts';
export { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector, transact, UndoManager, XmlFragment, XmlElement, XmlText, Map as YMap, createRelativePositionFromTypeIndex, createAbsolutePositionFromRelativePosition, mergeUpdates, diffUpdate, snapshot, PermanentUserData } from 'yjs';
export { ySyncPlugin, yUndoPlugin, undo as yUndo, redo as yRedo, ySyncPluginKey, yUndoPluginKey, prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode, initProseMirrorDoc, absolutePositionToRelativePosition, relativePositionToAbsolutePosition, prosemirrorJSONToYXmlFragment, yDocToProsemirrorJSON, prosemirrorToYDoc, prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
E2
"$ESB" entry.js --bundle --format=iife --global-name=DlPM --minify --line-limit=200 --target=es2020 --legal-comments=none --charset=ascii --tsconfig-raw='{}' --banner:js="$(cat banner.txt)" --outfile=documents-lib-0-prosemirror.js
if grep -q 'github.com/yjs' documents-lib-0-prosemirror.js; then echo "outside address still in the bundle"; exit 1; fi
ls -l documents-lib-0-prosemirror.js; sha256sum documents-lib-0-prosemirror.js

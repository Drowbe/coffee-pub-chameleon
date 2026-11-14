// The profile folder names of every browser the checks start: each is a folder under os.tmpdir() whose name starts with one of
// these. tools/reap-browsers.mjs kills only browsers whose --user-data-dir is such a folder; tools/check-browser-orphans.mjs
// fails if a tool names a profile folder that is not on this list. (Re-exported by tools/browser-launch.mjs.)
export const BROWSER_PROFILE_PREFIXES = ['shots-chrome-', 'ds-chrome-', 'sysc-chrome-', 'check-confirm-chrome-', 'check-prompt-chrome-', 'forms-live-chrome-', 'check-pdf-viewer-chrome-'];

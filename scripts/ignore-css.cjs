// Preload hook: make `require('*.css')` a no-op so importing the Sanity Studio
// schema barrel (which transitively pulls `sanity` -> bundle.css) doesn't crash
// under raw tsx/node. Only used by off-lambda scripts; never bundled into prod.
const Module = require('module');
const origCss = Module._extensions['.css'];
Module._extensions['.css'] = function (mod) {
  mod.exports = {};
};
void origCss;

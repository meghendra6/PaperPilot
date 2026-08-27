

}
};
var __cache = Object.create(null);
function __require(id) {
  if (__cache[id]) return __cache[id].exports;
  var factory = __modules[id];
  if (!factory) throw new Error("Missing bundled module: " + id);
  var module = { exports: {} };
  __cache[id] = module;
  factory(module, module.exports, __require);
  return module.exports;
}
__require("src/companion/entry.ts");
})(typeof globalThis !== "undefined" ? globalThis : this);

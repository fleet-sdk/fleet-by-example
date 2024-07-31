import { beforeAll } from 'vitest';

beforeAll(() => {
  const module = require('module');
  const originalRequire = module.prototype.require;

  module.prototype.require = function () {
    try {
      return originalRequire.apply(this, arguments);
    } catch (err) {
      if (arguments[0].endsWith('.es')) {
        return {};
      }
      throw err;
    }
  };
});

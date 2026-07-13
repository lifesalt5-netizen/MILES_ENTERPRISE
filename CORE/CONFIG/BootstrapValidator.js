const { getConfigHealth } = require('./ConfigurationManager');

function bootstrapValidate() {
  const health = getConfigHealth();

  const blocking = health.required.filter(x => !x.ok);

  return {
    ok: blocking.length === 0,
    blocking,
    warnings: health.optional.filter(x => !x.present),
    health
  };
}

module.exports = {
  bootstrapValidate
};

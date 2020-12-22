const log4js = require('log4js');
log4js.configure({
  appenders: { cheese: { type: "file", filename: "debug.log" } },
  categories: { default: { appenders: ["cheese"], level: "error" } }
});
const logger = log4js.getLogger('cheese');

const logError = async (err) => {
  logger.error(err);
};

const logWarn = (err) => {
  logger.warn(err);
};


module.exports = {
  logError,
  logWarn
};
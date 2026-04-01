function logInfo(message, context = {}) {
  console.log(JSON.stringify({ level: "info", message, ...context }));
}

function logError(message, error, context = {}) {
  const details = {
    level: "error",
    message,
    ...context,
    error: error?.message || String(error)
  };
  console.error(JSON.stringify(details));
}

module.exports = {
  logInfo,
  logError
};

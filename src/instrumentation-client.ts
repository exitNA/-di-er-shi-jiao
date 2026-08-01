import { configureSync, getAnsiColorFormatter, getConsoleSink } from "@logtape/logtape";

configureSync({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter({ timestamp: "time" }) }),
  },
  loggers: [
    { category: "second-perspective", lowestLevel: "info", sinks: ["console"] },
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
  ],
});

import { ENABLE_CUSTOM_DISPATCH } from "../config";

const initialSyncDispatching = tryLoadModule('./../config/triples-dispatching/custom-dispatching/initial-sync-dispatching',
  './single-graph-dispatching/initial-sync-dispatching');
const deltaSyncDispatching = tryLoadModule('./../config/triples-dispatching/custom-dispatching/delta-sync-dispatching',
  './single-graph-dispatching/delta-sync-dispatching');
const deltaContextConfiguration = tryLoadModule('./../config/triples-dispatching/custom-dispatching/delta-context-config',
  './single-graph-dispatching/delta-context-config');

function tryLoadModule(targetModulePath, fallbackModulePath) {
  try {
    const module = require(targetModulePath);
    console.log(`[***************************************************]`);
    console.log(`Custom dispatching logic found on ${targetModulePath}`);
    console.log(`[***************************************************]`);
    return module;
  }
  catch (e) {
    if (e.code && e.code.toLowerCase() == 'MODULE_NOT_FOUND'.toLowerCase()) {
      console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
      console.warn(`${targetModulePath} not found, assuming default behaviour loaded on ${fallbackModulePath}`);
      console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
      return require(fallbackModulePath);
    }
    else {
      console.error(`It seems something went wrong while loading dispatching-logic.`);
      console.error(`The provided parameters for custom module ${targetModulePath}. (Note: this is optional and can be empty`);
      console.error(`The provided parameters for default module ${fallbackModulePath}.`);
      throw e;
    }
  } finally {
    if (!ENABLE_CUSTOM_DISPATCH) {
      console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
      console.log(`Custom dispatching has been disabled. The dispatch function will not be called.`);
      console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
    }
  }
}

module.exports = {
  initialSyncDispatching,
  deltaSyncDispatching,
  deltaContextConfiguration
};

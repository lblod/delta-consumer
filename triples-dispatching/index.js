import { ENABLE_CUSTOM_DISPATCH } from './../config';
export const initialSyncDispatching = tryLoadModule('./../config/triples-dispatching/custom-dispatching/initial-sync-dispatching.js',
    './single-graph-dispatching/initial-sync-dispatching.js');
export const deltaSyncDispatching = await tryLoadModule('./../config/triples-dispatching/custom-dispatching/delta-sync-dispatching.js',
    './single-graph-dispatching/delta-sync-dispatching.js');
export const deltaContextConfiguration = await tryLoadModule('./../config/triples-dispatching/custom-dispatching/delta-context-config.js',
    './single-graph-dispatching/delta-context-config.js');

async function tryLoadModule(targetModulePath, fallbackModulePath) {
    try {
        const module = await import(targetModulePath);
        console.log(`[***************************************************]`);
        console.log(`Custom dispatching logic found on ${targetModulePath}`);
        console.log(`[***************************************************]`);
        return module;
    }
    catch (e) {
        if (e.code && e.code.toLowerCase() == 'ERR_MODULE_NOT_FOUND'.toLowerCase()) {
            console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
            console.warn(`${targetModulePath} not found, assuming default behaviour loaded on ${fallbackModulePath}`);
            console.log(`[!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!]`);
            return await import(fallbackModulePath);
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



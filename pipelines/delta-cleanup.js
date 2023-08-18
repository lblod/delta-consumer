import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {createError} from "../lib/error";
import {DELTA_FILES_RETENTION_PERIOD, JOBS_GRAPH, SERVICE_NAME} from "../config";
import {PREFIXES} from "../lib/constants";
import DeltaFile from "../lib/delta-file";
export async function startDeltaCleanup() {
    try {
        // a retention period of -1 indicates files should not be removed
        if (DELTA_FILES_RETENTION_PERIOD !== -1) {
            let cleanupTimestamp = new Date();
            cleanupTimestamp.setDate(cleanupTimestamp.getDate() - DELTA_FILES_RETENTION_PERIOD);
            console.log(`Cleanup: removing delta files until ${cleanupTimestamp}`);
            const deltaFilesToRemove = await getDeltaFilesToCleanup(cleanupTimestamp);
            for (const deltaFileToRemove of deltaFilesToRemove) {
                await deltaFileToRemove.removeFile();
                await removeFile(deltaFileToRemove);
            }
        }
    } catch (e) {
        console.log(e);
        await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while running delta file cleanup task: ${e}`);
    }
}

async function getDeltaFilesToCleanup(deltaCleanupTimestamp) {
    const result = await query(`
    ${PREFIXES}
    SELECT ?id ?timestamp ?fileName WHERE {
            ?file a nfo:DataContainer;
            mu:uuid ?uuid;
            dct:subject <http://redpencil.data.gift/id/concept/DeltaSync/DeltafileInfo>;
            ext:hasDeltafileId ?id;
            ext:hasDeltafileName ?fileName;
            ext:hasDeltafileTimestamp ?timestamp.
            FILTER (?timestamp < "${deltaCleanupTimestamp.toISOString()}"^^xsd:dateTime)
    }
`)
    return result.results.bindings.map(b => new DeltaFile({
        id: b['id'].value,
        attributes: {created: b['timestamp'].value, name: b['fileName'].value}
    }));
}

async function removeHelper(pattern) {
    update(`
    ${PREFIXES}
    DELETE WHERE { GRAPH ?g {
    ${pattern}
    }}`);
}

async function removeFile(file) {
    await removeHelper(`
        ?file a nfo:DataContainer;
        mu:uuid ?uuid;
        dct:subject <http://redpencil.data.gift/id/concept/DeltaSync/DeltafileInfo>;
        ext:hasDeltafileId "${file.id}";
        ext:hasDeltafileName ?fileName;
        ext:hasDeltafileTimestamp ?timestamp.
    `);
}

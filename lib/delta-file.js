import fs from 'fs-extra';
import path from 'path';
import {
  DELTA_FILE_FOLDER,
  DOWNLOAD_FILE_ENDPOINT,
  KEEP_DELTA_FILES,
  ENABLE_DELTA_CONTEXT,
} from '../config';
import fetcher from './fetcher';
import { toTermObjectArray } from './utils';
import { addContext } from './delta-context';

fs.ensureDirSync(DELTA_FILE_FOLDER);

export default class DeltaFile {
  constructor(data) {
    /** Id of the delta file */
    this.id = data.id;
    /** Creation datetime of the delta file */
    this.created = data.attributes.created;
    /** Name of the delta file */
    this.name = data.attributes.name;
    /** Folder in which the delta files are stored in case they are kept */
    this.folderByDay = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(this.created));

  }

  /**
   * Public endpoint to download the delta file from based on its id
   */
  get downloadUrl() {
    return DOWNLOAD_FILE_ENDPOINT.replace(':id', this.id);
  }

  /**
   * Location to store the delta file during processing
   */
  get filePath() {
    return path.join(DELTA_FILE_FOLDER, this.fileName);
  }

  get fileName() {
    return `${this.created}-${this.id}.json`;
  }

  async download() {
    try {
      await fetcher(this.downloadUrl)
        .then(res => new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(this.filePath);
          res.body.pipe(writeStream);
          writeStream.on('close', () => resolve());
          writeStream.on('error', reject);
        }));
    } catch (e) {
      console.log(`Something went wrong while downloading file from ${this.downloadUrl}`);
      console.log(e);
      throw e;
    }
  }

  async load() {
    try {
      await this.download();
      const changeSets = await fs.readJson(this.filePath, { encoding: 'utf-8' });

      const termObjectChangeSets = [];
      for (let { inserts, deletes } of changeSets) {
        const changeSet = {};
        changeSet.deletes = toTermObjectArray(deletes);
        changeSet.inserts = toTermObjectArray(inserts);

        termObjectChangeSets.push(changeSet);
      }
      console.log(`Successfully loaded file ${this.id} stored at ${this.filePath}`);

      if (!KEEP_DELTA_FILES) {
        await fs.unlink(this.filePath);
      } else {
        const directory = path.join(DELTA_FILE_FOLDER, this.folderByDay);
        await fs.ensureDir(directory);
        const pathExists = await fs.pathExists(path.join(directory, this.fileName));
        if (!pathExists) {
          await fs.move(this.filePath, path.join(directory, this.fileName));
        } else {
          await fs.remove(this.filePath);
        }
      }

      //TODO: work on uniform serialization!
      return { termObjectChangeSets, changeSets };
    }
    catch (error) {
      console.log(`Something went wrong while ingesting file ${this.id} stored at ${this.filePath}`);
      console.log(error);
      throw error;
    }
  }

  //TODO: move to decent file model; fetching here is mega brittle.
  // See delta-sync-task too.
  async removeFile(){
    const directory = path.join(DELTA_FILE_FOLDER, this.folderByDay);
    const fullPath = path.join(directory, this.fileName);
    if (await fs.pathExists(fullPath)){
      await fs.remove(fullPath);
    }
    else {
      console.warn(`No physical delta file found for ${fullPath}`);
    }
  }
}

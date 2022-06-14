import fs from 'fs-extra';
import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import path from 'path';
import {
    DELTA_FILE_FOLDER, DOWNLOAD_FILE_ENDPOINT, KEEP_DELTA_FILES
} from '../cfg';
import fetcher from './fetcher';
import changesetTransformer from '../config/changeset-transformer';

fs.ensureDirSync(DELTA_FILE_FOLDER);

export default class DeltaFile {

  constructor(data) {
    /** Id of the delta file */
    this.id = data.id;
    /** Creation datetime of the delta file */
    this.created = data.attributes.created;
    /** Name of the delta file */
    this.name = data.attributes.name;
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
    return path.join(DELTA_FILE_FOLDER,`${this.created}-${this.id}.json`);
  }

  /**
   * Downloads the delta file from the producer.
   *
   * @return Resulting json object.
   */
  async download() {
    try {
      const res = await fetcher(this.downloadUrl);

      if( !res.ok )
        throw "Producer did not yield successfull response code";

      if( KEEP_DELTA_FILES ) {
        const writeStream = fs.createWriteStream(this.filePath);
        res.body.pipe(writeStream);
        writeStream.on('error', () => console.log(`Failed to write file for ${this.downloadUrl}`));
      }

      return (await res.json()).map(changesetTransformer);
    } catch(e) {
      console.log(`Something went wrong while downloading file from ${this.downloadUrl}`);
      console.log(e);
      throw e;
    }
  }
}

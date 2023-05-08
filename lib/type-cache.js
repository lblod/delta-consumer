import {
  RDF_TYPE_URI,
} from './constants';


export default class TypeCache {
  constructor(changeSets) {
    this.cache = new Map();
    changeSets.map(
      changeSet => changeSet.inserts
    ).flat(1).filter(
      c => c.predicate === RDF_TYPE_URI
    ).forEach(
      c => this.add(c.subject, c.object)
    );
    changeSets.map(
      changeSet => changeSet.deletes
    ).flat(1).filter(
      c => c.predicate === RDF_TYPE_URI
    ).forEach(
      c => this.add(c.subject, c.object)
    )
  }

  get(key) {
    return Array.from(this.cache.get(key)).map(type => {
      return {
        graph: "<http://example.org/cache>",
        subject: key,
        predicate: RDF_TYPE_URI,
        object: type
      }
    });
  }

  has(key) {
    return this.cache.has(key);
  }

  add(key, ...values) {
    if (!this.cache.has(key)) {
      this.cache.set(key, new Set());
    }
    values.forEach((value) => {
      this.cache.get(key).add(value);
    });
  }

  delete(key) {
    this.cache.delete(key);
  }
}
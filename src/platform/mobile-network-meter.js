// Android UID counters include uploads and downloads, not traffic in external apps.
class MobileNetworkMeter {
  constructor(storage, readCounters, now = () => new Date()) {
    this.storage = storage; this.readCounters = readCounters; this.now = now;
    this.state = storage.readJsonSafe('network-usage', null) || {version: 1, since: null, days: {}, hours: {}, baseline: null};
  }
  sample() {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => {this.pending = null;});
    return this.pending;
  }
  async collect() {
    const counter = await this.readCounters();
    if (!counter || counter.supported === false || !Number.isSafeInteger(counter.rx) || !Number.isSafeInteger(counter.tx) || counter.rx < 0 || counter.tx < 0) {
      return {...structuredClone(this.state), available: false};
    }
    const date = this.now(), iso = date.toISOString(), previous = this.state.baseline;
    this.state.since ||= iso;
    // Reboots and counter resets start a new baseline; never count old UID totals twice.
    if (previous && previous.boot === counter.boot && counter.rx >= previous.rx && counter.tx >= previous.tx) {
      const delta = counter.rx - previous.rx + counter.tx - previous.tx;
      for (const [table, key] of [[this.state.days, iso.slice(0,10)], [this.state.hours, iso.slice(0,13)]]) {
        table[key] ||= {android: 0}; table[key].android += delta;
      }
    }
    this.state.baseline = {rx: counter.rx, tx: counter.tx, boot: counter.boot};
    // Bound Preferences writes and retained history (one year / seven days).
    for (const [table, cutoff] of [[this.state.days, new Date(date-366*86400000).toISOString().slice(0,10)], [this.state.hours,new Date(date-7*86400000).toISOString().slice(0,13)]]) {
      for (const key of Object.keys(table)) if (key < cutoff) delete table[key];
    }
    this.storage.writeJsonSafe('network-usage', this.state);
    return {...structuredClone(this.state), available: true};
  }
}
module.exports = {MobileNetworkMeter};

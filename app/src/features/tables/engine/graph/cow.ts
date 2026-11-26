// Copy-on-write maps for the engine state: a fork shares a map until either side changes it.

/** A map that a fork shares until either side changes it. */
export class Cow<K, V> {
  constructor(
    private map: Map<K, V> = new Map(),
    private owned = true,
  ) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  set(key: K, value: V): void {
    this.mine().set(key, value);
  }

  delete(key: K): void {
    if (this.map.has(key)) this.mine().delete(key);
  }

  private mine(): Map<K, V> {
    if (!this.owned) {
      this.map = new Map(this.map);
      this.owned = true;
    }
    return this.map;
  }

  fork(): Cow<K, V> {
    this.owned = false;
    return new Cow(this.map, false);
  }
}

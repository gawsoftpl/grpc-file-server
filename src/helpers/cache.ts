import {LRUCache } from "lru-cache";
import * as EventEmitter from 'events'
import {FileInterface} from "../interfaces/file.interface";

interface CacheOptions {
    maxMemory: number,
    maxTtl: number,
}

// Define a type map for events
interface CacheEvents<K, CacheItemType> {
    'remove': [CacheItemType, K, string];
    'error': [Error];
    'close': [void];
}

// Create a strongly-typed EventEmitter class
class TypedEventEmitter<Key, CacheItemType> extends EventEmitter {
    // Typed emit method
    emit<K extends keyof CacheEvents<Key, CacheItemType>>(event: K, ...args: CacheEvents<Key, CacheItemType>[K] extends void ? [] : CacheEvents<Key, CacheItemType>[K]): boolean {
        return super.emit(event, ...args);
    }

    // Typed on (addListener) method
    on<K extends keyof CacheEvents<Key, CacheItemType>>(event: K, listener: (...args: CacheEvents<Key, CacheItemType>[K] extends void ? [] : CacheEvents<Key, CacheItemType>[K]) => void): this {
        return super.on(event, listener);
    }

    // Typed once method
    once<K extends keyof CacheEvents<Key, CacheItemType>>(event: K, listener: (...args: CacheEvents<Key, CacheItemType>[K] extends void ? [] : CacheEvents<Key, CacheItemType>[K]) => void): this {
        return super.once(event, listener);
    }
}

/**
 * Simple cache with LRU and TTL
 */

export class Cache<K, V extends FileInterface, FC=any> extends TypedEventEmitter<K, V> {

    private data: LRUCache<K, V, FC>
    private timers: Map<K, NodeJS.Timeout>

    constructor(private options: CacheOptions) {
        super();

        this.data = new LRUCache({
            maxSize: options.maxMemory,
            sizeCalculation: (value) => {
                return value.fileSize
            },
            dispose: (value, key, reason) => {
                this.emit('remove', value, key, reason)
            }
        })
        this.timers = new Map()
    }

    /**
     * Set data to cache
     * @param key
     * @param value
     * @param ttl - time to live in miliseconds
     */
    set(key: K, value: V, ttl : number)  {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key))
        }

        const parsedTtl = Math.min(ttl, this.options.maxTtl)
        this.timers.set(
            key,
            setTimeout(() => this.delete(key), parsedTtl * 1000)
        )
        this.data.set(key, value, {
            noDisposeOnSet: true
        })
    }

    /**
     * Items in cache
     */
    length(): number
    {
        return this.data.size
    }

    get(key: K) {
        return this.data.get(key)
    }

    has(key: K) {
        return this.data.has(key)
    }

    delete (key: K){
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key))
        }
        this.timers.delete(key)
        return this.data.delete(key)
    }

    /**
     * Clear all elements
     */
    clear() {
        this.data.clear()
        for (const v of this.timers.values()) {
            clearTimeout(v)
        }
        this.timers.clear()
    }


}
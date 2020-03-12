/*
 * Copyright 2020 Google LLC.
 *
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 *
 * Code distributed by Google as part of this project is also subject to an additional IP rights
 * grant found at
 * http://polymer.github.io/PATENTS.txt
 */
package arcs.core.storage.keys

import arcs.core.common.ArcId
import arcs.core.common.toArcId
import arcs.core.data.Capabilities
import arcs.core.storage.CapabilitiesResolver
import arcs.core.storage.StorageKey
import arcs.core.storage.StorageKeyParser

/** Protocol to be used with the volatile driver. */
const val VOLATILE_DRIVER_PROTOCOL = "volatile"

/** Storage key for a piece of data kept in the volatile driver. */
data class VolatileStorageKey(
    /** Id of the arc where this key was created. */
    val arcId: ArcId,
    /** Unique identifier for this particular key. */
    val unique: String
) : StorageKey(VOLATILE_DRIVER_PROTOCOL) {
    override fun toKeyString(): String = "$arcId/$unique"

    override fun childKeyWithComponent(component: String): StorageKey =
        VolatileStorageKey(arcId, "$unique/$component")

    override fun toString(): String = super.toString()

    companion object {
        private val VOLATILE_STORAGE_KEY_PATTERN = "^([^/]+)/(.*)\$".toRegex()

        init {
            // When VolatileStorageKey is imported, this will register its parser with the storage
            // key parsers.
            registerParser()
        }

        fun registerParser() {
            StorageKeyParser.addParser(VOLATILE_DRIVER_PROTOCOL, ::fromString)
        }

        fun registerKeyCreator() {
            CapabilitiesResolver.registerDefaultKeyCreator(
                VOLATILE_DRIVER_PROTOCOL,
                Capabilities.TiedToArc
            ) { storageKeyOptions ->
                VolatileStorageKey(storageKeyOptions.arcId, storageKeyOptions.unique)
            }
            CapabilitiesResolver.registerDefaultKeyCreator(
                VOLATILE_DRIVER_PROTOCOL,
                Capabilities.Empty
            ) { storageKeyOptions ->
                VolatileStorageKey(storageKeyOptions.arcId, storageKeyOptions.unique)
            }
        }

        private fun fromString(rawKeyString: String): VolatileStorageKey {
            val match =
                requireNotNull(VOLATILE_STORAGE_KEY_PATTERN.matchEntire(rawKeyString)) {
                    "Not a valid VolatileStorageKey: $rawKeyString"
                }

            return VolatileStorageKey(match.groupValues[1].toArcId(), match.groupValues[2])
        }
    }
}
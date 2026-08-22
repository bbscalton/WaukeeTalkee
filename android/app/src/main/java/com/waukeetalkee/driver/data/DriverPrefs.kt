package com.waukeetalkee.driver.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.driverPrefs by preferencesDataStore("waukee_driver_prefs")

class DriverPrefs(private val context: Context) {
    private val volumePttKey = booleanPreferencesKey("volume_ptt_enabled")
    private val activeGroupKey = stringPreferencesKey("active_group_id")
    private val peerTargetKey = stringPreferencesKey("peer_target_driver_id")

    /** Default OFF — volume keys behave as normal volume. */
    val volumePttEnabled: Flow<Boolean> = context.driverPrefs.data.map { prefs ->
        prefs[volumePttKey] ?: false
    }

    val activeGroupId: Flow<String?> = context.driverPrefs.data.map { prefs ->
        prefs[activeGroupKey]
    }

    val peerTargetDriverId: Flow<String?> = context.driverPrefs.data.map { prefs ->
        prefs[peerTargetKey]
    }

    suspend fun setVolumePttEnabled(enabled: Boolean) {
        context.driverPrefs.edit { prefs ->
            prefs[volumePttKey] = enabled
        }
    }

    suspend fun setActiveGroupId(groupId: String?) {
        context.driverPrefs.edit { prefs ->
            if (groupId.isNullOrBlank()) prefs.remove(activeGroupKey)
            else prefs[activeGroupKey] = groupId
        }
    }

    suspend fun setPeerTargetDriverId(driverId: String?) {
        context.driverPrefs.edit { prefs ->
            if (driverId.isNullOrBlank()) prefs.remove(peerTargetKey)
            else prefs[peerTargetKey] = driverId
        }
    }
}

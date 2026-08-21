package com.waukeetalkee.driver.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.driverPrefs by preferencesDataStore("waukee_driver_prefs")

class DriverPrefs(private val context: Context) {
    private val volumePttKey = booleanPreferencesKey("volume_ptt_enabled")

    /** Default OFF — volume keys behave as normal volume. */
    val volumePttEnabled: Flow<Boolean> = context.driverPrefs.data.map { prefs ->
        prefs[volumePttKey] ?: false
    }

    suspend fun setVolumePttEnabled(enabled: Boolean) {
        context.driverPrefs.edit { prefs ->
            prefs[volumePttKey] = enabled
        }
    }
}

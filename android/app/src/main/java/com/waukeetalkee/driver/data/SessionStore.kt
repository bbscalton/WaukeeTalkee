package com.waukeetalkee.driver.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("waukee_session")

data class DriverSession(
    val orgId: String,
    val driverId: String,
    val displayName: String,
    val deviceId: String,
)

class SessionStore(private val context: Context) {
    private val orgIdKey = stringPreferencesKey("org_id")
    private val driverIdKey = stringPreferencesKey("driver_id")
    private val displayNameKey = stringPreferencesKey("display_name")
    private val deviceIdKey = stringPreferencesKey("device_id")

    val session: Flow<DriverSession?> = context.dataStore.data.map { prefs ->
        val orgId = prefs[orgIdKey] ?: return@map null
        val driverId = prefs[driverIdKey] ?: return@map null
        val displayName = prefs[displayNameKey] ?: return@map null
        val deviceId = prefs[deviceIdKey] ?: return@map null
        DriverSession(orgId, driverId, displayName, deviceId)
    }

    suspend fun save(session: DriverSession) {
        context.dataStore.edit { prefs ->
            prefs[orgIdKey] = session.orgId
            prefs[driverIdKey] = session.driverId
            prefs[displayNameKey] = session.displayName
            prefs[deviceIdKey] = session.deviceId
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}

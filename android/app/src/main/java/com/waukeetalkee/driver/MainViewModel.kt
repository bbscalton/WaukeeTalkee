package com.waukeetalkee.driver

import android.app.Application
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.ktx.auth
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import com.waukeetalkee.driver.data.DriverSession
import com.waukeetalkee.driver.data.PairingRepository
import com.waukeetalkee.driver.data.SessionStore
import com.waukeetalkee.driver.duty.DutyLocationService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class UiState(
    val ready: Boolean = false,
    val session: DriverSession? = null,
    val onDuty: Boolean = false,
    val pairing: Boolean = false,
    val error: String? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SessionStore(app)
    private val pairingRepo = PairingRepository()

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val session = store.session.first()
            if (session != null && Firebase.auth.currentUser == null) {
                // Session without auth — force re-pair
                store.clear()
                _state.value = UiState(ready = true)
            } else {
                val onDuty = if (session != null) {
                    readOnDuty(session)
                } else {
                    false
                }
                _state.value = UiState(ready = true, session = session, onDuty = onDuty)
            }
        }
    }

    private suspend fun readOnDuty(session: DriverSession): Boolean {
        return try {
            val snap = Firebase.firestore
                .document("orgs/${session.orgId}/drivers/${session.driverId}")
                .get()
                .await()
            snap.getBoolean("onDuty") == true
        } catch (_: Exception) {
            false
        }
    }

    fun pair(code: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(pairing = true, error = null)
            try {
                val deviceId = Settings.Secure.getString(
                    getApplication<Application>().contentResolver,
                    Settings.Secure.ANDROID_ID,
                ) ?: "unknown-device"
                val orgId = BuildConfig.DEFAULT_ORG_ID
                val result = pairingRepo.redeem(orgId, code, deviceId)
                Firebase.auth.signInWithCustomToken(result.customToken).await()
                val session = DriverSession(
                    orgId = result.orgId,
                    driverId = result.driverId,
                    displayName = result.displayName,
                    deviceId = deviceId,
                )
                store.save(session)
                _state.value = UiState(ready = true, session = session, onDuty = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    pairing = false,
                    error = e.message ?: "Pairing failed",
                )
            }
        }
    }

    fun setOnDuty(enabled: Boolean) {
        val session = _state.value.session ?: return
        val ctx = getApplication<Application>()
        if (enabled) {
            DutyLocationService.start(ctx, session.orgId, session.driverId)
            _state.value = _state.value.copy(onDuty = true)
        } else {
            DutyLocationService.stop(ctx, session.orgId, session.driverId)
            _state.value = _state.value.copy(onDuty = false)
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun unpair() {
        viewModelScope.launch {
            setOnDuty(false)
            Firebase.auth.signOut()
            store.clear()
            _state.value = UiState(ready = true)
        }
    }
}
